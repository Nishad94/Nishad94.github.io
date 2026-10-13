const PROXY_HOST = 'nishad-ai-proxy.nishad-dawkhar94.workers.dev';

function isReportRequest(input, init) {
  try {
    const url = new URL(typeof input === 'string' ? input : input.url, location.href);
    if (url.hostname !== PROXY_HOST || (init?.method || 'GET').toUpperCase() !== 'POST') return false;
    if (typeof init?.body !== 'string') return false;
    const body = JSON.parse(init.body);
    return Array.isArray(body?.messages) && !body.mode;
  } catch {
    return false;
  }
}

async function collectSSE(response) {
  const reader = response.body?.getReader();
  if (!reader) return response;
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';
  let finishReason = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split('\n\n');
    buffer = events.pop() || '';
    for (const event of events) {
      const line = event.split('\n').find(part => part.startsWith('data:'));
      if (!line) continue;
      const raw = line.slice(5).trim();
      if (!raw || raw === '[DONE]') continue;
      try {
        const data = JSON.parse(raw);
        if (typeof data.delta === 'string') content += data.delta;
        if (typeof data.finish_reason === 'string') finishReason = data.finish_reason;
      } catch {
        // Ignore malformed keepalive events; the caller will validate the final payload.
      }
    }
  }

  return new Response(JSON.stringify({
    content,
    finish_reason: finishReason || (content.trim() ? 'stop' : null)
  }), {
    status: response.status,
    statusText: response.statusText,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
}

const nativeFetch = window.fetch.bind(window);
window.fetch = async function patchedFetch(input, init) {
  if (!isReportRequest(input, init)) return nativeFetch(input, init);

  const body = JSON.parse(init.body);
  const response = await nativeFetch(input, {
    ...init,
    body: JSON.stringify({ ...body, mode: 'chat' })
  });

  const type = response.headers.get('content-type') || '';
  if (!response.ok || !type.includes('text/event-stream')) return response;
  return collectSSE(response);
};
