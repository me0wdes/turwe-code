const { McpSafeError } = require('./mcp-oauth.cjs');
const { parseErrorResponse } = require('@modelcontextprotocol/sdk/client/auth.js');
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
function createBoundedFetch({ signal, fetch: fetchImpl = globalThis.fetch, oauthMetadata = () => undefined }) {
  return async (input, init = {}) => {
    const url = validateHttpUrl(input instanceof Request ? input.url : input);
    const metadata = oauthMetadata();
    const phase = init.method?.toUpperCase() === 'POST'
      ? url.href === metadata?.registration_endpoint ? 'registration'
        : url.href === metadata?.token_endpoint ? 'token' : undefined
      : undefined;
    const checkOAuth = async response => {
      if (phase && response.status >= 400) {
        // Preserve SDK error classes so invalid_client/invalid_grant recovery
        // still works, but retain the HTTP facts before the SDK discards them.
        const body = await response.text();
        const error = await parseErrorResponse(body);
        // A malformed/non-JSON response makes the SDK synthesize server_error.
        // Do not report that synthetic value as an error returned by the service.
        let oauthCode = null;
        try { oauthCode = JSON.parse(body).error ?? null; } catch { /* HTTP facts suffice. */ }
        error.mcpOAuthCode = oauthCode;
        error.mcpPhase = phase;
        error.httpStatus = response.status;
        throw error;
      }
      return response;
    };
    const timeout = new AbortController();
    const requestSignal = AbortSignal.any([timeout.signal, ...(signal ? [signal] : []), ...(init.signal ? [init.signal] : [])]);
    let timer = setTimeout(() => timeout.abort(), 30_000);
    timer.unref();
    let response;
    try { response = await fetchImpl(url.href, { ...init, redirect: 'manual', signal: requestSignal }); }
    catch (error) { clearTimeout(timer); if (phase && error instanceof Error) error.mcpPhase = phase; throw error; }
    if (!response.body) { clearTimeout(timer); return checkOAuth(response); }
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
    return checkOAuth(new Response(limited, { status: response.status, statusText: response.statusText, headers: response.headers }));
  };
}

module.exports = { createBoundedFetch, validateHttpUrl, MAX_PROTOCOL_BYTES };
