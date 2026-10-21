import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import MarkdownIt from 'markdown-it';
import highlight from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import json from 'highlight.js/lib/languages/json';
import python from 'highlight.js/lib/languages/python';
import { PRIVATE_DASHBOARD_ORIGIN, ANALYTICS_ENDPOINT, PUBLIC_ACTIVITY_ENDPOINT } from '../deployment.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const origin = 'https://nishad.ai';
const markdown = new MarkdownIt({ html: false, linkify: false });
const escape = markdown.utils.escapeHtml;
const execFileAsync = promisify(execFile);
for (const [name, grammar] of Object.entries({ bash, javascript, typescript, json, python })) {
  highlight.registerLanguage(name, grammar);
}

// Explicit protocol allowlist; raw HTML and data: images are never enabled.
markdown.validateLink = value => {
  if (/[\u0000-\u0020\u007f\\]/.test(value) || value.startsWith('//')) return false;
  return !/^[a-z][a-z\d+.-]*:/i.test(value) || /^(https?:|mailto:)/i.test(value);
};
markdown.renderer.rules.fence = (tokens, index) => {
  const token = tokens[index];
  const language = token.info.trim().split(/\s+/)[0] || 'text';
  const code = highlight.getLanguage(language)
    ? highlight.highlight(token.content, { language, ignoreIllegals: true }).value
    : escape(token.content);
  return `<figure class="code-block"><figcaption><span>${escape(language)}</span></figcaption><pre tabindex="0" aria-label="${escape(language)} code"><code>${code}</code></pre></figure>\n`;
};
markdown.renderer.rules.heading_open = (tokens, index, options, env, self) =>
  `${self.renderToken(tokens, index, options)}<a class="heading-anchor" href="#${tokens[index].attrGet('id')}" aria-label="Link to ${escape(tokens[index + 1].content)}"></a>`;
markdown.renderer.rules.table_open = () => '<div class="table-scroll" role="region" aria-label="Article table" tabindex="0"><table>\n';
markdown.renderer.rules.table_close = () => '</table></div>\n';
const imageRule = markdown.renderer.rules.image;
markdown.renderer.rules.image = (tokens, index, options, env, self) => {
  tokens[index].attrSet('loading', 'lazy');
  tokens[index].attrSet('decoding', 'async');
  return imageRule(tokens, index, options, env, self);
};

export function parsePost(source, filename) {
  const fail = message => { throw new Error(`${filename}: ${message}`); };
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*\.md$/.test(filename)) {
    fail('filename must be a lowercase kebab-case slug ending in .md');
  }
  const match = source.replace(/^\uFEFF/, '').match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/);
  if (!match) fail('expected JSON metadata between --- lines, followed by Markdown');
  let metadata;
  try {
    metadata = JSON.parse(match[1]);
  } catch (error) {
    fail(`invalid metadata JSON: ${error.message}`);
  }
  if (!metadata || Array.isArray(metadata) || typeof metadata !== 'object') fail('metadata must be an object');
  const fields = ['title', 'date', 'description', 'tags', 'draft'];
  for (const key of Object.keys(metadata)) {
    if (!fields.includes(key)) fail(`unknown metadata field "${key}"`);
  }
  for (const key of ['title', 'description']) {
    if (typeof metadata[key] !== 'string' || !metadata[key].trim()) fail(`${key} must be a nonempty string`);
  }
  if (typeof metadata.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(metadata.date) ||
      !Number.isFinite(Date.parse(metadata.date)) ||
      new Date(metadata.date).toISOString().slice(0, 10) !== metadata.date) {
    fail('date must be a real calendar date in YYYY-MM-DD format');
  }
  if (typeof metadata.draft !== 'boolean') fail('draft must explicitly be true or false');
  if (!Array.isArray(metadata.tags) || metadata.tags.some(tag => typeof tag !== 'string' || !tag.trim())) {
    fail('tags must be an array of nonempty strings (or [])');
  }
  if (!match[2].trim()) fail('post body must not be empty');
  return {
    ...metadata,
    title: metadata.title.trim(),
    description: metadata.description.trim(),
    tags: [...new Set(metadata.tags.map(tag => tag.trim()))],
    slug: filename.slice(0, -3),
    body: match[2]
  };
}

export async function loadPosts(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const posts = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) {
      throw new Error(`${entry.name}: posts directory accepts only .md files; put images in assets/blog/`);
    }

    posts.push(parsePost(await readFile(join(directory, entry.name), 'utf8'), entry.name));
  }
  return posts;
}

