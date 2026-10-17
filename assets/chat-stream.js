export async function readChatStream(body, onDelta) {
  if (!body) throw new Error('AI response has no stream.');
  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let buffer = '', content = '', finishReason = null, completed = false, bytes = 0;
  function consume(frame) {
    const raw = frame.split(/\r?\n/).filter(line => line.startsWith('data:'))
      .map(line => line.slice(5).trimStart()).join('\n').trim();
    if (!raw) return;
    const event = JSON.parse(raw);
    if (!event || typeof event !== 'object' || Array.isArray(event) ||
        (event.delta !== undefined && typeof event.delta !== 'string') ||
        (event.finish_reason != null && !['stop', 'length'].includes(event.finish_reason))) {
      throw new Error('AI returned a malformed stream.');
    }
    if (event.error) throw new Error('AI generation was interrupted.');
    if (event.delta) {
      content += event.delta;
      onDelta(event.delta);
    }
    if (event.finish_reason) finishReason = event.finish_reason;
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
      if (bytes > 131072) throw new Error('AI response exceeded the stream limit.');
      buffer += decoder.decode(value, { stream: true });
      const frames = buffer.split(/\r?\n\r?\n/);
      buffer = frames.pop();
      for (const frame of frames) {
        consume(frame);
        if (completed) break;
      }
    }
    if (!completed || !finishReason || !content.trim()) throw new Error('AI stream ended without confirmed completion.');
    return { content, finishReason };
  } finally {
    try { await reader.cancel(); }
    finally { reader.releaseLock(); }
  }
}
