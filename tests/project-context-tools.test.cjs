const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { createStore } = require("../electron/store.cjs");
const { createCodingRuntime } = require("../electron/coding-runtime.cjs");
const { createTools } = require("../electron/tools.cjs");
const { createController } = require("../electron/controller.cjs");
const { webSearch } = require("../electron/web-tools.cjs");

async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "turwe-context-"));
  const project = path.join(dir, "Тестовый проект");
  await fs.mkdir(path.join(project, ".claude"), { recursive: true });
  await fs.mkdir(path.join(project, "deploy"));
  await fs.writeFile(
    path.join(project, "ПРОЕКТ.md"),
    "# Deployment\nUse SSH alias fixture-server; read deploy/server.md for the check.",
  );
  await fs.writeFile(
    path.join(project, "README.md"),
    "Project overview marker",
  );
  await fs.writeFile(
    path.join(project, ".claude/CLAUDE.md"),
    "Verify changes with project tests.",
  );
  await fs.writeFile(
    path.join(project, "credentials.private.json"),
    '{"password":"do-not-auto-load"}',
  );
  await fs.writeFile(path.join(project, ".env"), "TOKEN=do-not-auto-load-env");
  const store = createStore(path.join(dir, "data"));
  store.state.projects.push({ id: "p", name: "Fixture", path: project });
  const session = store.createSession("p");
  session.permissionMode = "plan";
  const mcp = { tools: () => [], list: () => [] };
  const coding = createCodingRuntime({
    store,
    directory: path.join(dir, "data"),
    emit() {},
    mcp,
  });
  const tools = createTools({
    store,
    coding,
    mcp,
    github: {},
    attachments: {},
    emit() {},
  });
  t.after(async () => {
    await coding.close();
    await fs.rm(dir, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 100,
    });
  });
  return { dir, project, store, session, coding, tools };
}

test("first request includes selected workspace, overview and .claude instructions without credential contents", async (t) => {
  const { project, store, session, coding, tools } = await fixture(t);
  const requests = [];
  const controller = createController({
    store,
    coding,
    ...tools,
    emit() {},
    getConfig: () => ({ key: "fixture" }),
    stream: async ({ messages, onDelta }) => {
      requests.push(messages);
      onDelta("Есть контекст проекта.");
    },
  });
  coding.bind(controller);
  await controller.send(session.id, "сможешь зайти на серв?").done;
  const first = requests[0]
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n");
  assert.ok(first.includes(project));
  assert.match(first, /fixture-server/);
  assert.match(first, /Project overview marker/);
  assert.match(first, /Verify changes with project tests/);
  assert.match(first, /deploy/);
  assert.match(first, new RegExp(process.platform));
  assert.doesNotMatch(first, /do-not-auto-load/);
  await fs.writeFile(
    path.join(project, "README.md"),
    "Updated project overview",
  );
  await controller.send(session.id, "продолжай").done;
  const next = requests
    .at(-1)
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n");
  assert.match(next, /Updated project overview/);
  assert.doesNotMatch(next, /Project overview marker/);
});

test("automatic overview honors read permissions, uses the active worktree and tolerates a missing folder", async (t) => {
  const { dir, store, session, coding } = await fixture(t);
  store.state.projects[0].permissionRules = [
    { tool: "FileRead", pattern: "ПРОЕКТ.md", action: "deny" },
  ];
  assert.doesNotMatch(coding.prompt(session), /fixture-server/);
  session.permissionMode = "ask";
  assert.doesNotMatch(coding.prompt(session), /Project overview marker/);
  session.permissionMode = "plan";
  session.allowedTools = ["Grep"];
  assert.doesNotMatch(coding.prompt(session), /Project overview marker/);
  delete session.allowedTools;
  session.worktreePath = path.join(dir, "worktree");
  await fs.mkdir(session.worktreePath);
  await fs.writeFile(
    path.join(session.worktreePath, "README.md"),
    "Isolated worktree overview",
  );
  const context = coding.prompt(session);
  assert.match(context, /Isolated worktree overview/);
  assert.doesNotMatch(context, /Project overview marker/);
  session.worktreePath = path.join(dir, "missing");
  assert.match(coding.prompt(session), /недоступн/);
});

test("auto and simplified modes do not preload unapproved files; explicit context rules still work", async (t) => {
  const { store, session, coding } = await fixture(t);
  for (const mode of ["auto", "simple"]) {
    session.permissionMode = mode;
    assert.doesNotMatch(coding.prompt(session), /Project overview marker|fixture-server|Verify changes/);
  }
  store.state.projects[0].permissionRules = [{ tool: "FileRead", pattern: "README.md", action: "allow" }];
  assert.match(coding.prompt(session), /Project overview marker/);
  assert.doesNotMatch(coding.prompt(session), /fixture-server|Verify changes/);
});

test("overview is bounded and does not load instructions through an external directory link", async (t) => {
  const { dir, project, session, coding } = await fixture(t);
  await fs.writeFile(path.join(project, "README.md"), "A".repeat(200_000));
  const external = path.join(dir, "external");
  await fs.mkdir(external);
  await fs.writeFile(
    path.join(external, "CLAUDE.md"),
    "external-instructions-must-not-load",
  );
  await fs.rename(
    path.join(project, ".claude"),
    path.join(project, ".claude-original"),
  );
  await fs.symlink(
    external,
    path.join(project, ".claude"),
    process.platform === "win32" ? "junction" : "dir",
  );
  const prompt = coding.prompt(session);
  assert.ok(prompt.length < 40_000);
  assert.match(prompt, /truncated|сокращ/);
  assert.doesNotMatch(prompt, /external-instructions-must-not-load/);
});

