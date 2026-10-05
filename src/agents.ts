import type { AgentRun, Message, MessageStatus, Session } from "./types";

export function agentsIn(messages: Message[]): AgentRun[] {
  return messages.flatMap((message) =>
    (message.agents || []).flatMap((agent) => [
      agent,
      ...agentsIn(agent.messages),
    ]),
  );
}
export const activeStatuses: MessageStatus[] = [
  "queued",
  "connecting",
  "streaming",
  "working",
  "approval",
  "question",
];
export function lastReply(session: Session): Message | undefined {
  for (let index = session.messages.length - 1; index >= 0; index--) {
    if (session.messages[index].role === "assistant")
      return session.messages[index];
  }
}
export const hasActiveReply = (session?: Session) =>
  !!session?.messages.some((message) =>
    activeStatuses.includes(message.status!),
  );
export function agentStatus(session: Session): MessageStatus {
  const status = lastReply(session)?.status || "queued";
  if (activeStatuses.includes(status)) {
    for (const child of agentsIn(session.messages)) {
      const childStatus = lastReply(child)?.status;
      if (childStatus === "question" || childStatus === "approval")
        return childStatus;
    }
  }
  return status;
}
export const statusLabels: Record<MessageStatus, string> = {
  queued: "В очереди",
  connecting: "Подключается…",
  streaming: "Формирует ответ…",
  working: "Работает…",
  approval: "Нужно разрешение",
  question: "Нужен ответ",
  complete: "Готово",
  stopped: "Остановлен",
  error: "Ошибка",
};
export function agentAction(session: Session): string {
  const status = agentStatus(session);
  if (status !== "working") return statusLabels[status];
  const call = lastReply(session)
    ?.toolRounds?.flatMap((round) => round.calls)
    .find((call) => call.status === "running");
  if (call?.agentIds?.length) return "Ожидает субагентов…";
  return call ? call.label || call.name : statusLabels[status];
}
