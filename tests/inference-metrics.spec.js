import { test, expect } from '@playwright/test';
import { metricsFixture } from './inference-metrics-fixture.mjs';

async function setup(page, endpoint = 'https://laptop-metrics.example/metrics') {
  await page.route('**/deployment.js', route => route.fulfill({
    contentType: 'application/javascript',
    body: `export const INFERENCE_METRICS_ENDPOINT = ${JSON.stringify(endpoint)};`
  }));
  await page.route('**/snapshot.json', () => { throw new Error('Legacy Mac snapshot must never be fetched'); });
  await page.route('**/nishad-ai-proxy.*', () => { throw new Error('Mac must never be polled'); });
}

test('public laptop metrics show real counts, charts, unknown GPU and no configured Mac workflows', async ({ page }) => {
  await setup(page);
  let calls = 0;
  await page.route('https://laptop-metrics.example/metrics', route => {
    calls++;
    expect(route.request().method()).toBe('GET');
    return route.fulfill({ json: metricsFixture() });
  });
  await page.goto('/metrics/');
  await expect(page.locator('#status')).toContainText('Live laptop metrics');
  await expect(page.locator('#inference-cards')).toContainText('maximum wait 60s');
  await expect(page.locator('#cards')).toContainText('Unavailable');
  await expect(page.locator('#services')).toContainText('Model API');
  await expect(page.getByText('The Mac is not polled', { exact: false })).toBeVisible();
  await expect(page.locator('#resourceChart path')).not.toHaveCount(0);
  await expect(page.locator('#latencyChart rect')).toHaveCount(6);
  expect(calls).toBe(1);
  await page.setViewportSize({ width: 375, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('offline or stale metrics are not presented as healthy or replaced by the Mac snapshot', async ({ page }) => {
  await setup(page);
  await page.route('https://laptop-metrics.example/metrics', route => {
    const data = metricsFixture();
    data.generated_at = new Date(Date.now() - 120000).toISOString();
    return route.fulfill({ json: data });
  });
  await page.goto('/metrics/');
  await expect(page.locator('#status')).toContainText('Laptop metrics unavailable');
  await expect(page.locator('#cards')).toBeEmpty();
});

test('unconfigured public metrics do not make any model or Mac requests', async ({ page }) => {
  await setup(page, '');
  await page.goto('/metrics/');
  await expect(page.locator('#status')).toContainText('not configured');
  await expect(page.locator('#cards')).toBeEmpty();
});
