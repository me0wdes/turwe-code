import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { bridge, unwrap } from "../bridge";
import type { AppState, Session } from "../types";
import { Code2, Square, Plus } from "../icons";
import { isMac } from "../platform";
import type { RevealEvent } from "../workspace-reveal";
export function WorkspaceTerminal({
  session,
  state,
  onError,
  reveal,
}: {
  session: Session;
  state: AppState;
  onError: (s: string) => void;
  reveal?: RevealEvent;
}) {
  const [id, setId] = useState(""),
    [command, setCommand] = useState("");
  const root = useRef<HTMLDivElement>(null),
    term = useRef<Terminal>(undefined),
    rendered = useRef("");
  const processes = (state.processes || []).filter(
      (p) => p.rootSessionId === session.id,
    ),
    selected = processes.find((p) => p.id === id);
  const call = async (op: string, args: Record<string, unknown> = {}) => {
    try {
      return await unwrap(bridge.workspace(session.id, op, args));
    } catch (e) {
      onError((e as Error).message);
    }
  };
  useEffect(() => {
    if (reveal?.processId) setId(reveal.processId);
  }, [reveal?.id]);
  useEffect(() => {
    if (!root.current || !selected?.terminal) return;
    const terminal = new Terminal({
      fontFamily: "Consolas, monospace",
      fontSize: 12,
      theme: { background: "#181818", foreground: "#dedede" },
      cursorBlink: true,
      convertEol: true,
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(root.current);
    fit.fit();
    term.current = terminal;
    rendered.current = "";
    terminal.onData((data) => {
      void call("terminalInput", { id, data });
    });
    const resize = new ResizeObserver(() => {
      fit.fit();
      void call("terminalResize", {
        id,
        cols: terminal.cols,
        rows: terminal.rows,
      });
    });
    resize.observe(root.current);
    return () => {
      resize.disconnect();
      terminal.dispose();
      term.current = undefined;
    };
  }, [id, selected?.terminal]);
  useEffect(() => {
    if (term.current && selected) {
      if (!selected.output.startsWith(rendered.current)) {
        term.current.reset();
        rendered.current = "";
      }
      term.current.write(selected.output.slice(rendered.current.length));
      rendered.current = selected.output;
    }
  }, [selected?.output, id]);
  return (
    <div className="terminal-tab">
      <div className="workbench-actions">
        <button
          className="secondary-button"
          onClick={() =>
            void call("terminal", {
              shell: isMac(state.platform) ? "zsh" : "powershell",
            }).then((p) => p && setId(p.id))
          }
        >
          <Plus size={14} />
          {isMac(state.platform) ? "Zsh" : "PowerShell"}
        </button>
        <button
          className="secondary-button"
          onClick={() =>
            void call("terminal", { shell: "bash" }).then(
              (p) => p && setId(p.id),
            )
          }
        >
          Bash
        </button>
        {selected?.status === "running" && (
          <button
            className="quiet-control"
            onClick={() => void call("stopProcess", { id })}
          >
            <Square size={13} />
            Остановить
          </button>
        )}
      </div>
      <div className="process-tabs">
        {processes.map((p) => (
          <button
            key={p.id}
            className={p.id === id ? "active" : ""}
            onClick={() => setId(p.id)}
          >
            <Code2 size={12} />
            {p.command.slice(0, 35)}
            <small>
              {p.status === "running"
                ? "Работает"
                : `exit ${p.exitCode ?? "—"}`}
            </small>
          </button>
        ))}
      </div>
      {selected?.terminal ? (
        <div className="xterm-container" ref={root} />
      ) : (
        <pre className="process-output">
          {selected?.output ||
            "Запустите терминал или команду. Вывод появится здесь."}
        </pre>
      )}
      <form
        className="side-chat-form"
        onSubmit={(e) => {
          e.preventDefault();
          void call("command", { command }).then((p) => {
            if (p) {
              setId(p.id);
              setCommand("");
            }
          });
        }}
      >
        <input
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          placeholder={session.projectId ? "Команда в папке проекта" : "Команда на этом компьютере"}
        />
        <button className="secondary-button" disabled={!command.trim()}>
          <Code2 size={14} />
          Запустить
        </button>
      </form>
      <p className="field-hint">
        Команды выполняются с правами текущего пользователя.
      </p>
    </div>
  );
}
