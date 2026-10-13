import test from 'node:test';
import assert from 'node:assert/strict';
import { ARCHITECTURE_RECEIPTS, buildChatSystemPrompt, buildSystemPrompt, TECHNICAL_BRIEF } from '../ontology.js';

test('technical brief is deterministic, factual and connected to technical receipts', () => {
  assert.match(TECHNICAL_BRIEF, /Carnegie Mellon/);
  assert.match(TECHNICAL_BRIEF, /NISHAD DAWKHAR \/\/ BUILDER NOTES/);
  assert.match(TECHNICAL_BRIEF, /Twitter Kafka platform -> Microsoft Azure Edge/);
  assert.match(TECHNICAL_BRIEF, /Gemma 4\/Ollama gateway, WebGPU fallback, Go\/Postgres analytics/);
  assert.match(TECHNICAL_BRIEF, /Type 'projects'/);
  assert.equal(ARCHITECTURE_RECEIPTS.length, 5);
  assert.ok(ARCHITECTURE_RECEIPTS.every(receipt => typeof receipt === 'string' && receipt.length > 20));
});

test('system prompt gives concise investor guidance without inventing traction', () => {
  const prompt = buildSystemPrompt();
  assert.match(prompt, /questions about investment, YC, founder potential/);
  assert.match(prompt, /4-6 concise evidence-based bullets/);
  assert.match(prompt, /Never invent startup traction, fundraising, user counts, revenue, or a founder title/);
  assert.match(prompt, /CURRENT SITE ARCHITECTURE RECEIPTS/);
});

test('latency-sensitive chat prompt keeps core evidence in a smaller context', () => {
  const prompt = buildChatSystemPrompt();
  assert.ok(prompt.length < 3500, `chat prompt is ${prompt.length} characters`);
  assert.match(prompt, /Kafka Observer/);
  assert.match(prompt, /per-broker-per-tenant rate limiting/);
  assert.match(prompt, /Azure Edge/);
  assert.match(prompt, /Default to 40-70 words/);
  assert.match(prompt, /return exactly N in the requested order/);
  assert.match(prompt, /Never invent startup traction, revenue, funding, user counts/);
});

test('chat prompt includes only query-relevant supporting evidence', () => {
  const twitter = buildChatSystemPrompt('Compare Kafka tenant controls and Azure Edge');
  assert.match(twitter, /Lecida/);
  assert.doesNotMatch(twitter, /Autodesk Fusion 360/);
  const site = buildChatSystemPrompt('How is nishad.ai built?');
  assert.match(site, /Go\/PostgreSQL analytics/);
  assert.doesNotMatch(site, /Cisco Webex/);
  const generic = buildChatSystemPrompt('What revenue is documented?');
  assert.ok(generic.length < 1800, `generic prompt is ${generic.length} characters`);
});
