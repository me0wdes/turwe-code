const { createHash } = require("node:crypto");
const path = require("node:path");
const { homedir } = require("node:os");

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
}

// Remember an exact action, not a command prefix or a model's allow verdict.
// Hashes avoid copying paths, command contents and credentials into the grant list.
function actionKey(session, definition, args, project) {
  const cwd = path.resolve(session.worktreePath || project?.path || homedir());
  return createHash("sha256").update(JSON.stringify(canonical({
    version: 1,
    scope: project?.id || session.rootSessionId || session.id,
    cwd: process.platform === "win32" ? cwd.toLowerCase() : cwd,
    tool: definition.function,
    mcp: definition.mcp,
    args,
  }))).digest("hex");
}

function toolKey(definition, project) {
  const root = project?.path && path.resolve(project.path);
  return createHash("sha256").update(JSON.stringify(canonical({
    version: 1,
    project: project && { id: project.id, path: process.platform === "win32" ? root?.toLowerCase() : root },
    tool: definition.function,
    mcp: definition.mcp,
  }))).digest("hex");
}

function hasApproval(session, definition, args, project, state) {
  return (project || session).approvedActions?.includes(actionKey(session, definition, args, project)) === true ||
    project?.approvedTools?.includes(toolKey(definition, project)) === true ||
    state?.approvedTools?.includes(toolKey(definition)) === true;
}

// These broader grants are written only by an explicit human approval, never by
// the reviewer model. Bind MCP grants to the actual server/tool configuration.
function rememberToolApproval(definition, project, state, scope) {
  if (!["project", "global"].includes(scope) || (scope === "project" && !project))
    throw new Error("Для разрешения на проект сначала выберите проект.");
  const owner = scope === "project" ? project : state;
  const key = toolKey(definition, scope === "project" ? project : undefined);
  owner.approvedTools = [...(owner.approvedTools || []).filter((item) => item !== key), key].slice(-2000);
}

function rememberApproval(session, definition, args, project) {
  const owner = project || session;
  const key = actionKey(session, definition, args, project);
  owner.approvedActions = [...(owner.approvedActions || []).filter((item) => item !== key), key].slice(-2000);
}

module.exports = { actionKey, hasApproval, rememberApproval, rememberToolApproval };
