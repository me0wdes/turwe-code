const { minimatch } = require("minimatch");
const { needsApproval } = require("./interaction.cjs");
const { hasApproval } = require("./action-approvals.cjs");
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
function decision(session, definition, args, project, state) {
  const name = definition.function.name;
  if (!toolAllowed(session, name, args))
    return {
      action: "deny",
      reason: "Инструмент не входит в профиль этого агента или скилла.",
    };
  if (session.permissionMode === "bypass")
    return {
      action: "allow",
      reason: "Проверки разрешений отключены пользователем.",
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
  const pathAliases = [];
  // Check both user spelling and canonical project-relative spelling. An absolute
  // path (or a symlink) must not turn a denied project file into an allowed read.
  if (
    typeof args?.path === "string" &&
    project?.path &&
    ["FileRead", "Glob", "Grep"].includes(name)
  ) {
    const path = require("node:path"),
      fs = require("node:fs");
    const base = session.worktreePath || project.path;
    const expanded = /^~[\\/]/.test(args.path)
      ? path.join(require("node:os").homedir(), args.path.slice(2))
      : args.path;
    const target = path.resolve(base, expanded);
    const real = (value) => {
      try {
        return fs.realpathSync(value);
      } catch {
        return value;
      }
    };
    pathAliases.push(
      normalize(target),
      normalize(path.relative(real(base), real(target))),
    );
  }
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
      [...targets, ...pathAliases].some((target) =>
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
  if (session.permissionMode === "ask")
    return {
      action: "ask",
      reason:
        "Ручной режим: подтвердите каждый вызов, включая чтение и ранее разрешённые действия.",
    };
  const selected = rules.find((r) => r.action === "ask") || rules.at(-1);
  if (
    selected &&
    (selected.action !== "allow" ||
      targets.every((target) =>
        [target, ...pathAliases].some((alias) =>
          minimatch(alias, selected.pattern, {
            dot: true,
            nocase: process.platform === "win32",
          }),
        ),
      ))
  )
    return {
      action: selected.action,
      reason: `Правило проекта: ${selected.tool} / ${selected.pattern}`,
    };
  if (
    ["simple", "auto"].includes(session.permissionMode) &&
    hasApproval(session, definition, args, project, state)
  )
    return {
      action: "allow",
      reason:
        "Действует сохранённое разрешение пользователя на действие или инструмент.",
    };
  return {
    action:
      session.permissionMode === "auto"
        ? "review"
        : needsApproval(session.permissionMode, definition)
          ? "ask"
          : "allow",
    reason:
      session.permissionMode === "simple"
        ? "Это действие ещё не разрешено. Проверьте параметры перед запуском."
        : "Действие требует проверки безопасности.",
  };
}
module.exports = { decision, validateRules, toolAllowed };
