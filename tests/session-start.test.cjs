const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createStore } = require("../electron/store.cjs");

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "turwe-start-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = createStore(dir);
  store.state.projects.push({ id: "a", path: dir }, { id: "b", path: dir });
  return { store, dir };
}

test("starting a chat requires a saved project and leaves no empty chats on rejection", (t) => {
  const { store } = fixture(t);
  for (const id of [undefined, null, "", "missing"]) {
    assert.throws(() => store.startSession(id), /Выберите|Проект не найден/);
    assert.equal(store.state.sessions.length, 0);
  }
});

test("repeated New Session reuses one empty chat per project, including after restart", (t) => {
  const { store, dir } = fixture(t);
  const first = store.startSession("a");
  for (let i = 0; i < 50; i++)
    assert.equal(store.startSession("a").id, first.id);
  assert.notEqual(store.startSession("b").id, first.id);
  const loaded = createStore(dir);
  assert.equal(loaded.startSession("a").id, first.id);
  assert.equal(loaded.state.sessions.length, 2);
});

test("new chats preserve draft text, attachments, history, queues and explicitly named work", (t) => {
  const { store } = fixture(t);
  const patches = [
    { draft: "Не потерять этот текст" },
    { draftAttachments: [{ id: "attachment" }] },
    { messages: [{ id: "message", role: "user", content: "Привет" }] },
    { queuedInputs: [{ id: "queued", content: "Потом" }] },
    { title: "Запланированная задача" },
    { archived: true },
    { parentSessionId: "fork-parent" },
    { rootSessionId: "agent-parent" },
    { worktreePath: "isolated-checkout" },
    { plan: { text: "План", status: "draft" } },
    { tasks: [{ id: "task", title: "Сделать" }] },
  ];
  for (const patch of patches) {
    const previous = store.startSession("a");
    Object.assign(previous, patch);
    const snapshot = structuredClone(previous);
    const next = store.startSession("a");
    assert.notEqual(next.id, previous.id, JSON.stringify(patch));
    assert.deepEqual(previous, snapshot);
  }
});

test("internal session creation stays independent for forks and subagents", (t) => {
  const { store } = fixture(t);
  assert.notEqual(store.createSession("a").id, store.createSession("a").id);
  const legacy = store.createSession();
  assert.ok(store.state.sessions.includes(legacy));
  assert.notEqual(store.startSession("a").id, legacy.id);
});
