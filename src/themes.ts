import { normalizeTheme } from "../electron/themes.mjs";

const CACHE_KEY = "turwe-theme";

export function applyTheme(value: unknown) {
  const theme = normalizeTheme(value);
  if (document.documentElement.dataset.theme === theme) return;
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(CACHE_KEY, theme);
  } catch {
    // The desktop store remains authoritative when browser storage is unavailable.
  }
}

export function restoreTheme() {
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(CACHE_KEY);
  } catch {}
  applyTheme(saved);
}
