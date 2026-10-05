const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createStore } = require("../electron/store.cjs");
const { getModels } = require("../electron/api.cjs");
const endpoint = "https://ai.lab.pics/v1";
function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "turwe-library-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return { directory, store: createStore(directory) };
}
test("fresh library contains only Opus and Sonnet", (t) => {
  const { store } = fixture(t);
  assert.deepEqual(
    store.models.list().map((m) => m.id),
    ["claude-opus-5-5", "claude-sonnet-5"],
  );
});
test("discovery never adds models; explicit add persists exact ID and name", async (t) => {
  const { directory, store } = fixture(t);
  const before = JSON.stringify(store.state);
  const found = await getModels({
    baseUrl: endpoint,
    key: "test",
    fetchImpl: async () =>
      new Response('{"data":[{"id":"vendor/new-model","name":"New model"}]}'),
  });
  assert.equal(JSON.stringify(store.state), before);
  store.models.add(endpoint, found[0]);
  assert.deepEqual(createStore(directory).models.list().at(-1), found[0]);
  assert.equal(store.state.settings.model, "claude-opus-5-5");
});
test("manual additions reject duplicates, malformed IDs and stale endpoints", (t) => {
  const { store } = fixture(t);
  store.models.add(endpoint, { id: " custom/model ", name: "My model" });
  assert.equal(store.models.list().at(-1).id, "custom/model");
  assert.throws(
    () => store.models.add(endpoint, { id: "custom/model" }),
    /уже/,
  );
  assert.throws(() => store.models.add(endpoint, { id: "bad\nmodel" }), /ID/);
  assert.throws(
    () => store.models.add("https://other.test/v1", { id: "other" }),
    /подключение/,
  );
});
test("default and saved list are isolated by provider and survive restart", (t) => {
  const { directory, store } = fixture(t);
  store.models.selectDefault(endpoint, "claude-sonnet-5");
  store.models.switchProvider("https://other.test/v1");
  assert.deepEqual(store.models.list(), []);
  assert.equal(store.state.settings.model, "");
  store.models.add("https://other.test/v1", { id: "other-model" });
  assert.equal(store.createSession().model, "other-model");
  store.models.switchProvider(endpoint);
  const loaded = createStore(directory);
  assert.equal(loaded.createSession().model, "claude-sonnet-5");
  assert.equal(loaded.models.list().length, 2);
});
test("removal updates future selections without changing historical identities", (t) => {
  const { directory, store } = fixture(t);
  const session = store.createSession();
  session.messages.push({ role: "assistant", content: "answer" });
  store.models.remove(endpoint, "claude-opus-5-5");
  assert.equal(session.model, "claude-sonnet-5");
  assert.equal(session.messages[0].model, "claude-opus-5-5");
  assert.equal(createStore(directory).models.list().length, 1);
  assert.equal(store.createSession().model, "claude-sonnet-5");
  assert.throws(() => store.models.remove(endpoint, "claude-sonnet-5"), /одну/);
});
test("migration preserves explicit custom selections but adds no automatic GLM preset", (t) => {
  const { directory, store } = fixture(t);
  const session = store.createSession();
  session.model = "custom-model";
  delete store.state.modelLibraries;
  store.save();
  const loaded = createStore(directory);
  assert.deepEqual(
    loaded.models.list().map((m) => m.id),
    ["claude-opus-5-5", "claude-sonnet-5", "custom-model"],
  );
  assert.equal(loaded.state.sessions[0].model, "custom-model");
});
test("all five server entries can be discovered and explicitly added without changing defaults", async (t) => {
  const { directory, store } = fixture(t);
  const found = await getModels({
    baseUrl: endpoint,
    key: "test",
    fetchImpl: async () =>
      new Response(
        '{"data":[{"id":"Base"},{"id":"Cheap"},{"id":"Frontier"},{"id":"Embedding"},{"id":"Memory-Extract"}]}',
      ),
  });
  assert.deepEqual(found.map((model) => model.id), [
    "Base", "Cheap", "Frontier", "Embedding", "Memory-Extract",
  ]);
  assert.equal(store.models.list().length, 2);
  for (const model of found) store.models.add(endpoint, model);
  assert.deepEqual(createStore(directory).models.list().slice(2), found);
  assert.equal(store.state.settings.model, "claude-opus-5-5");
});

test("an explicitly selected routing alias survives restart as default and chat model", (t) => {
  const { directory, store } = fixture(t);
  store.models.add(endpoint, { id: "Frontier" });
  store.models.selectDefault(endpoint, "Frontier");
  const session = store.createSession();
  assert.equal(session.model, "Frontier");
  const loaded = createStore(directory);
  assert.equal(loaded.state.settings.model, "Frontier");
  assert.equal(loaded.state.sessions[0].model, "Frontier");
  assert.equal(loaded.createSession().model, "Frontier");
});
