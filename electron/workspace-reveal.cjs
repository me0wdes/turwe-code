// UI metadata is produced from successful tool results, never from model prose.
function completedReveal(name, args, result) {
  if (!result || result.isError) return;
  if (name === "Preview" && args.operation === "navigate" && result.url)
    return { panel: "preview", url: result.url };
  if (name === "FileRead" && args.show === true && result.path)
    return { panel: "files", path: result.path };
  if (["FileWrite", "FileEdit", "apply_patch"].includes(name)) {
    const path = result.path || (Array.isArray(result) && result[0]?.path);
    if (path) return { panel: "changes", path };
  }
  if (
    ((name === "Bash" && (args.background === true || args.show === true)) ||
      (name === "Process" && args.show === true)) &&
    result.id
  )
    return { panel: "terminal", processId: result.id };
}
module.exports = { completedReveal };
