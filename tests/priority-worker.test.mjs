import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { handle, resetMemory } from '../inference/priority-worker.js';

const env = {
  LAPTOP_UPSTREAM: 'https://laptop.example', MAC_UPSTREAM: 'https://mac.example',
  LAPTOP_GATEWAY_TOKEN: 'synthetic-laptop', MAC_GATEWAY_TOKEN: 'synthetic-mac'
};
const messages = [{ role: 'user', content: 'Synthetic fixture only.' }];
const request = (mode = 'chat', options = {}) => new Request('https://worker.example/', {
  method: 'POST', headers: { Origin: 'https://nishad.ai', 'Content-Type': 'application/json', Authorization: 'Bearer untrusted' },
  body: JSON.stringify({ messages, ...(mode ? { mode } : {}) }), ...options
});
const stream = 'data: {"delta":"OK"}\n\ndata: {"done":true,"finish_reason":"stop"}\n\n';
const success = () => new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } });
const ready = () => Response.json({ status: 'ok' });
beforeEach(resetMemory);

test('healthy laptop has priority, uses its secret, and preserves chat stream', async () => {
  const calls = [];
  const response = await handle(request(), env, async (url, init) => {
    calls.push(url);
    assert.equal(init.headers.get('Authorization'), 'Bearer synthetic-laptop');
    return url.endsWith('/healthz') ? ready() : success();
  });
  assert.deepEqual(calls, ['https://laptop.example/healthz', 'https://laptop.example/']);
  assert.equal(await response.text(), stream);
});

test('offline laptop falls back before POST; cooldown expires and priority recovers', async () => {
  let time = 1000, offline = true;
  const calls = [];
  const fetcher = async (url, init) => {
    calls.push(url);
    if (url.startsWith(env.LAPTOP_UPSTREAM) && offline) throw new Error('private');
    if (url.startsWith(env.MAC_UPSTREAM)) assert.equal(init.headers.get('Authorization'), 'Bearer synthetic-mac');
    return url.endsWith('/healthz') ? ready() : success();
  };
  assert.equal((await handle(request(), env, fetcher, () => time)).status, 200);
  assert.deepEqual(calls, ['https://laptop.example/healthz', 'https://mac.example/healthz', 'https://mac.example/']);
  calls.length = 0;
  offline = false;
  await handle(request(), env, fetcher, () => time);
  assert.deepEqual(calls, ['https://mac.example/healthz', 'https://mac.example/']);
  time += 30001;
  calls.length = 0;
  await handle(request(), env, fetcher, () => time);
  assert.deepEqual(calls, ['https://laptop.example/healthz', 'https://laptop.example/']);
});

test('explicit busy rejection retries Mac without mixing answers', async () => {
  const calls = [];
  const response = await handle(request(), env, async url => {
    calls.push(url);
    if (url.endsWith('/healthz')) return ready();
    if (url.startsWith(env.LAPTOP_UPSTREAM)) return Response.json({ error: 'busy' }, { status: 503 });
    return success();
  });

  assert.equal(await response.text(), stream);
  assert.equal(calls.length, 4);
});

test('accepted queued requests stay on laptop and full queues never fail over', async () => {
  for (const full of [false, true]) {
    resetMemory();
    const calls = [];
    const response = await handle(request(), env, async url => {
      calls.push(url);
      if (url.endsWith('/healthz')) return ready();
      return full ? Response.json({ error: 'queue_full' }, { status: 429, headers: { 'Retry-After': '15' } })
        : new Response('data: {"queued":true}\n\n: queued\n\n' + stream, { headers: { 'Content-Type': 'text/event-stream' } });
    });
    assert.equal(response.status, full ? 429 : 200);
    if (full) {
      assert.equal(response.headers.get('retry-after'), '15');
      assert.deepEqual(await response.json(), { error: 'queue_full' });
    } else {
      assert.match(await response.text(), /queued/);
    }
    assert.deepEqual(calls, [env.LAPTOP_UPSTREAM + '/healthz', env.LAPTOP_UPSTREAM + '/']);
  }
});

test('reports stay Mac-only unless explicitly enabled', async () => {
  for (const enabled of [false, true]) {
    resetMemory();
    const calls = [];
    const response = await handle(request(null), { ...env, LAPTOP_REPORTS: String(enabled) }, async url => {
      calls.push(url);
      return url.endsWith('/healthz') ? ready() : success();
    });
    assert.deepEqual(await response.json(), { content: 'OK', finish_reason: 'stop' });
    assert.equal(calls[0], (enabled ? env.LAPTOP_UPSTREAM : env.MAC_UPSTREAM) + '/healthz');
  }
});

