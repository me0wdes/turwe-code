// One explicit model request using the saved Windows credential. Does not alter the workspace.
const { app, safeStorage } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { createCredentials } = require("../electron/credentials.cjs");
const { streamChat, safeError } = require("../electron/api.cjs");
app.setName("Turwe Code");
app
  .whenReady()
  .then(async () => {
    const dir = path.join(app.getPath("appData"), "Turwe Code");
    const { settings } = JSON.parse(
      fs.readFileSync(path.join(dir, "workspace.json"), "utf8"),
    );
    const key = createCredentials(dir, safeStorage).get(settings.baseUrl);
    const model = process.env.TURWE_PROBE_MODEL;
    const output = process.env.TURWE_PROBE_OUTPUT;
    if (!model || !output)
      throw new Error("Set TURWE_PROBE_MODEL and TURWE_PROBE_OUTPUT");
    const report = {
      checkedAt: new Date().toISOString(),
      endpoint: settings.baseUrl,
      requestedModel: model,
      generation: "error",
      response: "",
    };
    try {
      await streamChat({
        baseUrl: settings.baseUrl,
        key,
        model,
        messages: [{ role: "user", content: "Reply exactly OK." }],
        signal: AbortSignal.timeout(45000),
        onDelta: (text) => {
          report.response += text;
        },
        fetchImpl: async (...args) => {
          const response = await fetch(...args);
          report.httpStatus = response.status;
          return response;
        },
      });
      report.generation = "complete";
    } catch (error) {
      report.error = safeError(error, key);
    }
    report.response = safeError(report.response, key);
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, JSON.stringify(report, null, 2));
    app.quit();
  })
  .catch(() => app.exit(1));
