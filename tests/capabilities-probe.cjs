// Read-only credential access; sends only a generated red square and a harmless echo tool.
const { app, safeStorage } = require("electron");
const fs = require("node:fs"),
  path = require("node:path"),
  zlib = require("node:zlib");
const { createCredentials } = require("../electron/credentials.cjs");
const { streamChat, safeError } = require("../electron/api.cjs");
function png() {
  const chunk = (type, data) => {
    const bytes = Buffer.concat([Buffer.from(type), data]),
      size = Buffer.alloc(4),
      crc = Buffer.alloc(4);
    size.writeUInt32BE(data.length);
    crc.writeUInt32BE(zlib.crc32(bytes));
    return Buffer.concat([size, bytes, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(64, 0);
  header.writeUInt32BE(64, 4);
  header[8] = 8;
  header[9] = 2;
  const pixels = Buffer.alloc(64 * (64 * 3 + 1));
  for (let y = 0; y < 64; y++)
    for (let x = 0; x < 64; x++) pixels[y * 193 + 1 + x * 3] = 255;
  return Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    chunk("IHDR", header),
    chunk("IDAT", zlib.deflateSync(pixels)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
app.setName("Turwe Code");
app
  .whenReady()
  .then(async () => {
    const dir = path.join(app.getPath("appData"), "Turwe Code"),
      { settings } = JSON.parse(
        fs.readFileSync(path.join(dir, "workspace.json"), "utf8"),
      );
    const key = createCredentials(dir, safeStorage).get(settings.baseUrl),
      output = process.env.TURWE_PROBE_OUTPUT;
    if (!output) throw new Error("Set output");
    const report = {
      checkedAt: new Date().toISOString(),
      model: "claude-opus-5-5",
      endpoint: settings.baseUrl,
    };
    const request = async (messages, tools = []) => {
      let text = "",
        status;
      const result = await streamChat({
        baseUrl: settings.baseUrl,
        key,
        model: report.model,
        messages,
        tools,
        signal: AbortSignal.timeout(60000),
        onDelta: (d) => (text += d),
        fetchImpl: async (...args) => {
          const response = await fetch(...args);
          status = response.status;
          return response;
        },
      });
      return { text, status, ...result };
    };
    try {
      report.vision = await request([
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "What single solid color is this image? Answer only the English color name.",
            },
            {
              type: "image_url",
              image_url: {
                url: "data:image/png;base64," + png().toString("base64"),
              },
            },
          ],
        },
      ]);
    } catch (e) {
      report.vision = { error: safeError(e, key) };
    }
    try {
      const messages = [
        {
          role: "user",
          content:
            "Call echo_probe with value TURWE_TOOL_OK. After receiving its result reply exactly TOOL_OK.",
        },
      ];
      const tools = [
        {
          type: "function",
          function: {
            name: "echo_probe",
            description: "Harmless echo verification tool",
            parameters: {
              type: "object",
              properties: { value: { type: "string" } },
              required: ["value"],
              additionalProperties: false,
            },
          },
        },
      ];
      const first = await request(messages, tools);
      report.toolCall = first;
      if (first.toolCalls?.length) {
        messages.push({
          role: "assistant",
          content: first.text || null,
          tool_calls: first.toolCalls,
        });
        for (const call of first.toolCalls)
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            content: JSON.stringify({
              echo: JSON.parse(call.function.arguments).value,
            }),
          });
        report.toolRoundTrip = await request(messages, tools);
      }
    } catch (e) {
      report.toolsError = safeError(e, key);
    }
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, JSON.stringify(report, null, 2));
    app.quit();
  })
  .catch(() => app.exit(1));
