const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const { createStore } = require("../electron/store.cjs");
const { createController } = require("../electron/controller.cjs");
const { questionDefinition } = require("../electron/interaction.cjs");

test("delegation reserves one slot within the API limit of 128 tool definitions", async (t) => {
  let count = 0;
  const { store, controller } = fixture(
    t,
    async ({ tools, onDelta }) => {
      count = tools.length;
      assert.ok(tools.some((tool) => tool.function.name === "delegate_tasks"));
      onDelta("done");
    },
    {
      getTools: () =>
        Array.from({ length: 128 }, (_, i) => ({
          type: "function",
          function: { name: `tool_${i}`, parameters: { type: "object" } },
          readOnly: true,
        })),
    },
  );
  const root = store.createSession();
  await controller.send(root.id, "hello").done;
  assert.equal(count, 128);
});

test("restart and retry retain a completed child mutation while another child was awaiting input", async (t) => {
  const write = {
    type: "function",
    function: { name: "write", parameters: { type: "object" } },
    readOnly: false,
  };
  const { store, controller, dir } = fixture(
    t,
    async ({ messages, onDelta }) => {
      if (isRoot(messages))
        return tool("delegate_tasks", tasks("writer", "waiting"));
      const prompt = messages.find(
        (message) => message.role === "user",
      ).content;
      if (!messages.some((message) => message.role === "tool"))
        return prompt === "writer"
          ? tool("write", {})
          : tool("ask_user", {
              questions: [{ id: "q", question: "Continue?" }],
            });
      onDelta("Child writer completed");
    },
    {
      getTools: () => [write, questionDefinition],
      executeTool: async () => ({ text: "MUTATION_RECEIPT_742" }),
    },
  );
  const root = store.createSession();
  root.permissionMode = "bypass";
  const job = controller.send(root.id, "root");
  for (let i = 0; i < 15; i++) await tick();
  assert.deepEqual(
    root.messages.at(-1).agents.map((agent) => agent.messages.at(-1).status),
    ["complete", "question"],
  );
  const recovered = createStore(dir);
  controller.stop(root.id);
  await job.done;
  let sentHistory;
  const resumed = createController({
    store: recovered,
    getConfig: () => ({ key: "test", baseUrl: "https://example.test/v1" }),
    emit: () => {},
    stream: async ({ messages, onDelta }) => {
      sentHistory = JSON.stringify(messages);
      onDelta("Summary of existing results");
    },
  });
  t.after(() => resumed.stopAll());
  await resumed.retry(root.id).done;
  assert.ok(
    sentHistory.includes("Child writer completed"),
    "completed child output reaches parent after restart",
  );
  assert.ok(
    sentHistory.includes("MUTATION_RECEIPT_742"),
    "completed tool outcome reaches parent after restart",
  );
  assert.ok(
    sentHistory.includes("stopped"),
    "unfinished sibling is reported as stopped, not completed",
  );
});
const tick = () => new Promise((resolve) => setImmediate(resolve));
const tool = (name, args, id = "call-" + name) => ({
  toolCalls: [{ id, function: { name, arguments: JSON.stringify(args) } }],
});
const tasks = (...names) => ({
  tasks: names.map((name) => ({ title: name, task: name })),
});
function fixture(t, stream, options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "turwe-agents-"));
  const store = createStore(dir);
  const controller = createController({
    store,
    getConfig: () => ({ key: "test", baseUrl: "https://example.test/v1" }),
    emit: () => {},
    stream,
    getTools: () => [],
    systemPrompt: (session) => (session.rootSessionId ? "CHILD" : "ROOT"),
    ...options,
  });
  t.after(() => {
    controller.stopAll();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return { store, controller, dir };
}
function isRoot(messages) {
  return messages[0]?.content === "ROOT";
}

test("background agents continue after the root reply and receive queued follow-up messages", async (t) => {
  let release,
    childRequests = 0;
  const { store, controller } = fixture(t, async ({ messages, onDelta }) => {
    if (isRoot(messages)) {
      if (!messages.some((m) => m.role === "tool"))
        return tool("Agent", { ...tasks("background"), background: true });
      onDelta("Parent can continue");
      return;
    }
    if (childRequests++ === 0) await new Promise((r) => (release = r));
    onDelta(
      messages.at(-1).content === "follow-up"
        ? "Follow-up done"
        : "Background done",
    );
  });
  const root = store.createSession();
  await controller.send(root.id, "root").done;
  const child = root.messages.at(-1).agents[0];
  assert.equal(root.messages.at(-1).status, "complete");
  assert.equal(controller.isRunning(child.id), true);
  assert.deepEqual(controller.messageAgent(root.id, child.id, "follow-up"), {
    queued: true,
  });
  release();
  for (let i = 0; i < 100 && controller.isRunning(child.id); i++) await tick();
  assert.equal(child.messages.at(-1).status, "complete");
  assert.equal(childRequests, 2);
  assert.equal(child.messages.at(-2).content, "follow-up");
  assert.match(controller.agentList(root.id)[0].result, /Follow-up/);
});

test("only a user follow-up can restart a stopped agent", async (t) => {
  let childCalls = 0;
  const { store, controller } = fixture(
    t,
    async ({ messages, onDelta, signal }) => {
      if (isRoot(messages)) {
        if (!messages.some((m) => m.role === "tool"))
          return tool("Agent", { ...tasks("background"), background: true });
        onDelta("root done");
        return;
      }
      if (childCalls++ === 0)
        await new Promise((_r, reject) =>
          signal.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          }),
        );
      else onDelta("User resumed");
    },
  );
  const root = store.createSession();
  await controller.send(root.id, "root").done;
  const child = root.messages.at(-1).agents[0];
  controller.stopAgent(root.id, child.id);
  for (let i = 0; i < 100 && controller.isRunning(child.id); i++) await tick();
  assert.equal(child.messages.at(-1).status, "stopped");
  assert.throws(
    () => controller.messageAgent(root.id, child.id, "model resumes"),
    /пользовател/,
  );
  assert.deepEqual(
    controller.messageAgent(root.id, child.id, "user resumes", {
      userInitiated: true,
    }),
    { started: true },
  );
  for (let i = 0; i < 100 && controller.isRunning(child.id); i++) await tick();
  assert.equal(child.messages.at(-1).status, "complete");
  assert.match(child.messages.at(-1).content, /User resumed/);
});
test("delegation starts real concurrent isolated child requests and returns their results to the parent", async (t) => {
  let active = 0,
    max = 0,
    childRequests = 0;
  const { store, controller } = fixture(
    t,
    async ({ messages, onDelta, tools }) => {
      if (isRoot(messages)) {
        if (!messages.some((m) => m.role === "tool"))
          return tool("delegate_tasks", tasks("alpha", "beta", "gamma"));
        const result = JSON.parse(
          messages.find((m) => m.role === "tool").content,
        );
        assert.deepEqual(
          result.agents.map((a) => a.result),
          ["result alpha", "result beta", "result gamma"],
        );
        onDelta("parent summary");
        return;
      }
      childRequests++;
      max = Math.max(max, ++active);
      assert.equal(messages.filter((m) => m.role === "user").length, 1);
      assert.ok(!JSON.stringify(messages).includes("PRIVATE PRIOR CONTEXT"));
      await tick();
      active--;
      onDelta("result " + messages.at(-1).content);
    },
  );
  const session = store.createSession();
  session.messages.push({
    id: "old",
    role: "user",
    content: "PRIVATE PRIOR CONTEXT",
  });
  await controller.send(session.id, "Split work").done;
  const reply = session.messages.at(-1);
  assert.ok(Array.isArray(reply.agents), "real agent records must be created");
  assert.equal(childRequests, 3);
  assert.equal(max, 3);
  assert.equal(reply.status, "complete");
  assert.equal(reply.finalContent, "parent summary");
  assert.equal(store.state.sessions.length, 1);
  assert.ok(
    reply.agents.every(
      (a) =>
        a.rootSessionId === session.id &&
        a.messages.at(-1).status === "complete",
    ),
  );
});
test("nested delegation returns a tree and removes delegation at depth two", async (t) => {
  const { store, controller } = fixture(
    t,
    async ({ messages, onDelta, tools }) => {
      const prompt = messages.find((m) => m.role === "user").content;
      const hasResult = messages.some((m) => m.role === "tool");
      if (!hasResult && isRoot(messages))
        return tool("delegate_tasks", tasks("middle"));
      if (!hasResult && prompt === "middle")
        return tool("delegate_tasks", tasks("leaf-a", "leaf-b"));
      if (prompt.startsWith("leaf"))
        assert.ok(!tools.some((t) => t.function.name === "delegate_tasks"));
      onDelta(prompt + " done");
    },
  );
  const session = store.createSession();
  await controller.send(session.id, "root task").done;
  const middle = session.messages.at(-1).agents?.[0];
  assert.ok(middle, "middle agent exists");
  assert.equal(middle.depth, 1);
  assert.equal(middle.messages.at(-1).agents.length, 2);
  assert.ok(
    middle.messages
      .at(-1)
      .agents.every((a) => a.parentAgentId === middle.id && a.depth === 2),
  );
});
test("sibling approvals with the same provider call ID are isolated and inherit permission changes", async (t) => {
  let mutations = 0;
  const write = {
    type: "function",
    function: { name: "write", parameters: { type: "object" } },
    readOnly: false,
  };
  const { store, controller } = fixture(
    t,
    async ({ messages, onDelta }) => {
      if (!messages.some((m) => m.role === "tool"))
        return isRoot(messages)
          ? tool("delegate_tasks", tasks("a", "b"))
          : tool("write", {}, "same-call");
      onDelta("done");
    },
    {
      getTools: () => [write],
      executeTool: async () => {
        mutations++;
        return { text: "written" };
      },
    },
  );
  const root = store.createSession(),
    other = store.createSession(),
    job = controller.send(root.id, "root");
  for (let i = 0; i < 12; i++) await tick();
  const children = root.messages.at(-1).agents;
  assert.equal(children?.length, 2);
  assert.ok(children.every((a) => a.messages.at(-1).status === "approval"));
  assert.equal(mutations, 0);
  assert.throws(
    () => controller.approve(other.id, "same-call", true, children[0].id),
    /агент|сессии/,
  );
  controller.approve(root.id, "same-call", true, children[0].id);
  await tick();
  assert.equal(mutations, 1);
  root.permissionMode = "bypass";
  controller.permissionsChanged(root.id);
  await job.done;
  assert.equal(mutations, 2);
});
test("child questions use the real answer and restart interrupts nested pending state", async (t) => {
  const question = {
    questions: [
      {
        id: "choice",
        question: "Choose",
        options: [{ label: "One" }, { label: "Two" }],
      },
    ],
  };
  const { store, controller, dir } = fixture(
    t,
    async ({ messages, onDelta }) => {
      if (!messages.some((m) => m.role === "tool"))
        return isRoot(messages)
          ? tool("delegate_tasks", tasks("child"))
          : tool("ask_user", question, "question");
      onDelta("done");
    },
    { getTools: () => [questionDefinition] },
  );
  const root = store.createSession(),
    job = controller.send(root.id, "root");
  for (let i = 0; i < 12; i++) await tick();
  const child = root.messages.at(-1).agents?.[0];
  assert.ok(child);
  assert.equal(child.messages.at(-1).status, "question");
  const loaded = createStore(dir).state.sessions[0].messages.at(-1).agents[0];
  assert.equal(loaded.messages.at(-1).status, "stopped");
  assert.equal(loaded.messages.at(-1).toolRounds[0].calls[0].status, "stopped");
  controller.answer(
    root.id,
    "question",
    { answers: [{ id: "choice", selected: ["Two"], text: "" }] },
    child.id,
  );
  await job.done;
  const call = child.messages.at(-1).toolRounds[0].calls[0];
  assert.deepEqual(JSON.parse(call.result).answers[0].selected, ["Two"]);
});
test("stopping one child keeps its sibling and parent alive", async (t) => {
  let finishOther;
  const { store, controller } = fixture(
    t,
    async ({ messages, onDelta, signal }) => {
      if (isRoot(messages)) {
        if (!messages.some((m) => m.role === "tool"))
          return tool("delegate_tasks", tasks("cancel", "keep"));
        const result = JSON.parse(
          messages.find((m) => m.role === "tool").content,
        );
        assert.deepEqual(
          result.agents.map((a) => a.status),
          ["stopped", "complete"],
        );
        onDelta("summary");
        return;
      }
      if (messages.at(-1).content === "keep")
        await new Promise((resolve) => {
          finishOther = resolve;
        });
      else
        await new Promise((resolve, reject) =>
          signal.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          }),
        );
      onDelta("done");
    },
  );
  const root = store.createSession(),
    job = controller.send(root.id, "root");
  for (let i = 0; i < 12; i++) await tick();
  assert.equal(root.messages.at(-1).agents?.length, 2);
  controller.stopAgent(root.id, root.messages.at(-1).agents[0].id);
  finishOther();
  await job.done;
  assert.equal(root.messages.at(-1).status, "complete");
});
test("stopping a root cancels all descendants and pending questions", async (t) => {
  const { store, controller } = fixture(t, async ({ messages, signal }) => {
    if (isRoot(messages)) return tool("delegate_tasks", tasks("a", "b", "c"));
    await new Promise((resolve, reject) =>
      signal.addEventListener("abort", () => reject(signal.reason), {
        once: true,
      }),
    );
  });
  const root = store.createSession(),
    job = controller.send(root.id, "root");
  for (let i = 0; i < 12; i++) await tick();
  assert.equal(root.messages.at(-1).agents?.length, 3);
  controller.stop(root.id);
  await job.done;
  assert.equal(root.messages.at(-1).status, "stopped");
  assert.ok(
    root.messages
      .at(-1)
      .agents.every((a) => a.messages.at(-1).status === "stopped"),
  );
});
test("retry after parent failure keeps completed child side effects and transcripts", async (t) => {
  let childCalls = 0,
    fail = true;
  const { store, controller } = fixture(t, async ({ messages, onDelta }) => {
    if (isRoot(messages)) {
      if (!messages.some((m) => m.role === "tool"))
        return tool("delegate_tasks", tasks("child"));
      if (fail) {
        fail = false;
        throw new Error("temporary failure");
      }
      onDelta("summary");
      return;
    }
    childCalls++;
    onDelta("finished");
  });
  const root = store.createSession();
  await controller.send(root.id, "root").done;
  assert.equal(root.messages.at(-1).agents?.length, 1);
  assert.equal(root.messages.at(-1).status, "error");
  await controller.retry(root.id).done;
  assert.equal(root.messages.at(-1).status, "complete");
  assert.equal(childCalls, 1);
});
test("disabled delegation and unlisted child models cannot launch requests", async (t) => {
  let children = 0;
  const { store, controller } = fixture(
    t,
    async ({ messages, onDelta, tools }) => {
      if (!isRoot(messages)) {
        children++;
        onDelta("child");
        return;
      }
      if (!messages.some((m) => m.role === "tool"))
        return tool("delegate_tasks", {
          tasks: [{ title: "bad", task: "task", model: "not-saved" }],
        });
      onDelta("error explained");
    },
  );
  const root = store.createSession();
  await controller.send(root.id, "root").done;
  assert.equal(children, 0);
  assert.equal(root.messages.at(-1).toolRounds[0].calls[0].status, "error");
  store.state.settings.subagents = false;
  const disabled = store.createSession();
  await controller.send(disabled.id, "try again").done;
  assert.equal(children, 0);
  assert.match(
    disabled.messages.at(-1).toolRounds[0].calls[0].result,
    /недоступен/,
  );
});

