import { handle as handleGateway } from '../worker/ai-proxy.js';
import { publicMetrics } from '../assets/inference-metrics-contract.js';

const cooldowns = new Map();
const HEALTH_TIMEOUT_MS = 5000;
const HEADER_TIMEOUT_MS = 30000;
const FAILURE_COOLDOWN_MS = 30000;
const BUSY_COOLDOWN_MS = 3000;
const SEARCH_TIMEOUT_MS = 10000;
const SEARCH_MAX_BODY_BYTES = 4096;
const SEARCH_VISITOR_DAILY_LIMIT = 20;
const SEARCH_GLOBAL_DAILY_LIMIT = 500;
const searchCounts = new Map();

function upstream(value) {
  if (!value) return null;
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password ||
      url.pathname !== '/' || url.search || url.hash) {
    throw new Error('invalid_upstream_configuration');
  }
  return url.origin;
}

export function resetMemory() {
  cooldowns.clear();
  searchCounts.clear();
}

function allowedOrigins(env) {
  return (env.ALLOWED_ORIGIN || 'https://nishad.ai').split(',').map(value => value.trim());
}

function searchQuota(key, limit, now) {
  const day = new Date(now()).toISOString().slice(0, 10);
  const countKey = `${day}:${key}`;
  const count = searchCounts.get(countKey) || 0;
  if (count >= limit) return false;
  searchCounts.set(countKey, count + 1);
  return true;
}

function publicSearchUrl(value) {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    if (url.protocol !== 'https:' || url.username || url.password || hostname === 'localhost' ||
        hostname.endsWith('.local') || /^\d+(?:\.\d+){3}$/.test(hostname) || hostname.startsWith('[')) return null;
    url.hash = '';
    return url.href;
  } catch {
    return null;
  }
}

