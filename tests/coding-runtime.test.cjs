const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises"),
  path = require("node:path"),
  os = require("node:os");
const { execFileSync } = require("node:child_process");
const { createStore } = require("../electron/store.cjs");
const { createCodingRuntime } = require("../electron/coding-runtime.cjs");
const { createController } = require("../electron/controller.cjs");
const { createTools } = require("../electron/tools.cjs");
const { streamChat } = require("../electron/api.cjs");
const { webSearch, webFetch } = require("../electron/web-tools.cjs");
const { instructions } = require("../electron/workspace-context.cjs");
async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "turwe-runtime-")),
    project = path.join(dir, "project");
  await fs.mkdir(project);
  const store = createStore(path.join(dir, "data"));
  store.state.projects.push({ id: "p", name: "Fixture", path: project });
  const session = store.createSession("p");
  const mcp = { tools: () => [], list: () => [] };
  const coding = createCodingRuntime({
    store,
    directory: path.join(dir, "data"),
    emit() {},
    mcp,
  });
  t.after(async () => {
    await coding.close();
    await new Promise((r) => setTimeout(r, 300));
    await fs.rm(dir, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 100,
    });
  });
  return { dir, project, store, session, coding, mcp };
}

test("scoped grants apply through runtime policy and project context; reset independently revokes them", async (t) => {
  const { store, session, coding, project } = await fixture(t);
  const { rememberToolApproval } = require("../electron/action-approvals.cjs");
  const { definitions } = require("../electron/coding-runtime.cjs");
  const read = definitions.find((d) => d.function.name === "FileRead");
  const bash = definitions.find((d) => d.function.name === "Bash");
  const owner = store.state.projects[0];
  session.permissionMode = "simple";
  await fs.writeFile(path.join(project, "AGENTS.md"), "scoped-context-marker");
  rememberToolApproval(read, owner, store.state, "project");
  rememberToolApproval(bash, owner, store.state, "global");
  assert.equal(coding.policy(session, read, { path: "other.md" }).action, "allow");
  assert.equal(coding.policy(session, bash, { command: "echo example" }).action, "allow");
  assert.match(coding.context.prompt(session), /scoped-context-marker/);
  const before = await coding.ui(session, "state");
  assert.equal(before.approvedActionCount, 1);
  assert.equal(before.globalApprovalCount, 1);
  await coding.ui(session, "clearApprovals", { scope: "project" });
  assert.equal(coding.policy(session, read, { path: "other.md" }).action, "ask");
  assert.equal(coding.policy(session, bash, { command: "echo example" }).action, "allow");
  await coding.ui(session, "clearApprovals", { scope: "global" });
  assert.equal(coding.policy(session, bash, { command: "echo example" }).action, "ask");
  const after = await coding.ui(session, "state");
  assert.equal(after.approvedActionCount + after.globalApprovalCount, 0);
});

