import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { resolve, join, sep, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { publicMetrics } from '../assets/inference-metrics-contract.js';

const defaultRoot = fileURLToPath(new URL('../_site/', import.meta.url));
const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml; charset=utf-8'
};

export function createPreviewServer({
  root = defaultRoot,
  runtime = join(process.env.LOCALAPPDATA || '', 'nishad-ai'),
  fetchImpl = fetch
} = {}) {
  const directory = resolve(root);
  return createServer(async (request, response) => {
    const expectedHost = `127.0.0.1:${request.socket.localPort}`;
    const origin = 'http://' + expectedHost;
    function json(status, data) {
      response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      response.end(JSON.stringify(data));
    }
    if (request.headers.host !== expectedHost) return json(403, { error: 'host_not_allowed' });
    if (request.headers.origin && request.headers.origin !== origin) return json(403, { error: 'origin_not_allowed' });
    let path;
    try { path = decodeURIComponent(new URL(request.url, origin).pathname); }
    catch { return json(400, { error: 'invalid_path' }); }
    try {
      if (path === '/__local/chat' || path === '/__local/metrics') {
        const chat = path.endsWith('/chat');
        if (request.method !== (chat ? 'POST' : 'GET')) return json(405, { error: 'method_not_allowed' });
        if (chat && request.headers.origin !== origin) return json(403, { error: 'origin_not_allowed' });
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), chat ? 120000 : 10000);
        response.on('close', () => controller.abort());
        try {
          let body;
          if (chat) {
            if (!request.headers['content-type']?.startsWith('application/json')) return json(415, { error: 'invalid_content_type' });
            const chunks = [];
            let size = 0;
            for await (const chunk of request) {
              size += chunk.length;
              if (size > 32768) return json(413, { error: 'payload_too_large' });
              chunks.push(chunk);
            }
            body = Buffer.concat(chunks);
            let data;
            try { data = JSON.parse(body); }
            catch { return json(400, { error: 'invalid_json' }); }
            if (data?.mode !== 'chat') return json(400, { error: 'chat_only' });
          }
          let token;
          try { token = JSON.parse(await readFile(join(runtime, 'private-settings.json'), 'utf8')).GatewayToken; }
          catch (error) { if (error.code !== 'ENOENT') throw error; }
          const upstream = await fetchImpl('http://127.0.0.1:8094' + (chat ? '/' : '/metrics'), {
            method: chat ? 'POST' : 'GET', body, redirect: 'error', signal: controller.signal,
            headers: { Origin: 'https://nishad.ai', 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }
          });
          if (!chat) {
            if (!upstream.ok) return json(503, { error: 'local_metrics_unavailable' });
            return json(200, publicMetrics(await upstream.json()));
          }
          response.writeHead(upstream.status, {
            'Content-Type': upstream.headers.get('content-type') || 'application/json',
            'Cache-Control': 'no-store, no-transform',
            ...(upstream.headers.has('retry-after') ? { 'Retry-After': upstream.headers.get('retry-after') } : {})
          });
          if (upstream.body) await pipeline(Readable.fromWeb(upstream.body), response);
          else response.end();
        } catch {
          console.error('Local gateway proxy unavailable or request interrupted.');
          if (!response.headersSent && !response.destroyed) json(503, { error: 'local_gateway_unavailable' });
          else if (!response.destroyed) response.destroy();
        } finally { clearTimeout(timer); }
        return;
      }
      if (!['GET', 'HEAD'].includes(request.method)) return json(405, { error: 'method_not_allowed' });
      if (path === '/deployment.js') {
        // Override only this local HTTP response; no public configuration is edited.
        const config = {
          PRIVATE_DASHBOARD_ORIGIN: '', ANALYTICS_ENDPOINT: '', ADSENSE_CLIENT: '', ADSENSE_SLOT: '',
          INFERENCE_CHAT_ENDPOINT: origin + '/__local/chat',
          INFERENCE_METRICS_ENDPOINT: origin + '/__local/metrics'
        };
        response.writeHead(200, { 'Content-Type': 'application/javascript', 'Cache-Control': 'no-store' });
        response.end(Object.entries(config).map(([key, value]) => `export const ${key} = ${JSON.stringify(value)};`).join('\n'));
        return;
      }
      if (path.includes('\0') || path.includes('\\') || path.includes(':')) return json(400, { error: 'invalid_path' });
      let file = resolve(directory, '.' + path);
      if (file !== directory && !file.startsWith(directory + sep)) return json(403, { error: 'path_not_allowed' });
      let info;
      try { info = await stat(file); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (info?.isDirectory()) {
        if (!path.endsWith('/')) {
          response.writeHead(301, { Location: path + '/', 'Cache-Control': 'no-store' }); response.end(); return;
        }
        file = join(file, 'index.html');
        try { info = await stat(file); }
        catch (error) { if (error.code !== 'ENOENT') throw error; info = null; }
      }
      const found = info?.isFile();
      if (!found) file = join(directory, '404.html');
      response.writeHead(found ? 200 : 404, {
        'Content-Type': types[extname(file)] || 'application/octet-stream',
        'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'
      });
      if (request.method === 'HEAD') response.end();
      else await pipeline(createReadStream(file), response);
    } catch {
      console.error('Local preview request failed.');
      if (!response.headersSent) json(500, { error: 'local_preview_error' });
      else response.destroy();
    }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = createPreviewServer();
  server.on('error', error => { console.error(`Preview server failed (${error.code || 'unknown'}).`); process.exitCode = 1; });
  server.listen(8000, '127.0.0.1', () => console.log('Local site: http://127.0.0.1:8000/ · metrics: http://127.0.0.1:8000/metrics/'));
}
