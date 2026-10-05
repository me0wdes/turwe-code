const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { createStore } = require("../electron/store.cjs");
const { createCodingRuntime } = require("../electron/coding-runtime.cjs");
const { createController } = require("../electron/controller.cjs");
const { createTools } = require("../electron/tools.cjs");

async function fixture(t) {
  const dir = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "turwe-session-workspace-")),
  );
  const documents = path.join(dir, "Documents");
  const directory = path.join(dir, "data");
  const store = createStore(directory, { documents });
  const mcp = { tools: () => [], list: () => [] };
  const coding = createCodingRuntime({ store, directory, mcp, emit() {} });
  t.after(async () => {
    await coding.close();
    await fs.rm(dir, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 100,
    });
  });
  return { dir, documents, directory, store, coding, mcp };
}

test("a chat can start without a project and does not create a work folder merely by opening or reading context", async (t) => {
  const { store, coding, dir, documents } = await fixture(t);
  const session = store.startSession();
  assert.equal(store.startSession(null).id, session.id);
  assert.equal(session.projectId, null);
  await fs.writeFile(path.join(dir, "reference.md"), "Useful context");
  const read = await coding.execute(
    "FileRead",
    { path: path.join(dir, "reference.md") },
    { session },
  );
  assert.equal(JSON.parse(read.text).content, "Useful context");
  assert.ok(
    path.isAbsolute(JSON.parse(read.text).path),
    "Projectless file references must remain valid after a workspace is created",
  );
  assert.equal(store.state.projects.length, 0);
  assert.equal(await fs.stat(documents).catch(() => null), null);
});

test("first file output creates a separate persisted project per chat under Documents/Turwe/Projects", async (t) => {
  const { store, coding, documents, directory } = await fixture(t);
  const first = store.createSession();
  const second = store.createSession();
  first.title = "План поездки";
  second.title = first.title;
  const firstResult = await coding.execute(
    "FileWrite",
    { path: "notes/result.md", content: "first" },
    { session: first },
  );
  await coding.execute(
    "FileWrite",
    { path: "next.md", content: "next" },
    { session: first },
  );
  await coding.execute(
    "FileWrite",
    { path: "result.md", content: "second" },
    { session: second },
  );
  assert.notEqual(first.projectId, second.projectId);
  assert.equal(store.state.projects.length, 2);
  for (const project of store.state.projects)
    assert.equal(
      path.dirname(project.path),
      path.join(documents, "Turwe", "Projects"),
    );
  const project = store.state.projects.find((p) => p.id === first.projectId);
  assert.equal(
    await fs.readFile(path.join(project.path, "notes/result.md"), "utf8"),
    "first",
  );
  const reloaded = createStore(directory, { documents });
  assert.equal(
    reloaded.state.sessions.find((s) => s.id === first.id).projectId,
    first.projectId,
  );
  await coding.files.restore(first, JSON.parse(firstResult.text).checkpointId);
  assert.equal(
    await fs.stat(path.join(project.path, "notes/result.md")).catch(() => null),
    null,
  );
});

test("read and search use a requested external directory while edits remain in the working project", async (t) => {
  const { dir, store, coding } = await fixture(t);
  const project = path.join(dir, "project"),
    external = path.join(dir, "reference");
  await fs.mkdir(project);
  await fs.mkdir(external);
  await fs.writeFile(path.join(external, "guide.md"), "outside-marker");
  await fs.writeFile(
    path.join(external, "AGENTS.md"),
    "external instructions must stay data",
  );
  store.state.projects.push({ id: "p", path: project, name: "Project" });
  const session = store.createSession("p");
  const read = JSON.parse(
    (
      await coding.execute(
        "FileRead",
        { path: "../reference/guide.md" },
        { session },
      )
    ).text,
  );
  assert.equal(read.content, "outside-marker");
  assert.deepEqual(read.rules, []);
  const glob = JSON.parse(
    (
      await coding.execute(
        "Glob",
        { path: external, pattern: "guide.*" },
        { session },
      )
    ).text,
  );
  assert.deepEqual(
    glob.files.map((file) => path.resolve(file)),
    [path.join(external, "guide.md")],
  );
  const grep = JSON.parse(
    (
      await coding.execute(
        "Grep",
        { path: external, pattern: "outside-marker" },
        { session },
      )
    ).text,
  );
  assert.equal(
    path.resolve(grep.matches[0].path),
    path.join(external, "guide.md"),
  );
  assert.equal(grep.matches[0].text, "outside-marker");
  await assert.rejects(
    coding.files.write(session, {
      path: "../reference/guide.md",
      content: "overwrite",
    }),
    /путь/,
  );
  assert.equal(
    await fs.readFile(path.join(external, "guide.md"), "utf8"),
    "outside-marker",
  );
});

