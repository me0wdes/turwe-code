export const DEFAULT_THEME = "chatgpt";

export const THEMES = Object.freeze([
  { id: "chatgpt", name: "ChatGPT", description: "Нейтральный серый", background: "#212121" },
  { id: "claude-code", name: "Claude Code", description: "Тёплый графит", background: "#151515" },
]);

export function normalizeTheme(value) {
  return THEMES.some((theme) => theme.id === value) ? value : DEFAULT_THEME;
}

export function validateTheme(value) {
  if (!THEMES.some((theme) => theme.id === value))
    throw new Error("Неизвестная тема приложения");
  return value;
}

export function themeBackground(value) {
  return THEMES.find((theme) => theme.id === normalizeTheme(value)).background;
}
