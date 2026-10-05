const http = require('node:http');
const { randomBytes, timingSafeEqual } = require('node:crypto');

class McpSafeError extends Error {
  constructor(message, code = 'MCP_ERROR') { super(message); this.name = 'McpSafeError'; this.code = code; }
}

// A loopback redirect is allocated once per connector and persisted with its
// encrypted OAuth registration. Reuse it on reconnect; if occupied, register
// again with a new port instead of sending credentials to another process.
async function createOAuthProvider({ read, write, openExternal, onAuthorize = () => {}, signal, timeoutMs = 180_000 }) {
  if (signal?.aborted) throw new McpSafeError('Connection cancelled.', 'MCP_CANCELLED');
  if (typeof openExternal !== 'function') throw new McpSafeError('A system browser is required for OAuth sign-in.');
  const state = randomBytes(32).toString('base64url');
  let verifier;
  let interactive = true;
  let settled = false;
  let stopped = false;
  let redirectUrl;
  let authorizationUrl;
  let timer;
  let resolveCode;
  let rejectCode;
  const callback = new Promise((resolve, reject) => { resolveCode = resolve; rejectCode = reject; });
  callback.catch(() => {}); // May be cancelled before the SDK requests a redirect.
  function settle(error, code) {
    if (settled) return;
    settled = true;
    authorizationUrl = undefined;
    if (error) rejectCode(error); else resolveCode(code);
  }
  const server = http.createServer({ maxHeaderSize: 8192 }, (req, res) => {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
    const send = (status, text) => { res.writeHead(status); res.end(text); };
    const expected = new URL(redirectUrl);
    if (req.method !== 'GET') return send(405, 'Method not allowed.');
    if (req.headers.host !== expected.host || (req.headers.origin && req.headers.origin !== expected.origin)) return send(400, 'Invalid callback host.');
    if (!req.url || req.url.length > 8192) return send(400, 'Invalid callback.');
    let url;
    try { url = new URL(req.url, expected.origin); } catch { return send(400, 'Invalid callback.'); }
    if (url.origin !== expected.origin || url.pathname !== expected.pathname) return send(404, 'Not found.');
    if (settled || !interactive) return send(409, 'This sign-in attempt has finished.');
    const incoming = url.searchParams.get('state') || '';
    if (url.searchParams.getAll('state').length !== 1 || incoming.length !== state.length || !/^[A-Za-z0-9_-]+$/.test(incoming) || !timingSafeEqual(Buffer.from(incoming), Buffer.from(state))) return send(400, 'Invalid sign-in state.');
    if (url.searchParams.has('error')) {
      send(400, 'Sign-in was declined. Return to Turwe Code to retry.');
      settle(new McpSafeError('OAuth sign-in was declined.', 'MCP_AUTH'));
      return;
    }
    const code = url.searchParams.get('code');
    if (!code || code.length > 4096 || url.searchParams.getAll('code').length !== 1) return send(400, 'Missing authorization code.');
    send(200, 'Sign-in received. You can close this window and return to Turwe Code.');
    settle(null, code);
  });
  server.requestTimeout = 5000;
  server.headersTimeout = 5000;
  server.keepAliveTimeout = 1000;
  server.on('clientError', (_error, socket) => socket.destroy());
  const listen = (port) => new Promise((resolve, reject) => {
    const onError = (error) => { server.off('listening', onReady); reject(error); };
    const onReady = () => { server.off('error', onError); resolve(); };
    server.once('error', onError);
    server.once('listening', onReady);
    server.listen({ port, host: '127.0.0.1', exclusive: true });
  });
  const previousPort = read().redirectPort;
  try {
    await listen(Number.isInteger(previousPort) && previousPort > 1023 && previousPort < 65536 ? previousPort : 0);
  } catch (error) {
    if (error.code !== 'EADDRINUSE' || !previousPort) throw new McpSafeError('Unable to start the local OAuth callback.');
    await listen(0);
  }
  const port = server.address().port;
  redirectUrl = `http://127.0.0.1:${port}/oauth/callback`;
  const portChanged = previousPort && previousPort !== port;
  try { write({ ...(portChanged ? {} : read()), redirectPort: port }); }
  catch (error) { server.closeAllConnections(); server.close(); throw error; }
  async function stop() {
    if (stopped) return;
    stopped = true;
    interactive = false;
    authorizationUrl = undefined;
    clearTimeout(timer);
    signal?.removeEventListener('abort', cancel);
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
  function cancel() {
    settle(new McpSafeError('OAuth sign-in cancelled.', 'MCP_CANCELLED'));
    void stop();
  }
  signal?.addEventListener('abort', cancel, { once: true });
  timer = setTimeout(() => {
    settle(new McpSafeError('OAuth sign-in timed out. Connect again to retry.', 'MCP_TIMEOUT'));
    void stop();
  }, Math.min(Math.max(timeoutMs, 1), 180_000));
  timer.unref();
  if (signal?.aborted) cancel();
  return {
    redirectUrl,
    get clientMetadata() { return { client_name: 'Turwe Code', redirect_uris: [redirectUrl], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none' }; },
    state: () => state,
    clientInformation: () => read().clientInformation,
    saveClientInformation: (value) => write({ ...read(), clientInformation: value }),
    tokens: () => read().tokens,
    saveTokens(value) {
      const before = read();
      const refresh = before.tokens?.issuer === value.issuer ? before.tokens?.refresh_token : undefined;
      write({ ...before, tokens: { ...(refresh ? { refresh_token: refresh } : {}), ...value } });
    },
    saveCodeVerifier(value) { verifier = value; },
    codeVerifier() { if (!verifier) throw new McpSafeError('OAuth sign-in expired. Connect again.', 'MCP_AUTH'); return verifier; },
    async redirectToAuthorization(value) {
      if (!interactive || signal?.aborted) throw new McpSafeError('Authentication required. Use Connect to sign in again.', 'MCP_AUTH');
      const url = new URL(value);
      if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw new McpSafeError('OAuth authorization URL must use HTTPS without embedded credentials.', 'MCP_AUTH');
      if (url.searchParams.get('state') !== state || url.searchParams.get('redirect_uri') !== redirectUrl) throw new McpSafeError('Invalid OAuth authorization redirect.', 'MCP_AUTH');
      authorizationUrl = url.href;
      onAuthorize();
      await openExternal(authorizationUrl);
    },
    async reopenAuthorization() {
      if (!interactive || settled || signal?.aborted || !authorizationUrl) throw new McpSafeError('Sign-in is no longer pending. Connect again to start a new sign-in.', 'MCP_AUTH');
      await openExternal(authorizationUrl);
    },
    discoveryState: () => read().discovery,
    saveDiscoveryState: (value) => write({ ...read(), discovery: value }),
    invalidateCredentials(scope) {
      const value = { ...read() };
      if (scope === 'all' || scope === 'client') delete value.clientInformation;
      if (scope === 'all' || scope === 'tokens') delete value.tokens;
      if (scope === 'all' || scope === 'discovery') delete value.discovery;
      if (scope === 'all' || scope === 'verifier') verifier = undefined;
      write(value);
    },
    waitForCallback: () => callback,
    async complete() { verifier = undefined; settle(new McpSafeError('OAuth flow finished.', 'MCP_CANCELLED')); await stop(); },
    async close() { verifier = undefined; cancel(); await stop(); },
  };
}

module.exports = { createOAuthProvider, McpSafeError };