test("failed shell command remains an error in controller history and the agent can recover", async (t) => {
  const { store, session, coding, tools } = await fixture(t);
  session.permissionMode = "bypass";
  let step = 0;
  const controller = createController({
    store,
    coding,
    ...tools,
    emit() {},
    getConfig: () => ({ key: "fixture" }),
    stream: async ({ messages, onDelta }) => {
      if (step++ === 0)
        return {
          toolCalls: [
            {
              id: "failed-command",
              function: {
                name: "Bash",
                arguments: JSON.stringify({
                  command:
                    process.platform === "win32" ? "cmd /c exit 7" : "exit 7",
                }),
              },
            },
          ],
        };
      const result = JSON.parse(
        messages.find((m) => m.role === "tool").content,
      );
      assert.equal(result.exitCode, 7);
      assert.equal(result.isError, true);
      onDelta("Команда завершилась с кодом 7.");
    },
  });
  coding.bind(controller);
  await controller.send(session.id, "Проверь код возврата").done;
  const reply = session.messages.at(-1);
  assert.equal(reply.status, "complete", reply.error);
  assert.equal(reply.toolRounds[0].calls[0].status, "error");
});

test(
  "PowerShell returns readable Unicode and treats a missing command as a failure",
  { skip: process.platform !== "win32" },
  async (t) => {
    const { session, coding } = await fixture(t);
    const result = await coding.processes.start(session, {
      command: 'Write-Output "Привет из проекта"',
    });
    assert.equal(result.output.trim(), "Привет из проекта");
    assert.equal(result.exitCode, 0);
    const failed = await coding.processes.start(session, {
      command: "turwe_missing_command_qa",
    });
    assert.equal(failed.isError, true);
    assert.notEqual(failed.exitCode, 0);
    assert.doesNotMatch(failed.output, /CLIXML|_x000D_/);
  },
);

test("timed-out command and long process output keep usable structured results", async (t) => {
  const { session, coding } = await fixture(t);
  const ctx = { session, signal: new AbortController().signal };
  const timeout = await coding.execute(
    "Bash",
    {
      command:
        process.platform === "win32" ? "Start-Sleep -Seconds 20" : "sleep 20",
      timeoutMs: 1000,
    },
    ctx,
  );
  assert.equal(timeout.isError, true);
  assert.equal(JSON.parse(timeout.text).timedOut, true);
  const result = await coding.execute(
    "Bash",
    {
      command:
        process.platform === "win32"
          ? 'Write-Output ("x" * 120000)'
          : "printf '%120000s' x",
    },
    ctx,
  );
  assert.ok(result.text.length < 100000);
  const output = JSON.parse(result.text);
  assert.equal(output.exitCode, 0);
  assert.equal(output.outputTruncated, true);
});

test("Process stop awaits completion and invalid operations never send input", async (t) => {
  const { session, coding } = await fixture(t);
  let stopped = false,
    input = false;
  coding.processes.stop = async () => {
    await new Promise((r) => setTimeout(r, 20));
    stopped = true;
    return { stopped: true };
  };
  coding.processes.input = () => {
    input = true;
  };
  const ctx = { session, signal: new AbortController().signal };
  const result = await coding.execute(
    "Process",
    { operation: "stop", id: "fixture" },
    ctx,
  );
  assert.equal(stopped, true);
  assert.deepEqual(JSON.parse(result.text), { stopped: true });
  await assert.rejects(
    coding.execute("Process", { operation: "typo", id: "fixture" }, ctx),
    /операци/,
  );
  assert.equal(input, false);
  await assert.rejects(
    coding.execute(
      "Memory",
      { operation: "typo", content: "must-not-save" },
      ctx,
    ),
    /операци/,
  );
  assert.equal(coding.context.readMemory(session).memory, "");
});

test("Grep finds ignored project deployment docs just like Glob", async (t) => {
  const { project, session, coding } = await fixture(t);
  await fs.writeFile(path.join(project, ".gitignore"), "deploy/\n");
  await fs.writeFile(
    path.join(project, "deploy/server.md"),
    "fixture-deployment-marker",
  );
  // ripgrep reads ignore files in a repository; no Git executable is needed.
  await fs.mkdir(path.join(project, ".git"));
  const result = await coding.files.grep(session, {
    pattern: "fixture-deployment-marker",
  });
  assert.equal(result.matches.length, 1);
  assert.equal(result.matches[0].path, "deploy/server.md");
});

test("WebSearch propagates MCP tool errors rather than treating them as search evidence", async () => {
  await assert.rejects(
    webSearch(
      { query: "fixture" },
      {
        fetchImpl: async () =>
          new Response(
            JSON.stringify({
              jsonrpc: "2.0",
              id: 1,
              result: {
                isError: true,
                content: [{ type: "text", text: "Search rate limit reached" }],
              },
            }),
            { headers: { "content-type": "application/json" } },
          ),
      },
    ),
    /Search rate limit reached/,
  );
});

test("matching ask rule takes precedence over an allow rule regardless of ordering", async (t) => {
  const { session, coding, store } = await fixture(t);
  session.permissionMode = "auto";
  const definition = coding
    .definitions(session)
    .find((tool) => tool.function.name === "Bash");
  const rules = [
    { tool: "Bash", pattern: "*", action: "ask" },
    { tool: "Bash", pattern: "ssh *", action: "allow" },
  ];
  for (const order of [rules, rules.toReversed()]) {
    store.state.projects[0].permissionRules = order;
    assert.equal(
      coding.policy(session, definition, { command: "ssh fixture-server" })
        .action,
      "ask",
    );
  }
  store.state.projects[0].permissionRules.push({
    tool: "Bash",
    pattern: "ssh *",
    action: "deny",
  });
  assert.equal(
    coding.policy(session, definition, { command: "ssh fixture-server" })
      .action,
    "deny",
  );
});
