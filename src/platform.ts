export const isMac = (platform?: string) => platform === "darwin";
export const shortcutKey = (platform?: string) => isMac(platform) ? "Cmd" : "Ctrl";
export const fileManagerLabel = (platform?: string) =>
  isMac(platform) ? "Открыть в Finder" : "Открыть в проводнике";

export function commandPressed(event: KeyboardEvent, platform?: string) {
  return !event.altKey && (isMac(platform) ? event.metaKey : event.ctrlKey);
}
