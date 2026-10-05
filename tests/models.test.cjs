const { test } = require("node:test");
const assert = require("node:assert/strict");
const { getModels } = require("../electron/api.cjs");
test("catalogue preserves exact provider IDs, names and removes invalid duplicates", async () => {
  const models = await getModels({
    baseUrl: "https://example.test/v1",
    key: "test",
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          data: [
            { id: "claude-test-2026", display_name: "Claude test" },
            { id: "gpt-test", name: "GPT test" },
            { id: "opaque" },
            { id: "opaque" },
            { id: "" },
            { id: 2 },
            { id: "embedding-3" },
          ],
        }),
      ),
  });
  assert.deepEqual(models, [
    { id: "claude-test-2026", name: "Claude test" },
    { id: "gpt-test", name: "GPT test" },
    { id: "opaque", name: "opaque" },
    { id: "embedding-3", name: "embedding-3" },
  ]);
});
test("empty usable catalogue stays empty and does not invent fallback models", async () => {
  assert.deepEqual(
    await getModels({
      baseUrl: "https://example.test",
      key: "test",
      fetchImpl: async () => new Response('{"data":[]}'),
    }),
    [],
  );
});

test("ai.lab.pics discovery preserves routing and service IDs exactly as listed", async () => {
  const read = () =>
    getModels({
      baseUrl: "https://ai.lab.pics/v1/",
      key: "test",
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            data: [
              { id: "Base" },
              { id: "FRONTIER" },
              { id: "Cheap" },
              { id: "Embedding" },
              { id: "Memory-Extract" },
              { id: " cheap " },
              { id: "claude-sonnet-5", name: "provider raw label" },
              { id: "custom-model", display_name: "Custom" },
            ],
          }),
        ),
    });
  const expected = [
    { id: "Base", name: "Base" },
    { id: "FRONTIER", name: "FRONTIER" },
    { id: "Cheap", name: "Cheap" },
    { id: "Embedding", name: "Embedding" },
    { id: "Memory-Extract", name: "Memory-Extract" },
    { id: "claude-sonnet-5", name: "provider raw label" },
    { id: "custom-model", name: "Custom" },
  ];
  assert.deepEqual(await read(), expected);
  assert.deepEqual(await read(), expected);
});

test("other providers keep their own model IDs without lab presets or exclusions", async () => {
  const models = await getModels({
    baseUrl: "https://example.test/v1",
    key: "test",
    fetchImpl: async () =>
      new Response('{"data":[{"id":"Base"},{"id":"Frontier"},{"id":"Cheap"}]}'),
  });
  assert.deepEqual(
    models.map((model) => model.id),
    ["Base", "Frontier", "Cheap"],
  );
});

test("known direct IDs do not turn a rejected catalogue request into success", async () => {
  await assert.rejects(
    getModels({
      baseUrl: "https://ai.lab.pics/v1",
      key: "test",
      fetchImpl: async () => new Response("{}", { status: 401 }),
    }),
    /HTTP 401/,
  );
});
