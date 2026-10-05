import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { fluid } from "../motion";
import {
  Folder,
  FileCode2,
  ChevronRight,
  ChevronLeft,
  X,
  Paperclip,
  Check,
  RefreshCw,
  ExternalLink,
} from "../icons";
import type { Project, Attachment, FileEntry } from "../types";
import { bridge, unwrap } from "../bridge";
import { IconButton } from "./Primitives";
import { fileManagerLabel } from "../platform";
interface Props {
  platform?: string;
  project?: Project;
  attachments: string[];
  onAttach: (path: string) => void;
  onClose: () => void;
  onChooseProject: () => void;
  disabled?: boolean;
}
export function FilePanel({
  platform,
  project,
  attachments,
  onAttach,
  onClose,
  onChooseProject,
  disabled,
}: Props) {
  const [entries, setEntries] = useState<FileEntry[]>([]),
    [directory, setDirectory] = useState(""),
    [file, setFile] = useState<Attachment | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false),
    [refresh, setRefresh] = useState(0),
    [width, setWidth] = useState(350);
  useEffect(() => {
    setDirectory("");
    setFile(null);
  }, [project?.id]);
  useEffect(() => {
    let live = true;
    if (!project) return;
    setLoading(true);
    setError("");
    unwrap(bridge.listFiles(project.id, directory))
      .then((value) => {
        if (live) setEntries(value);
      })
      .catch((e) => {
        if (live) setError(e.message);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [project?.id, directory, refresh]);
  useEffect(() => {
    setFile(null);
  }, [directory]);
  async function open(entry: FileEntry) {
    if (!project) return;
    if (entry.directory) {
      setDirectory(entry.path);
      return;
    }
    setError("");
    try {
      setFile(await unwrap(bridge.readFile(project.id, entry.path)));
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <motion.aside
      className="file-panel"
      style={{ width }}
      initial={{ opacity: 0, x: 8 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 8 }}
      transition={fluid.moderate}
    >
      <div
        className="resize-handle"
        role="separator"
        aria-label="Ширина панели файлов"
        aria-orientation="vertical"
        aria-valuemin={280}
        aria-valuemax={620}
        aria-valuenow={width}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
            e.preventDefault();
            setWidth((w) =>
              Math.max(
                280,
                Math.min(620, w + (e.key === "ArrowLeft" ? 20 : -20)),
              ),
            );
          }
        }}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (e.currentTarget.hasPointerCapture(e.pointerId))
            setWidth(
              Math.max(280, Math.min(620, window.innerWidth - e.clientX)),
            );
        }}
        onPointerUp={(e) => e.currentTarget.releasePointerCapture(e.pointerId)}
      />
      <div className="panel-heading">
        <span>
          <Folder size={15} />
          Файлы проекта
        </span>
        <div>
          {project && (
            <button
              className="quiet-control open-project-folder"
              onClick={() => {
                void unwrap(bridge.openProjectFolder(project.id))
                  .catch((e) => setError(e.message));
              }}
              title={fileManagerLabel(platform)}
            >
              <ExternalLink size={15} />
              <span>{fileManagerLabel(platform)}</span>
            </button>
          )}
          <IconButton
            label="Обновить файлы"
            onClick={() => setRefresh((v) => v + 1)}
          >
            <RefreshCw size={14} />
          </IconButton>
          <IconButton label="Закрыть панель файлов" onClick={onClose}>
            <X size={16} />
          </IconButton>
        </div>
      </div>
      {!project ? (
        <div className="panel-empty">
          <Folder size={28} />
          <p>Выберите папку проекта</p>
          <span>Открывайте файлы и добавляйте нужные в контекст задачи.</span>
          <button className="secondary-button" onClick={onChooseProject}>
            Выбрать папку
          </button>
        </div>
      ) : (
        <>
          <div className="file-breadcrumb">
            {!!directory && (
              <IconButton
                label="На уровень выше"
                onClick={() =>
                  setDirectory(directory.split("/").slice(0, -1).join("/"))
                }
              >
                <ChevronLeft size={14} />
              </IconButton>
            )}
            <span title={directory || project.path}>
              {directory || project.name}
            </span>
          </div>
          {error && (
            <div className="inline-error" role="alert">
              {error}
            </div>
          )}
          <div className={`file-tree ${file ? "with-preview" : ""}`}>
            {loading ? (
              <p className="subtle-state">Загрузка…</p>
            ) : entries.length ? (
              entries.map((entry) => (
                <button
                  className={`file-row ${file?.path === entry.path ? "selected" : ""}`}
                  aria-pressed={file?.path === entry.path}
                  key={entry.path}
                  onClick={() => void open(entry)}
                >
                  {entry.directory ? (
                    <Folder size={14} />
                  ) : (
                    <FileCode2 size={14} />
                  )}
                  <span>{entry.name}</span>
                  {attachments.includes(entry.path) ? (
                    <Check size={13} />
                  ) : entry.directory ? (
                    <ChevronRight size={12} />
                  ) : null}
                </button>
              ))
            ) : (
              <p className="subtle-state">В этой папке нет доступных файлов</p>
            )}
          </div>
          {file && (
            <div className="file-preview">
              <div className="file-preview-heading">
                <span title={file.path}>{file.path.split("/").at(-1)}</span>
                <button
                  className="quiet-control"
                  disabled={disabled || attachments.includes(file.path)}
                  onClick={() => onAttach(file.path)}
                >
                  {attachments.includes(file.path) ? (
                    <Check size={13} />
                  ) : (
                    <Paperclip size={13} />
                  )}
                  {attachments.includes(file.path) ? "Добавлен" : "В контекст"}
                </button>
              </div>
              <pre>
                <code>{file.content}</code>
              </pre>
              <span className="file-size">
                UTF-8 · {(file.size / 1024).toFixed(1)} КБ
              </span>
            </div>
          )}
          <div className="file-note">
            В запрос попадут только прикреплённые файлы.
          </div>
        </>
      )}
    </motion.aside>
  );
}
