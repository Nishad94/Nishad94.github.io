import { test, expect } from '@playwright/test';

const noData = { needs_site_data: false, source_ids: [], intent: 'answer' };
const index = {
  schema: 'nishad.public-knowledge.v1',
  documents: [{
    id: 'blog-0', title: 'Synthetic witness', description: 'A public synthetic article.',
    url: '/blog/synthetic-reference/',
    sections: Array.from({ length: 4 }, (_, i) => ({
      id: `p${i}`, title: `Section ${i}`, summary: `Public reference ${i}`,
      text: `PUBLIC_EVIDENCE_${i} ` + 'x'.repeat(780)
    }))
  }]
};

async function setup(page, { webEnabled = false } = {}) {
  await page.route('**/deployment.js', route => route.fulfill({
    contentType: 'application/javascript',
    body: `export const PRIVATE_DASHBOARD_ORIGIN = '';
export const ANALYTICS_ENDPOINT = '';
export const INFERENCE_CHAT_ENDPOINT = '';
export const INFERENCE_METRICS_ENDPOINT = '';
export const WEB_SEARCH_ENABLED = ${webEnabled};
export const ADSENSE_CLIENT = '';
export const ADSENSE_SLOT = '';`
  }));
  await page.addInitScript(() => localStorage.setItem('nishad_ai_proxy', 'http://127.0.0.1:9/semantic'));
  await page.route('**/site-knowledge.json', route => route.fulfill({ json: index }));
}

test('semantic chat plans sources, selects passages and cites the chosen public article', async ({ page }) => {
  await setup(page);
  let routing = 0, answering = 0;
  await page.route('http://127.0.0.1:9/semantic', route => {
    const body = route.request().postDataJSON();
    if (body.task === 'knowledge_route') {
      routing++;
      expect(body.messages[0].content).toContain('semantic source router');
      const id = routing === 1 ? 'blog-0' : 'blog-0/p2';
      expect(body.route_ids).toContain(id);
      return route.fulfill({ json: {
        content: JSON.stringify({ needs_site_data: true, source_ids: [id], intent: 'answer' }), finish_reason: 'stop'
      } });
    }
    answering++;
    expect(body.messages[0].content).toContain('PUBLIC_EVIDENCE_2');
    expect(body.messages[0].content).not.toContain('PUBLIC_EVIDENCE_0');
    expect(body.messages[0].content).toContain('reference');
    return route.fulfill({ json: { content: 'GROUNDED_PUBLIC_ANSWER', finish_reason: 'stop' } });
  });
  await page.goto('/#shell');
  await page.locator('#term-input').fill('Explain the unusual orange mechanism.');
  await page.locator('#term-input').press('Enter');
  await expect(page.locator('#term-output')).toContainText('GROUNDED_PUBLIC_ANSWER');
  await expect(page.locator('#term-output a', { hasText: 'Synthetic witness' })).toHaveAttribute('href', '/blog/synthetic-reference/');
  expect(routing).toBe(2);
  expect(answering).toBe(1);
});

test('semantic router can decide that general questions need no additional site evidence', async ({ page }) => {
  await setup(page);
  let routing = 0;
  await page.route('http://127.0.0.1:9/semantic', route => {
    const body = route.request().postDataJSON();
    if (body.task) {
      routing++;
      return route.fulfill({ json: { content: JSON.stringify(noData), finish_reason: 'stop' } });
    }
    expect(body.messages[0].content).toContain('No additional public passages were selected');
    return route.fulfill({ json: { content: 'GENERAL_KNOWLEDGE_ANSWER', finish_reason: 'stop' } });
  });
  await page.goto('/#shell');
  await page.locator('#term-input').fill('Why do rainbows appear?');
  await page.locator('#term-input').press('Enter');
  await expect(page.locator('#term-output')).toContainText('GENERAL_KNOWLEDGE_ANSWER');
  expect(routing).toBe(1);
});