test("queued agents can be stopped without consuming an API request, then other roots continue", async (t) => {
  const releases = [];
  let requests = 0,
    active = 0,
    max = 0;
  const { store, controller } = fixture(
    t,
    async ({ messages, signal, onDelta }) => {
      if (isRoot(messages)) {
        if (!messages.some((m) => m.role === "tool"))
          return tool("delegate_tasks", tasks("a", "b", "c"));
        onDelta("summary");
        return;
      }
      requests++;
      max = Math.max(max, ++active);
      await new Promise((resolve, reject) => {
        releases.push(resolve);
        signal.addEventListener("abort", () => reject(signal.reason), {
          once: true,
        });
      });
      active--;
      onDelta("done");
    },
  );
  const rootA = store.createSession(),
    rootB = store.createSession();
  const a = controller.send(rootA.id, "first");
  for (let i = 0; i < 10; i++) await tick();
  const b = controller.send(rootB.id, "second");
  for (let i = 0; i < 10; i++) await tick();
  const childrenB = rootB.messages.at(-1).agents;
  assert.ok(
    childrenB.every((agent) => agent.messages.at(-1).status === "queued"),
  );
  assert.equal(requests, 3);
  controller.stopAgent(rootB.id, childrenB[0].id);
  for (const release of releases.splice(0)) release();
  await a.done;
  for (let i = 0; i < 10; i++) await tick();
  assert.equal(requests, 5);
  assert.equal(max, 3);
  for (const release of releases.splice(0)) release();
  await b.done;
  assert.deepEqual(
    childrenB.map((agent) => agent.messages.at(-1).status),
    ["stopped", "complete", "complete"],
  );
});

