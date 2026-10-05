const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createStore } = require("../electron/store.cjs");
const { createController } = require("../electron/controller.cjs");
const {
  needsApproval,
  validateQuestions,
  validateAnswers,
} = require("../electron/interaction.cjs");
const questionArgs = {
  questions: [
    {
      id: "scope",
      question: "Куда установить скилл?",
      options: [
        { label: "В проект" },
        { label: "Лично", description: "Для всех проектов" },
      ],
    },
    {
      id: "parts",
      question: "Что добавить?",
      multiSelect: true,
      options: [{ label: "Фото" }, { label: "Файлы" }],
    },
  ],
};
const answer = {
  answers: [
    { id: "scope", selected: ["В проект"], text: "" },
    { id: "parts", selected: ["Фото", "Файлы"], text: "С предпросмотром" },
  ],
};
const questionDef = {
  type: "function",
  function: { name: "ask_user" },
  interaction: "question",
};
const writeDef = {
  type: "function",
  function: { name: "write_item" },
  requiresApproval: true,
};
function fixture(t, options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "turwe-interaction-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = createStore(dir);
  let rounds = 0,
    executions = 0;
  const controller = createController({
    store,
    getConfig: () => ({ key: "test" }),
    emit: () => {},
    getTools: () => [questionDef],
    executeTool: async () => {
      executions++;
      return { text: "done" };
    },
    stream: async () =>
      ++rounds === 1
        ? {
            toolCalls: [
              {
                id: "q1",
                function: {
                  name: "ask_user",
                  arguments: JSON.stringify(questionArgs),
                },
              },
            ],
          }
        : undefined,
    ...options,
  });
  t.after(() => controller.stopAll());
  return { store, controller, dir, executions: () => executions };
}
const tick = () => new Promise((r) => setImmediate(r));

test("answer followed immediately by stop preserves the real answer without another model request", async (t) => {
  const { store, controller } = fixture(t);
  const s = store.createSession(),
    job = controller.send(s.id, "ask");
  await tick();
  controller.answer(s.id, "q1", answer);
  controller.stop(s.id);
  await job.done;
  const call = s.messages.at(-1).toolRounds[0].calls[0];
  assert.equal(s.messages.at(-1).status, "stopped");
  assert.deepEqual(JSON.parse(call.result), answer);
  assert.equal(call.status, "complete");
});

