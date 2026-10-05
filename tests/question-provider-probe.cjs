// Read-only access to the saved provider key. Sends only synthetic UI-test content.
const { app, safeStorage } = require("electron");
const fs = require("node:fs"),
  path = require("node:path");
const { createCredentials } = require("../electron/credentials.cjs");
const { createStore } = require("../electron/store.cjs");
const { createController } = require("../electron/controller.cjs");
const { questionDefinition } = require("../electron/interaction.cjs");
const { safeError } = require("../electron/api.cjs");
app.setName("Turwe Code");
app
  .whenReady()
  .then(async () => {
    const output = process.env.TURWE_PROBE_OUTPUT;
    if (!output) throw new Error("Output required");
    const profile = path.join(app.getPath("appData"), "Turwe Code");
    const { settings } = JSON.parse(
      fs.readFileSync(path.join(profile, "workspace.json"), "utf8"),
    );
    const key = createCredentials(profile, safeStorage).get(settings.baseUrl);
    const store = createStore(
      path.join(path.dirname(output), "provider-qa-data"),
    );
    let answered = false;
    const report = {
      checkedAt: new Date().toISOString(),
      model: "claude-opus-5-5",
      questionDisplayed: false,
    };
    const controller = createController({
      store,
      getConfig: () => ({ baseUrl: settings.baseUrl, key }),
      getTools: () => [questionDefinition],
      emit: () => {
        const session = store.state.sessions[0],
          reply = session?.messages.at(-1);
        const call = reply?.toolRounds
          ?.flatMap((r) => r.calls)
          .find((c) => c.status === "question");
        if (call && !answered) {
          answered = true;
          report.questionDisplayed = true;
          report.questions = call.questions;
          // Synthetic probe answer, never applied to a user's conversation.
          queueMicrotask(() =>
            controller.answer(session.id, call.id, {
              answers: call.questions.map((q) => ({
                id: q.id,
                selected: q.options.length ? [q.options[0].label] : [],
                text: "ОТВЕТ_ПОЛУЧЕН",
              })),
            }),
          );
        }
      },
    });
    const timeout = setTimeout(() => controller.stopAll(), 60000);
    try {
      const session = store.createSession();
      session.model = report.model;
      const job = controller.send(
        session.id,
        "Тест интерфейса. Вызови ask_user с одним вопросом «Какой вариант выбрать?» и вариантами «А» и «Б». После получения реального результата инструмента напиши только текст свободного ответа пользователя, без пояснений.",
      );
      await job.done;
      const reply = session.messages.at(-1);
      report.status = reply.status;
      report.final = reply.finalContent;
      report.error = reply.error;
      report.passed =
        report.questionDisplayed &&
        reply.status === "complete" &&
        reply.finalContent.includes("ОТВЕТ_ПОЛУЧЕН");
    } catch (error) {
      report.error = safeError(error, key);
    }
    clearTimeout(timeout);
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, JSON.stringify(report, null, 2));
    app.exit(report.passed ? 0 : 1);
  })
  .catch(() => app.exit(1));