export function parseGitActivity(raw, generatedAt = new Date().toISOString()) {
  const commits = [];
  const days = {};
  for (const record of raw.split('\x1e')) {
    if (!record.trim()) continue;
    const [sha, short, timestamp, ...subjectParts] = record.trim().split('\x1f');
    const subject = subjectParts.join('\x1f').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 200);
    if (!/^[0-9a-f]{40}$/.test(sha) || !/^[0-9a-f]{7,12}$/.test(short) ||
        !Number.isFinite(Date.parse(timestamp)) || !subject) {
      throw new Error('Invalid git activity record');
    }
    const date = new Date(timestamp).toISOString();
    const day = date.slice(0, 10);
    days[day] = (days[day] || 0) + 1;
    commits.push({
      sha,
      short,
      date,
      subject,
      url: `https://github.com/Nishad94/Nishad94.github.io/commit/${sha}`
    });
  }
  return {
    schema: 'nishad.repository-activity.v1',
    generated_at: new Date(generatedAt).toISOString(),
    repository: 'Nishad94/Nishad94.github.io',
    total_commits: commits.length,
    active_days: Object.keys(days).length,
    days,
    commits: commits.slice(0, 20)
  };
}

export async function loadGitActivity(directory) {
  const { stdout } = await execFileAsync('git', [
    '-C', directory, 'log', '--since=1 year ago', '--no-merges',
    '--pretty=format:%H%x1f%h%x1f%aI%x1f%s%x1e', '--', '.'
  ], { encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 });
  return parseGitActivity(stdout);
}

function layout({ title, description, path, body, article = false, notFound = false }) {
  const url = origin + path;
  return `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1">\n<meta name="theme-color" content="#0d0f1b">\n<title>${escape(title)} | Nishad Dawkhar</title>\n<meta name="description" content="${escape(description)}">\n${notFound ? '<meta name="robots" content="noindex">' : `<link rel="canonical" href="${url}">`}\n<meta property="og:title" content="${escape(title)}">\n<meta property="og:description" content="${escape(description)}">\n<meta property="og:type" content="${article ? 'article' : 'website'}">\n${notFound ? '' : `<meta property="og:url" content="${url}">`}\n<meta name="twitter:card" content="summary">\n<link rel="stylesheet" href="/blog/blog.css">\n<script src="/blog/blog.js" defer></script>\n${notFound ? '' : '<link rel="stylesheet" href="/analytics.css">\n<script type="module" src="/analytics.js"></script>'}\n</head>\n<body class="blog">\n<a class="skip-link" href="#content">Skip to content</a>\n<header class="site-header"><nav aria-label="Primary">\n<a class="brand" href="/">nishad://multiverse</a>\n<div><a href="/">Home</a><a href="/blog/"${path === '/blog/' ? ' aria-current="page"' : ''}>Blog</a></div>\n</nav></header>\n<main id="content" tabindex="-1">${body}</main>\n<footer>Technical writing by Nishad Dawkhar. <a href="/">Back to the multiverse</a></footer>\n</body>\n</html>\n`;
}

function tags(post) {
  return post.tags.length ? `<ul class="tags" aria-label="Tags">${post.tags.map(tag => `<li>${escape(tag)}</li>`).join('')}</ul>` : '';
}

function date(post) {
  const formatted = new Intl.DateTimeFormat('en', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(post.date));
  return `<time datetime="${post.date}">${formatted}</time>`;
}

function renderArticle(body) {
  const tokens = markdown.parse(body, {});
  const headings = [];
  const used = new Set();
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (token.type !== 'heading_open') continue;
    const title = tokens[index + 1].children.map(child => child.content).join('');
    const base = 'section-' + (title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'heading');
    let id = base;
    for (let suffix = 2; used.has(id); suffix++) id = `${base}-${suffix}`;
    used.add(id);
    token.attrSet('id', id);
    if (token.tag === 'h2' || token.tag === 'h3') headings.push({ title, id, level: token.tag });
  }
  const toc = headings.length ? `<details class="toc" open><summary>On this page</summary><nav aria-label="Table of contents"><ol>${headings.map(heading =>
    `<li class="toc-${heading.level}"><a href="#${heading.id}">${escape(heading.title)}</a></li>`).join('')}</ol></nav></details>` : '';
  return toc + `<div class="prose">${markdown.renderer.render(tokens, markdown.options, {})}</div>`;
}

