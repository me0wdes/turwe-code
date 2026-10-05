const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createMcpManager } = require('../electron/mcp.cjs');

const endpoint = 'https://mcp.figma.com/mcp';
const issuer = 'https://api.figma.com';
const metadata = {
  issuer, authorization_endpoint: 'https://www.figma.com/oauth/mcp',
  token_endpoint: `${issuer}/v1/oauth/token`,
  registration_endpoint: `${issuer}/v1/oauth/mcp/register`,
  response_types_supported: ['code'], code_challenge_methods_supported: ['S256'],
  token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'],
};
const json = (value, status = 200, headers = {}) => new Response(JSON.stringify(value), {
  status, headers: { 'Content-Type': 'application/json', ...headers },
});
function fixture(t, options) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'turwe-mcp-connection-'));
  const manager = createMcpManager({
    directory,
    safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: value => Buffer.from(value.split('').reverse().join('')),
      decryptString: value => value.toString().split('').reverse().join(''),
    },
    ...options,
  });
  t.after(async () => { await manager.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  return manager;
}
function discovery(input) {
  const url = new URL(input);
  if (url.pathname.includes('oauth-protected-resource')) return json({ resource: endpoint, authorization_servers: [issuer], scopes_supported: ['mcp:connect'] });
  if (url.pathname.includes('oauth-authorization-server')) return json(metadata);
  return null;
}
function challenge() {
  return new Response('Unauthorized', { status: 401, headers: {
    'WWW-Authenticate': 'Bearer resource_metadata="https://mcp.figma.com/.well-known/oauth-protected-resource",scope="mcp:connect"',
  } });
}

test('Figma registration refusal reports its actual stage and status without opening sign-in or leaking a response body', async t => {
  let registered = 0, opened = 0;
  const manager = fixture(t, {
    openExternal: async () => { opened++; },
    fetch: async (url, init) => {
      const known = discovery(url);
      if (known) return known;
      if (url === metadata.registration_endpoint) {
        registered++;
        // This is the public metadata returned by Figma, which rejects 'none'.
        assert.equal(JSON.parse(init.body).token_endpoint_auth_method, 'client_secret_basic');
        return new Response('Forbidden secret-fixture-do-not-display', { status: 403, headers: { 'Content-Type': 'application/json' } });
      }
      assert.equal(url, endpoint);
      return challenge();
    },
  });
  const saved = await manager.save({ name: 'Figma', type: 'http', url: endpoint, auth: 'oauth' });
  const result = await manager.connect(saved.id);
  assert.equal(result.status, 'error');
  assert.equal(registered, 1);
  assert.equal(opened, 0);
  assert.equal(result.diagnostic.phase, 'registration');
  assert.equal(result.diagnostic.httpStatus, 403);
  assert.equal(result.diagnostic.oauthError, undefined);
  assert.match(result.error, /регистрац.*Turwe Code.*403/);
  assert.match(result.error, /разработчик/);
  assert.doesNotMatch(JSON.stringify(manager.list()), /secret-fixture|Security|Apps/);
});

test('Figma DNS and HTTP failures are not misreported as a client approval requirement', async t => {
  for (const mode of ['dns', 'server']) {
    const manager = fixture(t, { fetch: async () => {
      if (mode === 'dns') throw new TypeError('fetch failed private-response', { cause: Object.assign(new Error(), { code: 'ENOTFOUND' }) });
      return new Response('private-response', { status: 503 });
    } });
    const saved = await manager.save({ name: 'Figma', type: 'http', url: endpoint });
    const result = await manager.connect(saved.id);
    assert.equal(result.status, 'error');
    assert.match(result.error, mode === 'dns' ? /DNS/ : /503/);
    assert.doesNotMatch(result.error, /одобрен|approved|каталог|private-response/);
  }
});

test('a refused desktop connection gives the Figma-specific local enablement steps', async t => {
  const manager = fixture(t, { fetch: async () => {
    throw new TypeError('fetch failed', { cause: new AggregateError([Object.assign(new Error(), { code: 'ECONNREFUSED' })]) });
  } });
  const saved = await manager.save({ name: 'Design', type: 'http', url: 'http://localhost:3845/mcp', auth: 'none' });
  const result = await manager.connect(saved.id);
  assert.equal(result.status, 'error');
  assert.equal(result.diagnostic.code, 'MCP_CONNECTION_REFUSED');
  assert.match(result.error, /Figma Desktop.*Dev Mode.*Enable desktop MCP server/);
  assert.doesNotMatch(result.error, /интернет|одобрен|аккаунт/);
});

test('a server requiring a registered client secret completes OAuth with the negotiated method', async t => {
  let registration, browserVisits = 0, tokens = 0;
  const manager = fixture(t, {
    openExternal: async value => {
      browserVisits++;
      const url = new URL(value);
      assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
      const callback = new URL(url.searchParams.get('redirect_uri'));
      callback.searchParams.set('state', url.searchParams.get('state'));
      callback.searchParams.set('code', 'fixture-code');
      assert.equal((await fetch(callback)).status, 200);
    },
    fetch: async (url, init) => {
      const known = discovery(url);
      if (known) return known;
      if (url === metadata.registration_endpoint) {
        registration = JSON.parse(init.body);
        assert.equal(registration.client_name, 'Turwe Code');
        assert.equal(registration.token_endpoint_auth_method, 'client_secret_basic');
        return json({ ...registration, client_id: 'fixture-client', client_secret: 'fixture-secret' }, 201);
      }
      if (url === metadata.token_endpoint) {
        tokens++;
        assert.equal(new Headers(init.headers).get('Authorization'), `Basic ${Buffer.from('fixture-client:fixture-secret').toString('base64')}`);
        const body = new URLSearchParams(init.body);
        assert.equal(body.get('redirect_uri'), registration.redirect_uris[0]);
        assert.equal(body.get('code'), 'fixture-code');
        assert.ok(body.get('code_verifier'));
        return json({ access_token: 'fixture-access', token_type: 'Bearer' });
      }
      assert.equal(url, endpoint);
      if (init.method === 'GET') return new Response(null, { status: 405 });
      if (new Headers(init.headers).get('Authorization') !== 'Bearer fixture-access') return challenge();
      const message = JSON.parse(init.body);
      if (!Object.hasOwn(message, 'id')) return new Response(null, { status: 202 });
      const result = message.method === 'initialize'
        ? { protocolVersion: message.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'fixture', version: '1' } }
        : { tools: [] };
      return json({ jsonrpc: '2.0', id: message.id, result });
    },
  });
  const saved = await manager.save({ name: 'Figma', type: 'http', url: endpoint, auth: 'oauth' });
  const result = await manager.connect(saved.id);
  assert.equal(result.status, 'connected', result.error);
  assert.equal(browserVisits, 1);
  assert.equal(tokens, 1);
  assert.doesNotMatch(JSON.stringify(result), /fixture-secret|fixture-access/);
});
