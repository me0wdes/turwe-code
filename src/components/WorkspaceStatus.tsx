import { useState } from "react";
import { bridge, unwrap } from "../bridge";
import type { AppState, Session } from "../types";
import { Check, Code2, Square } from "../icons";
import { McpForm } from "./McpForm";
export function WorkspaceStatus({
  session,
  state,
  onNavigate,
  onError,
}: {
  session: Session;
  state: AppState;
  onNavigate: (id: string) => void;
  onError: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const forms = (state.mcpForms || []).filter(
    (form) => form.sessionId === session.id,
  );
  const run = async (operation: string, args?: Record<string, unknown>) => {
    setBusy(true);
    try {
      return await unwrap(bridge.workspace(session.id, operation, args));
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  if (
    session.plan?.status !== "awaiting" &&
    !forms.length &&
    !session.parentSessionId
  )
    return null;
  return (
    <div className="workspace-status">
      {session.plan?.status === "awaiting" && (
        <div className="plan-approval">
          <div>
            <Code2 size={16} />
            <strong>План готов к проверке</strong>
          </div>
          <pre>{session.plan.text}</pre>
          <button
            className="primary-button"
            disabled={busy}
            onClick={() => void run("approvePlan")}
          >
            <Check size={15} />
            Утвердить и выполнить
          </button>
        </div>
      )}
      {forms.map((form) => (
        <McpForm key={form.id} form={form} onError={onError} />
      ))}
      {session.parentSessionId && (
        <button
          className="quiet-control"
          onClick={() => onNavigate(session.parentSessionId!)}
        >
          <Square size={12} />
          Вернуться в основной чат
        </button>
      )}
    </div>
  );
}
