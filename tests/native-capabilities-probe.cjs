// Electron backend integration probe. Uses an isolated output directory, never the real workspace.
const { app, nativeImage, safeStorage } = require("electron");
const fs = require("node:fs"),
  path = require("node:path"),
  zlib = require("node:zlib");
const { execFileSync } = require("node:child_process");
const { createAttachmentStore } = require("../electron/attachments.cjs");
const { createStore } = require("../electron/store.cjs");
const { createMcpManager } = require("../electron/mcp.cjs");
function fixturePng() {
  const chunk = (type, data) => {
    const bytes = Buffer.concat([Buffer.from(type), data]),
      size = Buffer.alloc(4),
      crc = Buffer.alloc(4);
    size.writeUInt32BE(data.length);
    crc.writeUInt32BE(zlib.crc32(bytes));
    return Buffer.concat([size, bytes, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(96, 0);
  header.writeUInt32BE(96, 4);
  header[8] = 8;
  header[9] = 2;
  const pixels = Buffer.alloc(96 * 289);
  for (let y = 0; y < 96; y++)
    for (let x = 0; x < 96; x++) {
      pixels[y * 289 + 1 + x * 3] = 46;
      pixels[y * 289 + 2 + x * 3] = 150;
      pixels[y * 289 + 3 + x * 3] = 230;
    }
  return Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    chunk("IHDR", header),
    chunk("IDAT", zlib.deflateSync(pixels)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
app
  .whenReady()
  .then(async () => {
    const root = process.env.TURWE_NATIVE_PROBE_OUTPUT;
    if (!root) throw new Error("Output required");
    fs.mkdirSync(root, { recursive: true });
    const report = {
      checkedAt: new Date().toISOString(),
      electron: process.versions.electron,
    };
    try {
      const fixture = path.join(root, "fixtures");
      fs.mkdirSync(fixture, { recursive: true });
      fs.writeFileSync(path.join(fixture, "blue.png"), fixturePng());
      for (const ext of ["pdf", "docx"])
        fs.writeFileSync(
          path.join(fixture, `sample.${ext}`),
          Buffer.from(
            fs.readFileSync(
              path.join(__dirname, `fixtures/attachments/sample.${ext}.base64`),
              "utf8",
            ),
            "base64",
          ),
        );
      execFileSync(
        require("ffmpeg-static"),
        [
          "-hide_banner",
          "-loglevel",
          "error",
          "-y",
          "-f",
          "lavfi",
          "-i",
          "color=c=blue:s=160x90:d=1",
          "-c:v",
          "mpeg4",
          path.join(fixture, "blue.mp4"),
        ],
        { windowsHide: true, timeout: 15000 },
      );
      const assets = createAttachmentStore({
        directory: path.join(root, "qa-data", "attachments"),
        nativeImage,
      });
      const files = await assets.importFiles(
        ["blue.png", "sample.pdf", "sample.docx", "blue.mp4"].map((n) =>
          path.join(fixture, n),
        ),
      );
      const parts = await assets.prepare(files);
      report.attachments = files.map((f) => ({
        name: f.name,
        kind: f.kind,
        note: f.note,
      }));
      report.imageParts = parts.filter((p) => p.type === "image_url").length;
      report.textParts = parts
        .filter((p) => p.type === "text")
        .map((p) => p.text.slice(0, 220));
      report.preview = (await assets.preview(files[0].id)).startsWith(
        "data:image/",
      );
      const store = createStore(path.join(root, "qa-data"));
      store.state.settings.model = "claude-opus-5-5";
      store.state.settings.sounds = false;
      const session = store.createSession();
      session.title = "Вложения к сессии";
      session.messages = [
        {
          id: "qa-user",
          role: "user",
          content: "Посмотри документы, изображение и кадры видео.",
          attachments: files,
          createdAt: new Date().toISOString(),
        },
        {
          id: "qa-assistant",
          role: "assistant",
          content:
            "Вложения сохранены в этой сессии. Фото передаётся модели как изображение, документы — как текст, видео — как кадры с отметками времени.",
          model: "Проверка интерфейса · без запроса API",
          status: "complete",
          createdAt: new Date().toISOString(),
        },
      ];
      store.save();
      report.passed = true;
      const mcp = createMcpManager({
        directory: path.join(root, "qa-data", "connectors"),
        safeStorage,
        openExternal: async () => {
          throw new Error("No interactive authorization in probe");
        },
        onChange: () => {},
      });
      try {
        const c = await mcp.save({
          name: "Figma Desktop",
          type: "http",
          url: "http://127.0.0.1:3845/mcp",
          auth: "none",
        });
        const connected = await mcp.connect(c.id, {
          signal: AbortSignal.timeout(8000),
        });
        report.figma = {
          status: connected.status,
          toolCount: connected.toolCount,
          error: connected.error,
        };
      } finally {
        await mcp.close();
      }
    } catch (e) {
      report.passed = false;
      report.error = String(e.message).slice(0, 500);
    }
    fs.writeFileSync(
      path.join(root, "native-probe.json"),
      JSON.stringify(report, null, 2),
    );
    app.quit();
  })
  .catch(() => app.exit(1));
