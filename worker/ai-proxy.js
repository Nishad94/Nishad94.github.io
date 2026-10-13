const REPORT_DEADLINE_MS = 150000;
const MAX_REPORT_BYTES = 131072;

class ReportError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

async function collectReportSSE(upstream) {
  if (!upstream.body) throw new ReportError('upstream_incomplete');
  const reader = upstream.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let buffer = '', content = '', finishReason = null, completed = false, bytes = 0;
  function consume(frame) {
    const raw = frame.split(/\r?\n/).filter(line => line.startsWith('data:'))
      .map(line => line.slice(5).trimStart()).join('\n').trim();
    if (!raw) return;
    if (raw === '[DONE]') { completed = true; return; }
    let event;
    try { event = JSON.parse(raw); }
    catch { throw new ReportError('upstream_invalid_response'); }
    if (!event || typeof event !== 'object' || Array.isArray(event) ||
        (event.delta !== undefined && typeof event.delta !== 'string') ||
        (event.finish_reason != null && typeof event.finish_reason !== 'string')) {
      throw new ReportError('upstream_invalid_response');
    }
    if (event.error) {
      throw new ReportError(['upstream_timeout', 'upstream_incomplete', 'upstream_invalid_response'].includes(event.error)
        ? event.error : 'upstream_failed');
    }
    if (typeof event.delta === 'string') content += event.delta;
    if (typeof event.finish_reason === 'string') finishReason = event.finish_reason;
    if (event.done === true) completed = true;
  }
  try {
    while (!completed) {
      const { done, value } = await reader.read();
      if (done) {
        buffer += decoder.decode();
        if (buffer.trim()) consume(buffer);
        break;
      }
      bytes += value.byteLength;
      if (bytes > MAX_REPORT_BYTES) throw new ReportError('upstream_invalid_response');
      buffer += decoder.decode(value, { stream: true });
      const frames = buffer.split(/\r?\n\r?\n/);
      buffer = frames.pop();
      for (const frame of frames) {
        consume(frame);
        if (completed) break;
      }
    }
  } finally {
    reader.releaseLock();
  }
  if (!completed || !finishReason || !content.trim()) throw new ReportError('upstream_incomplete');
  return { content, finish_reason: finishReason };
}

export async function handle(request, env, upstreamFetch = fetch) {
  const origin = request.headers.get('Origin') || '';
  const origins = (env.ALLOWED_ORIGIN || 'https://nishad.ai').split(',').map(value => value.trim());
  const allowed = Boolean(origin) && origins.includes(origin);
  const cors = {
    ...(allowed ? { 'Access-Control-Allow-Origin': origin } : {}),
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
    'Cache-Control': 'no-store, no-transform'
  };
  const failure = (error, status) => Response.json({ error }, { status, headers: cors });
  if (!allowed) return failure('origin_not_allowed', 403);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (request.method !== 'POST') return failure('method_not_allowed', 405);
  let raw, body;
  try {
    raw = await request.arrayBuffer();
    if (raw.byteLength > 32768) return failure('payload_too_large', 413);
    body = JSON.parse(new TextDecoder().decode(raw));
    if (!Array.isArray(body?.messages)) return failure('invalid_json', 400);
  } catch {
    return failure(request.signal.aborted ? 'request_cancelled' : 'invalid_json', request.signal.aborted ? 499 : 400);
  }
  if (!env.MAC_UPSTREAM) return failure('mac_not_configured', 503);
  const headers = new Headers({
    'Content-Type': 'application/json', Origin: origin,
    'X-Real-IP': request.headers.get('CF-Connecting-IP') || 'unknown',
    'User-Agent': 'curl/8.7.1'
  });
  // Omitted mode is the production report contract; only terminal chat streams.
  const isReport = body.mode !== 'chat';
  const deadline = new AbortController();
  const timer = isReport ? setTimeout(() => deadline.abort(), REPORT_DEADLINE_MS) : null;
  const signal = isReport ? AbortSignal.any([request.signal, deadline.signal]) : request.signal;
  let upstream;
  try {
    upstream = await upstreamFetch(env.MAC_UPSTREAM.replace(/\/$/, '') + '/', {
      method: 'POST', headers, body: raw, redirect: 'manual', signal
    });
    const type = (upstream.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (isReport && upstream.ok) {
      let envelope;
      if (type === 'text/event-stream') envelope = await collectReportSSE(upstream);
      else if (type === 'application/json') {
        try { envelope = await upstream.json(); }
        catch { throw new ReportError('upstream_invalid_response'); }
        if (typeof envelope?.content !== 'string' || !envelope.content.trim() ||
            typeof envelope?.finish_reason !== 'string' || !envelope.finish_reason) {
          throw new ReportError('upstream_incomplete');
        }
      } else throw new ReportError('upstream_invalid_response');
      return Response.json(envelope, { headers: cors });
    }
    const out = new Headers(upstream.headers);
    for (const [key, value] of Object.entries(cors)) out.set(key, value);
    // Reports are buffered before their deadline controller is released.
    const responseBody = isReport ? await upstream.arrayBuffer() : upstream.body;
    return new Response(responseBody, { status: upstream.status, headers: out });
  } catch (error) {
    if (request.signal.aborted) return failure('request_cancelled', 499);
    if (deadline.signal.aborted || error.name === 'TimeoutError' || error.code === 'upstream_timeout') {
      return failure('upstream_timeout', 504);
    }
    return failure(error instanceof ReportError ? error.code : upstream ? 'upstream_incomplete' : 'mac_unreachable', 502);
  } finally {
    if (timer !== null) {
      clearTimeout(timer);
      deadline.abort();
    }
  }
}

export const resetMemory = () => {};
export default { fetch: (request, env) => handle(request, env) };
