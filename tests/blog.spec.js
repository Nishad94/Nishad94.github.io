import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import MarkdownIt from 'markdown-it';
import { parsePost } from '../scripts/build-site.mjs';
import { code } from './blog-fixture.mjs';

const slug = 'privacy-first-openclaw-image-stream';
test.beforeEach(async ({ page }) => {
  await page.route('https://**/*', route => route.abort());
});

test('AdSense ownership verification is published without enabling advertising', async ({ page, request }) => {
  const adRequests = [];
  page.on('request', request => {
    if (/googlesyndication\.com|doubleclick\.net/.test(request.url())) adRequests.push(request.url());
  });
  await page.goto('/');
  await expect(page.locator('head meta[name="google-adsense-account"]')).toHaveAttribute('content', 'ca-pub-2525457839764099');
  const adsTxt = await request.get('/ads.txt');
  expect(adsTxt.status()).toBe(200);
  expect(await adsTxt.text()).toBe('google.com, pub-2525457839764099, DIRECT, f08c47fec0942fa0\n');
  const settings = await page.evaluate(async () => {
    const { ADSENSE_CLIENT, ADSENSE_SLOT } = await import('/deployment.js');
    return { ADSENSE_CLIENT, ADSENSE_SLOT };
  });
  expect(settings).toEqual({ ADSENSE_CLIENT: '', ADSENSE_SLOT: '' });
  await expect(page.locator('.toffee-ad-placeholder')).toBeVisible();
  await expect(page.locator('script[data-nishad-adsense], ins.adsbygoogle')).toHaveCount(0);
  expect(adRequests).toEqual([]);
});

for (const width of [1280, 1201, 1024, 800, 701, 375, 320]) {
  for (const builderMode of [false, true]) {
    test(`primary Blog navigation at ${width}px in ${builderMode ? 'Builder' : 'normal'} mode`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/');
      const navigation = page.getByRole('navigation', { name: 'Primary', exact: true });
      if (builderMode) {
        await page.locator('#hero-vc-view').click();
        await expect(page.locator('body')).toHaveClass(/impact-mode/);
        await expect(page.locator('#term-input')).toHaveValue('brief');
        await navigation.getByRole('link', { name: 'Home', exact: true }).click();
      }
      const blog = navigation.getByRole('link', { name: 'Blog', exact: true });
      await expect(blog).toHaveAttribute('href', '/blog/');
      await expect(blog.locator('span')).toBeVisible();
      await expect(blog).not.toHaveAttribute('data-view', /./);
      await expect(navigation.getByRole('link')).toHaveCount(8);
      for (const link of await navigation.getByRole('link').all()) {
        await expect(link).toBeInViewport({ ratio: 1 });
      }
      await expect(page.getByRole('heading', { name: 'Blog / 9 build notes' })).toBeVisible();
      await expect(page.getByRole('link', { name: 'all blog posts' })).toHaveAttribute('href', '/blog/');
      const posts = await page.locator('.writing-card').evaluateAll(links => links.map(link => link.getAttribute('href')));
      expect(posts).toHaveLength(9);
      const response = page.waitForResponse(response => response.request().isNavigationRequest() && response.url().endsWith('/blog/'));
      await blog.click();
      expect((await response).status()).toBe(200);
      await expect(page).toHaveURL(/\/blog\/$/);
      await expect(page.getByRole('heading', { name: 'Technical blog', exact: true })).toBeVisible();
      await expect(navigation.getByRole('link', { name: 'Blog', exact: true })).toHaveAttribute('aria-current', 'page');
      for (const path of posts) await expect(page.locator(`.post-list a[href="${path}"]`)).toHaveCount(1);
      await navigation.getByRole('link', { name: 'Home', exact: true }).click();
      await expect(page).toHaveURL(/\/$/);
      await expect(navigation.getByRole('link', { name: 'Home', exact: true })).toHaveAttribute('aria-current', 'page');
    });
  }
}

