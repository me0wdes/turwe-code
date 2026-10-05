// Disposable UI fixture: real persistence and deletion controller, no API or user profile.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createStore } = require("../electron/store.cjs");
const { createController } = require("../electron/controller.cjs");
const { upsertSkill } = require("../electron/skills.cjs");
const { listFiles, readProjectFile, openProjectFolder } = require("../electron/files.cjs");
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "turwe-sidebar-qa-"));
const store = createStore(directory);
store.state.settings.sounds = false;
const names = ["Claude work", "Meow parser", "Meowdes calculator", "Starscribe"];
store.state.projects = names.map((name, i) => ({ id: `project-${i}`, name, path: path.join(directory, "projects", name), createdAt: new Date().toISOString() }));
for (const project of store.state.projects) {
  fs.mkdirSync(path.join(project.path, "src", "components"), { recursive: true });
  fs.mkdirSync(path.join(project.path, "docs"));
  fs.writeFileSync(path.join(project.path, "README.md"), `# ${project.name}\n\nТестовая папка проекта.`);
  fs.writeFileSync(path.join(project.path, "src", "components", "Button.tsx"), "export const Button = () => <button>Кнопка</button>;\n");
}
const openedFolders = [];
function projectFor(id) {
  const project = store.state.projects.find((project) => project.id === id);
  if (!project) throw new Error("Проект не найден");
  return project;
}
for (const [i, project] of store.state.projects.entries()) {
  for (const title of i === 1 ? ["Парсер ссылок", "Проверка экспорта", "Новая сессия"] : ["Новая сессия"]) {
    const session = store.createSession(project.id);
    store.updateSession(session.id, { title });
  }
}
for (const name of ["review", "animate", "frontend"]) {
  upsertSkill(store, { source: `---\nname: ${name}\ndescription: Тестовый скилл ${name}\n---\nТестовые инструкции.` });
}
for (const [i, title] of ["Черновик лендинга", "Старый экспорт"].entries()) {
  const session = store.createSession(`project-${i}`);
  session.messages.push({ id: `message-${i}`, role: "user", content: "История тестового чата", createdAt: session.createdAt });
  store.updateSession(session.id, { title, archived: true, draft: "Черновик архива" });
}
let revision = 0;
const initialState = structuredClone(store.state);
const controller = createController({ store, emit: () => revision++, getConfig: () => ({ key: "" }) });
const publicState = () => ({ ...store.state, models: store.models.list(), connectors: [], hasKey: false, warning: "", platform: "qa" });
async function invoke(method, args) {
  switch (method) {
    case "bootstrap": return publicState();
    case "createSession": {
      const session = store.createSession(args[0]);
      revision++;
      return session.id;
    }
    case "updateSession": store.updateSession(...args); revision++; return null;
    case "draftAttachments": {
      const session = store.state.sessions.find((session) => session.id === args[0]);
      if (!session) throw new Error("Сессия не найдена");
      session.draftAttachments = args[1]; store.save(); revision++; return null;
    }
    case "deleteSession": controller.deleteSession(args[0]); return publicState();
    case "listFiles": return listFiles(projectFor(args[0]).path, args[1]);
    case "readFile": return readProjectFile(projectFor(args[0]).path, args[1]);
    case "openProjectFolder": return openProjectFolder(projectFor(args[0]).path, async (folder) => {
      openedFolders.push(folder);
      fs.writeFileSync(path.join(directory, "opened-projects.json"), JSON.stringify(openedFolders));
      return "";
    });
    case "restoreQaChats": Object.assign(store.state, structuredClone(initialState)); store.save(); revision++; return publicState();
    case "saveSettings": Object.assign(store.state.settings, args[0]); store.save(); revision++; return publicState();
    case "windowAction": return null;
    default: throw new Error("Недоступно в изолированном тестовом стенде");
  }
}
(async () => {
  const { createServer } = await import("vite");
  const server = await createServer({
    server: { host: "127.0.0.1", port: 5186, strictPort: true },
    plugins: [{
      name: "sidebar-fixture",
      configureServer(server) {
        server.middlewares.use("/__interaction", async (req, res) => {
          res.setHeader("Content-Type", "application/json");
          if (req.method !== "POST" || (req.headers.origin && req.headers.origin !== "http://127.0.0.1:5186")) {
            res.statusCode = 403; res.end(); return;
          }
          try {
            let body = "";
            for await (const chunk of req) {
              body += chunk;
              if (body.length > 100000) throw new Error("Request too large");
            }
            const { method, args = [] } = JSON.parse(body);
            res.end(JSON.stringify({ ok: true, value: await invoke(method, args), revision }));
          } catch (error) {
            res.end(JSON.stringify({ ok: false, error: error.message }));
          }
        });
      },
    }],
  });
  await server.listen();
  console.log("Sidebar QA ready: http://127.0.0.1:5186/tests/sidebar-preview.html");
  console.log(`Disposable data: ${directory}`);
  process.on("SIGINT", async () => { await server.close(); process.exit(0); });
})();
