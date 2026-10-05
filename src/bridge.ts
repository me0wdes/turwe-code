import { agentStatus, hasActiveReply } from "./agents";
import type { AppState, DesktopBridge, Result, Session } from "./types";
import { parse } from "yaml";
import {
  DEFAULT_THEME,
  normalizeTheme,
  validateTheme,
} from "../electron/themes.mjs";
import { DEFAULT_MODEL, createModelLibrary } from "./models";
import {
  requireProject,
  findEmptySession,
} from "../electron/session-start.mjs";
const defaultState: AppState = {
  version: 1,
  models: [],
  modelLibraries: {},
  projects: [],
  skills: [],
  connectors: [],
  sessions: [],
  settings: {
    theme: DEFAULT_THEME,
    baseUrl: "https://ai.lab.pics/v1",
    model: DEFAULT_MODEL,
    sounds: true,
    volume: 0.2,
    motion: true,
    homeAnimation: true,
    subagents: true,
  },
  hasKey: false,
  warning: "",
  platform: "preview",
};
// Browser preview supports local interaction only. API and disk access require the desktop bridge.
function previewBridge(): DesktopBridge {
  let state = defaultState;
  try {
    const value = JSON.parse(localStorage.getItem("turwe-preview") || "null");
    if (value?.version === 1)
      state = {
        ...value,
        skills: value.skills || [],
        connectors: [],
        hasKey: false,
        platform: "preview",
        settings: {
          ...defaultState.settings,
          ...value.settings,
          theme: normalizeTheme(value.settings?.theme),
        },
        sessions: value.sessions.map((s: Session) => ({
          ...s,
          permissionMode: s.permissionMode || "auto",
        })),
      };
  } catch {}
  const listeners = new Set<(s: AppState) => void>();
  const ok = <T>(value: T): Result<T> => ({ ok: true, value });
  const save = () => {
    state.models = models.list();
    localStorage.setItem("turwe-preview", JSON.stringify(state));
    for (const cb of listeners) cb(structuredClone(state));
  };
  const models = createModelLibrary(state, save);
  state.models = models.list();
  const changeModels = async (
    change: () => void,
  ): Promise<Result<AppState>> => {
    try {
      change();
      return ok(structuredClone(state));
    } catch (error) {
      return { ok: false, error: (error as Error).message };
    }
  };
  const desktop = async (): Promise<Result<never>> => ({
    ok: false,
    error:
      "Это браузерный просмотр. Работа с файлами и API доступна в настольном приложении.",
  });
  return {
    bootstrap: async () => ok(structuredClone(state)),
    checkUpdates: desktop,
    downloadUpdate: desktop,
    chooseProject: desktop,
    openProjectFolder: desktop,
    createSession: async (projectId = null) => {
      try {
        if (projectId !== null) requireProject(state, projectId);
      } catch (error) {
        return { ok: false, error: (error as Error).message };
      }
      const existing = findEmptySession(state.sessions, projectId);
      if (existing) return ok(existing.id);
      const now = new Date().toISOString();
      const s: Session = {
        id: crypto.randomUUID(),
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
      state.sessions.unshift(s);
      save();
      return ok(s.id);
    },
    updateSession: async (id, patch) => {
      const s = state.sessions.find((s) => s.id === id);
      if (s) {
        Object.assign(s, patch);
      }
      save();
      return ok(null);
    },
    deleteSession: async (id) => {
      const session = state.sessions.find((s) => s.id === id);
      if (!session) return { ok: false, error: "Сессия не найдена" };
      if (!session.archived)
        return {
          ok: false,
          error: "Удалить навсегда можно только сессию из архива",
        };
      if (isRunning(session))
        return { ok: false, error: "Остановите агента перед удалением сессии" };
      const previous = state.sessions;
      state.sessions = previous.filter((s) => s.id !== id);
      try {
        save();
        return ok(structuredClone(state));
      } catch (error) {
        state.sessions = previous;
        return { ok: false, error: (error as Error).message };
      }
    },
    send: desktop,
    updateQueuedInput: async (id, messageId, content) => {
      const input = state.sessions
        .find((s) => s.id === id)
        ?.queuedInputs?.find((m) => m.id === messageId);
      if (!input)
        return {
          ok: false,
          error: "Сообщение уже отправлено или удалено из очереди",
        };
      if (
        content.length > 100000 ||
        (!content.trim() && !input.attachments?.length)
      )
        return { ok: false, error: "Введите сообщение или добавьте вложение" };
      input.content = content.trim();
      save();
      return ok(null);
    },
    removeQueuedInput: async (id, messageId) => {
      const session = state.sessions.find((s) => s.id === id);
      if (!session?.queuedInputs?.some((m) => m.id === messageId))
        return {
          ok: false,
          error: "Сообщение уже отправлено или удалено из очереди",
        };
      session.queuedInputs = session.queuedInputs.filter(
        (m) => m.id !== messageId,
      );
      save();
      return ok(null);
    },
    resumeQueue: desktop,
    steerQueuedInput: desktop,
    chooseAttachments: desktop,
    pasteAttachment: desktop,
    importAttachment: desktop,
    attachmentPreview: desktop,
    draftAttachments: desktop,
    approveTool: desktop,
    stopAgent: desktop,
    answerQuestion: desktop,
    branch: desktop,
    exportSession: desktop,
    inspectGithub: desktop,
    installGithub: desktop,
    saveConnector: async (input) => {
      if (input.bearerToken || input.env) return desktop();
      const old = state.connectors.find((c) => c.id === input.id);
      const connector = {
        ...input,
        id: old?.id || crypto.randomUUID(),
        auth: input.auth || ("none" as const),
        envKeys: [],
        enabled: false,
        status: "disconnected" as const,
        toolCount: 0,
        hasSecret: false,
      };
      state.connectors = state.connectors
        .filter((c) => c.id !== connector.id)
        .concat(connector);
      save();
      return ok(connector);
    },
    connectConnector: desktop,
    reopenConnectorAuthorization: desktop,
    disconnectConnector: desktop,
    removeConnector: async (id) => {
      state.connectors = state.connectors.filter((c) => c.id !== id);
      save();
      return ok(null);
    },
    retry: desktop,
    stop: async () => ok(null),
    listFiles: desktop,
    readFile: desktop,
    getModels: desktop,
    addModel: (baseUrl, input) =>
      changeModels(() => models.add(baseUrl, input)),
    removeModel: (baseUrl, id) =>
      changeModels(() => models.remove(baseUrl, id)),
    setDefaultModel: (baseUrl, id) =>
      changeModels(() => models.selectDefault(baseUrl, id)),
    importSkill: desktop,
    discoverSkills: desktop,
    saveSkill: async (input) => {
      // Local preview editing only; file imports and model requests still require Electron.
      try {
        const match = input.source
          .replace(/\r\n/g, "\n")
          .match(/^---\n([\s\S]*?)\n---(?:\n|$)/);
        const meta = match ? parse(match[1]) : {};
        if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(meta?.name || ""))
          throw new Error(
            "name: используйте строчные латинские буквы, цифры и дефисы",
          );
        const old = state.skills.find((s) => s.id === input.id),
          projectId = old ? (old.projectId ?? null) : (input.projectId ?? null);
        if (
          state.skills.some(
            (s) =>
              s.name === meta.name &&
              (!s.projectId || !projectId || s.projectId === projectId) &&
              s.id !== input.id,
          )
        )
          throw new Error("Скилл с таким именем уже существует");
        const body = input.source.slice(match?.[0].length || 0).trim();
        if (!body) throw new Error("Добавьте инструкции после блока YAML");
        const links = [
          ...body.matchAll(/\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g),
        ]
          .map((m) => m[1])
          .filter(
            (link) => !/^https?:\/\//i.test(link) && !link.startsWith("#"),
          )
          .map((link) => decodeURIComponent(link.split("#")[0]));
        const references = links
          .filter((link) => /\.(md|txt|json|yaml|yml|csv)$/i.test(link))
          .map((link) => {
            const ref = old?.references.find((r) => r.path === link);
            if (!ref)
              throw new Error(
                "Для нового файла справки импортируйте SKILL.md в настольном приложении",
              );
            return ref;
          });
        const skill = {
          id: old?.id || crypto.randomUUID(),
          name: meta.name,
          description: String(meta.description || "").trim(),
          source: input.source,
          body,
          argumentHint: String(meta["argument-hint"] || ""),
          manualOnly: meta["disable-model-invocation"] === true,
          userInvocable: meta["user-invocable"] !== false,
          unsupported:
            meta.context === "fork" ||
            meta.agent ||
            meta["allowed-tools"] ||
            /!`/.test(body) ||
            links.some((link) => !/\.(md|txt|json|yaml|yml|csv)$/i.test(link))
              ? ["инструменты и агенты"]
              : [],
          projectId,
          updatedAt: new Date().toISOString(),
          references,
        };
        state.skills = state.skills
          .filter((s) => s.id !== skill.id)
          .concat(skill);
        save();
        return ok(skill.id);
      } catch (error) {
        return { ok: false, error: (error as Error).message };
      }
    },
    deleteSkill: async (id) => {
      state.skills = state.skills.filter((s) => s.id !== id);
      state.projects.forEach((p) => {
        p.skillIds = p.skillIds?.filter((v) => v !== id);
      });
      save();
      return ok(null);
    },
    assignSkill: async (projectId, skillId, enabled) => {
      const project = state.projects.find((p) => p.id === projectId);
      if (!project) return { ok: false, error: "Проект не найден" };
      project.skillIds = [
        ...new Set(
          (project.skillIds || [])
            .filter((id) => id !== skillId)
            .concat(enabled ? [skillId] : []),
        ),
      ];
      save();
      return ok(null);
    },
    windowAction: async () => ok(null),
    copyText: async (text) => {
      await navigator.clipboard.writeText(text);
      return ok(null);
    },
    saveSettings: async (input) => {
      if (input.key) return desktop();
      const { key, clearKey, ...settings } = input;
      try {
        if ("theme" in settings) settings.theme = validateTheme(settings.theme);
        if ("approvalModel" in settings)
          models.selectApproval(
            state.settings.baseUrl,
            settings.approvalModel!,
          );
      } catch (error) {
        return { ok: false, error: (error as Error).message };
      }
      if (
        settings.baseUrl &&
        settings.baseUrl.replace(/\/+$/, "") !== state.settings.baseUrl
      ) {
        try {
          const endpoint = new URL(settings.baseUrl);
          if (
            endpoint.protocol !== "https:" ||
            endpoint.username ||
            endpoint.password ||
            endpoint.search ||
            endpoint.hash
          )
            throw new Error();
          models.switchProvider(endpoint.href.replace(/\/+$/, ""));
          settings.baseUrl = state.settings.baseUrl;
          settings.approvalModel = state.settings.approvalModel;
        } catch {
          return { ok: false, error: "Введите корректный адрес API с HTTPS" };
        }
      }
      state.settings = { ...state.settings, ...settings };
      save();
      return ok(structuredClone(state));
    },
    workspace: async () => ({
      ok: false,
      error: "Инструменты проекта доступны в настольном приложении",
    }),
    mcpForm: async () => ({
      ok: false,
      error: "MCP доступен в настольном приложении",
    }),
    onState: (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
}
export const bridge = window.turwe || previewBridge();
export async function unwrap<T>(promise: Promise<Result<T>>): Promise<T> {
  const result = await promise;
  if (!result.ok) throw new Error(result.error);
  return result.value;
}
export const isRunning = hasActiveReply;
export function sessionActivity(
  session: Session,
): "working" | "attention" | null {
  const status = agentStatus(session);
  if (status === "approval" || status === "question") return "attention";
  return isRunning(session) ? "working" : null;
}
