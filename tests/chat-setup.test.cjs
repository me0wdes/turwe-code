const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createChatSetup } = require("../electron/chat-setup.cjs");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createStore } = require("../electron/store.cjs");
const { createTools } = require("../electron/tools.cjs");
const { createController } = require("../electron/controller.cjs");

function fixture() {
  const store = {
    state: { projects: [{ id: "p", name: "Demo", skillIds: [] }], skills: [] },
    save() {},
  };
  const items = [],
    observers = new Set();
  let saves = 0,
    connects = 0;
  const mcp = {
    list: () => items,
    async save(input) {
      saves++;
      const c = { ...input, id: "figma", status: "disconnected" };
      items.push(c);
      return c;
    },
    subscribe(fn) {
      observers.add(fn);
      return () => observers.delete(fn);
    },
    async connect(id, { signal }) {
      signal.throwIfAborted();
      connects++;
      const c = items.find((c) => c.id === id);
      c.status = "authorizing";
      observers.forEach((fn) => fn(items));
      c.status = "connected";
      c.toolCount = 3;
      observers.forEach((fn) => fn(items));
      return c;
    },
  };
  const setup = createChatSetup({ store, mcp, emit() {} });
  const context = {
    session: { projectId: "p" },
    signal: new AbortController().signal,
  };
  return {
    setup,
    store,
    mcp,
    items,
    observers,
    context,
    counts: () => ({ saves, connects }),
  };
}
const source =
  "---\nname: review-code\ndescription: Review project code\n---\nRead changed files and report concrete issues.";

test("connector preview is side-effect free; connect publishes progress and reuses the saved service", async () => {
  const f = fixture(),
    progress = [];
  const args = { preset: "figma" };
  assert.equal(
    f.setup.describe("connect_connector", args, f.context.session).title,
    "Figma",
  );
  assert.deepEqual(f.counts(), { saves: 0, connects: 0 });
  const result = await f.setup.execute("connect_connector", args, {
    ...f.context,
    onProgress: (p) => progress.push(p),
  });
  assert.equal(result.isError, false);
  assert.equal(result.setup.status, "connected");
  assert.equal(result.setup.connectorId, "figma");
  assert.ok(progress.some((p) => p.status === "authorizing"));
  assert.match(result.text, /3/);
  await f.setup.execute("connect_connector", args, f.context);
  assert.equal(f.counts().saves, 1);
  assert.equal(f.observers.size, 0);
  const install = f.setup.describe('install_github_skill', { url: 'https://github.com/example/skills#readme' }, f.context.session);
  assert.equal(install.endpoint, 'https://github.com/example/skills');
});

test("a failed MCP connection is an error result, never a successful connection", async () => {
  const f = fixture();
  f.mcp.connect = async (id) => ({
    id,
    status: "error",
    error: "Client registration rejected",
    toolCount: 0,
  });
  const result = await f.setup.execute(
    "connect_connector",
    { preset: "figma" },
    f.context,
  );
  assert.equal(result.isError, true);
  assert.equal(result.setup.status, "error");
  assert.equal(result.setup.alternative, "figma-desktop");
  assert.match(result.text, /registration rejected/);
  assert.equal(f.observers.size, 0);
});

test("unknown presets, ambiguous targets, unsafe URLs and cancelled calls never save a connector", async () => {
  const f = fixture();
  for (const args of [
    { preset: "invented" },
    { preset: "figma", url: "https://example.test/mcp" },
    { url: "https://user:secret@example.test/mcp" },
    { url: "https://example.test/mcp?token=secret" },
    { url: "file:///secret" },
  ])
    await assert.rejects(f.setup.execute("connect_connector", args, f.context));
  const abort = new AbortController();
  abort.abort();
  await assert.rejects(
    f.setup.execute(
      "connect_connector",
      { preset: "figma" },
      { ...f.context, signal: abort.signal },
    ),
  );
  assert.equal(f.counts().saves, 0);
});

test("connector discovery hides secrets and saved stdio arguments", async () => {
  const f = fixture();
  f.items.push({
    id: "saved",
    name: "Saved MCP",
    type: "stdio",
    status: "disconnected",
    args: ["secret"],
    env: { KEY: "secret" },
  });
  const result = await f.setup.execute("list_connectors", {}, f.context);
  assert.match(result.text, /Saved MCP/);
  assert.doesNotMatch(result.text, /secret/);
});

test("skill creation defaults to the current project, assigns it and supports idempotent retries", async () => {
  const f = fixture();
  assert.equal(
    f.setup.describe("create_skill", { source }, f.context.session).scope,
    "Demo",
  );
  const result = await f.setup.execute("create_skill", { source }, f.context);
  assert.equal(result.setup.status, "ready");
  assert.match(result.text, /@review-code/);
  assert.equal(f.store.state.skills[0].projectId, "p");
  assert.deepEqual(f.store.state.projects[0].skillIds, [
    f.store.state.skills[0].id,
  ]);
  await f.setup.execute("create_skill", { source }, f.context);
  assert.equal(f.store.state.skills.length, 1);
  await assert.rejects(
    f.setup.execute(
      "create_skill",
      { source: source + "\nDifferent instructions." },
      f.context,
    ),
    /существует/,
  );
  assert.equal(f.store.state.skills[0].source, source);
});

