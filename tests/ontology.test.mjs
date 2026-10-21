import test from 'node:test';
import assert from 'node:assert/strict';
import { ARCHITECTURE_RECEIPTS, CAREER, EDUCATION, LOCATION_HISTORY, buildChatSystemPrompt, buildSystemPrompt, TECHNICAL_BRIEF } from '../ontology.js';

test('technical brief is deterministic, factual and connected to technical receipts', () => {
  assert.match(TECHNICAL_BRIEF, /Carnegie Mellon/);
  assert.match(TECHNICAL_BRIEF, /NISHAD DAWKHAR \/\/ BUILDER NOTES/);
  assert.match(TECHNICAL_BRIEF, /Twitter Kafka platform -> Microsoft Azure Edge/);
  assert.match(TECHNICAL_BRIEF, /Qwen\/llama\.cpp gateway, WebGPU fallback, Go\/Postgres analytics/);
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
  assert.ok(prompt.length < 5000, `chat prompt is ${prompt.length} characters`);
  assert.ok(prompt.length < buildSystemPrompt().length / 2);
  assert.match(prompt, /Kafka Observer/);
  assert.match(prompt, /per-broker-per-tenant rate limiting/);
  assert.match(prompt, /Azure Edge/);
  assert.match(prompt, /Default to 40-70 words/);
  assert.match(prompt, /return exactly N in the requested order/);
  assert.match(prompt, /Never invent startup traction, revenue, funding, user counts/);
});

test('baseline prompt leaves supplemental source selection to the semantic planner', () => {
  const twitter = buildChatSystemPrompt('Compare Kafka tenant controls and Azure Edge');
  assert.match(twitter, /Lecida/);
  assert.doesNotMatch(twitter, /Autodesk Fusion 360/);
  const site = buildChatSystemPrompt('How is nishad.ai built?');
  assert.match(site, /GitHub Pages/);
  assert.doesNotMatch(site, /Dockerized, cloud-deployed Java Spring parser/);
  const generic = buildChatSystemPrompt('What revenue is documented?');
  assert.ok(generic.length < 3800, `generic prompt is ${generic.length} characters`);
});

test('every chat query receives the complete dated career and education timelines', () => {
  for (const query of ['What came before that?', 'What did he do in 2017?', 'When did he graduate?', 'Hello']) {
    const prompt = buildChatSystemPrompt(query);
    for (const role of CAREER) {
      assert.ok(prompt.includes(`${role.dates}: ${role.company} — ${role.title}; ${role.location}.`), `${query}: missing ${role.company}`);
    }
    for (const item of EDUCATION) {
      assert.ok(prompt.includes(`${item.dates}: ${item.school} — ${item.degree}; ${item.location}.`), `${query}: missing ${item.school}`);
    }
    const chronology = prompt.split('Career timeline (complete documented employment, oldest to newest):')[1].split('Education timeline')[0];
    const positions = [...CAREER].reverse().map(role => chronology.indexOf(`: ${role.company} —`));
    assert.deepEqual(positions, [...positions].sort((a, b) => a - b));
    assert.match(prompt, /distinguish the first internship from the first full-time role/);
    assert.match(prompt, /Do not invent work during undocumented gaps/);
    assert.match(prompt, /do not invent graduation months/);
  }
});

test('historical employer locations cannot be replaced by the current profile location', () => {
  const prompt = buildChatSystemPrompt('Where was Nishad while working at Twitter?');
  assert.match(prompt, /Twitter \(March 2020–January 2023\) was in Seattle, Washington, USA, not Bengaluru/);
  assert.match(prompt, /Twitter platform\/messaging in Seattle, Washington/);
  assert.match(prompt, /Twitter — Software Engineer → Software Engineer II; Seattle, WA, USA/);
  assert.match(prompt, /Cisco — Software Developer; San Jose, CA, USA/);
  assert.match(prompt, /Microsoft — Software Engineer II; Bengaluru, India/);
  assert.match(prompt, /Carnegie Mellon University .* Pittsburgh, PA, USA/);
  assert.match(prompt, /Pune Institute of Computer Technology .* Pune, India/);
});

test('country duration uses the residence timeline rather than one employer interval', () => {
  const prompt = buildChatSystemPrompt('How many years was Nishad in the US?');
  assert.equal(LOCATION_HISTORY[1].dates, '2018 – Jan 2024');
  assert.match(prompt, /approximately six calendar years/);
  assert.match(prompt, /2018 – Jan 2024: United States/);
  assert.match(prompt, /relocated from the United States to Bengaluru in January 2024/);
});

test('month-specific grounding uses exact employment boundaries rather than year matches', () => {
  for (const query of ['Where did he work in October 2023?', 'Where did he work in 2023-10?']) {
    assert.match(buildChatSystemPrompt(query), /2023-10: No documented employment covers this month/);
  }
  assert.match(buildChatSystemPrompt('Where did he work in June 2023?'), /2023-06: Cisco \(Apr 2023/);
  assert.match(buildChatSystemPrompt('Where did he work in May 2024?'), /2024-05: Microsoft \(May 2024/);
  assert.match(buildChatSystemPrompt('Compare Apr 2023 and May 2024'), /2023-04: Cisco/);
  assert.match(buildChatSystemPrompt('Compare Apr 2023 and May 2024'), /2024-05: Microsoft/);
  assert.match(buildChatSystemPrompt('Where did he work in December 2099?'), /2099-12: No documented employment/);
  assert.ok(CAREER.every(role => /^\d{4}-\d{2}$/.test(role.startMonth) && (!role.endMonth || role.startMonth <= role.endMonth)));
});

test('career trajectory questions get grounded scenario reasoning, not fabricated forecasts', () => {
  for (const query of ['Assess Nishad’s future career trajectory', 'What might his next role be?', 'What is his career outlook?']) {
    const prompt = buildChatSystemPrompt(query, { intent: 'career_scenarios' });
    assert.match(prompt, /Scenarios, not predictions/);
    assert.match(prompt, /three numbered plausible paths/);
    assert.match(prompt, /Mentored\/onboarded engineers and interns/);
    assert.match(prompt, /TensorFlow model execution/);
    assert.match(prompt, /Goals, preferred leadership track, performance reviews and organizational opportunities are unknown/);
    assert.match(prompt, /do not claim readiness for a level, a promotion, a future employer/);
    assert.match(prompt, /Never use fictional alternate branches as career evidence/);
    assert.ok(prompt.length < 6000, `trajectory prompt is ${prompt.length} characters`);
  }
  assert.doesNotMatch(buildChatSystemPrompt('What was his next job after Twitter?'), /Career scenario guidance/);
});
