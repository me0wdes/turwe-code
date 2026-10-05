const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { promisify } = require("node:util");
const execFile = promisify(require("node:child_process").execFile);

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=", "base64");
function implementation() {
  let module;
  assert.doesNotThrow(() => { module = require("../electron/attachments.cjs"); }, "attachment store is available");
  assert.equal(typeof module.createAttachmentStore, "function");
  return module.createAttachmentStore;
}
async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "turwe-attachments-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const directory = path.join(dir, "stored");
  return { dir, directory, store: implementation()({ directory }) };
}
const bytes = (name, content) => ({ name, data: Buffer.from(content).toString("base64") });

test("copies originals so content persists after source removal and store restart", async (t) => {
  const { dir, directory, store } = await fixture(t);
  const source = path.join(dir, "notes.md");
  await fs.writeFile(source, "# История\nPersist this original.");
  const [attachment] = await store.importFiles([source]);
  await fs.rm(source);
  const restored = implementation()({ directory });
  assert.equal(attachment.name, "notes.md");
  assert.equal(attachment.path, "notes.md");
  assert.equal(attachment.kind, "document");
  assert.equal(attachment.mime, "text/markdown");
  assert.ok(!JSON.stringify(attachment).includes("Persist this original"));
  assert.ok(!JSON.stringify(attachment).includes(dir.replaceAll("\\", "\\\\")));
  assert.deepEqual(await restored.get(attachment.id), attachment);
  assert.ok(Object.isFrozen(await restored.get(attachment.id)));
  const content = await restored.prepare([attachment]);
  assert.match(content[0].text, /# История\nPersist this original\./);
  assert.equal(await restored.preview(attachment.id), null);
});

test("prepares stored content and ignores forged renderer metadata", async (t) => {
  const { store } = await fixture(t);
  const attachment = await store.importBytes(bytes("app.ts", "export const answer = 42;"));
  const parts = await store.prepare([{ ...attachment, name: "forged.txt", path: "C:/secret", content: "FORGED", mime: "image/png" }]);
  assert.equal(parts.length, 1);
  assert.equal(parts[0].type, "text");
  assert.match(parts[0].text, /app\.ts/);
  assert.match(parts[0].text, /export const answer = 42;/);
  assert.doesNotMatch(parts[0].text, /FORGED|C:\/secret|forged\.txt/);
});

test("rejects traversal IDs and invalid metadata instead of reading other files", async (t) => {
  const { store } = await fixture(t);
  for (const id of ["../secret", "C:\\secret", "", "00000000-0000-0000-0000-000000000000"]) {
    await assert.rejects(store.get(id));
    await assert.rejects(store.prepare([{ id, path: "safe.txt", content: "fallback" }]));
  }
});

test("rejects malformed base64, path-like names, binary masquerading as text and unsupported files", async (t) => {
  const { store } = await fixture(t);
  for (const item of [
    { name: "a.txt", data: "not base64!" },
    { name: "a.txt", data: "YQ==extra" },
    { name: "a.txt", data: "data:text/plain;base64,YQ==" },
    bytes("../a.txt", "escape"),
    bytes("C:\\a.txt", "escape"),
    bytes("stream.txt:secret", "escape"),
    bytes("a.txt", Buffer.from([0xff, 0xfe, 0x41])),
    bytes("a.txt", Buffer.from([0, 1, 2])),
    bytes("run.exe", "executable"),
    bytes("photo.png", "not an image"),
  ]) await assert.rejects(store.importBytes(item), item.name);
});

test("enforces file size before reading and refuses directories", async (t) => {
  const { dir, store } = await fixture(t);
  const source = path.join(dir, "oversized.txt");
  const handle = await fs.open(source, "w");
  await handle.truncate(2 * 1024 * 1024 + 1);
  await handle.close();
  await assert.rejects(store.importFiles([source]), /large|big|limit|больш|МБ/i);
  await assert.rejects(store.importBytes(bytes("oversized.txt", "x".repeat(2 * 1024 * 1024 + 1))), /large|big|limit|больш|МБ/i);
  await assert.rejects(store.importFiles([dir]));
});

test("accepts safe legacy inline text without interpreting its path as a filesystem path", async (t) => {
  const { store } = await fixture(t);
  const parts = await store.prepare([{ path: "src/main.js", content: "console.log('legacy');", size: 22 }]);
  assert.match(parts[0].text, /src\/main\.js/);
  assert.match(parts[0].text, /console\.log\('legacy'\);/);
  await assert.rejects(store.prepare([{ path: "../private.txt", content: "no" }]));
  await assert.rejects(store.prepare([{ path: "a.txt", content: "a\0b" }]));
});

test("prepares extension-independent legacy UTF-8 snapshots without rereading or altering them", async (t) => {
  const { store } = await fixture(t);
  const content = "\ufeff  # Сохранённый снимок 📎\r\nversion = 4\n  ";
  for (const file of ["Cargo.lock", "go.mod", "settings.properties", "unknown.extension"]) {
    const [part] = await store.prepare([{ path: `missing/${file}`, content, size: 1 }]);
    assert.equal(part.type, "text");
    assert.ok(part.text.includes(`<attachment_content>\n${content}\n</attachment_content>`));
  }
  await assert.rejects(store.prepare([{ path: "Cargo.lock", content: "broken\ud800" }]));
  await assert.rejects(store.prepare([{ path: "go.mod", content: "a".repeat(2 * 1024 * 1024 + 1), size: 1 }]));
});

test("limits prepared text and tells the model when it is truncated", async (t) => {
  const { store } = await fixture(t);
  const attachment = await store.importBytes(bytes("long.txt", "BEGIN\n" + "a".repeat(200000) + "\nEND"));
  const parts = await store.prepare([attachment]);
  const text = parts.map((part) => part.text || "").join("");
  assert.match(text, /BEGIN/);
  assert.doesNotMatch(text, /\nEND/);
  assert.match(text, /truncat|обрез|сокращ/i);
  assert.ok(text.length < 130000);
});

test("honors cancellation before importing or preparing attachments", async (t) => {
  const { store } = await fixture(t);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(store.importBytes(bytes("a.txt", "text"), { signal: controller.signal }), { name: "AbortError" });
  await assert.rejects(store.importFiles([], { signal: controller.signal }), { name: "AbortError" });
  await assert.rejects(store.prepare([], { signal: controller.signal }), { name: "AbortError" });
});

test("prepares real decoded image content and a local preview after restart", async (t) => {
  const { store, directory } = await fixture(t);
  const image = await store.importBytes(bytes("pixel.png", PNG));
  assert.equal(image.kind, "image");
  assert.equal(image.mime, "image/png");
  const restored = implementation()({ directory });
  const parts = await restored.prepare([image]);
  const visual = parts.find((part) => part.type === "image_url");
  assert.match(visual.image_url.url, /^data:image\/(png|jpeg);base64,/);
  assert.ok(Buffer.from(visual.image_url.url.split(",")[1], "base64").length > 30);
  assert.match(await restored.preview(image.id), /^data:image\/(png|jpeg);base64,/);
  assert.ok(JSON.stringify(image).length < 150000);
});

test("recognizes image bytes when a file from Explorer has the wrong image extension", async (t) => {
  const { dir, store, directory } = await fixture(t);
  const source = path.join(dir, 'actual.jpg');
  await execFile(require('ffmpeg-static'), ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=orange:s=32x24', '-frames:v', '1', '-threads', '1', source], { windowsHide: true, timeout: 15000 });
  const image = await store.importBytes(bytes('photo.png', await fs.readFile(source)));
  assert.equal(image.mime, 'image/jpeg');
  assert.equal(image.name, 'photo.jpg');
  const restored = implementation()({ directory });
  assert.equal((await restored.get(image.id)).mime, 'image/jpeg');
  assert.match(await restored.preview(image.id), /^data:image\/(jpeg|png);base64,/);
  assert.ok((await restored.prepare([image])).some(part => part.type === 'image_url'));
  const png = await store.importBytes(bytes('photo.jpg', PNG));
  assert.equal(png.mime, 'image/png');
  assert.equal(png.name, 'photo.png');
});

test("does not follow attachment directory junctions", async (t) => {
  const { dir, directory, store } = await fixture(t);
  const attachment = await store.importBytes(bytes("a.txt", "safe"));
  const original = path.join(directory, attachment.id);
  const outside = path.join(dir, "outside");
  await fs.rename(original, outside);
  await fs.symlink(outside, original, process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(store.get(attachment.id));
  await assert.rejects(store.prepare([attachment]));
});

test("prepares sampled video frames with timestamps and a no-audio disclosure", async (t) => {
  const { dir, store, directory } = await fixture(t);
  const source = path.join(dir, "clip.mp4");
  await execFile(require("ffmpeg-static"), ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=size=160x96:rate=4", "-t", "2", "-c:v", "libx264", "-pix_fmt", "yuv420p", source], { windowsHide: true, timeout: 15000 });
  const [video] = await store.importFiles([source]);
  await fs.rm(source);
  const restored = implementation()({ directory });
  const parts = await restored.prepare([video]);
  const images = parts.filter((part) => part.type === "image_url");
  const text = parts.filter((part) => part.type === "text").map((part) => part.text).join("\n");
  assert.equal(video.kind, "video");
  assert.ok(images.length >= 1 && images.length <= 8);
  assert.match(text, /\d+:\d{2}/);
  assert.match(text, /no audio|audio.*not|без звука/i);
  assert.match(text, /sample|frame|кадр/i);
  assert.match(await restored.preview(video.id), /^data:image\/(png|jpeg);base64,/);
});

test("rejects corrupt video and removes incomplete attachment data", async (t) => {
  const { store, directory } = await fixture(t);
  const corrupt = Buffer.from("000000186674797069736f6d0000020069736f6d69736f32", "hex");
  await assert.rejects(store.importBytes(bytes("broken.mp4", corrupt)));
  assert.deepEqual(await fs.readdir(directory), []);
});

test("extracts persisted PDF and DOCX text without sending binary data as text", async (t) => {
  const { store, directory } = await fixture(t);
  for (const [extension, expected] of [["pdf", "Persistent PDF evidence."], ["docx", "Persistent DOCX evidence."]]) {
    const data = (await fs.readFile(path.join(__dirname, "fixtures", "attachments", `sample.${extension}.base64`), "utf8")).trim();
    const attachment = await store.importBytes({ name: `sample.${extension}`, data });
    const restored = implementation()({ directory });
    const parts = await restored.prepare([attachment]);
    assert.equal(parts.length, 1);
    assert.match(parts[0].text, new RegExp(expected.replaceAll(".", "\\.")));
    assert.ok(parts[0].text.length < 1000);
    assert.equal(await restored.preview(attachment.id), null);
  }
});

test("rejects damaged documents and DOCX archives that claim excessive expansion", async (t) => {
  const { store } = await fixture(t);
  await assert.rejects(store.importBytes(bytes("fake.pdf", "%PDF-1.7\nnot a document")));
  await assert.rejects(store.importBytes(bytes("fake.docx", Buffer.from([0x50, 0x4b, 0x03, 0x04]))));
  const base64 = await fs.readFile(path.join(__dirname, "fixtures", "attachments", "sample.docx.base64"), "utf8");
  const archive = Buffer.from(base64, "base64");
  const central = archive.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  assert.ok(central >= 0);
  archive.writeUInt32LE(0x7fffffff, central + 24);
  await assert.rejects(store.importBytes(bytes("bomb.docx", archive)), /large|limit|archive|МБ/i);
});

test("accepts text at the size limit without a base64 validator stack overflow", async (t) => {
  const { store } = await fixture(t);
  const attachment = await store.importBytes(bytes("large.txt", "x".repeat(2 * 1024 * 1024)));
  assert.equal(attachment.size, 2 * 1024 * 1024);
});

test("rejects oversized image dimensions before allocating a decoded image", async (t) => {
  const { store } = await fixture(t);
  const png = Buffer.from(PNG);
  png.writeUInt32BE(65000, 16);
  png.writeUInt32BE(65000, 20);
  await assert.rejects(store.importBytes(bytes("bomb.png", png)), /dimensions|megapixels/i);
});

test("detects stored content corruption before it can reach the model", async (t) => {
  const { store, directory } = await fixture(t);
  const attachment = await store.importBytes(bytes("a.txt", "original"));
  await fs.writeFile(path.join(directory, attachment.id, "text.txt"), "replaced");
  await assert.rejects(store.prepare([attachment]), /changed|damaged/i);
});

test("rejects tampered asset paths and mismatched asset MIME types", async (t) => {
  const { store, directory } = await fixture(t);
  const attachment = await store.importBytes(bytes("a.txt", "original"));
  const manifest = path.join(directory, attachment.id, "metadata.json");
  const metadata = JSON.parse(await fs.readFile(manifest, "utf8"));
  metadata.assets[0].file = "../../secret.txt";
  await fs.writeFile(manifest, JSON.stringify(metadata));
  await assert.rejects(store.get(attachment.id));
  metadata.assets[0].file = "text.txt";
  metadata.assets[0].mime = "image/png";
  await fs.writeFile(manifest, JSON.stringify(metadata));
  await assert.rejects(store.get(attachment.id));
});

test("limits each message and import batch to eight attachments", async (t) => {
  const { store } = await fixture(t);
  await assert.rejects(store.prepare(Array.from({ length: 9 }, () => ({ path: "a.txt", content: "text" }))));
  await assert.rejects(store.importFiles(Array(9).fill("a.txt")));
});

test("normalizes JPEG, WebP and GIF into images accepted by the model", async (t) => {
  const { dir, store } = await fixture(t);
  for (const extension of ["jpg", "webp", "gif"]) {
    const source = path.join(dir, `image.${extension}`);
    await execFile(require("ffmpeg-static"), ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=orange:s=32x24", "-frames:v", "1", "-threads", "1", source], { windowsHide: true, timeout: 15000 });
    const [attachment] = await store.importFiles([source]);
    assert.equal(attachment.kind, "image");
    const parts = await store.prepare([attachment]);
    assert.match(parts.find((part) => part.type === "image_url").image_url.url, /^data:image\/(jpeg|png);base64,/);
  }
});

test("cancels an active media decoder and removes its incomplete files", async (t) => {
  const controller = new AbortController();
  const childProcess = require("node:child_process");
  const spawn = childProcess.spawn;
  let decoder;
  // Synchronize with the real process: a tiny image can finish in under 40 ms
  // on a fast Mac, so cancelling after a fixed delay does not test cancellation.
  t.mock.method(childProcess, "spawn", (...args) => {
    decoder = spawn(...args);
    decoder.once("spawn", () => controller.abort());
    return decoder;
  });
  const filename = require.resolve("../electron/attachments.cjs");
  const cached = require.cache[filename];
  delete require.cache[filename];
  t.after(() => { if (cached) require.cache[filename] = cached; else delete require.cache[filename]; });
  const { store, directory } = await fixture(t);
  await assert.rejects(store.importBytes(bytes("image.png", PNG), { signal: controller.signal }), { name: "AbortError" });
  assert.ok(decoder?.killed, "the active decoder receives a kill signal");
  assert.deepEqual(await fs.readdir(directory), []);
});
