import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  Copy,
  RotateCcw,
  AlertCircle,
  ArrowDown,
  Sparkles,
  Pencil,
} from "../icons";
import type { Session, QuestionResponse } from "../types";
import { AssistantContent } from "./AssistantContent";
import { IconButton } from "./Primitives";
import { playSound } from "../sound";
import { bridge, unwrap, isRunning } from "../bridge";
import { AttachmentCard, attachmentKey } from "./Attachments";
import { fluid } from "../motion";
import { useChatMotion } from "../chat-motion";
import { ThinkingIndicator } from "./ThinkingIndicator";
interface Props {
  session: Session;
  onRetry: () => void;
  onAgentOpen: (id: string) => void;
  notify: (text: string) => void;
  onError: (text: string) => void;
  onBranch: (messageId: string, content?: string) => void;
  onApprove: (callId: string, allowed: boolean) => void;
  onAnswer: (callId: string, response: QuestionResponse) => Promise<void>;
}
const positions = new Map<string, number>();
export function Conversation({
  session,
  onRetry,
  notify,
  onError,
  onBranch,
  onApprove,
  onAnswer,
  onAgentOpen,
}: Props) {
  const motionEnabled = useChatMotion();
  const seenMessages = useRef(
    new Set(session.messages.map((message) => message.id)),
  );
  useLayoutEffect(() => {
    for (const message of session.messages)
      seenMessages.current.add(message.id);
  }, [session.messages]);
  const [editing, setEditing] = useState<string | null>(null),
    [editText, setEditText] = useState(""),
    [showScrollBottom, setShowScrollBottom] = useState(false);
  const scroll = useRef<HTMLDivElement>(null),
    content = useRef<HTMLDivElement>(null),
    following = useRef(true),
    manualDisclosure = useRef(false),
    lastId = useRef(""),
    lastQuestion = useRef("");
  const scrollSize = useRef({ height: 0, viewport: 0, width: 0 });
  const updateScrollButton = useCallback(() => {
    const node = scroll.current;
    if (node)
      scrollSize.current = {
        height: node.scrollHeight,
        viewport: node.clientHeight,
        width: node.clientWidth,
      };
    setShowScrollBottom(
      !!node && node.scrollHeight - node.clientHeight - node.scrollTop > 100,
    );
  }, []);
  const question = session.messages
    .flatMap((m) => (m.toolRounds || []).flatMap((r) => r.calls))
    .find((c) => c.status === "question");
  const questionKey = question ? `${session.id}:${question.id}` : "";
  useLayoutEffect(() => {
    const node = scroll.current;
    if (!node) return;
    if (lastId.current !== session.id) {
      lastId.current = session.id;
      node.scrollTop = positions.get(session.id) ?? node.scrollHeight;
      following.current =
        node.scrollHeight - node.clientHeight - node.scrollTop < 100;
    } else if (!questionKey && (following.current || lastQuestion.current)) {
      node.scrollTop = node.scrollHeight;
      following.current = true;
    }
    if (
      questionKey &&
      questionKey !== lastQuestion.current &&
      following.current
    ) {
      const card = node.querySelector("form.question-card");
      if (card)
        node.scrollTop +=
          card.getBoundingClientRect().top -
          node.getBoundingClientRect().top -
          16;
    }
    lastQuestion.current = questionKey;
    updateScrollButton();
  }, [session.id, session.messages, questionKey, updateScrollButton]);
  useLayoutEffect(() => {
    const node = scroll.current;
    if (!node || !questionKey) return;
    let width = node.clientWidth,
      height = node.clientHeight;
    const observer = new ResizeObserver(() => {
      if (width === node.clientWidth && height === node.clientHeight) return;
      width = node.clientWidth;
      height = node.clientHeight;
      const card = node.querySelector("form.question-card");
      if (card)
        node.scrollTop +=
          card.getBoundingClientRect().top -
          node.getBoundingClientRect().top -
          12;
      updateScrollButton();
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [questionKey, updateScrollButton]);
  useLayoutEffect(() => {
    const node = scroll.current;
    const body = content.current;
    if (!node || !body) return;
    // Disclosure height keeps changing after the message render has committed.
    // Keep following incoming actions, while leaving manual reading in place.
    const observer = new ResizeObserver(() => {
      if (!questionKey && following.current && !manualDisclosure.current)
        node.scrollTop = node.scrollHeight;
      updateScrollButton();
    });
    observer.observe(body);
    observer.observe(node);
    return () => observer.disconnect();
  }, [questionKey, updateScrollButton]);
  async function copy(text: string) {
    try {
      await unwrap(bridge.copyText(text));
      playSound("copy");
      notify("Скопировано");
    } catch {
      onError("Не удалось записать в буфер обмена");
    }
  }
  return (
    <div className="conversation-region" hidden={!session.messages.length}>
      <div
        className="conversation-scroll"
        ref={scroll}
        tabIndex={-1}
        onClickCapture={(event) => {
          if ((event.target as Element).closest(".action-row[aria-expanded]")) {
            manualDisclosure.current = true;
            following.current = false;
          }
        }}
        onPointerDownCapture={() => {
          manualDisclosure.current = false;
        }}
        onWheelCapture={() => {
          manualDisclosure.current = false;
        }}
        onTouchMoveCapture={() => {
          manualDisclosure.current = false;
        }}
        onKeyDownCapture={(event) => {
          if (
            [
              "ArrowUp",
              "ArrowDown",
              "PageUp",
              "PageDown",
              "Home",
              "End",
            ].includes(event.key)
          )
            manualDisclosure.current = false;
        }}
        onScroll={() => {
          const node = scroll.current;
          if (node) {
            positions.set(session.id, node.scrollTop);
            // Chromium can emit scroll before ResizeObserver on a viewport change.
            // That layout event must not turn off following as if the user scrolled.
            const resized =
              node.scrollHeight !== scrollSize.current.height ||
              node.clientHeight !== scrollSize.current.viewport ||
              node.clientWidth !== scrollSize.current.width;
            if (!manualDisclosure.current && !resized)
              following.current =
                node.scrollHeight - node.clientHeight - node.scrollTop < 100;
            updateScrollButton();
          }
        }}
      >
        <div className="conversation" ref={content}>
          {session.messages.map((message, index) => (
            <motion.article
              className={`message ${message.role}${editing === message.id ? " is-editing" : ""}`}
              aria-label={
                message.role === "user" ? "Ваше сообщение" : "Ответ AI"
              }
              key={message.id}
              data-message-id={message.id}
              initial={
                motionEnabled && !seenMessages.current.has(message.id)
                  ? { opacity: 0, transform: "translateY(8px) scale(0.96)" }
                  : false
              }
              animate={{ opacity: 1, transform: "translateY(0px) scale(1)" }}
              transition={motionEnabled ? fluid.moderate : { duration: 0 }}
            >
              {message.attachments?.length ? (
                <div className="message-attachments">
                  {message.attachments.map((file) => (
                    <AttachmentCard key={attachmentKey(file)} file={file} />
                  ))}
                </div>
              ) : null}
              {message.role === "assistant" ||
              message.content ||
              message.skills?.length ||
              editing === message.id ? (
                <div className="message-body">
                  {!!message.skills?.length && (
                    <div className="message-skills">
                      {message.skills.map((skill) => (
                        <span
                          key={skill.id}
                          title="Инструкции включены в это сообщение"
                        >
                          <Sparkles size={12} active />
                          {skill.name}
                        </span>
                      ))}
                    </div>
                  )}
                  {message.role === "user" ? (
                    editing === message.id ? (
                      <div className="message-editor">
                        <textarea
                          aria-label="Изменить сообщение"
                          value={editText}
                          onChange={(e) => setEditText(e.target.value)}
                          autoFocus
                          rows={4}
                        />
                        <small>Продолжение откроется в новой ветке.</small>
                        <div>
                          <button
                            className="secondary-button"
                            onClick={() => setEditing(null)}
                          >
                            Отмена
                          </button>
                          <button
                            className="primary-button"
                            disabled={!editText.trim() || isRunning(session)}
                            onClick={() => {
                              onBranch(message.id, editText);
                              setEditing(null);
                            }}
                          >
                            Отправить
                          </button>
                        </div>
                      </div>
                    ) : (
                      <p className="user-text">{message.content}</p>
                    )
                  ) : (
                    <AssistantContent
                      message={message}
                      draftKey={`${session.id}-${message.id}`}
                      sessionId={session.id}
                      onError={onError}
                      onApprove={onApprove}
                      onAnswer={onAnswer}
                      onAgentOpen={onAgentOpen}
                      onCopy={(text) => void copy(text)}
                    />
                  )}
                  {["connecting", "streaming"].includes(
                    message.status || "",
                  ) && (
                    <ThinkingIndicator />
                  )}
                  {message.status === "error" && (
                    <div className="response-error" role="alert">
                      <AlertCircle size={16} />
                      <div>
                        <strong>Не удалось получить ответ</strong>
                        <p>{message.error}</p>
                      </div>
                    </div>
                  )}
                  {message.status === "stopped" && (
                    <div className="stopped-label">
                      Ответ остановлен. Полученный текст сохранён.
                    </div>
                  )}
                </div>
              ) : null}
              <div className="message-actions">
                {message.role === "user" &&
                  !isRunning(session) &&
                  !session.archived && (
                    <IconButton
                      label="Изменить сообщение"
                      onClick={() => {
                        setEditing(message.id);
                        setEditText(message.content);
                      }}
                    >
                      <Pencil size={14} />
                    </IconButton>
                  )}
                {message.status === "complete" &&
                  !isRunning(session) &&
                  !session.archived && (
                    <IconButton
                      label="Повторить ответ в новой ветке"
                      onClick={() => onBranch(message.id)}
                    >
                      <RotateCcw size={14} />
                    </IconButton>
                  )}
                {message.content && (
                  <IconButton
                    label="Копировать сообщение"
                    onClick={() => void copy(message.content)}
                  >
                    <Copy size={14} />
                  </IconButton>
                )}
                {["error", "stopped"].includes(message.status || "") &&
                  index === session.messages.length - 1 && (
                    <button className="quiet-control" onClick={onRetry}>
                      <RotateCcw size={13} />
                      Повторить запрос
                    </button>
                  )}
              </div>
            </motion.article>
          ))}
        </div>
      </div>
      <AnimatePresence initial={false}>
        {showScrollBottom && (
          <motion.button
            className="scroll-bottom"
            aria-label="К последнему сообщению"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: motionEnabled ? 0.12 : 0 }}
            onClick={() => {
              if (scroll.current) {
                manualDisclosure.current = false;
                following.current = true;
                scroll.current.scrollTop = scroll.current.scrollHeight;
                scroll.current.focus({ preventScroll: true });
                updateScrollButton();
              }
            }}
          >
            <ArrowDown size={14} />
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
}
