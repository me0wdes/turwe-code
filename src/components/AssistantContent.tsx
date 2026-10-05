import { Fragment } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Copy } from "../icons";
import { assistantSteps } from "../activity";
import type { Message, QuestionResponse } from "../types";
import { IconButton } from "./Primitives";
import { ToolCalls } from "./ToolCalls";

export function AssistantContent({
  message,
  draftKey,
  sessionId,
  retrySessionId,
  onError,
  onApprove,
  onAnswer,
  onAgentOpen,
  onCopy,
}: {
  message: Message;
  draftKey: string;
  sessionId: string;
  retrySessionId?: string;
  onError: (message: string) => void;
  onApprove: (callId: string, allowed: boolean) => void;
  onAnswer: (callId: string, response: QuestionResponse) => Promise<void>;
  onAgentOpen: (id: string) => void;
  onCopy: (text: string) => void;
}) {
  return (
    <div className="assistant-timeline">
      {assistantSteps(message).map((step) => (
        <Fragment key={step.key}>
          {step.type === "tools" ? (
            <ToolCalls calls={step.calls} draftKey={draftKey} sessionId={sessionId} retrySessionId={retrySessionId} onError={onError} onApprove={onApprove} onAnswer={onAnswer} onAgentOpen={onAgentOpen} />
          ) : (
            <div className="assistant-text">
              <Markdown
                remarkPlugins={[remarkGfm]}
                components={{
                  a: ({ children, href }) => <a href={href} target="_blank" rel="noreferrer">{children}</a>,
                  img: ({ alt }) => <span className="image-placeholder">{alt || "Изображение"}</span>,
                  pre: ({ children }) => (
                    <div className="code-block">
                      <div className="code-heading">
                        <span>Код</span>
                        <IconButton label="Копировать код" onClick={(event) => {
                          const text = event.currentTarget.closest(".code-block")?.querySelector("code")?.textContent;
                          if (text) onCopy(text);
                        }}><Copy size={13} /></IconButton>
                      </div>
                      <pre>{children}</pre>
                    </div>
                  ),
                }}
              >{step.content}</Markdown>
            </div>
          )}
        </Fragment>
      ))}
    </div>
  );
}
