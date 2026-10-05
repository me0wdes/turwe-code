const { McpSafeError } = require('./mcp-oauth.cjs');
const MAX_PROTOCOL_BYTES = 8 * 1024 * 1024;

function validateHttpUrl(value, { query = true } = {}) {
  let url;
  try { url = new URL(value); } catch { throw new McpSafeError('Enter a valid MCP server URL.'); }
  const local = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) throw new McpSafeError('MCP URLs must use HTTPS, except local loopback servers.');
  if (url.username || url.password || url.hash) throw new McpSafeError('MCP URLs cannot contain embedded credentials or fragments.');
  if (!query && url.search) throw new McpSafeError('Use a bearer token or OAuth instead of URL query credentials.');
  return url;
}

// Enforce limits before SDK JSON/SSE parsing. SSE streams may stay open, but
// each event has the same bound as an ordinary JSON protocol response.
function createBoundedFetch({ signal, fetch: fetchImpl = globalThis.fetch }) {
  return async (input, init = {}) => {
    const url = validateHttpUrl(input instanceof Request ? input.url : input);
    const timeout = new AbortController();
    const requestSignal = AbortSignal.any([timeout.signal, ...(signal ? [signal] : []), ...(init.signal ? [init.signal] : [])]);
    let timer = setTimeout(() => timeout.abort(), 30_000);
    timer.unref();
    let response;
    try { response = await fetchImpl(url.href, { ...init, redirect: 'manual', signal: requestSignal }); }
    catch (error) { clearTimeout(timer); throw error; }
    if (!response.body) { clearTimeout(timer); return response; }
    const isSse = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() === 'text/event-stream';
    if (isSse) { clearTimeout(timer); timer = undefined; }
    const length = Number(response.headers.get('content-length'));
    if (length > MAX_PROTOCOL_BYTES && !isSse) {
      clearTimeout(timer);
      await response.body.cancel();
      throw new McpSafeError('MCP response exceeded the 8 MB protocol limit.', 'MCP_LIMIT');
    }
    const reader = response.body.getReader();
    let bytes = 0;
    let line = 0;
    let previous = 0;
    const limited = new ReadableStream({
      async pull(controller) {
        try {
          const { value, done } = await reader.read();
          if (done) { clearTimeout(timer); controller.close(); return; }
          if (isSse) {
            for (const byte of value) {
              bytes++; line++;
              if (bytes > MAX_PROTOCOL_BYTES) throw new McpSafeError('MCP event exceeded the 8 MB protocol limit.', 'MCP_LIMIT');
              if (byte === 10) {
                if (line === 1 || (line === 2 && previous === 13)) bytes = 0;
                line = 0;
              }
              previous = byte;
            }
          } else {
            bytes += value.byteLength;
            if (bytes > MAX_PROTOCOL_BYTES) throw new McpSafeError('MCP response exceeded the 8 MB protocol limit.', 'MCP_LIMIT');
          }
          controller.enqueue(value);
        } catch (error) {
          clearTimeout(timer);
          void reader.cancel().catch(() => {});
          controller.error(error);
        }
      },
      async cancel(reason) { clearTimeout(timer); await reader.cancel(reason); },
    });
    return new Response(limited, { status: response.status, statusText: response.statusText, headers: response.headers });
  };
}

module.exports = { createBoundedFetch, validateHttpUrl, MAX_PROTOCOL_BYTES };
