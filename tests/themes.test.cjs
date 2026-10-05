const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { createStore } = require("../electron/store.cjs");
const { THEMES, normalizeTheme, validateTheme, themeBackground } = require("../electron/themes.mjs");

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "turwe-themes-test-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test("new and pre-theme workspaces use ChatGPT without resetting their data", (t) => {
  const directory = fixture(t), store = createStore(directory);
  assert.equal(store.state.settings.theme, "chatgpt");
  const session = store.createSession();
  store.updateSession(session.id, { draft: "Не потерять черновик", model: "claude-sonnet-5" });
  delete store.state.settings.theme;
  store.save();
  const expected = structuredClone(store.state);
  expected.settings.theme = "chatgpt";
  assert.deepEqual(createStore(directory).state, expected);
});

test("each palette survives restart without changing models, projects, skills or chats", (t) => {
  const directory = fixture(t), store = createStore(directory);
  store.state.projects.push({ id: "p", name: "Проект", path: "C:/example", skillIds: ["s"] });
  store.state.skills.push({ id: "s", name: "review", body: "Check UI" });
  const session = store.createSession("p");
  store.updateSession(session.id, { draft: "Продолжить задачу", permissionMode: "ask" });
  session.messages.push({ id: "m", role: "user", content: "Текст с вложением", attachments: [{ path: "sample.png", size: 10 }] });
  for (const { id } of THEMES) {
    store.state.settings.theme = validateTheme(id);
    store.save();
    assert.deepEqual(createStore(directory).state, store.state);
    assert.match(themeBackground(id), /^#[\da-f]{6}$/);
  }
});

test("removed Turwe and unknown persisted themes migrate to ChatGPT without resetting the workspace", (t) => {
  const directory = fixture(t), store = createStore(directory);
  const session = store.createSession();
  store.updateSession(session.id, { title: "Мой чат", draft: "Черновик" });
  for (const value of ["turwe", null, {}, 4, "future-theme", "toString"]) {
    store.state.settings.theme = value;
    store.save();
    const loaded = createStore(directory);
    const expected = structuredClone(store.state);
    expected.settings.theme = "chatgpt";
    assert.deepEqual(loaded.state, expected);
    assert.equal(loaded.warning, "");
    loaded.save();
    assert.equal(JSON.parse(fs.readFileSync(path.join(directory, "workspace.json"), "utf8")).settings.theme, "chatgpt");
  }
});

test("settings reject unregistered themes instead of silently saving an invalid preference", () => {
  for (const value of ["turwe", null, undefined, {}, [], 1, "", "dark", "__proto__", "Claude Code"]) {
    assert.throws(() => validateTheme(value), /Неизвестная тема/);
    assert.equal(normalizeTheme(value), "chatgpt");
  }
});
