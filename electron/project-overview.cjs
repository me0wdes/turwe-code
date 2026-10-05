const fs = require("node:fs");
const path = require("node:path");
const { defaultShell } = require("./processes.cjs");
const { safeRelative } = require("./workspace-files.cjs");

// Environment + labelled instruction sources follow OpenCode's session context
// approach (MIT); bounded overview documents and access checks are Turwe-specific.
function projectOverview(
  root,
  { canRead = () => true, canList = () => true } = {},
) {
  const overview = {
    cwd: root,
    platform: process.platform,
    shell: defaultShell(),
    entries: [],
    documents: [],
  };
  try {
    const base = fs.realpathSync(root);
    const entries = fs
      .readdirSync(base, { withFileTypes: true })
      .filter((entry) => {
        if (entry.isSymbolicLink()) return false;
        if (
          ["dist", "release", ".next", ".turwe-worktrees"].includes(entry.name)
        )
          return false;
        try {
          safeRelative(entry.name);
          return true;
        } catch {
          return false;
        }
      })
      .sort(
        (a, b) =>
          Number(b.isDirectory()) - Number(a.isDirectory()) ||
          a.name.localeCompare(b.name),
      );
    const visible = entries.filter((entry) => canList(entry.name));
    overview.entries = visible
      .slice(0, 80)
      .map((entry) => entry.name + (entry.isDirectory() ? "/" : ""));
    overview.entriesTruncated = visible.length > 80;
    let remaining = 24000;
    for (const entry of entries
      .filter(
        (entry) =>
          entry.isFile() &&
          /^(readme(?:\.[\w-]+)?|project|проект)\.(md|mdx|txt|rst)$/i.test(
            entry.name,
          ),
      )
      .slice(0, 4)) {
      if (!remaining || !canRead(entry.name)) continue;
      const absolute = path.join(base, entry.name);
      const stat = fs.lstatSync(absolute);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink > 1) continue;
      const relative = path.relative(base, fs.realpathSync(absolute));
      if (relative.startsWith("..") || path.isAbsolute(relative)) continue;
      // Read only a bounded prefix, even when README is huge. No credentials,
      // source files, parent folders or shell commands are loaded automatically.
      const limit = Math.min(12000, remaining);
      const handle = fs.openSync(absolute, "r");
      try {
        const bytes = Buffer.alloc(limit);
        const count = fs.readSync(handle, bytes, 0, limit, 0);
        const chunk = bytes.subarray(0, count);
        if (chunk.includes(0)) continue;
        const truncated = stat.size > count;
        const content = new TextDecoder("utf-8", { fatal: true }).decode(
          chunk,
          { stream: truncated },
        );
        overview.documents.push({ path: entry.name, content, truncated });
        remaining -= count;
      } catch {
        /* A binary/unreadable overview must not prevent the chat. */
      } finally {
        fs.closeSync(handle);
      }
    }
  } catch (error) {
    overview.error = `Папка проекта недоступна (${error.code || "ошибка чтения"}). Уточни расположение, не придумывай содержимое.`;
  }
  return overview;
}
module.exports = { projectOverview };
