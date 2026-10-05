import { useLayoutEffect, useRef, useState } from "react";
import {
  ArrowUp,
  Square,
  Plus,
  Sparkles,
  Copy,
  FileText,
  Monitor,
  Check,
} from "../icons";
import type {
  Project,
  ModelOption,
  Skill,
  Attachment,
  PermissionMode,
  Effort,
  Message,
} from "../types";
import { PermissionMenu } from "./PermissionMenu";
import { AttachmentCard, attachmentKey } from "./Attachments";
import { TurweTitle } from "./TurweTitle";
import { Dropdown, Menu, ModelMenu, ProjectMenu } from "./Dropdown";
import { shortcutKey } from "../platform";
import { QueuedMessages } from "./QueuedMessages";
interface Props {
  platform?: string;
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  running: boolean;
  sending: boolean;
  model: string;
  models: ModelOption[];
  onModel: (value: string) => void;
  effort?: Effort;
  onEffort: (value: Effort) => void;
  contextFill?: number;
  onCompact: () => void;
  compacting: boolean;
  compactDisabled: boolean;
  sessionId?: string;
  queuedMessages: Message[];
  onEditQueued: (id: string, content: string) => Promise<void>;
  onRemoveQueued: (id: string) => Promise<void>;
  onSteerQueued: (id: string) => Promise<void>;
  onResumeQueue: () => Promise<void>;
  onError: (message: string) => void;
  permissionMode: PermissionMode;
  onPermissionMode: (value: PermissionMode) => void;
  onManageModels: () => void;
  project?: Project;
  projects: Project[];
  onProject: (id: string | null) => void;
  onChooseProject: () => void;
  onAttach: (kind: "media" | "files" | "clipboard") => void;
  onDropFiles: (files: File[]) => void;
  attaching: boolean;
  attachmentProgress: string;
  onSkills: () => void;
  skills: Skill[];
  attachments: Attachment[];
  onRemove: (path: string) => void;
  empty: boolean;
  motionEnabled: boolean;
  disabled?: boolean;
}
export function Composer(p: Props) {
  const hasInput = !!p.value.trim() || !!p.attachments.length;
  const showStop = p.running && !hasInput;
  const textarea = useRef<HTMLTextAreaElement>(null);
  const [caret, setCaret] = useState(0),
    [suggestion, setSuggestion] = useState(0),
    [dismissed, setDismissed] = useState(false);
  const available = p.skills.filter(
    (s) => !s.projectId || s.projectId === p.project?.id,
  );
  const skills = [
    ...new Map(
      [...available]
        .sort((a, b) => Number(!!a.projectId) - Number(!!b.projectId))
        .map((s) => [s.name, s]),
    ).values(),
  ];
  const invocable = skills.filter(
    (s) => s.userInvocable && !s.unsupported.length,
  );
  const query = p.value.slice(0, caret).match(/(?:^|\s)([@$/])([a-z0-9-]*)$/);
  const suggestions =
    query && !dismissed
      ? invocable.filter((s) => s.name.startsWith(query[2])).slice(0, 6)
      : [];
  const activeSkills = skills.filter(
    (s) => p.project?.skillIds?.includes(s.id) && !s.manualOnly,
  );
  useLayoutEffect(() => {
    const el = textarea.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
    }
  }, [p.value]);
  function insert(skill: Skill, replace = false) {
    const start = replace && query ? caret - query[2].length - 1 : caret;
    const prefix = p.value.slice(0, start),
      suffix = p.value.slice(caret);
    const token = `${prefix && !/\s$/.test(prefix) ? " " : ""}@${skill.name} `;
    p.onChange(prefix + token + suffix);
    setDismissed(true);
    requestAnimationFrame(() => {
      textarea.current?.focus();
      textarea.current?.setSelectionRange(
        start + token.length,
        start + token.length,
      );
      setCaret(start + token.length);
    });
  }
  return (
    <div className={`composer-wrap ${p.empty ? "composer-centered" : ""}`}>
      {p.empty && <TurweTitle motionEnabled={p.motionEnabled} />}
      <QueuedMessages
        key={p.sessionId || "new"}
        messages={p.queuedMessages}
        running={p.running}
        disabled={p.disabled || p.sending}
        onEdit={p.onEditQueued}
        onRemove={p.onRemoveQueued}
        onSteer={p.onSteerQueued}
        onResume={p.onResumeQueue}
        onRestoreDraft={(text) =>
          p.onChange([p.value, text].filter(Boolean).join("\n\n"))
        }
        onError={p.onError}
      />
      <div
        className={`composer ${p.attaching ? "attaching" : ""}`}
        aria-busy={p.attaching}
      >
        <div className="composer-input">
          {!!p.attachments.length && (
            <div className="attachment-list">
              {p.attachments.map((file) => (
                <AttachmentCard
                  key={attachmentKey(file)}
                  file={file}
                  onRemove={() => p.onRemove(attachmentKey(file))}
                  disabled={p.disabled || p.sending || p.attaching}
                />
              ))}
            </div>
          )}
          {p.attaching && (
            <div className="attachment-progress" role="status">
              <span className="thinking-orbit" />
              <span>{p.attachmentProgress || "Подготавливаем вложения…"}</span>
            </div>
          )}
          <div className="textarea-anchor">
            {!!suggestions.length && (
              <div
                className="skill-suggestions"
                role="listbox"
                id="skill-suggestions"
                aria-label="Скиллы для сообщения"
              >
                <span className="dropdown-label">Вызвать скилл</span>
                {suggestions.map((skill, i) => (
                  <div
                    role="option"
                    id={`suggestion-${i}`}
                    key={skill.id}
                    aria-selected={i === suggestion}
                    className={`skill-suggestion ${i === suggestion ? "highlighted" : ""}`}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => insert(skill, true)}
                    onMouseEnter={() => setSuggestion(i)}
                  >
                    <Sparkles size={15} />
                    <span>
                      <strong>{skill.name}</strong>
                      <small>{skill.argumentHint || skill.description}</small>
                    </span>
                    <kbd aria-label="Enter" title="Enter">
                      <Check size={13} />
                    </kbd>
                  </div>
                ))}
              </div>
            )}
            <textarea
              ref={textarea}
              aria-label="Задача для AI"
              aria-expanded={!!suggestions.length}
              aria-controls={
                suggestions.length ? "skill-suggestions" : undefined
              }
              aria-activedescendant={
                suggestions.length
                  ? `suggestion-${Math.min(suggestion, suggestions.length - 1)}`
                  : undefined
              }
              aria-autocomplete="list"
              placeholder={
                !p.project
                  ? "Выберите проект, чтобы начать чат…"
                  : p.running
                    ? "Добавить следующую задачу…"
                    : "Какую задачу разберём в вашем проекте?"
              }
              value={p.value}
              onChange={(e) => {
                p.onChange(e.target.value);
                setCaret(e.target.selectionStart);
                setSuggestion(0);
                setDismissed(false);
              }}
              onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
              onPaste={(e) => {
                const files = Array.from(e.clipboardData.files);
                if (files.length) {
                  e.preventDefault();
                  if (!p.attaching && !p.sending && !p.disabled)
                    p.onDropFiles(files);
                }
              }}
              onKeyDown={(e) => {
                if (e.nativeEvent.isComposing) return;
                if (suggestions.length) {
                  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                    e.preventDefault();
                    setSuggestion(
                      (v) =>
                        (v +
                          (e.key === "ArrowDown" ? 1 : -1) +
                          suggestions.length) %
                        suggestions.length,
                    );
                    return;
                  }
                  if (e.key === "Escape") {
                    e.preventDefault();
                    e.stopPropagation();
                    setDismissed(true);
                    return;
                  }
                  if (e.key === "Enter" || e.key === "Tab") {
                    e.preventDefault();
                    insert(
                      suggestions[Math.min(suggestion, suggestions.length - 1)],
                      true,
                    );
                    return;
                  }
                }
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  if (!p.sending) p.onSend();
                }
              }}
              disabled={p.disabled || p.sending}
              rows={1}
            />
          </div>
          <div className="composer-toolbar">
            <div className="composer-left">
              <Dropdown
                label="Прикрепить"
                className="attachment-menu-trigger"
                disabled={p.disabled || p.sending || p.attaching}
                trigger={<Plus size={20} />}
              >
                <Menu.Label className="dropdown-label">
                  Добавить к сообщению
                </Menu.Label>
                <Menu.Item
                  className="dropdown-item"
                  onSelect={() => p.onAttach("media")}
                >
                  <Monitor size={16} />
                  Фото или видео
                </Menu.Item>
                <Menu.Item
                  className="dropdown-item"
                  onSelect={() => p.onAttach("files")}
                >
                  <FileText size={16} />
                  Прикрепить файлы
                </Menu.Item>
                <Menu.Item
                  className="dropdown-item"
                  onSelect={() => p.onAttach("clipboard")}
                >
                  <Copy size={16} />
                  Из буфера обмена<kbd>{shortcutKey(p.platform)} V</kbd>
                </Menu.Item>
                <Menu.Separator className="dropdown-separator" />
                <div className="dropdown-note">
                  Можно перетащить файлы прямо сюда.
                  <br />
                  До 8 вложений в сообщении.
                </div>
              </Dropdown>
              <ProjectMenu
                allowNone={false}
                projects={p.projects}
                value={p.project?.id || null}
                onChange={p.onProject}
                onChoose={p.onChooseProject}
                disabled={p.disabled || p.sending || p.running || p.attaching}
              />
              <Dropdown
                label="Вызвать скилл"
                className="skill-menu-trigger"
                disabled={p.disabled || p.sending}
                trigger={
                  <Sparkles size={15} active={activeSkills.length > 0} />
                }
              >
                <Menu.Label className="dropdown-label">
                  Скиллы · @имя
                </Menu.Label>
                {invocable.length ? (
                  invocable.map((s) => (
                    <Menu.Item
                      className="dropdown-item"
                      key={s.id}
                      onSelect={() => insert(s)}
                    >
                      <Sparkles size={14} />
                      <span className="dropdown-item-copy">
                        <span>{s.name}</span>
                        <small>{s.description}</small>
                      </span>
                    </Menu.Item>
                  ))
                ) : (
                  <div className="dropdown-note">
                    Добавьте инструкции в библиотеку, чтобы вызывать их в чате.
                  </div>
                )}
                <Menu.Separator className="dropdown-separator" />
                <Menu.Item className="dropdown-item" onSelect={p.onSkills}>
                  Открыть библиотеку скиллов
                </Menu.Item>
              </Dropdown>
            </div>
            <div className="composer-right">
              <PermissionMenu
                value={p.permissionMode}
                onChange={p.onPermissionMode}
                disabled={p.disabled || p.sending}
              />
              <ModelMenu
                models={p.models}
                value={p.model}
                onChange={p.onModel}
                onManage={p.onManageModels}
                effort={p.effort}
                onEffort={p.onEffort}
                contextFill={p.contextFill}
                onCompact={p.onCompact}
                compacting={p.compacting}
                compactDisabled={p.compactDisabled}
                disabled={p.running || p.sending || p.disabled || p.compacting}
              />
              <button
                className={`send-button ${showStop ? "stop" : ""}`}
                aria-label={
                  showStop
                    ? "Остановить ответ"
                    : p.running || p.queuedMessages.length
                      ? "Добавить в очередь"
                      : "Отправить сообщение"
                }
                disabled={
                  p.disabled ||
                  p.sending ||
                  (!showStop && (p.attaching || !hasInput || !p.project))
                }
                title={
                  !p.project && !showStop
                    ? "Сначала выберите папку проекта"
                    : undefined
                }
                onClick={showStop ? p.onStop : p.onSend}
              >
                {showStop ? <Square size={13} active /> : <ArrowUp size={18} />}
              </button>
            </div>
          </div>
        </div>
      </div>
      {!!activeSkills.length && (
        <div className="composer-active-skills">
          <Sparkles size={12} active />
          <span>Инструкции проекта:</span>
          {activeSkills.map((s) => (
            <button key={s.id} onClick={p.onSkills}>
              {s.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
