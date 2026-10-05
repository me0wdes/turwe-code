import { useCallback, useEffect, useRef, useState, type DragEvent } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { AlertCircle, Paperclip } from "../icons";
import { fluid } from "../motion";

type DropState = { count: number; reason: string } | null;
const carriesFiles = (data: DataTransfer) => Array.from(data.types).includes("Files");
export function useAttachmentDrop({ enabled, blocked, remaining, resetKey, onDrop, onError }: {
  enabled: boolean; blocked: string; remaining: number; resetKey: string;
  onDrop: (files: File[]) => void; onError: (message: string) => void;
}) {
  const [state, setState] = useState<DropState>(null);
  const depth = useRef(0);
  const reset = useCallback(() => { depth.current = 0; setState(null); }, []);
  useEffect(reset, [reset, resetKey, enabled]);
  useEffect(() => {
    const cancel = (e: globalThis.DragEvent) => {
      if (e.dataTransfer && carriesFiles(e.dataTransfer)) e.preventDefault();
      if (e.type === "drop" || e.type === "dragend") reset();
    };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") reset(); };
    // A file missed outside the drop zone must never navigate the application.
    window.addEventListener("dragover", cancel);
    window.addEventListener("drop", cancel);
    window.addEventListener("dragend", cancel);
    window.addEventListener("blur", reset);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("dragover", cancel);
      window.removeEventListener("drop", cancel);
      window.removeEventListener("dragend", cancel);
      window.removeEventListener("blur", reset);
      window.removeEventListener("keydown", key);
    };
  }, [reset]);
  function inspect(data: DataTransfer) {
    const count = Array.from(data.items).filter(item => item.kind === "file").length || 1;
    const reason = blocked || (remaining <= 0 ? "В сообщении уже 8 вложений" : count > remaining ? `Можно добавить ещё ${remaining} файлов` : "");
    return { count, reason };
  }
  function show(e: DragEvent) {
    const next = inspect(e.dataTransfer);
    e.dataTransfer.dropEffect = next.reason ? "none" : "copy";
    setState(old => old?.count === next.count && old.reason === next.reason ? old : next);
  }
  return {
    state,
    handlers: {
      onDragEnter(e: DragEvent) {
        if (!enabled || !carriesFiles(e.dataTransfer)) return;
        e.preventDefault(); depth.current++; show(e);
      },
      onDragOver(e: DragEvent) {
        if (!enabled || !carriesFiles(e.dataTransfer)) return;
        e.preventDefault(); show(e);
      },
      onDragLeave(e: DragEvent) {
        depth.current = Math.max(0, depth.current - 1);
        if (!depth.current) reset();
      },
      onDrop(e: DragEvent) {
        if (!carriesFiles(e.dataTransfer)) return;
        e.preventDefault(); reset();
        if (!enabled) return;
        const { reason } = inspect(e.dataTransfer);
        if (reason) { onError(reason); return; }
        if (Array.from(e.dataTransfer.items).some(item => item.webkitGetAsEntry?.()?.isDirectory)) {
          onError("Перетащите отдельные файлы. Для папки используйте выбор проекта."); return;
        }
        const files = Array.from(e.dataTransfer.files);
        if (files.length) onDrop(files);
        else onError("Не удалось прочитать файлы. Попробуйте добавить их через «+».");
      },
    },
  };
}

export function AttachmentDropZone({ state, motionEnabled }: { state: DropState; motionEnabled: boolean }) {
  const systemReduced = useReducedMotion();
  const reduced = systemReduced || !motionEnabled;
  return <AnimatePresence>
    {state && <motion.div className={`attachment-drop-zone ${state.reason ? "blocked" : ""}`} role="status"
      initial={{ opacity: 0, transform: reduced ? "none" : "scale(0.98)" }}
      animate={{ opacity: 1, transform: "scale(1)" }}
      exit={{ opacity: 0, transform: reduced ? "none" : "scale(0.98)" }} transition={fluid.moderate}>
      <div className="drop-zone-copy">
        <span className="drop-zone-icon">{state.reason ? <AlertCircle size={28} /> : <Paperclip size={28} />}</span>
        <strong>{state.reason || "Отпустите файлы здесь"}</strong>
        <span>{state.reason ? "Вложения в черновике сохранятся" : "Изображения, видео и документы — прямо в этот чат"}</span>
        {!state.reason && <small>{state.count === 1 ? "Добавить файл к сообщению" : `Добавить файлов: ${state.count}`}</small>}
      </div>
    </motion.div>}
  </AnimatePresence>;
}
