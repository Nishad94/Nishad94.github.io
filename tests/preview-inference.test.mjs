import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createPreviewServer } from '../scripts/preview-inference.mjs';
import { metricsFixture } from './inference-metrics-fixture.mjs';

test('local preview keeps private tokens server-side and proxies only loopback chat/metrics', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'nishad-preview-'));
  const root = join(directory, 'site');
  const runtime = join(directory, 'runtime');
  await mkdir(root);
  await mkdir(runtime);
  await writeFile(join(root, 'index.html'), '<h1>Local fixture</h1>');
  await writeFile(join(root, '404.html'), '<h1>Not found</h1>');
  await writeFile(join(runtime, 'private-settings.json'), JSON.stringify({ GatewayToken: 'synthetic-private-token' }));
  const calls = [];
  const server = createPreviewServer({ root, runtime, fetchImpl: async (url, init) => {
    calls.push(url);
    assert.equal(init.headers.Authorization, 'Bearer synthetic-private-token');
    assert.equal(init.headers.Origin, 'https://nishad.ai');
    if (url.endsWith('/metrics')) {
      const data = metricsFixture();
      data.private = 'must not leak';
      return Response.json(data);
    }
    return new Response('data: {"delta":"LOCAL_OK"}\n\ndata: {"done":true,"finish_reason":"stop"}\n\n', {
      headers: { 'Content-Type': 'text/event-stream' }
    });
  } });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await fetch(origin + '/')).status, 200);
    const config = await (await fetch(origin + '/deployment.js')).text();
    assert.match(config, /__local\/chat/);
    assert.doesNotMatch(config, /synthetic-private-token|workers\.dev/);
    const metrics = await fetch(origin + '/__local/metrics');
    assert.equal(metrics.status, 200);
    assert.doesNotMatch(await metrics.text(), /must not leak/);
    const chat = await fetch(origin + '/__local/chat', {
      method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'chat', messages: [{ role: 'user', content: 'synthetic' }] })
    });
    assert.equal(chat.status, 200);
    assert.match(await chat.text(), /LOCAL_OK/);
    const rejected = await fetch(origin + '/__local/chat', {
      method: 'POST', headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json' },
      body: '{}'
    });
    assert.equal(rejected.status, 403);
    const report = await fetch(origin + '/__local/chat', {
      method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [] })
    });
    assert.equal(report.status, 400);
    assert.equal((await fetch(origin + '/private-settings.json')).status, 404);
    assert.equal((await fetch(origin + '/%2e%2e%5cprivate-settings.json')).status, 400);
    assert.deepEqual(calls, ['http://127.0.0.1:8094/metrics', 'http://127.0.0.1:8094/']);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});
