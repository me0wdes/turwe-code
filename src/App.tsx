import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, MotionConfig } from "motion/react";
import {
  PanelLeft,
  Minus,
  Square,
  X,
  Code2,
  ChevronRight,
  Trash2,
} from "./icons";
import type {
  AppState,
  Session,
  Attachment,
  PermissionMode,
  Effort,
} from "./types";
import { bridge, unwrap, isRunning } from "./bridge";
import { commandPressed, isMac } from "./platform";
import { configureSound, unlockSound, playSound } from "./sound";
import { Sidebar } from "./components/Sidebar";
import { SidebarRail } from "./components/SidebarRail";
import { ProjectPicker } from "./components/ProjectPicker";
import { NewSessionScreen } from "./components/NewSessionScreen";
import { UpdateNotice } from "./components/AppUpdates";
import { Composer } from "./components/Composer";
import { Conversation } from "./components/Conversation";
import {
  AddPanelMenu,
  WorkspaceDock,
  useWorkspacePanels,
} from "./components/WorkspaceDock";
import { addPanel, revealPanel, type WorkspaceTool } from "./workspace-panels";
import { createRevealTracker, type RevealEvent } from "./workspace-reveal";
import { WorkspaceStatus } from "./components/WorkspaceStatus";
import { SettingsDialog, type SettingsTab } from "./components/Settings";
import { SearchDialog } from "./components/SearchDialog";
import { IconButton, Modal, Toast } from "./components/Primitives";
import { SkillsPage } from "./components/SkillsPage";
import { ConnectorsPage } from "./components/ConnectorsPage";
import { attachmentKey } from "./components/Attachments";
import {
  AttachmentDropZone,
  useAttachmentDrop,
} from "./components/AttachmentDropZone";
import { attachmentError } from "./attachment-errors";
import { DEFAULT_MODEL } from "./models";
import { agentsIn } from "./agents";
import { AgentActivity } from "./components/AgentActivity";
import { AgentPanel } from "./components/AgentPanel";
import "./agents.css";
import { applyTheme, restoreTheme } from "./themes";

restoreTheme();

