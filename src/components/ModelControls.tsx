import * as Menu from "@radix-ui/react-dropdown-menu";
import { LoaderCircle, RefreshCw, Sparkles } from "../icons";
import type { Effort } from "../types";
import "./model-controls.css";

export const effortOptions = [
  {
    value: "auto",
    name: "Авто",
    detail: "Использовать поведение модели по умолчанию",
  },
  { value: "low", name: "Низкий", detail: "Меньше времени на рассуждение" },
  { value: "medium", name: "Средний", detail: "Баланс скорости и глубины" },
  { value: "high", name: "Высокий", detail: "Больше внимания сложной задаче" },
] as const;

export interface ModelControlsProps {
  effort?: Effort;
  onEffort?: (value: Effort) => void;
  contextFill?: number;
  onCompact?: () => void;
  compacting?: boolean;
  compactDisabled?: boolean;
  disabled?: boolean;
}

export function ModelControls({
  effort = "auto",
  onEffort,
  contextFill,
  onCompact,
  compacting,
  compactDisabled,
  disabled,
}: ModelControlsProps) {
  const fill =
    typeof contextFill === "number" && Number.isFinite(contextFill)
      ? Math.min(1, Math.max(0, contextFill))
      : undefined;
  const percent = fill === undefined ? undefined : Math.round(fill * 100);
  const contextLabel =
    percent === undefined
      ? "Пока нет оценки"
      : `Примерно ${percent}% заполнено`;

  return (
    <div className="model-controls">
      {onEffort && (
        <>
          <Menu.Separator className="dropdown-separator" />
          <Menu.Label className="model-controls-label">
            <Sparkles size={14} active={effort !== "auto"} />
            <span>Effort</span>
            <small>Глубина рассуждений</small>
          </Menu.Label>
          <Menu.RadioGroup
            className="model-effort-options"
            value={effort}
            aria-label="Глубина рассуждений"
            onValueChange={(value) => onEffort(value as Effort)}
          >
            {effortOptions.map((option) => (
              <Menu.RadioItem
                key={option.value}
                className="model-effort-option"
                value={option.value}
                disabled={disabled || compacting}
                textValue={option.name}
                title={option.detail}
                onSelect={(event) => event.preventDefault()}
              >
                {option.name}
              </Menu.RadioItem>
            ))}
          </Menu.RadioGroup>
          <p className="model-effort-detail">
            {effortOptions.find((option) => option.value === effort)?.detail}
          </p>
        </>
      )}
      <Menu.Separator className="dropdown-separator" />
      <div
        className="model-context"
        title="Приблизительная заполненность контекста. История чата сохраняется целиком."
      >
        <svg
          className="model-context-ring"
          data-warning={fill !== undefined && fill >= 0.85 ? "true" : undefined}
          viewBox="0 0 36 36"
          role={percent === undefined ? "img" : "meter"}
          aria-label={
            percent === undefined
              ? "Заполненность контекста: пока нет оценки"
              : "Заполненность контекста"
          }
          aria-valuemin={percent === undefined ? undefined : 0}
          aria-valuemax={percent === undefined ? undefined : 100}
          aria-valuenow={percent}
          aria-valuetext={percent === undefined ? undefined : contextLabel}
        >
          <circle className="model-context-track" cx="18" cy="18" r="14" />
          {fill !== undefined && fill > 0 && (
            <circle
              className="model-context-value"
              cx="18"
              cy="18"
              r="14"
              pathLength="100"
              strokeDasharray="100"
              strokeDashoffset={100 - fill * 100}
              transform="rotate(-90 18 18)"
            />
          )}
        </svg>
        <span className="model-context-copy">
          <strong>Контекст</strong>
          <span>{contextLabel}</span>
        </span>
      </div>
      {onCompact && (
        <Menu.Item
          className="dropdown-item model-compact-action"
          disabled={disabled || compacting || compactDisabled}
          onSelect={(event) => {
            event.preventDefault();
            onCompact();
          }}
        >
          {compacting ? (
            <LoaderCircle size={15} className="spin" />
          ) : (
            <RefreshCw size={15} />
          )}
          <span>{compacting ? "Сжимаем контекст…" : "Сжать контекст"}</span>
        </Menu.Item>
      )}
    </div>
  );
}