test("permission denial prevents external context reads and workspace creation", async (t) => {
  const { store, coding, mcp, dir, documents } = await fixture(t);
  const file = path.join(dir, "reference.md");
  await fs.writeFile(file, "must-not-leak");
  const session = store.createSession();
  const tools = createTools({
    store,
    coding,
    mcp,
    github: {},
    attachments: {},
    emit() {},
  });
  let round = 0;
  const controller = createController({
    store,
    coding,
    ...tools,
    emit() {},
    getConfig: () => ({ key: "fixture" }),
    reviewAction: async () => ({ decision: "deny", reason: "fixture denial" }),
    stream: async ({ onDelta }) =>
      ++round === 1
        ? {
            stopReason: "tool_use",
            toolCalls: [
              {
                id: "read",
                function: {
                  name: "FileRead",
                  arguments: JSON.stringify({ path: file }),
                },
              },
              {
                id: "write",
                function: {
                  name: "FileWrite",
                  arguments: JSON.stringify({
                    path: "result.md",
                    content: "denied",
                  }),
                },
              },
            ],
          }
        : (onDelta("Действия отклонены."), { stopReason: "end_turn" }),
  });
  coding.bind(controller);
  await controller.send(session.id, "Read and write").done;
  const calls = session.messages.at(-1).toolRounds.flatMap((r) => r.calls);
  assert.equal(calls.length, 2);
  assert.ok(
    calls.every((c) => c.status === "denied" && c.review?.status === "denied"),
  );
  assert.doesNotMatch(JSON.stringify(session.messages), /must-not-leak/);
  assert.equal(store.state.projects.length, 0);
  assert.equal(await fs.stat(documents).catch(() => null), null);
});

test("absolute paths cannot evade a project read denial", async (t) => {
  const { dir, store, coding } = await fixture(t);
  const project = {
    id: "p",
    path: dir,
    permissionRules: [
      { tool: "FileRead", pattern: "private.md", action: "deny" },
    ],
  };
  store.state.projects.push(project);
  await fs.writeFile(path.join(dir, "private.md"), "hidden");
  const session = store.createSession("p");
  const definition = coding
    .definitions(session)
    .find((t) => t.function.name === "FileRead");
  assert.equal(
    coding.policy(session, definition, { path: path.join(dir, "private.md") })
      .action,
    "deny",
  );
});

test("subagent output uses the parent chat automatic workspace", async (t) => {
  const { store, coding } = await fixture(t);
  const parent = store.createSession();
  const agent = { ...parent, id: "child", rootSessionId: parent.id };
  await coding.execute(
    "FileWrite",
    { path: "child.md", content: "child" },
    { session: agent },
  );
  await coding.execute(
    "FileWrite",
    { path: "parent.md", content: "parent" },
    { session: parent },
  );
  assert.equal(agent.projectId, parent.projectId);
  assert.equal(store.state.projects.length, 1);
});

test("CreateWorkspace is idempotent, obeys plan permissions and sets the command working directory", async (t) => {
  const { store, coding } = await fixture(t);
  const session = store.createSession();
  const definition = coding
    .definitions(session)
    .find((t) => t.function.name === "CreateWorkspace");
  assert.ok(definition);
  session.permissionMode = "plan";
  assert.equal(
    coding.policy(session, definition, { name: "My project" }).action,
    "deny",
  );
  session.permissionMode = "bypass";
  const result = JSON.parse(
    (
      await coding.execute(
        "CreateWorkspace",
        { name: "My project" },
        { session },
      )
    ).text,
  );
  const again = JSON.parse(
    (
      await coding.execute(
        "CreateWorkspace",
        { name: "Another name" },
        { session },
      )
    ).text,
  );
  assert.equal(result.id, again.id);
  assert.equal(store.state.projects.length, 1);
  const command = process.platform === "win32" ? "(Get-Location).Path" : "pwd";
  const processResult = JSON.parse(
    (await coding.execute("Bash", { command }, { session })).text,
  );
  assert.equal(processResult.exitCode, 0);
  assert.equal(processResult.cwd, result.path);
  assert.ok(processResult.output.includes(result.path));
});