export default function App() {
  const [state, setState] = useState<AppState | null>(null),
    [activeId, setActiveId] = useState<string | null>(() =>
      localStorage.getItem("turwe-active-session"),
    ),
    [sidebar, setSidebar] = useState(true),
    [projectPicker, setProjectPicker] = useState<"current" | null>(null),
    [startingSession, setStartingSession] = useState(false),
    [selectedAgentId, setSelectedAgentId] = useState<string | null>(null),
    [settings, setSettings] = useState(false),
    [settingsTab, setSettingsTab] = useState<SettingsTab>("connection"),
    [search, setSearch] = useState(false),
    [rename, setRename] = useState<Session | null>(null),
    [renameText, setRenameText] = useState(""),
    [deleteTarget, setDeleteTarget] = useState<Session | null>(null),
    [deleting, setDeleting] = useState(false),
    [error, setErrorState] = useState(""),
    [toast, setToast] = useState<{
      id: number;
      text: string;
      tone: "success" | "error";
    } | null>(null),
    [page, setPage] = useState<"chat" | "skills" | "connectors">("chat"),
    [drafts, setDrafts] = useState<Record<string, string>>({}),
    [attachments, setAttachments] = useState<Record<string, Attachment[]>>({}),
    [attaching, setAttaching] = useState(false),
    [attachmentProgress, setAttachmentProgress] = useState(""),
    [sending, setSending] = useState(false),
    [projectId, setProjectId] = useState<string | null>(null),
    [model, setModel] = useState(DEFAULT_MODEL),
    [effort, setEffort] = useState<Effort | undefined>(),
    [compactingId, setCompactingId] = useState<string | null>(null),
    [permissionMode, setPermissionMode] = useState<PermissionMode>("auto");
  const notificationId = useRef(0),
    revealTracker = useRef(createRevealTracker()),
    deleteTrigger = useRef<HTMLElement | null>(null),
    attachmentLock = useRef(false),
    projectDialogLock = useRef(false),
    seen = useRef(new Map<string, string>()),
    loaded = useRef(false);
  const notify = useCallback(
    (message: string, tone: "success" | "error" = "success") => {
      setToast({ id: ++notificationId.current, text: message, tone });
    },
    [],
  );
  const dismissToast = useCallback(() => setToast(null), []);
  const setError = useCallback(
    (message: string) => {
      setErrorState(message);
      if (message) notify(message, "error");
    },
    [notify],
  );
  const applyState = useCallback(
    (next: AppState) => {
      revealTracker.current.observe(next.sessions);
      applyTheme(next.settings.theme);
      configureSound(next.settings.sounds, next.settings.volume);
      for (const s of next.sessions) {
        const last = s.messages.at(-1);
        if (!last?.status) continue;
        const previous = seen.current.get(last.id);
        if (loaded.current && previous && previous !== last.status) {
          if (last.status === "complete") {
            playSound("success");
            if (s.id !== localStorage.getItem("turwe-active-session"))
              notify(`Завершено: ${s.title}`);
          }
          if (last.status === "error") {
            playSound("error");
            notify(
              last.error || `Не удалось получить ответ: ${s.title}`,
              "error",
            );
          }
        }
        seen.current.set(last.id, last.status);
      }
      loaded.current = true;
      setState(next);
    },
    [notify],
  );
  useEffect(() => {
    unwrap(bridge.bootstrap())
      .then((next) => {
        applyState(next);
        setActiveId((current) =>
          next.sessions.some((s) => s.id === current && !s.archived)
            ? current
            : null,
        );
        setModel(next.settings.model);
      })
      .catch((e) => setError(e.message));
    const unsubscribe = bridge.onState(applyState);
    const unlock = () => unlockSound();
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    return () => {
      unsubscribe();
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, [applyState]);
  useEffect(() => {
    if (state) setModel(state.settings.model);
  }, [state?.settings.model]);
  useEffect(() => {
    document.documentElement.dataset.motion =
      state?.settings.motion === false ? "off" : "on";
  }, [state?.settings.motion]);
  useEffect(() => {
    if (activeId) localStorage.setItem("turwe-active-session", activeId);
    else localStorage.removeItem("turwe-active-session");
    setError("");
    setSelectedAgentId(null);
  }, [activeId]);
  const session = state?.sessions.find((s) => s.id === activeId),
    draftKey = session?.id || "new",
    draft = drafts[draftKey] ?? session?.draft ?? "",
    selectedProject = state?.projects.find(
      (p) => p.id === (session ? session.projectId : projectId),
    ),
    attached = attachments[draftKey] ?? session?.draftAttachments ?? [],
    running = isRunning(session),
    empty = !session?.messages.length;
  const panelScope =
    session?.worktreePath || selectedProject?.id || "without-project";
  const [panelLayout, updatePanelLayout] = useWorkspacePanels(panelScope);
  const [panelReveals, setPanelReveals] = useState<
    Partial<Record<WorkspaceTool, RevealEvent>>
  >({});
  useEffect(() => {
    if (
      !session ||
      page !== "chat" ||
      selectedAgentId ||
      settings ||
      search ||
      projectPicker ||
      rename ||
      deleteTarget
    )
      return;
    const events = revealTracker.current.take(session.id);
    if (!events.length) return;
    updatePanelLayout((current) =>
      events.reduce(
        (layout, event) => revealPanel(layout, event.panel),
        current,
      ),
    );
    setPanelReveals((current) => ({
      ...current,
      ...Object.fromEntries(events.map((event) => [event.panel, event])),
    }));
  }, [
    session,
    page,
    selectedAgentId,
    settings,
    search,
    projectPicker,
    rename,
    deleteTarget,
    updatePanelLayout,
  ]);
  const openingPanel = useRef(false);
  async function openPanel(tool: WorkspaceTool) {
    if (openingPanel.current) return;
    if (
      !selectedProject &&
      !["files", "preview", "terminal", "plan", "agents", "mcp"].includes(tool)
    ) {
      setProjectPicker("current");
      return;
    }
    openingPanel.current = true;
    try {
      if (!session) {
        const id = await unwrap(bridge.createSession(projectId));
        await unwrap(
          bridge.updateSession(id, {
            draft,
            model,
            permissionMode,
            effort: effort || state?.settings.effort || "auto",
          }),
        );
        if (attached.length)
          await unwrap(bridge.draftAttachments(id, attached));
        applyState(await unwrap(bridge.bootstrap()));
        setActiveId(id);
      }
      setSelectedAgentId(null);
      updatePanelLayout((current) => addPanel(current, tool));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      openingPanel.current = false;
    }
  }
  const fileDrop = useAttachmentDrop({
    enabled:
      !!state &&
      page === "chat" &&
      !settings &&
      !search &&
      !rename &&
      !deleteTarget,
    blocked: session?.archived
      ? "Сначала восстановите чат из архива"
      : attaching
        ? "Дождитесь обработки вложений"
        : sending
          ? "Дождитесь отправки сообщения"
          : "",
    remaining: 8 - attached.length,
    resetKey: draftKey,
    onDrop: (files) => void dropFiles(files),
    onError: setError,
  });
  const selectedAgent =
    session &&
    agentsIn(session.messages).find((agent) => agent.id === selectedAgentId);
  const selectedAgentGroup =
    session?.messages.find((message) =>
      agentsIn([message]).some((agent) => agent.id === selectedAgentId),
    )?.agents || [];
  function openAgent(id: string) {
    setSelectedAgentId(id);
  }
  function openSettings(tab: SettingsTab = "connection") {
    setSettingsTab(tab);
    setSettings(true);
  }
  function changeDraft(value: string) {
    setDrafts((old) => ({ ...old, [draftKey]: value }));
    if (session) {
      void unwrap(bridge.updateSession(session.id, { draft: value })).catch(
        (e) => setError(e.message),
      );
    }
  }
  async function saveAttachments(
    next: Attachment[],
    key = draftKey,
    id = session?.id,
  ) {
    if (id) await unwrap(bridge.draftAttachments(id, next));
    setAttachments((old) => ({ ...old, [key]: next }));
  }
  async function attach(kind: "media" | "files" | "clipboard") {
    if (attachmentLock.current || sending || session?.archived) return;
    attachmentLock.current = true;
    setAttaching(true);
    setAttachmentProgress(
      kind === "clipboard"
        ? "Читаем буфер обмена…"
        : "Подготавливаем выбранные файлы…",
    );
    setError("");
    try {
      const added = await unwrap(
        kind === "clipboard"
          ? bridge.pasteAttachment()
          : bridge.chooseAttachments(kind),
      );
      if (attached.length + added.length > 8)
        throw new Error("Можно добавить до 8 файлов. Уберите лишние вложения.");
      if (added.length) await saveAttachments([...attached, ...added]);
    } catch (e) {
      setError(attachmentError(e));
    } finally {
      attachmentLock.current = false;
      setAttaching(false);
      setAttachmentProgress("");
    }
  }
  async function dropFiles(files: File[]) {
    if (attachmentLock.current || sending || session?.archived || !files.length)
      return;
    if (attached.length + files.length > 8) {
      setError("Можно добавить до 8 файлов");
      return;
    }
    attachmentLock.current = true;
    setAttaching(true);
    setError("");
    const added: Attachment[] = [];
    const failures: string[] = [];
    try {
      for (const file of files) {
        setAttachmentProgress(`Подготавливаем ${file.name}…`);
        try {
          if (file.size > 100 * 1024 * 1024)
            throw new Error(`${file.name}: файл больше 100 МБ`);
          const data = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result).split(",")[1]);
            reader.onerror = () =>
              reject(new Error("Не удалось прочитать файл"));
            reader.readAsDataURL(file);
          });
          added.push(
            await unwrap(bridge.importAttachment({ name: file.name, data })),
          );
        } catch (e) {
          failures.push(attachmentError(e, file.name));
        }
      }
      if (added.length) await saveAttachments([...attached, ...added]);
      if (failures.length) setError(failures.join("\n"));
    } catch (e) {
      setError(attachmentError(e));
    } finally {
      attachmentLock.current = false;
      setAttaching(false);
      setAttachmentProgress("");
    }
  }
  async function branchSession(messageId: string, content?: string) {
    if (!session) return;
    try {
      const id = await unwrap(bridge.branch(session.id, messageId, content));
      applyState(await unwrap(bridge.bootstrap()));
      setActiveId(id);
      notify("Продолжение открыто в новой ветке. Исходный чат сохранён.");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function select(id: string) {
    setPage("chat");
    setActiveId(id);
  }
  async function newSession(id?: string | null) {
    if (attaching || sending) return;
    setProjectId(id || null);
    setActiveId(null);
    setSelectedAgentId(null);
    setPage("chat");
    setProjectPicker(null);
  }
  async function assignProject(id: string | null) {
    if (session?.messages.length) {
      await newSession(id);
      return;
    }
    try {
      if (session)
        await unwrap(bridge.updateSession(session.id, { projectId: id }));
      setProjectId(id);
      await saveAttachments(attached.filter((f) => !!f.id));
      applyState(await unwrap(bridge.bootstrap()));
      setProjectPicker(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function chooseProject() {
    if (sending || attaching || projectDialogLock.current) return;
    projectDialogLock.current = true;
    setStartingSession(true);
    try {
      const project = await unwrap(bridge.chooseProject());
      if (project) {
        await assignProject(project.id);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      projectDialogLock.current = false;
      setStartingSession(false);
    }
  }
  async function send() {
    if (
      !state ||
      sending ||
      (session && compactingId === session.id) ||
      attaching ||
      (!draft.trim() && !attached.length)
    )
      return;
    if (!state.models.length) {
      openSettings("models");
      return;
    }
    setSending(true);
    setError("");
    try {
      let id = session?.id;
      if (!id) {
        id = await unwrap(bridge.createSession(projectId));
        await unwrap(
          bridge.updateSession(id, {
            model,
            draft,
            permissionMode,
            effort: effort || state.settings.effort || "auto",
          }),
        );
        setActiveId(id);
        setDrafts((old) => ({ ...old, [id!]: draft }));
        setAttachments((old) => ({ ...old, [id!]: attached }));
      }
      await unwrap(bridge.send(id, draft, attached));
      setDrafts((old) => ({
        ...old,
        [draftKey]: old[draftKey] === draft ? "" : (old[draftKey] ?? ""),
        [id!]: old[id!] === draft ? "" : (old[id!] ?? ""),
      }));
      setAttachments((old) => ({ ...old, [draftKey]: [], [id!]: [] }));
      playSound("soft");
      applyState(await unwrap(bridge.bootstrap()));
    } catch (e) {
      setError((e as Error).message);
      if (!state.hasKey) openSettings();
    } finally {
      setSending(false);
    }
  }
  async function stop() {
    if (session)
      try {
        await unwrap(bridge.stop(session.id));
      } catch (e) {
        setError((e as Error).message);
      }
  }
  async function compact() {
    if (!session || compactingId || running) return;
    setCompactingId(session.id);
    try {
      const result = await unwrap(bridge.workspace(session.id, "compact"));
      notify(
        result?.compacted
          ? "Контекст сжат. История чата сохранена."
          : "Пока нет истории для сжатия.",
      );
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setCompactingId(null);
    }
  }
  async function retry() {
    if (session)
      try {
        await unwrap(bridge.retry(session.id));
      } catch (e) {
        setError((e as Error).message);
      }
  }
  async function archive(s: Session) {
    try {
      await unwrap(bridge.updateSession(s.id, { archived: !s.archived }));
      const next = await unwrap(bridge.bootstrap());
      applyState(next);
      if (s.id === activeId && !s.archived)
        setActiveId(next.sessions.find((item) => !item.archived)?.id || null);
      notify(s.archived ? "Сессия восстановлена" : "Сессия в архиве");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function deleteArchivedSession() {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    try {
      const id = deleteTarget.id;
      const next = await unwrap(bridge.deleteSession(id));
      applyState(next);
      setActiveId((current) =>
        current === id
          ? next.sessions.find((s) => s.archived)?.id ||
            next.sessions[0]?.id ||
            null
          : current,
      );
      setDrafts((old) => {
        const next = { ...old };
        delete next[id];
        return next;
      });
      setAttachments((old) => {
        const next = { ...old };
        delete next[id];
        return next;
      });
      setDeleteTarget(null);
      notify("Сессия удалена навсегда");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setDeleting(false);
    }
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (deleteTarget) return;
      if (commandPressed(e, state?.platform) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearch(true);
      }
      if (commandPressed(e, state?.platform) && e.key.toLowerCase() === "n") {
        e.preventDefault();
        void newSession();
      }
      if (
        e.key === "Escape" &&
        !settings &&
        !search &&
        !rename &&
        !projectPicker &&
        running
      ) {
        e.preventDefault();
        void stop();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  if (!state)
    return (
      <div className="loading-screen">
        <Code2 size={24} />
        <p>{error || "Открываем рабочее пространство…"}</p>
      </div>
    );
  return (
    <MotionConfig reducedMotion={state.settings.motion ? "user" : "always"}>
      <div
        className={`app ${!state.settings.motion ? "reduce-motion" : ""}`}
        data-platform={state.platform}
        onPointerDown={() => unlockSound()}
      >
        <header className="titlebar">
          <div className="window-brand">
            <img
              className="window-logo"
              src="./turwe-logo.svg"
              alt="Turwe"
              width="93"
              height="32"
              draggable={false}
            />
            <IconButton
              label={
                sidebar ? "Скрыть боковую панель" : "Показать боковую панель"
              }
              onClick={() => setSidebar((v) => !v)}
              aria-pressed={sidebar}
              aria-expanded={sidebar}
              aria-controls="navigation-sidebar"
            >
              <PanelLeft size={18} active={sidebar} />
            </IconButton>
          </div>
          {!isMac(state.platform) && (
            <div className="window-controls">
              <button
                aria-label="Свернуть окно"
                onClick={() => void bridge.windowAction("minimize")}
              >
                <Minus size={14} />
              </button>
              <button
                aria-label="Развернуть окно"
                onClick={() => void bridge.windowAction("maximize")}
              >
                <Square size={11} />
              </button>
              <button
                aria-label="Закрыть окно"
                className="window-close"
                onClick={() => void bridge.windowAction("close")}
              >
                <X size={16} />
              </button>
            </div>
          )}
        </header>
        <div className="app-body">
          <SidebarRail open={sidebar} motionEnabled={state.settings.motion}>
            <Sidebar
              state={state}
              activeId={activeId}
              onSelect={(id) => void select(id)}
              onNew={(id) => void newSession(id)}
              onProject={() => void chooseProject()}
              onSearch={() => setSearch(true)}
              onSettings={() => openSettings()}
              skillsOpen={page === "skills"}
              connectorsOpen={page === "connectors"}
              onConnectors={() => {
                setPage("connectors");
              }}
              searchOpen={search}
              settingsOpen={settings}
              onSkills={() => {
                setPage("skills");
              }}
              onRename={(s) => {
                setRename(s);
                setRenameText(s.title);
              }}
              onArchive={(s) => void archive(s)}
              onDelete={(s) => {
                deleteTrigger.current = document.activeElement as HTMLElement;
                setDeleteTarget(s);
              }}
            />
          </SidebarRail>
          <main
            className={`workspace ${page === "chat" && empty ? "empty-workspace" : ""}`}
            {...fileDrop.handlers}
          >
            <UpdateNotice update={state.update} onError={setError} />
            {page === "connectors" ? (
              <ConnectorsPage
                state={state}
                onState={applyState}
                notify={notify}
              />
            ) : page === "skills" ? (
              <SkillsPage
                state={state}
                initialProject={selectedProject?.id || null}
                onChooseProject={async () => {
                  const p = await unwrap(bridge.chooseProject());
                  applyState(await unwrap(bridge.bootstrap()));
                  return p?.id || null;
                }}
                notify={notify}
                onState={applyState}
                onUse={async (skill) => {
                  if (
                    skill.projectId &&
                    skill.projectId !== selectedProject?.id
                  ) {
                    const id = await unwrap(
                      bridge.createSession(skill.projectId),
                    );
                    await unwrap(
                      bridge.updateSession(id, { draft: `@${skill.name} ` }),
                    );
                    applyState(await unwrap(bridge.bootstrap()));
                    setActiveId(id);
                  } else
                    changeDraft(
                      `${draft}${draft && !/\s$/.test(draft) ? " " : ""}@${skill.name} `,
                    );
                  setPage("chat");
                  requestAnimationFrame(() =>
                    document
                      .querySelector<HTMLTextAreaElement>(".composer textarea")
                      ?.focus(),
                  );
                }}
              />
            ) : (
              <>
                <div className="workspace-toolbar">
                  <div>
                    {session?.messages.length ? (
                      <>
                        <span>{selectedProject?.name || "Без проекта"}</span>
                        <ChevronRight size={12} />
                        <strong>{session.title}</strong>
                      </>
                    ) : (
                      <span className="workspace-label">Новая сессия</span>
                    )}
                    {session?.archived && (
                      <span className="archive-label">Архив</span>
                    )}
                  </div>
                  <div>
                    <AddPanelMenu
                      layout={panelLayout}
                      onAdd={(tool) => void openPanel(tool)}
                      disabled={sending || attaching}
                    />
                  </div>
                </div>
                {state.warning && (
                  <div className="workspace-warning">{state.warning}</div>
                )}
                {state.platform === "preview" && (
                  <div className="preview-label">Браузерный просмотр</div>
                )}
                {session && (
                  <Conversation
                    key={session.id}
                    session={session}
                    onAgentOpen={openAgent}
                    onRetry={() => void retry()}
                    notify={notify}
                    onError={setError}
                    onBranch={(id, content) => void branchSession(id, content)}
                    onAnswer={async (callId, response) => {
                      await unwrap(
                        bridge.answerQuestion(session.id, callId, response),
                      );
                    }}
                    onApprove={(callId, allowed, remember) => {
                      void unwrap(
                        bridge.approveTool(
                          session.id,
                          callId,
                          allowed,
                          undefined,
                          remember,
                        ),
                      ).catch((e) => setError(e.message));
                    }}
                  />
                )}
                <div
                  className={`composer-region ${empty ? "empty" : ""} ${!session ? "new-session-region" : ""}`}
                >
                  {session && (
                    <AgentActivity
                      motionEnabled={state.settings.motion}
                      key={session.messages.at(-1)?.id}
                      session={session}
                      selectedId={selectedAgentId}
                      onOpen={openAgent}
                      onMain={() => setSelectedAgentId(null)}
                    />
                  )}
                  {session && (
                    <WorkspaceStatus
                      session={session}
                      state={state}
                      onNavigate={(id) => {
                        setActiveId(id);
                        setPage("chat");
                      }}
                      onError={setError}
                    />
                  )}
                  <NewSessionScreen
                    active={!session}
                    projects={state.projects}
                    selectedId={projectId}
                    busy={startingSession || sending || attaching}
                    motionEnabled={
                      state.settings.motion && state.settings.homeAnimation
                    }
                    onSelect={(id) => void assignProject(id)}
                    onBrowse={() => void chooseProject()}
                    onMore={() => setProjectPicker("current")}
                  >
                    <Composer
                      showTitle={!!session}
                      platform={state.platform}
                      motionEnabled={
                        state.settings.motion && state.settings.homeAnimation
                      }
                      value={draft}
                      onChange={changeDraft}
                      onSend={() => void send()}
                      onStop={() => void stop()}
                      running={running}
                      sending={sending || compactingId === session?.id}
                      attaching={attaching}
                      attachmentProgress={attachmentProgress}
                      onAttach={(kind) => void attach(kind)}
                      onDropFiles={(files) => void dropFiles(files)}
                      model={session?.model || model}
                      effort={
                        (session ? session.effort : effort) ||
                        state.settings.effort ||
                        "auto"
                      }
                      onEffort={(value) => {
                        if (session)
                          void unwrap(
                            bridge.updateSession(session.id, { effort: value }),
                          ).catch((error) => setError(error.message));
                        else setEffort(value);
                      }}
                      contextFill={session?.contextFill}
                      onCompact={() => void compact()}
                      compacting={compactingId === session?.id}
                      compactDisabled={!session?.messages.length}
                      sessionId={session?.id}
                      queuedMessages={session?.queuedInputs || []}
                      onEditQueued={async (id, content) => {
                        if (session)
                          await unwrap(
                            bridge.updateQueuedInput(session.id, id, content),
                          );
                      }}
                      onRemoveQueued={async (id) => {
                        if (session)
                          await unwrap(
                            bridge.removeQueuedInput(session.id, id),
                          );
                      }}
                      onSteerQueued={async (id) => {
                        if (session)
                          await unwrap(bridge.steerQueuedInput(session.id, id));
                      }}
                      onResumeQueue={async () => {
                        if (session)
                          await unwrap(bridge.resumeQueue(session.id));
                      }}
                      onError={setError}
                      permissionMode={session?.permissionMode || permissionMode}
                      onPermissionMode={(value) => {
                        if (session)
                          void unwrap(
                            bridge.updateSession(session.id, {
                              permissionMode: value,
                            }),
                          ).catch((e) => setError(e.message));
                        else setPermissionMode(value);
                      }}
                      models={state.models}
                      onManageModels={() => openSettings("models")}
                      onModel={(value) => {
                        if (session)
                          void unwrap(
                            bridge.updateSession(session.id, { model: value }),
                          ).catch((e) => setError(e.message));
                        else setModel(value);
                      }}
                      project={selectedProject}
                      projects={state.projects}
                      onProject={(id) => {
                        if (id) void assignProject(id);
                      }}
                      onChooseProject={() => void chooseProject()}
                      onSkills={() => {
                        setPage("skills");
                      }}
                      skills={state.skills}
                      attachments={attached}
                      onRemove={(key) => {
                        void saveAttachments(
                          attached.filter((f) => attachmentKey(f) !== key),
                        ).catch((e) => setError(e.message));
                      }}
                      empty={empty}
                      disabled={session?.archived}
                    />
                  </NewSessionScreen>
                  {session?.archived && (
                    <button
                      className="restore-button"
                      onClick={() => void archive(session)}
                    >
                      Восстановить сессию, чтобы продолжить
                    </button>
                  )}
                </div>
              </>
            )}
            <AttachmentDropZone
              state={fileDrop.state}
              motionEnabled={state.settings.motion}
            />
            <Toast
              text={toast?.text || ""}
              id={toast?.id || 0}
              tone={toast?.tone}
              motionEnabled={state.settings.motion}
              onClose={dismissToast}
            />
          </main>
          <AnimatePresence initial={false} mode="wait">
            {selectedAgent && session && page === "chat" ? (
              <AgentPanel
                onError={setError}
                motionEnabled={state.settings.motion}
                key={selectedAgent.id}
                agent={selectedAgent}
                group={selectedAgentGroup}
                onClose={() => setSelectedAgentId(null)}
                onOpen={openAgent}
                onStop={async () => {
                  await unwrap(bridge.stopAgent(session.id, selectedAgent.id));
                }}
                onApprove={(callId, allowed, remember) => {
                  void unwrap(
                    bridge.approveTool(
                      session.id,
                      callId,
                      allowed,
                      selectedAgent.id,
                      remember,
                    ),
                  ).catch((e) => setError(e.message));
                }}
                onAnswer={async (callId, response) => {
                  await unwrap(
                    bridge.answerQuestion(
                      session.id,
                      callId,
                      response,
                      selectedAgent.id,
                    ),
                  );
                }}
                onCopy={(text) => {
                  void unwrap(bridge.copyText(text))
                    .then(() => notify("Скопировано"))
                    .catch((e) => setError(e.message));
                }}
              />
            ) : null}
          </AnimatePresence>
          <AnimatePresence key={(session?.id || "new") + ":" + panelScope}>
          {session && panelLayout.panels.length > 0 && (
            <WorkspaceDock
              key={session.id + ":" + panelScope}
              state={state}
              session={session}
              layout={panelLayout}
              reveals={panelReveals}
              onLayout={updatePanelLayout}
              onAdd={(tool) => void openPanel(tool)}
              suspended={page !== "chat" || !!selectedAgent}
              hidden={
                settings ||
                search ||
                !!rename ||
                !!deleteTarget ||
                !!projectPicker
              }
              onError={setError}
              onComment={(content) =>
                void unwrap(bridge.send(session.id, content, [])).catch((e) =>
                  setError(e.message),
                )
              }
            />
          )}
          </AnimatePresence>
        </div>
        <ProjectPicker
          open={!!projectPicker}
          projects={state.projects}
          busy={startingSession}
          onClose={() => setProjectPicker(null)}
          onSelect={(id) => void assignProject(id)}
          onBrowse={() => void chooseProject()}
        />
        {settings && (
          <SettingsDialog
            key="settings"
            state={state}
            open
            onClose={() => setSettings(false)}
            initialTab={settingsTab}
            onState={applyState}
            notify={notify}
          />
        )}{" "}
        {search && (
          <SearchDialog
            state={state}
            open
            onClose={() => setSearch(false)}
            onSelect={(id) => void select(id)}
          />
        )}
        <Modal
          open={!!rename}
          onOpenChange={(value) => {
            if (!value) setRename(null);
          }}
          title="Название сессии"
          className="rename-dialog"
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (rename)
                void unwrap(
                  bridge.updateSession(rename.id, { title: renameText }),
                )
                  .then(() => setRename(null))
                  .catch((e) => setError(e.message));
            }}
          >
            <input
              aria-label="Название сессии"
              autoFocus
              maxLength={200}
              value={renameText}
              onChange={(e) => setRenameText(e.target.value)}
            />
            <div className="dialog-footer">
              <button
                type="button"
                className="secondary-button"
                onClick={() => setRename(null)}
              >
                Отмена
              </button>
              <button className="primary-button" disabled={!renameText.trim()}>
                Сохранить
              </button>
            </div>
          </form>
        </Modal>
        <Modal
          open={!!deleteTarget}
          onOpenChange={(open) => {
            if (!open && !deleting) setDeleteTarget(null);
          }}
          title="Удалить сессию навсегда?"
          description={`История и черновик «${deleteTarget?.title || ""}» будут удалены. Восстановить сессию не получится.`}
          className="delete-session-dialog"
          returnFocus={() =>
            deleteTrigger.current?.isConnected
              ? deleteTrigger.current
              : document.querySelector<HTMLElement>(
                  ".session-row.selected .session-main, .composer textarea:not(:disabled), .sidebar-caption button",
                )
          }
        >
          <div className="dialog-footer">
            <button
              className="secondary-button"
              autoFocus
              disabled={deleting}
              onClick={() => setDeleteTarget(null)}
            >
              Отмена
            </button>
            <button
              className="primary-button destructive-button"
              disabled={deleting}
              onClick={() => void deleteArchivedSession()}
            >
              <Trash2 size={15} />
              {deleting ? "Удаляем…" : "Удалить навсегда"}
            </button>
          </div>
        </Modal>
      </div>
    </MotionConfig>
  );
}
