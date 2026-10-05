import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { Copy, Square, X } from "../icons";
import { bridge,unwrap } from '../bridge';
import type { ApprovalChoice, AgentRun, QuestionResponse } from "../types";
import { agentAction, agentStatus, hasActiveReply } from "../agents";
import { fluid } from "../motion";
import { IconButton } from "./Primitives";
import { AssistantContent } from "./AssistantContent";
import { AgentRows, AgentStatus } from "./AgentActivity";

export function AgentPanel({
  agent,
  group,
  motionEnabled,
  onClose,
  onOpen,
  onStop,
  onApprove,
  onAnswer,
  onCopy,
  onError,
}: {
  agent: AgentRun;
  group: AgentRun[];
  motionEnabled: boolean;
  onClose: () => void;
  onOpen: (id: string) => void;
  onStop: () => Promise<void>;
  onApprove: (callId: string, allowed: boolean, remember?: ApprovalChoice) => void;
  onAnswer: (callId: string, response: QuestionResponse) => Promise<void>;
  onCopy: (text: string) => void;
  onError: (message: string) => void;
}) {
  const scroll = useRef<HTMLDivElement>(null),
    content = useRef<HTMLDivElement>(null),
    heading = useRef<HTMLHeadingElement>(null),
    following = useRef(true),
    manualDisclosure = useRef(false),
    lastAttention = useRef("");
  const reducedMotion = useReducedMotion() || !motionEnabled;
  const [stopping, setStopping] = useState(false),
    [followup,setFollowup] = useState(''),
    [error, setError] = useState("");
  const calls = agent.messages.flatMap(
    (message) => message.toolRounds?.flatMap((round) => round.calls) || [],
  );
  const attention = calls.find((call) =>
    ["question", "approval"].includes(call.status),
  );
  useEffect(() => {
    const prior = document.activeElement as HTMLElement | null;
    heading.current?.focus();
    return () => {
      if (prior?.isConnected) prior.focus();
    };
  }, [agent.id]);
  useLayoutEffect(() => {
    const node = scroll.current;
    if (!node) return;
    if (attention && attention.id !== lastAttention.current &&
        (attention.status === "question" || following.current)) {
      const card = node.querySelector("form.question-card, .tool-call.approval");
      if (card)
        node.scrollTop +=
          card.getBoundingClientRect().top -
          node.getBoundingClientRect().top -
          16;
    } else if (!attention && following.current)
      node.scrollTop = node.scrollHeight;
    lastAttention.current = attention?.id || "";
  }, [agent.messages, attention?.id]);
  useLayoutEffect(() => {
    const node = scroll.current;
    const body = content.current;
    if (!node || !body) return;
    const observer = new ResizeObserver(() => {
      if (attention?.status !== "question" && following.current && !manualDisclosure.current)
        node.scrollTop = node.scrollHeight;
    });
    observer.observe(body);
    return () => observer.disconnect();
  }, [agent.id, attention?.id, attention?.status]);
  return (
    <motion.aside
      className="agent-panel"
      aria-label="Подробности субагента"
      initial={{ opacity: 0, x: 12 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 12 }}
      transition={reducedMotion ? { duration: 0 } : fluid.moderate}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="agent-panel-heading">
        <span>
          Субагент{agent.depth > 1 ? ` · уровень ${agent.depth}` : ""}
        </span>
        <IconButton label="Закрыть панель агента" onClick={onClose}>
          <X size={16} />
        </IconButton>
      </div>
      <div className="agent-panel-intro">
        <h2 ref={heading} tabIndex={-1}>
          {agent.title}
        </h2>
        <div className="agent-panel-meta">
          <span>
            <AgentStatus status={agentStatus(agent)} />
            {agentAction(agent)}
          </span>
          <small>{agent.model}</small>
        </div>
      </div>
      <div
        className="agent-panel-scroll"
        ref={scroll}
        onClickCapture={(event) => {
          if ((event.target as Element).closest(".action-row[aria-expanded], summary")) {
            manualDisclosure.current = true;
            following.current = false;
          }
        }}
        onPointerDownCapture={() => { manualDisclosure.current = false; }}
        onWheelCapture={() => { manualDisclosure.current = false; }}
        onTouchMoveCapture={() => { manualDisclosure.current = false; }}
        onKeyDownCapture={(event) => {
          if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End"].includes(event.key))
            manualDisclosure.current = false;
        }}
        onScroll={() => {
          const node = scroll.current;
          if (node && !manualDisclosure.current)
            following.current =
              node.scrollHeight - node.clientHeight - node.scrollTop < 80;
        }}
      >
        <div ref={content}>
        <details className="agent-group">
          <summary>Агенты этого ответа</summary>
          <AgentRows agents={group} selectedId={agent.id} onOpen={onOpen} />
        </details>
        <details className="agent-task">
          <summary>Задача</summary>
          <p>{agent.task}</p>
        </details>
        {agent.messages
          .filter((message) => message.role === "assistant")
          .map((message) => (
            <div key={message.id} className="agent-output message-body">
              <AssistantContent
                message={message}
                draftKey={`${agent.id}-${message.id}`}
                sessionId={agent.id}
                retrySessionId={agent.rootSessionId}
                onError={onError}
                onApprove={onApprove}
                onAnswer={onAnswer}
                onAgentOpen={onOpen}
                onCopy={onCopy}
              />
              {!!message.agents?.length && (
                <div className="agent-panel-children">
                  <AgentRows agents={message.agents} onOpen={onOpen} />
                </div>
              )}
              {message.error && (
                <div className="inline-error" role="alert">
                  {message.error}
                </div>
              )}
              {message.status === "stopped" && (
                <p className="stopped-label">
                  Работа остановлена. Полученные результаты сохранены.
                </p>
              )}
            </div>
          ))}
        {!agent.messages.some(
          (message) =>
            message.role === "assistant" &&
            (message.content || message.toolRounds?.length),
        ) && (
          <div className="agent-waiting">
            {hasActiveReply(agent)
              ? "Здесь появятся действия и ответ агента."
              : "Агент ещё не вернул результат."}
          </div>
        )}
        </div>
      </div>
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      <div className="agent-panel-footer">
        <span>Контекст этой задачи</span>
        {hasActiveReply(agent) ? (
          <button
            className="secondary-button"
            disabled={stopping}
            onClick={async () => {
              setStopping(true);
              setError("");
              try {
                await onStop();
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setStopping(false);
              }
            }}
          >
            <Square size={12} />
            {stopping ? "Останавливается…" : "Остановить"}
          </button>
        ) : (
          <IconButton
            label="Копировать результат агента"
            disabled={
              !agent.messages.some(
                (message) => message.role === "assistant" && message.content,
              )
            }
            onClick={() =>
              onCopy(
                agent.messages
                  .filter((message) => message.role === "assistant")
                  .map((message) => message.content)
                  .join("\n\n"),
              )
            }
          >
            <Copy size={15} />
          </IconButton>
        )}
      </div>
      <form className="agent-followup" onSubmit={e=>{e.preventDefault();void unwrap(bridge.workspace(agent.rootSessionId,'agentMessage',{id:agent.id,message:followup})).then(()=>setFollowup('')).catch(e=>setError(e.message));}}><input value={followup} onChange={e=>setFollowup(e.target.value)} placeholder="Уточнение или новая задача агенту"/><button className="secondary-button" disabled={!followup.trim()}>Отправить</button></form>
    </motion.aside>
  );
}
