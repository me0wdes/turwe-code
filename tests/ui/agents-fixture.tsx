// Isolated renderer fixture; not referenced by the production entry or included in the package.
import React from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/inter";
import "../../src/styles.css";
import "../../src/capabilities.css";
import type {
  AgentRun,
  AppState,
  DesktopBridge,
  MessageStatus,
  Result,
  Session,
  ToolCall,
} from "../../src/types";
import { agentsIn } from "../../src/agents";
const time = "2026-10-04T12:00:00.000Z";
const listeners = new Set<(state: AppState) => void>();
const ok = <T,>(value: T): Result<T> => ({ ok: true, value });
const rootId = "agents-qa-root";
function agent(
  id: string,
  title: string,
  status: MessageStatus,
  parentAgentId: string | null = null,
): AgentRun {
  return {
    id,
    title,
    task: `${title}. Проверь текущий проект и верни конкретные замечания с коротким объяснением. Не меняй файлы без подтверждения.`,
    rootSessionId: rootId,
    parentAgentId,
    depth: parentAgentId ? 2 : 1,
    projectId: "project",
    model: "claude-sonnet-5",
    draft: "",
    permissionMode: "auto",
    archived: false,
    createdAt: time,
    updatedAt: time,
    messages: [
      { id: `${id}-input`, role: "user", content: title, createdAt: time },
      {
        id: `${id}-reply`,
        role: "assistant",
        content:
          status === "complete"
            ? "Проверка завершена.\n\n- Отступы согласованы.\n- Контраст вторичного текста достаточный.\n- Элементы управления доступны с клавиатуры."
            : "Проверяю выбранную часть проекта.",
        status,
        model: "claude-sonnet-5",
        createdAt: time,
      },
    ],
  };
}
function fixture(): AppState {
  const first = agent("a", "Проверка интерфейса", "working");
  first.messages[1].agents = [
    agent("a-1", "Доступность с клавиатуры", "streaming", "a"),
  ];
  first.messages[1].toolRounds = [
    {
      content: "",
      calls: [
        {
          id: "nested",
          name: "delegate_tasks",
          arguments: "{}",
          status: "running",
          agentIds: ["a-1"],
        },
      ],
    },
  ];
  const second = agent("b", "Проверка API и моделей", "working");
  second.messages[1].toolRounds = [
    {
      content: "",
      calls: [
        {
          id: "read",
          name: "read_project_file",
          label: "Читает конфигурацию",
          arguments: '{"path":"src/models.ts"}',
          status: "running",
        },
      ],
    },
  ];
  const third = agent("c", "Ревью анимаций", "complete");
  const root: Session = {
    id: rootId,
    projectId: "project",
    title: "Обновление рабочего пространства",
    draft: "",
    model: "claude-opus-5-5",
    permissionMode: "auto",
    archived: false,
    createdAt: time,
    updatedAt: time,
    messages: [
      {
        id: "input",
        role: "user",
        content:
          "Проверь интерфейс, модели и анимации. Раздай независимые проверки субагентам и собери общий результат.",
        createdAt: time,
      },
      {
        id: "reply",
        role: "assistant",
        content:
          "Разделил проверку на три независимые задачи. Соберу замечания, когда агенты закончат работу.",
        status: "working",
        model: "claude-opus-5-5",
        createdAt: time,
        agents: [first, second, third],
        toolRounds: [
          {
            content: "",
            calls: [
              {
                id: "delegate",
                name: "delegate_tasks",
                arguments: "{}",
                status: "running",
                agentIds: ["a", "b", "c"],
              },
            ],
          },
        ],
      },
    ],
  };
  return {
    version: 1,
    projects: [
      {
        id: "project",
        name: "Turwe Code",
        path: "C:/test/turwe-code",
        createdAt: time,
      },
    ],
    skills: [],
    sessions: [root],
    connectors: [],
    models: [
      { id: "claude-opus-5-5", name: "Claude Opus 5.5" },
      { id: "claude-sonnet-5", name: "Claude Sonnet 5" },
    ],
    modelLibraries: {},
    hasKey: true,
    warning: "",
    platform: "preview",
    settings: {
      baseUrl: "https://example.test/v1",
      model: "claude-opus-5-5",
      sounds: false,
      volume: 0.2,
      motion: true,
      subagents: true,
    },
  };
}
let state = fixture();
const snapshot = () => structuredClone(state);
function publish() {
  for (const listener of listeners) listener(snapshot());
}
function log(value: unknown) {
  document.getElementById("qa-event")!.textContent = JSON.stringify(value);
}
function child(id: string) {
  return agentsIn(state.sessions[0].messages).find((agent) => agent.id === id)!;
}
function finish(agent: AgentRun, status: MessageStatus) {
  agent.messages.at(-1)!.status = status;
  for (const call of agent.messages
    .at(-1)!
    .toolRounds?.flatMap((round) => round.calls) || [])
    if (["running", "question", "approval"].includes(call.status))
      call.status = status === "complete" ? "complete" : "stopped";
}
window.turwe = {
  bootstrap: async () => ok(snapshot()),
  onState: (callback) => {
    listeners.add(callback);
    return () => {
      listeners.delete(callback);
    };
  },
  updateSession: async (id, patch) => {
    Object.assign(
      state.sessions.find((session) => session.id === id)!,
      patch,
    );
    publish();
    return ok(null);
  },
  stopAgent: async (id, agentId) => {
    log({ action: "stopAgent", id, agentId });
    const target = child(agentId);
    [target, ...agentsIn(target.messages)].forEach((agent) =>
      finish(agent, "stopped"),
    );
    publish();
    return ok(null);
  },
  stop: async (id) => {
    log({ action: "stop", id });
    agentsIn(state.sessions[0].messages).forEach((agent) =>
      finish(agent, "stopped"),
    );
    state.sessions[0].messages.at(-1)!.status = "stopped";
    publish();
    return ok(null);
  },
  answerQuestion: async (id, callId, response, agentId) => {
    log({ action: "answer", id, callId, response, agentId });
    const target = child(agentId!);
    const call = target.messages.at(-1)!.toolRounds![0].calls[0];
    call.response = response;
    call.result = JSON.stringify(response);
    call.status = "complete";
    target.messages.at(-1)!.status = "streaming";
    publish();
    return ok(null);
  },
  approveTool: async (id, callId, allowed, agentId) => {
    log({ action: "approve", id, callId, allowed, agentId });
    const target = child(agentId!);
    const call = target.messages.at(-1)!.toolRounds![0].calls[0];
    call.status = allowed ? "complete" : "denied";
    call.result = allowed ? "Изменение выполнено" : "Действие отклонено";
    target.messages.at(-1)!.status = "streaming";
    publish();
    return ok(null);
  },
  saveSettings: async (settings) => {
    Object.assign(state.settings, settings);
    publish();
    return ok(snapshot());
  },
  copyText: async (text) => {
    log({ action: "copy", text });
    return ok(null);
  },
} as DesktopBridge;
const { default: App } = await import("../../src/App");
function scenario(kind: string) {
  state = fixture();
  const target = child("b"),
    reply = target.messages.at(-1)!;
  if (kind === "Вопрос") {
    reply.status = "question";
    reply.toolRounds = [
      {
        content: "",
        calls: [
          {
            id: "same-provider-call",
            name: "ask_user",
            arguments: "{}",
            status: "question",
            questions: [
              {
                id: "target",
                question: "Какие модели включить в проверку?",
                options: [
                  {
                    label: "Opus и Sonnet",
                    description: "Проверить обе модели из вашего списка",
                  },
                  { label: "Только Opus" },
                ],
                multiSelect: false,
              },
            ],
          },
        ],
      },
    ];
  } else if (kind === "Разрешение") {
    reply.status = "approval";
    reply.toolRounds = [
      {
        content: "",
        calls: [
          {
            id: "same-provider-call",
            name: "figma_update_node",
            label: "Figma",
            arguments: '{"nodeId":"27:30","name":"Turwe"}',
            status: "approval",
            approvalReason: "Субагент хочет изменить название слоя в Figma.",
          },
        ],
      },
    ];
  } else if (kind === "Завершено" || kind === "История") {
    agentsIn(state.sessions[0].messages).forEach((agent) =>
      finish(agent, "complete"),
    );
    state.sessions[0].messages.at(-1)!.status = "complete";
    if (kind === "История")
      state.sessions[0].messages.push(
        { id: "next-input", role: "user", content: "Спасибо", createdAt: time },
        {
          id: "next-reply",
          role: "assistant",
          content: "Готово. Результаты прошлой проверки сохранены.",
          status: "complete",
          createdAt: time,
        },
      );
  } else if (kind === "Ошибка") {
    reply.status = "error";
    reply.error = "API временно недоступен. Полученный текст сохранён.";
  }
  publish();
}
createRoot(document.getElementById("root")!).render(
  <>
    <App />
    <div
      style={{
        position: "fixed",
        zIndex: 80,
        top: 0,
        left: 320,
        display: "flex",
        gap: 6,
        fontSize: 10,
        background: "#171717",
        padding: 3,
        borderRadius: 7,
      }}
    >
      {["Работа", "Вопрос", "Разрешение", "Завершено", "Ошибка", "История"].map(
        (label) => (
          <button
            style={{ padding: 4 }}
            onClick={() => scenario(label)}
            key={label}
          >
            {label}
          </button>
        ),
      )}
      <output id="qa-event" style={{ display: "none" }} />
    </div>
  </>,
);
