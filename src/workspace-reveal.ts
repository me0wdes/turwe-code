import type { Session, WorkspaceReveal } from "./types";

export type RevealEvent = WorkspaceReveal & { id: string; sessionId: string };

// Seed history once. Later completions wait for their own chat to become visible.
export function createRevealTracker() {
  let initialized = false;
  const seen = new Set<string>();
  const pending = new Map<string, Map<string, RevealEvent>>();
  return {
    observe(sessions: Session[]) {
      const liveSessions = new Set(sessions.map((session) => session.id));
      for (const id of pending.keys())
        if (!liveSessions.has(id)) pending.delete(id);
      for (const session of sessions) {
        for (const message of session.messages) {
          for (const round of message.toolRounds || []) {
            for (const call of round.calls) {
              if (
                call.status !== "complete" ||
                !call.reveal ||
                !["preview", "files", "changes", "terminal"].includes(
                  call.reveal.panel,
                )
              )
                continue;
              // Branches retain message/call IDs; copied history is not a new action.
              const sourceId = `${message.id}:${call.id}`;
              const id = `${session.id}:${sourceId}`;
              if (seen.has(sourceId)) continue;
              seen.add(sourceId);
              if (!initialized || session.archived) continue;
              const items =
                pending.get(session.id) || new Map<string, RevealEvent>();
              items.delete(call.reveal.panel);
              items.set(call.reveal.panel, {
                ...call.reveal,
                id,
                sessionId: session.id,
              });
              pending.set(session.id, items);
            }
          }
        }
      }
      initialized = true;
    },
    take(sessionId: string): RevealEvent[] {
      const items = [...(pending.get(sessionId)?.values() || [])];
      pending.delete(sessionId);
      return items;
    },
  };
}