test('no retry on quota, authorization, timeout, or ambiguous POST transport failure', async () => {
  for (const status of [401, 403, 429, 502, 504]) {
    resetMemory();
    const calls = [];
    const response = await handle(request(), env, async url => {
      calls.push(url);
      return url.endsWith('/healthz') ? ready() : Response.json({ error: 'synthetic' }, { status });
    });
    assert.equal(response.status, status);
    assert.equal(calls.length, 2);
  }
  resetMemory();
  const calls = [];
  const response = await handle(request(), env, async url => {
    calls.push(url);
    if (url.endsWith('/healthz')) return ready();
    throw new Error('private transport failure after sending POST');
  });
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { error: 'upstream_incomplete' });
  assert.equal(calls.length, 2);
});

test('stream failure after response selection never tries a second backend', async () => {
  const calls = [];
  const response = await handle(request(), env, async url => {
    calls.push(url);
    if (url.endsWith('/healthz')) return ready();
    return new Response(new ReadableStream({
      start(controller) { controller.error(new Error('private stream failure')); }
    }), { headers: { 'Content-Type': 'text/event-stream' } });
  });
  await assert.rejects(response.text());
  assert.equal(calls.length, 2);
});

test('all offline, unconfigured, and invalid routes fail explicitly without private data', async () => {
  const response = await handle(request(), env, async () => { throw new Error('private hostname'); });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: 'upstream_unreachable' });
  assert.equal((await handle(request(), {}, async () => assert.fail('unexpected fetch'))).status, 503);
  for (const url of ['http://unsafe.example', 'https://user:password@host.example', 'https://host.example/private']) {
    const result = await handle(request(), { LAPTOP_UPSTREAM: url }, async () => assert.fail('unexpected fetch'));
    assert.deepEqual(await result.json(), { error: 'invalid_upstream_configuration' });
  }
});

test('invalid input and denied origins never contact a backend', async () => {
  for (const req of [request('chat', { headers: { Origin: 'https://evil.example' } }), request('chat', { body: '{' })]) {
    const response = await handle(req, env, async () => assert.fail('unexpected fetch'));
    assert.ok([400, 403].includes(response.status));
  }
});

test('cancelled caller is not retried', async () => {
  const controller = new AbortController();
  let calls = 0;
  const response = await handle(request('chat', { signal: controller.signal }), env, async () => {
    calls++;
    controller.abort();
    throw new DOMException('cancelled', 'AbortError');
  });
  assert.equal(response.status, 499);
  assert.equal(calls, 1);
});

test('invalid health responses skip generation and try the next backend', async () => {
  for (const health of [
    () => new Response('<html>tunnel unavailable</html>'),
    () => Response.json({ status: 'loading' }),
    () => Response.json({ error: 'unauthorized' }, { status: 401 })
  ]) {
    resetMemory();
    const calls = [];
    const response = await handle(request(), env, async url => {
      calls.push(url);
      if (url === env.LAPTOP_UPSTREAM + '/healthz') return health();
      return url.endsWith('/healthz') ? ready() : success();
    });
    assert.equal(await response.text(), stream);
    assert.deepEqual(calls, [env.LAPTOP_UPSTREAM + '/healthz', env.MAC_UPSTREAM + '/healthz', env.MAC_UPSTREAM + '/']);
  }
});

test('all busy gateways retain explicit retry guidance', async () => {
  const response = await handle(request(), env, async url => url.endsWith('/healthz')
    ? ready() : Response.json({ error: 'busy' }, { status: 503, headers: { 'Retry-After': '15' } }));
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('retry-after'), '15');
  assert.deepEqual(await response.json(), { error: 'busy' });
});

test('slow readiness times out before any laptop generation and uses Mac', async () => {
  const calls = [];
  const response = await handle(request(), env, async (url, init) => {
    calls.push(url);
    if (url.startsWith(env.LAPTOP_UPSTREAM)) {
      return new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(new DOMException('timeout', 'AbortError')), { once: true });
      });
    }
    return url.endsWith('/healthz') ? ready() : success();
  });
  assert.equal(await response.text(), stream);
  assert.deepEqual(calls, [env.LAPTOP_UPSTREAM + '/healthz', env.MAC_UPSTREAM + '/healthz', env.MAC_UPSTREAM + '/']);
});

test('header timeout cancels the POST without starting Mac inference', async () => {
  const calls = [];
  let postSignal;
  const response = await handle(request(), env, async (url, init) => {
    calls.push(url);
    if (url.endsWith('/healthz')) return ready();
    postSignal = init.signal;
    return new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(new DOMException('timeout', 'AbortError')), { once: true });
    });
  });
  assert.equal(response.status, 504);
  assert.equal(postSignal.aborted, true);
  assert.deepEqual(await response.json(), { error: 'upstream_timeout' });
  assert.deepEqual(calls, [env.LAPTOP_UPSTREAM + '/healthz', env.LAPTOP_UPSTREAM + '/']);
});
