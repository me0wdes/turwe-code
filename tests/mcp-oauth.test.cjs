const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createOAuthProvider } = require('../electron/mcp-oauth.cjs');

test('OAuth callback requires state, correct host and path, and accepts a code exactly once', async (t) => {
  let saved = {};
  let opened;
  const provider = await createOAuthProvider({ read: () => saved, write: (value) => { saved = value; }, openExternal: async (url) => { opened = url; } });
  t.after(() => provider.close());
  await provider.saveCodeVerifier('verifier-private-123');
  const state = await provider.state();
  assert.ok(state.length >= 32);
  const authorization = new URL('https://accounts.example/authorize');
  authorization.searchParams.set('state', state);
  authorization.searchParams.set('redirect_uri', provider.redirectUrl);
  await provider.redirectToAuthorization(authorization);
  assert.equal(opened, authorization.href);
  assert.equal((await fetch(`${provider.redirectUrl}?code=good&state=wrong`)).status, 400);
  assert.equal((await fetch(`${provider.redirectUrl}?code=good&state=${encodeURIComponent('é'.repeat(state.length))}`)).status, 400);
  assert.equal((await fetch(`${provider.redirectUrl.replace('/oauth/callback', '/wrong')}?code=good&state=${state}`)).status, 404);
  const badHostStatus = await new Promise((resolve, reject) => {
    const req = http.get(`${provider.redirectUrl}?code=good&state=${state}`, { headers: { Host: 'attacker.example' } }, (res) => { res.resume(); resolve(res.statusCode); });
    req.on('error', reject);
  });
  assert.equal(badHostStatus, 400);
  const success = await fetch(`${provider.redirectUrl}?code=good&state=${state}`);
  assert.equal(success.status, 200);
  assert.equal(await provider.waitForCallback(), 'good');
  assert.equal(await provider.codeVerifier(), 'verifier-private-123');
  await provider.close();
  assert.equal(JSON.stringify(saved).includes('verifier-private-123'), false);
});

test('OAuth credentials preserve issuer and refresh tokens while browser redirects reject unsafe URLs', async (t) => {
  let saved = {};
  const opened = [];
  const provider = await createOAuthProvider({ read: () => saved, write: (value) => { saved = value; }, openExternal: async (url) => opened.push(url) });
  t.after(() => provider.close());
  await provider.saveClientInformation({ client_id: 'client', issuer: 'https://auth.example' });
  await provider.saveTokens({ access_token: 'old', token_type: 'Bearer', refresh_token: 'refresh-private', issuer: 'https://auth.example' });
  await provider.saveTokens({ access_token: 'new', token_type: 'Bearer', issuer: 'https://auth.example' });
  assert.equal((await provider.tokens()).refresh_token, 'refresh-private');
  assert.equal((await provider.clientInformation()).issuer, 'https://auth.example');
  for (const address of ['file:///a', 'http://auth.example/authorize', 'javascript:alert(1)', 'https://user:pass@auth.example/authorize']) {
    await assert.rejects(provider.redirectToAuthorization(new URL(address)), /HTTPS|authorization|URL/i);
  }
  assert.equal(opened.length, 0);
  await provider.invalidateCredentials('tokens');
  assert.equal(await provider.tokens(), undefined);
});

test('OAuth registration negotiates the server method without advertising unsupported authentication', async t => {
  let saved = {};
  const provider = await createOAuthProvider({ read: () => saved, write: v => { saved = v; }, openExternal: async () => {} });
  t.after(() => provider.close());
  const advertise = methods => provider.saveDiscoveryState({ authorizationServerMetadata: { token_endpoint_auth_methods_supported: methods } });
  assert.equal(provider.clientMetadata.token_endpoint_auth_method, 'none');
  advertise(['client_secret_basic', 'client_secret_post']);
  assert.equal(provider.clientMetadata.token_endpoint_auth_method, 'client_secret_basic');
  advertise(['client_secret_post']);
  assert.equal(provider.clientMetadata.token_endpoint_auth_method, 'client_secret_post');
  advertise(['none', 'client_secret_basic']);
  assert.equal(provider.clientMetadata.token_endpoint_auth_method, 'none');
  advertise(['private_key_jwt']);
  assert.throws(() => provider.clientMetadata, { code: 'MCP_AUTH_METHOD' });
});

test('OAuth cancellation closes the loopback listener and reused ports keep registered redirect URI stable', async (t) => {
  let saved = {};
  const abort = new AbortController();
  const provider = await createOAuthProvider({ read: () => saved, write: (value) => { saved = value; }, openExternal: async () => {}, signal: abort.signal });
  const redirect = provider.redirectUrl;
  const waiting = provider.waitForCallback();
  abort.abort();
  await assert.rejects(waiting, /cancel|abort/i);
  await provider.close();
  await assert.rejects(fetch(redirect));
  const next = await createOAuthProvider({ read: () => saved, write: (value) => { saved = value; }, openExternal: async () => {} });
  t.after(() => next.close());
  assert.equal(next.redirectUrl, redirect);
});

test('a completed OAuth provider cannot open a browser during a model tool call', async (t) => {
  let saved = {};
  let opened = false;
  const provider = await createOAuthProvider({ read: () => saved, write: (value) => { saved = value; }, openExternal: async () => { opened = true; } });
  t.after(() => provider.close());
  await provider.complete();
  await assert.rejects(provider.redirectToAuthorization(new URL('https://auth.example/authorize')), /connect|authenticat/i);
  assert.equal(opened, false);
});

test('sign-in can reopen only its validated pending URL and never persists it', async (t) => {
  let saved = {};
  const opened = [];
  const provider = await createOAuthProvider({ read: () => saved, write: v => { saved = v; }, openExternal: async url => opened.push(url) });
  t.after(() => provider.close());
  await assert.rejects(provider.reopenAuthorization(), /sign-in|вход|auth/i);
  const url = new URL('https://accounts.example/authorize');
  url.searchParams.set('state', provider.state());
  url.searchParams.set('redirect_uri', provider.redirectUrl);
  await provider.redirectToAuthorization(url);
  await provider.reopenAuthorization();
  assert.deepEqual(opened, [url.href, url.href]);
  assert.doesNotMatch(JSON.stringify(saved), /accounts\.example|state/);
  await fetch(`${provider.redirectUrl}?code=good&state=${provider.state()}`);
  await assert.rejects(provider.reopenAuthorization(), /sign-in|вход|auth/i);
  assert.equal(opened.length, 2);
});
