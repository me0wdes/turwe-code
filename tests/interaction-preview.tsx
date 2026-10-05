import React from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/inter";
import "../src/styles.css";
import "../src/capabilities.css";
import type { AppState, DesktopBridge } from "../src/types";
const invoke = async (method: string, ...args: unknown[]) =>
  (
    await fetch("/__interaction", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ method, args }),
    })
  ).json();
window.turwe = new Proxy(
  {},
  {
    get: (_, name: string) =>
      name === "onState"
        ? (callback: (state: AppState) => void) => {
            let revision = -1,
              active = true;
            const timer = setInterval(async () => {
              const response = await invoke("bootstrap");
              if (active && response.ok && response.revision !== revision) {
                revision = response.revision;
                callback(response.value);
              }
            }, 200);
            return () => {
              active = false;
              clearInterval(timer);
            };
          }
        : (...args: unknown[]) => invoke(name, ...args),
  },
) as DesktopBridge;
const { default: App } = await import("../src/App");
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
