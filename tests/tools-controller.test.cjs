const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createStore } = require("../electron/store.cjs");
const { createController } = require("../electron/controller.cjs");
const def = {
  type: "function",
  readOnly: true,
  function: { name: "read_item", parameters: { type: "object" } },
};
const toolResponse = {
  toolCalls: [
    {
      id: "c1",
      type: "function",
      function: { name: "read_item", arguments: '{"id":1}' },
    },
  ],
};

test("a promise-only image response continues into a real tool call and a final answer", async (t) => {
  let requests = 0, executions = 0;
  const { store, controller, dir } = setup(t, {
    prepareAttachments: async () => [{type:"image_url",image_url:{url:"data:image/png;base64,fixture"}}],
    stream: async ({messages, onDelta}) => {
      requests++;
      if (requests === 1) { onDelta("Похожу на этот логотип — узнаю, что это за бренд."); return {toolCalls:[],finishReason:"stop"}; }
      assert.equal(messages.find(m => m.role === "user").content[1].type, "image_url");
      assert.ok(messages.some(m => m.role === "assistant" && m.content?.includes("узнаю")));
      assert.ok(messages.every(m => !m.tool_calls || m.tool_calls.length));
      if (requests === 2) return toolResponse;
      assert.ok(messages.some(m => m.role === "tool" && m.content === "Confirmed source"));
      onDelta("Найден источник: https://example.test/brand");
      return {toolCalls:[],finishReason:"stop"};
    },
    executeTool: async () => { executions++; return {text:"Confirmed source"}; },
  });
  const session = store.createSession();
  await controller.send(session.id,"Что за бренд?",[{id:"image"}]).done;
  assert.equal(executions, 1);
  assert.equal(requests, 3);
  const reply = createStore(dir).state.sessions[0].messages.at(-1);
  assert.equal(reply.status,"complete");
  assert.match(reply.finalContent,/example.test/);
  assert.equal(reply.toolRounds.flatMap(r=>r.calls).length,1);
  const { assistantSteps } = require("../src/activity.ts");
  assert.deepEqual(assistantSteps(reply).map(s=>s.type),["text","tools","text"]);
});

test("repeated search promises stop with an honest error instead of fake completion", async (t) => {
  let requests = 0;
  const {store,controller} = setup(t, {
    stream: async ({onDelta}) => {requests++; onDelta("Ищу информацию по логотипу — проверю, что за бренд."); return {toolCalls:[],finishReason:"stop"};},
    executeTool: () => assert.fail("No tool was actually requested"),
  });
  const session = store.createSession();
  await controller.send(session.id,"Так что за бренд?").done;
  assert.equal(requests,2);
  assert.equal(session.messages.at(-1).status,"error");
  assert.match(session.messages.at(-1).error,/обещани|действи/);
  assert.equal(session.messages.at(-1).toolRounds.flatMap(r=>r.calls).length,0);
});

test("ordinary answers, user questions and explicit limitations are not automatically retried", async (t) => {
  for (const text of [
    "Привет! Чем помочь?",
    "Не могу выполнить поиск по изображению. Уточни название бренда.",
    "Проверю это после твоего подтверждения.",
    "Ищу — это форма настоящего времени глагола искать.",
    "Нашёл: https://example.test/brand",
    "Ищу этот логотип. Какой сайт проверить?",
  ]) {
    let requests = 0;
    const {store,controller} = setup(t,{stream:async ({onDelta})=>{requests++;onDelta(text);return {toolCalls:[],finishReason:"stop"};}});
    const session=store.createSession(); await controller.send(session.id,"Вопрос").done;
    assert.equal(requests,1,text); assert.equal(session.messages.at(-1).status,"complete",text);
  }
});
test("a replayed provider call after failure does not repeat the action", async (t) => {
  let requests = 0,
    executions = 0;
  const { store, controller } = setup(t, {
    stream: async () => {
      if (++requests === 2) throw new Error("network");
      return toolResponse;
    },
    executeTool: async () => {
      executions++;
      return { text: "created id=123" };
    },
  });
  const s = store.createSession();
  await controller.send(s.id, "create").done;
  await controller.retry(s.id).done;
  assert.equal(executions, 1);
  assert.match(s.messages.at(-1).error, /повторил идентификатор/);
  assert.equal(s.messages.at(-1).toolRounds.length, 1);
});
test("stop immediately after approval still prevents execution", async (t) => {
  let ready;
  const waiting = new Promise((r) => (ready = r));
  const { store, controller } = setup(t, {
    getTools: () => [{ ...def, requiresApproval: true }],
    emit: () => {
      if (store.state.sessions[0]?.messages.at(-1)?.status === "approval")
        ready();
    },
    stream: async () => toolResponse,
    executeTool: () => assert.fail("cancelled action"),
  });
  const s = store.createSession();
  s.permissionMode = "ask";
  const job = controller.send(s.id, "create");
  await waiting;
  controller.approve(s.id, "c1", true);
  controller.stop(s.id);
  await job.done;
  assert.equal(s.messages.at(-1).status, "stopped");
});
function setup(t, options) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "turwe-tools-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = createStore(dir);
  const controller = createController({
    store,
    getConfig: () => ({ key: "test" }),
    emit: () => {},
    getTools: () => [def],
    reviewAction: async () => ({ decision: "allow", reason: "Fixture action" }),
    ...options,
  });
  return { store, controller, dir };
}

