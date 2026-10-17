import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { buildChatSystemPrompt } from '../ontology.js';
import { readChatStream } from '../assets/chat-stream.js';

const endpoint = new URL(process.argv[2] || 'http://127.0.0.1:8094/');
if (!['127.0.0.1', '[::1]'].includes(endpoint.hostname) || endpoint.protocol !== 'http:') {
  throw new Error('This benchmark is local-only; use a loopback HTTP gateway.');
}
const fixtures = [
  { name: 'short', query: 'Reply with exactly: LOCAL_INFERENCE_OK', accepts: text => text.trim() === 'LOCAL_INFERENCE_OK' },
  { name: 'grounding', query: 'What is Nishad’s full name? Answer in one short sentence.', accepts: text => /Nishad Dawkhar/i.test(text) },
  { name: 'architecture', query: 'Where is this website hosted? Answer in one short sentence.', accepts: text => /GitHub Pages/i.test(text) },
  { name: 'before-microsoft', query: 'Which employer did Nishad work at immediately before Microsoft, and when?', accepts: text => /Cisco/i.test(text) && /2023/.test(text) },
  { name: 'after-twitter', query: 'Where did Nishad work immediately after Twitter, and in which year?', accepts: text => /Cisco/i.test(text) && /2023/.test(text) },
  { name: 'first-full-time', query: 'What was Nishad’s first full-time job and when did it start? Distinguish it from internships.', accepts: text => /Symantec/i.test(text) && /2016/.test(text) },
  { name: 'year-lookup', query: 'Where was Nishad working in 2017?', accepts: text => /Symantec/i.test(text) },
  { name: 'education-dates', query: 'In which years did Nishad study at Carnegie Mellon?', accepts: text => /2018/.test(text) && /2019/.test(text) },
  {
    name: 'employer-order',
    query: 'List only Nishad’s six documented employer names, including internships, from oldest to newest.',
    accepts: text => {
      const positions = ['Autodesk', 'Symantec', 'Lecida', 'Twitter', 'Cisco', 'Microsoft'].map(name => text.toLowerCase().indexOf(name.toLowerCase()));
      return positions.every((position, index) => position >= 0 && (index === 0 || position > positions[index - 1]));
    }
  },
  { name: 'undocumented-gap', query: 'Which company employed Nishad in October 2023? If the timeline does not document an employer then, reply exactly Not documented.', accepts: text => /^Not documented\.?$/i.test(text.trim()) }
];
let failed = false;
for (const fixture of fixtures) {
  const started = performance.now();
  let firstToken = null;
  const response = await fetch(endpoint, {
    method: 'POST', signal: AbortSignal.timeout(120000),
    headers: {
      Origin: 'https://nishad.ai', 'Content-Type': 'application/json',
      ...(process.env.GATEWAY_TOKEN ? { Authorization: 'Bearer ' + process.env.GATEWAY_TOKEN } : {})
    },
    body: JSON.stringify({
      mode: 'chat', messages: [
        { role: 'system', content: buildChatSystemPrompt(fixture.query) },
        { role: 'user', content: fixture.query }
      ]
    })
  });
  if (!response.ok) throw new Error(`Benchmark ${fixture.name} failed (HTTP ${response.status}).`);
  const result = await readChatStream(response.body, () => {
    if (firstToken === null) firstToken = performance.now() - started;
  });
  const duration = performance.now() - started;
  const accepted = result.finishReason === 'stop' && fixture.accepts(result.content);
  failed ||= !accepted;
  console.log(JSON.stringify({
    fixture: fixture.name, first_token_ms: Math.round(firstToken), total_ms: Math.round(duration),
    finish_reason: result.finishReason, accepted
  }));
  await delay(200);
}
if (failed) throw new Error('One or more local benchmark answers failed acceptance.');
