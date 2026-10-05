import { useState } from "react";
import { APP_VERSION } from "../version";
import {
  Plus,
  Search,
  FolderPlus,
  Folder,
  ChevronDown,
  Archive,
  Settings2,
  MoreHorizontal,
  Monitor,
  SquarePen,
  Sparkles,
  Code2,
  RotateCcw,
  Trash2,
} from "../icons";
import { motion } from "motion/react";
import type { AppState, Session } from "../types";
import { isRunning, sessionActivity } from "../bridge";
import { IconButton } from "./Primitives";
import { fluid } from "../motion";
import { shortcutKey } from "../platform";
const statusLabels = {
  working: "Агент работает",
  attention: "Нужен ваш ответ или подтверждение",
};
type Props = {
  state: AppState;
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: (projectId?: string | null) => void;
  onProject: () => void;
  onSearch: () => void;
  onSettings: () => void;
  onRename: (s: Session) => void;
  onArchive: (s: Session) => void;
  onDelete: (s: Session) => void;
  skillsOpen: boolean;
  searchOpen: boolean;
  settingsOpen: boolean;
  onSkills: () => void;
  connectorsOpen: boolean;
  onConnectors: () => void;
};
export function Sidebar(p: Props) {
  const [archived, setArchived] = useState(false),
    [collapsed, setCollapsed] = useState<string[]>([]);
  const visible = p.state.sessions.filter((s) => s.archived === archived);
  const groups = [{ id: null, name: "Без проекта" }, ...p.state.projects];
  return (
    <aside className="sidebar">
      <div className="sidebar-actions">
        <button className="sidebar-action" onClick={() => p.onNew()}>
          <span className="new-session-icon">
            <Plus size={16} />
          </span>
          Новая сессия<kbd>{shortcutKey(p.state.platform)} N</kbd>
        </button>
        <button
          className="sidebar-action"
          onClick={p.onSearch}
          aria-expanded={p.searchOpen}
        >
          <Search size={17} active={p.searchOpen} />
          Поиск сессий<kbd>{shortcutKey(p.state.platform)} K</kbd>
        </button>
        <button
          className={`sidebar-action ${p.skillsOpen ? "active" : ""}`}
          onClick={p.onSkills}
          aria-current={p.skillsOpen ? "page" : undefined}
        >
          <Sparkles size={17} />
          Скиллы
        </button>
        <button
          className={`sidebar-action ${p.connectorsOpen ? "active" : ""}`}
          onClick={p.onConnectors}
          aria-current={p.connectorsOpen ? "page" : undefined}
        >
          <Code2 size={17} />
          Коннекторы
          <span className="sidebar-count">
            {p.state.connectors.filter((c) => c.status === "connected")
              .length || ""}
          </span>
        </button>
      </div>
      <div className="sidebar-caption">
        <span>{archived ? "Архив" : "Сессии"}</span>
        <div>
          <IconButton
            label={archived ? "Показать активные сессии" : "Показать архив"}
            onClick={() => setArchived(!archived)}
            aria-pressed={archived}
          >
            <Archive size={15} />
          </IconButton>
          <IconButton label="Добавить проект" onClick={p.onProject}>
            <FolderPlus size={16} />
          </IconButton>
        </div>
      </div>
      <div className="session-list">
        {!visible.length && (
          <div className="sidebar-empty">
            <SquarePen size={23} />
            <p>{archived ? "Архив пуст" : "Здесь будут ваши сессии"}</p>
            <span>
              {archived
                ? "Архивированные сессии сохраняют историю."
                : "Создайте новую задачу или выберите папку проекта."}
            </span>
            {!archived && (
              <button className="text-button" onClick={p.onProject}>
                Выбрать проект <Plus size={13} />
              </button>
            )}
          </div>
        )}
        {groups.map((group) => {
          const sessions = visible.filter((s) => s.projectId === group.id);
          if (!sessions.length) return null;
          const key = group.id || "none";
          return (
            <div className="project-group" key={key}>
              <button
                className="project-heading"
                aria-expanded={!collapsed.includes(key)}
                onClick={() =>
                  setCollapsed((old) =>
                    old.includes(key)
                      ? old.filter((k) => k !== key)
                      : [...old, key],
                  )
                }
              >
                <ChevronDown
                  size={12}
                  className={collapsed.includes(key) ? "rotated" : ""}
                />
                {group.id ? (
                  <Folder
                    size={13}
                    active={
                      !p.skillsOpen && sessions.some((s) => s.id === p.activeId)
                    }
                  />
                ) : (
                  <Monitor
                    size={13}
                    active={
                      !p.skillsOpen && sessions.some((s) => s.id === p.activeId)
                    }
                  />
                )}
                <span>{group.name}</span>
              </button>
              {!collapsed.includes(key) &&
                sessions.map((session) => {
                  const status = p.state.mcpForms?.some(
                    (f) => f.sessionId === session.id,
                  )
                    ? "attention"
                    : sessionActivity(session);
                  return (
                    <div
                      className={`session-row ${status ? "has-activity" : ""} ${session.id === p.activeId ? "selected" : ""}`}
                      key={session.id}
                    >
                      {session.id === p.activeId && (
                        <motion.div
                          className="session-selection"
                          layoutId="session-selection"
                          transition={fluid.moderate}
                        />
                      )}
                      <button
                        className="session-main"
                        onClick={() => p.onSelect(session.id)}
                      >
                        <span className="session-title">{session.title}</span>
                        {status && (
                          <span
                            className={`session-status ${status}`}
                            role="img"
                            aria-label={statusLabels[status]}
                            title={statusLabels[status]}
                          >
                            <span className={`status-dot ${status}`} />
                          </span>
                        )}
                      </button>
                      <div className="session-tools">
                        {!session.archived && (
                          <IconButton
                            label={`Переименовать «${session.title}»`}
                            onClick={() => p.onRename(session)}
                          >
                            <MoreHorizontal size={15} />
                          </IconButton>
                        )}
                        <IconButton
                          label={
                            session.archived
                              ? "Восстановить сессию"
                              : "Архивировать сессию"
                          }
                          onClick={() => p.onArchive(session)}
                          disabled={isRunning(session)}
                        >
                          {session.archived ? (
                            <RotateCcw size={14} />
                          ) : (
                            <Archive size={13} />
                          )}
                        </IconButton>
                        {session.archived && (
                          <IconButton
                            label={`Удалить навсегда «${session.title}»`}
                            className="icon-button session-delete"
                            onClick={() => p.onDelete(session)}
                            disabled={isRunning(session)}
                          >
                            <Trash2 size={14} />
                          </IconButton>
                        )}
                      </div>
                    </div>
                  );
                })}
            </div>
          );
        })}
      </div>
      <div className="sidebar-footer">
        <button
          onClick={p.onSettings}
          className="sidebar-settings"
          aria-expanded={p.settingsOpen}
        >
          <Settings2 size={18} active={p.settingsOpen} />
          <span>
            <strong>Настройки</strong>
            <small>
              {p.state.hasKey ? "Ключ API сохранён" : "Настроить подключение"}
            </small>
          </span>
        </button>
        <div className="sidebar-bottom">
          <span>
            Turwe Code <small>{APP_VERSION}</small>
          </span>
        </div>
      </div>
    </aside>
  );
}
