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

async function setup(page) {
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
