// Local UI QA: real controller/store, scripted model, temporary workspace, no credentials or external tools.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createStore } = require("../electron/store.cjs");
const { createController } = require("../electron/controller.cjs");
const { questionDefinition } = require("../electron/interaction.cjs");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "turwe-ui-interaction-"));
const store = createStore(dir);
store.state.settings.sounds = false;
store.state.settings.model = "Claude Opus 5.5";
store.state.projects = [
  {
    id: "demo",
    name: "Turwe workspace",
    path: "C:\\Projects\\Turwe",
    createdAt: new Date().toISOString(),
  },
];
const questionArgs = {
  questions: [
    {
      id: "scope",
      question: "Где использовать подключение Figma?",
      options: [
        { label: "В этом проекте", description: "Только для Turwe workspace" },
        {
          label: "Во всех проектах",
          description: "Добавить в личное пространство",
        },
      ],
    },
    {
      id: "content",
      question: "С чем будем работать?",
      multiSelect: true,
      options: [
        { label: "Компоненты" },
        { label: "Цвета и стили" },
        { label: "Макеты экранов" },
      ],
    },
  ],
};
let revision = 0;
const controller = createController({
  store,
  getConfig: () => ({ key: "fixture-only" }),
  emit: () => revision++,
  getTools: () => [
    questionDefinition,
    {
      type: "function",
      function: { name: "update_mock_item" },
      label: "Изменить тестовый компонент",
      requiresApproval: true,
    },
  ],
  executeTool: async () => ({
    text: "Тестовый компонент обновлён. Внешние приложения не вызывались.",
  }),
  stream: async ({ messages, onDelta, signal }) => {
    if (messages.at(-1)?.role === "tool") {
      onDelta(
        messages.at(-1).content.includes('"answers"')
          ? "Ответ сохранён. Продолжу с выбранными настройками проекта."
          : "Готово — тестовое действие выполнено.",
      );
      return;
    }
    const prompt = messages.findLast((m) => m.role === "user").content;
    if (prompt.includes("структуру"))
      return new Promise((resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), {
          once: true,
        });
      });
    if (prompt.includes("компонент"))
      return {
        toolCalls: [
          {
            id: `write-${revision}`,
            function: {
              name: "update_mock_item",
              arguments: '{"component":"Button","radius":12}',
            },
          },
        ],
      };
    return {
      toolCalls: [
        {
          id: `question-${revision}`,
          function: {
            name: "ask_user",
            arguments: JSON.stringify(questionArgs),
          },
        },
      ],
    };
  },
});
function session(title, prompt) {
  const s = store.createSession("demo");
  s.title = title;
  if (prompt) controller.send(s.id, prompt);
  return s;
}
for (const title of [
  "Состояния кнопок",
  "Сетка и отступы",
  "Экспорт иконок",
  "Палитра интерфейса",
  "Документация скиллов",
  "Анимации меню",
]) {
  const s = session(title);
  s.messages = [
    {
      id: `done-${title}`,
      role: "assistant",
      content: "Готово.",
      status: "complete",
      createdAt: s.createdAt,
    },
  ];
}
session("Новая сессия");
session("Анализ проекта", "Проверь структуру проекта");
session("Обновление компонента", "Обнови компонент");
session("Подключение Figma", "Помоги настроить подключение Figma");
function publicState() {
  return {
    ...store.state,
    platform: "qa",
    hasKey: false,
    warning: "",
    connectors: [],
  };
}
async function invoke(method, args) {
  switch (method) {
    case "bootstrap":
      return publicState();
    case "createSession":
      return store.createSession(args[0]).id;
    case "updateSession":
      store.updateSession(...args);
      controller.permissionsChanged(args[0]);
      revision++;
      return null;
    case "answerQuestion":
      controller.answer(...args);
      return null;
    case "approveTool":
      controller.approve(...args);
      return null;
    case "stop":
      controller.stop(args[0]);
      return null;
    case "send":
      return controller.send(args[0], args[1]).messageId;
    case "retry":
      return controller.retry(args[0]).messageId;
    case "getModels":
      return [{ id: "Claude Opus 5.5", name: "Claude Opus 5.5" }];
    default:
      throw new Error("Недоступно в тестовой среде");
  }
}
(async () => {
  const { createServer } = await import("vite");
  const server = await createServer({
    server: { host: "127.0.0.1", port: 5186, strictPort: true },
    plugins: [
      {
        name: "interaction-fixture",
        configureServer(server) {
          server.middlewares.use("/__interaction", async (req, res) => {
            res.setHeader("Content-Type", "application/json");
            if (
              req.headers.origin &&
              req.headers.origin !== "http://127.0.0.1:5186"
            ) {
              res.statusCode = 403;
              res.end();
              return;
            }
            try {
              let text = "";
              for await (const chunk of req) {
                text += chunk;
                if (text.length > 100000) throw new Error("Request too large");
              }
              const { method, args = [] } = JSON.parse(text);
              const value = await invoke(method, args);
              res.end(JSON.stringify({ ok: true, value, revision }));
            } catch (error) {
              res.end(JSON.stringify({ ok: false, error: error.message }));
            }
          });
        },
      },
    ],
  });
  await server.listen();
  console.log(
    "UI fixture ready: http://127.0.0.1:5186/tests/interaction-preview.html (isolated data, no API)",
  );
  process.on("SIGINT", async () => {
    controller.stopAll();
    await server.close();
    process.exit(0);
  });
})();
