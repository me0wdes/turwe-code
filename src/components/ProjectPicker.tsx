import { ChevronRight, Folder, FolderPlus } from "../icons";
import type { Project } from "../types";
import { Modal } from "./Primitives";

export function ProjectPicker({
  open,
  projects,
  busy,
  onClose,
  onSelect,
  onBrowse,
}: {
  open: boolean;
  projects: Project[];
  busy: boolean;
  onClose: () => void;
  onSelect: (id: string) => void;
  onBrowse: () => void;
}) {
  return (
    <Modal
      open={open}
      onOpenChange={(value) => {
        if (!value && !busy) onClose();
      }}
      title="Выберите проект"
      description="Чтобы начать чат, выберите папку проекта."
      className="project-picker-dialog"
    >
      <div className="project-picker-body">
        {!!projects.length && (
          <div className="project-picker-list">
            {projects.map((project) => (
              <button
                key={project.id}
                className="project-picker-item"
                disabled={busy}
                onClick={() => onSelect(project.id)}
              >
                <Folder size={19} />
                <span>
                  <strong>{project.name}</strong>
                  <small>{project.path}</small>
                </span>
                <ChevronRight size={16} />
              </button>
            ))}
          </div>
        )}
        <button
          className="project-picker-browse"
          disabled={busy}
          onClick={onBrowse}
        >
          <FolderPlus size={18} />
          Открыть папку…
        </button>
      </div>
    </Modal>
  );
}
