const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID, createHash } = require("node:crypto");
const { spawn } = require("node:child_process");
const { Worker, isMainThread, parentPort, workerData } = require("node:worker_threads");
const { pathToFileURL } = require("node:url");

const MiB = 1024 * 1024;
const LIMITS = { text: 2 * MiB, document: 20 * MiB, image: 20 * MiB, video: 100 * MiB };
const MAX_TEXT = 120000;
const MAX_FRAMES = 8;
const MEDIA_TIMEOUT = 30000;
const MAX_VISUAL = 12 * MiB;
const MAX_PREVIEW = 256 * 1024;
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const TEXT_EXTENSIONS = new Set("txt md markdown csv tsv json jsonl ndjson yaml yml xml html htm css scss sass less js jsx mjs cjs ts tsx mts cts py pyw rb rs go java kt kts swift c cc cpp cxx h hh hpp cs php sh bash zsh fish ps1 psm1 bat cmd sql graphql gql toml ini cfg conf log tex r vue svelte astro ipynb dockerfile gitignore gitattributes editorconfig".split(" "));
const TYPES = {
  png: ["image/png", "image", "png_pipe"],
  jpg: ["image/jpeg", "image", "jpeg_pipe"],
  jpeg: ["image/jpeg", "image", "jpeg_pipe"],
  webp: ["image/webp", "image", "webp_pipe"],
  gif: ["image/gif", "image", "gif"],
  pdf: ["application/pdf", "document"],
  docx: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "document"],
  mp4: ["video/mp4", "video", "mov"],
  m4v: ["video/mp4", "video", "mov"],
  mov: ["video/quicktime", "video", "mov"],
  webm: ["video/webm", "video", "matroska"],
};
const abortError = () => Object.assign(new Error("Attachment processing cancelled"), { name: "AbortError" });
function checkAbort(signal) { if (signal?.aborted) throw abortError(); }
function fail(message = "Invalid or unsupported attachment") { throw new Error(message); }
const digest = (data) => createHash("sha256").update(data).digest("hex");
const dataURL = (mime, data) => `data:${mime};base64,${data.toString("base64")}`;
function validName(name) {
  if (typeof name !== "string" || !name.trim() || name.length > 255 || /[\x00-\x1f\x7f\\/:]/.test(name) || name === "." || name === "..") fail("Invalid attachment name");
  return name;
}
function typeFor(name) {
  validName(name);
  const lower = name.toLowerCase();
  const ext = path.extname(lower).slice(1) || lower.replace(/^\./, "");
  if (TYPES[ext]) return { mime: TYPES[ext][0], kind: TYPES[ext][1], demuxer: TYPES[ext][2], ext, limit: LIMITS[TYPES[ext][1]] };
  if (!TEXT_EXTENSIONS.has(ext) && !["makefile", "dockerfile", "license", "readme"].includes(lower)) fail("Unsupported file type. Use text/code, PDF, DOCX, PNG, JPEG, WebP, GIF, MP4, MOV or WebM.");
  const mime = ({ md: "text/markdown", markdown: "text/markdown", csv: "text/csv", json: "application/json", html: "text/html", xml: "application/xml" })[ext] || "text/plain";
  return { mime, kind: "document", ext, text: true, limit: LIMITS.text };
}
function decodeText(data) {
  if (data.includes(0)) fail("Only UTF-8 text files are supported");
  try { return new TextDecoder("utf-8", { fatal: true }).decode(data); }
  catch { fail("Only UTF-8 text files are supported"); }
}
function imageEncoding(data) {
  if (data.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))) return "png";
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "jpg";
  if (/^GIF8[79]a$/.test(data.toString("ascii", 0, 6))) return "gif";
  if (data.toString("ascii", 0, 4) === "RIFF" && data.toString("ascii", 8, 12) === "WEBP") return "webp";
}
function dimensions(data, type) {
  let width, height;
  if (type.ext === "png") {
    if (data.length < 33 || !data.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")) || data.toString("ascii", 12, 16) !== "IHDR") fail("Invalid PNG image");
    width = data.readUInt32BE(16); height = data.readUInt32BE(20);
  } else if (type.mime === "image/jpeg") {
    if (data.length < 4 || data[0] !== 0xff || data[1] !== 0xd8) fail("Invalid JPEG image");
    let offset = 2;
    while (offset + 4 <= data.length) {
      if (data[offset++] !== 0xff) fail("Invalid JPEG image");
      while (data[offset] === 0xff) offset++;
      const marker = data[offset++];
      if (marker === 0xda || marker === 0xd9) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      const length = data.readUInt16BE(offset);
      if (length < 2 || offset + length > data.length) fail("Invalid JPEG image");
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        if (length < 8) fail("Invalid JPEG image");
        height = data.readUInt16BE(offset + 3); width = data.readUInt16BE(offset + 5); break;
      }
      offset += length;
    }
  } else if (type.ext === "gif") {
    if (data.length < 13 || !/^GIF8[79]a$/.test(data.toString("ascii", 0, 6))) fail("Invalid GIF image");
    width = data.readUInt16LE(6); height = data.readUInt16LE(8);
  } else if (type.ext === "webp") {
    if (data.length < 30 || data.toString("ascii", 0, 4) !== "RIFF" || data.toString("ascii", 8, 12) !== "WEBP" || data.readUInt32LE(4) + 8 !== data.length) fail("Invalid WebP image");
    const chunk = data.toString("ascii", 12, 16);
    if (chunk === "VP8X") { width = data.readUIntLE(24, 3) + 1; height = data.readUIntLE(27, 3) + 1; }
    else if (chunk === "VP8 " && data.subarray(23, 26).equals(Buffer.from([0x9d, 0x01, 0x2a]))) { width = data.readUInt16LE(26) & 0x3fff; height = data.readUInt16LE(28) & 0x3fff; }
    else if (chunk === "VP8L" && data[20] === 0x2f) { width = 1 + (data.readUInt32LE(21) & 0x3fff); height = 1 + ((data.readUInt32LE(21) >>> 14) & 0x3fff); }
  }
  if (!width || !height || width > 16384 || height > 16384 || width * height > 40000000) fail("Invalid image dimensions or image exceeds 40 megapixels");
  return { width, height };
}
function validateBytes(data, type) {
  if (data.length > type.limit) fail(`Attachment is too large (limit ${type.limit / MiB} MiB)`);
  if (type.text) return decodeText(data);
  if (!data.length) fail("Attachment is empty");
  if (type.kind === "image") dimensions(data, type);
  else if (type.ext === "pdf") {
    if (!/^%PDF-\d\.\d/.test(data.toString("ascii", 0, 8))) fail("Invalid PDF file");
  } else if (type.ext === "docx") validateDocx(data);
  else if (type.ext === "webm") {
    if (data.length < 16 || data.readUInt32BE(0) !== 0x1a45dfa3) fail("Invalid WebM video");
  } else if (type.kind === "video") {
    if (data.length < 16 || !["ftyp", "moov", "wide", "mdat", "free"].includes(data.toString("ascii", 4, 8))) fail("Invalid MP4/MOV video");
  }
}
async function readLimited(file, limit, { signal, noLinks = false } = {}) {
  checkAbort(signal);
  if (noLinks && (await fs.lstat(file)).isSymbolicLink()) fail("Attachment links are not allowed");
  const handle = await fs.open(file, "r");
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) fail("Select a regular file");
    if (stat.size > limit) fail(`Attachment is too large (limit ${limit / MiB} MiB)`);
    // A bounded read also covers a file growing after the initial stat.
    const data = Buffer.alloc(Math.min(stat.size + 1, limit + 1));
    let offset = 0;
    while (offset < data.length) {
      checkAbort(signal);
      const { bytesRead } = await handle.read(data, offset, data.length - offset, offset);
      if (!bytesRead) break;
      offset += bytesRead;
    }
    if (offset > stat.size || offset > limit) fail("Attachment changed while being read; try again");
    return data.subarray(0, offset);
  } finally { await handle.close(); }
}
function ffmpegExecutable() {
  const binary = require("ffmpeg-static");
  if (!binary) fail("Video/image decoder is unavailable on this platform");
  // Electron cannot spawn an executable inside its ASAR archive.
  return binary.replace(/([\\/])app\.asar([\\/])/, "$1app.asar.unpacked$2");
}
function runFfmpeg(args, { signal, deadline = Date.now() + MEDIA_TIMEOUT, maxOutput = MAX_VISUAL } = {}) {
  checkAbort(signal);
  const timeout = deadline - Date.now();
  if (timeout <= 0) return Promise.reject(new Error("Attachment processing timed out"));
  return new Promise((resolve, reject) => {
    let child;
    try { child = spawn(ffmpegExecutable(), ["-hide_banner", "-nostdin", "-max_alloc", String(64 * MiB), ...args], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"], shell: false }); }
    catch (error) { reject(error); return; }
    let stdoutSize = 0, stderrSize = 0, failure;
    const stdout = [], stderr = [];
    const stop = (error) => { failure ||= error; child.kill("SIGKILL"); };
    const abort = () => stop(abortError());
    const timer = setTimeout(() => stop(new Error("Attachment processing timed out")), timeout);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    child.stdout.on("data", (chunk) => {
      stdoutSize += chunk.length;
      if (stdoutSize > maxOutput) stop(new Error("Decoded attachment exceeds the output size limit"));
      else stdout.push(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderrSize += chunk.length;
      if (stderrSize <= 128 * 1024) stderr.push(chunk);
      else stop(new Error("Attachment decoder produced excessive diagnostics"));
    });
    child.once("error", (error) => { failure ||= error; });
    child.once("close", (code) => {
      clearTimeout(timer); signal?.removeEventListener("abort", abort);
      if (failure) reject(failure);
      else if (code !== 0) reject(new Error("Could not decode this attachment. The file may be damaged or unsupported."));
      else resolve({ data: Buffer.concat(stdout), diagnostics: Buffer.concat(stderr).toString("utf8") });
    });
  });
}
function inputArgs(file, type) {
  return ["-protocol_whitelist", "file,pipe", "-f", type.demuxer, ...(type.demuxer === "mov" ? ["-enable_drefs", "0"] : []), "-max_pixels", "40000000", "-threads", "1", "-i", file];
}
function scaleFilter(size) { return `scale=w='min(${size},iw)':h='min(${size},ih)':force_original_aspect_ratio=decrease`; }
async function decodeVisual(file, type, size, options, timestamp) {
  const args = ["-loglevel", "error", ...(timestamp !== undefined ? ["-ss", timestamp.toFixed(3)] : []), ...inputArgs(file, type), "-map", "0:v:0", "-frames:v", "1", "-an", "-sn", "-dn", "-vf", scaleFilter(size), "-threads", "1", "-c:v", "mjpeg", "-q:v", "3", "-f", "image2pipe", "pipe:1"];
  const { data } = await runFfmpeg(args, options);
  dimensions(data, { mime: "image/jpeg", ext: "jpg" });
  return { data, mime: "image/jpeg" };
}
function resized(image, bound) {
  const { width, height } = image.getSize();
  if (!width || !height) fail("Invalid image");
  if (Math.max(width, height) <= bound) return image;
  const factor = bound / Math.max(width, height);
  return image.resize({ width: Math.max(1, Math.round(width * factor)), height: Math.max(1, Math.round(height * factor)), quality: "best" });
}
async function processImage(data, file, type, nativeImage, options) {
  if (nativeImage && ["image/png", "image/jpeg"].includes(type.mime)) {
    const image = nativeImage.createFromBuffer(data);
    if (image.isEmpty()) fail("Invalid or damaged image");
    const model = { data: resized(image, 2048).toPNG(), mime: "image/png" };
    const thumbnail = { data: resized(image, 320).toJPEG(75), mime: "image/jpeg" };
    if (model.data.length > MAX_VISUAL || thumbnail.data.length > MAX_PREVIEW) fail("Decoded image exceeds the size limit");
    return { model, thumbnail };
  }
  return { model: await decodeVisual(file, type, 2048, options), thumbnail: await decodeVisual(file, type, 320, { ...options, maxOutput: MAX_PREVIEW }) };
}
function timestampLabel(seconds) {
  const mins = Math.floor(seconds / 60);
  return `${mins}:${(seconds % 60).toFixed(2).padStart(5, "0")}`;
}
async function sampleVideo(file, type, options) {
  const probe = await runFfmpeg(["-loglevel", "info", ...inputArgs(file, type), "-map", "0:v:0", "-frames:v", "0", "-an", "-sn", "-dn", "-f", "null", "-"], { ...options, maxOutput: 1024 });
  const match = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(probe.diagnostics);
  if (!match) fail("Video duration is unavailable; use a complete MP4, MOV or WebM file");
  const duration = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
  if (!Number.isFinite(duration) || duration <= 0 || duration > 24 * 3600) fail("Invalid video duration or video is longer than 24 hours");
  const frames = [];
  const count = Math.min(MAX_FRAMES, Math.max(1, Math.ceil(duration)));
  for (let i = 0; i < count; i++) {
    const timestamp = duration * i / count;
    const frame = await decodeVisual(file, type, 1280, options, timestamp);
    frames.push({ ...frame, timestamp });
  }
  const thumbnail = await decodeVisual(file, type, 320, { ...options, maxOutput: MAX_PREVIEW }, 0);
  return { frames, thumbnail, note: `${count} sampled frames from ${timestampLabel(duration)} of video. Only these still frames are available; no audio is included or transcribed. Events between frames may be missed.` };
}
function validateDocx(data) {
  if (data.length < 22 || data.readUInt32LE(0) !== 0x04034b50) fail("Invalid DOCX archive");
  let end = -1;
  for (let offset = data.length - 22; offset >= Math.max(0, data.length - 65557); offset--) {
    if (data.readUInt32LE(offset) === 0x06054b50 && offset + 22 + data.readUInt16LE(offset + 20) === data.length) { end = offset; break; }
  }
  if (end < 0) fail("Invalid DOCX archive");
  const count = data.readUInt16LE(end + 10);
  const start = data.readUInt32LE(end + 16);
  if (data.readUInt16LE(end + 4) || data.readUInt16LE(end + 6) || data.readUInt16LE(end + 8) !== count || count > 2048 || start + data.readUInt32LE(end + 12) !== end) fail("Unsupported or oversized DOCX archive");
  let offset = start, expanded = 0;
  const names = new Set();
  for (let index = 0; index < count; index++) {
    if (offset + 46 > end || data.readUInt32LE(offset) !== 0x02014b50) fail("Invalid DOCX archive");
    const flags = data.readUInt16LE(offset + 8);
    const method = data.readUInt16LE(offset + 10);
    const compressed = data.readUInt32LE(offset + 20);
    const size = data.readUInt32LE(offset + 24);
    const nameLength = data.readUInt16LE(offset + 28);
    const recordLength = 46 + nameLength + data.readUInt16LE(offset + 30) + data.readUInt16LE(offset + 32);
    if (offset + recordLength > end || flags & 1 || ![0, 8].includes(method)) fail("Invalid or encrypted DOCX archive");
    const name = data.toString("utf8", offset + 46, offset + 46 + nameLength);
    if (!name || names.has(name) || /[\x00\\:]/.test(name) || name.startsWith("/") || name.split("/").includes("..")) fail("Invalid DOCX archive entry");
    names.add(name);
    expanded += size;
    if (size > 16 * MiB || expanded > 64 * MiB) fail("DOCX archive expands beyond the size limit");
    const local = data.readUInt32LE(offset + 42);
    if (local + 30 > start || data.readUInt32LE(local) !== 0x04034b50 || local + 30 + data.readUInt16LE(local + 26) + data.readUInt16LE(local + 28) + compressed > start) fail("Invalid DOCX archive entry");
    offset += recordLength;
  }
  if (offset !== end || !names.has("[Content_Types].xml") || !names.has("word/document.xml")) fail("This archive is not a DOCX document");
}
async function parseDocument(data, format) {
  if (format === "docx") {
    const { value } = await require("mammoth").extractRawText({ buffer: Buffer.from(data) });
    return { text: value.slice(0, MAX_TEXT), note: `DOCX text extraction; images and page layout are not included.${value.length > MAX_TEXT ? " Text truncated to the first 120,000 characters." : ""}${!value.trim() ? " No readable text was found." : ""}` };
  }
  const pdfjs = await import(pathToFileURL(require.resolve("pdfjs-dist/legacy/build/pdf.mjs")).href);
  const task = pdfjs.getDocument({
    data: Uint8Array.from(data),
    verbosity: 0,
    isEvalSupported: false,
    enableXfa: false,
    disableFontFace: true,
    useSystemFonts: false,
    useWorkerFetch: false,
    useWasm: false,
    isOffscreenCanvasSupported: false,
    disableAutoFetch: true,
    stopAtErrors: true,
  });
  try {
    const pdf = await task.promise;
    let text = "", pages = 0;
    const count = Math.min(pdf.numPages, 100);
    for (let index = 1; index <= count && text.length < MAX_TEXT; index++) {
      const page = await pdf.getPage(index);
      const content = await page.getTextContent();
      const pageText = content.items.map((item) => typeof item.str === "string" ? item.str + (item.hasEOL ? "\n" : " ") : "").join("");
      text += `\n[Page ${index}]\n${pageText}`;
      pages++;
      page.cleanup();
    }
    const clipped = text.length > MAX_TEXT || pages < pdf.numPages;
    const hasText = text.replace(/\[Page \d+\]/g, "").trim().length > 0;
    return { text: text.slice(0, MAX_TEXT), note: `PDF text extraction (${pages} of ${pdf.numPages} pages); images, scanned page content and layout are not included.${clipped ? " Text truncated at the page or character limit." : ""}${!hasText ? " No readable text was found; OCR has not been performed." : ""}` };
  } finally { await task.destroy(); }
}
function extractDocument(data, format, { signal } = {}) {
  checkAbort(signal);
  return new Promise((resolve, reject) => {
    const worker = new Worker(__filename, {
      workerData: { attachmentParser: true, format, data },
      resourceLimits: { maxOldGenerationSizeMb: 192, maxYoungGenerationSizeMb: 16 },
    });
    let settled = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      void worker.terminate();
      if (error) reject(error); else resolve(result);
    };
    const abort = () => finish(abortError());
    const timer = setTimeout(() => finish(new Error("Document extraction timed out")), 20000);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    worker.once("message", (result) => {
      if (result.error) finish(new Error(`Could not read ${format.toUpperCase()}: ${result.error}`));
      else if (typeof result.text !== "string" || result.text.length > MAX_TEXT || typeof result.note !== "string") finish(new Error("Invalid document extraction result"));
      else finish(null, result);
    });
    worker.once("error", (error) => finish(error));
    worker.once("exit", (code) => { if (!settled) finish(new Error(`Document extraction stopped before completion (${code})`)); });
  });
}

function createAttachmentStore({ directory, nativeImage } = {}) {
  if (typeof directory !== "string" || !path.isAbsolute(directory)) fail("An absolute attachment storage directory is required");
  const root = path.resolve(directory);
  async function rootDirectory() { await fs.mkdir(root, { recursive: true }); return fs.realpath(root); }
  async function attachmentDirectory(id) {
    if (typeof id !== "string" || !ID.test(id)) fail("Invalid attachment ID");
    const canonical = await rootDirectory();
    const target = path.join(canonical, id);
    const stat = await fs.lstat(target);
    if (!stat.isDirectory() || stat.isSymbolicLink() || path.dirname(await fs.realpath(target)) !== canonical) fail("Invalid attachment storage path");
    return target;
  }
  async function load(id) {
    const target = await attachmentDirectory(id);
    const bytes = await readLimited(path.join(target, "metadata.json"), 64 * 1024, { noLinks: true });
    const stored = JSON.parse(bytes.toString("utf8"));
    const type = typeFor(stored.name);
    if (stored.version !== 1 || stored.id !== id || stored.mime !== type.mime || stored.kind !== type.kind || !Number.isSafeInteger(stored.size) || stored.size < 0 || stored.size > type.limit || !/^[0-9a-f]{64}$/.test(stored.sha256) || !Array.isArray(stored.assets) || stored.assets.length > MAX_FRAMES + 2 || (stored.note !== undefined && (typeof stored.note !== "string" || stored.note.length > 2048))) fail("Invalid attachment metadata");
    const names = new Set();
    for (const asset of stored.assets) {
      if (!/^(?:text\.txt|image\.(?:png|jpg)|preview\.jpg|frame-[0-7]\.jpg)$/.test(asset.file) || names.has(asset.file) || !["text/plain", "image/png", "image/jpeg"].includes(asset.mime) || !/^[0-9a-f]{64}$/.test(asset.sha256) || !Number.isSafeInteger(asset.size) || asset.size < 0 || asset.size > MAX_VISUAL || (asset.timestamp !== undefined && (!Number.isFinite(asset.timestamp) || asset.timestamp < 0 || asset.timestamp > 86400))) fail("Invalid attachment assets");
      const expectedMime = asset.file === "text.txt" ? "text/plain" : asset.file.endsWith(".png") ? "image/png" : "image/jpeg";
      if (asset.mime !== expectedMime || (asset.file.startsWith("frame-") !== (asset.timestamp !== undefined))) fail("Invalid attachment asset type");
      names.add(asset.file);
    }
    const expected = type.kind === "document" ? stored.assets.length === 1 && names.has("text.txt") : type.kind === "image" ? stored.assets.length === 2 && names.has("preview.jpg") && (names.has("image.jpg") || names.has("image.png")) : stored.assets.length >= 2 && names.has("preview.jpg") && stored.assets.filter((asset) => /^frame-/.test(asset.file)).length === stored.assets.length - 1;
    if (!expected) fail("Incomplete attachment metadata");
    return { stored, target };
  }
  function publicMetadata(stored) {
    return Object.freeze({ id: stored.id, name: stored.name, path: stored.name, mime: stored.mime, size: stored.size, kind: stored.kind, ...(stored.note ? { note: stored.note } : {}) });
  }
  async function assetBytes(target, asset, signal) {
    const data = await readLimited(path.join(target, asset.file), asset.file === "preview.jpg" ? MAX_PREVIEW : MAX_VISUAL, { signal, noLinks: true });
    if (data.length !== asset.size || digest(data) !== asset.sha256) fail("Stored attachment content has changed or is damaged");
    return data;
  }
  async function importData(name, data, { signal } = {}) {
    checkAbort(signal);
    let type = typeFor(name);
    if (type.kind === "image") {
      const encoding = imageEncoding(data);
      // File extensions from Explorer/browser downloads are not reliable. Keep
      // the stored name and MIME consistent, then run the full decoder checks.
      if (encoding && TYPES[encoding][0] !== type.mime) {
        name = name.slice(0, -path.extname(name).length) + "." + encoding;
        type = typeFor(name);
      }
    }
    const text = validateBytes(data, type);
    const canonical = await rootDirectory();
    const id = randomUUID();
    const target = path.join(canonical, id);
    await fs.mkdir(target);
    try {
      const source = path.join(target, "original");
      await fs.writeFile(source, data, { flag: "wx", signal });
      const stored = { version: 1, id, name, mime: type.mime, size: data.length, kind: type.kind, sha256: digest(data), assets: [] };
      async function save(file, asset) {
        checkAbort(signal);
        if (asset.data.length > (file === "preview.jpg" ? MAX_PREVIEW : MAX_VISUAL)) fail("Processed attachment exceeds the size limit");
        await fs.writeFile(path.join(target, file), asset.data, { flag: "wx", signal });
        stored.assets.push({ file, mime: asset.mime, size: asset.data.length, sha256: digest(asset.data), ...(asset.timestamp !== undefined ? { timestamp: asset.timestamp } : {}) });
      }
      const options = { signal, deadline: Date.now() + MEDIA_TIMEOUT };
      if (type.kind === "document") {
        const document = type.text ? { text } : await extractDocument(data, type.ext, { signal });
        const clipped = document.text.slice(0, MAX_TEXT);
        if (document.note) stored.note = document.note;
        if (clipped.length < document.text.length) stored.note = [stored.note, "Text truncated to the first 120,000 characters."].filter(Boolean).join(" ");
        await save("text.txt", { data: Buffer.from(clipped), mime: "text/plain" });
      } else if (type.kind === "image") {
        const { model, thumbnail } = await processImage(data, source, type, nativeImage, options);
        await save(model.mime === "image/png" ? "image.png" : "image.jpg", model);
        await save("preview.jpg", thumbnail);
        if (["gif", "webp"].includes(type.ext)) stored.note = "Image supplied as a still frame; animation is not included.";
      } else {
        const { frames, thumbnail, note } = await sampleVideo(source, type, options);
        for (let index = 0; index < frames.length; index++) await save(`frame-${index}.jpg`, frames[index]);
        await save("preview.jpg", thumbnail);
        stored.note = note;
      }
      checkAbort(signal);
      await fs.writeFile(path.join(target, "metadata.json"), JSON.stringify(stored), { flag: "wx", signal });
      return publicMetadata(stored);
    } catch (error) {
      // target is a fresh UUID child of the canonical root, never a caller path.
      if (path.dirname(target) === canonical && ID.test(path.basename(target))) await fs.rm(target, { recursive: true, force: true }).catch(() => {});
      if (signal?.aborted) throw abortError();
      throw error;
    }
  }
  async function importFiles(paths, { signal } = {}) {
    checkAbort(signal);
    if (!Array.isArray(paths) || paths.length > 8) fail("Choose up to 8 attachments at a time");
    const result = [];
    for (const file of paths) {
      if (typeof file !== "string" || !path.isAbsolute(file) || file.includes("\0")) fail("Invalid attachment file path");
      const name = path.basename(file);
      const type = typeFor(name);
      result.push(await importData(name, await readLimited(file, type.limit, { signal }), { signal }));
    }
    return result;
  }
  async function importBytes(value, { signal } = {}) {
    checkAbort(signal);
    if (!value || typeof value !== "object") fail();
    const type = typeFor(value.name);
    if (typeof value.data !== "string" || value.data.length > 4 * Math.ceil(type.limit / 3)) fail(`Attachment is too large (limit ${type.limit / MiB} MiB)`);
    if (value.data.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(value.data)) fail("Malformed base64 attachment");
    const data = Buffer.from(value.data, "base64");
    if (data.toString("base64") !== value.data) fail("Malformed base64 attachment");
    return importData(value.name, data, { signal });
  }
  async function get(id) { return publicMetadata((await load(id)).stored); }
  async function preview(id) {
    const { stored, target } = await load(id);
    const asset = stored.assets.find((item) => item.file === "preview.jpg");
    return asset ? dataURL(asset.mime, await assetBytes(target, asset)) : null;
  }
  async function prepare(refs, { signal } = {}) {
    checkAbort(signal);
    if (!Array.isArray(refs) || refs.length > 8) fail("Choose up to 8 attachments per message");
    const parts = [];
    let remaining = MAX_TEXT;
    function addText(name, content, note) {
      const selected = content.slice(0, remaining);
      remaining -= selected.length;
      const clipped = selected.length < content.length ? " Text truncated because the message attachment text limit was reached." : "";
      parts.push({ type: "text", text: `Attachment: ${name}${note ? `\n${note}` : ""}${clipped}\n<attachment_content>\n${selected}\n</attachment_content>` });
    }
    for (const ref of refs) {
      checkAbort(signal);
      if (!ref || typeof ref !== "object") fail("Invalid attachment reference");
      if (Object.prototype.hasOwnProperty.call(ref, "id")) {
        const { stored, target } = await load(ref.id);
        if (stored.kind === "document") {
          addText(stored.name, decodeText(await assetBytes(target, stored.assets[0], signal)), stored.note);
        } else {
          parts.push({ type: "text", text: `Attachment: ${stored.name}${stored.note ? `\n${stored.note}` : ""}` });
          for (const asset of stored.assets.filter((item) => item.file !== "preview.jpg")) {
            if (asset.timestamp !== undefined) parts.push({ type: "text", text: `Sampled video frame at approximately ${timestampLabel(asset.timestamp)}:` });
            parts.push({ type: "image_url", image_url: { url: dataURL(asset.mime, await assetBytes(target, asset, signal)) } });
          }
        }
      } else {
        if (typeof ref.path !== "string" || ref.path.length > 512 || !ref.path || /[\x00-\x1f\x7f:]/.test(ref.path) || path.isAbsolute(ref.path) || /^[\\/]/.test(ref.path) || ref.path.split(/[\\/]/).some((segment) => segment === ".." || !segment) || typeof ref.content !== "string" || Buffer.byteLength(ref.content) > LIMITS.text) fail("Invalid legacy attachment");
        // Legacy records already contain a text snapshot. Extension checks or
        // filesystem reads would invalidate legitimate code files or replace it.
        // A UTF-8 round trip rejects lone surrogates without stripping a BOM.
        if (ref.content.includes("\0") || Buffer.from(ref.content, "utf8").toString("utf8") !== ref.content) fail("Legacy attachments must contain valid UTF-8 text");
        addText(ref.path, ref.content);
      }
    }
    return parts;
  }
  return Object.freeze({ importFiles, importBytes, get, preview, prepare });
}

module.exports = { createAttachmentStore };

if (!isMainThread && workerData?.attachmentParser === true) {
  parseDocument(workerData.data, workerData.format).then(
    (result) => parentPort.postMessage(result),
    (error) => parentPort.postMessage({ error: String(error.message || error).slice(0, 300) }),
  );
}
