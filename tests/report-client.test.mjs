import test from 'node:test';
import assert from 'node:assert/strict';
import { requestReport } from '../report-client.js';
import { handle } from '../worker/ai-proxy.js';
import { reportMessages, topReportData, validateReport } from '../spotify-ui.js';
import { syntheticSpotifySample } from '../assets/spotify-synthetic.js';

const messages = [{ role: 'user', content: 'Synthetic diagnostic only.' }];
const options = response => ({ fetchImpl: async () => response });

test('the production parser consumes the Worker report adapter without changing request mode', async () => {
  const stages = [];
  const report = await requestReport('https://worker.example/', messages, {
    onStage: stage => stages.push(stage),
    fetchImpl: async (url, init) => {
      assert.deepEqual(JSON.parse(init.body), { messages });
      assert.equal(init.credentials, 'omit');
      assert.equal(init.referrerPolicy, 'no-referrer');
      const request = new Request(url, { ...init, headers: { ...init.headers, Origin: 'https://nishad.ai' } });
      return handle(request, { MAC_UPSTREAM: 'https://mac.example' }, async () => new Response(
        'data: {"delta":"{\\"status\\":\\"ok\\"}"}\n\ndata: {"done":true,"finish_reason":"stop"}\n\n',
        { headers: { 'Content-Type': 'text/event-stream' } }
      ));
    }
  });
  assert.deepEqual(report, { status: 'ok' });
  assert.deepEqual(stages, ['requesting', 'validating']);
});

test('the deployed raw-SSE regression is rejected explicitly, never accepted as report JSON', async () => {
  await assert.rejects(requestReport('https://worker.example/', messages, options(new Response(
    'data: {"delta":"{\\"status\\":\\"ok\\"}"}\n\ndata: {"done":true,"finish_reason":"stop"}\n\n',
    { headers: { 'Content-Type': 'text/event-stream' } }
  ))), /wrong report format/);
});

test('fenced JSON still needs a genuine successful envelope', async () => {
  assert.deepEqual(await requestReport('https://worker.example/', messages, options(Response.json({
    content: '```json\n{"status":"ok"}\n```', finish_reason: 'stop'
  }))), { status: 'ok' });
});

for (const [name, response, expected] of [
  ['missing completion', { content: '{"status":"ok"}' }, /refused, truncated, or empty/],
  ['length termination', { content: '{"status":"ok"}', finish_reason: 'length' }, /output limit/],
  ['empty content', { content: ' ', finish_reason: 'stop' }, /empty/],
  ['malformed model JSON', { content: '{broken', finish_reason: 'stop' }, /invalid JSON/]
]) {
  test('report client rejects ' + name, async () => {
    await assert.rejects(requestReport('https://worker.example/', messages, options(Response.json(response))), expected);
  });
}

for (const [code, status, expected] of [
  ['busy', 503, /busy with another request/],
  ['mac_unreachable', 502, /unreachable/],
  ['upstream_incomplete', 502, /before confirmed completion/],
  ['upstream_timeout', 504, /service deadline/],
  ['upstream_invalid_response', 502, /malformed response/]
]) {
  test('report client exposes ' + code + ' without backend details or automatic retries', async () => {
    let calls = 0;
    await assert.rejects(requestReport('https://worker.example/', messages, {
      fetchImpl: async () => { calls++; return Response.json({ error: code, detail: 'private' }, { status }); }
    }), expected);
    assert.equal(calls, 1);
  });
}

test('cancellation wins over a late response and network errors remain actionable', async () => {
  const controller = new AbortController();
  await assert.rejects(requestReport('https://worker.example/', messages, {
    signal: controller.signal,
    fetchImpl: async (_url, init) => {
      controller.abort();
      assert.equal(init.signal.aborted, true);
      throw new DOMException('aborted', 'AbortError');
    }
  }), /cancelled/);
  await assert.rejects(requestReport('https://worker.example/', messages, {
    fetchImpl: async () => { throw new TypeError('private network details'); }
  }), /unreachable or timed out/);
});

test('synthetic normal and maximum fixtures use production compaction and prompts without identifiers', () => {
  for (const count of [5, 50]) {
    const sample = syntheticSpotifySample(count);
    const data = topReportData('short', sample.tracks, sample.artists);
    assert.equal(data.artists.length, count);
    assert.equal(data.tracks.length, count);
    const prompt = reportMessages('short', data);
    assert.equal(prompt.length, 2);
    assert.ok(Buffer.byteLength(JSON.stringify({ messages: prompt })) <= 32768);
    assert.doesNotMatch(prompt[1].content, /syntheticArtist|syntheticTrack|accessToken/);
    assert.match(prompt[0].content, /exactly four MBTI axes/);
  }
  assert.throws(() => validateReport({}, 'short'), /incomplete or invalid/);
  assert.throws(() => validateReport({ moods: ['Chill'] }, 'timeline', 2), /incomplete or invalid/);
  assert.throws(() => validateReport({ narration: '' }, 'compare'), /incomplete or invalid/);
});
