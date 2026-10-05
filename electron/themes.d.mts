export type ThemeId = "claude-code" | "chatgpt";
export const DEFAULT_THEME: ThemeId;
export const THEMES: readonly {
  id: ThemeId;
  name: string;
  description: string;
  background: string;
}[];
export function normalizeTheme(value: unknown): ThemeId;
export function validateTheme(value: unknown): ThemeId;
export function themeBackground(value: unknown): string;
