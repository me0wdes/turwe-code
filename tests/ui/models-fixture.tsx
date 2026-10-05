// Isolated UI fixture. Never loaded by the application entry or packaged renderer.
import React from "react";
import { createRoot } from "react-dom/client";
import type { AppState, DesktopBridge, Result } from "../../src/types";
import { createModelLibrary } from "../../electron/model-library.mjs";
import "../../src/styles.css";
const initial: AppState = {
  version: 1,
  projects: [],
  sessions: [],
  skills: [],
  connectors: [],
  models: [],
  modelLibraries: {},
  settings: {
    baseUrl: "https://ai.lab.pics/v1",
    model: "claude-opus-5-5",
    motion: true,
    sounds: false,
    volume: 0.2,
  },
  platform: "preview",
  hasKey: true,
  warning: "",
};
const library = createModelLibrary(initial);
initial.models = library.list();
const ok = <T,>(value: T): Result<T> => ({ ok: true, value });
const snapshot = () => {
  initial.models = library.list();
  return ok(structuredClone(initial));
};
let scenario = "models";
let searches = 0;
window.turwe = {
  getModels: async () => {
    searches++;
    await new Promise((resolve) => setTimeout(resolve, 400));
    if (scenario === "error")
      return { ok: false, error: "API: HTTP 401 — Тест ошибки авторизации" };
    return ok({
      baseUrl: initial.settings.baseUrl,
      models:
        scenario === "empty"
          ? []
          : [
              { id: "claude-opus-5-5", name: "Claude Opus 5.5" },
              ...Array.from({ length: 8 }, (_, i) => ({
                id: "fixture-model-" + (i + 1),
                name: "Тестовая модель " + (i + 1),
              })),
            ],
    });
  },
  addModel: async (baseUrl, model) => {
    library.add(baseUrl, model);
    return snapshot();
  },
  removeModel: async (baseUrl, id) => {
    library.remove(baseUrl, id);
    return snapshot();
  },
  setDefaultModel: async (baseUrl, id) => {
    library.selectDefault(baseUrl, id);
    return snapshot();
  },
  saveSettings: async () => snapshot(),
} as DesktopBridge;
const { SettingsDialog } = await import("../../src/components/Settings");
function Fixture() {
  const [state, setState] = React.useState(initial);
  const [kind, setKind] = React.useState("models");
  const [open, setOpen] = React.useState(true);
  return (
    <main style={{ padding: 24 }}>
      <h1>Тестовый каталог · данные для QA</h1>
      <p>API не вызывается. Список и ключи пользователя не используются.</p>
      {["models", "empty", "error"].map((value) => (
        <button
          key={value}
          className="secondary-button"
          onClick={() => {
            scenario = value;
            setKind(value);
            setOpen(true);
          }}
        >
          {value}
        </button>
      ))}
      <p>Запросов: {searches}</p>
      <SettingsDialog
        key={kind}
        state={state}
        initialTab="models"
        onState={setState}
        open={open}
        onClose={() => setOpen(false)}
        notify={() => {}}
      />
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);
