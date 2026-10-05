const fs = require("node:fs/promises");
const path = require("node:path");
const { homedir } = require("node:os");
const { randomUUID, createHash } = require("node:crypto");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { createTwoFilesPatch, parsePatch, applyPatch } = require("diff");
const exec = promisify(execFile);
const ripgrepPath = () =>
  require("@vscode/ripgrep").rgPath.replace(
    "app.asar" + path.sep,
    "app.asar.unpacked" + path.sep,
  );
const MAX = 2 * 1024 * 1024;
const hash = (value) => createHash("sha256").update(value).digest("hex");
const ignored = [
  "**/{.git,node_modules,.next,dist,release,.aws,.ssh,.turwe-worktrees}/**",
  "**/.env",
  "**/.env.*",
  "**/*.{pem,key,pfx,p12}",
];
function safeRelative(value) {
  if (
    typeof value !== "string" ||
    !value ||
    value.includes("\0") ||
    /[:*?"<>|]/.test(value) ||
    path.isAbsolute(value) ||
    value
      .split(/[\\/]/)
      .some(
        (p) =>
          p === ".." ||
          /^(\.git|node_modules|\.aws|\.ssh|\.env(?:\..*)?)$/i.test(p),
      ) ||
    /\.(pem|key|pfx|p12)$/i.test(value)
  )
    throw new Error("Этот путь недоступен");
  return value.replaceAll("\\", "/");
}
async function inside(root, relative, create = false) {
  relative = safeRelative(relative);
  const base = await fs.realpath(root),
    target = path.resolve(base, relative);
  if (
    !path.relative(base, target) ||
    path.relative(base, target).startsWith("..") ||
    path.isAbsolute(path.relative(base, target))
  )
    throw new Error("Этот путь недоступен");
  let current = base;
  for (const part of relative.split("/").filter((p) => p && p !== ".")) {
    current = path.join(current, part);
    const info = await fs.lstat(current).catch((e) => {
      if (e.code === "ENOENT" && create) return null;
      throw e;
    });
    if (info?.isSymbolicLink() || (info?.isFile() && info.nlink > 1))
      throw new Error("Ссылки на файлы недоступны для изменения");
  }
  return target;
}
async function readText(target, optional = false) {
  try {
    if ((await fs.stat(target)).size > MAX)
      throw new Error("Нужен текстовый файл до 2 МБ");
  } catch (e) {
    if (optional && e.code === "ENOENT") return null;
    throw e;
  }
  let bytes;
  try {
    bytes = await fs.readFile(target);
  } catch (e) {
    if (optional && e.code === "ENOENT") return null;
    throw e;
  }
  if (bytes.length > MAX || bytes.includes(0))
    throw new Error("Нужен текстовый файл до 2 МБ");
  return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
    bytes,
  );
}
function createWorkspaceFiles({ store, directory }) {
  store.state.checkpoints ||= [];
  const locks = new Map();
  function root(session, create = false) {
    const owner =
      session.rootSessionId &&
      store.state.sessions.find((s) => s.id === session.rootSessionId);
    const projectId = session.projectId || owner?.projectId;
    const project = store.state.projects.find((p) => p.id === projectId);
    if (!project) {
      if (create) return store.ensureWorkspace(session).path;
      throw new Error(
        "Выберите проект или создайте рабочую папку через CreateWorkspace",
      );
    }
    return session.worktreePath || project.path;
  }
  function readRoot(session) {
    if (
      session.projectId ||
      (session.rootSessionId &&
        store.state.sessions.find((s) => s.id === session.rootSessionId)
          ?.projectId)
    )
      return root(session);
    return homedir();
  }
  async function readPath(session, value) {
    if (typeof value !== "string" || !value || value.includes("\0"))
      throw new Error("Укажите путь к файлу или папке");
    const expanded = /^~[\\/]/.test(value)
      ? path.join(homedir(), value.slice(2))
      : value;
    const target = path.resolve(readRoot(session), expanded);
    // Reading may leave the workspace; credential/dependency exclusions still apply.
    safeRelative(target.slice(path.parse(target).root.length) || ".");
    const resolved = await fs.realpath(target);
    safeRelative(resolved.slice(path.parse(resolved).root.length) || ".");
    return resolved;
  }
  function location(session, target) {
    let base = readRoot(session);
    try {
      base = require("node:fs").realpathSync(base);
    } catch {}
    const relative = path.relative(base, target);
    const ownerProject =
      session.rootSessionId &&
      store.state.sessions.find((s) => s.id === session.rootSessionId)
        ?.projectId;
    const external =
      !(session.projectId || ownerProject) ||
      relative === ".." ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative);
    return {
      path: (external ? target : relative || ".").replaceAll("\\", "/"),
      external,
    };
  }
  async function locked(key, operation) {
    const previous = locks.get(key) || Promise.resolve();
    const next = previous.catch(() => {}).then(operation);
    locks.set(key, next);
    try {
      return await next;
    } finally {
      if (locks.get(key) === next) locks.delete(key);
    }
  }
  async function read(session, args) {
    const target = await readPath(session, args.path);
    const content = await readText(target);
    const lines = content.split("\n"),
      offset = Math.max(1, Number(args.offset) || 1),
      limit = Math.min(4000, Number(args.limit) || 4000);
    return {
      ...location(session, target),
      content: lines.slice(offset - 1, offset - 1 + limit).join("\n"),
      hash: hash(content),
      totalLines: lines.length,
      offset,
      truncated: lines.length > offset - 1 + limit,
    };
  }
  async function record(session, relative, before, after) {
    const id = randomUUID(),
      folder = path.join(directory, "checkpoints", id);
    await fs.mkdir(folder, { recursive: true });
    await fs.writeFile(
      path.join(folder, "before.json"),
      JSON.stringify(before),
      "utf8",
    );
    await fs.writeFile(
      path.join(folder, "after.json"),
      JSON.stringify(after),
      "utf8",
    );
    const checkpoint = {
      id,
      sessionId: session.id,
      rootSessionId: session.rootSessionId || session.id,
      path: relative,
      root: root(session),
      beforeHash: before === null ? null : hash(before),
      afterHash: after === null ? null : hash(after),
      createdAt: new Date().toISOString(),
    };
    store.state.checkpoints.push(checkpoint);
    store.save();
    return checkpoint;
  }
  async function writeValue(session, relative, before, after) {
    const target = await inside(root(session), relative, true);
    if ((await readText(target, true)) !== before)
      throw new Error("Файл изменился перед записью. Прочитайте его снова.");
    const point = await record(session, relative, before, after);
    try {
      await fs.mkdir(path.dirname(target), { recursive: true });
      await inside(root(session), relative, true);
      if (after === null) await fs.unlink(target);
      else {
        const tmp = `${target}.turwe-${point.id}.tmp`;
        try {
          await fs.writeFile(tmp, after, "utf8");
          await fs.rename(tmp, target);
        } finally {
          await fs.unlink(tmp).catch(() => {});
        }
      }
      point.applied = true;
      store.save();
      return {
        path: relative,
        hash: after === null ? null : hash(after),
        checkpointId: point.id,
        patch: createTwoFilesPatch(
          relative,
          relative,
          before || "",
          after || "",
        ),
      };
    } catch (e) {
      point.error = e.message;
      store.save();
      throw e;
    }
  }
  async function write(session, args) {
    const relative = safeRelative(args.path);
    if (
      typeof args.content !== "string" ||
      Buffer.byteLength(args.content) > MAX ||
      args.content.includes("\0")
    )
      throw new Error("Нужен текст до 2 МБ");
    root(session, true);
    return locked(path.resolve(root(session), relative), async () => {
      const before = await readText(
        await inside(root(session), relative, true),
        true,
      );
      if (before !== null && args.expectedHash === undefined)
        throw new Error(
          "Файл существует. Прочитайте его и передайте expectedHash перед полной перезаписью.",
        );
      if (
        args.expectedHash !== undefined &&
        args.expectedHash !== (before === null ? null : hash(before))
      )
        throw new Error("Файл изменён с момента чтения. Откройте его снова.");
      return writeValue(session, relative, before, args.content);
    });
  }
  async function edit(session, args) {
    const relative = safeRelative(args.path);
    return locked(path.resolve(root(session), relative), async () => {
      const before = await readText(await inside(root(session), relative));
      if (
        typeof args.oldText !== "string" ||
        !args.oldText ||
        typeof args.newText !== "string"
      )
        throw new Error("Укажите oldText и newText");
      // CRLF normalization follows OpenCode's MIT edit-tool approach. See THIRD_PARTY_NOTICES.md.
      const normalize = (s) =>
        s
          .replaceAll("\r\n", "\n")
          .replaceAll("\n", before.includes("\r\n") ? "\r\n" : "\n");
      const old = normalize(args.oldText),
        replacement = normalize(args.newText),
        count = before.split(old).length - 1;
      if (!count)
        throw new Error("Исходный текст не найден. Прочитайте файл снова.");
      if (count > 1 && !args.replaceAll)
        throw new Error(
          "Найдено несколько совпадений. Уточните фрагмент или используйте replaceAll.",
        );
      const after = args.replaceAll
        ? before.split(old).join(replacement)
        : before.replace(old, () => replacement);
      if (Buffer.byteLength(after) > MAX)
        throw new Error("Результат больше 2 МБ");
      return writeValue(session, relative, before, after);
    });
  }
  async function glob(session, args = {}) {
    const pattern = args.pattern || "**/*";
    if (
      typeof pattern !== "string" ||
      pattern.length > 1000 ||
      pattern.includes("..") ||
      path.isAbsolute(pattern)
    )
      throw new Error("Укажите маску файлов, а папку поиска передайте в path");
    const files = [],
      base = await readPath(session, args.path || ".");
    if (!(await fs.stat(base)).isDirectory())
      throw new Error("Укажите папку для поиска файлов");
    const argv = [
      "--files",
      "--null",
      "--hidden",
      "--no-ignore",
      "--glob",
      pattern.replaceAll("\\", "/"),
    ];
    for (const item of ignored) argv.push("--glob", `!${item}`);
    argv.push("--", ".");
    let stdout;
    try {
      ({ stdout } = await exec(ripgrepPath(), argv, {
        cwd: base,
        windowsHide: true,
        timeout: 15000,
        maxBuffer: 4 * 1024 * 1024,
      }));
    } catch (e) {
      if (e.code === 1) return { files: [], truncated: false };
      throw e;
    }
    for (const found of stdout.split("\0")) {
      if (!found) continue;
      const entry = found.replaceAll("\\", "/").replace(/^\.\//, "");
      try {
        const target = await inside(base, entry);
        if ((await fs.stat(target)).isFile())
          files.push(location(session, target).path);
      } catch {}
      if (files.length > 5000) break;
    }
    return {
      files: files.sort().slice(0, 5000),
      truncated: files.length > 5000,
    };
  }
  async function grep(session, args, signal) {
    if (
      typeof args.pattern !== "string" ||
      !args.pattern ||
      args.pattern.length > 2000
    )
      throw new Error("Укажите поисковое выражение");
    const base = await readPath(session, args.path || ".");
    if (!(await fs.stat(base)).isDirectory())
      throw new Error("Укажите папку для поиска по содержимому");
    const argv = [
      "--json",
      "--max-count",
      "100",
      "--max-filesize",
      "2M",
      "--hidden",
      "--no-ignore",
    ];
    for (const item of ignored) argv.push("--glob", `!${item}`);
    if (args.glob) argv.push("--glob", args.glob);
    if (args.caseSensitive !== true) argv.push("-i");
    if (args.literal) argv.push("-F");
    argv.push("--", args.pattern, ".");
    let stdout;
    try {
      ({ stdout } = await exec(ripgrepPath(), argv, {
        cwd: base,
        windowsHide: true,
        timeout: 15000,
        maxBuffer: 4 * 1024 * 1024,
        signal,
      }));
    } catch (e) {
      if (e.code === 1) return { matches: [] };
      throw e;
    }
    const matches = [];
    for (const line of stdout.split("\n")) {
      if (!line) continue;
      const event = JSON.parse(line);
      if (event.type === "match") {
        const d = event.data;
        const entry = d.path.text.replaceAll("\\", "/").replace(/^\.\//, "");
        let target;
        try {
          target = await inside(base, entry);
        } catch {
          continue;
        }
        matches.push({
          path: location(session, target).path,
          line: d.line_number,
          text: d.lines.text.trimEnd(),
        });
      }
    }
    return { matches: matches.slice(0, 500), truncated: matches.length > 500 };
  }
  async function patch(session, args) {
    if (typeof args.patch !== "string" || args.patch.length > MAX)
      throw new Error("Нужен unified diff до 2 МБ");
    const parsed = parsePatch(args.patch),
      prepared = [];
    if (!parsed.length || parsed.length > 50)
      throw new Error("Патч должен содержать от 1 до 50 файлов");
    for (const part of parsed) {
      const relative = safeRelative(
        (part.newFileName === "/dev/null"
          ? part.oldFileName
          : part.newFileName
        ).replace(/^[ab]\//, ""),
      );
      if (prepared.some((p) => p.relative === relative))
        throw new Error("Повтор файла в патче");
      const before = await readText(
        await inside(root(session), relative, true),
        true,
      );
      if (
        part.oldFileName !== "/dev/null" &&
        part.newFileName !== "/dev/null" &&
        part.oldFileName.replace(/^[ab]\//, "") !==
          part.newFileName.replace(/^[ab]\//, "")
      )
        throw new Error("Переименование не поддерживается этим патчем");
      const applied = applyPatch(before || "", part, { fuzzFactor: 0 });
      if (
        applied === false ||
        (part.newFileName === "/dev/null" && applied !== "")
      )
        throw new Error(`Патч не подходит к ${relative}`);
      const after = part.newFileName === "/dev/null" ? null : applied;
      prepared.push({ relative, before, after });
    }
    const results = [];
    for (const p of prepared)
      results.push(
        await locked(path.resolve(root(session), p.relative), () =>
          writeValue(session, p.relative, p.before, p.after),
        ),
      );
    return results;
  }
  const checkpoints = (session) =>
    store.state.checkpoints.filter(
      (p) =>
        p.rootSessionId === (session.rootSessionId || session.id) && p.applied,
    );
  async function changes(session) {
    const points = checkpoints(session).filter((p) => !p.restoration),
      groups = new Map();
    for (const p of points)
      if (!groups.has(p.root + "\0" + p.path))
        groups.set(p.root + "\0" + p.path, p);
    const result = [];
    for (const p of groups.values()) {
      const before = JSON.parse(
        await fs.readFile(
          path.join(directory, "checkpoints", p.id, "before.json"),
          "utf8",
        ),
      );
      const after = await readText(await inside(p.root, p.path, true), true);
      if (before !== after)
        result.push({
          path: p.path,
          checkpointId: p.id,
          root: p.root,
          before: before || "",
          after: after || "",
          patch: createTwoFilesPatch(p.path, p.path, before || "", after || ""),
        });
    }
    return result;
  }
  async function restore(session, id) {
    const all = checkpoints(session),
      index = all.findIndex((p) => p.id === id);
    if (index < 0) throw new Error("Контрольная точка не найдена");
    const points = all
        .slice(index)
        .filter((p) => !p.restored && !p.restoration),
      groups = new Map();
    for (const p of points) {
      const key = p.root + "\0" + p.path;
      const item = groups.get(key);
      if (item) item.last = p;
      else groups.set(key, { first: p, last: p });
    }
    for (const { last } of groups.values()) {
      const current = await readText(
        await inside(last.root, last.path, true),
        true,
      );
      if ((current === null ? null : hash(current)) !== last.afterHash)
        throw new Error(
          `Файл ${last.path} изменён вне этих правок. Откат отменён.`,
        );
    }
    for (const { first, last } of groups.values()) {
      const before = JSON.parse(
        await fs.readFile(
          path.join(directory, "checkpoints", first.id, "before.json"),
          "utf8",
        ),
      );
      await locked(path.resolve(first.root, first.path), async () => {
        const current = await readText(
          await inside(last.root, last.path, true),
          true,
        );
        if ((current === null ? null : hash(current)) !== last.afterHash)
          throw new Error(`Файл ${last.path} изменён во время отката`);
        const undo = await writeValue(
          { ...session, worktreePath: first.root },
          first.path,
          current,
          before,
        );
        const point = store.state.checkpoints.find(
          (p) => p.id === undo.checkpointId,
        );
        point.restoration = true;
        point.restored = true;
      });
    }
    for (const p of points) p.restored = true;
    store.save();
    return { restored: groups.size };
  }
  return {
    root,
    read,
    write,
    edit,
    patch,
    glob,
    grep,
    checkpoints,
    changes,
    restore,
  };
}
module.exports = { createWorkspaceFiles, inside, safeRelative, hash };
