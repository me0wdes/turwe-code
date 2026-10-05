const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createStore } = require("../electron/store.cjs");
const { createController } = require("../electron/controller.cjs");
const { upsertSkill, assignSkill } = require("../electron/skills.cjs");

function fixture(t, options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "turwe-queue-"));
  const store = createStore(directory);
  const requests = [];
  const controller = createController({
    store,
    getConfig: () => ({ key: "fixture" }),
    emit() {},
    stream: (request) =>
      new Promise((resolve, reject) => {
        const entry = { ...request, resolve, reject };
        requests.push(entry);
        request.signal.addEventListener(
          "abort",
          () => reject(new Error("aborted")),
          { once: true },
        );
      }),
    ...options,
  });
  t.after(() => {
    controller.stopAll();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const session = store.createSession();
  return { directory, store, controller, session, requests };
}
async function until(predicate) {
  for (let n = 0; n < 100; n++) {
    if (predicate()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.fail("condition was not reached");
}
function finish(request, content) {
  request.onDelta(content);
  request.resolve();
}

test("queued requests remain distinct and execute FIFO only after the whole tool turn completes", async (t) => {
  const { controller, session, requests } = fixture(t, {
    getTools: () => [
      {
        type: "function",
        readOnly: true,
        function: { name: "read", parameters: { type: "object" } },
      },
    ],
    executeTool: async () => ({ text: "READ RESULT" }),
  });
  session.permissionMode = "auto";
  const job = controller.send(session.id, "first");
  controller.send(session.id, "second");
  controller.send(session.id, "third");
  assert.equal(requests.length, 1);
  requests[0].resolve({
    toolCalls: [{ id: "read1", function: { name: "read", arguments: "{}" } }],
  });
  await until(() => requests.length === 2);
  assert.equal(session.queuedInputs.length, 2);
  assert.equal(session.messages.length, 2);
  assert.doesNotMatch(JSON.stringify(requests[1].messages), /second|third/);
  finish(requests[1], "first done");
  await until(() => requests.length === 3);
  assert.equal(session.queuedInputs.length, 1);
  assert.equal(requests[2].messages.at(-1).content, "second");
  finish(requests[2], "second done");
  await until(() => requests.length === 4);
  assert.equal(requests[3].messages.at(-1).content, "third");
  finish(requests[3], "third done");
  await job.done;
  assert.deepEqual(
    session.messages.map((m) => m.role),
    ["user", "assistant", "user", "assistant", "user", "assistant"],
  );
  assert.equal(session.queuedInputs.length, 0);
});

test("queued attachments, model, effort and skills are snapshotted; edits/removal survive restart", async (t) => {
  const { directory, store, controller, session, requests } = fixture(t);
  const skill = upsertSkill(store, {
    source: "---\nname: review\n---\nORIGINAL",
  });
  store.state.projects.push({
    id: "project",
    name: "Project",
    path: directory,
  });
  session.projectId = "project";
  assignSkill(store, "project", skill.id, true);
  session.model = "first-model";
  session.effort = "low";
  const job = controller.send(session.id, "first");
  session.model = "queued-model";
  session.effort = "high";
  const attachment = {
    id: "file",
    name: "picture.png",
    path: "picture.png",
    content: "image fixture",
    size: 10,
  };
  session.draft = "newer draft";
  session.draftAttachments = [
    attachment,
    { id: "newer", path: "newer.txt", size: 0 },
  ];
  const pending = controller.send(session.id, "", [attachment]);
  const removed = controller.send(session.id, "remove me");
  controller.updateQueuedInput(session.id, pending.messageId, "edited task");
  controller.removeQueuedInput(session.id, removed.messageId);
  assert.equal(session.draft, "newer draft");
  assert.deepEqual(
    session.draftAttachments.map((a) => a.id),
    ["newer"],
  );
  attachment.content = "mutated";
  upsertSkill(store, {
    id: skill.id,
    source: "---\nname: review\n---\nCHANGED",
  });
  const restored = createStore(directory).state.sessions.find(
    (s) => s.id === session.id,
  );
  assert.equal(restored.queuedInputs.length, 1);
  assert.equal(
    restored.queuedInputs[0].attachments[0].content,
    "image fixture",
  );
  session.model = "third-model";
  session.effort = "medium";
  finish(requests[0], "first done");
  await until(() => requests.length === 2);
  assert.equal(requests[1].model, "queued-model");
  assert.equal(requests[1].effort, "high");
  assert.match(JSON.stringify(requests[1].messages), /ORIGINAL/);
  assert.doesNotMatch(
    JSON.stringify(requests[1].messages),
    /CHANGED|remove me|mutated/,
  );
  assert.throws(
    () =>
      controller.updateQueuedInput(session.id, pending.messageId, "too late"),
    /очеред/,
  );
  finish(requests[1], "second done");
  await job.done;
});

test("stop and provider errors retain pending jobs; explicit resume and send preserve FIFO", async (t) => {
  const { controller, session, requests } = fixture(t);
  let job = controller.send(session.id, "first");
  controller.send(session.id, "second");
  controller.stop(session.id);
  await job.done;
  assert.equal(requests.length, 1);
  assert.equal(session.queuedInputs.length, 1);
  job = controller.resumeQueue(session.id);
  assert.equal(requests[1].messages.at(-1).content, "second");
  controller.send(session.id, "third");
  requests[1].reject(new Error("provider unavailable"));
  await job.done;
  assert.equal(requests.length, 2);
  assert.equal(session.queuedInputs[0].content, "third");
  job = controller.send(session.id, "fourth");
  assert.equal(requests[2].messages.at(-1).content, "third");
  finish(requests[2], "third done");
  await until(() => requests.length === 4);
  assert.equal(requests[3].messages.at(-1).content, "fourth");
  finish(requests[3], "fourth done");
  await job.done;
});

test("pending approval never drains the queue and stopping it does not execute the tool", async (t) => {
  let calls = 0;
  const { controller, session, requests } = fixture(t, {
    getTools: () => [
      {
        type: "function",
        function: { name: "write", parameters: { type: "object" } },
      },
    ],
    executeTool: async () => {
      calls++;
      return { text: "written" };
    },
  });
  session.permissionMode = "ask";
  const job = controller.send(session.id, "first");
  controller.send(session.id, "second");
  requests[0].resolve({
    toolCalls: [{ id: "write1", function: { name: "write", arguments: "{}" } }],
  });
  await until(() => session.messages.at(-1).status === "approval");
  assert.equal(requests.length, 1);
  assert.equal(session.queuedInputs.length, 1);
  assert.equal(calls, 0);
  controller.stop(session.id);
  await job.done;
  assert.equal(session.queuedInputs.length, 1);
  assert.equal(calls, 0);
});

test("retry completes the failed request before draining pending tasks exactly once", async (t) => {
  const { controller, session, requests } = fixture(t);
  session.model = "original";
  session.effort = "low";
  let job = controller.send(session.id, "first");
  session.model = "next";
  session.effort = "high";
  controller.send(session.id, "second");
  requests[0].reject(new Error("temporary error"));
  await job.done;
  job = controller.retry(session.id);
  assert.equal(requests[1].model, "original");
  assert.equal(requests[1].effort, "low");
  assert.equal(requests[1].messages.at(-1).content, "first");
  assert.equal(session.queuedInputs.length, 1);
  finish(requests[1], "first done");
  await until(() => requests.length === 3);
  assert.equal(requests[2].model, "next");
  assert.equal(requests[2].effort, "high");
  finish(requests[2], "second done");
  await job.done;
  assert.deepEqual(
    session.messages.filter((m) => m.role === "user").map((m) => m.content),
    ["first", "second"],
  );
  assert.equal(session.queuedInputs.length, 0);
});

test("restored pending tasks require explicit resume and cannot bypass current approval mode", async (t) => {
  const { directory, controller, session } = fixture(t);
  session.permissionMode = "bypass";
  const originalJob = controller.send(session.id, "first");
  controller.send(session.id, "second");
  controller.stop(session.id);
  await originalJob.done;
  const store = createStore(directory);
  const restored = store.state.sessions.find((s) => s.id === session.id);
  restored.permissionMode = "ask";
  let requests = 0,
    executions = 0;
  const reopened = createController({
    store,
    emit() {},
    getConfig: () => ({ key: "fixture" }),
    getTools: () => [
      {
        type: "function",
        function: { name: "write", parameters: { type: "object" } },
      },
    ],
    stream: async () => {
      requests++;
      return {
        toolCalls: [{ id: "w", function: { name: "write", arguments: "{}" } }],
      };
    },
    executeTool: async () => {
      executions++;
      return "written";
    },
  });
  assert.equal(requests, 0);
  const resumed = reopened.resumeQueue(session.id);
  await until(() => restored.messages.at(-1).status === "approval");
  assert.equal(requests, 1);
  assert.equal(executions, 0);
  assert.throws(() => reopened.resumeQueue(session.id), /уже формируется/);
  reopened.stop(session.id);
  await resumed.done;
  assert.equal(executions, 0);
});

test("queue limit and failed edits leave pending data unchanged", async (t) => {
  const { controller, session, store } = fixture(t);
  const job = controller.send(session.id, "first");
  for (let n = 0; n < 10; n++) controller.send(session.id, `pending ${n}`);
  const original = structuredClone(session.queuedInputs);
  assert.throws(() => controller.send(session.id, "overflow"), /10 сообщений/);
  assert.throws(
    () => controller.updateQueuedInput(session.id, original[0].id, " "),
    /Введите/,
  );
  const skill = upsertSkill(store, {
    source: "---\nname: bad\n---\nRead [binary](data.bin)",
  });
  assert.ok(skill.unsupported.length);
  assert.throws(
    () => controller.updateQueuedInput(session.id, original[0].id, "@bad"),
    /не поддерживается/,
  );
  assert.deepEqual(session.queuedInputs, original);
  controller.stop(session.id);
  await job.done;
});

test("steering cancels only inference and sends the selected snapshot before the remaining FIFO", async (t) => {
  const { controller, store, session, requests } = fixture(t);
  upsertSkill(store, { source: "---\nname: correction\n---\nSNAPSHOT INSTRUCTIONS" });
  const job = controller.send(session.id, "original task");
  requests[0].onDelta("Partial progress");
  controller.send(session.id, "earlier queued task");
  session.model = "correction-model";
  session.effort = "high";
  const attachment = { path: "reference.txt", size: 3, content: "SNAPSHOT FILE" };
  const correction = controller.send(session.id, "@correction adjust the task", [attachment]);
  controller.send(session.id, "later queued task");
  session.draft = "unsent draft";
  attachment.content = "MUTATED";
  controller.steerQueuedInput(session.id, correction.messageId);
  assert.equal(requests[0].signal.aborted, true);
  assert.equal(controller.isRunning(session.id), true);
  await until(() => requests.length === 2);
  const correctedHistory = requests[1].messages;
  assert.equal(requests[1].model, "correction-model");
  assert.equal(requests[1].effort, "high");
  assert.match(correctedHistory.at(-1).content, /adjust the task/);
  assert.match(correctedHistory.at(-1).content, /SNAPSHOT INSTRUCTIONS/);
  assert.match(correctedHistory.at(-1).content, /SNAPSHOT FILE/);
  assert.doesNotMatch(JSON.stringify(correctedHistory), /queued task|MUTATED/);
  assert.deepEqual(correctedHistory.slice(0, 2).map((m) => m.content), ["original task", "Partial progress"]);
  assert.equal(session.draft, "unsent draft");
  assert.deepEqual(session.queuedInputs.map((m) => m.content), ["earlier queued task", "later queued task"]);
  assert.throws(() => controller.steerQueuedInput(session.id, correction.messageId), /очеред/);
  finish(requests[1], "Adjusted result");
  await until(() => requests.length === 3);
  assert.equal(requests[2].messages.at(-1).content, "earlier queued task");
  finish(requests[2], "Earlier done");
  await until(() => requests.length === 4);
  assert.equal(requests[3].messages.at(-1).content, "later queued task");
  finish(requests[3], "Later done");
  await job.done;
  assert.equal(session.messages.filter((m) => m.id === correction.messageId).length, 1);
});

test("steering waits through approval and a running side effect, preserving the saved result exactly once", async (t) => {
  let executions = 0, completeTool, toolSignal;
  const { controller, session, requests } = fixture(t, {
    getTools: () => [{ type: "function", function: { name: "write", parameters: { type: "object" } } }],
    executeTool: async (_name, _args, { signal }) => {
      executions++;
      toolSignal = signal;
      return new Promise((resolve) => { completeTool = resolve; });
    },
  });
  session.permissionMode = "ask";
  const job = controller.send(session.id, "original");
  requests[0].resolve({ toolCalls: [{ id: "write-safe", function: { name: "write", arguments: "{}" } }] });
  await until(() => session.messages.at(-1).status === "approval");
  const correction = controller.send(session.id, "supplement");
  controller.steerQueuedInput(session.id, correction.messageId);
  controller.steerQueuedInput(session.id, correction.messageId);
  assert.equal(session.queuedInputs[0].steering, true);
  assert.equal(executions, 0);
  assert.equal(requests.length, 1);
  assert.throws(() => controller.updateQueuedInput(session.id, correction.messageId, "changed"), /отправляется/);
  assert.throws(() => controller.removeQueuedInput(session.id, correction.messageId), /отправляется/);
  controller.approve(session.id, "write-safe", true);
  await until(() => executions === 1);
  assert.equal(toolSignal.aborted, false);
  assert.equal(requests.length, 1);
  completeTool({ text: "SIDE EFFECT SAVED" });
  await until(() => requests.length === 2);
  assert.equal(executions, 1);
  assert.equal(requests[1].messages.at(-1).content, "supplement");
  assert.equal(requests[1].messages.filter((m) => m.role === "tool" && m.content === "SIDE EFFECT SAVED").length, 1);
  assert.equal(requests[1].messages.filter((m) => m.content === "Готово.").length, 0);
  requests[1].reject(new Error("provider temporary failure"));
  await job.done;
  const retried = controller.retry(session.id);
  assert.equal(requests[2].messages.filter((m) => m.content === "supplement").length, 1);
  assert.equal(requests[2].messages.filter((m) => m.role === "tool").length, 1);
  finish(requests[2], "Fixed");
  await retried.done;
  assert.equal(executions, 1);
});

test("stopped pending correction persists across restart and resumes before ordinary queued requests", async (t) => {
  const { directory, controller, session, requests } = fixture(t, {
    getTools: () => [{ type: "function", function: { name: "write", parameters: { type: "object" } } }],
    executeTool: async () => assert.fail("unapproved tool must not execute"),
  });
  session.permissionMode = "ask";
  const job = controller.send(session.id, "original");
  controller.send(session.id, "ordinary queued");
  const correction = controller.send(session.id, "correction");
  requests[0].resolve({ toolCalls: [{ id: "write-wait", function: { name: "write", arguments: "{}" } }] });
  await until(() => session.messages.at(-1).status === "approval");
  controller.steerQueuedInput(session.id, correction.messageId);
  controller.stop(session.id);
  await job.done;
  assert.equal(requests.length, 1);
  const restoredStore = createStore(directory);
  const restored = restoredStore.state.sessions.find((s) => s.id === session.id);
  assert.deepEqual(restored.queuedInputs.map((m) => m.content), ["ordinary queued", "correction"]);
  assert.equal(restored.queuedInputs[1].steering, true);
  const received = [];
  const reopened = createController({
    store: restoredStore, getConfig: () => ({ key: "fixture" }), emit() {},
    stream: async ({ messages, onDelta }) => { received.push(messages); onDelta("done"); },
  });
  assert.equal(received.length, 0);
  reopened.updateQueuedInput(restored.id, correction.messageId, "edited correction");
  await reopened.resumeQueue(restored.id).done;
  assert.equal(received[0].at(-1).content, "edited correction");
  assert.equal(received[1].at(-1).content, "ordinary queued");
  assert.equal(restored.queuedInputs.length, 0);
});

test("steering an idle queue starts the selected input immediately and preserves other order", async (t) => {
  const { controller, session, requests } = fixture(t);
  const job = controller.send(session.id, "original");
  controller.send(session.id, "one");
  const selected = controller.send(session.id, "two");
  controller.send(session.id, "three");
  controller.stop(session.id);
  await job.done;
  controller.steerQueuedInput(session.id, selected.messageId);
  assert.equal(requests[1].messages.at(-1).content, "two");
  assert.deepEqual(session.queuedInputs.map((m) => m.content), ["one", "three"]);
  finish(requests[1], "two done");
  await until(() => requests.length === 3);
  assert.equal(requests[2].messages.at(-1).content, "one");
  finish(requests[2], "one done");
  await until(() => requests.length === 4);
  assert.equal(requests[3].messages.at(-1).content, "three");
  finish(requests[3], "three done");
  await until(() => !controller.isRunning(session.id));
});

test("late tool calls from a cancelled provider inference never execute", async (t) => {
  const requests = [];
  let executions = 0;
  const { controller, session } = fixture(t, {
    stream: (request) => new Promise((resolve) => requests.push({ ...request, resolve })),
    getTools: () => [{ type: "function", readOnly: true, function: { name: "read" } }],
    executeTool: async () => { executions++; return "result"; },
  });
  const job = controller.send(session.id, "original");
  const correction = controller.send(session.id, "corrected");
  controller.steerQueuedInput(session.id, correction.messageId);
  requests[0].onDelta("late delta");
  requests[0].resolve({ toolCalls: [{ id: "stale", function: { name: "read", arguments: "{}" } }] });
  await until(() => requests.length === 2);
  assert.equal(executions, 0);
  assert.doesNotMatch(JSON.stringify(session.messages), /late delta|stale/);
  assert.equal(requests[1].messages.at(-1).content, "corrected");
  finish(requests[1], "done");
  await job.done;
});

test("steering finishes the in-flight action but prevents remaining actions in the old batch", async (t) => {
  const executed = [];
  let finishCurrent;
  const { controller, session, requests } = fixture(t, {
    getTools: () => ["read", "delete"].map((name) => ({ type: "function", function: { name } })),
    executeTool: async (name) => {
      executed.push(name);
      return new Promise((resolve) => { finishCurrent = resolve; });
    },
  });
  session.permissionMode = "bypass";
  const job = controller.send(session.id, "original");
  requests[0].resolve({ toolCalls: [
    { id: "current-read", function: { name: "read", arguments: "{}" } },
    { id: "future-delete", function: { name: "delete", arguments: "{}" } },
  ] });
  await until(() => executed.length === 1);
  const correction = controller.send(session.id, "do not delete");
  controller.steerQueuedInput(session.id, correction.messageId);
  finishCurrent({ text: "read complete" });
  await until(() => requests.length === 2);
  assert.deepEqual(executed, ["read"]);
  const results = requests[1].messages.filter((m) => m.role === "tool");
  assert.equal(results.length, 2);
  assert.equal(results[0].tool_call_id, "current-read");
  assert.equal(results[0].content, "read complete");
  assert.equal(results[1].tool_call_id, "future-delete");
  assert.match(results[1].content, /Не выполнялось/);
  assert.equal(requests[1].messages.at(-1).content, "do not delete");
  finish(requests[1], "done");
  await job.done;
});

test("multiple pending corrections reach provider in click order, without reordering ordinary queue", async (t) => {
  let completeTool;
  const { controller, directory, session, requests } = fixture(t, {
    getTools: () => [{ type: "function", readOnly: true, function: { name: "read" } }],
    executeTool: async () => new Promise((resolve) => { completeTool = resolve; }),
  });
  const job = controller.send(session.id, "original");
  requests[0].resolve({ toolCalls: [{ id: "read-order", function: { name: "read", arguments: "{}" } }] });
  await until(() => completeTool);
  const first = controller.send(session.id, "first correction");
  controller.send(session.id, "ordinary second");
  const third = controller.send(session.id, "third correction");
  controller.steerQueuedInput(session.id, third.messageId);
  controller.steerQueuedInput(session.id, first.messageId);
  const saved = createStore(directory).state.sessions.find((s) => s.id === session.id);
  assert.ok(saved.queuedInputs[2].steeringOrder < saved.queuedInputs[0].steeringOrder);
  completeTool({ text: "read done" });
  await until(() => requests.length === 2);
  assert.deepEqual(requests[1].messages.filter((m) => m.role === "user").map((m) => m.content), [
    "original", "third correction", "first correction",
  ]);
  assert.deepEqual(session.queuedInputs.map((m) => m.content), ["ordinary second"]);
  assert.equal(session.messages.some((m) => m.steeringOrder), false);
  finish(requests[1], "corrected");
  await until(() => requests.length === 3);
  assert.equal(requests[2].messages.at(-1).content, "ordinary second");
  finish(requests[2], "done");
  await job.done;
});
