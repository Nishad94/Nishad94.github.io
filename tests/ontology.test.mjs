import test from 'node:test';
import assert from 'node:assert/strict';
import { ARCHITECTURE_RECEIPTS, buildSystemPrompt, VC_DOSSIER } from '../ontology.js';

test('VC dossier is deterministic, factual and connected to technical receipts', () => {
  assert.match(VC_DOSSIER, /Carnegie Mellon/);
  assert.match(VC_DOSSIER, /Twitter Kafka platform -> Microsoft Azure Edge/);
  assert.match(VC_DOSSIER, /Gemma 4\/Ollama gateway, WebGPU fallback, Go\/Postgres analytics/);
  assert.match(VC_DOSSIER, /Type 'projects'/);
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
