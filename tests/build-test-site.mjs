import { cp, rm, writeFile } from 'node:fs/promises';
import { buildSite, loadPosts, renderBlog, writePages } from '../scripts/build-site.mjs';
import { fixture } from './blog-fixture.mjs';

await buildSite();
await rm('.test-site', { recursive: true, force: true });
await cp('_site', '.test-site', { recursive: true });
await writePages(renderBlog([...await loadPosts('posts'), fixture]), '.test-site');
await writeFile('.test-site/empty.html', renderBlog([]).get('blog/index.html'));
await writeFile('.test-site/test-diagram.svg', '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50"><rect width="100" height="50" fill="#9fffd2"/></svg>');
