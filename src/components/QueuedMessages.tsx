import { useRef, useState } from "react";
import {
  Layers,
  ArrowUp,
  Check,
  Paperclip,
  Pencil,
  Trash2,
  X,
  MoreHorizontal,
  CornerDownRight,
  LoaderCircle,
} from "../icons";
import type { Message } from "../types";
import { Menu } from "./Dropdown";
import "../queued-messages.css";

interface Props {
  messages: Message[];
  running: boolean;
  disabled?: boolean;
  onEdit: (id: string, content: string) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
  onSteer: (id: string) => Promise<void>;
  onResume: () => Promise<void>;
  onRestoreDraft: (text: string) => void;
  onError: (message: string) => void;
}

export function QueuedMessages(p: Props) {
  const [editing, setEditing] = useState<Message | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const section = useRef<HTMLElement>(null);
  const editButtons = useRef(new Map<string, HTMLButtonElement>());
  const menuAction = useRef<"edit" | "remove" | null>(null);
  const nextMessage =
    p.messages
      .filter((message) => message.steering)
      .sort((a, b) => (a.steeringOrder || 0) - (b.steeringOrder || 0))[0] ||
    p.messages[0];
  const pendingEdit =
    !!editing &&
    p.messages.some(
      (message) =>
        message.id === editing.id && !(message.steering && p.running),
    );
  function focusComposer() {
    document.querySelector<HTMLTextAreaElement>(".composer textarea")?.focus();
  }
  function finishEditing() {
    const id = editing?.id;
    setEditing(null);
    requestAnimationFrame(() => {
      const button = id && editButtons.current.get(id);
      if (button) button.focus();
      else focusComposer();
    });
  }
  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    try {
      await action();
      return true;
    } catch (error) {
      p.onError((error as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function save(id: string) {
    if (await run(() => p.onEdit(id, text))) finishEditing();
  }
  async function steer(id: string) {
    if (await run(() => p.onSteer(id))) requestAnimationFrame(focusComposer);
  }
  async function remove(id: string) {
    if (await run(() => p.onRemove(id))) {
      requestAnimationFrame(() => {
        const next = section.current?.querySelector<HTMLButtonElement>(
          ".queued-menu-trigger:not(:disabled)",
        );
        if (next) next.focus();
        else focusComposer();
      });
    }
  }
  if (!p.messages.length && !editing) return null;
  const disabled = busy || p.disabled;
  return (
    <section
      ref={section}
      className="message-queue"
      aria-label="Очередь сообщений"
    >
      <div className="message-queue-list">
        {p.messages.map((message, index) => (
          <div className="queued-message" key={message.id}>
            <div className="queued-message-row">
              <span
                className={`queued-message-icon ${message.id === nextMessage?.id ? "next" : ""}`}
                role="img"
                aria-label={
                  message.steering
                    ? "Уточнение текущей задачи"
                    : message.id === nextMessage?.id
                      ? "Следующее в очереди"
                      : "Ожидает в очереди"
                }
                title={
                  message.steering
                    ? "Уточнение текущей задачи"
                    : message.id === nextMessage?.id
                      ? "Следующее в очереди"
                      : "Ожидает в очереди"
                }
              >
                <Layers size={17} active={message.id === nextMessage?.id} />
              </span>
              {!!message.attachments?.length && (
                <span
                  className="queued-attachment"
                  title={message.attachments
                    .map((file) => file.name || file.path)
                    .join(", ")}
                >
                  {message.attachments[0].preview ? (
                    <img src={message.attachments[0].preview} alt="" />
                  ) : (
                    <Paperclip size={15} />
                  )}
                  {message.attachments.length > 1 && (
                    <small>{message.attachments.length}</small>
                  )}
                </span>
              )}
              <span className="queued-message-text" title={message.content}>
                {message.content || "Сообщение с вложениями"}
              </span>
              <div className="queued-message-actions">
                <button
                  type="button"
                  className="queued-steer-button"
                  disabled={
                    disabled ||
                    (message.steering && p.running) ||
                    editing?.id === message.id
                  }
                  aria-label={
                    message.steering && p.running
                      ? `Уточнение ${index + 1} передаётся агенту`
                      : `Скорректировать текущую задачу сообщением ${index + 1}`
                  }
                  title={
                    message.steering && p.running
                      ? "Уточнение добавится после текущего действия"
                      : "Передать это сообщение агенту сейчас"
                  }
                  onClick={() => void steer(message.id)}
                >
                  {message.steering && p.running ? (
                    <LoaderCircle size={14} className="spin" />
                  ) : (
                    <CornerDownRight size={14} />
                  )}
                  <span>
                    {message.steering && p.running
                      ? "Передаём…"
                      : "Скорректировать"}
                  </span>
                </button>
                <Menu.Root
                  onOpenChange={(open) => {
                    if (open) menuAction.current = null;
                  }}
                >
                  <Menu.Trigger asChild>
                    <button
                      ref={(button) => {
                        if (button) editButtons.current.set(message.id, button);
                        else editButtons.current.delete(message.id);
                      }}
                      type="button"
                      className="icon-button queued-menu-trigger"
                      aria-label={`Действия с сообщением ${index + 1} в очереди`}
                      title="Действия с сообщением"
                      disabled={disabled || (message.steering && p.running)}
                    >
                      <MoreHorizontal size={17} />
                    </button>
                  </Menu.Trigger>
                  <Menu.Portal>
                    <Menu.Content
                      className="dropdown-content queued-actions-menu"
                      align="end"
                      sideOffset={6}
                      collisionPadding={12}
                      onEscapeKeyDown={(event) => event.stopPropagation()}
                      onCloseAutoFocus={(event) => {
                        if (!menuAction.current) return;
                        event.preventDefault();
                        if (menuAction.current === "edit")
                          requestAnimationFrame(() =>
                            section.current
                              ?.querySelector<HTMLTextAreaElement>(
                                ".queued-message-editor textarea",
                              )
                              ?.focus(),
                          );
                        menuAction.current = null;
                      }}
                    >
                      <Menu.Item
                        className="dropdown-item"
                        disabled={disabled || (message.steering && p.running)}
                        onSelect={() => {
                          menuAction.current = "edit";
                          setEditing(message);
                          setText(message.content);
                        }}
                      >
                        <Pencil size={15} />
                        Изменить
                      </Menu.Item>
                      <Menu.Item
                        className="dropdown-item destructive-item"
                        disabled={disabled || (message.steering && p.running)}
                        onSelect={() => {
                          menuAction.current = "remove";
                          void remove(message.id);
                        }}
                      >
                        <Trash2 size={15} />
                        Удалить
                      </Menu.Item>
                    </Menu.Content>
                  </Menu.Portal>
                </Menu.Root>
              </div>
            </div>
          </div>
        ))}
      </div>
      {editing && (
        <form
          className="queued-message-editor"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              finishEditing();
            }
          }}
          onSubmit={(event) => {
            event.preventDefault();
            if (pendingEdit) void save(editing.id);
          }}
        >
          {!pendingEdit && (
            <p className="queued-edit-notice" role="status">
              Сообщение уже отправлено или удалено. Правки можно добавить в
              новый черновик.
            </p>
          )}
          <textarea
            autoFocus
            aria-label="Текст сообщения в очереди"
            value={text}
            onChange={(event) => setText(event.target.value)}
            disabled={disabled}
            rows={3}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return;
              if (
                event.key === "Enter" &&
                !event.shiftKey &&
                (event.ctrlKey || event.metaKey)
              ) {
                event.preventDefault();
                if (
                  !disabled &&
                  pendingEdit &&
                  (text.trim() || editing.attachments?.length)
                )
                  void save(editing.id);
              }
            }}
          />
          <div className="queued-editor-actions">
            {pendingEdit && !!editing.attachments?.length && (
              <span>
                <Paperclip size={12} />
                Вложения сохранятся
              </span>
            )}
            <button
              type="button"
              className="quiet-control"
              disabled={disabled}
              onClick={finishEditing}
            >
              <X size={13} />
              Отмена
            </button>
            {pendingEdit ? (
              <button
                type="submit"
                className="quiet-control"
                disabled={
                  disabled || (!text.trim() && !editing.attachments?.length)
                }
              >
                <Check size={13} />
                Сохранить
              </button>
            ) : (
              <button
                type="button"
                className="quiet-control"
                disabled={disabled || !text.trim()}
                onClick={() => {
                  p.onRestoreDraft(text);
                  setEditing(null);
                  requestAnimationFrame(focusComposer);
                }}
              >
                <Pencil size={13} />В черновик
              </button>
            )}
          </div>
        </form>
      )}
      {!p.running && !!p.messages.length && (
        <div className="message-queue-paused">
          <span>Очередь на паузе</span>
          <button
            type="button"
            disabled={disabled || pendingEdit}
            onClick={() => void run(p.onResume)}
          >
            <ArrowUp size={14} />
            Продолжить очередь
          </button>
        </div>
      )}
    </section>
  );
}
