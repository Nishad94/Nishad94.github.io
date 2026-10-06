import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadPosts, parsePost, renderBlog } from '../scripts/build-site.mjs';
import { fixture, source } from './blog-fixture.mjs';

test('metadata is explicit, calendar-valid, filename-safe, and escaped', () => {
  for (const overrides of [
    { title: '' }, { description: null }, { date: '2026-02-30' }, { date: 'today' },
    { date: '2026-1-01' }, { tags: 'test' }, { tags: [''] }, { draft: undefined },
    { draft: 'false' }, { typo: true }
  ]) assert.throws(() => parsePost(source(overrides), 'bad.md'), /bad\.md:/);
  for (const filename of ['../bad.md', 'With Spaces.md', 'bad.html']) {
    assert.throws(() => parsePost(source(), filename), /filename/);
  }
  assert.throws(() => parsePost('no frontmatter', 'bad.md'), /expected JSON metadata/);
  assert.throws(() => parsePost('---\n{broken}\n---\nbody', 'bad.md'), /invalid metadata JSON/);
  assert.throws(() => parsePost('---\n[]\n---\nbody', 'bad.md'), /metadata must be an object/);
  assert.throws(() => parsePost(source({}, ''), 'bad.md'), /body must not be empty/);
  const post = parsePost(source({ title: '<img src=x onerror=alert(1)>', description: '" onload="bad', tags: ['<script>'] }), 'safe.md');
  const page = renderBlog([post]).get('blog/safe/index.html');
  assert.ok(page.includes('&lt;img'));
  assert.ok(page.includes('&quot; onload=&quot;bad'));
  assert.ok(!page.includes('<img src=x'));
});

test('no posts is a genuine empty state; drafts never become output or sitemap entries', () => {
  const draft = parsePost(source({ draft: true }), 'private-draft.md');
  for (const input of [[], [draft]]) {
    const pages = renderBlog(input);
    assert.match(pages.get('blog/index.html'), /No posts published yet/);
    assert.ok(![...pages.values()].join('').includes('private-draft'));
    assert.equal(pages.has('blog/private-draft/index.html'), false);
  }
});

test('published posts sort newest first with deterministic tie-breaking', () => {
  const posts = ['older', 'newer', 'equal'].map((slug, index) =>
    parsePost(source({ date: index ? '2026-10-07' : '2026-10-06' }), `${slug}.md`));
  const html = renderBlog(posts).get('blog/index.html');
  assert.ok(html.indexOf('/blog/equal/') < html.indexOf('/blog/newer/'));
  assert.ok(html.indexOf('/blog/newer/') < html.indexOf('/blog/older/'));
});

test('Markdown supports technical content without executing HTML or unsafe protocols', () => {
  const html = renderBlog([fixture]).get('blog/synthetic-syntax/index.html');
  for (const snippet of ['<table>', '<blockquote>', '<strong>', '<em>', '<img src="/test-diagram.svg"', 'hljs-keyword', 'section-supported-syntax-2']) {
    assert.ok(html.includes(snippet), snippet);
  }
  assert.ok(!html.includes('<script>window.injection'));
  assert.ok(!html.includes('href="javascript:'));
  assert.ok(!html.includes('src="data:'));
  for (const url of ['javascript:alert(1)', 'vbscript:bad', 'data:text/html,bad', 'file:///tmp/private', '//example.com']) {
    const post = parsePost(source({}, `[link](${url})`), 'unsafe.md');
    assert.ok(!renderBlog([post]).get('blog/unsafe/index.html').includes(`<a href="${url}"`));
  }
  const unknown = parsePost(source({}, '```unknown-language\n<script>alert(1)</script>\n```'), 'unknown.md');
  assert.match(renderBlog([unknown]).get('blog/unknown/index.html'), /&lt;script&gt;/);
});

test('missing posts directory and malformed files fail explicitly, including drafts', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'nishad-blog-'));
  try {
    assert.deepEqual(await loadPosts(directory), []);
    await assert.rejects(loadPosts(join(directory, 'missing')), /ENOENT/);
    await writeFile(join(directory, 'draft.md'), source({ draft: true, date: 'bad' }));
    await assert.rejects(loadPosts(directory), /draft\.md: date/);
    await rm(join(directory, 'draft.md'));
    await writeFile(join(directory, 'image.png'), 'not a post');
    await assert.rejects(loadPosts(directory), /posts directory accepts only/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('unknown URLs have an explicit noindex 404 with recovery navigation', () => {
  const html = renderBlog([]).get('404.html');
  assert.match(html, /Page not found/);
  assert.match(html, /name="robots" content="noindex"/);
  assert.match(html, /href="\/blog\/"/);
  assert.ok(!html.includes('rel="canonical"'));
});
