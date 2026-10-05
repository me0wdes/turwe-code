import { useId, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  Check,
  ChevronDown,
  Code2,
  ExternalLink,
  LoaderCircle,
  RefreshCw,
  Sparkles,
  X,
} from "../icons";
import { bridge, unwrap } from "../bridge";
import { useChatMotion } from "../chat-motion";
import { fluid } from "../motion";
import type { ToolCall } from "../types";
import "./setup-card.css";

export function SetupCard({
  call,
  sessionId,
  retrySessionId = sessionId,
  onApprove,
  onError,
}: {
  call: ToolCall;
  sessionId: string;
  retrySessionId?: string;
  onApprove: (id: string, allowed: boolean) => void;
  onError: (message: string) => void;
}) {
  const setup = call.setup!;
  const animated = useChatMotion();
  const detailId = useId();
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [retried, setRetried] = useState(false);
  const connector = setup.kind === "connector";
  const active = call.status === "running";
  const signIn = active && setup.status === "authorizing";
  const done = call.status === "complete";
  const failed = call.status === "error";
  const stopped = ["stopped", "denied"].includes(call.status);
  const approval = call.status === "approval";
  const Icon = done
    ? Check
    : stopped
      ? X
      : active
        ? LoaderCircle
        : connector
          ? Code2
          : Sparkles;
  const status = done
    ? connector
      ? "Подключено"
      : setup.kind === "install"
        ? "Установлен"
        : "Создан"
    : stopped
      ? call.status === "denied"
        ? "Отклонено"
        : "Остановлено"
      : failed
        ? "Не удалось завершить"
        : signIn
          ? "Ожидает входа"
          : active
            ? connector
              ? "Подключение"
              : "Сохранение"
            : "Готово к подтверждению";
  const description = done
    ? connector
      ? `Инструментов доступно: ${setup.toolCount ?? 0}. Агент продолжит задачу.`
      : `Доступен в разделе «Скиллы». Вызов в чате: @${setup.title}.`
    : signIn
      ? "Войдите в аккаунт в открывшемся браузере. После входа продолжим автоматически."
      : failed
        ? setup.error || call.result || "Попробуйте ещё раз."
        : call.status === "denied"
          ? call.result || "Действие отклонено."
          : stopped
            ? "Действие не завершено. Повторить его можно новым сообщением."
            : setup.description;
  const run = async (operation: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    try {
      await operation();
    } catch (error) {
      onError((error as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <motion.section
      className="chat-setup"
      aria-label={`${connector ? "Подключение" : "Скилл"}: ${setup.title}`}
      initial={animated ? { opacity: 0, y: 5 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={fluid.fast}
    >
      <div className="chat-setup-heading">
        <span className="chat-setup-icon">
          <Icon
            size={20}
            active={done || active}
            className={active && !signIn ? "spin" : undefined}
          />
        </span>
        <div>
          <strong>{setup.title}</strong>
          <span className="chat-setup-status" role="status">
            {status}
          </span>
        </div>
        {!connector && setup.scope && (
          <span className="chat-setup-scope">{setup.scope}</span>
        )}
      </div>
      {setup.endpoint && (
        <span className="chat-setup-endpoint">{setup.endpoint}</span>
      )}
      <p className={failed ? "chat-setup-error" : undefined}>{description}</p>
      {setup.source && (
        <>
          <button
            className="chat-setup-disclosure"
            aria-expanded={expanded}
            aria-controls={detailId}
            onClick={() => setExpanded((v) => !v)}
          >
            <ChevronDown
              size={14}
              style={{ transform: expanded ? "rotate(180deg)" : undefined }}
            />{" "}
            Инструкции скилла
          </button>
          <AnimatePresence initial={false}>
            {expanded && (
              <motion.div
                id={detailId}
                className="chat-setup-source"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={animated ? fluid.moderate : { duration: 0 }}
              >
                <pre>{setup.source}</pre>
              </motion.div>
            )}
          </AnimatePresence>
        </>
      )}
      <div className="chat-setup-actions">
        {approval && (
          <>
            <button
              className="primary-button"
              onClick={() => onApprove(call.id, true)}
            >
              {connector
                ? "Подключить"
                : setup.kind === "install"
                  ? "Установить скилл"
                  : "Создать скилл"}
            </button>
            <button
              className="secondary-button"
              onClick={() => onApprove(call.id, false)}
            >
              Отмена
            </button>
          </>
        )}
        {signIn && setup.connectorId && (
          <button
            className="primary-button"
            disabled={busy}
            onClick={() =>
              void run(() =>
                unwrap(bridge.reopenConnectorAuthorization(setup.connectorId!)),
              )
            }
          >
            <ExternalLink size={15} /> Открыть вход
          </button>
        )}
        {active && (
          <button
            className="secondary-button"
            disabled={busy}
            onClick={() => void run(() => unwrap(bridge.stop(sessionId)))}
          >
            Остановить
          </button>
        )}
        {failed && connector && (
          <button
            className="secondary-button"
            disabled={busy || retried}
            onClick={() =>
              void run(async () => {
                await unwrap(
                  bridge.send(
                    retrySessionId,
                    `Повтори подключение к «${setup.title}» и после успешного входа продолжи мою исходную задачу.`,
                    [],
                  ),
                );
                setRetried(true);
              })
            }
          >
            <RefreshCw size={14} />
            {retried ? "Запрос отправлен" : "Попробовать снова"}
          </button>
        )}
        {setup.helpUrl && failed && (
          <a
            className="chat-setup-help"
            href={setup.helpUrl}
            target="_blank"
            rel="noreferrer"
          >
            <ExternalLink size={14} /> Помощь с подключением
          </a>
        )}
        {failed && setup.alternative === "figma-desktop" && (
          <button
            className="secondary-button"
            disabled={busy || retried}
            onClick={() =>
              void run(async () => {
                await unwrap(
                  bridge.send(
                    retrySessionId,
                    "Подключи локальный MCP-сервер Figma Desktop вместо удалённого и продолжи исходную задачу с доступными инструментами.",
                    [],
                  ),
                );
                setRetried(true);
              })
            }
          >
            <Code2 size={14} /> Подключить Figma Desktop
          </button>
        )}
      </div>
    </motion.section>
  );
}
