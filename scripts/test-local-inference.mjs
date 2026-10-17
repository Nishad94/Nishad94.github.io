import assert from 'node:assert/strict';
import { readChatStream } from '../assets/chat-stream.js';

const gateway = 'http://127.0.0.1:8094';
const model = 'http://127.0.0.1:8081';
const headers = {
  Origin: 'https://nishad.ai', 'Content-Type': 'application/json',
  ...(process.env.GATEWAY_TOKEN ? { Authorization: 'Bearer ' + process.env.GATEWAY_TOKEN } : {})
};
const pause = () => new Promise(resolve => setTimeout(resolve, 300));
for (const [name, url] of [['model', model + '/health'], ['gateway', gateway + '/healthz']]) {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(5000) });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).status, 'ok');
  console.log(JSON.stringify({ check: name + '_health', status: 200 }));
}

const direct = await fetch(model + '/v1/chat/completions', {
  method: 'POST', signal: AbortSignal.timeout(45000), headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    messages: [{ role: 'user', content: 'Reply exactly MODEL_HTTP_OK' }],
    stream: false, max_tokens: 32, temperature: 0, chat_template_kwargs: { enable_thinking: false }
  })
});
assert.equal(direct.status, 200);
const answer = (await direct.json()).choices[0];
assert.equal(answer.message.content.trim(), 'MODEL_HTTP_OK');
assert.equal(answer.finish_reason, 'stop');
console.log(JSON.stringify({ check: 'model_direct_generation', status: 200, accepted: true }));
await pause();

const response = await fetch(gateway + '/', {
  method: 'POST', headers, signal: AbortSignal.timeout(120000),
  body: JSON.stringify({ mode: 'chat', messages: [{ role: 'user', content: 'Reply exactly GATEWAY_HTTP_OK' }] })
});
assert.equal(response.status, 200);
const streamed = await readChatStream(response.body, () => {});
assert.equal(streamed.content.trim(), 'GATEWAY_HTTP_OK');
assert.equal(streamed.finishReason, 'stop');
console.log(JSON.stringify({ check: 'gateway_stream_generation', status: 200, accepted: true }));
await pause();

const denied = await fetch(gateway + '/', {
  method: 'POST', headers: { ...headers, Origin: 'https://invalid.example' },
  signal: AbortSignal.timeout(5000),
  body: JSON.stringify({ mode: 'chat', messages: [{ role: 'user', content: 'Synthetic denied request.' }] })
});
assert.equal(denied.status, 403);
await denied.arrayBuffer();
console.log(JSON.stringify({ check: 'gateway_denied_origin', status: 403 }));

const started = performance.now();
const burst = await Promise.allSettled(Array.from({ length: 12 }, async (_, index) => {
  const result = await fetch(gateway + '/', {
    method: 'POST', headers, signal: AbortSignal.timeout(120000),
    body: JSON.stringify({ mode: 'chat', messages: [{
      role: 'user',
      content: `Synthetic load test ${index}: Write a numbered list of 150 imaginary planets, each with a one-sentence description. Start immediately and continue the list.`
    }] })
  });
  if (result.status === 429) {
    assert.equal(result.headers.get('retry-after'), '15');
    assert.equal((await result.json()).error, 'queue_full');
    return { status: 429 };
  }
  assert.equal(result.status, 200);
  assert.match(result.headers.get('content-type'), /text\/event-stream/);
  const events = (await result.text()).split(/\r?\n\r?\n/).flatMap(frame =>
    frame.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => JSON.parse(line.slice(5))));
  const error = events.find(event => event.error)?.error;
  const finish = events.find(event => event.done)?.finish_reason;
  assert.ok(error === 'queue_timeout' || ['stop', 'length'].includes(finish));
  return { queued: events.some(event => event.queued === true), error, finish };
}));
const rejected = burst.filter(result => result.status === 'rejected');
assert.equal(rejected.length, 0, `HTTP burst failures: ${rejected.map(result => result.reason.message).join('; ')}`);
const results = burst.map(result => result.value);
const summary = {
  check: '12_simultaneous_gateway_requests', requests: results.length,
  queue_full_429: results.filter(result => result.status === 429).length,
  queued: results.filter(result => result.queued).length,
  completed: results.filter(result => result.finish).length,
  queue_timeouts: results.filter(result => result.error === 'queue_timeout').length,
  duration_ms: Math.round(performance.now() - started)
};
console.log(JSON.stringify(summary));
assert.equal(summary.queue_full_429, 1);
assert.equal(summary.queued, 10);
assert.ok(summary.completed >= 1);
assert.equal(summary.completed + summary.queue_timeouts, 11);