test('web intent streams the local answer before a cited Exa enrichment', async ({ page }) => {
  await setup(page, { webEnabled: true });
  let intents = 0, routing = 0, answering = 0, searches = 0;
  await page.route('http://127.0.0.1:9/semantic', route => {
    const body = route.request().postDataJSON();
    if (body.task === 'web_intent') {
      intents++;
      expect(body.messages[0].content).not.toContain('Public reference 2');
      expect(body.messages[1].content).toContain('Public reference 2');
      return route.fulfill({ json: {
        content: JSON.stringify({
          web_search: true,
          web_query: 'current synthetic public benchmark'
        }),
        finish_reason: 'stop'
      } });
    }
    if (body.task === 'knowledge_route') {
      routing++;
      const id = routing === 1 ? 'blog-0' : 'blog-0/p2';
      return route.fulfill({ json: {
        content: JSON.stringify({ needs_site_data: true, source_ids: [id], intent: 'answer' }),
        finish_reason: 'stop'
      } });
    }
    answering++;
    if (answering === 1) {
      expect(body.messages[0].content).toContain('LOCAL KNOWLEDGE ONLY');
      return route.fulfill({ json: { content: 'LOCAL_DOCUMENTED_ANSWER', finish_reason: 'stop' } });
    }
    expect(body.messages[0].content).toContain('PUBLIC WEB ENRICHMENT');
    expect(body.messages[0].content).toContain('SYNTHETIC_WEB_EVIDENCE');
    expect(body.messages[0].content).toContain('Do not calculate currency conversions');
    return route.fulfill({
      contentType: 'text/event-stream',
      body: 'data: {"delta":"WEB_ENRICHED_ANSWER"}\n\ndata: {"done":true,"finish_reason":"stop"}\n\n'
    });
  });
  await page.route('http://127.0.0.1:9/search', async route => {
    searches++;
    expect(route.request().postDataJSON()).toEqual({ query: 'current synthetic public benchmark' });
    await new Promise(resolve => setTimeout(resolve, 800));
    return route.fulfill({ json: {
      schema: 'nishad.web-search.v1',
      query: 'current synthetic public benchmark',
      retrieved_at: '2026-10-21T00:00:00Z',
      results: [{
        title: 'Synthetic public source',
        url: 'https://example.com/evidence',
        snippet: 'SYNTHETIC_WEB_EVIDENCE',
        published_at: '2026-10-20T00:00:00Z'
      }]
    } });
  });
  await page.goto('/#shell');
  await page.locator('#term-input').fill('Give me a current public estimate.');
  await page.locator('#term-input').press('Enter');
  await expect(page.locator('#term-output')).toContainText('LOCAL_DOCUMENTED_ANSWER');
  await expect(page.locator('#term-output')).toContainText('Loading estimates/data from web');
  await expect(page.locator('#term-output')).toContainText('WEB_ENRICHED_ANSWER');
  await expect(page.locator('#term-output a', { hasText: 'Synthetic public source' }))
    .toHaveAttribute('href', 'https://example.com/evidence');
  const text = await page.locator('#term-output').innerText();
  expect(text.indexOf('LOCAL_DOCUMENTED_ANSWER')).toBeLessThan(text.indexOf('WEB_ENRICHED_ANSWER'));
  expect(intents).toBe(1);
  expect(routing).toBe(2);
  expect(answering).toBe(2);
  expect(searches).toBe(1);
});

test('web intent remains local-only while the public deployment flag is disabled', async ({ page }) => {
  await setup(page);
  await page.route('http://127.0.0.1:9/search', () => {
    throw new Error('search must stay disabled');
  });
  await page.route('http://127.0.0.1:9/semantic', route => {
    const body = route.request().postDataJSON();
    if (body.task === 'knowledge_route') {
      return route.fulfill({ json: {
        content: JSON.stringify({
          needs_site_data: false,
          source_ids: [],
          intent: 'answer',
          web_search: true,
          web_query: 'current external information'
        }),
        finish_reason: 'stop'
      } });
    }
    return route.fulfill({ json: { content: 'LOCAL_ONLY_WHILE_DISABLED', finish_reason: 'stop' } });
  });
  await page.goto('/#shell');
  await page.locator('#term-input').fill('Give me current external information.');
  await page.locator('#term-input').press('Enter');
  await expect(page.locator('#term-output')).toContainText('LOCAL_ONLY_WHILE_DISABLED');
  await expect(page.locator('#term-output')).not.toContainText('Loading estimates/data from web');
});

test('invalid model-selected IDs fail explicitly before an answer request', async ({ page }) => {
  await setup(page);
  let calls = 0;
  await page.route('http://127.0.0.1:9/semantic', route => {
    calls++;
    expect(route.request().postDataJSON().task).toBe('knowledge_route');
    return route.fulfill({ json: {
      content: JSON.stringify({ needs_site_data: true, source_ids: ['https://private.example/'], intent: 'answer' }),
      finish_reason: 'stop'
    } });
  });
  await page.goto('/#shell');
  await page.locator('#term-input').fill('Read some extra context.');
  await page.locator('#term-input').press('Enter');
  await expect(page.locator('#term-output')).toContainText('invalid routing plan');
  await expect(page.locator('#term-input')).toBeEnabled();
  expect(calls).toBe(1);
});
