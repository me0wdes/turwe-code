const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { createHash, randomUUID } = require("node:crypto");
const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const {
  StreamableHTTPServerTransport,
} = require("@modelcontextprotocol/sdk/server/streamableHttp.js");
const { createMcpManager } = require("../electron/mcp.cjs");

function setup(t, overrides = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "turwe-mcp-"));
  const safeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: (text) => Buffer.from(text.split("").reverse().join("")),
    decryptString: (buffer) => buffer.toString().split("").reverse().join(""),
  };
  const manager = createMcpManager({ directory, safeStorage, ...overrides });
  t.after(async () => {
    await manager.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return { directory, safeStorage, manager };
}

test("resources-only MCP connects and serves prompts and a form in the requesting chat", async (t) => {
  const contexts = [];
  const { manager } = setup(t, {
    onElicitation: async (form, context) => {
      contexts.push(context);
      assert.equal(form.message, "resource");
      return { action: "accept", content: { choice: ["a"] } };
    },
  });
  const saved = await manager.save({
    name: "Resources",
    type: "stdio",
    command: process.execPath,
    args: [path.join(__dirname, "fixtures", "mcp-resources.cjs")],
  });
  const connectionStates = [];
  const unsubscribe = manager.subscribe(items => connectionStates.push(items.find(c => c.id === saved.id)?.status));
  const connected = await manager.connect(saved.id);
  unsubscribe();
  assert.ok(connectionStates.includes('connecting'));
  assert.ok(connectionStates.includes('connected'));
  assert.equal(connected.status, "connected", connected.error);
  assert.equal(manager.tools().length, 0);
  assert.equal(
    (await manager.resourceOperation(saved.id, "resources")).resources[0].uri,
    "fixture://resource",
  );
  assert.match(
    (
      await manager.resourceOperation(saved.id, "prompt", {
        name: "fixture",
        arguments: { name: "Ada" },
      })
    ).messages[0].content.text,
    /Ada/,
  );
  const result = await manager.resourceOperation(
    saved.id,
    "read",
    { uri: "fixture://resource" },
    { session: { id: "B" } },
  );
  assert.match(result.contents[0].text, /accept/);
  assert.equal(contexts[0].session.id, "B");
  assert.ok(contexts[0].signal.aborted, "completed requests close their forms");
});

test("concurrent tool/resource forms stay scoped and cancelled forms are cleaned up", async (t) => {
  const delivered = [];
  let answer, started;
  const first = new Promise((r) => (started = r));
  const { manager } = setup(t, {
    onElicitation: async (form, context) => {
      delivered.push([form.message, context.session.id]);
      if (context.session.id === "A") {
        started();
        return new Promise(
          (resolve) =>
            (answer = () =>
              resolve({ action: "accept", content: { choice: ["a"] } })),
        );
      }
      return { action: "accept", content: { choice: ["b"] } };
    },
  });
  const saved = await manager.save({
    name: "Mixed",
    type: "stdio",
    command: process.execPath,
    args: [path.join(__dirname, "fixtures", "mcp-resources.cjs"), "--tools"],
  });
  await manager.connect(saved.id);
  const task = manager.callTool(
    manager.tools()[0].function.name,
    {},
    { session: { id: "A" } },
  );
  await first;
  const resource = manager.resourceOperation(
    saved.id,
    "read",
    { uri: "fixture://resource" },
    { session: { id: "B" } },
  );
  answer();
  await Promise.all([task, resource]);
  assert.deepEqual(delivered, [
    ["tool", "A"],
    ["resource", "B"],
  ]);
});

test("MCP form validation supports bounded multi-select, integers and titled enums", () => {
  const { validateForm } = require("../electron/mcp-forms.cjs");
  const schema = {
    type: "object",
    properties: {
      count: { type: "integer", minimum: 1, maximum: 4 },
      choice: {
        type: "array",
        items: {
          anyOf: [
            { const: "a", title: "A" },
            { const: "b", title: "B" },
          ],
        },
        minItems: 1,
        maxItems: 2,
      },
    },
    required: ["count", "choice"],
  };
  assert.deepEqual(validateForm(schema, { count: 2, choice: ["a"] }), {
    count: 2,
    choice: ["a"],
  });
  for (const value of [
    { count: 1.5, choice: ["a"] },
    { count: 2, choice: [] },
    { count: 2, choice: ["c"] },
    { count: 2 },
  ])
    assert.throws(() => validateForm(schema, value));
});

test("cancelling a queued MCP request settles immediately and never steals another form context", async (t) => {
  let answer, started;
  const active = new Promise((r) => (started = r));
  const delivered = [];
  const { manager } = setup(t, {
    onElicitation: async (_form, { session }) => {
      delivered.push(session.id);
      if (session.id === "A") {
        started();
        return new Promise(
          (r) =>
            (answer = () =>
              r({ action: "accept", content: { choice: ["a"] } })),
        );
      }
      return { action: "accept", content: { choice: ["b"] } };
    },
  });
  const saved = await manager.save({
    name: "Queue",
    type: "stdio",
    command: process.execPath,
    args: [path.join(__dirname, "fixtures", "mcp-resources.cjs")],
  });
  await manager.connect(saved.id);
  const read = (id, signal) =>
    manager.resourceOperation(
      saved.id,
      "read",
      { uri: "fixture://resource" },
      { session: { id }, signal },
    );
  const first = read("A");
  await active;
  const abort = new AbortController();
  const queued = read("B", abort.signal);
  abort.abort();
  let timer;
  try {
    await Promise.race([
      assert.rejects(queued, /abort/i),
      new Promise(
        (_, reject) =>
          (timer = setTimeout(
            () => reject(new Error("Queued cancellation did not settle")),
            1000,
          )),
      ),
    ]);
  } finally {
    clearTimeout(timer);
    answer();
  }
  const third = read("C");
  await Promise.all([first, third]);
  assert.deepEqual(delivered, ["A", "C"]);
});

test("saving connector secrets keeps them out of public configs and plain files, and restart retains them", async (t) => {
  const { directory, safeStorage, manager } = setup(t);
  const saved = await manager.save({
    name: "Private",
    type: "http",
    url: "https://tools.example/mcp",
    auth: "bearer",
    bearerToken: "bearer-private-735",
  });
  assert.equal(saved.status, "disconnected");
  assert.equal(saved.hasSecret, true);
  assert.equal(manager.tools().length, 0);
  assert.equal(
    JSON.stringify(manager.list()).includes("bearer-private-735"),
    false,
  );
  for (const file of fs.readdirSync(directory))
    assert.equal(
      fs
        .readFileSync(path.join(directory, file), "utf8")
        .includes("bearer-private-735"),
      false,
    );
  const restarted = createMcpManager({ directory, safeStorage });
  t.after(() => restarted.close());
  assert.equal(restarted.list()[0].hasSecret, true);
  await restarted.save({ ...saved, url: "https://different.example/mcp" });
  assert.equal(restarted.list()[0].hasSecret, false);
});

test("unsafe server URLs and plaintext secret storage fail closed", async (t) => {
  const { manager } = setup(t, {
    safeStorage: { isEncryptionAvailable: () => false },
  });
  for (const url of [
    "http://example.com/mcp",
    "file:///secret",
    "https://user:pass@example.com/mcp",
    "https://example.com/mcp?token=secret",
  ]) {
    await assert.rejects(
      manager.save({ name: "Unsafe", type: "http", url }),
      /HTTPS|URL|credential|query/i,
    );
  }
  await assert.rejects(
    manager.save({
      name: "Unsafe",
      type: "http",
      url: "https://example.com/mcp",
      auth: "bearer",
      bearerToken: "secret",
    }),
    /encrypt/i,
  );
  assert.equal(manager.list().length, 0);
  const local = await manager.save({
    name: "No credentials",
    type: "stdio",
    command: process.execPath,
    env: {},
  });
  assert.equal(local.hasSecret, false);
});

test("explicit credential replacement recovers a connector whose old encrypted token cannot be read", async (t) => {
  const { manager, directory, safeStorage } = setup(t);
  const saved = await manager.save({
    name: "Token",
    type: "http",
    url: "https://mcp.example/mcp",
    auth: "bearer",
    bearerToken: "old-token-735",
  });
  await manager.close();
  const replacement = createMcpManager({
    directory,
    safeStorage: {
      ...safeStorage,
      decryptString: () => {
        throw new Error("Different account");
      },
    },
  });
  t.after(() => replacement.close());
  assert.equal(replacement.list()[0].status, "error");
  const updated = await replacement.save({
    ...saved,
    bearerToken: "new-token-735",
  });
  assert.equal(updated.status, "disconnected");
  assert.equal(updated.hasSecret, true);
});

test("local stdio tools are callable, names are collision resistant, and changes invalidate connection", async (t) => {
  const { manager, directory } = setup(t);
  const fixture = path.join(__dirname, "fixtures", "mcp-server.cjs");
  const server = {
    name: "Local",
    type: "stdio",
    command: process.execPath,
    args: [fixture],
    env: { MCP_TEST_SECRET: "env-private-735" },
  };
  const first = await manager.save(server);
  const second = await manager.save({ ...server, name: "Local copy" });
  assert.deepEqual(first.envKeys, ["MCP_TEST_SECRET"]);
  assert.equal(
    JSON.stringify(manager.list()).includes("env-private-735"),
    false,
  );
  for (const file of fs.readdirSync(directory))
    assert.equal(
      fs
        .readFileSync(path.join(directory, file), "utf8")
        .includes("env-private-735"),
      false,
    );
  await manager.connect(first.id);
  await manager.connect(second.id);
  const definitions = manager.tools();
  assert.equal(
    new Set(definitions.map((tool) => tool.function.name)).size,
    definitions.length,
  );
  for (const tool of definitions)
    assert.match(tool.function.name, /^[A-Za-z0-9_-]{1,64}$/);
  const echo = definitions.find(
    (tool) => tool.mcp.connectorId === first.id && tool.mcp.toolName === "echo",
  );
  assert.equal(echo.mcp.readOnly, true);
  const unknown = definitions.find(
    (tool) => tool.mcp.toolName === "unannotated",
  );
  assert.equal(unknown.mcp.readOnly, false);
  assert.deepEqual(
    await manager.callTool(echo.function.name, { text: "hello" }),
    { content: [{ type: "text", text: "hello" }] },
  );
  await manager.save({ ...first, name: "Changed" });
  assert.equal(
    manager.list().find((item) => item.id === first.id).status,
    "disconnected",
  );
  await assert.rejects(
    manager.callTool(echo.function.name, {}),
    /connected|available/i,
  );
  await manager.remove(second.id);
  assert.equal(manager.tools().length, 0);
});

test("tool failures cannot echo stored secrets and large results are bounded", async (t) => {
  const { manager } = setup(t);
  const saved = await manager.save({
    name: "Fixture",
    type: "stdio",
    command: process.execPath,
    args: [path.join(__dirname, "fixtures", "mcp-server.cjs")],
    env: { MCP_TEST_SECRET: "env-private-735" },
  });
  await manager.connect(saved.id);
  const tool = (name) =>
    manager.tools().find((item) => item.mcp.toolName === name).function.name;
  const secretResult = await manager.callTool(tool("secret_error"), {});
  assert.equal(JSON.stringify(secretResult).includes("env-private-735"), false);
  assert.equal(secretResult.isError, true);
  const large = await manager.callTool(tool("large"), {});
  assert.ok(JSON.stringify(large).length < 300_000);
  assert.match(JSON.stringify(large), /truncat|exceed|large/i);
  const escaped = await manager.callTool(tool("escaped_large"), {});
  assert.ok(Buffer.byteLength(JSON.stringify(escaped)) <= 256 * 1024);
});

test("MCP preserves a screenshot over 256 KB while bounding and redacting its accompanying text and structured data", async (t) => {
  const { manager } = setup(t);
  const saved = await manager.save({
    name: "Images",
    type: "stdio",
    command: process.execPath,
    args: [path.join(__dirname, "fixtures", "mcp-server.cjs")],
    env: { MCP_TEST_SECRET: "env-private-735" },
  });
  await manager.connect(saved.id);
  const name = manager
    .tools()
    .find((tool) => tool.mcp.toolName === "image_and_text").function.name;
  const result = await manager.callTool(name, {});
  const images = result.content.filter((block) => block.type === "image");
  assert.equal(images.length, 1);
  assert.equal(images[0].mimeType, "image/png");
  assert.ok(images[0].data.length > 256 * 1024);
  assert.equal(
    Buffer.from(images[0].data, "base64").subarray(0, 8).toString("hex"),
    "89504e470d0a1a0a",
  );
  const withoutPixels = {
    ...result,
    content: result.content.map((block) =>
      block.type === "image" ? { ...block, data: "" } : block,
    ),
  };
  assert.ok(Buffer.byteLength(JSON.stringify(withoutPixels)) <= 256 * 1024);
  assert.doesNotMatch(JSON.stringify(result), /env-private-735/);
  assert.match(JSON.stringify(withoutPixels), /truncat/i);
});

test("MCP images have independent byte and count caps and omitted images produce an explicit note", async (t) => {
  const { manager } = setup(t);
  const saved = await manager.save({
    name: "Image limits",
    type: "stdio",
    command: process.execPath,
    args: [path.join(__dirname, "fixtures", "mcp-server.cjs")],
  });
  await manager.connect(saved.id);
  const call = (toolName) =>
    manager.callTool(
      manager.tools().find((tool) => tool.mcp.toolName === toolName).function
        .name,
      {},
    );
  const oversized = await call("images_over_bytes");
  const retained = oversized.content.filter((block) => block.type === "image");
  assert.equal(retained.length, 3);
  assert.ok(
    retained.reduce((total, block) => total + block.data.length, 0) <=
      6 * 1024 * 1024,
  );
  assert.match(
    oversized.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n"),
    /image.*omitt|omitt.*image/i,
  );
  const countLimited = await call("images_over_count");
  assert.equal(
    countLimited.content.filter((block) => block.type === "image").length,
    4,
  );
  assert.match(JSON.stringify(countLimited), /omitt/i);
  const unsupported = await call("unsupported_images");
  assert.equal(
    unsupported.content.filter((block) => block.type === "image").length,
    0,
  );
  assert.match(JSON.stringify(unsupported), /invalid|unsupported/i);
  await assert.rejects(
    call("invalid_images"),
    (error) => !error.message.includes("@not-base64@"),
  );
});

test("cancellation stops a running tool and a missing command gives a safe actionable error", async (t) => {
  const { manager } = setup(t);
  const saved = await manager.save({
    name: "Fixture",
    type: "stdio",
    command: process.execPath,
    args: [path.join(__dirname, "fixtures", "mcp-server.cjs")],
  });
  await manager.connect(saved.id);
  const delay = manager.tools().find((item) => item.mcp.toolName === "delay")
    .function.name;
  const abort = new AbortController();
  const result = manager.callTool(delay, {}, { signal: abort.signal });
  setTimeout(() => abort.abort(), 30);
  await assert.rejects(result, /cancel|abort/i);
  const missing = await manager.save({
    name: "Missing",
    type: "stdio",
    command: "turwe-mcp-nonexistent-command-735",
  });
  const failed = await manager.connect(missing.id);
  assert.equal(failed.status, "error");
  assert.match(failed.error, /command|start|installed|connect/i);
});

test("Streamable HTTP connects to a real loopback MCP server and calls its tools", async (t) => {
  const mcp = new McpServer({ name: "local-http-fixture", version: "1.0" });
  mcp.registerTool(
    "hello",
    { annotations: { readOnlyHint: true } },
    async () => ({ content: [{ type: "text", text: "HTTP works" }] }),
  );
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
  });
  await mcp.connect(transport);
  const server = http.createServer(async (req, res) => {
    try {
      let body = "";
      for await (const chunk of req) body += chunk;
      await transport.handleRequest(
        req,
        res,
        body ? JSON.parse(body) : undefined,
      );
    } catch {
      res.writeHead(500);
      res.end();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    await mcp.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  const { manager } = setup(t);
  const saved = await manager.save({
    name: "HTTP fixture",
    type: "http",
    url: `http://127.0.0.1:${server.address().port}/mcp`,
  });
  const connected = await manager.connect(saved.id);
  assert.equal(connected.status, "connected", connected.error);
  assert.deepEqual(
    await manager.callTool(manager.tools()[0].function.name, {}),
    { content: [{ type: "text", text: "HTTP works" }] },
  );
  await manager.disconnect(saved.id);
});

test("saving never launches commands and concurrent Connect requests launch only one local process", async (t) => {
  const { manager, directory } = setup(t);
  const marker = path.join(directory, "started.txt");
  const saved = await manager.save({
    name: "Once",
    type: "stdio",
    command: process.execPath,
    args: [path.join(__dirname, "fixtures", "mcp-server.cjs")],
    env: { MCP_START_MARKER: marker },
  });
  assert.equal(fs.existsSync(marker), false);
  await Promise.all([manager.connect(saved.id), manager.connect(saved.id)]);
  assert.equal(fs.readFileSync(marker, "utf8"), "start\n");
});

test('cancelling a second connection waiter leaves the first connection intact', async t => {
  const { manager } = setup(t);
  const saved = await manager.save({ name: 'Shared', type: 'stdio', command: process.execPath, args: [path.join(__dirname, 'fixtures', 'mcp-server.cjs')] });
  const first = manager.connect(saved.id);
  const abort = new AbortController();
  const second = manager.connect(saved.id, { signal: abort.signal });
  abort.abort();
  await assert.rejects(second, /abort/i);
  assert.equal((await first).status, 'connected');
  assert.ok(manager.tools().length);
});

test("SDK OAuth performs PKCE code exchange, encrypted persistence, refresh, and callable HTTP tools", async (t) => {
  let authorization;
  let registration;
  let activeToken = "access-private-735";
  let rejectOldToken = false;
  let revokeRefresh = false;
  let refreshes = 0;
  let browserVisits = 0;
  const json = (value, status = 200, headers = {}) =>
    new Response(JSON.stringify(value), {
      status,
      headers: { "Content-Type": "application/json", ...headers },
    });
  const fakeFetch = async (input, init) => {
    const url = new URL(input);
    if (url.pathname.includes("oauth-protected-resource"))
      return json({
        resource: "https://mcp.example/mcp",
        authorization_servers: ["https://accounts.example"],
        scopes_supported: ["tools:read"],
      });
    if (
      url.pathname.includes("oauth-authorization-server") ||
      url.pathname.includes("openid-configuration")
    )
      return json({
        issuer: "https://accounts.example",
        authorization_endpoint: "https://accounts.example/authorize",
        token_endpoint: "https://accounts.example/token",
        registration_endpoint: "https://accounts.example/register",
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code", "refresh_token"],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: ["none"],
      });
    if (url.pathname === "/register") {
      registration = JSON.parse(init.body);
      assert.equal(registration.client_name, "Turwe Code");
      assert.equal(registration.token_endpoint_auth_method, "none");
      return json({ ...registration, client_id: "fixture-client" }, 201);
    }
    if (url.pathname === "/token") {
      const body = new URLSearchParams(init.body);
      if (body.get("grant_type") === "authorization_code") {
        assert.equal(body.get("code"), "authorization-code-735");
        assert.equal(body.get("redirect_uri"), registration.redirect_uris[0]);
        assert.equal(
          createHash("sha256")
            .update(body.get("code_verifier"))
            .digest("base64url"),
          authorization.searchParams.get("code_challenge"),
        );
        return json({
          access_token: activeToken,
          refresh_token: "refresh-private-735",
          token_type: "Bearer",
          expires_in: 3600,
        });
      }
      assert.equal(body.get("grant_type"), "refresh_token");
      assert.equal(body.get("refresh_token"), "refresh-private-735");
      if (revokeRefresh) return json({ error: "invalid_grant" }, 400);
      refreshes++;
      activeToken = "refreshed-private-735";
      rejectOldToken = false;
      return json({
        access_token: activeToken,
        token_type: "Bearer",
        expires_in: 3600,
      });
    }
    if (url.origin !== "https://mcp.example" || url.pathname !== "/mcp")
      throw new Error("Unexpected test endpoint.");
    if (init.method === "GET") return new Response(null, { status: 405 });
    const headers = new Headers(init.headers);
    if (
      headers.get("Authorization") !== `Bearer ${activeToken}` ||
      rejectOldToken
    )
      return json({ error: "unauthorized" }, 401, {
        "WWW-Authenticate":
          'Bearer resource_metadata="https://mcp.example/.well-known/oauth-protected-resource"',
      });
    const message = JSON.parse(init.body);
    if (!Object.prototype.hasOwnProperty.call(message, "id"))
      return new Response(null, { status: 202 });
    let result;
    if (message.method === "initialize")
      result = {
        protocolVersion: message.params.protocolVersion,
        capabilities: { tools: {} },
        serverInfo: { name: "oauth-fixture", version: "1.0" },
      };
    else if (message.method === "tools/list")
      result = {
        tools: [
          {
            name: "remote_echo",
            inputSchema: { type: "object" },
            annotations: { readOnlyHint: true },
          },
        ],
      };
    else if (message.method === "tools/call")
      result = { content: [{ type: "text", text: "OAuth works" }] };
    else throw new Error("Unexpected test protocol method.");
    return json({ jsonrpc: "2.0", id: message.id, result });
  };
  const { manager, directory, safeStorage } = setup(t, {
    fetch: fakeFetch,
    openExternal: async (value) => {
      browserVisits++;
      authorization = new URL(value);
      assert.equal(authorization.protocol, "https:");
      assert.equal(
        authorization.searchParams.get("code_challenge_method"),
        "S256",
      );
      const callback = new URL(authorization.searchParams.get("redirect_uri"));
      callback.searchParams.set(
        "state",
        authorization.searchParams.get("state"),
      );
      callback.searchParams.set("code", "authorization-code-735");
      assert.equal((await fetch(callback)).status, 200);
    },
  });
  const saved = await manager.save({
    name: "OAuth",
    type: "http",
    url: "https://mcp.example/mcp",
    auth: "oauth",
  });
  const connected = await manager.connect(saved.id);
  assert.equal(connected.status, "connected", connected.error);
  assert.equal(browserVisits, 1);
  const name = manager.tools()[0].function.name;
  assert.equal(
    (await manager.callTool(name, {})).content[0].text,
    "OAuth works",
  );
  rejectOldToken = true;
  assert.equal(
    (await manager.callTool(name, {})).content[0].text,
    "OAuth works",
  );
  assert.equal(refreshes, 1);
  assert.equal(browserVisits, 1);
  for (const file of fs.readdirSync(directory))
    assert.doesNotMatch(
      fs.readFileSync(path.join(directory, file), "utf8"),
      /access-private|refresh-private|refreshed-private/,
    );
  assert.doesNotMatch(
    JSON.stringify(manager.list()),
    /access-private|refresh-private|refreshed-private/,
  );
  await manager.close();
  const restarted = createMcpManager({
    directory,
    safeStorage,
    fetch: fakeFetch,
    openExternal: async () => {
      throw new Error("Restart should use saved tokens.");
    },
  });
  t.after(() => restarted.close());
  assert.equal((await restarted.connect(saved.id)).status, "connected");
  assert.equal(
    (await restarted.callTool(restarted.tools()[0].function.name, {}))
      .content[0].text,
    "OAuth works",
  );
  rejectOldToken = true;
  revokeRefresh = true;
  await assert.rejects(
    restarted.callTool(restarted.tools()[0].function.name, {}),
    /authenticat|Connect/i,
  );
  assert.equal(restarted.list()[0].status, "error");
  assert.equal(restarted.tools().length, 0);
});
