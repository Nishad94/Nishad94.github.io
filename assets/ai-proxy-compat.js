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

async function readSSEBody(response) {
  const reader = response.body?.getReader();
  if (!reader) return { content: '', finish_reason: null };
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';
  let finishReason = null;

  const consume = (event) => {
    for (const line of event.split('\n')) {
      if (!line.startsWith('data:')) continue;
      const raw = line.slice(5).trim();
      if (!raw || raw === '[DONE]') continue;
      try {
        const data = JSON.parse(raw);
        if (typeof data.delta === 'string') content += data.delta;
        if (typeof data.finish_reason === 'string') finishReason = data.finish_reason;
      } catch {
        // Ignore malformed keepalive events.
      }
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split('\n\n');
    buffer = events.pop() || '';
    events.forEach(consume);
  }
  buffer += decoder.decode();
  if (buffer.trim()) consume(buffer);

  return {
    content,
    finish_reason: finishReason || (content.trim() ? 'stop' : null)
  };
}

async function collectSSE(response) {
  const parsed = await readSSEBody(response);
  return new Response(JSON.stringify(parsed), {
    status: response.status,
    statusText: response.statusText,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
}

if (typeof window !== 'undefined' && typeof Response !== 'undefined') {
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

  // Defensive fallback: if a report response reaches existing code as raw SSE and it calls
  // response.json(), decode the event stream rather than throwing on the leading `data:` token.
  const nativeResponseJson = Response.prototype.json;
  Response.prototype.json = async function patchedResponseJson() {
    const type = this.headers.get('content-type') || '';
    if (type.includes('text/event-stream')) return readSSEBody(this);
    return nativeResponseJson.call(this);
  };
}