// Cloudflare Worker: owner-funded OpenAI proxy for the music reports.
// Secret OPENAI_API_KEY lives only in Worker secrets. Optional KV binding RATE
// gives shared counters; without it, counters are per-isolate and best-effort.
const MODEL = 'gpt-4o';
const MAX_TOKENS = 2600;
const MAX_BODY = 32 * 1024;
const DEFAULTS = { ALLOWED_ORIGINS: 'https://nishad.ai', PER_IP_DAILY: '5', GLOBAL_DAILY: '200', CHAT_PER_IP_DAILY: '40', CHAT_GLOBAL_DAILY: '1000' };
const memory = new Map();

function cors(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin'
  };
}

function reply(status, body, origin, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...(origin ? cors(origin) : {}), ...extra }
  });
}

async function bump(env, key, limit) {
  const day = new Date().toISOString().slice(0, 10);
  const id = key + ':' + day;
  const current = env.RATE ? Number(await env.RATE.get(id)) || 0 : memory.get(id) || 0;
  if (current >= limit) return false;
  if (env.RATE) await env.RATE.put(id, String(current + 1), { expirationTtl: 172800 });
  else memory.set(id, current + 1);
  return true;
}

function validMessages(messages) {
  return Array.isArray(messages) && messages.length >= 1 && messages.length <= 4 &&
    messages.every(m => m && (m.role === 'system' || m.role === 'user') && typeof m.content === 'string' && m.content.length <= 20000);
}

export async function handle(request, env, upstream = fetch) {
  const cfg = { ...DEFAULTS, ...env };
  const allowed = String(cfg.ALLOWED_ORIGINS).split(',').map(s => s.trim()).filter(Boolean);
  const origin = request.headers.get('Origin');
  const okOrigin = origin && allowed.includes(origin) ? origin : null;
  if (request.method === 'OPTIONS') return okOrigin ? new Response(null, { status: 204, headers: cors(okOrigin) }) : new Response(null, { status: 403 });
  if (!okOrigin) return reply(403, { error: 'origin_not_allowed' });
  if (request.method !== 'POST') return reply(405, { error: 'method_not_allowed' }, okOrigin);
  if (!env.OPENAI_API_KEY) return reply(503, { error: 'ai_not_configured' }, okOrigin);

  const raw = await request.text();
  if (raw.length > MAX_BODY) return reply(413, { error: 'payload_too_large' }, okOrigin);
  let body;
  try { body = JSON.parse(raw); } catch { return reply(400, { error: 'invalid_json' }, okOrigin); }
  if (!validMessages(body?.messages)) return reply(400, { error: 'invalid_messages' }, okOrigin);

  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const chat = body.mode === 'chat';
  const pre = chat ? 'chat:' : '';
  if (!(await bump(env, pre + 'ip:' + ip, Number(chat ? cfg.CHAT_PER_IP_DAILY : cfg.PER_IP_DAILY)))) return reply(429, { error: 'visitor_limit' }, okOrigin, { 'Retry-After': '86400' });
  if (!(await bump(env, pre + 'global', Number(chat ? cfg.CHAT_GLOBAL_DAILY : cfg.GLOBAL_DAILY)))) return reply(429, { error: 'global_limit' }, okOrigin, { 'Retry-After': '3600' });

  let res;
  try {
    res = await upstream('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + env.OPENAI_API_KEY },
      body: JSON.stringify({ model: MODEL, messages: body.messages, temperature: 0.85, max_tokens: chat ? 700 : MAX_TOKENS, ...(chat ? {} : { response_format: { type: 'json_object' } }) })
    });
  } catch { return reply(502, { error: 'upstream_unreachable' }, okOrigin); }
  if (!res.ok) return reply(502, { error: 'upstream_error', status: res.status }, okOrigin);
  const json = await res.json();
  const choice = json?.choices?.[0];
  return reply(200, { content: choice?.message?.content ?? null, finish_reason: choice?.finish_reason ?? null }, okOrigin);
}

export const resetMemory = () => memory.clear();

export default { fetch: (request, env) => handle(request, env) };
