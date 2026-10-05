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