test('hash tabs and legacy anchors remain separate from keyboard Blog navigation', async ({ page }) => {
  for (const width of [1280, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    await page.evaluate(() => { window.navigationDocument = 'same homepage'; });
    const navigation = page.getByRole('navigation', { name: 'Primary', exact: true });
    const blog = navigation.getByRole('link', { name: 'Blog', exact: true });
    for (const [label, view, hash] of [
      ['Home', 'home', 'home'], ['Story', 'story', 'story'], ['Lore', 'lore', 'lore'],
      ['Music', 'music', 'music'], ['Work', 'work', 'recruiter'], ['Terminal', 'shell', 'shell'],
      ['Control', 'control', 'control']
    ]) {
      await navigation.getByRole('link', { name: label, exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`/#${hash}$`));
      await expect(page.locator('body')).toHaveAttribute('data-view', view);
      await expect(navigation.locator('[aria-current="page"]')).toHaveAttribute('data-view', view);
      await expect(blog).not.toHaveAttribute('aria-current', /./);
      expect(await page.evaluate(() => window.navigationDocument)).toBe('same homepage');
    }
    await page.goto('/#timeline');
    await expect(page.locator('body')).toHaveAttribute('data-view', 'story');
    await page.goto('/#writing');
    await expect(page.locator('body')).toHaveAttribute('data-view', 'home');
    await expect(page.getByRole('heading', { name: 'Blog / 9 build notes' })).toBeInViewport();
    await blog.focus();
    await expect(blog).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/blog\/$/);
  }
});

test.describe('static primary navigation', () => {
  test.use({ javaScriptEnabled: false });
  test('Blog is visible and reachable without JavaScript', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 812 });
    await page.goto('/');
    const blog = page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Blog', exact: true });
    await expect(blog.locator('span')).toBeVisible();
    await expect(blog).toBeInViewport({ ratio: 1 });
    await blog.click();
    await expect(page).toHaveURL(/\/blog\/$/);
    await expect(page.getByRole('heading', { name: 'Technical blog', exact: true })).toBeVisible();
  });
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
    { slug: 'building-nishad-ai-from-scratch', diagrams: 2, other: 'private-analytics-github-pages' },
    { slug: 'private-analytics-github-pages', diagrams: 4, other: 'building-nishad-ai-from-scratch' }
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

test('terminal HLD publishes complete responsive diagrams and implementation guidance', async ({ page, request }) => {
  const hldSlug = 'inside-nishad-ai-terminal';
  const path = `/blog/${hldSlug}/`;
  const post = parsePost(await readFile(`posts/${hldSlug}.md`, 'utf8'), `${hldSlug}.md`);
  expect((await (await request.get('/sitemap.xml')).text())).toContain(path);
  expect((await (await request.get('/analytics-pages.json')).json())[path]).toBe(post.title);
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    expect((await page.goto(path)).status()).toBe(200);
    await expect(page.locator('h1')).toHaveText(post.title);
    await expect(page.locator('.prose img')).toHaveCount(5);
    await expect(page.locator('.prose')).toContainText('Gemma is the brain; llama.cpp is the engine');
    await expect(page.locator('.prose')).toContainText('Does RAG improve fidelity?');
    await expect(page.locator('.prose')).toContainText('Caddy: the HTTPS front door');
    for (const image of await page.locator('.prose img').all()) {
      await image.scrollIntoViewIfNeeded();
      await expect(image).toHaveJSProperty('complete', true);
      expect(await image.evaluate(el => el.naturalWidth)).toBeGreaterThanOrEqual(1200);
      expect(await image.getAttribute('alt')).toBeTruthy();
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});

test('ontology and KV-cache article publishes measured internals and responsive diagrams', async ({ page, request }) => {
  const articleSlug = 'inside-nishad-ai-ontology-kv-cache';
  const path = `/blog/${articleSlug}/`;
  const post = parsePost(await readFile(`posts/${articleSlug}.md`, 'utf8'), `${articleSlug}.md`);
  expect((await (await request.get('/sitemap.xml')).text())).toContain(path);
  expect((await (await request.get('/analytics-pages.json')).json())[path]).toBe(post.title);
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    expect((await page.goto(path)).status()).toBe(200);
    await expect(page.locator('h1')).toHaveText(post.title);
    await expect(page.locator('.prose img')).toHaveCount(4);
    await expect(page.locator('.prose')).toContainText('The ontology is the authoritative knowledge layer');
    await expect(page.locator('.prose')).toContainText('The 4,096-token context constraint');
    await expect(page.locator('.prose')).toContainText('Two cache-specialized slots');
    await expect(page.locator('.prose')).toContainText('98.1%');
    for (const image of await page.locator('.prose img').all()) {
      await image.scrollIntoViewIfNeeded();
      await expect(image).toHaveJSProperty('complete', true);
      expect(await image.evaluate(el => el.naturalWidth)).toBeGreaterThanOrEqual(1200);
      expect(await image.getAttribute('alt')).toBeTruthy();
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});

test('mobile layout scrolls code and tables without overflowing the page', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  for (const url of ['/blog/', `/blog/${slug}/`, '/blog/inside-nishad-ai-terminal/', '/blog/synthetic-syntax/']) {
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
    '/inference/gateway.py', '/inference/nishad-gemma.service',
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
