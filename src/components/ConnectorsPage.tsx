import { useState } from "react";
import { motion } from "motion/react";
import {
  Plus,
  Code2,
  Monitor,
  ExternalLink,
  Trash2,
  Pencil,
  RefreshCw,
} from "../icons";
import type { AppState, Connector, ConnectorInput } from "../types";
import { bridge, unwrap } from "../bridge";
import { Modal, IconButton } from "./Primitives";
import { Dropdown, Menu, MenuChoice } from "./Dropdown";
import { fluid } from "../motion";
const statusNames: Record<Connector["status"], string> = {
  disconnected: "Отключён",
  connecting: "Подключение…",
  authorizing: "Ожидает входа в браузере",
  connected: "Подключён",
  error: "Не удалось подключить",
};
const defaults: ConnectorInput = {
  name: "",
  type: "http",
  url: "",
  auth: "none",
};
export function ConnectorsPage({
  state,
  onState,
  notify,
}: {
  state: AppState;
  onState: (s: AppState) => void;
  notify: (s: string) => void;
}) {
  const [editing, setEditing] = useState<ConnectorInput | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(""),
    [args, setArgs] = useState("[]"),
    [env, setEnv] = useState("{}"),
    [removing, setRemoving] = useState<Connector | null>(null);
  async function action(id: string, work: () => Promise<unknown>) {
    setError("");
    setBusy(id);
    try {
      await work();
      onState(await unwrap(bridge.bootstrap()));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  function edit(c: ConnectorInput) {
    setError("");
    setEditing(c);
    setArgs(JSON.stringify(c.args || []));
    setEnv("{}");
  }
  async function save() {
    if (!editing) return;
    await action("editor", async () => {
      let input = { ...editing };
      if (input.type === "stdio") {
        const parsed = JSON.parse(args),
          environment = JSON.parse(env);
        if (!Array.isArray(parsed) || parsed.some((a) => typeof a !== "string"))
          throw new Error("Аргументы — массив строк JSON");
        if (
          !environment ||
          typeof environment !== "object" ||
          Array.isArray(environment)
        )
          throw new Error("Переменные — объект JSON");
        input = {
          ...input,
          args: parsed,
          ...(env.trim() !== "{}" ? { env: environment } : {}),
        };
      }
      await unwrap(bridge.saveConnector(input));
      setEditing(null);
      notify(
        "Коннектор сохранён. Нажмите «Подключить», чтобы включить инструменты.",
      );
    });
  }
  const preset = (remote: boolean) =>
    edit({
      name: remote ? "Figma Remote" : "Figma Desktop",
      type: "http",
      url: remote ? "https://mcp.figma.com/mcp" : "http://127.0.0.1:3845/mcp",
      auth: remote ? "oauth" : "none",
    });
  return (
    <motion.section
      className="connectors-page"
      initial={{ opacity: 0, y: 5 }}
      animate={{ opacity: 1, y: 0 }}
      transition={fluid.moderate}
    >
      <header className="skills-header">
        <div>
          <div className="eyebrow">
            <Code2 size={14} />
            Инструменты для ваших задач
          </div>
          <h1>Коннекторы</h1>
          <p>
            Подключите Figma и другие MCP-серверы.
            <br />
            Их инструменты станут доступны в чате.
          </p>
        </div>
        <button
          className="primary-button"
          onClick={() => edit({ ...defaults })}
        >
          <Plus size={16} />
          Добавить
        </button>
      </header>
      <div className="connector-presets">
        <button onClick={() => preset(false)}>
          <span className="connector-symbol">
            <Monitor size={23} />
          </span>
          <span>
            <strong>Figma Desktop</strong>
            <small>Макеты из открытого приложения Figma</small>
          </span>
          <Plus size={17} />
        </button>
        <button onClick={() => preset(true)}>
          <span className="connector-symbol">
            <ExternalLink size={22} />
          </span>
          <span>
            <strong>Figma Remote</strong>
            <small>Подключение через ваш аккаунт Figma</small>
          </span>
          <Plus size={17} />
        </button>
      </div>
      <div className="connector-section-label">
        <span>Ваши подключения</span>
        <span>{state.connectors.length}</span>
      </div>
      <div className="connector-list">
        {state.connectors.length ? (
          state.connectors.map((c) => (
            <div className="connector-row" key={c.id}>
              <div className="connector-symbol">
                <Code2 size={22} active={c.status === "connected"} />
              </div>
              <div className="connector-copy">
                <strong>{c.name}</strong>
                <span className={`connector-status ${c.status}`}>
                  <i />
                  {statusNames[c.status]}
                  {c.status === "connected"
                    ? ` · ${c.toolCount} инструментов`
                    : ""}
                </span>
                <small>{c.type === "http" ? c.url : c.command}</small>
                {c.error && (
                  <p className="error-text" role="alert">
                    {c.error}
                  </p>
                )}
              </div>
              <div className="connector-actions">
                <button
                  className="secondary-button"
                  disabled={
                    busy === c.id &&
                    !["connecting", "authorizing"].includes(c.status)
                  }
                  onClick={() =>
                    void action(c.id, () =>
                      unwrap(
                        c.status === "connected" ||
                          c.status === "authorizing" ||
                          c.status === "connecting"
                          ? bridge.disconnectConnector(c.id)
                          : bridge.connectConnector(c.id),
                      ),
                    )
                  }
                >
                  {busy === c.id && <RefreshCw size={13} className="spin" />}
                  {c.status === "connected"
                    ? "Отключить"
                    : ["connecting", "authorizing"].includes(c.status)
                      ? "Отменить"
                      : "Подключить"}
                </button>
                <IconButton
                  label={`Изменить ${c.name}`}
                  disabled={!!busy}
                  onClick={() =>
                    edit({
                      id: c.id,
                      name: c.name,
                      type: c.type,
                      url: c.url,
                      command: c.command,
                      args: c.args,
                      cwd: c.cwd,
                      auth: c.auth,
                    })
                  }
                >
                  <Pencil size={15} />
                </IconButton>
                <IconButton
                  label={`Удалить ${c.name}`}
                  disabled={!!busy}
                  onClick={() => setRemoving(c)}
                >
                  <Trash2 size={15} />
                </IconButton>
              </div>
            </div>
          ))
        ) : (
          <div className="connectors-empty">
            <Code2 size={27} />
            <strong>Рабочие приложения — рядом с чатом</strong>
            <p>
              Добавьте готовое подключение выше или адрес собственного
              MCP-сервера.
            </p>
          </div>
        )}
      </div>
      <div className="connector-help">
        <p>
          Для Figma Desktop откройте файл в приложении Figma и включите
          локальный MCP-сервер. Затем подключите его здесь и отправьте ссылку на
          макет в чат.
        </p>
        <a
          href="https://developers.figma.com/docs/figma-mcp-server/local-server-installation/"
          target="_blank"
          rel="noreferrer"
        >
          Инструкция Figma <ExternalLink size={12} />
        </a>
        <p>
          Удалённый Figma MCP может требовать клиент из каталога Figma. Если
          вход недоступен для Turwe, используйте Desktop.
        </p>
      </div>
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      <Modal
        open={!!editing}
        onOpenChange={(v) => {
          if (!v && busy !== "editor") setEditing(null);
        }}
        title={editing?.id ? "Настройки коннектора" : "Новый коннектор"}
        description="Инструменты включаются после подключения и доступны всем вашим сессиям."
        className="connector-dialog"
      >
        {editing && (
          <>
            <div className="connector-form-scroll">
              <label className="form-field">
                Название
                <input
                  value={editing.name}
                  onChange={(e) =>
                    setEditing({ ...editing, name: e.target.value })
                  }
                  placeholder="Например, Figma"
                />
              </label>
              <div className="segmented">
                <button
                  aria-pressed={editing.type === "http"}
                  onClick={() => setEditing({ ...editing, type: "http" })}
                >
                  Адрес MCP
                </button>
                <button
                  aria-pressed={editing.type === "stdio"}
                  onClick={() =>
                    setEditing({ ...editing, type: "stdio", auth: "none" })
                  }
                >
                  Локальная команда
                </button>
              </div>
              {editing.type === "http" ? (
                <>
                  <label className="form-field">
                    URL сервера
                    <input
                      value={editing.url || ""}
                      onChange={(e) =>
                        setEditing({ ...editing, url: e.target.value })
                      }
                      placeholder="https://example.com/mcp"
                    />
                  </label>
                  <div className="form-field">
                    <span>Авторизация</span>
                    <Dropdown
                      label="Авторизация MCP"
                      className="wide-trigger"
                      trigger={
                        <span>
                          {editing.auth === "oauth"
                            ? "Вход через браузер (OAuth)"
                            : editing.auth === "bearer"
                              ? "Токен доступа"
                              : "Без авторизации"}
                        </span>
                      }
                    >
                      <Menu.RadioGroup
                        value={editing.auth || "none"}
                        onValueChange={(auth) =>
                          setEditing({
                            ...editing,
                            auth: auth as Connector["auth"],
                          })
                        }
                      >
                        <MenuChoice value="none">Без авторизации</MenuChoice>
                        <MenuChoice value="oauth">
                          Вход через браузер (OAuth)
                        </MenuChoice>
                        <MenuChoice value="bearer">Токен доступа</MenuChoice>
                      </Menu.RadioGroup>
                    </Dropdown>
                  </div>
                  {editing.auth === "bearer" && (
                    <label className="form-field">
                      Токен доступа
                      <input
                        type="password"
                        autoComplete="off"
                        value={editing.bearerToken || ""}
                        onChange={(e) =>
                          setEditing({
                            ...editing,
                            bearerToken: e.target.value,
                          })
                        }
                        placeholder={
                          editing.id
                            ? "Сохранён. Введите, чтобы заменить"
                            : "Токен MCP-сервера"
                        }
                      />
                    </label>
                  )}
                </>
              ) : (
                <>
                  <label className="form-field">
                    Команда или путь к программе
                    <input
                      value={editing.command || ""}
                      onChange={(e) =>
                        setEditing({ ...editing, command: e.target.value })
                      }
                      placeholder="node"
                    />
                  </label>
                  <label className="form-field">
                    Аргументы · массив JSON
                    <textarea
                      rows={2}
                      value={args}
                      onChange={(e) => setArgs(e.target.value)}
                      placeholder={'["C:/tools/server.js"]'}
                    />
                  </label>
                  <label className="form-field">
                    Рабочая папка · необязательно
                    <input
                      value={editing.cwd || ""}
                      onChange={(e) =>
                        setEditing({ ...editing, cwd: e.target.value })
                      }
                      placeholder="C:/tools"
                    />
                  </label>
                  <label className="form-field">
                    Переменные окружения · объект JSON
                    <textarea
                      rows={2}
                      value={env}
                      onChange={(e) => setEnv(e.target.value)}
                      spellCheck={false}
                    />
                  </label>
                  <p className="field-hint">
                    Команда запускается только по кнопке «Подключить».
                    Используйте установленный MCP-сервер.
                  </p>
                </>
              )}
              <p className="field-hint">
                Ключи и токены шифруются средствами операционной системы и остаются на этом
                компьютере.
              </p>
              {error && (
                <p className="error-text" role="alert">
                  {error}
                </p>
              )}
            </div>
            <div className="dialog-footer">
              <button
                className="secondary-button"
                disabled={busy === "editor"}
                onClick={() => setEditing(null)}
              >
                Отмена
              </button>
              <button
                className="primary-button"
                disabled={busy === "editor" || !editing.name.trim()}
                onClick={() => void save()}
              >
                {busy === "editor" ? "Сохраняем…" : "Сохранить"}
              </button>
            </div>
          </>
        )}
      </Modal>
      <Modal
        open={!!removing}
        onOpenChange={(v) => {
          if (!v) setRemoving(null);
        }}
        title="Удалить коннектор?"
        description={`Подключение ${removing?.name || ""} будет отключено, его сохранённые токены удалены.`}
      >
        <div className="dialog-footer">
          <button
            className="secondary-button"
            onClick={() => setRemoving(null)}
          >
            Отмена
          </button>
          <button
            className="primary-button"
            onClick={() => {
              if (removing)
                void action(removing.id, async () => {
                  await unwrap(bridge.removeConnector(removing.id));
                  setRemoving(null);
                });
            }}
          >
            Удалить
          </button>
        </div>
      </Modal>
    </motion.section>
  );
}
