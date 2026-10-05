import { useEffect, useState } from "react";
import { Paperclip, X } from "../icons";
import type { Attachment } from "../types";
import { bridge, unwrap } from "../bridge";
import { IconButton, Modal } from "./Primitives";
export const attachmentKey = (file: Attachment) => file.id || file.path;
function description(file: Attachment) {
  const limited = file.note?.includes("truncated")
    ? " Длинный текст сокращён до лимита."
    : "";
  if (file.kind === "video")
    return "Модель получает отдельные кадры с отметками времени. Аудиодорожка не передаётся; события между кадрами могут быть пропущены.";
  if (file.mime === "application/pdf")
    return (
      "Модель получает текст PDF. Сканированные страницы, изображения и вёрстка не распознаются." +
      (file.note?.includes("No readable text")
        ? " В этом документе не найден текст. Прикрепите страницы как изображения."
        : limited)
    );
  if (file.name?.toLowerCase().endsWith(".docx"))
    return (
      "Модель получает текст документа без изображений и оформления." + limited
    );
  return "Вложение сохранено вместе с сессией.";
}
export function AttachmentCard({
  file,
  onRemove,
  disabled,
}: {
  file: Attachment;
  onRemove?: () => void;
  disabled?: boolean;
}) {
  const [preview, setPreview] = useState(file.preview || ""),
    [open, setOpen] = useState(false);
  useEffect(() => {
    let active = true;
    if (file.id && ["image", "video"].includes(file.kind || ""))
      void unwrap(bridge.attachmentPreview(file.id))
        .then((image) => {
          if (active) setPreview(image || "");
        })
        .catch(() => {});
    return () => {
      active = false;
    };
  }, [file.id, file.kind]);
  const name = file.name || file.path.split(/[\\/]/).at(-1) || "Вложение";
  return (
    <>
      <div className={`attachment-card ${preview ? "has-preview" : ""}`}>
        <button
          className="attachment-open"
          onClick={() => setOpen(true)}
          title={name}
        >
          {preview ? (
            <img src={preview} alt="" />
          ) : (
            <span className="attachment-file-icon">
              <Paperclip size={20} />
            </span>
          )}
          <span>
            <strong>{name}</strong>
            <small>
              {file.kind === "video"
                ? "Кадры видео · без звука"
                : file.mime === "application/pdf"
                  ? "Текст PDF"
                  : file.size < 1024
                    ? `${file.size} Б`
                    : `${Math.ceil(file.size / 1024)} КБ`}
            </small>
          </span>
        </button>
        {onRemove && (
          <IconButton
            label={`Убрать ${name}`}
            onClick={onRemove}
            disabled={disabled}
          >
            <X size={13} />
          </IconButton>
        )}
      </div>
      <Modal
        open={open}
        onOpenChange={setOpen}
        title={name}
        description={description(file)}
        className="attachment-dialog"
      >
        {preview ? (
          <img className="attachment-full" src={preview} alt={name} />
        ) : file.content ? (
          <pre className="attachment-text">{file.content}</pre>
        ) : (
          <p className="muted">
            Текст документа будет передан модели при отправке сообщения.
          </p>
        )}
      </Modal>
    </>
  );
}
