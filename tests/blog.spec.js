import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import MarkdownIt from 'markdown-it';
import { parsePost } from '../scripts/build-site.mjs';
import { code } from './blog-fixture.mjs';

const slug = 'privacy-first-openclaw-image-stream';
test.beforeEach(async ({ page }) => {
  await page.route('https://**/*', route => route.abort());
});

test('homepage link, help, terminal command, and palette reach the blog', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Read the technical blog' }).click();
  await expect(page).toHaveURL(/\/blog\/$/);
  await expect(page.locator(`.post-list a[href="/blog/${slug}/"]`)).toHaveText('Build a Privacy-First OpenClaw Image Stream');
  await page.getByRole('link', { name: 'Home', exact: true }).click();
  await page.locator('.tab[data-view="shell"]').click();
  await page.locator('#term-input').fill('help');
  await page.locator('#term-input').press('Enter');
  await expect(page.locator('#term-output')).toContainText('blog                  read technical posts');
  await page.locator('#term-input').fill('blog');
  await page.locator('#term-input').press('Enter');
  await expect(page).toHaveURL(/\/blog\/$/);
  await page.goto('/');
  await page.getByRole('button', { name: 'Open command palette' }).click();
  await page.locator('#palette-input').fill('technical blog');
  await page.locator('#palette-input').press('Enter');
  await expect(page).toHaveURL(/\/blog\/$/);
});

test('slashless blog, direct article refresh, chapters, fences, anchors, and metadata', async ({ page }) => {
  await page.goto('/blog');
  await expect(page).toHaveURL(/\/blog\/$/);
  const response = await page.goto(`/blog/${slug}/`);
  expect(response.status()).toBe(200);
  await page.reload();
  await expect(page.locator('h1')).toHaveCount(1);
  await expect(page.locator('.prose h2')).toHaveCount(12);
  const post = parsePost(await readFile(`posts/${slug}.md`, 'utf8'), `${slug}.md`);
  const tokens = new MarkdownIt().parse(post.body, {});
  const headings = tokens.flatMap((token, index) => token.type === 'heading_open' ? [tokens[index + 1].content] : []);
  expect(await page.locator('.prose :is(h2,h3)').allTextContents()).toEqual(headings);
  expect(await page.locator('.code-block code').allTextContents()).toEqual(tokens.filter(token => token.type === 'fence').map(token => token.content));
  await expect(page.locator('.code-block .hljs-attr').first()).toBeVisible();
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', `https://nishad.ai/blog/${slug}/`);
  await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', post.description);
  const lastChapter = page.getByRole('navigation', { name: 'Table of contents' }).getByRole('link', { name: 'Chapter 12', exact: false });
  await lastChapter.click();
  await expect(page).toHaveURL(/#section-chapter-12/);
  await expect(page.locator('.prose h2').last()).toBeInViewport();
  await expect(page.locator('.prose')).toContainText('Costs taken from billing, not a budget alert.');
});

test('copy preserves exact code text and announces clipboard failures', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: async text => { window.copiedCode = text; } }
  }));
  await page.goto('/blog/synthetic-syntax/');
  await page.getByRole('button', { name: 'Copy code block 1' }).click();
  expect(await page.evaluate(() => window.copiedCode)).toBe(code);
  await expect(page.getByRole('status')).toHaveText('Copied.');
  await page.evaluate(() => { navigator.clipboard.writeText = async () => { throw new Error('Denied'); }; });
  await page.getByRole('button', { name: 'Copy code block 1' }).click();
  await expect(page.getByRole('status')).toContainText('Could not copy');
  expect(await page.evaluate(() => window.injection)).toBeUndefined();
  await expect(page.locator('.prose script, .prose a[href^="javascript:"], .prose img[src^="data:"]')).toHaveCount(0);
});

test('site and metrics articles preserve content, cross-links, and responsive diagrams', async ({ page, request }) => {
  const articles = [
    { slug: 'building-nishad-ai-from-scratch', diagrams: 1, other: 'private-analytics-github-pages' },
    { slug: 'private-analytics-github-pages', diagrams: 3, other: 'building-nishad-ai-from-scratch' }
  ];
  const sitemap = await (await request.get('/sitemap.xml')).text();
  const catalog = await (await request.get('/analytics-pages.json')).json();
  for (const article of articles) {
    const path = `/blog/${article.slug}/`;
    const post = parsePost(await readFile(`posts/${article.slug}.md`, 'utf8'), `${article.slug}.md`);
    const tokens = new MarkdownIt().parse(post.body, {});
    expect(sitemap).toContain(path);
    expect(catalog[path]).toBe(post.title);
    for (const width of [1280, 375]) {
      await page.setViewportSize({ width, height: 900 });
      expect((await page.goto(path)).status()).toBe(200);
      await expect(page.locator('h1')).toHaveText(post.title);
      await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', `https://nishad.ai${path}`);
      await expect(page.locator(`.prose a[href="/blog/${article.other}/"]`).first()).toBeAttached();
      expect(await page.locator('.prose :is(h2,h3)').allTextContents()).toEqual(
        tokens.flatMap((token, index) => token.type === 'heading_open' ? [tokens[index + 1].content] : []));
      expect(await page.locator('.code-block code').allTextContents()).toEqual(
        tokens.filter(token => token.type === 'fence').map(token => token.content));
      await expect(page.locator('.prose img')).toHaveCount(article.diagrams);
      for (const image of await page.locator('.prose img').all()) {
        await image.scrollIntoViewIfNeeded();
        await expect(image).toHaveJSProperty('complete', true);
        expect(await image.evaluate(el => el.naturalWidth)).toBeGreaterThan(0);
        expect(await image.getAttribute('alt')).toBeTruthy();
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
  }
});

test('mobile layout scrolls code and tables without overflowing the page', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  for (const url of ['/blog/', `/blog/${slug}/`, '/blog/synthetic-syntax/']) {
    await page.goto(url);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await expect(page.getByAltText('Synthetic diagram')).toBeVisible();
  expect(await page.locator('.code-block pre').evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true);
  expect(await page.locator('.table-scroll').evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true);
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'Read the technical blog' })).toBeVisible();
});

test('no-JS article is complete and keyboard skip link works', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:18765/blog/${slug}/`);
  await expect(page.locator('.prose h2')).toHaveCount(12);
  await expect(page.getByRole('button', { name: /Copy code/ })).toHaveCount(0);
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('main')).toBeFocused();
  await context.close();
});

test('empty listing and unknown or draft URLs are explicit; private sources are not served', async ({ page, request }) => {
  await page.goto('/empty.html');
  await expect(page.getByRole('heading', { name: 'No posts published yet' })).toBeVisible();
  for (const path of ['/blog/does-not-exist/', '/blog/post-template/', '/posts/post-template.md', '/worker/ai-proxy.js',
    '/dashboard/config.go', '/dashboard/schema.sql', '/dashboard/go.mod', '/dashboard/README.md']) {
    const response = await page.goto(path);
    expect(response.status()).toBe(404);
    await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
  }
  const sitemap = await request.get('/sitemap.xml');
  expect(await sitemap.text()).toContain(`/blog/${slug}/`);
  expect(await sitemap.text()).not.toContain('post-template');
  expect((await request.get('/CNAME')).status()).toBe(200);
  for (const path of ['/ontology.js', '/spotify.js', '/spotify-ui.js', '/spotify-callback.html', '/spotify-privacy.html']) {
    expect((await request.get(path)).status()).toBe(200);
  }
});
