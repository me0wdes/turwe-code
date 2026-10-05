import { useId, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Code2,
  AlertCircle,
  Square,
} from "../icons";
import type { AgentRun, MessageStatus, Session } from "../types";
import {
  activeStatuses,
  agentAction,
  agentStatus,
  agentsIn,
  lastReply,
  statusLabels,
} from "../agents";
import { fluid } from "../motion";

export function AgentStatus({ status }: { status: MessageStatus }) {
  const attention = status === "approval" || status === "question";
  return (
    <span
      className={`agent-state ${attention ? "attention" : status}`}
      title={statusLabels[status]}
      aria-label={statusLabels[status]}
    >
      {status === "complete" ? (
        <Check size={13} />
      ) : status === "error" ? (
        <AlertCircle size={14} />
      ) : status === "stopped" ? (
        <Square size={10} />
      ) : (
        <span
          className={`status-dot ${attention ? "attention" : status === "queued" ? "queued" : "working"}`}
        />
      )}
    </span>
  );
}
export function AgentRows({
  agents,
  selectedId,
  onOpen,
  level = 0,
}: {
  agents: AgentRun[];
  selectedId?: string | null;
  onOpen: (id: string) => void;
  level?: number;
}) {
  return (
    <>
      {agents.map((agent) => (
        <div
          className={`agent-tree-node ${level ? "nested" : ""}`}
          key={agent.id}
        >
          <button
            className={`agent-row ${selectedId === agent.id ? "selected" : ""}`}
            onClick={() => onOpen(agent.id)}
            aria-pressed={selectedId === agent.id}
          >
            <AgentStatus status={agentStatus(agent)} />
            <span className="agent-row-copy">
              <strong>{agent.title}</strong>
              <small>{agentAction(agent)}</small>
            </span>
            <ChevronRight size={13} className="agent-row-arrow" />
          </button>
          <AgentRows
            agents={agent.messages.flatMap((message) => message.agents || [])}
            selectedId={selectedId}
            onOpen={onOpen}
            level={level + 1}
          />
        </div>
      ))}
    </>
  );
}
export function AgentActivity({
  session,
  selectedId,
  onOpen,
  onMain,
  motionEnabled,
}: {
  session: Session;
  selectedId: string | null;
  onOpen: (id: string) => void;
  onMain: () => void;
  motionEnabled: boolean;
}) {
  const [expanded, setExpanded] = useState(true);
  const listId = useId();
  const reducedMotion = useReducedMotion() || !motionEnabled;
  const reply = lastReply(session),
    children = reply?.agents || [],
    all = agentsIn(reply ? [reply] : []);
  if (!all.length) return null;
  const attention = all.filter((agent) =>
    ["approval", "question"].includes(agentStatus(agent)),
  );
  const active = all.filter((agent) =>
    activeStatuses.includes(agentStatus(agent)),
  ).length;
  const finished = all.filter(
    (agent) => agentStatus(agent) === "complete",
  ).length;
  return (
    <section className="agent-activity" aria-label="Работа агентов">
      <div className="agent-activity-heading">
        <button
          className="agent-activity-toggle"
          aria-expanded={expanded}
          aria-controls={listId}
          onClick={() => setExpanded((value) => !value)}
        >
          <Code2 size={16} active={active > 0} />
          <strong>Агенты</strong>
          <span className="agent-count">{all.length}</span>
          <span className="agent-summary">
            {attention.length
              ? "Нужно ваше действие"
              : active
                ? `${active} в работе`
                : `${finished} из ${all.length} завершено`}
          </span>
          <ChevronDown size={14} className={expanded ? "expanded" : ""} />
        </button>
        {!expanded && attention.length > 0 && (
          <button
            className="agent-attention-link"
            onClick={() =>
              onOpen(
                attention.find((agent) =>
                  ["question", "approval"].includes(
                    lastReply(agent)?.status || "",
                  ),
                )?.id || attention[0].id,
              )
            }
          >
            Открыть
          </button>
        )}
      </div>
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            id={listId}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={reducedMotion ? { duration: 0 } : fluid.moderate}
            className="agent-tree-wrap"
          >
            <div className="agent-tree">
              <button className="agent-row agent-main-row" onClick={onMain}>
                <AgentStatus status={agentStatus(session)} />
                <span className="agent-row-copy">
                  <strong>Основной агент</strong>
                  <small>{agentAction(session)}</small>
                </span>
                <span className="agent-main-label">Turwe</span>
              </button>
              <AgentRows
                agents={children}
                selectedId={selectedId}
                onOpen={onOpen}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
