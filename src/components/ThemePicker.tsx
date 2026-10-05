import { useId } from "react";
import { Check, ArrowUp } from "../icons";
import { THEMES, normalizeTheme, type ThemeId } from "../../electron/themes.mjs";

export function ThemePicker({ value, busy, onChange }: {
  value: ThemeId;
  busy: boolean;
  onChange: (value: ThemeId) => void;
}) {
  const id = useId();
  const selected = normalizeTheme(value);
  return (
    <fieldset className="theme-picker" aria-busy={busy}>
      <legend>Тема приложения</legend>
      <p id={`${id}-hint`}>Две тёмные палитры. Выбор сохраняется автоматически.</p>
      <div className="theme-options" aria-describedby={`${id}-hint`}>
        {THEMES.map((theme) => (
          <label className="theme-option" key={theme.id}>
            <input
              type="radio"
              name={`${id}-theme`}
              value={theme.id}
              aria-label={theme.name}
              checked={selected === theme.id}
              aria-disabled={busy}
              onChange={() => { if (!busy) onChange(theme.id); }}
            />
            <span className="theme-preview" data-theme={theme.id} aria-hidden="true">
              <span className="theme-preview-sidebar"><i /><i /><i /></span>
              <span className="theme-preview-chat">
                <span className="theme-preview-bubble" />
                <span className="theme-preview-lines"><i /><i /></span>
                <span className="theme-preview-composer"><i /><span><ArrowUp size={10} /></span></span>
              </span>
            </span>
            <span className="theme-option-label">
              <strong>{theme.name}</strong>
              <Check size={13} active={selected === theme.id} aria-hidden="true" />
            </span>
            <span className="theme-option-description">{theme.description}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
