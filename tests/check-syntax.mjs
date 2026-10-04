import { readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const files = readdirSync('.').filter(file => /\.(js|html)$/.test(file));
for (const file of files) {
  const source = readFileSync(file, 'utf8');
  const scripts = file.endsWith('.html')
    ? [...source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(match => match[1])
    : [source];
  for (const script of scripts) {
    const result = spawnSync(process.execPath, ['--input-type=module', '--check'], { input: script, encoding: 'utf8' });
    if (result.status !== 0) throw new Error(file + '\n' + result.stderr);
  }
}
console.log('JavaScript syntax checked in all root JS and inline HTML scripts.');
