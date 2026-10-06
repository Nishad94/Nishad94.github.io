import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { PRIVATE_DASHBOARD_ORIGIN } from '../deployment.js';

test('exact metrics entry is a constant launcher, never a public report', async ({ page }) => {
  if (PRIVATE_DASHBOARD_ORIGIN) {
    await page.route(`${PRIVATE_DASHBOARD_ORIGIN}/**`, route => route.fulfill({
      contentType: 'text/html', body: '<h1>Synthetic protected destination</h1>'
    }));
    await page.goto('/dashboard_metrics?ignored=synthetic#ignored');
    await expect(page).toHaveURL(`${PRIVATE_DASHBOARD_ORIGIN}/dashboard_metrics`);
    await expect(page.getByRole('heading', { name: 'Synthetic protected destination' })).toBeVisible();
    return;
  }
  await page.goto('/dashboard_metrics');
  await expect(page.getByRole('heading', { name: 'Private website metrics' })).toBeVisible();
  await expect(page.getByText(/not configured/)).toBeVisible();
  expect(await page.locator('script').count()).toBe(0);
});

async function publicFixture(page, { privacy = false, enabled = true } = {}) {
  const events = [];
  await page.addInitScript(({ privacy }) => {
    if (privacy) Object.defineProperty(navigator, 'globalPrivacyControl', { value: true });
    localStorage.setItem('unrelated_synthetic_key', 'synthetic-never-send');
  }, { privacy });
  await page.route('https://nishad.ai/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/') {
      return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><head><script type="module" src="/analytics.js"></script></head><body><h1>Synthetic public page</h1></body></html>' });
    }
    if (url.pathname === '/deployment.js') {
      return route.fulfill({ contentType: 'text/javascript', body: `export const ANALYTICS_ENDPOINT = '${enabled ? 'https://metrics.example/collect' : ''}'; export const PRIVATE_DASHBOARD_ORIGIN = '';` });
    }
    if (url.pathname === '/analytics.js') {
      return route.fulfill({ contentType: 'text/javascript', body: await readFile(new URL('../analytics.js', import.meta.url), 'utf8') });
    }
    if (url.pathname === '/analytics-pages.json') return route.fulfill({ json: { '/': 'Home' } });
    return route.abort();
  });
  await page.route('https://metrics.example/collect', async route => {
    const request = route.request();
    if (request.method() === 'POST') events.push({ body: request.postDataJSON(), headers: request.headers() });
    return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': 'https://nishad.ai', 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Content-Type' } });
  });
  await page.goto('https://nishad.ai/?token=synthetic-secret#private-fragment', { referer: 'https://external.example/private?secret=synthetic' });
  return events;
}

test('tracker is opt-in, strips URLs and HTTP referrer, and supports withdrawal', async ({ page }) => {
  const events = await publicFixture(page);
  await expect(page.getByRole('button', { name: 'Allow minimal analytics' })).toBeVisible();
  expect(events).toHaveLength(0);
  await page.getByRole('button', { name: 'Allow minimal analytics' }).click();
  await expect.poll(() => events.length).toBe(1);
  expect(events[0].body.page).toBe('/');
  expect(events[0].body.referrer).toBe('external.example');
  expect(events[0].body.visitor).toMatch(/^[a-f0-9]{64}$/);
  expect(events[0].headers.referer).toBeUndefined();
  expect(JSON.stringify(events)).not.toContain('synthetic-secret');
  expect(JSON.stringify(events)).not.toContain('synthetic-never-send');
  await page.evaluate(() => { location.hash = 'another-private-fragment'; });
  expect(events).toHaveLength(1);
  await page.getByRole('button', { name: 'Decline / withdraw' }).click();
  expect(await page.evaluate(() => localStorage.getItem('nishad_metrics_daily'))).toBeNull();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Allow minimal analytics' })).toBeEnabled();
  expect(events).toHaveLength(1);
});

test('browser privacy preference disables collection', async ({ page }) => {
  const events = await publicFixture(page, { privacy: true });
  await expect(page.getByRole('button', { name: 'Allow minimal analytics' })).toBeDisabled();
  expect(events).toHaveLength(0);
});

test('default integration sends no analytics and offers no dead private link', async ({ page }) => {
  const events = await publicFixture(page, { enabled: false });
  await expect(page.getByRole('link', { name: 'Analytics privacy' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Allow minimal analytics' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Private dashboard' })).toHaveCount(0);
  expect(events).toHaveLength(0);
});

