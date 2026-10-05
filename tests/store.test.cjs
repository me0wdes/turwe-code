const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createStore } = require("../electron/store.cjs");
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "turwe-store-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
test("sessions and drafts survive a new store instance", (t) => {
  const dir = fixture(t),
    store = createStore(dir),
    session = store.createSession();
  store.updateSession(session.id, {
    title: "Моя задача",
    draft: "черновик",
    model: "claude-sonnet-5",
  });
  const loaded = createStore(dir).state.sessions[0];
  assert.equal(loaded.title, "Моя задача");
  assert.equal(loaded.draft, "черновик");
  assert.equal(loaded.model, "claude-sonnet-5");
});
test("restart preserves partial text and marks streaming interrupted", (t) => {
  const dir = fixture(t),
    store = createStore(dir),
    s = store.createSession();
  s.messages.push({
    id: "a",
    role: "assistant",
    content: "Часть ответа",
    status: "streaming",
  });
  store.save();
  const m = createStore(dir).state.sessions[0].messages[0];
  assert.equal(m.content, "Часть ответа");
  assert.equal(m.status, "stopped");
});
test("session patches cannot replace transcript or identity", (t) => {
  const store = createStore(fixture(t)),
    s = store.createSession();
  assert.throws(() => store.updateSession(s.id, { messages: [], id: "other" }));
  assert.equal(store.state.sessions[0].id, s.id);
});

test("permanent deletion removes only the archived chat and survives restart", (t) => {
  const dir = fixture(t), store = createStore(dir);
  store.state.projects.push({ id: "p", name: "Project", path: "unused", skillIds: ["skill"] });
  store.state.skills.push({ id: "skill", name: "review" });
  const active = store.createSession("p"), archived = store.createSession("p");
  archived.messages.push({ id: "message", role: "user", content: "delete this history" });
  store.updateSession(archived.id, { archived: true, draft: "delete this draft" });
  const expected = structuredClone(store.state);
  expected.sessions = expected.sessions.filter((s) => s.id !== archived.id);
  store.deleteSession(archived.id);
  assert.deepEqual(store.state, expected);
  assert.deepEqual(createStore(dir).state, expected);
  assert.equal(store.state.sessions[0].id, active.id);
  assert.doesNotMatch(fs.readFileSync(path.join(dir, "workspace.json"), "utf8"), /delete this/);
});

test("permanent deletion rejects active or missing chats without changing history", (t) => {
  const store = createStore(fixture(t)), session = store.createSession();
  const before = structuredClone(store.state);
  assert.throws(() => store.deleteSession(session.id), /архив/);
  assert.throws(() => store.deleteSession("missing"), /не найдена/);
  assert.throws(() => store.deleteSession(null), /не найдена/);
  assert.deepEqual(store.state, before);
});

test("failed permanent deletion keeps the chat in memory and on disk", (t) => {
  const dir = fixture(t), store = createStore(dir), session = store.createSession();
  store.updateSession(session.id, { archived: true });
  const before = structuredClone(store.state);
  fs.mkdirSync(path.join(dir, "workspace.json.tmp"));
  assert.throws(() => store.deleteSession(session.id), (error) => ["EISDIR", "EPERM", "EACCES"].includes(error.code));
  assert.deepEqual(store.state, before);
  assert.deepEqual(createStore(dir).state, before);
});
test("project can change on an empty draft but not after a message", (t) => {
  const store = createStore(fixture(t));
  store.state.projects.push({ id: "p", name: "project", path: "path" });
  const s = store.createSession();
  store.updateSession(s.id, { projectId: "p" });
  assert.equal(s.projectId, "p");
  s.messages.push({ id: "u", role: "user", content: "hello" });
  assert.throws(() => store.updateSession(s.id, { projectId: null }));
});
test("corrupt JSON is preserved and reported without silently deleting it", (t) => {
  const dir = fixture(t);
  fs.writeFileSync(path.join(dir, "workspace.json"), "{bad");
  const store = createStore(dir);
  assert.ok(store.warning);
  assert.equal(store.state.sessions.length, 0);
  assert.ok(
    fs.readdirSync(dir).some((f) => f.startsWith("workspace.corrupt-")),
  );
});

test("legacy routing selections and historical identities survive migration unchanged", (t) => {
  const dir = fixture(t);
  const store = createStore(dir);
  assert.equal(store.state.settings.model, "claude-opus-5-5");
  store.state.settings.model = "Base";
  for (const [index, model] of [
    "Base",
    "FRONTIER",
    "cheap",
    "custom-model",
  ].entries()) {
    store.state.sessions.push({
      id: String(index),
      model,
      messages: [
        {
          id: "old",
          role: "assistant",
          model: "recorded-model",
          content: "Already answered",
        },
        {
          id: "legacy",
          role: "assistant",
          content: "Older answer without model metadata",
        },
      ],
    });
  }
  delete store.state.modelLibraries;
  store.save();
  const migrated = createStore(dir);
  assert.equal(migrated.state.settings.model, "Base");
  assert.deepEqual(
    migrated.state.sessions.map((session) => session.model),
    ["Base", "FRONTIER", "cheap", "custom-model"],
  );
  assert.deepEqual(
    migrated.state.sessions
      .slice(0, 3)
      .map((session) => session.messages[1].model),
    [undefined, undefined, undefined],
  );
  assert.ok(
    migrated.state.sessions.every(
      (session) => session.messages[0].model === "recorded-model",
    ),
  );
  migrated.save();
  assert.deepEqual(createStore(dir).state, migrated.state);
  assert.equal(migrated.createSession().model, "Base");
});

test("model changes preserve exact routing and custom IDs for every provider", (t) => {
  const dir = fixture(t),
    store = createStore(dir),
    session = store.createSession();
  store.updateSession(session.id, { model: "Cheap" });
  assert.equal(session.model, "Cheap");
  store.updateSession(session.id, { model: "glm-5.3" });
  assert.equal(session.model, "glm-5.3");
  store.state.settings.baseUrl = "https://example.test/v1";
  store.state.settings.model = "Base";
  store.updateSession(session.id, { model: "Frontier" });
  const reloaded = createStore(dir).state;
  assert.equal(reloaded.settings.model, "Base");
  assert.equal(reloaded.sessions[0].model, "Frontier");
});
