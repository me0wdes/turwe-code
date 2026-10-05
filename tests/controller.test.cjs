const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createStore } = require("../electron/store.cjs");
const { createController } = require("../electron/controller.cjs");
const { upsertSkill, assignSkill } = require("../electron/skills.cjs");

test("deleting a chat is blocked until its current job finishes", async (t) => {
  let finish;
  const { store, controller } = setup(t, () => new Promise((resolve) => { finish = resolve; }));
  const session = store.createSession();
  assert.throws(() => controller.deleteSession(session.id), /архив/);
  const job = controller.send(session.id, "question");
  // Simulate a stale archive flag: the controller must still protect a live job.
  store.updateSession(session.id, { archived: true });
  assert.throws(() => controller.deleteSession(session.id), /Остановите/);
  assert.equal(store.state.sessions.length, 1);
  finish();
  await job.done;
  controller.deleteSession(session.id);
  assert.equal(store.state.sessions.length, 0);
  assert.throws(() => controller.deleteSession(session.id), /не найдена/);
});
test("skill instructions reach the request, remain snapshotted for retry and stay inside their project", async (t) => {
  let count = 0;
  const requests = [];
  const { store, controller } = setup(t, async ({ messages, onDelta }) => {
    requests.push(messages);
    if (!count++) throw new Error("retry me");
    onDelta("done");
  });
  store.state.projects.push({ id: "p", name: "P", path: "unused" });
  const skill = upsertSkill(store, {
    source: "---\nname: review\ndescription: Review\n---\nORIGINAL INSTRUCTION",
  });
  assignSkill(store, "p", skill.id, true);
  const a = store.createSession("p"),
    b = store.createSession();
  await controller.send(a.id, "inspect").done;
  upsertSkill(store, {
    id: skill.id,
    source: "---\nname: review\n---\nCHANGED INSTRUCTION",
  });
  await controller.retry(a.id).done;
  await controller.send(b.id, "ordinary question").done;
  assert.match(requests[0][0].content, /ORIGINAL INSTRUCTION/);
  assert.deepEqual(requests[1], requests[0]);
  assert.doesNotMatch(JSON.stringify(requests[2]), /INSTRUCTION/);
  assert.equal(a.messages[0].skills[0].name, "review");
});
test("first streamed content is persisted even if the next chunk never arrives", async (t) => {
  let finish;
  const { dir, store, controller } = setup(t, ({ onDelta }) => {
    onDelta("saved immediately");
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  const s = store.createSession(),
    job = controller.send(s.id, "question");
  // Observe the real persistence through an independently opened store.
  const saved = JSON.parse(
    fs.readFileSync(path.join(dir, "workspace.json"), "utf8"),
  );
  finish();
  await job.done;
  assert.equal(saved.sessions[0].messages.at(-1).content, "saved immediately");
});
test("accepting an earlier submission does not clear a newer draft", async (t) => {
  const { store, controller } = setup(t, async ({ onDelta }) =>
    onDelta("done"),
  );
  const s = store.createSession();
  store.updateSession(s.id, { draft: "new text typed during preparation" });
  await controller.send(s.id, "previously submitted text").done;
  assert.equal(s.draft, "new text typed during preparation");
});
test("assistant records the exact model that produced that answer", async (t) => {
  const { store, controller } = setup(t, async ({ onDelta }) =>
    onDelta("done"),
  );
  const s = store.createSession();
  store.updateSession(s.id, { model: "first-model-id" });
  await controller.send(s.id, "question").done;
  store.updateSession(s.id, { model: "second-model-id" });
  assert.equal(s.messages[1].model, "first-model-id");
});
test("empty provider library asks for a model before recording or sending a message", (t) => {
  const { store, controller } = setup(t, async () => {
    throw new Error("Should not send");
  });
  store.models.switchProvider("https://new-provider.test/v1");
  const session = store.createSession();
  assert.throws(() => controller.send(session.id, "hello"), /модель/);
  assert.equal(session.messages.length, 0);
});
function setup(t, stream) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "turwe-controller-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = createStore(dir);
  return {
    dir,
    store,
    controller: createController({
      store,
      getConfig: () => ({ key: "test", baseUrl: "https://example.test/v1" }),
      emit: () => {},
      stream,
    }),
  };
}
test("concurrent sessions keep responses isolated", async (t) => {
  const { store, controller } = setup(t, async ({ messages, onDelta }) => {
    await new Promise((r) => setImmediate(r));
    onDelta(messages.at(-1).content + " answer");
  });
  const a = store.createSession(),
    b = store.createSession();
  const x = controller.send(a.id, "one"),
    y = controller.send(b.id, "two");
  await Promise.all([x.done, y.done]);
  assert.equal(a.messages[1].content, "one answer");
  assert.equal(b.messages[1].content, "two answer");
  assert.equal(a.messages[1].status, "complete");
});
test("retry replaces failed assistant and retains original context once", async (t) => {
  let count = 0;
  const { store, controller } = setup(t, async ({ onDelta, messages }) => {
    if (!count++) throw new Error("upstream error");
    assert.match(messages[0].content, /selected.txt/);
    onDelta("done");
  });
  const s = store.createSession();
  await controller.send(s.id, "question", [
    { path: "selected.txt", content: "source", size: 6 },
  ]).done;
  assert.equal(s.messages[1].status, "error");
  await controller.retry(s.id).done;
  assert.equal(s.messages.length, 2);
  assert.equal(s.messages[1].content, "done");
});
test("stop keeps partial output and queued follow-up without a duplicate model request", async (t) => {
  const { store, controller } = setup(
    t,
    ({ onDelta, signal }) =>
      new Promise((resolve, reject) => {
        onDelta("partial");
        signal.addEventListener(
          "abort",
          () => reject(new DOMException("Aborted", "AbortError")),
          { once: true },
        );
      }),
  );
  const s = store.createSession(),
    job = controller.send(s.id, "test");
  controller.send(s.id, "again");
  assert.equal(s.queuedInputs[0].content, 'again');
  controller.stop(s.id);
  await job.done;
  assert.equal(s.messages[1].content, "partial");
  assert.equal(s.messages[1].status, "stopped");
});
