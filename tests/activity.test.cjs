const { test } = require("node:test");
const assert = require("node:assert/strict");
const { assistantSteps, toolActivity } = require("../src/activity.ts");

const first = { id: "read-1", name: "read_project_file", arguments: '{"path":"src/App.tsx"}', status: "complete" };
const second = { id: "read-2", name: "read_project_file", arguments: '{"path":"src/styles.css"}', status: "running" };

test("comments, calls and the streaming answer keep their original order without duplicated text", () => {
  const message = {
    content: "Сначала проверю компонент.\n\nТеперь проверю стили.\n\nНашёл",
    status: "streaming",
    toolRounds: [
      { content: "Сначала проверю компонент.", calls: [first] },
      { content: "Теперь проверю стили.", calls: [second] },
    ],
  };
  const steps = assistantSteps(message);
  assert.deepEqual(steps.map((step) => step.type === "text" ? step.content : step.calls[0].id), [
    "Сначала проверю компонент.", "read-1", "Теперь проверю стили.", "read-2", "Нашёл",
  ]);
  assert.equal(new Set(steps.map((step) => step.key)).size, 5);
  const completed = assistantSteps({ ...message, status: "complete", finalContent: "Нашёл" });
  assert.deepEqual(completed, steps);
});

test("a live comment keeps its React key when its tool calls arrive", () => {
  const before = assistantSteps({ content: "Проверю файл.", status: "streaming" });
  const after = assistantSteps({ content: "Проверю файл.", status: "working", toolRounds: [{ content: "Проверю файл.", calls: [first] }] });
  assert.deepEqual(before[0], after[0]);
  assert.equal(after.length, 2);
});

test("empty tool-round comments, empty final answers and ordinary answers are not duplicated or invented", () => {
  const message = { content: "Проверю.\n\nОтвет", toolRounds: [{ content: "Проверю.", calls: [first] }, { content: "", calls: [second] }] };
  assert.deepEqual(assistantSteps(message).map((s) => s.type), ["text", "tools", "tools", "text"]);
  assert.equal(assistantSteps({ ...message, status: "complete", finalContent: "" }).length, 3);
  assert.deepEqual(assistantSteps({ content: "", status: "connecting" }), []);
  assert.deepEqual(assistantSteps({ content: "Обычный ответ" }).map((s) => s.content), ["Обычный ответ"]);
});

test("interrupted text, retry and legacy saved answers retain their content", () => {
  const rounds = [{ content: "Проверю.", calls: [first] }];
  assert.equal(assistantSteps({ content: "Проверю.\n\nЧастичный ответ", status: "stopped", toolRounds: rounds }).at(-1).content, "Частичный ответ");
  assert.equal(assistantSteps({ content: "Проверю.", finalContent: "", status: "connecting", toolRounds: rounds }).length, 2);
  assert.equal(assistantSteps({ content: "Ответ из старого чата", status: "complete", toolRounds: [{ content: "", calls: [first] }] }).at(-1).content, "Ответ из старого чата");
  assert.equal(assistantSteps({ content: "Ответ без сохранённого префикса", toolRounds: rounds }).at(-1).content, "Ответ без сохранённого префикса");
});

test("activity only claims success after the real call completed", () => {
  assert.equal(toolActivity(first).label, "Прочитан файл");
  assert.equal(toolActivity(second).label, "Читает файл");
  for (const status of ["queued", "approval", "error", "denied", "stopped"]) {
    const activity = toolActivity({ ...first, status });
    assert.equal(activity.label, "Чтение файла");
    assert.ok(activity.status);
    assert.equal(activity.detail, "src/App.tsx");
  }
  assert.equal(toolActivity({ ...first, arguments: "{broken" }).detail, "");
});

test("integration names and unknown tools stay truthful; only safe argument hints appear in rows", () => {
  const mcp = toolActivity({ ...first, name: "mcp_opaque", connectorName: "Figma", toolName: "get_design_context" });
  assert.equal(mcp.label, "Использована интеграция");
  assert.equal(mcp.detail, "Figma: get_design_context");
  const custom = toolActivity({ ...first, name: "unknown_tool", arguments: '{"token":"private","command":"do not show"}' });
  assert.equal(custom.label, "Выполнен инструмент");
  assert.equal(custom.detail, "unknown_tool");
  const github = toolActivity({ ...first, name: "inspect_github_skills", arguments: '{"url":"https://github.com/owner/repo?token=secret#hash"}' });
  assert.equal(github.detail, "owner/repo");
});