test("personal skills stay unassigned; invalid skills and missing project do not mutate state", async () => {
  const f = fixture();
  for (const args of [
    { source: "bad" },
    { source, scope: "wrong" },
    { source: source + "\n[missing](reference.md)" },
    { source: source + "\n[run](script.exe)" },
  ])
    await assert.rejects(f.setup.execute("create_skill", args, f.context));
  await assert.rejects(
    f.setup.execute(
      "create_skill",
      { source, scope: "project" },
      { ...f.context, session: { projectId: null } },
    ),
  );
  assert.equal(f.store.state.skills.length, 0);
  await f.setup.execute(
    "create_skill",
    { source, scope: "personal" },
    f.context,
  );
  assert.equal(f.store.state.skills[0].projectId, null);
  assert.deepEqual(f.store.state.projects[0].skillIds, []);
});

async function until(predicate) {
  const end = Date.now() + 3000;
  while (!predicate()) {
    if (Date.now() > end) throw new Error("Expected state was not reached");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
function controllerFixture(t, stream) {
  const f = fixture();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "turwe-chat-setup-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = createStore(dir);
  let didRead = false;
  const remote = {
    type: "function",
    readOnly: true,
    function: {
      name: "mcp_fixture_read",
      description: "Read fixture",
      parameters: { type: "object", properties: {} },
    },
  };
  f.mcp.tools = () =>
    f.items.some((c) => c.status === "connected") ? [remote] : [];
  f.mcp.callTool = async () => {
    didRead = true;
    return { content: [{ type: "text", text: "Fixture design read" }] };
  };
  const controller = createController({
    store,
    getConfig: () => ({ key: "fixture-only" }),
    emit() {},
    stream,
    ...createTools({
      store,
      mcp: f.mcp,
      github: {},
      attachments: {},
      emit() {},
    }),
  });
  const session = store.createSession();
  session.permissionMode = "auto";
  return { ...f, store, controller, session, didRead: () => didRead };
}
const connectResponse = {
  toolCalls: [
    {
      id: "connect-1",
      type: "function",
      function: { name: "connect_connector", arguments: '{"preset":"figma"}' },
    },
  ],
  finishReason: "tool_calls",
};
const latestCall = (session) =>
  session.messages
    .at(-1)
    ?.toolRounds?.flatMap((r) => r.calls)
    .at(-1);

test("chat approval waits for real sign-in then continues the same task with freshly discovered tools", async (t) => {
  let requests = 0;
  const f = controllerFixture(t, async ({ tools, messages, onDelta }) => {
    requests++;
    if (requests === 1) return connectResponse;
    if (requests === 2) {
      assert.ok(tools.some((t) => t.function.name === "mcp_fixture_read"));
      assert.ok(
        messages.some(
          (m) => m.role === "tool" && m.content.includes("Подключено: Figma"),
        ),
      );
      return {
        toolCalls: [
          {
            id: "read-1",
            type: "function",
            function: { name: "mcp_fixture_read", arguments: "{}" },
          },
        ],
        finishReason: "tool_calls",
      };
    }
    assert.ok(
      messages.some(
        (m) => m.role === "tool" && m.content.includes("Fixture design read"),
      ),
    );
    onDelta("Макет прочитан.");
    return { toolCalls: [], finishReason: "stop" };
  });
  let finishSignIn;
  f.mcp.connect = async (id) => {
    const c = f.items.find((c) => c.id === id);
    c.status = "authorizing";
    f.observers.forEach((fn) => fn(f.items));
    await new Promise((resolve) => {
      finishSignIn = resolve;
    });
    c.status = "connected";
    c.toolCount = 1;
    return c;
  };
  const run = f.controller.send(
    f.session.id,
    "Подключи Figma и прочитай макет",
  );
  await until(() => latestCall(f.session)?.status === "approval");
  assert.equal(latestCall(f.session).setup.title, "Figma");
  assert.equal(f.items.length, 0);
  f.controller.approve(f.session.id, "connect-1", true);
  await until(() => latestCall(f.session)?.setup?.status === "authorizing");
  assert.equal(f.session.messages.at(-1).status, "question");
  assert.equal(requests, 1);
  finishSignIn();
  await run.done;
  assert.equal(f.session.messages.at(-1).status, "complete");
  assert.equal(f.didRead(), true);
  assert.equal(requests, 3);
  assert.equal(f.observers.size, 0);
});

test("denying chat setup never starts OAuth or writes a connector", async (t) => {
  let requests = 0;
  const f = controllerFixture(t, async ({ onDelta }) => {
    if (++requests === 1) return connectResponse;
    onDelta("Подключение отменено.");
    return { toolCalls: [], finishReason: "stop" };
  });
  const run = f.controller.send(f.session.id, "Подключи Figma");
  await until(() => latestCall(f.session)?.status === "approval");
  f.controller.approve(f.session.id, "connect-1", false);
  await run.done;
  assert.equal(f.items.length, 0);
  assert.equal(latestCall(f.session).status, "denied");
});

test("stopping during chat sign-in aborts the connection, cleans progress listeners and never resumes the model", async (t) => {
  let requests = 0;
  const f = controllerFixture(t, async () => {
    requests++;
    return connectResponse;
  });
  f.session.permissionMode = "bypass";
  f.mcp.connect = async (id, { signal }) => {
    const c = f.items.find((c) => c.id === id);
    c.status = "authorizing";
    f.observers.forEach((fn) => fn(f.items));
    await new Promise((resolve, reject) =>
      signal.addEventListener(
        "abort",
        () => {
          c.status = "disconnected";
          reject(signal.reason);
        },
        { once: true },
      ),
    );
  };
  const run = f.controller.send(f.session.id, "Подключи Figma");
  await until(() => latestCall(f.session)?.setup?.status === "authorizing");
  f.controller.stop(f.session.id);
  await run.done;
  assert.equal(latestCall(f.session).status, "stopped");
  assert.equal(f.items[0].status, "disconnected");
  assert.equal(f.observers.size, 0);
  assert.equal(requests, 1);
});
