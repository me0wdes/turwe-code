const { parseSkill, upsertSkill, assignSkill } = require("./skills.cjs");
const { validateHttpUrl } = require("./mcp-http.cjs");
const { figmaEndpoint } = require("./mcp-errors.cjs");

const PRESETS = {
  figma: {
    name: "Figma",
    type: "http",
    url: "https://mcp.figma.com/mcp",
    auth: "oauth",
  },
  "figma-desktop": {
    name: "Figma Desktop",
    type: "http",
    url: "http://127.0.0.1:3845/mcp",
    auth: "none",
  },
};
function tool(name, description, properties, required = [], readOnly = false) {
  return {
    type: "function",
    readOnly,
    function: {
      name,
      description,
      parameters: {
        type: "object",
        properties,
        required,
        additionalProperties: false,
      },
    },
  };
}
const definitions = [
  tool(
    "list_connectors",
    "List saved MCP connections and supported setup presets. Use when a user asks to connect an app or a needed integration is missing. Never invent endpoints.",
    {},
    [],
    true,
  ),
  tool(
    "connect_connector",
    "Prepare and connect an MCP service directly in chat. Choose exactly one saved connectorId, known preset, or a user-provided MCP url. The URL determines Remote vs Desktop, not the connection name. Figma remote requires client registration before browser OAuth; figma-desktop requires the local Figma app MCP server to be enabled. Report only the returned diagnostic facts on failure; do not invent account settings or switch Remote to Desktop unless the user chooses that alternative. The app shows approval, opens sign-in when registration succeeds and waits for actual tool discovery. After success continue the original task; use ToolSearch if needed. Never put tokens into arguments.",
    {
      connectorId: { type: "string" },
      preset: { type: "string", enum: Object.keys(PRESETS) },
      url: {
        type: "string",
        description:
          "Exact MCP endpoint supplied by user or verified in provider documentation; no credentials or query.",
      },
      name: { type: "string" },
      auth: { type: "string", enum: ["oauth", "none"] },
    },
  ),
  tool(
    "create_skill",
    "Create a reusable skill when the user asks to create/save one. Write a complete self-contained SKILL.md with YAML name and description and useful Markdown instructions. Preview and approval appear in chat. Project scope defaults to the selected project and assigns the skill there; personal scope makes it available via @name. Existing skills are never overwritten. Use Skill afterward if the user also wants to apply it now.",
    {
      source: {
        type: "string",
        description:
          "Complete SKILL.md, up to 64000 characters; no missing local references.",
      },
      scope: { type: "string", enum: ["project", "personal"] },
    },
    ["source"],
  ),
];

function connectionError(message = "") {
  if (message.includes("Figma remote connection failed"))
    return "Не удалось подключиться к Figma. Точная причина не установлена; повторите подключение для новой диагностики.";
  if (message.includes("OAuth sign-in was declined"))
    return "Вход отменён в браузере. Чтобы продолжить, подключитесь ещё раз.";
  if (/sign-in timed out|server timed out/.test(message))
    return "Время ожидания истекло. Проверьте доступность сервера и повторите подключение.";
  if (/authentication failed|Authentication required/.test(message))
    return "Не удалось подтвердить доступ. Повторите вход в аккаунт.";
  if (message.includes("MCP connection or tool failed. Check the server URL"))
    return "Сервер не ответил корректно. Проверьте адрес MCP, соединение с интернетом и способ входа.";
  return message || "Сервер не подтвердил подключение";
}

