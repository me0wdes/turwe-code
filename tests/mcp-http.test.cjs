const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createBoundedFetch, MAX_PROTOCOL_BYTES } = require('../electron/mcp-http.cjs');

test('HTTP transport rejects oversized JSON before returning parsed content', async () => {
  const fetch = createBoundedFetch({ fetch: async () => new Response('x'.repeat(MAX_PROTOCOL_BYTES + 1), { headers: { 'Content-Type': 'application/json' } }) });
  const response = await fetch('https://mcp.example/mcp');
  await assert.rejects(response.text(), /limit/i);
});

test('HTTP transport bounds individual SSE events while permitting many small events', async () => {
  const large = createBoundedFetch({ fetch: async () => new Response(`data: ${'x'.repeat(MAX_PROTOCOL_BYTES)}\n\n`, { headers: { 'Content-Type': 'text/event-stream' } }) });
  await assert.rejects((await large('https://mcp.example/mcp')).text(), /limit/i);
  const small = createBoundedFetch({ fetch: async () => new Response('data: ok\n\n'.repeat(900_000), { headers: { 'Content-Type': 'text/event-stream' } }) });
  assert.equal((await (await small('https://mcp.example/mcp')).text()).length, 9_000_000);
});

test('HTTP transport never follows redirects itself or forwards requests to unsafe schemes', async () => {
  let attempts = 0;
  const fetch = createBoundedFetch({ fetch: async (_url, init) => { attempts++; assert.equal(init.redirect, 'manual'); return new Response(null, { status: 302, headers: { Location: 'https://different.example' } }); } });
  assert.equal((await fetch('https://mcp.example/mcp')).status, 302);
  await assert.rejects(fetch('file:///private'), /HTTPS/i);
  await assert.rejects(fetch('http://remote.example/mcp'), /HTTPS/i);
  assert.equal(attempts, 1);
});

test('OAuth diagnostics preserve error classes for SDK recovery and never mistake a token error for registration', async () => {
  const { InvalidGrantError } = require('@modelcontextprotocol/sdk/server/auth/errors.js');
  const metadata = { token_endpoint: 'https://auth.example/token', registration_endpoint: 'https://auth.example/register' };
  const fetch = createBoundedFetch({
    oauthMetadata: () => metadata,
    fetch: async () => new Response(JSON.stringify({ error: 'invalid_grant', error_description: 'expired fixture-code' }), { status: 400 }),
  });
  await assert.rejects(fetch(metadata.token_endpoint, { method: 'POST' }), error => {
    assert.ok(error instanceof InvalidGrantError);
    assert.equal(error.mcpPhase, 'token');
    assert.equal(error.httpStatus, 400);
    return true;
  });
  // The initial MCP 401 must still reach the transport to initiate discovery.
  const transport = createBoundedFetch({ oauthMetadata: () => metadata, fetch: async () => new Response('Unauthorized', { status: 401 }) });
  assert.equal((await transport('https://mcp.example/mcp', { method: 'POST' })).status, 401);
  // Same-origin redirects are handled by the SDK and must not become auth failures.
  const redirect = createBoundedFetch({ oauthMetadata: () => metadata, fetch: async () => new Response(null, { status: 307, headers: { Location: 'https://auth.example/register-v2' } }) });
  assert.equal((await redirect(metadata.registration_endpoint, { method: 'POST' })).status, 307);
});
