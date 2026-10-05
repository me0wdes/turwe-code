const { fileURLToPath } = require("node:url");
const {
  parseDropFiles,
  validateWindowsPath,
} = require("./clipboard-files.cjs");
const MiB = 1024 * 1024;
const IMAGE_TYPES = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};
const raw = (name) => `electron application/osclipboard;format="${name}"`;

async function bytes(item, type, limit) {
  const blob = await item.getType(type);
  if (blob.size > limit) throw new Error(`Вложение больше ${limit / MiB} МБ`);
  const data = Buffer.from(await blob.arrayBuffer());
  if (data.length > limit) throw new Error(`Вложение больше ${limit / MiB} МБ`);
  return data;
}

// Electron 44 exposes both normalized MIME types and native pasteboard formats.
async function importClipboardAttachments(
  clipboard,
  attachments,
  { platform = process.platform } = {},
) {
  const entries = await clipboard.read();
  const files = [];
  for (const item of entries) {
    let paths;
    if (item.types.includes(raw("CF_HDROP"))) {
      paths = parseDropFiles(await bytes(item, raw("CF_HDROP"), MiB));
    } else if (item.types.includes(raw("FileNameW"))) {
      const data = await bytes(item, raw("FileNameW"), MiB);
      const text = new TextDecoder("utf-16le", { fatal: true }).decode(data);
      paths = text.split("\0").filter(Boolean).map(validateWindowsPath);
    } else {
      const type = ["text/uri-list", raw("public.file-url")].find((type) =>
        item.types.includes(type),
      );
      if (type) {
        const text = (await bytes(item, type, MiB))
          .toString("utf8")
          .replace(/\0+$/, "");
        const urls = text
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter((line) => line && !line.startsWith("#"));
        if (urls.length && urls.every((url) => /^file:/i.test(url))) {
          paths = urls.map((url) =>
            fileURLToPath(url, { windows: platform === "win32" }),
          );
          if (paths.some((path) => path.includes("\0")))
            throw new Error("Некорректный путь файла в буфере обмена");
        }
      }
    }
    if (paths?.length) {
      for (const path of paths) if (!files.includes(path)) files.push(path);
      if (files.length > 8)
        throw new Error("Можно добавить до 8 файлов из буфера обмена");
    }
  }
  // Finder supplies a pasteboard item per file. Import all selected files,
  // rather than only the first item (or its thumbnail).
  if (files.length) return attachments.importFiles(files);
  const images = entries
    .map((item) => ({
      item,
      type: Object.keys(IMAGE_TYPES).find((type) => item.types.includes(type)),
    }))
    .filter((image) => image.type);
  if (images.length > 8)
    throw new Error("Можно добавить до 8 изображений из буфера обмена");
  if (images.length) {
    const result = [];
    for (const { item, type } of images) {
      const data = await bytes(item, type, 20 * MiB);
      result.push(
        await attachments.importBytes({
          name: `Снимок-${Date.now()}-${result.length + 1}.${IMAGE_TYPES[type]}`,
          data: data.toString("base64"),
        }),
      );
    }
    return result;
  }
  for (const item of entries) {
    if (!item.types.includes("text/plain")) continue;
    const data = await bytes(item, "text/plain", 2 * MiB);
    if (data.toString("utf8").trim())
      return [
        await attachments.importBytes({
          name: "Буфер обмена.txt",
          data: data.toString("base64"),
        }),
      ];
  }
  throw new Error(
    "В буфере нет изображения, файла или текста. Скопируйте их и попробуйте ещё раз.",
  );
}
module.exports = { importClipboardAttachments };
