import { Check, Folder, FolderPlus, MessageSquare } from "../icons";
import type { Project } from "../types";
import { TurweTitle } from "./TurweTitle";
import type { ReactNode } from "react";

export function NewSessionScreen({
  active,
  children,
  projects,
  selectedId,
  busy,
  motionEnabled,
  onSelect,
  onBrowse,
  onMore,
}: {
  active: boolean;
  children: ReactNode;
  projects: Project[];
  selectedId: string | null;
  busy: boolean;
  motionEnabled: boolean;
  onSelect: (id: string | null) => void;
  onBrowse: () => void;
  onMore: () => void;
}) {
  if (!active) return children;
  const selected = projects.find((p) => p.id === selectedId);
  const recent = [...projects].sort((a, b) =>
    (b.createdAt || "").localeCompare(a.createdAt || ""),
  );
  const visible = selected
    ? [selected, ...recent.filter((p) => p.id !== selected.id)].slice(0, 4)
    : recent.slice(0, 4);
  return (
    <>
      <div className="new-session-heading">
        <TurweTitle motionEnabled={motionEnabled} />
        <h2>С чего начнём?</h2>
        <p>Начните разговор или выберите проект для работы.</p>
      </div>
      {children}
      <section
        className="new-session-projects"
        aria-label="Рабочая папка нового чата"
      >
        <div className="new-session-projects-heading">
          <span>Рабочая папка</span>
          <button onClick={onBrowse} disabled={busy}>
            <FolderPlus size={16} />
            Выбрать или создать
          </button>
        </div>
        <div className="new-session-options">
          <button
            className="new-session-option automatic-project"
            aria-pressed={!selected}
            disabled={busy}
            onClick={() => onSelect(null)}
          >
            <MessageSquare size={19} />
            <span>
              <strong>Новый чат</strong>
              <small>Папка появится, когда понадобятся файлы</small>
            </span>
            {!selected && <Check size={16} />}
          </button>
          {visible.map((project) => (
            <button
              className="new-session-option"
              key={project.id}
              aria-pressed={project.id === selectedId}
              disabled={busy}
              onClick={() => onSelect(project.id)}
              title={project.path}
            >
              <Folder size={19} />
              <span>
                <strong>{project.name}</strong>
                <small>{project.path}</small>
              </span>
              {project.id === selectedId && <Check size={16} />}
            </button>
          ))}
        </div>
        <div className="new-session-projects-footer">
          <span>
            {selected
              ? "Рабочие файлы сохраняются в выбранном проекте."
              : "Файлы чата: Документы/Turwe/Projects"}
          </span>
          {projects.length > 4 && (
            <button onClick={onMore} disabled={busy}>
              Все проекты
            </button>
          )}
        </div>
      </section>
    </>
  );
}
