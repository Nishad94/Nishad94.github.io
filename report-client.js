export const REPORT_ENDPOINT = 'https://nishad-ai-proxy.nishad-dawkhar94.workers.dev';

export async function requestReport(url, messages, { signal, onStage = () => {}, fetchImpl = fetch } = {}) {
  try {
    onStage('requesting');
    const response = await fetchImpl(url, {
      method: 'POST',
      signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(180000)]),
      credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer', redirect: 'error',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages })
    });
    signal?.throwIfAborted();
    if (!response.ok) {
      const code = await response.json().then(json => json?.error, () => '');
      const reasons = {
        queue_full: 'The AI request queue is full. Wait before retrying.',
        queue_timeout: 'The AI request waited too long in the queue. Retry manually.',
        visitor_limit: 'You have used today’s free AI reports. Try again tomorrow.',
        global_limit: 'The site’s free AI budget for today is used up. Try again later.',
        ai_not_configured: 'The site’s AI service is not configured yet.',
        mac_not_configured: 'The site’s Mac AI service is not configured yet.',
        origin_not_allowed: 'The AI service does not accept requests from this origin.',
        payload_too_large: 'This music-data sample is too large for the AI service. No report was generated.',
        busy: 'Mac-hosted Gemma is busy with another request. Wait before trying again; no automatic retry.',
        mac_unreachable: 'The Mac AI service is unreachable. Try again later; no automatic retry.',
        upstream_unreachable: 'The Gemma model is unavailable. Try again later; no automatic retry.',
        upstream_timeout: 'Gemma did not complete the report before the service deadline. Retry manually.',
        upstream_incomplete: 'The AI response was interrupted before confirmed completion. No result was invented.',
        upstream_invalid_response: 'The AI service returned a malformed response. No result was invented.',
        upstream_failed: 'Gemma failed while generating the report. No result was invented.',
        request_cancelled: 'AI report cancelled.'
      };
      throw new Error(reasons[code] || 'The AI service failed (HTTP ' + response.status + '). No automatic retry.');
    }
    const type = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (type !== 'application/json') {
      throw new Error('The AI service returned the wrong report format (expected JSON, not a stream or web page). The service needs repair; no result was invented.');
    }
    let envelope;
    try { envelope = await response.json(); }
    catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
      throw new Error('The AI service returned unreadable report JSON. No result was invented.');
    }
    if (envelope?.finish_reason === 'length') {
      throw new Error('Gemma reached its output limit before finishing the report. No partial report was used. Retry manually.');
    }
    if (envelope?.finish_reason !== 'stop' || typeof envelope?.content !== 'string' || !envelope.content.trim()) {
      throw new Error('AI report was refused, truncated, or empty. No result was invented.');
    }
    signal?.throwIfAborted();
    onStage('validating');
    const raw = envelope.content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    try { return JSON.parse(raw); }
    catch { throw new Error('AI returned invalid JSON; no result was invented. Retry manually.'); }
  } catch (error) {
    if (signal?.aborted) throw new Error('AI report cancelled.');
    if (error instanceof TypeError || error.name === 'TimeoutError' || error.name === 'AbortError') {
      throw new Error('The AI service is unreachable or timed out. No result was invented.');
    }
    throw error;
  }
}
