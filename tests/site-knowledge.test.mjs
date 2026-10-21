import test from 'node:test';
import assert from 'node:assert/strict';
import { createSiteKnowledge, parseRoutingPlan, validateKnowledgeIndex } from '../assets/site-knowledge.js';
import { parsePost, renderBlog } from '../scripts/build-site.mjs';
import { source } from './blog-fixture.mjs';

const plan = (ids = [], intent = 'answer', webQuery = '') => JSON.stringify({
  needs_site_data: ids.length > 0,
  source_ids: ids,
  intent,
  web_search: Boolean(webQuery),
  web_query: webQuery
});
const index = {
  schema: 'nishad.public-knowledge.v1', documents: [{
    id: 'blog-0', title: 'An opaque synthetic title', description: 'Synthetic public reference.',
    url: '/blog/synthetic-reference/',
    sections: Array.from({ length: 4 }, (_, i) => ({
      id: `p${i}`, title: `Section ${i}`, summary: `Synthetic reference ${i}`, text: `EVIDENCE_${i} ` + 'x'.repeat(780)
    }))
  }]
};
const fetchImpl = async () => Response.json(index);

test('model selects semantic sources and passages with no keyword or lexical filter', async () => {
  const stages = [];
  const calls = [];
  const result = await createSiteKnowledge({ fetchImpl }).prepare('Explain the unusual orange mechanism.', async messages => {
    calls.push(messages);
    return plan(calls.length === 1 ? ['blog-0'] : ['blog-0/p2']);
  }, stage => stages.push(stage));
  assert.equal(calls.length, 2);
  assert.match(calls[0][0].content, /Choose by meaning, not literal word matching/);
  assert.match(result.systemPrompt, /EVIDENCE_2/);
  assert.doesNotMatch(result.systemPrompt, /EVIDENCE_[013]/);
  assert.deepEqual(result.sources, [{ title: 'An opaque synthetic title', url: '/blog/synthetic-reference/' }]);
  assert.equal(stages.length, 2);
});

test('the model can choose no additional data for general queries', async () => {
  let calls = 0;
  const result = await createSiteKnowledge({ fetchImpl }).prepare('Explain gravity.', async () => { calls++; return plan(); });
  assert.equal(calls, 1);
  assert.equal(result.sources.length, 0);
  assert.match(result.systemPrompt, /No additional public passages were selected/);
});

test('routing plans cannot introduce unknown IDs, URLs, oversized selections or malformed JSON', () => {
  for (const invalid of [
    'not JSON', plan(['https://private.example/']), plan(['a', 'a']),
    plan(['a', 'b', 'c', 'd']),
    '{"needs_site_data":false,"source_ids":[],"intent":"career_scenarios"}',
    '{"needs_site_data":true,"source_ids":[],"intent":"career_scenarios"}'
  ]) assert.throws(() => parseRoutingPlan(invalid, new Set(['a', 'b', 'c', 'd'])));
});

test('routing derives the redundant needs_site_data flag from validated source IDs', () => {
  assert.deepEqual(
    parseRoutingPlan('{"needs_site_data":false,"source_ids":["a"],"intent":"answer"}', new Set(['a'])),
    { needs_site_data: true, source_ids: ['a'], intent: 'answer', web_search: false, web_query: '' }
  );
  assert.deepEqual(
    parseRoutingPlan('{"needs_site_data":true,"source_ids":[],"intent":"answer"}', new Set(['a'])),
    { needs_site_data: false, source_ids: [], intent: 'answer', web_search: false, web_query: '' }
  );
});

test('routing can request one bounded general-purpose web search', async () => {
  let routingPrompt = '';
  const result = await createSiteKnowledge({ fetchImpl }).prepare(
    'What changed recently in llama.cpp prompt caching?',
    async messages => {
      routingPrompt = messages[0].content;
      return plan(['site'], 'answer', 'recent llama.cpp prompt caching changes');
    }
  );
  assert.match(routingPrompt, /Mandatory freshness rule/);
  assert.equal(result.web_search, true);
  assert.equal(result.web_query, 'recent llama.cpp prompt caching changes');
  assert.match(result.systemPrompt, /LOCAL KNOWLEDGE ONLY/);
  assert.match(result.systemPrompt, /do not state a requested latest, current, recent/);
  assert.throws(() => parseRoutingPlan(
    JSON.stringify({ needs_site_data: false, source_ids: [], intent: 'answer', web_search: true, web_query: 'x' }),
    new Set()
  ));
});

test('buildless pages explicitly disclose an unavailable article index; malformed sources fail', async () => {
  const bare = await createSiteKnowledge({ fetchImpl: async () => new Response('', { status: 404 }) })
    .prepare('Question', async () => plan());
  assert.match(bare.notice, /index is unavailable/);
  assert.match(bare.systemPrompt, /complete documented employment/);
  await assert.rejects(createSiteKnowledge({ fetchImpl: async () => new Response('', { status: 503 }) })
    .prepare('Question', async () => plan()), /knowledge is unavailable/);
  assert.throws(() => validateKnowledgeIndex({ ...index, documents: [{ ...index.documents[0], url: 'https://private.example/' }] }));
  const invalid = structuredClone(index);
  invalid.documents[0].sections[0].text = 'x'.repeat(901);
  assert.throws(() => validateKnowledgeIndex(invalid));
});

test('published knowledge excludes drafts and every published passage has a stable public source', () => {
  const published = parsePost(source({}, '## Public evidence\nVisible fact.'), 'published-example.md');
  const draft = parsePost(source({ draft: true }, 'SECRET_DRAFT_MARKER'), 'private-draft.md');
  const raw = renderBlog([published, draft]).get('site-knowledge.json');
  assert.doesNotMatch(raw, /SECRET_DRAFT_MARKER|private-draft/);
  const data = validateKnowledgeIndex(JSON.parse(raw));
  assert.equal(data.length, 1);
  assert.equal(data[0].url, '/blog/published-example/');
  assert.ok(data[0].sections.some(section => section.text.includes('Visible fact.')));
});

test('semantic intent enables scenario guidance without a keyword trigger', async () => {
  const result = await createSiteKnowledge({ fetchImpl }).prepare('What doors might his background open?', async messages =>
    plan(messages[0].content.includes('these public passages') ? ['career/p0'] : ['career'], 'career_scenarios'));
  assert.equal(result.intent, 'career_scenarios');
  assert.match(result.systemPrompt, /Scenarios, not predictions/);
});

test('conversation context influences routing without contaminating query-specific prompt evidence', async () => {
  let routedQuery = '';
  const result = await createSiteKnowledge({ fetchImpl }).prepare(
    'Which documented employers came after Twitter?',
    async (messages, schema) => {
      routedQuery = messages[1].content;
      const ids = schema.properties.source_ids.items.enum;
      return plan(ids.includes('career') ? ['career'] : [ids[0]]);
    },
    () => {},
    { routingQuery: 'Earlier: Which employer came immediately after Twitter? Current: Which documented employers came after Twitter?' }
  );
  assert.match(routedQuery, /immediately after Twitter/);
  assert.match(result.systemPrompt, /All documented employers after Twitter: Cisco .*; Microsoft /);
  assert.doesNotMatch(result.systemPrompt, /Immediately after Twitter: Cisco/);
});
