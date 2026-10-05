const fs = require("node:fs/promises");
const path = require("node:path");
const LIMIT = 512 * 1024;
const ignored = (name) =>
  [".git", "node_modules", ".next", "dist", "release", ".aws", ".ssh"].includes(
    name.toLowerCase(),
  ) ||
  /^\.env(?:\.|$)/i.test(name) ||
  /\.(pem|key|pfx|p12)$/i.test(name);
async function resolveInside(root, relative = "") {
  if (
    typeof relative !== "string" ||
    relative.includes("\0") ||
    path.isAbsolute(relative) ||
    /^[a-z]:/i.test(relative) ||
    relative.split(/[\\/]/).some((p) => p === ".." || ignored(p))
  )
    throw new Error("Этот путь недоступен");
  const canonicalRoot = await fs.realpath(root);
  const target = await fs.realpath(path.resolve(canonicalRoot, relative));
  const remainder = path.relative(canonicalRoot, target);
  if (
    remainder === ".." ||
    remainder.startsWith(`..${path.sep}`) ||
    path.isAbsolute(remainder)
  )
    throw new Error("Файл находится за пределами проекта");
  return target;
}
async function listFiles(root, relative = "") {
  const dir = await resolveInside(root, relative);
  const entries = await fs.readdir(dir, { withFileTypes: true });
  return entries
    .filter((e) => !ignored(e.name) && !e.isSymbolicLink())
    .map((e) => ({
      name: e.name,
      path: path.join(relative, e.name).replaceAll("\\", "/"),
      directory: e.isDirectory(),
    }))
    .sort(
      (a, b) =>
        Number(b.directory) - Number(a.directory) ||
        a.name.localeCompare(b.name),
    )
    .slice(0, 2000);
}
async function readProjectFile(root, relative) {
  if (!relative) throw new Error("Выберите файл");
  const target = await resolveInside(root, relative);
  const handle = await fs.open(target, "r");
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new Error("Выберите обычный файл");
    if (stat.size > LIMIT)
      throw new Error("Файл больше 512 КБ. Выберите меньший текстовый файл.");
    const bytes = Buffer.alloc(LIMIT + 1);
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    if (bytesRead > LIMIT) throw new Error("Файл больше 512 КБ");
    const data = bytes.subarray(0, bytesRead);
    if (data.includes(0))
      throw new Error("Предпросмотр доступен только для текстовых файлов");
    let content;
    try {
      content = new TextDecoder("utf-8", { fatal: true }).decode(data);
    } catch {
      throw new Error("Нужен текстовый файл в кодировке UTF-8");
    }
    return { path: relative.replaceAll("\\", "/"), content, size: bytesRead };
  } finally {
    await handle.close();
  }
}
async function openProjectFolder(root, openPath) {
  let folder;
  try {
    if (typeof root !== "string" || !path.isAbsolute(root)) throw new Error();
    folder = await fs.realpath(root);
    if (!(await fs.stat(folder)).isDirectory()) throw new Error();
  } catch {
    throw new Error("Папка проекта недоступна. Проверьте её расположение.");
  }
  const error = await openPath(folder);
  if (error) throw new Error("Не удалось открыть папку в проводнике. Попробуйте ещё раз.");
  return null;
}
module.exports = { listFiles, readProjectFile, resolveInside, openProjectFolder };
