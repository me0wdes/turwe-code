import type { Message, ToolCall } from "./types";

type Step =
  | { type: "text"; key: string; content: string }
  | { type: "tools"; key: string; calls: ToolCall[] };

// The controller keeps both the full copyable answer and its individual tool rounds.
// Peel off that exact prefix while streaming; never repeat it below the actions.
export function assistantSteps(message: Message): Step[] {
  const rounds = message.toolRounds || [];
  const steps: Step[] = [];
  rounds.forEach((round, index) => {
    if (round.content)
      steps.push({ type: "text", key: `text-${index}`, content: round.content });
    if (round.calls.length)
      steps.push({ type: "tools", key: `tools-${index}`, calls: round.calls });
  });
  const prefix = rounds.map((round) => round.content).filter(Boolean).join("\n\n");
  let tail = message.content;
  if (rounds.length && message.status === "complete" && message.finalContent !== undefined) {
    tail = message.finalContent;
  } else if (prefix && tail.startsWith(prefix)) {
    tail = tail.slice(prefix.length);
    if (tail.startsWith("\n\n")) tail = tail.slice(2);
  }
  if (tail) steps.push({ type: "text", key: `text-${rounds.length}`, content: tail });
  return steps;
}

type ActivityIcon = "file" | "folder" | "search" | "upload" | "skills" | "tool";
const actions: Record<string, { icon: ActivityIcon; idle: string; running: string; complete: string }> = {
  list_connectors: { icon: "tool", idle: "Проверка подключений", running: "Проверяет подключения", complete: "Проверены доступные подключения" },
  connect_connector: { icon: "tool", idle: "Подключение сервиса", running: "Подключает сервис", complete: "Сервис подключён" },
  create_skill: { icon: "skills", idle: "Создание скилла", running: "Создаёт скилл", complete: "Скилл создан" },
  WebSearch: { icon: "search", idle: "Поиск в интернете", running: "Ищет в интернете", complete: "Выполнен поиск в интернете" },
  WebFetch: { icon: "search", idle: "Чтение сайта", running: "Читает сайт", complete: "Прочитан сайт" },
  read_project_file: { icon: "file", idle: "Чтение файла", running: "Читает файл", complete: "Прочитан файл" },
  list_project_files: { icon: "folder", idle: "Просмотр файлов", running: "Просматривает файлы", complete: "Просмотрены файлы" },
  inspect_github_skills: { icon: "search", idle: "Поиск скиллов", running: "Ищет скиллы в репозитории", complete: "Проверен репозиторий скиллов" },
  install_github_skill: { icon: "upload", idle: "Установка скилла", running: "Устанавливает скилл", complete: "Скилл установлен" },
  list_installed_skills: { icon: "skills", idle: "Проверка скиллов", running: "Проверяет доступные скиллы", complete: "Проверены доступные скиллы" },
  delegate_tasks: { icon: "tool", idle: "Работа субагентов", running: "Работают субагенты", complete: "Завершена работа субагентов" },
};
const states: Partial<Record<ToolCall["status"], string>> = {
  queued: "В очереди",
  approval: "Нужно разрешение",
  question: "Нужен ответ",
  error: "Ошибка",
  denied: "Отклонено",
  stopped: "Прервано",
};
function hint(value: unknown) {
  return typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 180) : "";
}
export function toolActivity(call: ToolCall) {
  let args: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(call.arguments);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) args = parsed;
  } catch { /* The action still needs an honest status if its arguments are invalid. */ }
  const integration = !!call.connectorName || call.name.startsWith("mcp_");
  const action = actions[call.name] || (integration
    ? { icon: "tool" as const, idle: "Вызов интеграции", running: "Работает через интеграцию", complete: "Использована интеграция" }
    : { icon: "tool" as const, idle: "Вызов инструмента", running: "Вызывает инструмент", complete: "Выполнен инструмент" });
  let detail = "";
  if (call.name === "WebSearch") {
    detail = hint(args.query);
  } else if (call.name === "WebFetch") {
    detail = hint(args.url);
  } else if (call.name === "read_project_file" || call.name === "list_project_files") {
    detail = hint(args.path) || (call.name === "list_project_files" ? "Проект" : "");
  } else if (call.name === "inspect_github_skills" || call.name === "install_github_skill") {
    detail = hint(args.skillPath);
    if (!detail) {
      try {
        const url = new URL(String(args.url));
        if (["github.com", "www.github.com"].includes(url.hostname))
          detail = hint(url.pathname.split("/").filter(Boolean).slice(0, 2).join("/"));
      } catch { /* Keep malformed URLs out of the compact row. */ }
    }
  } else if (call.name === "delegate_tasks") {
    const count = call.agentIds?.length || (Array.isArray(args.tasks) ? args.tasks.length : 0);
    if (count) detail = `${count} ${count === 1 ? "субагент" : count < 5 ? "субагента" : "субагентов"}`;
  } else if (integration) {
    detail = [hint(call.connectorName || call.label || call.name), hint(call.toolName)].filter(Boolean).join(": ");
  } else if (!actions[call.name]) {
    detail = hint(call.label || call.name);
  }
  return {
    icon: action.icon,
    label: call.status === "complete" ? action.complete : call.status === "running" ? action.running : action.idle,
    detail,
    status: states[call.status] || "",
  };
}
