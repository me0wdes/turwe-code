const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { interruptAgents, recoverDelegations } = require("./agents.cjs");
const { normalizeMode, PERMISSION_MODES } = require("./interaction.cjs");
const { defaultModel } = require("./model-catalogue.json");
const { DEFAULT_THEME, normalizeTheme } = require("./themes.mjs");
const { createModelLibrary } = require("./model-library.mjs");
const { requireProject, findEmptySession } = require("./session-start.mjs");

const DEFAULT_SETTINGS = {
  theme: DEFAULT_THEME,
  baseUrl: "https://ai.lab.pics/v1",
  model: defaultModel,
  sounds: true,
  volume: 0.2,
  motion: true,
  homeAnimation: true,
  subagents: true,
  effort: "auto",
  approvalModel: "",
};
function atomicWrite(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp`;
  fs.writeFileSync(temp, text, { mode: 0o600 });
  fs.renameSync(temp, file);
}
function createStore(
  directory,
  { documents = path.join(require("node:os").homedir(), "Documents") } = {},
) {
  const projectsDirectory = path.join(documents, "Turwe", "Projects");
  const file = path.join(directory, "workspace.json");
  let warning = "";
  let state = {
    version: 1,
    projects: [],
    skills: [],
    sessions: [],
    settings: { ...DEFAULT_SETTINGS },
  };
  if (fs.existsSync(file)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
      if (
        parsed.version !== 1 ||
        !Array.isArray(parsed.projects) ||
        !Array.isArray(parsed.sessions) ||
        parsed.sessions.some((s) => !s.id || !Array.isArray(s.messages))
      )
        throw new Error("Invalid workspace");
      state = {
        ...parsed,
        skills: Array.isArray(parsed.skills) ? parsed.skills : [],
        settings: { ...DEFAULT_SETTINGS, ...parsed.settings },
      };
      state.settings.theme = normalizeTheme(state.settings.theme);
      for (const session of state.sessions) {
        interruptAgents(session.messages);
        session.permissionMode = normalizeMode(session.permissionMode);
        for (const message of session.messages) {
          if (
            [
              "streaming",
              "connecting",
              "working",
              "approval",
              "question",
            ].includes(message.status)
          )
            message.status = "stopped";
          for (const round of message.toolRounds || [])
            for (const call of round.calls || [])
              if (
                ["queued", "running", "approval", "question"].includes(
                  call.status,
                )
              ) {
                call.status = "stopped";
                call.result = call.questions
                  ? "Вопрос прерван при закрытии приложения; пользователь не ответил. При необходимости задай вопрос снова."
                  : "Приложение закрыто до завершения вызова. Перед повторением проверь фактическое состояние.";
              }
        }
        recoverDelegations(session.messages);
      }
    } catch {
      const backup = path.join(
        directory,
        `workspace.corrupt-${Date.now()}.json`,
      );
      fs.copyFileSync(file, backup);
      warning =
        "Не удалось прочитать историю. Исходный файл сохранён рядом как workspace.corrupt. Создано новое рабочее пространство.";
    }
  }
  function save() {
    atomicWrite(file, JSON.stringify(state, null, 2));
  }
  const models = createModelLibrary(state, save);
  state.mcpForms = [];
  state.agentProfiles ||= [
    {
      id: "reviewer",
      name: "Ревьюер",
      prompt:
        "Проверь изменения на конкретные ошибки. Только чтение, замечания с файлами и строками.",
      allowedTools: [
        "FileRead",
        "Grep",
        "Glob",
        "GitStatus",
        "Git(diff)",
        "Git(status)",
        "Git(log)",
        "LSP",
        "read_project_file",
        "list_project_files",
        "Task*",
        "ask_user",
      ],
      memory: "",
    },
    {
      id: "explorer",
      name: "Исследователь",
      prompt:
        "Исследуй проект и источники, верни точные пути, факты и рекомендации.",
      allowedTools: [
        "FileRead",
        "Grep",
        "Glob",
        "LSP",
        "Web*",
        "Task*",
        "ask_user",
        "read_project_file",
        "list_project_files",
      ],
      memory: "",
    },
    {
      id: "implementer",
      name: "Разработчик",
      prompt:
        "Реализуй назначенную часть, проверь результат. Для параллельных правок используй отдельный worktree.",
      allowedTools: [],
      memory: "",
    },
  ];
  function createSession(projectId = null) {
    if (projectId && !state.projects.some((p) => p.id === projectId))
      throw new Error("Проект не найден");
    const now = new Date().toISOString();
    const session = {
      id: randomUUID(),
      projectId,
      title: "Новая сессия",
      draft: "",
      model: state.settings.model,
      permissionMode: "auto",
      archived: false,
      createdAt: now,
      updatedAt: now,
      messages: [],
    };
    state.sessions.unshift(session);
    save();
    return session;
  }
  function startSession(projectId = null) {
    if (projectId !== null) requireProject(state, projectId);
    return (
      findEmptySession(state.sessions, projectId) || createSession(projectId)
    );
  }
  function ensureWorkspace(session, name) {
    const owner = session.rootSessionId
      ? state.sessions.find((s) => s.id === session.rootSessionId)
      : session;
    if (!owner) throw new Error("Основной чат не найден");
    if (owner.projectId) {
      session.projectId ||= owner.projectId;
      return requireProject(state, owner.projectId);
    }
    const title = String(name || owner.title || "Новый проект")
      .trim()
      .slice(0, 100);
    const folder =
      title
        .replace(/[<>:"/\\|?*\x00-\x1f]/g, "-")
        .replace(/[. ]+$/g, "")
        .slice(0, 60) || "Проект";
    const root = path.join(projectsDirectory, `${folder}-${owner.id}`);
    fs.mkdirSync(projectsDirectory, { recursive: true });
    // Never adopt or overwrite a pre-existing folder, even if its name matches.
    fs.mkdirSync(root);
    const project = {
      id: randomUUID(),
      name: title || "Новый проект",
      path: fs.realpathSync(root),
      createdAt: new Date().toISOString(),
    };
    state.projects.push(project);
    owner.projectId = project.id;
    session.projectId = project.id;
    for (const agent of require("./agents.cjs").agentsIn(owner.messages))
      if (!agent.projectId) agent.projectId = project.id;
    save();
    return project;
  }
  function updateSession(id, patch) {
    const session = state.sessions.find((s) => s.id === id);
    if (!session) throw new Error("Сессия не найдена");
    if (
      !patch ||
      typeof patch !== "object" ||
      Object.keys(patch).some(
        (k) =>
          ![
            "title",
            "draft",
            "model",
            "archived",
            "projectId",
            "permissionMode",
            "effort",
          ].includes(k),
      )
    )
      throw new Error("Недопустимое изменение сессии");
    if (
      "permissionMode" in patch &&
      !PERMISSION_MODES.includes(patch.permissionMode)
    )
      throw new Error("Неизвестный режим подтверждений");
    if (
      "effort" in patch &&
      !["auto", "low", "medium", "high"].includes(patch.effort)
    )
      throw new Error("Неизвестный effort");
    if (
      "projectId" in patch &&
      (session.messages.length ||
        (patch.projectId !== null &&
          !state.projects.some((p) => p.id === patch.projectId)))
    )
      throw new Error("Проект можно сменить только в пустой сессии");
    for (const key of ["title", "draft", "model"])
      if (
        key in patch &&
        (typeof patch[key] !== "string" ||
          patch[key].length > (key === "draft" ? 100000 : 200))
      )
        throw new Error("Некорректное значение");
    if ("archived" in patch && typeof patch.archived !== "boolean")
      throw new Error("Некорректное значение");
    if ("title" in patch && !patch.title.trim())
      throw new Error("Введите название");
    if ("model" in patch) {
      const id = patch.model;
      if (!models.list().some((model) => model.id === id))
        models.add(state.settings.baseUrl, { id });
    }
    Object.assign(session, patch);
    if ("title" in patch) session.title = patch.title.trim();
    save();
    return session;
  }
  function deleteSession(id) {
    const session = state.sessions.find((s) => s.id === id);
    if (!session) throw new Error("Сессия не найдена");
    if (!session.archived)
      throw new Error("Удалить навсегда можно только сессию из архива");
    const previous = state.sessions;
    state.sessions = previous.filter((s) => s.id !== id);
    try {
      save();
    } catch (error) {
      state.sessions = previous;
      throw error;
    }
  }
  return {
    state,
    warning,
    save,
    createSession,
    startSession,
    ensureWorkspace,
    projectsDirectory,
    updateSession,
    deleteSession,
    models,
  };
}
module.exports = { createStore, atomicWrite, DEFAULT_SETTINGS };
