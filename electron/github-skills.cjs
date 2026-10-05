const { createHash } = require("node:crypto");
const { parseSkill, upsertSkill, assignSkill } = require("./skills.cjs");

const SHA = /^[a-f0-9]{40}$/;
const TEXT_REFERENCE = /\.(md|txt|json|yaml|yml|csv|py|js|ts|cjs|mjs|sh|ps1|html|css)$/i;
const REGULAR_MODES = new Set(["100644", "100755"]);
const MAX_SOURCE_BYTES = 256000;
const MAX_REFERENCE_BYTES = 128000;
const MAX_CONTEXT = 192000;

function failure(code, message) {
  return Object.assign(new Error(message), { code });
}
function cancelled() {
  return Object.assign(new Error("Импорт скилла отменён"), { name: "AbortError" });
}
function checkAbort(signal) {
  if (signal?.aborted) throw cancelled();
}
function validRef(ref) {
  return typeof ref === "string" && ref.length > 0 && ref.length <= 1024 &&
    !/[\x00-\x20\x7f~^:?*\[\\%]/.test(ref) && !ref.includes("..") &&
    !ref.includes("@{") && ref !== "@" &&
    ref.split("/").every((part) => part && !part.startsWith(".") &&
      !part.endsWith(".") && !part.endsWith(".lock"));
}
function validPath(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 2048 &&
    !/[\x00-\x1f\x7f\\:%?#]/.test(value) &&
    value.split("/").every((part) => part && part !== "." && part !== "..");
}
function parseUrl(input) {
  const bad = () => failure("GITHUB_URL", "Укажите HTTPS-ссылку на публичный репозиторий GitHub, папку или SKILL.md");
  if (typeof input !== "string" || input.length > 4096) throw bad();
  const text = input.trim();
  if (/[\x00-\x20\x7f\\]/.test(text)) throw bad();
  let url;
  try { url = new URL(text); } catch { throw bad(); }
  if (url.protocol !== "https:" || url.hostname !== "github.com" ||
    url.username || url.password || url.port || url.search) throw bad();
  // Inspect the original path: URL normalizes literal and percent-encoded '..'.
  const rawPath = text.match(/^https:\/\/[^/?#]+([^?#]*)/i)?.[1];
  let parts;
  try {
    parts = rawPath?.replace(/^\//, "").replace(/\/$/, "").split("/")
      .flatMap((part) => decodeURIComponent(part).split("/"));
  } catch { throw bad(); }
  if (!parts || parts.length < 2 || parts.length > 64 || !validPath(parts.join("/"))) throw bad();
  const [owner, rawRepo, kind, ...tail] = parts;
  const repo = rawRepo.replace(/\.git$/, "");
  if (!/^[a-z0-9][a-z0-9-]{0,38}$/i.test(owner) ||
    !/^[a-z0-9_.-]{1,100}$/i.test(repo) || repo === "." || repo === "..") throw bad();
  if (kind && (!["tree", "blob"].includes(kind) || !tail.length || !validRef(tail[0]))) throw bad();
  if (kind === "blob" && (tail.length < 2 || !/^skill\.md$/i.test(tail.at(-1)))) throw bad();
  const fullRepo = `${owner}/${repo}`;
  const baseUrl = `https://github.com/${fullRepo}`;
  return {
    repo: fullRepo, repoName: repo, kind, tail, baseUrl,
    url: baseUrl + (kind ? `/${kind}/${tail.map(encodeURIComponent).join("/")}` : ""),
    api: `https://api.github.com/repos/${owner}/${repo}`,
  };
}

function createGithubInstaller({ store, fetchImpl = fetch }) {
  if (!store?.state || typeof store.save !== "function" || typeof fetchImpl !== "function")
    throw new Error("Не настроено хранилище скиллов");

  function operation(signal) {
    if (signal && (typeof signal.addEventListener !== "function" || typeof signal.aborted !== "boolean"))
      throw new Error("Некорректный сигнал отмены");
    checkAbort(signal);
    return { signal, deadline: Date.now() + 60000, requests: 0 };
  }

  async function requestJson(url, context, limit = 1000000) {
    checkAbort(context.signal);
    const remaining = context.deadline - Date.now();
    if (remaining <= 0) throw failure("GITHUB_TIMEOUT", "GitHub не ответил вовремя. Повторите импорт");
    if (++context.requests > 80) throw failure("GITHUB_LIMIT", "Слишком много файлов или вариантов ветки для одного импорта");
    const controller = new AbortController();
    let timedOut = false;
    const abort = () => controller.abort();
    context.signal?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, Math.min(15000, remaining));
    try {
      const response = await fetchImpl(url, {
        method: "GET", redirect: "error", credentials: "omit", signal: controller.signal,
        headers: {
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "Turwe-Code",
        },
      });
      checkAbort(context.signal);
      if (response.redirected || (response.status >= 300 && response.status < 400) ||
        (response.url && response.url !== url))
        throw failure("GITHUB_REDIRECT", "GitHub перенаправил запрос. Используйте актуальную прямую ссылку на репозиторий");
      if (response.status === 404)
        throw failure("GITHUB_NOT_FOUND", "Репозиторий, ветка или файл GitHub не найдены; доступны только публичные репозитории");
      if (response.status === 429 || (response.status === 403 &&
        (response.headers.get("x-ratelimit-remaining") === "0" || response.headers.has("retry-after"))))
        throw failure("GITHUB_RATE_LIMIT", "Исчерпан лимит запросов GitHub. Повторите импорт позже");
      if (!response.ok)
        throw Object.assign(failure("GITHUB_HTTP", `GitHub не разрешил загрузку (HTTP ${response.status})`), { status: response.status });
      const declaredSize = response.headers.get("content-length");
      if (declaredSize !== null && (!/^\d+$/.test(declaredSize) || Number(declaredSize) > limit))
        throw failure("GITHUB_LIMIT", "Ответ GitHub слишком большой");
      const reader = response.body?.getReader();
      if (!reader) throw failure("GITHUB_RESPONSE", "GitHub вернул пустой ответ");
      const chunks = [];
      let size = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          checkAbort(context.signal);
          if (timedOut) throw failure("GITHUB_TIMEOUT", "GitHub не ответил вовремя. Повторите импорт");
          if (done) break;
          size += value.byteLength;
          if (size > limit) throw failure("GITHUB_LIMIT", "Ответ GitHub слишком большой");
          chunks.push(value);
        }
      } finally {
        await reader.cancel().catch(() => {});
      }
      try {
        return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, size)));
      } catch {
        throw failure("GITHUB_RESPONSE", "GitHub вернул некорректный ответ");
      }
    } catch (error) {
      checkAbort(context.signal);
      if (timedOut) throw failure("GITHUB_TIMEOUT", "GitHub не ответил вовремя. Повторите импорт");
      if (typeof error?.code === "string" && error.code.startsWith("GITHUB_")) throw error;
      throw failure("GITHUB_NETWORK", "Не удалось загрузить данные GitHub. Проверьте подключение и повторите импорт");
    } finally {
      clearTimeout(timer);
      context.signal?.removeEventListener("abort", abort);
      controller.abort();
    }
  }

  async function inspectSnapshot(input, context) {
    const parsed = parseUrl(input);
    let ref, commit, scope = "";
    if (!parsed.kind) {
      const repo = await requestJson(parsed.api, context);
      if (repo?.private !== false || !validRef(repo.default_branch))
        throw failure("GITHUB_RESPONSE", "Публичный репозиторий GitHub не содержит доступной ветки");
      ref = repo.default_branch;
      commit = await requestJson(`${parsed.api}/commits/${encodeURIComponent(ref)}`, context, 8000000);
    } else {
      // GitHub URLs do not separate a slash-containing ref from the file path.
      // Resolve the longest existing ref, then treat the remaining path as scope.
      const last = parsed.tail.length - (parsed.kind === "blob" ? 1 : 0);
      for (let length = last; length > 0; length--) {
        const candidate = parsed.tail.slice(0, length).join("/");
        if (!validRef(candidate)) continue;
        try {
          commit = await requestJson(`${parsed.api}/commits/${encodeURIComponent(candidate)}`, context, 8000000);
          ref = candidate;
          scope = parsed.tail.slice(length).join("/");
          break;
        } catch (error) {
          // The commits endpoint also returns 422 for a missing ref.
          if (error.code !== "GITHUB_NOT_FOUND" && error.status !== 422) throw error;
        }
      }
      if (!commit) throw failure("GITHUB_NOT_FOUND", "Ветка или ревизия GitHub не найдена");
    }
    if (!SHA.test(commit?.sha) || !SHA.test(commit?.commit?.tree?.sha))
      throw failure("GITHUB_RESPONSE", "GitHub не вернул точную ревизию репозитория");
    const revision = commit.sha;
    const treeSha = commit.commit.tree.sha;
    const data = await requestJson(`${parsed.api}/git/trees/${treeSha}?recursive=1`, context, 8000000);
    if (data?.truncated)
      throw failure("GITHUB_LIMIT", "Список файлов GitHub обрезан: репозиторий слишком большой для импорта");
    if (data?.sha !== treeSha || data.truncated !== false || !Array.isArray(data.tree) || data.tree.length > 100000)
      throw failure("GITHUB_RESPONSE", "GitHub вернул некорректный список файлов");
    const entries = new Map();
    for (const entry of data.tree) {
      if (!entry || !validPath(entry.path) || entries.has(entry.path))
        throw failure("GITHUB_RESPONSE", "GitHub вернул некорректный путь файла");
      entries.set(entry.path, entry);
    }
    const candidates = [...entries.values()]
      .filter((entry) => entry.type === "blob" && REGULAR_MODES.has(entry.mode) &&
        /^skill\.md$/i.test(entry.path.split("/").at(-1)) &&
        (!scope || (parsed.kind === "blob" ? entry.path === scope : entry.path.startsWith(`${scope}/`))))
      .map((entry) => ({ path: entry.path, name: entry.path.split("/").at(-2) || parsed.repoName }))
      .sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
    if (candidates.length > 1000)
      throw failure("GITHUB_LIMIT", "Слишком много скиллов: укажите ссылку на отдельную папку или SKILL.md");
    return { parsed, entries, result: { url: parsed.url, repo: parsed.repo, ref, revision, candidates } };
  }

  async function readBlob(parsed, entry, limit, context) {
    if (!entry || entry.type !== "blob" || !REGULAR_MODES.has(entry.mode))
      throw failure("GITHUB_FILE", "Файл скилла должен быть обычным файлом внутри его папки; символические ссылки не поддерживаются");
    if (!SHA.test(entry.sha) || !Number.isSafeInteger(entry.size) || entry.size < 0)
      throw failure("GITHUB_RESPONSE", "GitHub вернул некорректные сведения о файле");
    if (entry.size > limit) throw failure("GITHUB_LIMIT", "Файл скилла слишком большой");
    // Never follow URLs from repository contents or API responses.
    const data = await requestJson(`${parsed.api}/git/blobs/${entry.sha}`, context, Math.ceil(limit * 1.5) + 16000);
    if (data?.sha !== entry.sha || data.size !== entry.size || data.encoding !== "base64" || typeof data.content !== "string")
      throw failure("GITHUB_RESPONSE", "GitHub вернул некорректное содержимое файла");
    const encoded = data.content.replace(/[\r\n]/g, "");
    if (!/^[a-z0-9+/]*={0,2}$/i.test(encoded) || encoded.length % 4)
      throw failure("GITHUB_RESPONSE", "GitHub вернул некорректное содержимое файла");
    const bytes = Buffer.from(encoded, "base64");
    if (bytes.length !== entry.size || bytes.length > limit || bytes.toString("base64") !== encoded ||
      createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex") !== entry.sha)
      throw failure("GITHUB_RESPONSE", "Содержимое файла не совпадает с выбранной ревизией GitHub");
    let content;
    try { content = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
    catch { throw failure("GITHUB_FILE", "Файл скилла должен содержать корректный текст UTF-8"); }
    if (content.includes("\0")) throw failure("GITHUB_FILE", "Файл скилла содержит двоичные данные");
    return content;
  }

  async function importSelected(snapshot, skillPath, context) {
    const { parsed, entries, result } = snapshot;
    const source = await readBlob(parsed, entries.get(skillPath), MAX_SOURCE_BYTES, context);
    const root = skillPath.split("/").slice(0, -1);
    const skill = parseSkill(source, root.at(-1) || parsed.repoName);
    const seen = new Set();
    let total = skill.body.length;
    // Match the same local Markdown references as importSkill in skills.cjs.
    for (const match of skill.body.matchAll(/\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
      const link = match[1];
      if (/^https?:\/\//i.test(link) || link.startsWith("#")) continue;
      let relative;
      try { relative = decodeURIComponent(link.split("#")[0]); }
      catch { throw failure("GITHUB_FILE", "Некорректная ссылка в SKILL.md"); }
      if (!relative || relative.length > 2048 || relative.startsWith("/") || /[\x00-\x1f\x7f\\:%?]/.test(relative))
        throw failure("GITHUB_FILE", "Файл справки должен находиться внутри папки скилла");
      const local = [];
      for (const part of relative.split("/")) {
        if (!part || part === ".") continue;
        if (part === "..") {
          if (!local.length) throw failure("GITHUB_FILE", "Ссылка выходит за пределы папки скилла");
          local.pop();
        } else local.push(part);
      }
      if (!local.length) throw failure("GITHUB_FILE", "Файл справки должен находиться внутри папки скилла");
      const absolute = [...root, ...local].join("/");
      const entry = entries.get(absolute);
      if (!entry) throw failure("GITHUB_FILE", `Не найден файл справки: ${relative}`);
      if (entry.type !== "blob" || !REGULAR_MODES.has(entry.mode))
        throw failure("GITHUB_FILE", "Ссылки на папки, подмодули и символические ссылки не поддерживаются");
      if (seen.has(absolute)) continue;
      seen.add(absolute);
      if (!TEXT_REFERENCE.test(relative) || !TEXT_REFERENCE.test(absolute)) continue;
      if (skill.references.length >= 12)
        throw failure("GITHUB_LIMIT", "Файлы справки превышают лимит скилла");
      const content = await readBlob(parsed, entry, MAX_REFERENCE_BYTES, context);
      total += content.length;
      if (total > MAX_CONTEXT) throw failure("GITHUB_LIMIT", "Файлы справки превышают лимит скилла");
      skill.references.push({ path: relative, content });
    }
    skill.sourceUrl = `${parsed.baseUrl}/blob/${result.revision}/${skillPath.split("/").map(encodeURIComponent).join("/")}`;
    return skill;
  }

  async function inspect(url, { signal } = {}) {
    return (await inspectSnapshot(url, operation(signal))).result;
  }

  async function install(input, { signal } = {}) {
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Некорректные параметры импорта");
    const projectId = input.projectId ?? null;
    if (projectId !== null && (typeof projectId !== "string" || !projectId ||
      !store.state.projects.some((project) => project.id === projectId))) throw new Error("Проект не найден");
    if (input.skillPath !== undefined && !validPath(input.skillPath))
      throw failure("GITHUB_FILE", "Укажите путь SKILL.md внутри репозитория");
    const context = operation(signal);
    const snapshot = await inspectSnapshot(input.url, context);
    const candidates = snapshot.result.candidates;
    if (!candidates.length) throw failure("SKILL_NOT_FOUND", "В выбранном репозитории или папке не найден SKILL.md");
    if (input.skillPath === undefined && candidates.length > 1) {
      const error = failure("SKILL_SELECTION_REQUIRED", "В репозитории несколько скиллов. Выберите один SKILL.md");
      error.candidates = candidates;
      throw error;
    }
    const selected = input.skillPath || candidates[0].path;
    if (!candidates.some((candidate) => candidate.path === selected))
      throw failure("SKILL_NOT_FOUND", "Выбранный SKILL.md не найден в указанной папке");
    const imported = await importSelected(snapshot, selected, context);
    checkAbort(signal);
    // All downloads and validation finish before mutating the live store.
    // upsertSkill and assignSkill share one save so assignment cannot half-succeed.
    const staged = {
      state: {
        ...store.state,
        skills: [...store.state.skills],
        projects: store.state.projects.map((project) => ({ ...project, skillIds: [...(project.skillIds || [])] })),
      },
      save() {},
    };
    const skill = upsertSkill(staged, { projectId }, imported);
    if (projectId && !skill.unsupported.length) assignSkill(staged, projectId, skill.id, true);
    const previousSkills = store.state.skills;
    const previousProjects = store.state.projects;
    try {
      store.state.skills = staged.state.skills;
      store.state.projects = staged.state.projects;
      store.save();
    } catch (error) {
      store.state.skills = previousSkills;
      store.state.projects = previousProjects;
      throw error;
    }
    return { skillId: skill.id, name: skill.name, projectId, unsupported: skill.unsupported, sourceUrl: skill.sourceUrl };
  }

  return { inspect, install };
}

module.exports = { createGithubInstaller };
