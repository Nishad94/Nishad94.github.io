import test from 'node:test';
import assert from 'node:assert/strict';
import { metricsFixture } from './inference-metrics-fixture.mjs';
import { publicMetrics } from '../assets/inference-metrics-contract.js';
import { handle } from '../inference/priority-worker.js';

const env = { LAPTOP_UPSTREAM: 'https://laptop.example', LAPTOP_GATEWAY_TOKEN: 'synthetic-token' };
const request = (origin = 'https://nishad.ai') => new Request('https://worker.example/metrics', { headers: origin ? { Origin: origin } : {} });

test('public metrics strips all unapproved fields, services, and workflow identities', () => {
  const data = metricsFixture();
  data.prompt = 'private prompt';
  data.host.address = 'private address';
  data.inference.counts.ip = 'private identity';
  data.services['private service name'] = { up: true };
  data.workflows.personal_workflow = { label: 'private' };
  data.history[0].filename = 'private filename';
  const sanitized = publicMetrics(data);
  assert.doesNotMatch(JSON.stringify(sanitized), /private|address|filename/);
  assert.equal(Object.hasOwn(sanitized, 'prompt'), false);
  assert.deepEqual(sanitized.workflows, {});
  assert.equal(sanitized.host.gpu_pct, null);
});

test('malformed, oversized and nonfinite metrics fail instead of inventing values', () => {
  for (const change of [
    data => { data.host.cpu_pct = 101; },
    data => { data.inference.counts.requests = '4'; },
    data => { data.inference.latency.duration_ms.p95 = Infinity; },
    data => { data.generated_at = '<script>'; },
    data => { data.history = Array(289).fill(data.history[0]); },
    data => { data.inference.queue.waiting = 11; }
  ]) {
    const data = metricsFixture();
    change(data);
    assert.throws(() => publicMetrics(data));
  }
});

test('public metrics GET contacts only the laptop using its private secret', async () => {
  const data = metricsFixture();
  data.secret = 'must not leak';
  const response = await handle(request(), env, async (url, init) => {
    assert.equal(url, 'https://laptop.example/metrics');
    assert.equal(init.headers.Authorization, 'Bearer synthetic-token');
    assert.equal(init.method, undefined);
    assert.equal(init.redirect, 'manual');
    return Response.json(data);
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), 'https://nishad.ai');
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.doesNotMatch(await response.text(), /must not leak/);
});

test('public metrics use the authenticated Mac gateway when no laptop is configured', async () => {
  const macEnv = { MAC_UPSTREAM: 'https://mac.example', MAC_GATEWAY_TOKEN: 'synthetic-mac-token' };
  const response = await handle(request(), macEnv, async (url, init) => {
    assert.equal(url, 'https://mac.example/metrics');
    assert.match(init.headers.Authorization, /^Bearer /);
    assert.equal(init.redirect, 'manual');
    return Response.json(metricsFixture());
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).schema, 'nishad.inference-operations.v1');
});

test('metrics can be read without an Origin but cannot be scraped through an unapproved browser origin', async () => {
  const anonymous = await handle(request(null), env, async () => Response.json(metricsFixture()));
  assert.equal(anonymous.status, 200);
  const denied = await handle(request('https://evil.example'), env, async () => assert.fail('unexpected backend request'));
  assert.equal(denied.status, 403);
});

test('missing configuration, offline laptop, and invalid snapshots are explicitly unavailable', async () => {
  const missing = await handle(request(), {}, async () => assert.fail('unexpected fetch'));
  assert.equal(missing.status, 503);
  for (const fetcher of [
    async () => { throw new Error('private host failure'); },
    async () => Response.json({ private: 'secret' }),
    async () => new Response('x'.repeat(131073)),
    async () => Response.json({ error: 'private' }, { status: 401 })
  ]) {
    const response = await handle(request(), env, fetcher);
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: 'metrics_unavailable' });
  }
});
