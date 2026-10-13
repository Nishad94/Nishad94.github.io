import { firefox } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { syntheticSpotifySample } from '../assets/spotify-synthetic.js';

const output = resolve(process.argv[2] || '');
if (!process.argv[2]) throw new Error('Usage: node scripts/live-spotify-acceptance.mjs <artifact-directory>');
await mkdir(output, { recursive: true });

const trace = [];
const mark = (event, detail = {}) => trace.push({ at: new Date().toISOString(), event, ...detail });
const sample = syntheticSpotifySample(50);
const browser = await firefox.launch({ headless: true });
const context = await browser.newContext({
  acceptDownloads: true,
  extraHTTPHeaders: { DNT: '1' }
});
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
  if (await report.locator('meter').count() !== 4) throw new Error('Expected exactly four MBTI meters.');
  for (const heading of [
    'Music personality / fictional write-up', 'AI-inferred genres / guesses, not Spotify metadata',
    'Music MBTI / invented axes and scores', 'Music tarot / fictional card',
    'Basic vs niche shuffle roast / made-up score'
  ]) await report.getByRole('heading', { name: heading }).waitFor();
  await report.getByRole('button', { name: 'Reveal tarot card' }).click();
  await page.screenshot({ path: join(output, 'guided-report-firefox.png'), fullPage: true });
  mark('screenshot_saved');

  const automaticEvent = page.waitForEvent('download');
  await report.getByRole('button', { name: 'Download PDF' }).click();
  const automatic = await automaticEvent;
  const automaticPath = join(output, 'guided-report-automatic.pdf');
  await automatic.saveAs(automaticPath);
  mark('automatic_pdf_saved');

  const manualEvent = page.waitForEvent('download');
  await report.getByRole('link', { name: 'Save PDF manually' }).click();
  const manual = await manualEvent;
  const manualPath = join(output, 'guided-report-manual.pdf');
  await manual.saveAs(manualPath);
  mark('manual_pdf_saved');
  const automaticBytes = await readFile(automaticPath);
  const manualBytes = await readFile(manualPath);
  if (!automaticBytes.equals(manualBytes)) throw new Error('Automatic and manual PDF downloads differ.');

  const reader = process.env.PDF_READER_PYTHON || 'python3';
  const pdfCheck = spawnSync(reader, ['-c', [
    'from pypdf import PdfReader',
    'import sys',
    'text="\\n".join((p.extract_text() or "") for p in PdfReader(sys.argv[1]).pages)',
    'normalized=" ".join(text.split())',
    'required=["Music Intelligence Report","Music personality / fictional write-up","Music MBTI / invented axes and scores","Music tarot / fictional card","Basic vs niche shuffle roast / made-up score"]',
    'missing=[value for value in required if value not in normalized]',
    'joined=["state.Music","write-upDive","metadatasynthetic","scoresENFP","broken.Basic"]',
    'bad=[value for value in joined if value in text]',
    'print(text[:500])',
    'raise SystemExit(1 if missing or bad else 0)'
  ].join(';') , automaticPath], { encoding: 'utf8' });
  if (pdfCheck.status !== 0) throw new Error('Saved PDF was unreadable or missing expected report text: ' + pdfCheck.stderr);
  await writeFile(join(output, 'guided-report-pdf-text.txt'), pdfCheck.stdout);
  mark('pdf_opened_and_read');

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
