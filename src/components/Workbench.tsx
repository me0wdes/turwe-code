import { useEffect, useRef, useState, type ReactNode } from "react";
import { bridge, unwrap } from "../bridge";
import type { AppState, Session } from "../types";
import {
  Code2,
  FileCode2,
  Folder,
  Search,
  Check,
  X,
  RefreshCw,
  RotateCcw,
  MessageSquare,
  Plus,
  Trash2,
  Eye,
  ExternalLink,
} from "../icons";
import { Dropdown, Menu, MenuChoice } from "./Dropdown";
import { IconButton } from "./Primitives";
import { CodeEditor } from "./CodeEditor";
import { BrowserPanel } from "./BrowserPanel";
import { WorkspaceTerminal } from "./WorkspaceTerminal";
import "../workbench.css";
import { fileManagerLabel } from "../platform";
import { panelName, type WorkspaceTool } from "../workspace-panels";
import type { RevealEvent } from "../workspace-reveal";
type EditorFile = { path: string; content: string; hash: string };
const editorDrafts = new Map<
  string,
  { opened: EditorFile | null; text: string }
>();
function Choice({
  value,
  onChange,
  values,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  values: readonly (readonly [string, string])[];
  label: string;
}) {
  return (
    <Dropdown
      label={label}
      trigger={values.find((v) => v[0] === value)?.[1] || value || "Выберите"}
    >
      <Menu.RadioGroup value={value} onValueChange={onChange}>
        {values.map((v) => (
          <MenuChoice key={v[0]} value={v[0]}>
            {v[1]}
          </MenuChoice>
        ))}
      </Menu.RadioGroup>
    </Dropdown>
  );
}
export function Workbench({
  state,
  session,
  tab,
  title,
  panelControls,
  layoutKey,
  reveal,
  onClose,
  onError,
  onComment,
  hidden = false,
}: {
  state: AppState;
  session: Session;
  tab: WorkspaceTool;
  title: ReactNode;
  panelControls: ReactNode;
  layoutKey: string;
  reveal?: RevealEvent;
  onClose: () => void;
  onError: (e: string) => void;
  onComment: (text: string) => void;
  hidden?: boolean;
}) {
  const draftKey =
    session.id + ":" + (session.worktreePath || session.projectId || "");
  const [data, setData] = useState<any>(null),
    [busy, setBusy] = useState(false),
    [revision, setRevision] = useState(0);
  const [pattern, setPattern] = useState(""),
    [entries, setEntries] = useState<string[]>([]),
    [opened, setOpened] = useState<EditorFile | null>(
      () => editorDrafts.get(draftKey)?.opened || null,
    ),
    [text, setText] = useState(() => editorDrafts.get(draftKey)?.text || ""),
    [saved, setSaved] = useState(false),
    [searchText, setSearchText] = useState(""),
    [searchResult, setSearchResult] = useState<any[]>([]),
    [diagnostics, setDiagnostics] = useState("");
  useEffect(() => {
    if (tab === "files") editorDrafts.set(draftKey, { opened, text });
  }, [draftKey, tab, opened, text]);
  const [selectedChange, setSelectedChange] = useState(""),
    [comment, setComment] = useState(""),
    [line, setLine] = useState("1"),
    [restoreId, setRestoreId] = useState("");
  const [memory, setMemory] = useState(""),
    [rules, setRules] = useState<
      { tool: string; pattern: string; action: string }[]
    >([]),
    [serverText, setServerText] = useState("[]");
  const [git, setGit] = useState<any>(null),
    [gitOutput, setGitOutput] = useState(""),
    [commit, setCommit] = useState(""),
    [paths, setPaths] = useState(""),
    [prTitle, setPrTitle] = useState(""),
    [prBody, setPrBody] = useState("");
  const [profileId, setProfileId] = useState(""),
    [profileName, setProfileName] = useState(""),
    [profilePrompt, setProfilePrompt] = useState(""),
    [profileTools, setProfileTools] = useState(""),
    [profileMemory, setProfileMemory] = useState("");
  const [connector, setConnector] = useState(""),
    [resourceOutput, setResourceOutput] = useState<any>(null),
    [uri, setUri] = useState(""),
    [promptName, setPromptName] = useState(""),
    [promptArgs, setPromptArgs] = useState("{}");
  const call = async (op: string, args: Record<string, unknown> = {}) => {
    setBusy(true);
    try {
      const value = await unwrap(bridge.workspace(session.id, op, args));
      return value;
    } catch (e) {
      onError((e as Error).message);
      return undefined;
    } finally {
      setBusy(false);
    }
  };
  const refresh = () => setRevision((v) => v + 1);
  useEffect(() => {
    let live = true;
    void unwrap(bridge.workspace(session.id, "state"))
      .then((v) => {
        if (live) {
          setData(v);
          setMemory(v.project?.memory || "");
          setRules(v.project?.permissionRules || []);
        }
      })
      .catch((e) => onError(e.message));
    return () => {
      live = false;
    };
  }, [session.id, tab, revision, reveal?.id]);
  useEffect(() => {
    if (tab !== "files" || !session.projectId) return;
    let live = true;
    void unwrap(bridge.workspace(session.id, "glob", { pattern: "**/*" }))
      .then((v) => {
        if (live) setEntries(v.files);
      })
      .catch((e) => onError(e.message));
    return () => {
      live = false;
    };
  }, [session.id, tab, revision, reveal?.id]);
  useEffect(
    () =>
      setServerText(JSON.stringify(state.settings.lspServers || [], null, 2)),
    [state.settings.lspServers],
  );
  const open = async (path: string) => {
    if (opened && text !== opened.content) {
      onError("Сохраните изменения открытого файла перед переключением.");
      return;
    }
    const file = await call("read", { path, limit: 4000 });
    if (file) {
      if (file.truncated) {
        onError(
          "Этот файл длиннее 4000 строк. Для правок используйте инструменты агента.",
        );
        return;
      }
      setOpened(file);
      setText(file.content);
      setSaved(false);
      setDiagnostics("");
    }
  };
  const dirty = opened && text !== opened.content;
  useEffect(() => {
    if (!reveal?.path) return;
    if (tab === "changes") setSelectedChange(reveal.path);
    if (tab === "files") void open(reveal.path);
  }, [reveal?.id]);
  const change =
    (data?.changes || []).find((c: any) => c.path === selectedChange) ||
    (data?.changes || [])[0];
  const gitAction = async (args: Record<string, unknown>) => {
    const value = await call("git", args);
    if (value) {
      if (args.operation === "status") setGit(value);
      else
        setGitOutput(
          typeof value === "string" ? value : JSON.stringify(value, null, 2),
        );
      refresh();
    }
  };
  function loadProfile(id: string) {
    setProfileId(id);
    const p = state.agentProfiles?.find((p) => p.id === id);
    setProfileName(p?.name || "");
    setProfilePrompt(p?.prompt || "");
    setProfileTools(p?.allowedTools.join(", ") || "");
    setProfileMemory(p?.memory || "");
  }
  return (
    <section
      className={`workbench ${tab === "preview" ? "browser-workbench" : ""}`}
      aria-label={panelName(tab)}
    >
      <div className="workbench-heading">
        {title}
        <span className="workbench-actions">
          {tab !== "preview" && (
            <IconButton label={`Обновить: ${panelName(tab)}`} onClick={refresh}>
              <RefreshCw size={15} />
            </IconButton>
          )}
          {panelControls}
          <IconButton label={`Закрыть: ${panelName(tab)}`} onClick={onClose}>
            <X size={16} />
          </IconButton>
        </span>
      </div>
      {tab === "files" && session.projectId && (
        <div className="panel-folder-action">
          <button
            className="quiet-control open-project-folder"
            onClick={() => {
              void unwrap(bridge.openProjectFolder(session.projectId!)).catch(
                (e) => onError(e.message),
              );
            }}
          >
            <ExternalLink size={15} />
            <span>{fileManagerLabel(state.platform)}</span>
          </button>
        </div>
      )}
      {session.worktreePath && (
        <div className="worktree-label" title={session.worktreePath}>
          <Folder size={13} />
          Изолированная рабочая копия
        </div>
      )}
      {!session.projectId &&
      !["agents", "mcp", "plan", "preview", "terminal"].includes(tab) ? (
        <div className="workbench-empty">
          <Folder size={28} />
          <p>Выберите проект для работы с кодом</p>
          <span>Создайте чат с папкой проекта через поле ввода.</span>
        </div>
      ) : (
        <div className={"workbench-content tab-" + tab}>
          {tab === "files" && (
            <>
              <form
                className="side-chat-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  void call("grep", {
                    pattern: searchText,
                    literal: true,
                  }).then((v) => v && setSearchResult(v.matches));
                }}
              >
                <input
                  placeholder="Поиск по содержимому"
                  value={searchText}
                  onChange={(e) => setSearchText(e.target.value)}
                />
                <button className="quiet-control" disabled={!searchText}>
                  <Search size={15} />
                </button>
              </form>
              {!!searchResult.length && (
                <div className="search-code-results">
                  {searchResult.map((r, i) => (
                    <button key={i} onClick={() => void open(r.path)}>
                      {r.path}:{r.line}
                      <span>{r.text.slice(0, 150)}</span>
                    </button>
                  ))}
                </div>
              )}
              <input
                className="file-filter"
                placeholder="Найти файл по пути"
                value={pattern}
                onChange={(e) => setPattern(e.target.value)}
              />
              <div
                className={"workspace-file-list " + (opened ? "collapsed" : "")}
              >
                {entries
                  .filter((p) =>
                    p.toLowerCase().includes(pattern.toLowerCase()),
                  )
                  .slice(0, 200)
                  .map((p) => (
                    <button
                      key={p}
                      className={opened?.path === p ? "active" : ""}
                      onClick={() => {
                        if (dirty) {
                          onError(
                            "Сохраните изменения открытого файла перед переключением.",
                          );
                          return;
                        }
                        void open(p);
                      }}
                    >
                      <FileCode2 size={14} />
                      <span>{p}</span>
                    </button>
                  ))}
              </div>
              {opened && (
                <>
                  <div className="editor-toolbar">
                    <span title={opened.path}>{opened.path}</span>
                    <button
                      className="secondary-button"
                      disabled={busy || !dirty}
                      onClick={() =>
                        void call("write", {
                          path: opened.path,
                          content: text,
                          expectedHash: opened.hash,
                        }).then((v) => {
                          if (v) {
                            setOpened({
                              ...opened,
                              content: text,
                              hash: v.hash,
                            });
                            setSaved(true);
                          }
                        })
                      }
                    >
                      <Check size={14} />
                      {saved && !dirty ? "Сохранено" : "Сохранить"}
                    </button>
                  </div>
                  <CodeEditor
                    key={opened.path + opened.hash}
                    path={opened.path}
                    value={text}
                    onChange={(v) => {
                      setText(v);
                      setSaved(false);
                    }}
                  />
                  <div className="workbench-actions">
                    <button
                      className="quiet-control"
                      onClick={() =>
                        void call("lsp", {
                          operation: "diagnostics",
                          path: opened.path,
                        }).then(
                          (v) =>
                            v && setDiagnostics(JSON.stringify(v, null, 2)),
                        )
                      }
                    >
                      <Code2 size={14} />
                      Диагностика LSP
                    </button>
                    <button
                      className="quiet-control"
                      onClick={() =>
                        void call("lsp", {
                          operation: "symbols",
                          path: opened.path,
                        }).then(
                          (v) =>
                            v && setDiagnostics(JSON.stringify(v, null, 2)),
                        )
                      }
                    >
                      Символы файла
                    </button>
                  </div>
                  {diagnostics && (
                    <pre className="process-output compact">{diagnostics}</pre>
                  )}
                </>
              )}
            </>
          )}
          {tab === "terminal" && (
            <WorkspaceTerminal
              session={session}
              state={state}
              reveal={reveal}
              onError={onError}
            />
          )}
          {tab === "changes" && (
            <>
              {!(data?.changes || []).length ? (
                <div className="workbench-empty">
                  <Check size={24} />
                  <p>Изменений инструментами Turwe пока нет</p>
                  <span>Правки командной строки смотрите в Git diff.</span>
                </div>
              ) : (
                <>
                  <Choice
                    label="Изменённый файл"
                    value={change?.path || ""}
                    onChange={setSelectedChange}
                    values={(data.changes || []).map((c: any) => [
                      c.path,
                      c.path,
                    ])}
                  />
                  <pre className="diff-view">
                    {change?.patch.split("\n").map((l: string, i: number) => (
                      <span
                        key={i}
                        className={
                          l.startsWith("+")
                            ? "added"
                            : l.startsWith("-")
                              ? "removed"
                              : l.startsWith("@@")
                                ? "hunk"
                                : ""
                        }
                      >
                        {l}
                        {"\n"}
                      </span>
                    ))}
                  </pre>
                  <form
                    className="diff-comment"
                    onSubmit={(e) => {
                      e.preventDefault();
                      onComment(
                        `Комментарий к ${change.path}:${line}: ${comment}`,
                      );
                      setComment("");
                    }}
                  >
                    <input
                      aria-label="Строка комментария"
                      type="number"
                      min="1"
                      value={line}
                      onChange={(e) => setLine(e.target.value)}
                    />
                    <input
                      value={comment}
                      onChange={(e) => setComment(e.target.value)}
                      placeholder="Комментарий к строке для агента"
                    />
                    <button
                      className="quiet-control"
                      disabled={!comment.trim()}
                    >
                      <MessageSquare size={15} />
                    </button>
                  </form>
                  <button
                    className="secondary-button"
                    onClick={() => void call("review")}
                  >
                    <Eye size={14} />
                    Проверить отдельным агентом
                  </button>
                </>
              )}
              <div className="workbench-section">
                <h3>Контрольные точки</h3>
                <p className="field-hint">
                  Откат возвращает правки файлов с выбранного момента. История
                  чата и действия shell сохраняются.
                </p>
                <Choice
                  label="Контрольная точка"
                  value={restoreId}
                  onChange={setRestoreId}
                  values={(data?.checkpoints || [])
                    .filter((p: any) => !p.restored)
                    .slice(-30)
                    .reverse()
                    .map((p: any) => [
                      p.id,
                      `${p.path} · ${new Date(p.createdAt).toLocaleTimeString()}`,
                    ])}
                />
                {restoreId && (
                  <button
                    className="secondary-button danger"
                    disabled={busy}
                    onClick={() =>
                      void call("restore", { id: restoreId }).then((v) => {
                        if (v) {
                          setRestoreId("");
                          refresh();
                        }
                      })
                    }
                  >
                    <RotateCcw size={14} />
                    Вернуть файлы к этой точке
                  </button>
                )}
              </div>
            </>
          )}
          {tab === "plan" && (
            <>
              <div className="workbench-section">
                <h3>План задачи</h3>
                {session.plan && (
                  <pre className="plan-text">{session.plan.text}</pre>
                )}
                {(session.tasks || []).map((t) => (
                  <div className="task-plan-row" key={t.id}>
                    <Check size={14} active={t.status === "completed"} />
                    <span>{t.title}</span>
                    <small>
                      {{
                        pending: "Ожидает",
                        in_progress: "В работе",
                        completed: "Готово",
                        blocked: "Нужен ответ",
                      }[t.status] || t.status}
                    </small>
                  </div>
                ))}
                {!session.tasks?.length && !session.plan && (
                  <p className="field-hint">
                    Агент создаёт задачи через Tasks. Для согласования до правок
                    выберите режим «План» в поле ввода.
                  </p>
                )}
              </div>
              <div className="workbench-section">
                <h3>Память проекта</h3>
                <textarea
                  value={memory}
                  onChange={(e) => setMemory(e.target.value)}
                  placeholder="Устойчивые решения и предпочтения проекта"
                  rows={8}
                />
                <button
                  className="secondary-button"
                  disabled={busy || !session.projectId}
                  onClick={() => void call("memory", { content: memory })}
                >
                  <Check size={14} />
                  Сохранить память
                </button>
              </div>
              <details>
                <summary>Загруженные правила проекта</summary>
                {(data?.rules || []).map((r: any) => (
                  <div key={r.path}>
                    <strong>{r.path}</strong>
                    <pre className="plan-text">{r.content}</pre>
                  </div>
                ))}
              </details>
              {session.compaction && (
                <details>
                  <summary>Сводка контекста</summary>
                  <pre className="plan-text">{session.compaction.summary}</pre>
                </details>
              )}
            </>
          )}
          {tab === "preview" && (
            <BrowserPanel
              session={session}
              reveal={reveal}
              hidden={hidden}
              layoutKey={layoutKey}
              onError={onError}
            />
          )}
          {tab === "git" && (
            <>
              <div className="workbench-actions">
                <button
                  className="secondary-button"
                  onClick={() => void gitAction({ operation: "status" })}
                >
                  <RefreshCw size={14} />
                  Состояние
                </button>
                <button
                  className="secondary-button"
                  onClick={() => void gitAction({ operation: "diff" })}
                >
                  <Code2 size={14} />
                  Diff
                </button>
                <button
                  className="secondary-button"
                  disabled={!!session.worktreePath}
                  onClick={() => void gitAction({ operation: "worktree" })}
                >
                  <Folder size={14} />
                  Создать worktree
                </button>
              </div>
              <p className="field-hint">
                Worktree создаётся от HEAD. Несохранённые в Git правки остаются
                в исходной папке.
              </p>
              {git && (
                <pre className="process-output compact">
                  {git.branch}
                  {"\n"}
                  {git.status || "Рабочая копия чистая"}
                </pre>
              )}
              <div className="workbench-section">
                <h3>Коммит</h3>
                <input
                  value={paths}
                  onChange={(e) => setPaths(e.target.value)}
                  placeholder="Пути файлов через запятую"
                />
                <input
                  value={commit}
                  onChange={(e) => setCommit(e.target.value)}
                  placeholder="Сообщение коммита"
                />
                <button
                  className="secondary-button"
                  disabled={!commit || !paths || busy}
                  onClick={() =>
                    void gitAction({
                      operation: "commit",
                      message: commit,
                      paths: paths
                        .split(",")
                        .map((s) => s.trim())
                        .filter(Boolean),
                    })
                  }
                >
                  <Check size={14} />
                  Создать коммит
                </button>
              </div>
              <div className="workbench-section">
                <h3>Pull request и CI</h3>
                <button
                  className="secondary-button"
                  onClick={() => void gitAction({ operation: "push" })}
                >
                  Отправить ветку в origin
                </button>
                <input
                  value={prTitle}
                  onChange={(e) => setPrTitle(e.target.value)}
                  placeholder="Заголовок PR"
                />
                <textarea
                  value={prBody}
                  onChange={(e) => setPrBody(e.target.value)}
                  placeholder="Описание изменений и проверок"
                  rows={3}
                />
                <button
                  className="secondary-button"
                  disabled={!prTitle || !prBody || busy}
                  onClick={() =>
                    void gitAction({
                      operation: "create_pr",
                      title: prTitle,
                      body: prBody,
                    })
                  }
                >
                  <Plus size={14} />
                  Создать черновик PR
                </button>
                <button
                  className="secondary-button"
                  onClick={() => void gitAction({ operation: "ci" })}
                >
                  <RefreshCw size={14} />
                  Проверки CI
                </button>
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={!!session.autoFixCi}
                    onChange={(e) =>
                      void call("ciAutofix", { enabled: e.target.checked })
                    }
                  />
                  Исправлять упавшие проверки агентом
                </label>
                <p className="field-hint">
                  Нужны Git и авторизованный GitHub CLI. Автоисправление меняет
                  локальный проект; отправка изменений требует обычных
                  разрешений.
                </p>
              </div>
              {gitOutput && <pre className="process-output">{gitOutput}</pre>}
            </>
          )}
          {tab === "agents" && (
            <>
              <Choice
                label="Профиль специалиста"
                value={profileId}
                onChange={loadProfile}
                values={[
                  ["", "Новый профиль"],
                  ...(state.agentProfiles || []).map(
                    (p) => [p.id, p.name] as [string, string],
                  ),
                ]}
              />
              <label>
                Название
                <input
                  value={profileName}
                  onChange={(e) => setProfileName(e.target.value)}
                />
              </label>
              <label>
                Инструкции
                <textarea
                  rows={6}
                  value={profilePrompt}
                  onChange={(e) => setProfilePrompt(e.target.value)}
                />
              </label>
              <label>
                Разрешённые инструменты
                <input
                  value={profileTools}
                  onChange={(e) => setProfileTools(e.target.value)}
                  placeholder="FileRead, Glob, Grep, LSP или пусто для всех"
                />
              </label>
              <label>
                Память специалиста
                <textarea
                  rows={5}
                  value={profileMemory}
                  onChange={(e) => setProfileMemory(e.target.value)}
                />
              </label>
              <div className="workbench-actions">
                <button
                  className="secondary-button"
                  disabled={!profileName || !profilePrompt || busy}
                  onClick={() =>
                    void call("profileSave", {
                      id: profileId || undefined,
                      name: profileName,
                      prompt: profilePrompt,
                      allowedTools: profileTools
                        .split(",")
                        .map((s) => s.trim())
                        .filter(Boolean),
                      memory: profileMemory,
                    }).then((p) => p && setProfileId(p.id))
                  }
                >
                  <Check size={14} />
                  Сохранить
                </button>
                {profileId && (
                  <button
                    className="quiet-control"
                    onClick={() =>
                      void call("profileDelete", { id: profileId }).then(() =>
                        loadProfile(""),
                      )
                    }
                  >
                    <Trash2 size={14} />
                    Удалить
                  </button>
                )}
              </div>
              <p className="field-hint">
                Агент выбирает специалиста по задаче. Фоновые помощники
                продолжают работу, пока вы общаетесь в основном чате.
              </p>
            </>
          )}
          {tab === "rules" && (
            <>
              <h3>Разрешения проекта</h3>
              <p className="field-hint">
                Запрет имеет приоритет над Bypass. Режим плана разрешает только
                чтение. Worktree изолирует файлы; shell работает с правами
                пользователя.
              </p>
              {rules.map((r, i) => (
                <div className="permission-rule" key={i}>
                  <input
                    aria-label="Инструмент"
                    value={r.tool}
                    placeholder="Bash или File*"
                    onChange={(e) =>
                      setRules((old) =>
                        old.map((v, k) =>
                          k === i ? { ...v, tool: e.target.value } : v,
                        ),
                      )
                    }
                  />
                  <input
                    aria-label="Путь или команда"
                    value={r.pattern}
                    placeholder="src/** или npm test*"
                    onChange={(e) =>
                      setRules((old) =>
                        old.map((v, k) =>
                          k === i ? { ...v, pattern: e.target.value } : v,
                        ),
                      )
                    }
                  />
                  <Choice
                    label="Действие правила"
                    value={r.action}
                    onChange={(action) =>
                      setRules((old) =>
                        old.map((v, k) => (k === i ? { ...v, action } : v)),
                      )
                    }
                    values={[
                      ["ask", "Спросить"],
                      ["allow", "Разрешить"],
                      ["deny", "Запретить"],
                    ]}
                  />
                  <IconButton
                    label="Удалить правило"
                    onClick={() =>
                      setRules((old) => old.filter((_, k) => k !== i))
                    }
                  >
                    <X size={13} />
                  </IconButton>
                </div>
              ))}
              <div className="workbench-actions">
                <button
                  className="quiet-control"
                  onClick={() =>
                    setRules((old) => [
                      ...old,
                      { tool: "*", pattern: "*", action: "ask" },
                    ])
                  }
                >
                  <Plus size={14} />
                  Правило
                </button>
                <button
                  className="secondary-button"
                  onClick={() => void call("saveRules", { rules })}
                >
                  <Check size={14} />
                  Сохранить
                </button>
              </div>
              <details>
                <summary>Журнал решений</summary>
                {(data?.permissionLog || []).map((l: any) => (
                  <p className="field-hint" key={l.id}>
                    {l.tool}: {l.action} — {l.reason}
                  </p>
                ))}
              </details>
              <div className="workbench-section">
                <h3>Языковые серверы LSP</h3>
                <p className="field-hint">
                  JavaScript и TypeScript встроены. Для других языков укажите
                  установленный stdio-сервер: command, args, extensions, id.
                </p>
                <textarea
                  rows={8}
                  className="mono"
                  value={serverText}
                  onChange={(e) => setServerText(e.target.value)}
                />
                <button
                  className="secondary-button"
                  onClick={() => {
                    try {
                      void call("lspSettings", {
                        servers: JSON.parse(serverText),
                      });
                    } catch {
                      onError("Некорректный JSON настройки LSP");
                    }
                  }}
                >
                  <Check size={14} />
                  Сохранить серверы
                </button>
              </div>
            </>
          )}
          {tab === "mcp" && (
            <>
              <Choice
                label="MCP-сервер"
                value={connector}
                onChange={setConnector}
                values={state.connectors
                  .filter((c) => c.status === "connected")
                  .map((c) => [c.id, c.name])}
              />
              <div className="workbench-actions">
                {[
                  ["resources", "Ресурсы"],
                  ["templates", "Шаблоны URI"],
                  ["prompts", "Промпты"],
                ].map(([operation, label]) => (
                  <button
                    key={operation}
                    className="secondary-button"
                    disabled={!connector}
                    onClick={() =>
                      void call("mcp", {
                        connectorId: connector,
                        operation,
                      }).then((v) => v && setResourceOutput(v))
                    }
                  >
                    {label}
                  </button>
                ))}
              </div>
              <label>
                URI ресурса
                <input value={uri} onChange={(e) => setUri(e.target.value)} />
              </label>
              <button
                className="secondary-button"
                disabled={!connector || !uri}
                onClick={() =>
                  void call("mcp", {
                    connectorId: connector,
                    operation: "read",
                    uri,
                  }).then((v) => v && setResourceOutput(v))
                }
              >
                Прочитать ресурс
              </button>
              <label>
                Имя промпта
                <input
                  value={promptName}
                  onChange={(e) => setPromptName(e.target.value)}
                />
              </label>
              <label>
                Аргументы промпта
                <textarea
                  value={promptArgs}
                  onChange={(e) => setPromptArgs(e.target.value)}
                  rows={3}
                />
              </label>
              <button
                className="secondary-button"
                disabled={!connector || !promptName}
                onClick={() => {
                  try {
                    void call("mcp", {
                      connectorId: connector,
                      operation: "prompt",
                      name: promptName,
                      arguments: JSON.parse(promptArgs),
                    }).then((v) => v && setResourceOutput(v));
                  } catch {
                    onError("Некорректный JSON аргументов");
                  }
                }}
              >
                Загрузить промпт
              </button>
              {resourceOutput && (
                <>
                  <pre className="process-output">
                    {JSON.stringify(resourceOutput, null, 2)}
                  </pre>
                  <button
                    className="secondary-button"
                    onClick={() =>
                      onComment(
                        "Используй эти данные MCP для моей задачи:\n" +
                          JSON.stringify(resourceOutput).slice(0, 32000),
                      )
                    }
                  >
                    <MessageSquare size={14} />
                    Передать в чат
                  </button>
                </>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}
