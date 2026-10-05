import { useId, useLayoutEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import {
  Code2,
  ChevronRight,
  FileText,
  Folder,
  Search,
  Upload,
  Sparkles,
} from "../icons";
import { toolActivity } from "../activity";
import { useChatMotion } from "../chat-motion";
import { fluid } from "../motion";
import type { ApprovalChoice, QuestionResponse, ToolCall } from "../types";
import { ApprovalActions } from "./ApprovalActions";
import { QuestionCard } from "./QuestionCard";
import { SetupCard } from './SetupCard';
import { AttachmentCard, attachmentKey } from "./Attachments";

type Props = {
  calls: ToolCall[];
  draftKey: string;
  sessionId: string;
  retrySessionId?: string;
  onError: (message: string) => void;
  onApprove: (callId: string, allowed: boolean, remember?: ApprovalChoice) => void;
  onAnswer: (callId: string, response: QuestionResponse) => Promise<void>;
  onAgentOpen?: (id: string) => void;
};
const icons = {
  file: FileText,
  folder: Folder,
  search: Search,
  upload: Upload,
  skills: Sparkles,
  tool: Code2,
};

function ActionLabel({
  call,
  open = false,
}: {
  call: ToolCall;
  open?: boolean;
}) {
  const activity = toolActivity(call);
  const Icon = icons[activity.icon];
  return (
    <>
      <Icon
        size={16}
        active={open || call.status === "running"}
        className="action-icon"
      />
      <span className="action-copy">
        <span className="action-label">{activity.label}</span>
        {activity.detail && (
          <span className="action-context">{activity.detail}</span>
        )}
      </span>
      {activity.status && (
        <span className="action-state">{activity.status}</span>
      )}
      <ChevronRight size={12} className="action-chevron" />
    </>
  );
}

function ToolAction({
  call,
  onApprove,
  onAgentOpen,
}: {
  call: ToolCall;
  onApprove: Props["onApprove"];
  onAgentOpen: Props["onAgentOpen"];
}) {
  const animated = useChatMotion();
  const disclosureId = useId();
  const [open, setOpen] = useState(call.status === "approval");
  const [contentHeight, setContentHeight] = useState(0);
  const trigger = useRef<HTMLButtonElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const contentHadFocus = useRef(false);
  const previousStatus = useRef(call.status);
  // A permission request expands once; streaming updates don't fight the user's choice.
  useLayoutEffect(() => {
    if (call.status === "approval") setOpen(true);
    else if (previousStatus.current === "approval") {
      // Approval buttons disappear when resolved. Keep keyboard focus on their disclosure.
      if (
        content.current?.contains(document.activeElement) ||
        (contentHadFocus.current && document.activeElement === document.body)
      ) {
        trigger.current?.focus({ preventScroll: true });
      }
      contentHadFocus.current = false;
      setOpen(false);
    }
    previousStatus.current = call.status;
  }, [call.status]);
  const agentLink = !!call.agentIds?.length && !!onAgentOpen;
  useLayoutEffect(() => {
    const node = content.current;
    if (!node || !open) return;
    // offsetHeight stays correct while the parent message is scaling on entry.
    const measure = () => setContentHeight(node.offsetHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [agentLink, open]);
  const activity = toolActivity(call);
  const title = [activity.label, activity.detail, activity.status]
    .filter(Boolean)
    .join(" — ");
  if (agentLink)
    return (
      <button
        type="button"
        className={`agent-history-link action-row ${call.status}`}
        title={title}
        data-motion={animated ? "on" : "off"}
        onClick={() => onAgentOpen!(call.agentIds![0])}
      >
        <ActionLabel call={call} />
        <span className="sr-only">Открыть субагентов</span>
      </button>
    );
  return (
    <div className={`tool-call ${call.status}`} data-open={open}>
      <button
        type="button"
        ref={trigger}
        id={`${disclosureId}-trigger`}
        className={`action-row ${call.status}`}
        title={title}
        data-motion={animated ? "on" : "off"}
        aria-expanded={open}
        aria-controls={`${disclosureId}-panel`}
        onClick={() => setOpen((value) => !value)}
      >
        <ActionLabel call={call} open={open} />
      </button>
      <motion.div
        className="tool-call-panel"
        id={`${disclosureId}-panel`}
        aria-labelledby={`${disclosureId}-trigger`}
        aria-hidden={!open}
        inert={!open}
        initial={false}
        animate={{ height: open ? contentHeight : 0 }}
        transition={animated ? fluid.moderate : { duration: 0 }}
      >
        <div
          ref={content}
          className="tool-call-measure"
          onFocusCapture={() => {
            contentHadFocus.current = true;
          }}
          onBlurCapture={(event) => {
            if (
              event.relatedTarget &&
              !event.currentTarget.contains(event.relatedTarget as Node)
            ) {
              contentHadFocus.current = false;
            }
          }}
        >
          <motion.div
            className="tool-call-detail"
            initial={false}
            animate={{
              opacity: open ? 1 : 0,
              transform:
                !animated || open ? "translateY(0px)" : "translateY(-3px)",
            }}
            transition={
              animated
                ? { ...fluid.fast, delay: open ? 0.06 : 0 }
                : { duration: 0 }
            }
          >
            <strong>{call.toolName || call.name}</strong>
            <pre>
              {(() => {
                try {
                  return JSON.stringify(JSON.parse(call.arguments), null, 2);
                } catch {
                  return call.arguments;
                }
              })()}
            </pre>
            {call.review && (
              <p className="tool-review" role={call.review.status === "checking" ? "status" : undefined}>
                {call.review.status === "checking" ? "Проверка безопасности" : call.review.status === "allowed" ? "Проверка разрешила этот вызов" : "Проверка не разрешила вызов"}
                {call.review.model && ` · ${call.review.model}`}
                {call.review.reason && `: ${call.review.reason}`}
              </p>
            )}
            {call.status === "approval" ? (
              <div className="tool-approval">
                <p>
                  {call.approvalReason ||
                    "Проверьте параметры и подтвердите запуск инструмента."}
                </p>
                <ApprovalActions call={call} onApprove={onApprove} />
              </div>
            ) : call.result ? (
              <pre className="tool-result">{call.result}</pre>
            ) : null}
            {!!call.attachments?.length && (
              <div className="attachment-list">
                {call.attachments.map((file) => (
                  <AttachmentCard file={file} key={attachmentKey(file)} />
                ))}
              </div>
            )}
          </motion.div>
        </div>
      </motion.div>
    </div>
  );
}

export function ToolCalls({
  calls,
  draftKey,
  sessionId,
  retrySessionId,
  onError,
  onApprove,
  onAnswer,
  onAgentOpen,
}: Props) {
  if (!calls.length) return null;
  return (
    <div className="tool-calls" aria-label="Действия агента">
      {calls.map((call) =>
        call.questions ? (
          <QuestionCard
            key={call.id}
            draftKey={`${draftKey}-${call.id}`}
            call={call}
            onAnswer={(response) => onAnswer(call.id, response)}
          />
        ) : call.setup ? (
          <SetupCard key={call.id} call={call} sessionId={sessionId} retrySessionId={retrySessionId} onApprove={onApprove} onError={onError} />
        ) : (
          <ToolAction
            key={call.id}
            call={call}
            onApprove={onApprove}
            onAgentOpen={onAgentOpen}
          />
        ),
      )}
    </div>
  );
}