async function metricsFixture(page, { empty = false, mapFails = false, performanceFails = false } = {}) {
  const unexpected = [], ranges = [];
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== 'https://private.example') { unexpected.push(url.href); return route.abort(); }
    const assets = { '/dashboard_metrics': 'index.html', '/app.js': 'app.js', '/style.css': 'style.css', '/world.json': 'world.json' };
    if (assets[url.pathname]) {
      if (url.pathname === '/world.json' && mapFails) return route.fulfill({ status: 503, json: { error: 'unavailable' } });
      return route.fulfill({
        contentType: url.pathname.endsWith('.json') ? 'application/json' : url.pathname.endsWith('.js') ? 'text/javascript' : url.pathname.endsWith('.css') ? 'text/css' : 'text/html',
        headers: { 'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'none'; base-uri 'none'" },
        body: await readFile(new URL(`../dashboard/web/${assets[url.pathname]}`, import.meta.url), 'utf8')
      });
    }
    if (url.pathname === '/api/session') return route.fulfill({ json: { csrf: 'synthetic' } });
    if (url.pathname === '/api/performance') return route.fulfill(performanceFails ?
      { status: 503, json: { error: 'unavailable' } } :
      { json: { samples: empty ? 0 : 100, errors: empty ? 0 : 2, avgMs: empty ? 0 : 50.5, p95Ms: empty ? 0 : 95, p99Ms: empty ? 0 : 99, capacity: 2048, windowMinutes: 15 } });
    if (url.pathname === '/api/metrics') {
      ranges.push(route.request().postDataJSON().days);
      return route.fulfill({ json: {
        views: empty ? 0 : 200, uniques: empty ? 0 : 80, unidentified: empty ? 0 : 20, unknownCountry: empty ? 0 : 50,
        daily: empty ? [] : [{ day: '2026-10-01', views: 80, uniques: 30 }, { day: '2026-10-02', views: 120, uniques: 50 }],
        countries: empty ? [] : [{ label: 'IN', views: 100 }, { label: 'US', views: 50 }, { label: 'Unknown', views: 50 }],
        pages: empty ? [] : [{ label: '/blog/synthetic/', views: 200 }],
        referrers: empty ? [] : [{ label: '<script>not-executable</script>', views: 20 }]
      } });
    }
    unexpected.push(url.pathname); return route.abort();
  });
  await page.goto('https://private.example/dashboard_metrics');
  return { unexpected, ranges };
}

test('metrics charts, map and response-time percentiles are accessible and CSP-safe', async ({ page }) => {
  const { unexpected, ranges } = await metricsFixture(page);
  await expect(page.getByRole('heading', { name: 'Traffic over time' })).toBeVisible();
  await expect(page.locator('.traffic-chart')).toBeVisible();
  await expect(page.locator('.world-map .country')).toHaveCount(176);
  await expect(page.locator('.country.has-views')).toHaveCount(2);
  const india = page.locator('.country[aria-label^="India"]');
  await india.focus();
  await expect(page.locator('.location-focus')).toContainText('India · 100 views · 50.0%');
  expect(await india.evaluate(el => getComputedStyle(el).fill)).toBe('rgb(105, 228, 179)');
  await expect(page.locator('.latency-value')).toHaveText(['50.5 ms', '95 ms', '99 ms', '2.0%']);
  await expect(page.locator('.rank-label').filter({ hasText: '<script>not-executable</script>' })).toBeVisible();
  await page.getByText('View accessible daily data').click();
  await expect(page.getByRole('cell', { name: '2026-10-01', exact: true })).toBeVisible();
  await page.locator('#days').selectOption('30');
  await expect.poll(() => ranges).toEqual([7, 30]);
  await expect(page.locator('.world-map')).toHaveCount(1);
  expect(unexpected).toEqual([]);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.getByRole('heading', { name: 'Top locations' })).toBeVisible();
});

test('empty metrics do not invent traffic, locations or latency', async ({ page }) => {
  await metricsFixture(page, { empty: true });
  await expect(page.getByText('No traffic yet.', { exact: false })).toBeVisible();
  await expect(page.locator('.country.has-views')).toHaveCount(0);
  await expect(page.locator('.latency-value')).toHaveText(['—', '—', '—', '—']);
  await expect(page.locator('.stat-value')).toHaveText(['0', '0', '0', '—']);
});

test('private metrics clears on session expiry and has no file capabilities or tracking', async ({ page }) => {
  await page.clock.install();
  const { unexpected } = await metricsFixture(page);
  await expect(page.locator('.stat-value').first()).toHaveText('200');
  await expect(page.locator('a[href="/files"], #files')).toHaveCount(0);
  await page.route('https://private.example/api/session', route => route.fulfill({
    status: 401, json: { error: 'sign_in_required' }
  }));
  await page.clock.fastForward(60000);
  await expect(page.locator('#report')).toBeEmpty();
  await expect(page.locator('#metrics')).toBeHidden();
  expect(await page.evaluate(() => localStorage.length)).toBe(0);
  expect(unexpected).toEqual([]);
});

test('map and latency failures preserve metrics with explicit unavailable states', async ({ page }) => {
  await metricsFixture(page, { mapFails: true, performanceFails: true });
  await expect(page.getByText('Map unavailable.', { exact: false })).toBeVisible();
  await expect(page.getByText('Performance statistics unavailable.', { exact: false })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Top locations' })).toBeVisible();
  await expect(page.locator('.stat-value').first()).toHaveText('200');
});
