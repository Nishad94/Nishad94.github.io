import test from 'node:test';
import assert from 'node:assert/strict';
import { readChatStream } from '../assets/chat-stream.js';

const delta = 'data: {"delta":"café"}\r\n\r\n';
const terminal = 'data: {"done":true,"finish_reason":"stop"}\r\n\r\n';

test('chat handles split UTF-8, CRLF and keepalives with genuine completion', async () => {
  let content = '';
  const bytes = new TextEncoder().encode(': keepalive\r\n\r\n' + delta + terminal);
  const body = new ReadableStream({
    start(controller) {
      for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
      controller.close();
    }
  });
  assert.deepEqual(await readChatStream(body, value => { content += value; }), { content: 'café', finishReason: 'stop' });
  assert.equal(content, 'café');
});

for (const ending of [
  '', 'data: {"done":true}\n\n', 'data: {"finish_reason":"stop"}\n\n',
  'data: {"error":"private"}\n\n', 'data: {broken}\n\n',
  'data: {"delta":42}\n\n', 'data: {"done":true,"finish_reason":"tool_calls"}\n\n'
]) {
  test('chat rejects unconfirmed or malformed completion: ' + ending, async () => {
    const body = new Response(delta + ending).body;
    await assert.rejects(readChatStream(body, () => {}));
  });
}

test('chat preserves output-limit completion', async () => {
  const body = new Response(delta + terminal.replace('"stop"', '"length"')).body;
  assert.equal((await readChatStream(body, () => {})).finishReason, 'length');
});

test('chat cancels an invalid stream and releases its reader', async () => {
  let cancelled = false;
  const body = new ReadableStream({
    start(controller) { controller.enqueue(new TextEncoder().encode('data: {broken}\n\n')); },
    cancel() { cancelled = true; }
  });
  await assert.rejects(readChatStream(body, () => {}));
  assert.equal(cancelled, true);
  assert.equal(body.locked, false);
});
