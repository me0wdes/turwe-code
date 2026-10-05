// Manual live provider integration check. Secrets are accepted only through the process environment.
const { app, safeStorage } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { createCredentials } = require("../electron/credentials.cjs");
const { createStore } = require("../electron/store.cjs");
const { createController } = require("../electron/controller.cjs");
const { getModels, safeError } = require("../electron/api.cjs");
app.setName("Turwe Code");
app
  .whenReady()
  .then(async () => {
    const endpoint = "https://ai.lab.pics/v1";
    const credentials = createCredentials(app.getPath("userData"), safeStorage);
    const provided = process.env.TURWE_BOOTSTRAP_KEY;
    delete process.env.TURWE_BOOTSTRAP_KEY;
    if (provided) credentials.set(endpoint, provided);
    const key = credentials.get(endpoint);
    if (!key) throw new Error("No configured key");
    const output = process.env.TURWE_PROBE_OUTPUT;
    if (!output) throw new Error("No output directory");
    fs.mkdirSync(output, { recursive: true });
    const report = {
      date: new Date().toISOString(),
      encryptedCredentialSaved: true,
      models: [],
      model: "Frontier",
      generation: "not-tested",
    };
    try {
      report.models = await getModels({ baseUrl: endpoint, key });
      const store = createStore(path.join(output, "data"));
      const s = store.createSession();
      s.model = report.model;
      const controller = createController({
        store,
        getConfig: () => ({ baseUrl: endpoint, key }),
        emit: () => {},
      });
      await controller.send(s.id, "Reply exactly OK.").done;
      const reply = s.messages.at(-1);
      report.generation = reply.status;
      report.response =
        reply.status === "complete"
          ? reply.content
          : safeError(reply.error, key);
    } catch (error) {
      report.generation = "error";
      report.error = safeError(error, key);
    }
    fs.writeFileSync(
      path.join(output, "api-check.json"),
      JSON.stringify(report, null, 2),
    );
    console.log(JSON.stringify(report));
    app.quit();
  })
  .catch((error) => {
    console.error(safeError(error, process.env.TURWE_BOOTSTRAP_KEY));
    app.exit(1);
  });
