import * as Dialog from "@radix-ui/react-dialog";
import { X, Check, AlertCircle } from "../icons";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { fluid } from "../motion";
export function IconButton({
  label,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      className="icon-button"
      aria-label={label}
      title={label}
      {...props}
    >
      {children}
    </button>
  );
}
export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  className = "",
  instant = false,
  returnFocus,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
  instant?: boolean;
  returnFocus?: () => HTMLElement | null;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay
          className={`dialog-overlay ${instant ? "instant" : ""}`}
        />
        <Dialog.Content
          className={`dialog ${className} ${instant ? "instant" : ""}`}
          aria-describedby={description ? undefined : undefined}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            const target = returnFocus
              ? returnFocus()
              : document.querySelector<HTMLTextAreaElement>(".composer textarea");
            target?.focus();
          }}
        >
          <div className="dialog-heading">
            <Dialog.Title>{title}</Dialog.Title>
            <Dialog.Close asChild>
              <IconButton label="Закрыть">
                <X size={17} />
              </IconButton>
            </Dialog.Close>
          </div>
          <Dialog.Description
            className={description ? "dialog-description" : "sr-only"}
          >
            {description || title}
          </Dialog.Description>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
export function Toast({
  text,
  id,
  tone = "success",
  motionEnabled = true,
  onClose,
}: {
  text: string;
  id: number;
  tone?: "success" | "error";
  motionEnabled?: boolean;
  onClose: () => void;
}) {
  const systemReduced = useReducedMotion();
  const reduced = systemReduced || !motionEnabled;
  const [hovered, setHovered] = useState(false), [focused, setFocused] = useState(false), [hidden, setHidden] = useState(document.hidden);
  const remaining = useRef(6000);
  useEffect(() => { if (!text) { setHovered(false); setFocused(false); } }, [text]);
  useEffect(() => { remaining.current = tone === "error" ? 6000 : 3600; }, [id, tone]);
  useEffect(() => {
    const update = () => setHidden(document.hidden);
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  useEffect(() => {
    if (!text || hovered || focused || hidden) return;
    const started = Date.now();
    const timer = setTimeout(onClose, remaining.current);
    return () => { clearTimeout(timer); remaining.current = Math.max(0, remaining.current - (Date.now() - started)); };
  }, [id, text, hovered, focused, hidden, onClose]);
  return (
    <AnimatePresence>
      {text && (
        <motion.div
          className={`toast ${tone === "error" ? "toast-error" : ""}`}
          role={tone === "error" ? "alert" : "status"}
          aria-atomic="true"
          key="notification"
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          onFocusCapture={() => setFocused(true)}
          onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false); }}
          onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); onClose(); } }}
          initial={{
            opacity: 0,
            transform: reduced ? "none" : "translateY(-10px) scale(0.98)",
          }}
          animate={{ opacity: 1, transform: "translateY(0) scale(1)" }}
          exit={{
            opacity: 0,
            transform: reduced ? "none" : "translateY(-10px) scale(0.98)",
          }}
          transition={fluid.moderate}
        >
          <span className="toast-icon">
            {tone === "error" ? <AlertCircle size={17} /> : <Check size={15} />}
          </span>
          <span>{text}</span>
          <IconButton label="Скрыть уведомление" onClick={onClose}>
            <X size={14} />
          </IconButton>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
export function Mark({ className = "" }: { className?: string }) {
  return (
    <img
      className={`brand-mark ${className}`}
      src="./turwe-mark.svg"
      width="42"
      height="42"
      alt=""
      draggable={false}
      aria-hidden="true"
    />
  );
}