test("permission modes distinguish reads, mutations, unknown tools and interactive input", () => {
  for (const mode of ["ask", "simple", "auto", "bypass"])
    assert.equal(needsApproval(mode, questionDef), false);
  assert.equal(needsApproval("ask", { readOnly: true }), true);
  assert.equal(needsApproval("auto", { readOnly: true }), false);
  assert.equal(needsApproval("auto", { mcp: { readOnly: true } }), false);
  for (const tool of [
    {},
    { requiresApproval: true, readOnly: true },
    { mcp: { readOnly: false } },
  ]) {
    assert.equal(needsApproval("auto", tool), false);
    assert.equal(needsApproval("simple", tool), true);
    assert.equal(needsApproval("bypass", tool), false);
  }
  assert.equal(needsApproval("invalid", {}), true);
});
test("question and answer validation rejects ambiguous, oversized and invented choices", () => {
  const questions = validateQuestions(questionArgs);
  assert.equal(questions[0].multiSelect, false);
  assert.deepEqual(validateAnswers(questions, answer), answer);
  assert.deepEqual(validateAnswers(questions, { skipped: true, answers: [] }), {
    skipped: true,
    answers: [],
  });
  for (const value of [
    { questions: [] },
    { questions: Array(4).fill(questionArgs.questions[0]) },
    { questions: Array(2).fill(questionArgs.questions[0]) },
    {
      questions: [
        { id: "x", question: "x", options: [{ label: "a" }, { label: "a" }] },
      ],
    },
  ])
    assert.throws(() => validateQuestions(value));
  for (const value of [
    { answers: [] },
    { skipped: true, answers: answer.answers },
    { answers: [{ id: "scope", selected: ["invented"] }, answer.answers[1]] },
    {
      answers: [
        { id: "scope", selected: ["В проект", "Лично"] },
        answer.answers[1],
      ],
    },
    { answers: [{ id: "scope", text: "x".repeat(8001) }, answer.answers[1]] },
  ])
    assert.throws(() => validateAnswers(questions, value));
});
test("question waits in bypass, accepts human response once, resumes with structured tool history", async (t) => {
  let rounds = 0,
    history;
  const { store, controller, executions } = fixture(t, {
    stream: async ({ messages }) => {
      if (++rounds === 1)
        return {
          toolCalls: [
            {
              id: "q1",
              function: {
                name: "ask_user",
                arguments: JSON.stringify(questionArgs),
              },
            },
          ],
        };
      history = messages;
    },
  });
  const s = store.createSession();
  store.updateSession(s.id, { permissionMode: "bypass" });
  const job = controller.send(s.id, "Помоги выбрать");
  await tick();
  assert.equal(s.messages.at(-1).status, "question");
  assert.equal(rounds, 1);
  assert.throws(() => controller.answer(s.id, "q1", { answers: [] }));
  controller.answer(s.id, "q1", answer);
  assert.throws(() => controller.answer(s.id, "q1", answer));
  await job.done;
  assert.equal(executions(), 0);
  assert.equal(s.messages.at(-1).status, "complete");
  assert.deepEqual(JSON.parse(history.at(-1).content), answer);
  assert.deepEqual(s.messages.at(-1).toolRounds[0].calls[0].response, answer);
});
test("skip is explicit and stop rejects stale answers without resolving another session", async (t) => {
  const { store, controller } = fixture(t, {
    stream: async () => ({
      toolCalls: [
        {
          id: "q1",
          function: {
            name: "ask_user",
            arguments: JSON.stringify(questionArgs),
          },
        },
      ],
    }),
  });
  const a = store.createSession(),
    b = store.createSession();
  const ja = controller.send(a.id, "one"),
    jb = controller.send(b.id, "two");
  await tick();
  controller.stop(a.id);
  await ja.done;
  assert.throws(() => controller.answer(a.id, "q1", answer));
  assert.equal(b.messages.at(-1).status, "question");
  controller.answer(b.id, "q1", { skipped: true, answers: [] });
  await jb.done;
  assert.equal(b.messages.at(-1).toolRounds[0].calls[0].response.skipped, true);
});
test("switching to bypass releases a pending tool but never a pending question", async (t) => {
  let rounds = 0;
  const { store, controller, executions } = fixture(t, {
    getTools: () => [writeDef, questionDef],
    stream: async () => {
      rounds++;
      return rounds < 3
        ? {
            toolCalls: [
              {
                id: `c${rounds}`,
                function: {
                  name: rounds === 1 ? "write_item" : "ask_user",
                  arguments: rounds === 1 ? "{}" : JSON.stringify(questionArgs),
                },
              },
            ],
          }
        : undefined;
    },
  });
  const s = store.createSession();
  s.permissionMode = "ask";
  const job = controller.send(s.id, "Do it");
  await tick();
  assert.equal(s.messages.at(-1).status, "approval");
  assert.equal(executions(), 0);
  store.updateSession(s.id, { permissionMode: "bypass" });
  controller.permissionsChanged(s.id);
  await tick();
  assert.equal(executions(), 1);
  assert.equal(s.messages.at(-1).status, "question");
  controller.permissionsChanged(s.id);
  await tick();
  assert.equal(s.messages.at(-1).status, "question");
  controller.answer(s.id, "c2", answer);
  await job.done;
});
test("mode persists, invalid modes reject, restart cancels questions, and branches inherit mode", async (t) => {
  const { store, controller, dir } = fixture(t);
  const s = store.createSession();
  assert.equal(s.permissionMode, "auto");
  assert.throws(() => store.updateSession(s.id, { permissionMode: "unsafe" }));
  store.updateSession(s.id, { permissionMode: "bypass" });
  const job = controller.send(s.id, "ask");
  await tick();
  const restored = createStore(dir).state.sessions[0];
  assert.equal(restored.permissionMode, "bypass");
  assert.equal(restored.messages.at(-1).status, "stopped");
  assert.equal(
    restored.messages.at(-1).toolRounds[0].calls[0].status,
    "stopped",
  );
  controller.stop(s.id);
  await job.done;
  const id = controller.branch(s.id, s.messages[0].id, "new");
  await tick();
  assert.equal(
    store.state.sessions.find((v) => v.id === id).permissionMode,
    "bypass",
  );
});
