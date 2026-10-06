import { test } from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pageEvent, referrerDomain, visitorId } from '../analytics.js';
import { renderMetricsEntry, publicPageCatalog, renderBlog } from '../scripts/build-site.mjs';
import { parsePost } from '../scripts/build-site.mjs';
import { source } from './blog-fixture.mjs';

test('analytics accepts only public catalog pages and strips identifying referrer details', () => {
  const catalog = { '/': 'Home', '/blog/test/': 'Test' };
  assert.deepEqual(pageEvent('/', catalog, 'https://example.com/private?token=secret#x', null), { page: '/', referrer: 'example.com' });
  for (const path of ['/files', '/dashboard_metrics', '/spotify-callback.html', '/?secret=value', '/#secret']) {
    assert.equal(pageEvent(path, catalog, '', null), null);
  }
  for (const ref of ['https://private.nishad.ai/files?path=private', 'https://nishad.ai/', 'file:///private', 'https://user:pass@example.com/', 'http://127.0.0.1/']) {
    assert.equal(referrerDomain(ref), '');
  }
});

test('random browser identifiers rotate daily and never fall back to fingerprinting', () => {
  const data = new Map();
  const storage = { getItem: key => data.get(key), setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key) };
  const now = Date.parse('2026-10-07T10:00:00Z');
  const id = visitorId(storage, webcrypto, now);
  assert.match(id, /^[a-f0-9]{64}$/);
  assert.equal(visitorId(storage, webcrypto, now + 1000), id);
  assert.notEqual(visitorId(storage, webcrypto, now + 24 * 60 * 60 * 1000), id);
  assert.equal(visitorId(null, webcrypto, now), null);
  const bad = { getItem() { throw new Error('disabled'); } };
  assert.equal(visitorId(bad, webcrypto, now), null);
});

test('metrics launcher redirects only to a constant HTTPS backend and stays inert by default', () => {
  assert.match(renderMetricsEntry(''), /not configured/);
  assert.ok(!renderMetricsEntry('').includes('http-equiv="refresh"'));
  const html = renderMetricsEntry('https://private.example');
  assert.match(html, /url=https:\/\/private\.example\/dashboard_metrics/);
  assert.ok(!html.includes('location.search'));
  for (const origin of ['http://private.example', 'https://user:pass@private.example', 'https://private.example/path', 'https://private.example?token=x']) {
    assert.throws(() => renderMetricsEntry(origin));
  }
});

test('public catalog excludes drafts and 404s never track', async () => {
  const published = parsePost(source(), 'public.md');
  const draft = parsePost(source({ draft: true }), 'draft.md');
  assert.deepEqual(Object.keys(publicPageCatalog([published, draft])), ['/', '/blog/', '/blog/public/']);
  const output = renderBlog([published, draft]);
  assert.ok(!output.get('analytics-pages.json').includes('draft'));
  assert.ok(!output.get('404.html').includes('analytics.js'));
  assert.ok(!output.get('dashboard_metrics/index.html').includes('analytics.js'));
  assert.ok(output.get('blog/public/index.html').includes('analytics.js'));
  const config = await readFile(new URL('../deployment.js', import.meta.url), 'utf8');
  assert.match(config, /ANALYTICS_ENDPOINT = '(?:https:\/\/metrics\.nishad\.ai\/collect)?'/);
  assert.match(config, /PRIVATE_DASHBOARD_ORIGIN = '(?:https:\/\/private\.nishad\.ai)?'/);
});