test("live activity retains commentary order and MCP identity through restart", async (t) => {
  const snapshots = [];
  let requests = 0;
  const { store, controller, dir } = setup(t, {
    getTools: () => [{ ...def, mcp: { connectorName: "Figma", toolName: "get_design_context", readOnly: true } }],
    emit: () => {
      const reply = store.state.sessions[0]?.messages.at(-1);
      if (reply?.role === "assistant") snapshots.push(structuredClone(reply));
    },
    stream: async ({ onDelta }) => {
      if (!requests++) {
        onDelta("Проверю макет.");
        return toolResponse;
      }
      onDelta("Нашёл ");
      onDelta("компонент.");
    },
    executeTool: async () => ({ text: "node 27:30" }),
  });
  const session = store.createSession();
  await controller.send(session.id, "inspect").done;
  for (const status of ["queued", "running", "complete"]) {
    const call = snapshots.flatMap((reply) => (reply.toolRounds || []).flatMap((round) => round.calls)).find((call) => call.status === status);
    assert.ok(call, status);
    assert.equal(call.connectorName, "Figma");
    assert.equal(call.toolName, "get_design_context");
  }
  const { assistantSteps } = require("../src/activity.ts");
  const saved = createStore(dir).state.sessions[0].messages.at(-1);
  assert.equal(saved.content, "Проверю макет.\n\nНашёл компонент.");
  assert.deepEqual(assistantSteps(saved).map((step) => step.type === "text" ? step.content : step.calls[0].status), ["Проверю макет.", "complete", "Нашёл компонент."]);
  const streaming = snapshots.find((reply) => reply.content.endsWith("Нашёл "));
  assert.equal(assistantSteps(streaming).at(-1).content, "Нашёл ");
});
test("tool loop persists valid protocol and sends actual multimodal attachments", async (t) => {
  let calls = 0,
    executions = 0;
  const { store, controller } = setup(t, {
    prepareAttachments: async () => [
      { type: "image_url", image_url: { url: "data:image/png;base64,test" } },
    ],
    stream: async ({ messages, onDelta }) => {
      calls++;
      if (calls === 1) {
        assert.equal(messages[0].content[1].type, "image_url");
        return toolResponse;
      }
      assert.equal(messages.at(-1).role, "tool");
      assert.equal(messages.at(-1).tool_call_id, "c1");
      assert.equal(messages.at(-1).content, "value");
      onDelta("final");
    },
    executeTool: async (name, args) => {
      assert.equal(name, "read_item");
      assert.equal(args.id, 1);
      executions++;
      return { text: "value" };
    },
  });
  const session = store.createSession();
  await controller.send(session.id, "see", [{ id: "a" }]).done;
  assert.equal(executions, 1);
  assert.equal(session.messages[1].status, "complete");
  assert.equal(session.messages[1].toolRounds[0].calls[0].result, "value");
});
test("permission denial never executes tool and stop cancels a pending permission", async (t) => {
  let ready,
    rounds = 0;
  const waiting = new Promise((r) => (ready = r));
  const { store, controller } = setup(t, {
    getTools: () => [{ ...def, requiresApproval: true }],
    emit: () => {
      if (store.state.sessions[0]?.messages.at(-1)?.status === "approval")
        ready();
    },
    stream: async ({ onDelta }) => {
      if (!rounds++)
        return {
          toolCalls: [
            {
              ...toolResponse.toolCalls[0],
              id: store.state.sessions[0]?.messages.length > 2 ? "c2" : "c1",
            },
          ],
        };
      onDelta("cancelled");
    },
    executeTool: () => assert.fail("must not execute"),
  });
  const s = store.createSession();
  s.permissionMode = "ask";
  const job = controller.send(s.id, "do");
  await waiting;
  controller.approve(s.id, "c1", false);
  await job.done;
  assert.equal(s.messages[1].toolRounds[0].calls[0].status, "denied");
  rounds = 0;
  const second = controller.send(s.id, "another");
  await new Promise((r) => setImmediate(r));
  controller.stop(s.id);
  await second.done;
  assert.equal(s.messages.at(-1).status, "stopped");
});
test("retry retains completed side effects without executing them again; regeneration branches original", async (t) => {
  let requests = 0,
    executions = 0;
  const { store, controller } = setup(t, {
    stream: async ({ onDelta, messages }) => {
      requests++;
      if (requests === 1) return toolResponse;
      if (requests === 2) throw new Error("network");
      assert.ok(messages.some((m) => m.role === "tool"));
      onDelta("done");
    },
    executeTool: async () => {
      executions++;
      return { text: "created" };
    },
  });
  const s = store.createSession();
  await controller.send(s.id, "create").done;
  assert.equal(s.messages.at(-1).status, "error");
  await controller.retry(s.id).done;
  assert.equal(executions, 1);
  const original = JSON.stringify(s.messages),
    id = controller.branch(s.id, s.messages.at(-1).id);
  await new Promise((r) => setImmediate(r));
  assert.notEqual(id, s.id);
  assert.equal(JSON.stringify(s.messages), original);
  assert.equal(executions, 1);
});
test("unknown tool is rejected and repeated calls hit bounded round limit", async (t) => {
  let executions = 0,
    calls = 0;
  const { store, controller } = setup(t, {
    getTools: () => [],
    stream: async () => ({
      toolCalls: [{ ...toolResponse.toolCalls[0], id: `call-${++calls}` }],
    }),
    executeTool: async () => executions++,
  });
  const s = store.createSession();
  await controller.send(s.id, "loop").done;
  assert.equal(executions, 0);
  assert.equal(s.messages[1].toolRounds.length, 80);
  assert.equal(s.messages[1].status, "error");
});
