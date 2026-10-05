import { useId, useState } from "react";
import { KeyRound, Volume2, Check, LoaderCircle, Eye, EyeOff, ChevronRight } from "../icons";
import { motion } from "motion/react";
import type { AppState, SettingsInput } from "../types";
import { ModelsSettings } from "./ModelsSettings";
import { EffortMenu } from './EffortMenu';
import { ThemePicker } from "./ThemePicker";
import { UpdateSettings } from "./AppUpdates";
import { bridge, unwrap } from "../bridge";
import { Modal, IconButton } from "./Primitives";
import { configureSound, unlockSound, playSound } from "../sound";
import { fluid } from "../motion";
import { APP_VERSION } from "../version";

export type SettingsTab = "connection" | "models" | "appearance";
const tabs = [
  { id: "connection", name: "Подключение" },
  { id: "models", name: "Модели" },
  { id: "appearance", name: "Интерфейс" },
] as const;
interface Props {
  state: AppState;
  initialTab?: SettingsTab;
  onState: (state: AppState) => void;
  open: boolean;
  onClose: () => void;
  notify: (message: string) => void;
}
export function SettingsDialog({
  state,
  initialTab = "connection",
  onState,
  open,
  onClose,
  notify,
}: Props) {
  const [tab, setTab] = useState<SettingsTab>(initialTab),
    [url, setUrl] = useState(state.settings.baseUrl),
    [key, setKey] = useState(""),
    [showKey, setShowKey] = useState(false),
    [busy, setBusy] = useState(false),
    [status, setStatus] = useState(""),
    [error, setError] = useState("");
  const tabId = useId();
  const connectionChanged =
    url.replace(/\/+$/, "") !== state.settings.baseUrl || !!key;
  async function save(input: SettingsInput, close = false) {
    setBusy(true);
    setError("");
    try {
      const next = await unwrap(bridge.saveSettings(input));
      onState(next);
      if ("baseUrl" in input || "key" in input) {
        setKey("");
        setUrl(next.settings.baseUrl);
        setStatus("");
      }
      if (close) {
        notify("Настройки сохранены");
        onClose();
      }
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function connect() {
    setBusy(true);
    setError("");
    setStatus("");
    try {
      const next = await unwrap(
        bridge.saveSettings({ baseUrl: url, ...(key ? { key } : {}) }),
      );
      onState(next);
      setKey("");
      setUrl(next.settings.baseUrl);
      await unwrap(bridge.getModels());
      setStatus(
        "Подключение работает. Перейдите в «Модели», чтобы настроить свой список.",
      );
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function changeTab(next: SettingsTab) {
    setTab(next);
    setError("");
  }
  return (
    <Modal
      open={open}
      onOpenChange={(value) => {
        if (!value && !busy) onClose();
      }}
      title="Настройки"
      description="Ваше подключение, модели и рабочее пространство."
      className="settings-dialog"
    >
      <div
        className="settings-tabs"
        role="tablist"
        aria-label="Раздел настроек"
      >
        <motion.span
          className="settings-tab-indicator"
          aria-hidden="true"
          initial={false}
          animate={{ x: `${tabs.findIndex((item) => item.id === tab) * 100}%` }}
          transition={fluid.moderate}
        />
        {tabs.map((item, index) => (
          <button
            key={item.id}
            id={`${tabId}-${item.id}`}
            role="tab"
            aria-selected={tab === item.id}
            aria-controls={`${tabId}-panel`}
            tabIndex={tab === item.id ? 0 : -1}
            onClick={() => changeTab(item.id)}
            onKeyDown={(event) => {
              let target = index;
              if (event.key === "ArrowRight")
                target = (index + 1) % tabs.length;
              else if (event.key === "ArrowLeft")
                target = (index + tabs.length - 1) % tabs.length;
              else if (event.key === "Home") target = 0;
              else if (event.key === "End") target = tabs.length - 1;
              else return;
              event.preventDefault();
              changeTab(tabs[target].id);
              document.getElementById(`${tabId}-${tabs[target].id}`)?.focus();
            }}
          >
            {item.name}
          </button>
        ))}
      </div>
      <div
        className="settings-content"
        role="tabpanel"
        id={`${tabId}-panel`}
        aria-labelledby={`${tabId}-${tab}`}
      >
        {tab === "connection" ? (
          <div className="connection-settings">
            <div className="settings-section-title">
              <KeyRound size={17} />
              <span>API-подключение</span>
              <span
                className={`connection-badge ${state.hasKey ? "connected" : ""}`}
              >
                <span className="status-dot" />
                {state.hasKey ? "Ключ сохранён" : "Нужен ключ"}
              </span>
            </div>
            <label className="field-label">
              Адрес API
              <input
                value={url}
                disabled={busy}
                onChange={(event) => {
                  setUrl(event.target.value);
                  setStatus("");
                }}
                placeholder="https://ai.lab.pics/v1"
                spellCheck={false}
              />
            </label>
            <label className="field-label">
              Ключ API
              <div className="key-input">
                <input
                  type={showKey ? "text" : "password"}
                  disabled={busy}
                  value={key}
                  onChange={(event) => {
                    setKey(event.target.value);
                    setStatus("");
                  }}
                  placeholder={
                    state.hasKey
                      ? "Сохранён на компьютере. Введите, чтобы заменить"
                      : "Вставьте ключ API"
                  }
                  autoComplete="off"
                  spellCheck={false}
                />
                <IconButton
                  label={showKey ? "Скрыть ключ" : "Показать ключ"}
                  onClick={() => setShowKey((value) => !value)}
                  aria-pressed={showKey}
                >
                  {showKey ? <EyeOff size={15} /> : <Eye size={15} />}
                </IconButton>
              </div>
            </label>
            <p className="field-hint">
              Ключ шифруется средствами операционной системы и остаётся на этом компьютере.
            </p>
            {url.replace(/\/+$/, "") !== state.settings.baseUrl && (
              <p className="field-hint accent-text">
                Для другого адреса API потребуется заново указать ключ.
              </p>
            )}
            <div className="settings-connect">
              <button
                className="secondary-button"
                onClick={() => void connect()}
                disabled={busy || !url.trim()}
              >
                {busy ? (
                  <LoaderCircle className="spin" size={14} />
                ) : (
                  <Check size={14} />
                )}
                Сохранить и проверить
              </button>
            </div>
            {status && (
              <p className="connection-success" role="status">
                {status}
              </p>
            )}
            <p className="field-hint">
              Проверка обращается к каталогу API. Доступность конкретной модели
              проверяется при отправке сообщения.
            </p>
            <button
              className="settings-model-link"
              onClick={() => changeTab("models")}
            >
              <div>
                <strong>Настроить модели</strong>
                <span>Свой список, поиск и модель по умолчанию</span>
              </div>
              <ChevronRight size={17} />
            </button>
          </div>
        ) : tab === "models" ? (
          <>
            {connectionChanged && (
              <div className="connection-pending">
                Подключение ещё не сохранено. Поиск использует текущий адрес
                API.
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={() =>
                    void save({ baseUrl: url, ...(key ? { key } : {}) })
                  }
                >
                  Сохранить подключение
                </button>
              </div>
            )}
            <ModelsSettings
              key={state.settings.baseUrl}
              state={state}
              onState={onState}
              onConnection={() => changeTab("connection")}
            />
            <div className="setting-row" style={{marginTop:24}}><div><strong>Глубина рассуждений</strong><p>Effort по умолчанию. Для отдельного чата можно выбрать свой.</p></div><EffortMenu value={state.settings.effort} disabled={busy} onChange={effort=>void save({effort})}/></div>
          </>
        ) : (
          <>
            <ThemePicker
              value={state.settings.theme}
              busy={busy}
              onChange={(theme) => void save({ theme })}
            />
            <div className="setting-row">
              <div>
                <strong>Субагенты</strong>
                <p>
                  Параллельные помощники для независимых задач. Каждый
                  использует отдельные запросы API.
                </p>
              </div>
              <button
                className="switch"
                role="switch"
                aria-label="Субагенты"
                aria-checked={state.settings.subagents !== false}
                onClick={() =>
                  void save({ subagents: state.settings.subagents === false })
                }
              >
                <span />
              </button>
            </div>
            <div className="setting-row">
              <div>
                <strong>Анимации интерфейса</strong>
                <p>Плавные панели и переходы Fluid Functionalism</p>
              </div>
              <button
                className="switch"
                role="switch"
                aria-label="Анимации интерфейса"
                aria-checked={state.settings.motion}
                onClick={() => void save({ motion: !state.settings.motion })}
              >
                <span />
              </button>
            </div>
            <div className="setting-row">
              <div>
                <strong>Звуки интерфейса</strong>
                <p>Отправка, завершение ответа и копирование</p>
              </div>
              <button
                className="switch"
                role="switch"
                aria-label="Звуки интерфейса"
                aria-checked={state.settings.sounds}
                onClick={() => {
                  unlockSound();
                  const on = !state.settings.sounds;
                  configureSound(on, state.settings.volume);
                  if (on) playSound("on");
                  void save({ sounds: on });
                }}
              >
                <span />
              </button>
            </div>
            <label className="volume-label">
              <span>
                Громкость
                <small>{Math.round(state.settings.volume * 100)}%</small>
              </span>
              <input
                aria-label="Громкость звуков"
                type="range"
                min="0"
                max="100"
                value={Math.round(state.settings.volume * 100)}
                onChange={(e) => {
                  const volume = Number(e.target.value) / 100;
                  configureSound(state.settings.sounds, volume);
                  void save({ volume });
                }}
              />
            </label>
            <button
              className="secondary-button"
              disabled={!state.settings.sounds}
              onClick={() => {
                unlockSound();
                playSound("success");
              }}
            >
              <Volume2 size={14} />
              Прослушать
            </button>
            <div className="settings-note">
              Системная настройка уменьшения движения учитывается автоматически.
              Звуки не сопровождают печать и наведение.
            </div>
            <UpdateSettings update={state.update} preview={state.platform === "preview"} />
          </>
        )}
        {error && (
          <div className="inline-error" role="alert">
            {error}
          </div>
        )}
      </div>
      <div className="dialog-footer">
        <span>
          Turwe Code <small>{APP_VERSION}</small>
        </span>
        <button
          className="primary-button"
          disabled={busy}
          onClick={() =>
            connectionChanged
              ? void save({ baseUrl: url, ...(key ? { key } : {}) }, true)
              : onClose()
          }
        >
          Готово
        </button>
      </div>
    </Modal>
  );
}
