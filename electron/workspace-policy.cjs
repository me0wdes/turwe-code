const { minimatch } = require("minimatch");
const { needsApproval } = require("./interaction.cjs");
function matchesTool(name, args, pattern, definitionOnly = false) {
  const parts = String(pattern).match(/^([^()]+)(?:\((.*)\))?$/);
  if (!parts) return false;
  const aliases = {
    Read: "FileRead",
    Write: "FileWrite",
    Edit: "FileEdit",
    TodoWrite: "Task*",
    Task: "Agent",
  };
  const key = aliases[parts[1]] || parts[1];
  return (
    minimatch(name, key, { nocase: true }) &&
    (definitionOnly ||
      !parts[2] ||
      minimatch(
        String(args.command ?? args.path ?? args.operation ?? ""),
        parts[2],
        { dot: true, nocase: process.platform === "win32" },
      ))
  );
}
function toolAllowed(session, name, args = {}, definitionOnly = false) {
  return [session.allowedTools, ...(session.toolRestrictions || [])]
    .filter((g) => g?.length)
    .every((g) => g.some((p) => matchesTool(name, args, p, definitionOnly)));
}
function validateRules(rules) {
  if (!Array.isArray(rules) || rules.length > 100)
    throw new Error("Допустимо до 100 правил");
  return rules.map((r) => {
    if (
      !r ||
      !["allow", "ask", "deny"].includes(r.action) ||
      typeof r.tool !== "string" ||
      !r.tool ||
      r.tool.length > 100 ||
      typeof (r.pattern ?? "*") !== "string" ||
      (r.pattern || "").length > 1000
    )
      throw new Error("Некорректное правило разрешений");
    return { tool: r.tool, pattern: r.pattern || "*", action: r.action };
  });
}
function decision(session, definition, args, project) {
  const name = definition.function.name;
  if (!toolAllowed(session, name, args))
    return {
      action: "deny",
      reason: "Инструмент не входит в профиль этого агента или скилла.",
    };
  if (
    session.permissionMode === "plan" &&
    !definition.readOnly &&
    !definition.mcp?.readOnly &&
    !["TaskCreate", "TaskUpdate", "submit_plan"].includes(name)
  )
    return {
      action: "deny",
      reason: "В режиме плана изменения запрещены. Сначала подтвердите план.",
    };
  const normalize = (value) =>
    require("node:path")
      .posix.normalize(String(value).replaceAll("\\", "/"))
      .replace(/^\.\//, "");
  let targets = [
    args?.path !== undefined
      ? normalize(args.path)
      : String(args?.command ?? args?.url ?? args?.operation ?? "*"),
  ];
  if (name === "apply_patch")
    targets = require("diff")
      .parsePatch(args.patch || "")
      .flatMap((p) =>
        [p.oldFileName, p.newFileName]
          .filter((p) => p && p !== "/dev/null")
          .map((p) => normalize(p.replace(/^[ab]\//, ""))),
      );
  if (name === "Git" && args?.paths?.length)
    targets = args.paths.map(normalize);
  const rules = (project?.permissionRules || []).filter(
    (r) =>
      minimatch(name, r.tool, { nocase: true }) &&
      targets.some((target) =>
        minimatch(target, r.pattern, {
          dot: true,
          nocase: process.platform === "win32",
        }),
      ),
  );
  const deny = rules.find((r) => r.action === "deny");
  if (deny)
    return {
      action: "deny",
      reason: `Запрещено правилом ${deny.tool}: ${deny.pattern}`,
    };
  const selected = rules.find((r) => r.action === "ask") || rules.at(-1);
  if (
    selected &&
    (selected.action !== "allow" ||
      targets.every((target) =>
        minimatch(target, selected.pattern, {
          dot: true,
          nocase: process.platform === "win32",
        }),
      ))
  )
    return {
      action: selected.action,
      reason: `Правило проекта: ${selected.tool} / ${selected.pattern}`,
    };
  return {
    action: needsApproval(session.permissionMode, definition) ? "ask" : "allow",
    reason: definition.readOnly
      ? "Чтение данных"
      : "Инструмент может изменить файлы, запустить процесс или обратиться к внешнему сервису.",
  };
}
module.exports = { decision, validateRules, toolAllowed };
