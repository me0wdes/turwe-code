import { useState } from "react";
import { bridge, unwrap } from "../bridge";
import type { McpFormData } from "../types";
import { Check, X } from "../icons";
import { Dropdown, Menu, MenuChoice } from "./Dropdown";

export function McpForm({
  form,
  onError,
}: {
  form: McpFormData;
  onError: (message: string) => void;
}) {
  const [values, setValues] = useState<Record<string, unknown>>(() =>
    Object.fromEntries(
      Object.entries(form.schema.properties).flatMap(([key, f]) =>
        f.default !== undefined
          ? [[key, f.default]]
          : f.type === "boolean"
            ? [[key, false]]
            : [],
      ),
    ),
  );
  const [busy, setBusy] = useState(false);
  const update = (key: string, value: unknown) =>
    setValues((old) => ({ ...old, [key]: value }));
  const submit = async (action: "accept" | "decline") => {
    setBusy(true);
    try {
      await unwrap(bridge.mcpForm(form.id, action, values));
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className="mcp-form"
      onSubmit={(e) => {
        e.preventDefault();
        void submit("accept");
      }}
    >
      <strong>{form.connectorName}</strong>
      <p>{form.message}</p>
      {Object.entries(form.schema.properties).map(([key, f]) => {
        const options =
          f.oneOf ||
          f.items?.anyOf ||
          (f.enum || f.items?.enum)?.map((v, i) => ({
            const: v,
            title: f.enumNames?.[i] || v,
          }));
        const value = values[key],
          numeric = f.type === "number" || f.type === "integer";
        return (
          <div className="mcp-field" key={key}>
            <label htmlFor={form.id + key}>{f.title || key}</label>
            {f.description && (
              <small className="field-hint">{f.description}</small>
            )}
            {f.type === "array" ? (
              <div className="mcp-options">
                {options?.map((option) => (
                  <label className="checkbox-row" key={option.const}>
                    <input
                      type="checkbox"
                      checked={
                        Array.isArray(value) && value.includes(option.const)
                      }
                      onChange={(e) =>
                        update(
                          key,
                          e.target.checked
                            ? [
                                ...(Array.isArray(value) ? value : []),
                                option.const,
                              ]
                            : (Array.isArray(value) ? value : []).filter(
                                (v) => v !== option.const,
                              ),
                        )
                      }
                    />
                    {option.title}
                  </label>
                ))}
              </div>
            ) : options ? (
              <Dropdown
                label={f.title || key}
                trigger={
                  options.find((o) => o.const === value)?.title || "Выберите"
                }
              >
                <Menu.RadioGroup
                  value={String(value ?? "")}
                  onValueChange={(v) => update(key, v)}
                >
                  {options.map((o) => (
                    <MenuChoice key={o.const} value={o.const}>
                      {o.title}
                    </MenuChoice>
                  ))}
                </Menu.RadioGroup>
              </Dropdown>
            ) : f.type === "boolean" ? (
              <input
                id={form.id + key}
                type="checkbox"
                checked={Boolean(value)}
                onChange={(e) => update(key, e.target.checked)}
              />
            ) : (
              <input
                id={form.id + key}
                type={
                  numeric
                    ? "number"
                    : f.format === "email"
                      ? "email"
                      : f.format === "uri"
                        ? "url"
                        : "text"
                }
                step={f.type === "integer" ? 1 : "any"}
                min={f.minimum}
                max={f.maximum}
                minLength={f.minLength}
                maxLength={f.maxLength}
                required={form.schema.required?.includes(key)}
                value={String(value ?? "")}
                onChange={(e) =>
                  update(
                    key,
                    numeric
                      ? e.target.value === ""
                        ? undefined
                        : Number(e.target.value)
                      : e.target.value,
                  )
                }
              />
            )}
          </div>
        );
      })}
      <div className="workbench-actions">
        <button className="primary-button" type="submit" disabled={busy}>
          <Check size={14} />
          Ответить
        </button>
        <button
          type="button"
          className="secondary-button"
          disabled={busy}
          onClick={() => void submit("decline")}
        >
          <X size={14} />
          Отклонить
        </button>
      </div>
    </form>
  );
}
