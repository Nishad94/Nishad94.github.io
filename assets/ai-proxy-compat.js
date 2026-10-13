// Report requests must retain report mode so the Worker and gateway enable JSON output.
// The Worker collects gateway SSE and returns {content, finish_reason} as JSON.
// Do not rewrite reports as mode:'chat': that silently disables structured generation.
export {};
