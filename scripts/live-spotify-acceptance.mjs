import { firefox } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { syntheticSpotifySample } from '../assets/spotify-synthetic.js';

const output = resolve(process.argv[2] || '');
if (!process.argv[2]) throw new Error('Usage: node scripts/live-spotify-acceptance.mjs <artifact-directory>');
await mkdir(output, { recursive: true });

const trace = [];
const mark = (event, detail = {}) => trace.push({ at: new Date().toISOString(), event, ...detail });
const sample = syntheticSpotifySample(50);
const browser = await firefox.launch({ headless: true });
const context = await browser.newContext({ extraHTTPHeaders: { DNT: '1' } });
await context.addInitScript(auth => {
  Object.defineProperty(navigator, 'globalPrivacyControl', { value: true });
  sessionStorage.setItem('nishad_spotify_auth', JSON.stringify(auth));
  localStorage.removeItem('nishad_metrics_consent');
}, {
  accessToken: 'synthetic-live-access', refreshToken: 'synthetic-live-refresh',
  expiresAt: Date.now() + 3600000, scope: 'user-top-read user-read-recently-played'
});
const page = await context.newPage();
const pageErrors = [], consoleErrors = [], analyticsAttempts = [], workerRequests = [];
page.on('pageerror', error => {
  pageErrors.push({ message: error.message, stack: error.stack });
  mark('page_error', { message: error.message, stack: error.stack });
});
page.on('console', message => {
  if (message.type() === 'error') {
    consoleErrors.push(message.text());
    mark('console_error', { message: message.text() });
  }
});
page.on('request', request => {
  const url = new URL(request.url());
  if (url.hostname.endsWith('workers.dev')) {
    workerRequests.push({ method: request.method(), endpoint: url.origin + url.pathname });
    mark('worker_request');
  }
});
await page.route('https://api.spotify.com/v1/**', route => {
  const url = route.request().url();
  const items = url.includes('/artists') ? sample.artists : sample.tracks;
  return route.fulfill({ json: { items } });
});
await page.route('**/collect', route => {
  analyticsAttempts.push(route.request().url());
  return route.abort();
});

try {
  mark('navigation_start');
  await page.goto('https://nishad.ai/?acceptance=synthetic#music', { waitUntil: 'networkidle' });
  mark('navigation_ready');
  await page.getByRole('button', { name: 'Last 6 months', exact: true }).click();
  mark('period_selected', { period: 'approximately six months' });
  await page.getByRole('checkbox').check();
  mark('report_consented');
  const requestStarted = Date.now();
  await page.getByRole('button', { name: 'Generate AI report', exact: true }).click();
  mark('generation_started');
  await page.locator('#spotify-result-output .vibe-report').waitFor({ state: 'visible', timeout: 180000 });
  mark('report_rendered', { duration_ms: Date.now() - requestStarted });
  const report = page.locator('#spotify-result-output .vibe-report');
  if (await report.locator('[role="meter"]').count() !== 4) throw new Error('Expected exactly four MBTI score bars.');
  for (const heading of [
    'Signal summary', 'Genre constellation', 'Music MBTI', 'Music tarot', 'Shuffle compatibility'
  ]) await report.getByRole('heading', { name: heading }).waitFor();
  await report.getByRole('button', { name: 'Reveal tarot card' }).click();
  await report.getByRole('slider', { name: 'Snark level' }).fill('2');
  await report.locator('.report-curious').click();
  if (await report.getByRole('button', { name: /Download PDF/ }).count()) throw new Error('Live report still exposes a PDF control.');
  if (await report.locator('[data-pdf-export]').count()) throw new Error('Live report still installs PDF export controls.');
  await writeFile(join(output, 'guided-report-text.txt'), await report.innerText());
  mark('interactions_verified');
  await page.screenshot({ path: join(output, 'guided-report-firefox.png'), fullPage: true });
  mark('screenshot_saved');

  if (pageErrors.length || consoleErrors.length) throw new Error('Browser errors were recorded.');
  if (analyticsAttempts.length) throw new Error('A production analytics request was attempted.');
  if (workerRequests.length !== 1) throw new Error(`Expected one Worker report request, received ${workerRequests.length}.`);
  await writeFile(join(output, 'live-acceptance.json'), JSON.stringify({
    passed: true, syntheticSpotifyData: true, ownerSpotifyLoginTested: false,
    publicWorker: true, firefox: true, analyticsAttempts: 0, workerRequests,
    pageErrors, consoleErrors, trace
  }, null, 2));
  console.log(JSON.stringify({ passed: true, artifacts: output, trace }, null, 2));
} catch (error) {
  await page.screenshot({ path: join(output, 'live-acceptance-failure.png'), fullPage: true }).catch(() => {});
  await writeFile(join(output, 'live-acceptance.json'), JSON.stringify({
    passed: false, error: error.message, stack: error.stack,
    syntheticSpotifyData: true, ownerSpotifyLoginTested: false,
    analyticsAttempts, workerRequests, pageErrors, consoleErrors, trace
  }, null, 2));
  throw error;
} finally {
  await browser.close();
}