test("path-scoped rules are applied only to matching files", async (t) => {
  const { project } = await fixture(t);
  await fs.mkdir(path.join(project, ".claude/rules"), { recursive: true });
  await fs.mkdir(path.join(project, "src"), { recursive: true });
  await fs.writeFile(
    path.join(project, ".claude/rules/frontend.md"),
    '---\npaths:\n  - "src/**/*.tsx"\n---\nUse accessible components',
  );
  await fs.writeFile(
    path.join(project, "src/AGENTS.md"),
    "Run component tests",
  );
  assert.equal(instructions(project).length, 0);
  assert.match(
    JSON.stringify(instructions(project, "src/App.tsx")),
    /accessible components/,
  );
  assert.match(
    JSON.stringify(instructions(project, "src/App.tsx")),
    /component tests/,
  );
  assert.doesNotMatch(
    JSON.stringify(instructions(project, "src/server.ts")),
    /accessible components/,
  );
});
test("browser tools are available in a chat without a project", async (t) => {
  const { coding, store } = await fixture(t);
  const names = coding.definitions(store.createSession()).map(tool => tool.function.name);
  assert.ok(names.includes("Preview"));
  assert.ok(names.includes("FileWrite"));
});
test("projectless commands run in the home directory with normal permissions and session ownership", async (t) => {
  const { coding, store, mcp } = await fixture(t);
  const session = store.createSession();
  const tools = createTools({ store, coding, mcp, github: {}, attachments: {}, emit() {} });
  const definitions = tools.getTools(session);
  for (const name of ["Bash", "Process", "Preview"]) assert.ok(definitions.some(t => t.function.name === name), name);
  const bash = definitions.find(t => t.function.name === "Bash");
  const args = {command: process.platform === "win32" ? '(Get-Location).Path' : 'pwd', show:true};
  assert.equal(coding.policy(session,bash,args).action,"review");
  session.permissionMode="plan";
  assert.equal(coding.policy(session,bash,args).action,"deny");
  session.permissionMode="bypass";
  assert.equal(coding.policy(session,bash,args).action,"allow");
  const output = await coding.execute("Bash",args,{session});
  const result = JSON.parse(output.text);
  assert.equal(result.exitCode,0); assert.equal(result.isError,false);
  assert.equal(result.cwd,os.homedir()); assert.ok(result.output.includes(os.homedir()));
  assert.deepEqual(output.reveal,{panel:"terminal",processId:result.id});
  const status = await coding.execute("Process",{operation:"status",id:result.id},{session});
  assert.equal(JSON.parse(status.text).exitCode,0);
  await assert.rejects(coding.execute("Process",{operation:"status",id:result.id},{session:store.createSession()}),/не принадлежит/);
  assert.match(tools.systemPrompt(session),/Рабочая папка/);
  assert.ok(tools.systemPrompt(session).includes(os.homedir()));
  assert.match(tools.systemPrompt(session),/не означает.*администратор/);
});
test("real shell emits output and nonzero exit code; search uses project scope", async (t) => {
  const { project, session, coding } = await fixture(t);
  await coding.files.write(session, {
    path: "src/a.ts",
    content: "const marker = 1;\n",
  });
  const found = await coding.files.grep(session, { pattern: "marker" });
  assert.equal(
    found.matches[0].path.replaceAll("\\", "/").replace(/^\.\//, ""),
    "src/a.ts",
  );
  const result = await coding.processes.start(session, {
    command:
      process.platform === "win32"
        ? 'Write-Output "command-ok"; exit 7'
        : "echo command-ok; exit 7",
  });
  assert.match(result.output, /command-ok/);
  assert.equal(result.exitCode, 7);
  assert.equal(result.cwd, project);
});
test("Plan blocks edits, bypass skips permission rules, and auto allows only matching rules", async (t) => {
  const { session, coding, store } = await fixture(t);
  const tool = coding
    .definitions(session)
    .find((t) => t.function.name === "FileWrite");
  session.permissionMode = "plan";
  assert.equal(coding.policy(session, tool, { path: "a" }).action, "deny");
  session.permissionMode = "bypass";
  store.state.projects[0].permissionRules = [
    { tool: "File*", pattern: "private/**", action: "deny" },
  ];
  assert.equal(
    coding.policy(session, tool, { path: "private/a" }).action,
    "allow",
  );
  assert.equal(coding.policy(session, tool, { path: "src/a" }).action, "allow");
  session.permissionMode = "auto";
  store.state.projects[0].permissionRules = [
    { tool: "FileWrite", pattern: "src/**", action: "allow" },
  ];
  assert.equal(coding.policy(session, tool, { path: "a" }).action, "review");
  assert.equal(coding.policy(session, tool, { path: "src/a" }).action, "allow");
});
test("controller executes actual file tools and tasks and sends effort", async (t) => {
  const { dir, session, coding, store, mcp } = await fixture(t);
  session.permissionMode = "bypass";
  session.effort = "high";
  let step = 0;
  const tools = createTools({
    store,
    mcp,
    github: {},
    attachments: {},
    emit() {},
    coding,
  });
  const calls = [
    ["FileWrite", { path: "result.txt", content: "created" }],
    ["TaskCreate", { title: "Проверить результат" }],
    ["FileRead", { path: "result.txt" }],
  ];
  const controller = createController({
    store,
    coding,
    ...tools,
    emit() {},
    getConfig: () => ({ key: "fixture" }),
    stream: async ({ onDelta, effort }) => {
      assert.equal(effort, "high");
      if (step < calls.length) {
        const [name, args] = calls[step++];
        return {
          toolCalls: [
            {
              id: "call-" + step,
              function: { name, arguments: JSON.stringify(args) },
            },
          ],
        };
      }
      onDelta("Готово");
    },
  });
  coding.bind(controller);
  await controller.send(session.id, "Создай файл и проверь").done;
  assert.equal(session.messages.at(-1).status, "complete");
  assert.equal(session.tasks[0].title, "Проверить результат");
  assert.equal(
    (await coding.files.read(session, { path: "result.txt" })).content,
    "created",
  );
  assert.equal(store.state.checkpoints.length, 1);
  const actual = session.messages.at(-1).toolRounds.flatMap(round => round.calls);
  assert.deepEqual(actual[0].reveal, {panel: "changes", path: "result.txt"});
  assert.equal(actual[2].reveal, undefined, "ordinary reads do not open the editor");
  const opened = await coding.execute("FileRead", {path:"result.txt",show:true}, {session});
  assert.deepEqual(opened.reveal, {panel:"files",path:"result.txt"});
  assert.deepEqual(createStore(path.join(dir, "data")).state.sessions[0].messages.at(-1).toolRounds[0].calls[0].reveal, actual[0].reveal);
});
test("queued steering arrives in next request and does not start a parallel reply", async (t) => {
  const { session, store } = await fixture(t);
  let release,
    requests = 0,
    lastHistory;
  const controller = createController({
    store,
    emit() {},
    getConfig: () => ({ key: "fixture" }),
    stream: async ({ messages, onDelta }) => {
      requests++;
      if (requests === 1) await new Promise((r) => (release = r));
      else lastHistory = messages;
      onDelta("done");
    },
  });
  const job = controller.send(session.id, "first");
  controller.send(session.id, "steering");
  assert.equal(requests, 1);
  release();
  await job.done;
  assert.equal(requests, 2);
  assert.match(JSON.stringify(lastHistory), /steering/);
  assert.equal(session.queuedInputs.length, 0);
  assert.deepEqual(
    session.messages.map((m) => m.role),
    ["user", "assistant", "user", "assistant"],
  );
});

test("policy normalizes paths, checks every patch file and preserves profile restrictions", async (t) => {
  const { session, coding, store } = await fixture(t);
  const tool = (name) =>
    coding.definitions(session).find((t) => t.function.name === name);
  session.permissionMode = "auto";
  store.state.projects[0].permissionRules = [
    { tool: "*", pattern: "private/**", action: "deny" },
  ];
  assert.equal(
    coding.policy(session, tool("FileRead"), { path: "./private/key.txt" })
      .action,
    "deny",
  );
  assert.equal(
    coding.policy(session, tool("apply_patch"), {
      patch:
        "--- a/private/key.txt\n+++ b/private/key.txt\n@@ -1 +1 @@\n-x\n+y\n",
    }).action,
    "deny",
  );
  session.permissionMode = "plan";
  assert.equal(
    coding.policy(
      session,
      { function: { name: "mcp_read" }, mcp: { readOnly: true } },
      {},
    ).action,
    "allow",
  );
  assert.equal(
    coding.policy(
      session,
      { function: { name: "Agent" }, readOnly: true },
      { tasks: [{ worktree: true }] },
    ).action,
    "deny",
  );
  session.permissionMode = "bypass";
  session.allowedTools = ["Read", "Bash(npm test*)"];
  session.toolRestrictions = [["FileRead"]];
  assert.equal(
    coding.policy(session, tool("Bash"), { command: "npm test" }).action,
    "deny",
  );
  assert.equal(
    coding.policy(session, tool("FileRead"), { path: "ok.ts" }).action,
    "allow",
  );
});

test("automatic compaction trims closed tool rounds inside a single long turn", async (t) => {
  const { session, store } = await fixture(t);
  session.permissionMode = "bypass";
  store.state.settings.contextChars = 12000;
  let step = 0,
    summaries = 0,
    maxToolsAfterCompaction = 0;
  const definition = {
    type: "function",
    function: { name: "readLarge" },
    readOnly: true,
  };
  const controller = createController({
    store,
    emit() {},
    getConfig: () => ({ key: "fixture" }),
    getTools: () => [definition],
    executeTool: async () => ({ text: "x".repeat(6500) }),
    stream: async ({ messages, tools, onDelta }) => {
      if (!tools.length) {
        summaries++;
        onDelta("Goal and earlier file results");
        return;
      }
      if (summaries)
        maxToolsAfterCompaction = Math.max(
          maxToolsAfterCompaction,
          messages.filter((m) => m.role === "tool").length,
        );
      if (step++ < 5)
        return {
          toolCalls: [
            {
              id: "r" + step,
              function: { name: "readLarge", arguments: "{}" },
            },
          ],
        };
      onDelta("done");
    },
  });
  await controller.send(session.id, "Long coding task").done;
  assert.ok(summaries >= 1);
  assert.ok(maxToolsAfterCompaction <= 2);
  assert.equal(session.messages.at(-1).toolRounds.length, 5);
  assert.ok(session.compaction.rounds[session.messages.at(-1).id]);
});

test("compaction sends every hidden tool result even when summaries need multiple chunks", async (t) => {
  const { session, store } = await fixture(t);
  const received = [];
  let requests = 0;
  session.messages = [
    { id: "u", role: "user", content: "Original goal" },
    {
      id: "a",
      role: "assistant",
      status: "complete",
      content: "Done",
      toolRounds: Array.from({ length: 55 }, (_, i) => ({
        content: "c".repeat(2000),
        calls: [
          {
            id: "c" + i,
            name: "round_" + i,
            arguments: "x".repeat(1000),
            result: "y".repeat(1500),
            status: "complete",
          },
        ],
      })),
    },
  ];
  const original = JSON.stringify(session.messages);
  const controller = createController({
    store,
    emit() {},
    getConfig: () => ({ key: "fixture" }),
    stream: async ({ messages, onDelta }) => {
      requests++;
      assert.ok(messages[1].content.length < 120000);
      const payload = JSON.parse(messages[1].content);
      received.push(
        ...payload.history.flatMap((m) => (m.call ? [m.call.name] : [])),
      );
      onDelta("summary");
    },
  });
  await controller.compact(session.id);
  assert.ok(requests > 1);
  assert.equal(received.length, 54);
  assert.equal(new Set(received).size, 54);
  assert.equal(session.compaction.rounds.a, 54);
  assert.equal(JSON.stringify(session.messages), original);
});

test(
  "stopping a Windows command stops its descendant, and root can manage agent processes",
  { skip: process.platform !== "win32" },
  async (t) => {
    const { session, coding } = await fixture(t);
    const child = { ...session, id: "agent", rootSessionId: session.id };
    const source =
      "const{spawn}=require('node:child_process');const c=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore',windowsHide:true});console.log('child-pid:'+c.pid);setInterval(()=>{},1000)";
    const quote = (s) => "'" + s.replaceAll("'", "''") + "'";
    const job = await coding.processes.start(child, {
      command: "& " + quote(process.execPath) + " -e " + quote(source),
      background: true,
    });
    let pid;
    for (let i = 0; i < 100 && !pid; i++) {
      await new Promise((r) => setTimeout(r, 50));
      pid = Number(
        coding.processes
          .status(session, job.id)
          .output.match(/child-pid:(\d+)/)?.[1],
      );
    }
    assert.ok(pid, "descendant started");
    t.after(() => {
      try {
        execFileSync("taskkill.exe", ["/pid", String(pid), "/t", "/f"], {
          windowsHide: true,
          stdio: "ignore",
          timeout: 5000,
        });
      } catch {}
    });
    await coding.processes.stop(session, job.id);
    assert.throws(() => process.kill(pid, 0));
  },
);
test("real TypeScript LSP returns symbols, definition and diagnostics", async (t) => {
  const { session, coding } = await fixture(t);
  await coding.files.write(session, {
    path: "index.ts",
    content: 'export const answer: number = "wrong";\nconsole.log(answer);\n',
  });
  const symbols = await coding.lsp.request(session, {
    operation: "symbols",
    path: "index.ts",
  });
  assert.ok(symbols.some((s) => s.name === "answer"));
  const definitions = await coding.lsp.request(session, {
    operation: "definition",
    path: "index.ts",
    line: 2,
    character: 14,
  });
  assert.ok(definitions.length);
  const diagnostics = await coding.lsp.request(session, {
    operation: "diagnostics",
    path: "index.ts",
  });
  assert.ok(diagnostics.diagnostics.some((d) => d.severity === 1));
});
test("worktree isolates edits and Git commit uses only selected paths", async (t) => {
  const { session, coding, project, store } = await fixture(t);
  const git = (...args) =>
    execFileSync("git", args, {
      cwd: project,
      windowsHide: true,
      encoding: "utf8",
    });
  git("init", "--quiet");
  git("config", "user.name", "Turwe fixture");
  git("config", "user.email", "fixture@example.invalid");
  await fs.writeFile(path.join(project, "a.txt"), "base");
  git("add", "a.txt");
  git("commit", "--quiet", "-m", "initial");
  const child = { ...session, id: "child" };
  await coding.git.worktree(child);
  await coding.files.edit(child, {
    path: "a.txt",
    oldText: "base",
    newText: "child",
  });
  assert.equal(await fs.readFile(path.join(project, "a.txt"), "utf8"), "base");
  assert.match(
    (await coding.git.execute(child, { operation: "diff" })).diff,
    /child/,
  );
  assert.ok(child.worktreePath);
  assert.equal(session.worktreePath, undefined);
});
test("project memory and rules persist, manual compaction retains original history", async (t) => {
  const { session, coding, project, store } = await fixture(t);
  session.permissionMode = "plan";
  await fs.writeFile(path.join(project, "AGENTS.md"), "Use fixture tests");
  coding.context.writeMemory(session, { content: "Prefer TypeScript" });
  assert.match(coding.prompt(session), /Use fixture tests/);
  assert.match(coding.prompt(session), /Prefer TypeScript/);
  let count = 0;
  const controller = createController({
    store,
    coding,
    emit() {},
    getConfig: () => ({ key: "fixture" }),
    stream: async ({ onDelta }) => onDelta("summary or reply " + ++count),
  });
  coding.bind(controller);
  for (let i = 0; i < 5; i++)
    await controller.send(session.id, "input " + i).done;
  const original = JSON.stringify(session.messages);
  await controller.compact(session.id);
  assert.ok(session.compaction?.summary);
  assert.equal(JSON.stringify(session.messages), original);
});
test("effort is transmitted without usage or cost options", async () => {
  let body;
  await streamChat({
    baseUrl: "https://example.test/v1",
    key: "fixture",
    model: "test",
    effort: "high",
    messages: [],
    onDelta() {},
    fetchImpl: async (_url, init) => {
      body = JSON.parse(init.body);
      return new Response(
        JSON.stringify({ choices: [{ message: { content: "ok" } }] }),
        { headers: { "Content-Type": "application/json" } },
      );
    },
  });
  assert.equal(body.reasoning_effort, "high");
  assert.equal(body.stream_options, undefined);
});

test("forked skills load once in a child and retain specialist restrictions", async (t) => {
  const { session, coding, store, mcp } = await fixture(t);
  session.permissionMode = "bypass";
  let childHistory;
  store.state.skills.push({
    id: "fork-review",
    name: "fork-review",
    description: "Review a file",
    body: "Inspect the project carefully",
    fork: true,
    agent: "reviewer",
    allowedTools: [],
    manualOnly: false,
    userInvocable: true,
    unsupported: [],
    references: [],
    projectId: null,
  });
  const tools = createTools({
    store,
    mcp,
    github: {},
    attachments: {},
    emit() {},
    coding,
  });
  const controller = createController({
    store,
    coding,
    ...tools,
    systemPrompt: (s) =>
      (s.rootSessionId ? "CHILD" : "ROOT") + "\n" + coding.prompt(s),
    emit() {},
    getConfig: () => ({ key: "fixture" }),
    stream: async ({ messages, tools, onDelta }) => {
      if (
        messages[0].content.startsWith("ROOT") &&
        !messages.some((m) => m.role === "tool")
      )
        return {
          toolCalls: [
            {
              id: "fork-call",
              function: { name: "Skill", arguments: '{"name":"fork-review"}' },
            },
          ],
        };
      if (messages[0].content.startsWith("CHILD")) {
        childHistory = messages;
        assert.ok(tools.some((t) => t.function.name === "FileRead"));
        assert.ok(!tools.some((t) => t.function.name === "Bash"));
      }
      onDelta("review done");
    },
  });
  coding.bind(controller);
  await controller.send(session.id, "@fork-review").done;
  assert.ok(childHistory);
  assert.match(JSON.stringify(childHistory), /Inspect the project carefully/);
  assert.doesNotMatch(
    JSON.stringify(childHistory),
    /Сначала вызови Skill для fork-review/,
  );
  const child = session.messages.at(-1).agents[0];
  assert.equal(child.profileId, "reviewer");
  assert.ok(child.allowedTools.includes("FileRead"));
});
test("web search parses source data and WebFetch rejects internal endpoints", async () => {
  const result = await webSearch(
    { query: "fixture" },
    {
      fetchImpl: async () =>
        new Response(
          "data: " +
            JSON.stringify({
              result: {
                content: [
                  { type: "text", text: "Source: https://example.com" },
                ],
              },
            }) +
            "\n\n",
        ),
    },
  );
  assert.match(result.content, /example.com/);
  await assert.rejects(webFetch({ url: "http://127.0.0.1/secret" }), /Preview/);
});

test("Skill tool expands positional arguments exactly like an explicit chat mention", async (t) => {
  const { coding, session, store } = await fixture(t);
  const { parseSkill, resolveSkills } = require("../electron/skills.cjs");
  const skill = {
    ...parseSkill(
      "---\nname: argument-probe\n---\nFirst=$0; second=$ARGUMENTS[1]; all=$ARGUMENTS; dir=${CLAUDE_SKILL_DIR}",
    ),
    id: "argument-probe",
    projectId: null,
  };
  store.state.skills.push(skill);
  const args = '"two words" third';
  const result = JSON.parse(
    (
      await coding.execute(
        "Skill",
        {
          name: skill.name,
          arguments: args,
        },
        { session },
      )
    ).text,
  );
  const explicit = resolveSkills([skill], null, "@argument-probe " + args)[0];
  assert.equal(
    result.instructions,
    explicit.instructions.replace("${CLAUDE_SKILL_DIR}", result.directory),
  );
});

test("manual-only Skill tool requires an actual invocation, not a code example or a longer name", async (t) => {
  const { coding, session, store } = await fixture(t);
  const { parseSkill } = require("../electron/skills.cjs");
  store.state.skills.push({
    ...parseSkill(
      "---\nname: manual\ndisable-model-invocation: true\n---\nDo a review",
    ),
    id: "manual",
  });
  for (const content of [
    "Example: `@manual`",
    "@manual-other",
    "```text\n/manual\n```",
  ]) {
    session.messages = [{ id: "u", role: "user", content }];
    await assert.rejects(
      coding.execute("Skill", { name: "manual" }, { session }),
      /пользовател/,
    );
  }
  session.messages = [{ id: "u", role: "user", content: "@manual inspect" }];
  assert.match(
    (await coding.execute("Skill", { name: "manual" }, { session })).text,
    /Do a review/,
  );
});

test("tasks and submitted plan persist and approving it starts work only in that chat", async (t) => {
  const { coding, session, store, dir } = await fixture(t);
  const execute = async (name, args = {}) =>
    JSON.parse((await coding.execute(name, args, { session })).text);
  const task = await execute("TaskCreate", { title: "Check fixture" });
  await execute("TaskUpdate", {
    id: task.id,
    status: "in_progress",
    note: "Started",
  });
  assert.equal((await execute("TaskList"))[0].status, "in_progress");
  await assert.rejects(
    execute("TaskUpdate", { id: task.id, status: "invented" }),
    /статус/,
  );
  const other = store.createSession("p");
  assert.deepEqual(
    JSON.parse((await coding.execute("TaskList", {}, { session: other })).text),
    [],
  );
  await execute("submit_plan", { plan: "Read, fix, verify" });
  assert.equal(session.permissionMode, "plan");
  assert.equal(
    createStore(path.join(dir, "data")).state.sessions.find(
      (s) => s.id === session.id,
    ).plan.status,
    "awaiting",
  );
  const sent = [];
  coding.bind({
    send: (...args) => {
      sent.push(args);
      return { messageId: "execution" };
    },
  });
  assert.equal(await coding.ui(session, "approvePlan"), "execution");
  assert.equal(session.plan.status, "approved");
  assert.equal(session.permissionMode, "auto");
  assert.equal(sent[0][0], session.id);
  await assert.rejects(coding.ui(session, "approvePlan"), /Нет плана/);
});

test("Git commit includes selected files and leaves another staged change staged", async (t) => {
  const { session, coding, project } = await fixture(t);
  const git = (...args) =>
    execFileSync("git", args, {
      cwd: project,
      windowsHide: true,
      encoding: "utf8",
    }).trim();
  git("init", "--quiet");
  git("config", "user.name", "Turwe fixture");
  git("config", "user.email", "fixture@example.invalid");
  for (const name of ["chosen.txt", "other.txt"])
    await fs.writeFile(path.join(project, name), "before\n");
  git("add", "chosen.txt", "other.txt");
  git("commit", "--quiet", "-m", "initial");
  for (const name of ["chosen.txt", "other.txt"])
    await fs.writeFile(path.join(project, name), "after\n");
  git("add", "other.txt");
  await coding.git.execute(session, {
    operation: "commit",
    message: "selected only",
    paths: ["chosen.txt"],
  });
  assert.equal(git("show", "--pretty=", "--name-only", "HEAD"), "chosen.txt");
  assert.equal(git("diff", "--cached", "--name-only"), "other.txt");
  assert.equal(git("show", "HEAD:other.txt"), "before");
});

test("MCP tool search makes a matching tool available from a large connector catalogue", async (t) => {
  const { session, coding, store, mcp } = await fixture(t);
  const definitions = Array.from({ length: 20 }, (_, i) => ({
    type: "function",
    function: {
      name: `mcp_tool_${i}`,
      description: i === 15 ? "Figma design context" : "Other action",
    },
    mcp: { connectorName: "Fixture" },
  }));
  mcp.tools = () => definitions;
  const tools = createTools({
    store,
    mcp,
    github: {},
    attachments: {},
    coding,
    emit() {},
  });
  assert.ok(
    !tools.getTools(session).some((d) => d.function.name === "mcp_tool_15"),
  );
  await coding.execute("ToolSearch", { query: "Figma" }, { session });
  assert.ok(
    tools.getTools(session).some((d) => d.function.name === "mcp_tool_15"),
  );
  assert.ok(
    !tools.getTools(session).some((d) => d.function.name === "mcp_tool_1"),
  );
});

test("WebFetch parses public HTML, refuses redirects into private space, and propagates HTTP errors", async () => {
  const fixtureUrl = "https://93.184.216.34/page";
  const result = await webFetch(
    { url: fixtureUrl },
    {
      fetchImpl: async () =>
        new Response(
          '<html><style>hidden</style><script>also hidden</script><p>Hello &amp; welcome</p><a href="https://example.test/docs">Docs</a></html>',
          { headers: { "content-type": "text/html" } },
        ),
    },
  );
  assert.match(result.content, /Hello & welcome/);
  assert.match(result.content, /https:\/\/example.test\/docs/);
  assert.doesNotMatch(result.content, /hidden/);
  await assert.rejects(
    webFetch(
      { url: fixtureUrl },
      {
        fetchImpl: async () =>
          new Response(null, {
            status: 302,
            headers: { location: "http://127.0.0.1/private" },
          }),
      },
    ),
    /Preview/,
  );
  await assert.rejects(
    webFetch(
      { url: fixtureUrl },
      { fetchImpl: async () => new Response("No", { status: 503 }) },
    ),
    /503/,
  );
  await assert.rejects(
    webSearch(
      { query: "fixture" },
      {
        fetchImpl: async () =>
          new Response(
            JSON.stringify({
              jsonrpc: "2.0",
              id: 1,
              error: { message: "Search unavailable" },
            }),
          ),
      },
    ),
    /Search unavailable/,
  );
});