export function renderBlog(allPosts) {
  const posts = allPosts.filter(post => !post.draft).sort((a, b) =>
    b.date.localeCompare(a.date) || a.slug.localeCompare(b.slug));
  const files = new Map();
  files.set('site-knowledge.json', JSON.stringify({
    schema: 'nishad.public-knowledge.v1',
    documents: posts.map((post, index) => {
      const sections = [];
      let heading = post.title;
      for (const token of markdown.parse(post.body, {})) {
        if (token.type !== 'inline' && token.type !== 'fence' && token.type !== 'code_block') continue;
        const text = token.children
          ? token.children.filter(child => ['text', 'code_inline', 'softbreak', 'hardbreak'].includes(child.type))
            .map(child => child.type.endsWith('break') ? '\n' : child.content).join('')
          : token.content;
        if (!text.trim()) continue;
        // Heading tokens are followed by inline content; use a readable passage
        // label plus a short excerpt so a model can select any published passage.
        if (token.map && /^#{1,6}\s/.test(post.body.split('\n')[token.map[0]] || '')) heading = text;
        let remaining = text.trim();
        while (remaining) {
          const last = sections.at(-1);
          const available = last?.title === heading.slice(0, 100) ? 899 - last.text.length : 0;
          if (available > 0) {
            last.text += '\n' + remaining.slice(0, available);
            last.summary = last.text.slice(0, 120);
            remaining = remaining.slice(available).trim();
          } else {
            const content = remaining.slice(0, 900);
            sections.push({
              id: `p${sections.length}`, title: heading.slice(0, 100),
              summary: content.slice(0, 120), text: content
            });
            remaining = remaining.slice(900).trim();
          }
        }
      }
      return {
        id: `blog-${post.slug}`, title: post.title, description: post.description,
        url: `/blog/${post.slug}/`, sections
      };
    })
  }) + '\n');
  files.set('analytics-pages.json', JSON.stringify(publicPageCatalog(posts)) + '\n');
  files.set('dashboard_metrics/index.html', renderMetricsEntry(PRIVATE_DASHBOARD_ORIGIN));
  const listing = posts.length
    ? `<ol class="post-list">${posts.map(post => `<li><article>\n${date(post)}<h2><a href="/blog/${post.slug}/">${escape(post.title)}</a></h2>\n<p>${escape(post.description)}</p>${tags(post)}\n</article></li>`).join('\n')}</ol>`
    : '<section class="empty-state" aria-labelledby="empty-title"><h2 id="empty-title">No posts published yet</h2><p>This is the home for Nishad\'s technical writing. Check back for the first article.</p></section>';
  files.set('blog/index.html', layout({
    title: 'Technical blog',
    description: 'Technical writing by Nishad Dawkhar.',
    path: '/blog/',
    body: `<div class="page-heading"><p class="eyebrow">Notes from the main branch</p><h1>Technical blog</h1><p>Ideas, implementation details, and lessons from building software.</p></div>${listing}`
  }));
  for (const post of posts) {
    const body = `<article><header class="article-header">\n<a href="/blog/">All posts</a><p class="byline">Nishad Dawkhar &middot; ${date(post)}</p>\n<h1>${escape(post.title)}</h1><p class="description">${escape(post.description)}</p>${tags(post)}\n</header>${renderArticle(post.body)}</article>`;
    files.set(`blog/${post.slug}/index.html`, layout({
      title: post.title, description: post.description, path: `/blog/${post.slug}/`, body, article: true
    }));
  }
  files.set('404.html', layout({
    title: 'Page not found', description: 'This page is not available.', path: '/404.html', notFound: true,
    body: '<div class="page-heading"><p class="eyebrow">404</p><h1>Page not found</h1><p>This URL does not match a published page. The post may be unpublished, removed, or the link may be incorrect.</p><p><a href="/blog/">Browse published posts</a> or <a href="/">go home</a>.</p></div>'
  }));
  files.set('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${['/', '/blog/', '/metrics/', ...posts.map(post => `/blog/${post.slug}/`)].map(path => `<url><loc>${origin}${path}</loc></url>`).join('')}</urlset>\n`);
  return files;
}

export function publicPageCatalog(posts) {
  return Object.fromEntries([
    ['/', 'Home'], ['/blog/', 'Technical blog'],
    ...posts.filter(post => !post.draft).map(post => [`/blog/${post.slug}/`, post.title])
  ]);
}

export function renderMetricsEntry(privateOrigin) {
  if (privateOrigin) {
    const url = new URL(privateOrigin);
    if (url.protocol !== 'https:' || url.origin !== privateOrigin || url.username || url.password) {
      throw new Error('Private dashboard must be a bare HTTPS origin');
    }
  }
  const target = privateOrigin ? `${privateOrigin}/dashboard_metrics` : '';
  return `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">\n<meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer">\n<title>Private website metrics</title>\n${target ? `<meta http-equiv="refresh" content="0;url=${escape(target)}">` : ''}\n</head><body><h1>Private website metrics</h1>\n${target ? `<p>Continue to the <a href="${escape(target)}" rel="noreferrer">sign-in-protected dashboard</a>.</p>` : '<p>The private dashboard is not configured yet. No analytics results are published here.</p>'}\n<p><a href="/">Back to nishad.ai</a></p></body></html>\n`;
}

export async function writePages(files, output) {
  for (const [path, content] of files) {
    await mkdir(dirname(join(output, path)), { recursive: true });
    await writeFile(join(output, path), content);
  }
}

export async function buildSite() {
  if (ANALYTICS_ENDPOINT) {
    const endpoint = new URL(ANALYTICS_ENDPOINT);
    if (endpoint.protocol !== 'https:' || endpoint.pathname !== '/collect' || endpoint.search ||
        endpoint.hash || endpoint.username || endpoint.password) throw new Error('Invalid public analytics endpoint');
  }
  if (PUBLIC_ACTIVITY_ENDPOINT) {
    const endpoint = new URL(PUBLIC_ACTIVITY_ENDPOINT);
    if (endpoint.protocol !== 'https:' || endpoint.pathname !== '/activity' || endpoint.search ||
        endpoint.hash || endpoint.username || endpoint.password) throw new Error('Invalid public activity endpoint');
  }
  const posts = await loadPosts(join(root, 'posts'));
  const pages = renderBlog(posts);
  pages.set('activity.json', JSON.stringify(await loadGitActivity(root)) + '\n');
  const knowledge = JSON.parse(pages.get('site-knowledge.json'));
  for (const [index, [filename, title, description]] of [
    ['index.html', 'Homepage: story, lore and public features', 'Public career story, fictional lore, navigation, terminal commands and website features.'],
    ['spotify-privacy.html', 'Spotify privacy and consent', 'Published Spotify consent, storage, data flow and experimental policy limitations.'],
    ['analytics-privacy.html', 'Analytics privacy policy', 'Published analytics consent and privacy boundaries, not visitor data.']
  ].entries()) {
    const html = await readFile(join(root, filename), 'utf8');
    const visible = html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
      .replace(/<\/(?:p|li|h[1-6]|section|div)>/gi, '\n').replace(/<[^>]*>/g, ' ')
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
      .split('\n').map(line => line.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n');
    const sections = [];
    for (let offset = 0; offset < visible.length; offset += 900) {
      const text = visible.slice(offset, offset + 900);
      sections.push({ id: `p${sections.length}`, title: title.slice(0, 100), summary: text.slice(0, 120), text });
    }
    knowledge.documents.push({ id: `page-${index}`, title, description, url: filename === 'index.html' ? '/' : '/' + filename, sections });
  }
  pages.set('site-knowledge.json', JSON.stringify(knowledge) + '\n');
  const output = join(root, '_site');
  // Validate every post before replacing output; a bad draft also fails the build.
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });
  for (const path of ['index.html', 'ontology.js', 'spotify.js', 'spotify-ui.js', 'report-client.js',
    'spotify-callback.html', 'spotify-privacy.html', 'preview.html', 'pipeline-smoke.html', 'assets', 'CNAME', '.nojekyll',
    'deployment.js', 'analytics.js', 'analytics.css', 'analytics-privacy.html', 'ads.txt', 'metrics', 'shell']) {
    await cp(join(root, path), join(output, path), { recursive: true });
  }
  await writePages(pages, output);
  for (const path of ['blog.css', 'blog.js']) {
    await cp(join(root, 'blog', path), join(output, 'blog', path));
  }
  console.log(`Built _site: ${posts.filter(post => !post.draft).length} published posts; drafts excluded.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await buildSite();
}