function createChatSetup({ store, mcp, emit = () => {} }) {
  function scope(args, session) {
    if (args.scope && !["project", "personal"].includes(args.scope))
      throw new Error("Неизвестная область скилла");
    const projectId =
      args.scope === "personal" ? null : session.projectId || null;
    const project = store.state.projects.find((p) => p.id === projectId);
    if ((args.scope === "project" || projectId) && !project)
      throw new Error("Выберите проект или область personal");
    return { projectId, label: project?.name || "Общая библиотека" };
  }
  function target(args) {
    if (
      ["connectorId", "preset", "url"].filter((k) => args[k] !== undefined)
        .length !== 1
    )
      throw new Error("Укажите один коннектор, готовый сервис или адрес MCP");
    if (args.connectorId !== undefined) {
      const existing = mcp.list().find((c) => c.id === args.connectorId);
      if (!existing)
        throw new Error(
          "Коннектор не найден. Сначала используйте list_connectors.",
        );
      return { existing, config: existing };
    }
    let config;
    if (args.preset !== undefined) {
      if (!Object.hasOwn(PRESETS, args.preset))
        throw new Error("Неизвестный готовый сервис");
      config = PRESETS[args.preset];
      if (args.auth && args.auth !== config.auth)
        throw new Error("Используйте способ входа готового сервиса");
    } else {
      const url = validateHttpUrl(args.url, { query: false });
      const figma = figmaEndpoint(url.href);
      const preset = figma ? PRESETS[figma === "remote" ? "figma" : "figma-desktop"] : undefined;
      if (args.auth !== undefined && !["oauth", "none"].includes(args.auth))
        throw new Error("Выберите OAuth или подключение без авторизации");
      const name = args.name === undefined ? preset?.name || url.hostname : args.name;
      if (
        typeof name !== "string" ||
        !name.trim() ||
        name.length > 100 ||
        /[\0\r\n]/.test(name)
      )
        throw new Error("Укажите название сервиса до 100 символов");
      config = {
        name: name.trim(),
        type: "http",
        url: url.href,
        auth: args.auth || preset?.auth || "oauth",
      };
    }
    // Preserve existing authentication and secrets. A chat must not reset them.
    const existing = mcp
      .list()
      .find(
        (c) =>
          c.type === "http" &&
          c.url?.replace(/\/$/, "") === config.url.replace(/\/$/, ""),
      );
    return { config: existing || config, existing };
  }
  function describe(name, args, session) {
    if (name === "connect_connector") {
      const { config, existing } = target(args);
      const figma = figmaEndpoint(config.url);
      const figmaRemote = figma === "remote";
      const figmaDesktop = figma === "desktop";
      return {
        kind: "connector",
        title: config.name,
        status: "prepared",
        connectorId: existing?.id,
        endpoint: config.url,
        auth: config.auth,
        description:
          config.type === "stdio"
            ? "Запустим сохранённый локальный MCP-сервер."
            : figmaDesktop
              ? "В Figma Desktop откройте файл, включите Dev Mode и Enable desktop MCP server. Адрес уже заполнен — осталось подключить."
              : config.auth === "oauth"
                ? "Откроем вход в браузере. После подключения задача продолжится автоматически."
                : "Проверим сервер и подключим доступные инструменты.",
        ...(figmaRemote || figmaDesktop
          ? {
              helpUrl: figmaDesktop
                ? "https://developers.figma.com/docs/figma-mcp-server/local-server-installation/"
                : "https://developers.figma.com/docs/figma-mcp-server/remote-server-installation/",
            }
          : {}),
        ...(figmaRemote ? { alternative: "figma-desktop" } : {}),
      };
    }
    if (name === "create_skill") {
      const parsed = parseSkill(args.source);
      if (parsed.unsupported.length)
        throw new Error(
          `Скилл не поддерживается: ${parsed.unsupported.join(", ")}`,
        );
      return {
        kind: "skill",
        title: parsed.name,
        description: parsed.description,
        scope: scope(args, session).label,
        status: "prepared",
        source: args.source,
      };
    }
    if (name === "install_github_skill") {
      const url = new URL(args.url);
      if (
        url.protocol !== "https:" ||
        url.hostname !== "github.com" ||
        url.username ||
        url.password ||
        url.port ||
        url.search
      )
        throw new Error(
          "Укажите публичную ссылку GitHub без дополнительных параметров",
        );
      url.hash = '';
      return {
        kind: "install",
        title: args.skillPath || url.pathname.slice(1),
        description:
          "Установим инструкции скилла и текстовую справку из GitHub.",
        scope: scope(args, session).label,
        endpoint: url.href,
        status: "prepared",
      };
    }
  }
  async function execute(
    name,
    args,
    { session, signal, onProgress = () => {} },
  ) {
    signal.throwIfAborted();
    if (name === "list_connectors")
      return {
        text: JSON.stringify({
          saved: mcp.list().map((c) => ({
            id: c.id,
            name: c.name,
            type: c.type,
            url: c.url,
            auth: c.auth,
            status: c.status,
            toolCount: c.toolCount,
            ...(c.error ? { error: connectionError(c.error), diagnostic: c.diagnostic } : {}),
          })),
          presets: PRESETS,
        }),
      };
    const preview = describe(name, args, session);
    if (name === "create_skill") {
      const { projectId } = scope(args, session);
      const existing = store.state.skills.find(
        (s) =>
          s.name === preview.title &&
          (!s.projectId || !projectId || s.projectId === projectId),
      );
      if (
        existing &&
        (existing.projectId !== projectId || existing.source !== args.source)
      )
        throw new Error(
          "Скилл с таким именем уже существует. Выберите другое имя; существующий скилл не изменён.",
        );
      const skill =
        existing || upsertSkill(store, { source: args.source, projectId });
      if (projectId) assignSkill(store, projectId, skill.id, true);
      emit();
      return {
        setup: { ...preview, status: "ready", skillId: skill.id },
        text: JSON.stringify({
          id: skill.id,
          name: skill.name,
          scope: preview.scope,
          assigned: !!projectId,
          invoke: `@${skill.name}`,
          next: "Skill can load these instructions immediately if the user requested applying them.",
        }),
      };
    }
    if (name === "connect_connector") {
      const { config, existing } = target(args);
      let connector =
        existing || (await mcp.save({ ...config, enabled: true }));
      signal.throwIfAborted();
      if (!connector.enabled)
        connector = await mcp.save({ ...config, enabled: true });
      let latest = {
        ...preview,
        connectorId: connector.id,
        status: "connecting",
      };
      const progress = (c) => {
        latest = { ...latest, status: c.status, toolCount: c.toolCount || 0, ...(c.error ? { error: connectionError(c.error) } : {}) };
        onProgress(latest);
      };
      progress({ status: "connecting" });
      const unsubscribe = mcp.subscribe?.((items) => {
        const c = items.find((c) => c.id === connector.id);
        if (c) progress(c);
      });
      try {
        const result = await mcp.connect(connector.id, { signal });
        signal.throwIfAborted();
        const connected = result.status === "connected";
        progress({ ...result, status: connected ? "connected" : "error" });
        if (!connected) latest.error = connectionError(result.error);
        return {
          setup: latest,
          isError: !connected,
          text: connected
            ? `Подключено: ${connector.name}. Доступно инструментов: ${result.toolCount}. Продолжай исходную задачу; при необходимости вызови ToolSearch.`
            : `Не удалось подключить ${connector.name}: ${latest.error}\n${result.diagnostic ? `Диагностика: ${JSON.stringify(result.diagnostic)}\n` : ""}Сообщи только подтверждённую причину. Не утверждай, что подключено, и не повторяй запрос без изменения условий.${result.diagnostic?.phase === "registration" ? " Отказ регистрации клиента происходит до входа: не предлагай повторный вход или выдуманное одобрение приложения в Security / Apps." : ""}${figmaEndpoint(config.url) === "remote" ? " Figma принимает заявки на новый Remote-клиент от разработчика приложения. Desktop — отдельный локальный сервер; предложи его как вариант и дождись выбора пользователя, не подключай автоматически." : ""}`,
        };
      } finally {
        unsubscribe?.();
      }
    }
    throw new Error("Неизвестный инструмент настройки");
  }
  return {
    definitions,
    has: (name) => definitions.some((t) => t.function.name === name),
    describe,
    execute,
  };
}
module.exports = { createChatSetup };