test("concurrent nested delegation cannot exceed six descendants per root reply", async (t) => {
  const { agentsIn } = require("../electron/agents.cjs");
  const { store, controller } = fixture(t, async ({ messages, onDelta }) => {
    if (!messages.some((m) => m.role === "tool")) {
      if (isRoot(messages))
        return tool(
          "delegate_tasks",
          tasks("middle-a", "middle-b", "middle-c"),
        );
      if (messages.at(-1).content.startsWith("middle"))
        return tool("delegate_tasks", tasks("leaf-a", "leaf-b", "leaf-c"));
    }
    onDelta("done");
  });
  const root = store.createSession();
  await controller.send(root.id, "root").done;
  const agents = agentsIn(root.messages);
  assert.equal(agents.length, 6);
  const errors = agents
    .flatMap((agent) =>
      agent.messages.flatMap((message) =>
        (message.toolRounds || []).flatMap((round) => round.calls),
      ),
    )
    .filter((call) => call.status === "error");
  assert.equal(errors.length, 2);
  assert.ok(errors.every((call) => call.result.includes("6 субагентов")));
});

test("agents inherit project, attachments and snapshotted skills and may use a saved model", async (t) => {
  let childModel, childHistory, childProject;
  const { store, controller } = fixture(
    t,
    async ({ messages, model, onDelta }) => {
      if (isRoot(messages)) {
        if (!messages.some((message) => message.role === "tool"))
          return tool("delegate_tasks", {
            tasks: [
              {
                title: "child",
                task: "Read the supplied document",
                model: "claude-sonnet-5",
              },
            ],
          });
      } else {
        childModel = model;
        childHistory = JSON.stringify(messages);
      }
      onDelta("done");
    },
    {
      getTools: (session) => {
        if (session.rootSessionId) childProject = session.projectId;
        return [];
      },
    },
  );
  store.state.projects.push({
    id: "project",
    name: "test",
    path: "C:/test",
    skillIds: ["skill"],
  });
  store.state.skills.push({
    id: "skill",
    name: "check",
    description: "test",
    body: "Use precise language",
    unsupported: [],
    source: "",
    references: [],
    projectId: "project",
  });
  const root = store.createSession("project");
  await controller.send(root.id, "Delegate", [
    { path: "notes.txt", content: "DOCUMENT CONTEXT", size: 16 },
  ]).done;
  assert.equal(childModel, "claude-sonnet-5");
  assert.equal(childProject, "project");
  assert.ok(childHistory.includes("DOCUMENT CONTEXT"));
  assert.ok(childHistory.includes("Use precise language"));
  assert.notEqual(
    root.messages[0].attachments,
    root.messages.at(-1).agents[0].messages[0].attachments,
  );
});
