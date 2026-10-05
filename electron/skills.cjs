const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const YAML = require("yaml");
const MAX_SOURCE = 64000,
  MAX_CONTEXT = 192000;
const TEXT_REFERENCE =
  /\.(md|txt|json|yaml|yml|csv|py|js|ts|cjs|mjs|sh|ps1|html|css)$/i;
function referencePaths(body) {
  const paths = [];
  for (const match of body.matchAll(
    /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g,
  )) {
    const link = match[1];
    if (/^https?:\/\//i.test(link) || link.startsWith("#")) continue;
    try {
      paths.push(decodeURIComponent(link.split("#")[0]));
    } catch {
      throw new Error("Некорректная ссылка в SKILL.md");
    }
  }
  return [...new Set(paths)];
}

function parseSkill(source, fallback = "") {
  if (
    typeof source !== "string" ||
    source.length > MAX_SOURCE ||
    !source.trim()
  )
    throw new Error("SKILL.md должен содержать от 1 до 64 000 символов");
  const text = source.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  const match = text.match(/^---\n([\s\S]*?)\n---(?:\n|$)/);
  let meta = {};
  if (text.startsWith("---\n") && !match)
    throw new Error("Закройте блок YAML строкой ---");
  if (match) {
    try {
      meta = YAML.parse(match[1], { maxAliasCount: 20 }) || {};
    } catch {
      throw new Error("Некорректный YAML в SKILL.md");
    }
    if (typeof meta !== "object" || Array.isArray(meta))
      throw new Error("Метаданные YAML должны быть объектом");
  }
  const name = meta.name || fallback;
  if (typeof name !== "string" || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(name))
    throw new Error(
      "name: используйте до 64 строчных латинских букв, цифр и дефисов",
    );
  for (const key of ["disable-model-invocation", "user-invocable"]) {
    if (key in meta && typeof meta[key] !== "boolean")
      throw new Error(`${key}: ожидается true или false`);
  }
  const body = text.slice(match?.[0].length || 0).trim();
  if (!body) throw new Error("Добавьте инструкции после блока YAML");
  const unsupported = [];
  for (const relative of referencePaths(body))
    if (!TEXT_REFERENCE.test(relative)) unsupported.push(`файл ${relative}`);
  return {
    name,
    description: String(meta.description || "")
      .trim()
      .slice(0, 2000),
    argumentHint: String(meta["argument-hint"] || "").slice(0, 200),
    manualOnly: meta["disable-model-invocation"] === true,
    userInvocable: meta["user-invocable"] !== false,
    unsupported,
    source,
    body,
    references: [],
    fork: meta.context === "fork",
    agent: typeof meta.agent === "string" ? meta.agent : undefined,
    allowedTools: Array.isArray(meta["allowed-tools"])
      ? meta["allowed-tools"].map(String)
      : typeof meta["allowed-tools"] === "string"
        ? meta["allowed-tools"].match(/[^\s,(]+(?:\([^)]*\))?/g) || []
        : [],
  };
}

function importSkill(file) {
  const realFile = fs.realpathSync(file),
    root = path.dirname(realFile);
  if (path.basename(realFile).toLowerCase() !== "skill.md")
    throw new Error("Выберите файл SKILL.md");
  if (fs.statSync(realFile).size > MAX_SOURCE * 4)
    throw new Error("SKILL.md слишком большой");
  const skill = parseSkill(
    fs.readFileSync(realFile, "utf8"),
    path.basename(root),
  );
  const references = [],
    seen = new Set();
  let total = skill.body.length;
  for (const relative of referencePaths(skill.body)) {
    const candidate = path.resolve(root, relative);
    const inside = (target) => {
      const rel = path.relative(root, target);
      return rel && !rel.startsWith("..") && !path.isAbsolute(rel);
    };
    if (!inside(candidate))
      throw new Error("Файл справки должен находиться внутри папки скилла");
    if (!fs.existsSync(candidate))
      throw new Error(`Не найден файл справки: ${relative}`);
    const real = fs.realpathSync(candidate);
    if (!inside(real))
      throw new Error("Ссылка выходит за пределы папки скилла");
    if (seen.has(real)) continue;
    seen.add(real);
    if (!TEXT_REFERENCE.test(real) || !TEXT_REFERENCE.test(relative)) {
      if (!skill.unsupported.includes(`файл ${relative}`))
        skill.unsupported.push(`файл ${relative}`);
      continue;
    }
    if (!fs.statSync(real).isFile() || fs.statSync(real).size > 128000)
      throw new Error("Файл справки слишком большой");
    const content = new TextDecoder("utf-8", { fatal: true }).decode(
      fs.readFileSync(real),
    );
    total += content.length;
    if (
      content.includes("\0") ||
      references.length >= 12 ||
      total > MAX_CONTEXT
    )
      throw new Error("Файлы справки превышают лимит скилла");
    references.push({ path: relative, content });
  }
  return { ...skill, references };
}

function upsertSkill(store, input, imported = null) {
  if (!input || typeof input !== "object")
    throw new Error("Некорректный скилл");
  const skills = store.state.skills;
  const old = input.id ? skills.find((s) => s.id === input.id) : null;
  if (input.id && !old) throw new Error("Скилл не найден");
  const projectId = old ? (old.projectId ?? null) : (input.projectId ?? null);
  if (projectId && !store.state.projects.some((p) => p.id === projectId))
    throw new Error("Проект не найден");
  const parsed = imported || parseSkill(input.source);
  if (
    skills.some(
      (s) =>
        s.id !== old?.id &&
        s.name === parsed.name &&
        (!s.projectId || !projectId || s.projectId === projectId),
    )
  )
    throw new Error(
      "Скилл с таким именем уже существует в доступной библиотеке",
    );
  const references = imported
    ? imported.references
    : referencePaths(parsed.body)
        .filter((relative) => TEXT_REFERENCE.test(relative))
        .map((relative) => {
          const reference = old?.references?.find((r) => r.path === relative);
          if (!reference)
            throw new Error(
              `Для файла ${relative} импортируйте SKILL.md вместе со справкой заново`,
            );
          return reference;
        });
  const skill = {
    ...parsed,
    id: old?.id || randomUUID(),
    projectId,
    updatedAt: new Date().toISOString(),
    references,
  };
  if (old) skills.splice(skills.indexOf(old), 1, skill);
  else skills.push(skill);
  store.save();
  return skill;
}
function assignSkill(store, projectId, skillId, enabled) {
  const project = store.state.projects.find((p) => p.id === projectId),
    skill = store.state.skills.find((s) => s.id === skillId);
  if (!project || !skill) throw new Error("Проект или скилл не найден");
  if (typeof enabled !== "boolean") throw new Error("Некорректное подключение");
  if (skill.projectId && skill.projectId !== projectId)
    throw new Error("Скилл недоступен этому проекту");
  if (enabled && skill.unsupported.length)
    throw new Error(`Скилл не поддерживается: ${skill.unsupported.join(", ")}`);
  project.skillIds = [
    ...new Set(
      (project.skillIds || [])
        .filter((id) => id !== skillId)
        .concat(enabled ? [skillId] : []),
    ),
  ];
  store.save();
}
function deleteSkill(store, id) {
  if (!store.state.skills.some((s) => s.id === id))
    throw new Error("Скилл не найден");
  store.state.skills = store.state.skills.filter((s) => s.id !== id);
  for (const project of store.state.projects)
    project.skillIds = (project.skillIds || []).filter((v) => v !== id);
  store.save();
}
function skillMentions(message) {
  const mentionText = message.replace(
    /```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)|`[^`\n]*`/g,
    (text) => " ".repeat(text.length),
  );
  return [
    ...mentionText.matchAll(
      /(?:^|[\s])([@$/])([a-z0-9][a-z0-9-]{0,63})(?=$|[\s,.;:!?])/g,
    ),
  ];
}
function hasSkillMention(message, name) {
  return skillMentions(message).some((match) => match[2] === name);
}
function interpolateArguments(body, args = "") {
  args = String(args);
  const tokens = (args.match(/"[^"]*"|'[^']*'|\S+/g) || []).map((v) =>
    v.replace(/^(["'])([\s\S]*)\1$/, "$2"),
  );
  return body.replace(
    /\$ARGUMENTS\[(\d+)\]|\$(\d+)|\$ARGUMENTS\b/g,
    (_m, a, b) =>
      a !== undefined || b !== undefined ? tokens[Number(a ?? b)] || "" : args,
  );
}
function resolveSkills(skills, project, message) {
  const available = skills.filter(
    (s) => !s.projectId || s.projectId === project?.id,
  );
  const byName = new Map();
  // Project-local names override a library skill with the same name.
  for (const s of [...available].sort(
    (a, b) => Number(!!a.projectId) - Number(!!b.projectId),
  ))
    byName.set(s.name, s);
  const used = new Map();
  for (const s of available)
    if (
      project?.skillIds?.includes(s.id) &&
      !s.manualOnly &&
      byName.get(s.name).id === s.id
    )
      used.set(s.id, { skill: s, args: "" });
  const mentions = skillMentions(message);
  for (let i = 0; i < mentions.length; i++) {
    const m = mentions[i],
      name = m[2],
      skill = byName.get(name);
    if (!skill) {
      if (skills.some((s) => s.name === name))
        throw new Error(`Скилл ${name} не доступен этому проекту`);
      if (m[1] === "/" && message.trimStart().startsWith("/" + name))
        throw new Error(`Скилл ${name} не найден`);
      continue;
    }
    if (!skill.userInvocable)
      throw new Error(`Ручной вызов ${name} отключён в SKILL.md`);
    const args = message
      .slice(m.index + m[0].length, mentions[i + 1]?.index ?? message.length)
      .trim();
    used.set(skill.id, { skill, args });
  }
  let total = 0;
  return [...used.values()].map(({ skill, args }) => {
    if (skill.unsupported.length)
      throw new Error(
        `Скилл ${skill.name} не поддерживается: ${skill.unsupported.join(", ")}`,
      );
    const instructions = interpolateArguments(skill.body, args);
    total +=
      instructions.length +
      (skill.references || []).reduce((n, r) => n + r.content.length, 0);
    if (total > MAX_CONTEXT)
      throw new Error("Подключённые скиллы превышают лимит 192 000 символов");
    return {
      id: skill.id,
      name: skill.name,
      instructions,
      fork: skill.fork,
      allowedTools: skill.allowedTools,
      dynamic: /!`[^`]+`/.test(skill.body),
      references: skill.references || [],
    };
  });
}
module.exports = {
  parseSkill,
  importSkill,
  upsertSkill,
  assignSkill,
  deleteSkill,
  resolveSkills,
  hasSkillMention,
  interpolateArguments,
};
