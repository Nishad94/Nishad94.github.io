import test from 'node:test';
import assert from 'node:assert/strict';
import { handle } from '../worker/ai-proxy.js';
const msgs=[{role:'user',content:'Reply exactly OK'}];
const req=(o={})=>new Request('https://w/',{method:o.method||'POST',headers:{Origin:o.origin??'https://nishad.ai','CF-Connecting-IP':'1.1.1.1','Content-Type':'application/json'},body:o.method==='OPTIONS'?undefined:(o.body??JSON.stringify({mode:'chat',messages:msgs}))});
const env={MAC_UPSTREAM:'https://mac.example',ALLOWED_ORIGIN:'https://nishad.ai'};
test('streams Mac response and forwards no credential',async()=>{let seen;const r=await handle(req(),env,async(u,i)=>{seen={u,i};return new Response('data: {"delta":"OK"}\n\n',{status:200,headers:{'Content-Type':'text/event-stream'}})});assert.equal(r.status,200);assert.match(await r.text(),/OK/);assert.equal(seen.u,'https://mac.example/');assert.equal(seen.i.headers.get('X-Real-IP'),'1.1.1.1')});
test('strict CORS and preflight',async()=>{assert.equal((await handle(req({origin:'https://evil.example'}),env)).status,403);assert.equal((await handle(req({method:'OPTIONS'}),env)).status,204)});
test('validates JSON and size',async()=>{assert.equal((await handle(req({body:'{'}),env)).status,400);assert.equal((await handle(req({body:'x'.repeat(40000)}),env)).status,413)});
test('requires configured Mac upstream',async()=>{assert.equal((await handle(req(),{ALLOWED_ORIGIN:'https://nishad.ai'})).status,503)});
test('transport failure is sanitized',async()=>{const r=await handle(req(),env,async()=>{throw new Error('private')});assert.equal(r.status,502);assert.ok(!(await r.text()).includes('private'))});

const sse = events => new Response(events, { headers: { 'Content-Type': 'text/event-stream' } });
const reportRequest = () => req({ body: JSON.stringify({ messages: msgs }) });
const delta = 'data: {"delta":"{\\"status\\":\\"ok\\"}","finish_reason":null}\n\n';
const terminal = 'data: {"done":true,"finish_reason":"stop"}\n\n';

test('the production omitted-mode request returns a JSON envelope, not chat SSE', async () => {
  let sent;
  const response = await handle(reportRequest(), env, async (_url, init) => {
    sent = JSON.parse(new TextDecoder().decode(init.body));
    return sse(delta + terminal);
  });
  assert.deepEqual(sent, { messages: msgs });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /^application\/json/);
  const envelope = await response.json();
  assert.equal(envelope.finish_reason, 'stop');
  assert.deepEqual(JSON.parse(envelope.content), { status: 'ok' });
});

test('explicit chat keeps the upstream stream and its completion event unchanged', async () => {
  const body = delta + terminal;
  const response = await handle(req(), env, async () => sse(body));
  assert.match(response.headers.get('content-type'), /^text\/event-stream/);
  assert.equal(await response.text(), body);
});

for (const [name, stream, code] of [
  ['EOF after complete-looking JSON', delta, 'upstream_incomplete'],
  ['stop without a terminal event', delta + 'data: {"finish_reason":"stop"}\n\n', 'upstream_incomplete'],
  ['terminal without a finish reason', delta + 'data: {"done":true}\n\n', 'upstream_incomplete'],
  ['malformed event', delta + 'data: {broken}\n\n' + terminal, 'upstream_invalid_response'],
  ['upstream error event', delta + 'data: {"error":"private model failure"}\n\n', 'upstream_failed'],
  ['empty completed report', terminal, 'upstream_incomplete']
]) {
  test('report rejects ' + name + ' instead of fabricating completion', async () => {
    const response = await handle(reportRequest(), env, async () => sse(stream));
    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), { error: code });
  });
}

test('report preserves a genuine length termination for the frontend to reject', async () => {
  const response = await handle(reportRequest(), env, async () => sse(delta + 'data: {"done":true,"finish_reason":"length"}\n\n'));
  assert.equal((await response.json()).finish_reason, 'length');
});

test('report supports split UTF-8, CRLF, and SSE keepalive comments', async () => {
  const bytes = new TextEncoder().encode(': keepalive\r\n\r\ndata: {"delta":"{\\"status\\":\\"café\\"}"}\r\n\r\n' +
    'data: {"done":true,"finish_reason":"stop"}\r\n\r\n');
  const stream = new ReadableStream({
    start(controller) {
      for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
      controller.close();
    }
  });
  const response = await handle(reportRequest(), env, async () => sse(stream));
  assert.deepEqual(JSON.parse((await response.json()).content), { status: 'café' });
});

test('interrupted response bodies become an explicit sanitized report failure', async () => {
  const stream = new ReadableStream({
    start(controller) { controller.error(new Error('private socket detail')); }
  });
  const response = await handle(reportRequest(), env, async () => sse(stream));
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { error: 'upstream_incomplete' });
});

test('report rejects a successful HTML tunnel response', async () => {
  const response = await handle(reportRequest(), env, async () => new Response('<h1>Tunnel unavailable</h1>', {
    headers: { 'Content-Type': 'text/html' }
  }));
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { error: 'upstream_invalid_response' });
});

test('busy responses retain their status and retry guidance', async () => {
  const response = await handle(reportRequest(), env, async () => Response.json({ error: 'busy' }, {
    status: 503, headers: { 'Retry-After': '15' }
  }));
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('retry-after'), '15');
  assert.deepEqual(await response.json(), { error: 'busy' });
});

test('origin lists match individual origins, not comma-joined headers', async () => {
  const configured = { ...env, ALLOWED_ORIGIN: 'https://nishad.ai, https://preview.example' };
  const preflight = await handle(req({ method: 'OPTIONS', origin: 'https://preview.example' }), configured);
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), 'https://preview.example');
  const denied = await handle(req({ origin: 'https://evil.example' }), configured);
  assert.equal(denied.status, 403);
  assert.equal(denied.headers.get('access-control-allow-origin'), null);
});

test('client cancellation reaches the upstream fetch', async () => {
  const controller = new AbortController();
  const request = new Request(reportRequest(), { signal: controller.signal });
  let upstreamSignal;
  const result = handle(request, env, async (_url, init) => {
    upstreamSignal = init.signal;
    controller.abort();
    throw new DOMException('cancelled', 'AbortError');
  });
  const response = await result;
  assert.equal(upstreamSignal?.aborted, true);
  assert.equal(response.status, 499);
  assert.deepEqual(await response.json(), { error: 'request_cancelled' });
});
