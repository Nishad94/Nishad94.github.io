import test from 'node:test';
import assert from 'node:assert/strict';
import { handle, resetMemory } from '../worker/ai-proxy.js';

const msgs = [{ role: 'system', content: 's' }, { role: 'user', content: 'u' }];
const req = (o = {}) => new Request('https://w/', {
  method: o.method || 'POST',
  headers: { Origin: o.origin ?? 'https://nishad.ai', 'CF-Connecting-IP': o.ip || '1.1.1.1', 'Content-Type': 'application/json' },
  body: o.method === 'OPTIONS' ? undefined : (o.body ?? JSON.stringify({ messages: msgs }))
});
const ok = async () => new Response(JSON.stringify({ choices: [{ message: { content: '{"a":1}' }, finish_reason: 'stop' }] }));
const env = (x = {}) => ({ OPENAI_API_KEY: 'sk-test-fake', ...x });

test('proxies and never leaks the key', async () => {
  let seen;
  const r = await handle(req(), env(), async (u, i) => { seen = i; return ok(); });
  assert.equal(r.status, 200);
  const text = await r.text();
  assert.ok(!text.includes('sk-test-fake'));
  assert.equal(JSON.parse(text).content, '{"a":1}');
  assert.equal(JSON.parse(seen.body).model, 'gpt-4o');
});
test('rejects bad origin, preflight ok for allowed', async () => {
  assert.equal((await handle(req({ origin: 'https://evil.example' }), env(), ok)).status, 403);
  assert.equal((await handle(req({ origin: '' }), env(), ok)).status, 403);
  assert.equal((await handle(req({ method: 'OPTIONS' }), env(), ok)).status, 204);
});
test('validates body and size', async () => {
  assert.equal((await handle(req({ body: '{' }), env(), ok)).status, 400);
  assert.equal((await handle(req({ body: JSON.stringify({ messages: [{ role: 'assistant', content: 'x' }] }) }), env(), ok)).status, 400);
  assert.equal((await handle(req({ body: 'x'.repeat(40000) }), env(), ok)).status, 413);
});
test('unconfigured key gives 503', async () => {
  assert.equal((await handle(req(), {}, ok)).status, 503);
});
test('per-visitor and global limits', async () => {
  resetMemory();
  const e = env({ PER_IP_DAILY: '1', GLOBAL_DAILY: '2' });
  assert.equal((await handle(req({ ip: '9.9.9.1' }), e, ok)).status, 200);
  assert.equal((await handle(req({ ip: '9.9.9.1' }), e, ok)).status, 429);
  assert.equal((await handle(req({ ip: '9.9.9.2' }), e, ok)).status, 200);
  const r = await handle(req({ ip: '9.9.9.3' }), e, ok);
  assert.equal(r.status, 429);
  assert.equal((await r.json()).error, 'global_limit');
});
test('upstream failure is surfaced without detail', async () => {
  const r = await handle(req({ ip: '7.7.7.7' }), env(), async () => new Response('secret detail', { status: 500 }));
  assert.equal(r.status, 502);
  assert.ok(!(await r.text()).includes('secret'));
});
