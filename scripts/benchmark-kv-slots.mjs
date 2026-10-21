import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { createSiteKnowledge } from '../assets/site-knowledge.js';
import { readChatStream } from '../assets/chat-stream.js';

const gateway = new URL(process.argv[2] || 'http://127.0.0.1:8094/');
const llama = new URL(process.argv[3] || 'http://127.0.0.1:8081/');
for (const endpoint of [gateway, llama]) {
  if (endpoint.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(endpoint.hostname)) {
    throw new Error('KV-slot benchmark endpoints must be loopback HTTP URLs.');
  }
}
if (!process.env.GATEWAY_TOKEN) throw new Error('Set GATEWAY_TOKEN without printing it.');

const knowledgeJson = await readFile(new URL('../_site/site-knowledge.json', import.meta.url), 'utf8');
const scenarios = [
  ['identity', 'What is Nishad’s full name? Answer in one short sentence.'],
  ['geography', 'How many years was Nishad in the United States? Answer in one short sentence.'],
  ['career', 'What did Nishad build at Twitter? Answer in one short sentence.'],
  ['education', 'Where and when did Nishad attend Carnegie Mellon? Answer in one short sentence.'],
  ['skills', 'Which programming languages are documented for Nishad? Answer in one short sentence.'],
  ['projects', 'What is Kafka Observer? Answer in one short sentence.'],
  ['site', 'Does Nishad have a blog? Answer in one short sentence.'],
  ['article', 'How does the browser fallback work when the Mac inference host is offline? Answer in one short sentence.'],
  ['chronology', 'Which documented employer came immediately after Twitter? Answer in one short sentence.'],
  ['general', 'Explain a transformer model in one short sentence.']
];
const iterations = 3;

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}
function rounded(value) {
  return Math.round(value * 10) / 10;
}
function improvement(cold, warm) {
  return cold > 0 ? rounded(100 * (cold - warm) / cold) : null;
}
async function replaceSlotCache(id, scenarioIndex) {
  const marker = `CACHE_RESET_${scenarioIndex}_${id}_`;
  const filler = Array.from({ length: 900 }, (_, index) =>
    String.fromCharCode(65 + ((scenarioIndex * 11 + id * 7 + index * 17) % 26))
  ).join('');
  const response = await fetch(new URL('/v1/chat/completions', llama), {
    method: 'POST',
    signal: AbortSignal.timeout(120000),
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id_slot: id,
      messages: [{ role: 'user', content: marker + filler }],
      stream: false,
      temperature: 0,
      max_tokens: 1,
      chat_template_kwargs: { enable_thinking: false }
    })
  });
  if (!response.ok) throw new Error(`Could not replace llama.cpp slot ${id} cache (HTTP ${response.status}).`);
}
async function streamRequest(body, client) {
  const started = performance.now();
  let firstToken = null;
  const response = await fetch(gateway, {
    method: 'POST',
    signal: AbortSignal.timeout(120000),
    headers: {
      Origin: 'https://nishad.ai',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.GATEWAY_TOKEN}`,
      'X-Real-IP': client
    },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Gateway request failed (HTTP ${response.status}): ${error.slice(0, 200)}`);
  }
  const result = await readChatStream(response.body, () => {
    if (firstToken === null) firstToken = performance.now() - started;
  });
  if (result.finishReason !== 'stop') throw new Error(`Unexpected finish reason: ${result.finishReason}`);
  return {
    content: result.content,
    ttft_ms: rounded(firstToken ?? performance.now() - started),
    total_ms: rounded(performance.now() - started)
  };
}
function summarizeRuns(runs) {
  const cold = runs[0];
  const warm = runs.slice(1);
  const warmTtft = median(warm.map(run => run.ttft_ms));
  const warmTotal = median(warm.map(run => run.total_ms));
  return {
    cold_ttft_ms: cold.ttft_ms,
    warm_ttft_ms: warmTtft,
    ttft_improvement_pct: improvement(cold.ttft_ms, warmTtft),
    cold_total_ms: cold.total_ms,
    warm_total_ms: warmTotal,
    total_improvement_pct: improvement(cold.total_ms, warmTotal)
  };
}

const results = [];
for (let scenarioIndex = 0; scenarioIndex < scenarios.length; scenarioIndex++) {
  const [name, query] = scenarios[scenarioIndex];
  await replaceSlotCache(0, scenarioIndex);
  await replaceSlotCache(1, scenarioIndex);
  const routePasses = [];
  const knowledge = createSiteKnowledge({
    fetchImpl: async () => new Response(knowledgeJson, {
      headers: { 'Content-Type': 'application/json' }
    })
  });
  const grounding = await knowledge.prepare(query, async (messages, schema) => {
    const runs = [];
    for (let iteration = 0; iteration < iterations; iteration++) {
      runs.push(await streamRequest({
        mode: 'chat',
        task: 'knowledge_route',
        route_ids: schema.properties.source_ids.items.enum,
        route_limit: schema.properties.source_ids.maxItems,
        messages
      }, `kv-benchmark-${scenarioIndex}-route`));
      await delay(100);
    }
    routePasses.push(runs);
    return runs.at(-1).content;
  });
  const answerMessages = [
    { role: 'system', content: grounding.systemPrompt },
    { role: 'user', content: query }
  ];
  const answerRuns = [];
  for (let iteration = 0; iteration < iterations; iteration++) {
    answerRuns.push(await streamRequest({
      mode: 'chat',
      messages: answerMessages
    }, `kv-benchmark-${scenarioIndex}-answer`));
    await delay(100);
  }
  const routeIterations = Array.from({ length: iterations }, (_, iteration) => ({
    ttft_ms: routePasses.reduce((sum, runs) => sum + runs[iteration].ttft_ms, 0),
    total_ms: routePasses.reduce((sum, runs) => sum + runs[iteration].total_ms, 0)
  }));
  const result = {
    scenario: name,
    query,
    route_passes: routePasses.length,
    routing: summarizeRuns(routeIterations),
    answer: summarizeRuns(answerRuns)
  };
  results.push(result);
  console.log(JSON.stringify({ type: 'scenario', ...result }));
}

for (const phase of ['routing', 'answer']) {
  const coldTtft = median(results.map(result => result[phase].cold_ttft_ms));
  const warmTtft = median(results.map(result => result[phase].warm_ttft_ms));
  const coldTotal = median(results.map(result => result[phase].cold_total_ms));
  const warmTotal = median(results.map(result => result[phase].warm_total_ms));
  console.log(JSON.stringify({
    type: 'summary',
    phase,
    scenarios: results.length,
    cold_ttft_p50_ms: coldTtft,
    warm_ttft_p50_ms: warmTtft,
    ttft_improvement_pct: improvement(coldTtft, warmTtft),
    cold_total_p50_ms: coldTotal,
    warm_total_p50_ms: warmTotal,
    total_improvement_pct: improvement(coldTotal, warmTotal)
  }));
}