async function handleSearch(request, env, fetchImpl, now) {
  const origin = request.headers.get('Origin') || '';
  const allowed = allowedOrigins(env).includes(origin);
  const headers = {
    ...(allowed ? { 'Access-Control-Allow-Origin': origin } : {}),
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'Cache-Control': 'no-store',
    'Vary': 'Origin',
    'X-Content-Type-Options': 'nosniff'
  };
  const fail = (error, status, extra = {}) => Response.json({ error }, { status, headers: { ...headers, ...extra } });
  if (!allowed) return fail('origin_not_allowed', 403);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (request.method !== 'POST') return fail('method_not_allowed', 405);
  if (!env.EXA_API_KEY) return fail('search_not_configured', 503);
  let raw, body;
  try {
    raw = await request.arrayBuffer();
    if (raw.byteLength < 1 || raw.byteLength > SEARCH_MAX_BODY_BYTES) return fail('payload_too_large', 413);
    body = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    return fail('invalid_json', 400);
  }
  if (!body || Array.isArray(body) || Object.keys(body).some(key => key !== 'query') ||
      typeof body.query !== 'string' || body.query.trim().length < 3 || body.query.trim().length > 300) {
    return fail('invalid_search_query', 400);
  }
  const visitor = (request.headers.get('CF-Connecting-IP') || 'unknown').slice(0, 64);
  if (!searchQuota(`visitor:${visitor}`, SEARCH_VISITOR_DAILY_LIMIT, now) ||
      !searchQuota('global', SEARCH_GLOBAL_DAILY_LIMIT, now)) {
    return fail('search_quota_exceeded', 429, { 'Retry-After': '3600' });
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);
  try {
    const response = await fetchImpl('https://api.exa.ai/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': env.EXA_API_KEY },
      body: JSON.stringify({
        query: body.query.trim(), type: 'lite', numResults: 5, moderation: true,
        contents: { highlights: true }
      }),
      signal: AbortSignal.any([request.signal, controller.signal]),
      redirect: 'manual'
    });
    if (response.status === 429) return fail('search_rate_limited', 429, { 'Retry-After': response.headers.get('Retry-After') || '60' });
    if (response.status === 402) return fail('search_budget_exhausted', 503);
    if (!response.ok) return fail('search_unavailable', 503);
    const provider = await response.json();
    if (!provider || !Array.isArray(provider.results)) return fail('search_invalid_response', 502);
    const results = [];
    for (const item of provider.results.slice(0, 5)) {
      const url = publicSearchUrl(item?.url);
      if (!url || typeof item?.title !== 'string') continue;
      const highlights = Array.isArray(item.highlights)
        ? item.highlights.filter(value => typeof value === 'string').join(' ')
        : '';
      const snippet = highlights.replace(/\s+/g, ' ').trim().slice(0, 900);
      if (!snippet) continue;
      results.push({
        title: item.title.replace(/\s+/g, ' ').trim().slice(0, 200),
        url,
        snippet,
        published_at: typeof item.publishedDate === 'string' && Number.isFinite(Date.parse(item.publishedDate))
          ? new Date(item.publishedDate).toISOString() : null
      });
    }
    return Response.json({
      schema: 'nishad.web-search.v1',
      query: body.query.trim(),
      retrieved_at: new Date(now()).toISOString(),
      results
    }, { headers });
  } catch (error) {
    if (request.signal.aborted) return fail('request_cancelled', 499);
    return fail(controller.signal.aborted ? 'search_timeout' : 'search_unavailable', controller.signal.aborted ? 504 : 503);
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

export async function handle(request, env, fetchImpl = fetch, now = Date.now) {
  const path = new URL(request.url).pathname;
  if (path === '/search') return handleSearch(request, env, fetchImpl, now);
  if (path === '/metrics') {
    const origin = request.headers.get('Origin');
    const allowed = allowedOrigins(env);
    const headers = {
      'Cache-Control': 'no-store', 'Vary': 'Origin', 'X-Content-Type-Options': 'nosniff',
      ...(origin && allowed.includes(origin) ? { 'Access-Control-Allow-Origin': origin } : {})
    };
    const fail = (error, status) => Response.json({ error }, { status, headers });
    if (origin && !allowed.includes(origin)) return fail('origin_not_allowed', 403);
    if (request.method !== 'GET') return fail('method_not_allowed', 405);
    let routes;
    try {
      routes = [
        { url: upstream(env.LAPTOP_UPSTREAM), token: env.LAPTOP_GATEWAY_TOKEN },
        { url: upstream(env.MAC_UPSTREAM), token: env.MAC_GATEWAY_TOKEN }
      ].filter(route => route.url && route.token);
    } catch {
      return fail('metrics_unavailable', 503);
    }
    if (!routes.length) return fail('metrics_not_configured', 503);
    for (const route of routes) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 7000);
      try {
        const response = await fetchImpl(route.url + '/metrics', {
          headers: { Authorization: 'Bearer ' + route.token },
          signal: AbortSignal.any([request.signal, controller.signal]), redirect: 'manual', cache: 'no-store'
        });
        if (!response.ok) continue;
        const reader = response.body.getReader();
        let raw = '', size = 0;
        const decoder = new TextDecoder('utf-8', { fatal: true });
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) { raw += decoder.decode(); break; }
            size += value.byteLength;
            if (size > 131072) throw new Error('Metrics too large');
            raw += decoder.decode(value, { stream: true });
          }
        } finally {
          await reader.cancel();
          reader.releaseLock();
        }
        return Response.json(publicMetrics(JSON.parse(raw)), { headers });
      } catch {
        // Try the next configured self-hosted gateway.
      } finally {
        clearTimeout(timer);
        controller.abort();
      }
    }
    return fail('metrics_unavailable', 503);
  }
  if (path !== '/') return Response.json({ error: 'not_found' }, { status: 404 });
  // Delegate CORS, payload validation, report collection and response shaping to
  // the existing gateway Worker. Routing never consumes a successful chat stream.
  return handleGateway(request, { ...env, MAC_UPSTREAM: 'https://routing.invalid' }, async (_url, init) => {
    let routes;
    try {
      routes = [
        ...(JSON.parse(new TextDecoder().decode(init.body)).mode === 'chat' || env.LAPTOP_REPORTS === 'true'
          ? [{ url: upstream(env.LAPTOP_UPSTREAM), token: env.LAPTOP_GATEWAY_TOKEN }] : []),
        { url: upstream(env.MAC_UPSTREAM), token: env.MAC_GATEWAY_TOKEN }
      ].filter(route => route.url);
    } catch {
      return Response.json({ error: 'invalid_upstream_configuration' }, { status: 503 });
    }
    if (!routes.length) return Response.json({ error: 'ai_not_configured' }, { status: 503 });
    for (const [key, until] of cooldowns) if (until <= now()) cooldowns.delete(key);
    let last = Response.json({ error: 'upstream_unreachable' }, { status: 503 });
    for (const route of routes) {
      if (init.signal.aborted) throw new DOMException('Cancelled', 'AbortError');
      if ((cooldowns.get(route.url) || 0) > now()) continue;
      const headers = new Headers(init.headers);
      if (route.token) headers.set('Authorization', 'Bearer ' + route.token);
      const health = new AbortController();
      let timer = setTimeout(() => health.abort(), HEALTH_TIMEOUT_MS);
      try {
        const response = await fetchImpl(route.url + '/healthz', {
          headers, redirect: 'manual', cache: 'no-store',
          signal: AbortSignal.any([init.signal, health.signal])
        });
        const state = response.ok ? await response.json() : null;
        if (response.body && !response.bodyUsed) await response.body.cancel();
        if (!response.ok || state?.status !== 'ok') {
          console.log(JSON.stringify({ event: 'upstream_health', status: response.status, ready: false }));
          cooldowns.set(route.url, now() + FAILURE_COOLDOWN_MS);
          continue;
        }
      } catch (error) {
        if (init.signal.aborted) throw new DOMException('Cancelled', 'AbortError');
        console.log(JSON.stringify({
          event: 'upstream_health', status: null, ready: false,
          error: error instanceof Error ? error.name : 'UnknownError',
          detail: error instanceof Error
            ? error.message.replace(/https:\/\/[a-z0-9.-]+/gi, '[upstream]')
            : 'unknown'
        }));
        cooldowns.set(route.url, now() + FAILURE_COOLDOWN_MS);
        continue;
      } finally {
        clearTimeout(timer);
        health.abort();
      }
      const attempt = new AbortController();
      timer = setTimeout(() => attempt.abort(), HEADER_TIMEOUT_MS);
      let response;
      try {
        response = await fetchImpl(route.url + '/', {
          ...init, headers, signal: AbortSignal.any([init.signal, attempt.signal])
        });
      } catch {
        if (init.signal.aborted) throw new DOMException('Cancelled', 'AbortError');
        cooldowns.set(route.url, now() + FAILURE_COOLDOWN_MS);
        // A POST may already be generating. Do not race it against another model.
        return Response.json({ error: attempt.signal.aborted ? 'upstream_timeout' : 'upstream_incomplete' }, {
          status: attempt.signal.aborted ? 504 : 502
        });
      } finally {
        clearTimeout(timer);
      }
      if (response.ok) {
        const type = (response.headers.get('content-type') || '').split(';')[0].trim();
        if (type !== 'text/event-stream' && type !== 'application/json') {
          await response.body?.cancel();
          return Response.json({ error: 'upstream_invalid_response' }, { status: 502 });
        }
        return response;
      }
      // Retry only an explicit rejection before generation. Quota/auth/input
      // failures, timeouts, and ambiguous transport failures are not retried.
      const type = response.headers.get('content-type') || '';
      if (response.status !== 503 || !type.startsWith('application/json')) return response;
      let error;
      try { error = await response.json(); }
      catch { return Response.json({ error: 'upstream_invalid_response' }, { status: 502 }); }
      last = Response.json(error, { status: 503, headers: {
        'Retry-After': response.headers.get('Retry-After') || '15'
      } });
      if (!['busy', 'upstream_unreachable'].includes(error?.error)) return last;
      cooldowns.set(route.url, now() + (error.error === 'busy' ? BUSY_COOLDOWN_MS : FAILURE_COOLDOWN_MS));
    }
    return last;
  });
}

export default { fetch: (request, env) => handle(request, env) };
