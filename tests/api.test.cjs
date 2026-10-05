const { test } = require("node:test");
const assert = require("node:assert/strict");
const { streamChat, normalizeBaseUrl } = require("../electron/api.cjs");
const config = {
  baseUrl: "https://example.test/v1",
  key: "test-private-key",
  model: "Base",
  messages: [{ role: "user", content: "Привет" }],
};
test("malformed UTF-8 fails instead of silently corrupting answer text", async () => {
  const prefix = Buffer.from('data: {"choices":[{"delta":{"content":"');
  const suffix = Buffer.from('"}}]}\n\ndata: [DONE]\n\n');
  await assert.rejects(
    streamChat({
      ...config,
      onDelta: () => {},
      fetchImpl: async () =>
        new Response(Buffer.concat([prefix, Buffer.from([255]), suffix]), {
          headers: { "Content-Type": "text/event-stream" },
        }),
    }),
  );
});
function response(
  text,
  type = "text/event-stream",
  status = 200,
  split = false,
) {
  const bytes = new TextEncoder().encode(text);
  return new Response(
    new ReadableStream({
      start(c) {
        if (split) for (const b of bytes) c.enqueue(Uint8Array.of(b));
        else c.enqueue(bytes);
        c.close();
      },
    }),
    { status, headers: { "Content-Type": type } },
  );
}
test("SSE parses split UTF-8, CRLF and DONE", async () => {
  let result = "";
  const text =
    "data: " +
    JSON.stringify({ choices: [{ delta: { content: "Привет 🌙" } }] }) +
    "\r\n\r\ndata: [DONE]\r\n\r\n";
  await streamChat({
    ...config,
    onDelta: (d) => (result += d),
    fetchImpl: async () => response(text, undefined, 200, true),
  });
  assert.equal(result, "Привет 🌙");
});
test("normal JSON response is accepted if provider ignores stream", async () => {
  let result = "";
  await streamChat({
    ...config,
    onDelta: (d) => (result += d),
    fetchImpl: async () =>
      response(
        JSON.stringify({ choices: [{ message: { content: "OK" } }] }),
        "application/json",
      ),
  });
  assert.equal(result, "OK");
});
test("provider errors redact key and preserve HTTP status", async () => {
  await assert.rejects(
    streamChat({
      ...config,
      onDelta: () => {},
      fetchImpl: async () =>
        response(
          JSON.stringify({
            error: { message: "upstream rejected request " + config.key },
          }),
          "application/json",
          400,
        ),
    }),
    (e) => e.message.includes("400") && !e.message.includes(config.key),
  );
});
test("premature EOF and empty completion are errors", async () => {
  await assert.rejects(
    streamChat({
      ...config,
      onDelta: () => {},
      fetchImpl: async () =>
        response('data: {"choices":[{"delta":{"content":"part"}}]}\n\n'),
    }),
    /прерван/i,
  );
  await assert.rejects(
    streamChat({
      ...config,
      onDelta: () => {},
      fetchImpl: async () => response("data: [DONE]\n\n"),
    }),
    /пуст/i,
  );
});
test("malformed SSE is reported", async () => {
  await assert.rejects(
    streamChat({
      ...config,
      onDelta: () => {},
      fetchImpl: async () => response("data: {broken}\n\n"),
    }),
    /формат/i,
  );
});
test("abort signal reaches transport and prevents completion", async () => {
  const ctrl = new AbortController();
  ctrl.abort();
  await assert.rejects(
    streamChat({
      ...config,
      signal: ctrl.signal,
      onDelta: () => {},
      fetchImpl: async (_u, o) => {
        o.signal.throwIfAborted();
      },
    }),
    (e) => e.name === "AbortError",
  );
});
test("base URL requires HTTPS and cannot carry credentials or query", () => {
  assert.equal(
    normalizeBaseUrl("https://ai.lab.pics/v1/"),
    "https://ai.lab.pics/v1",
  );
  for (const url of [
    "http://remote.test/v1",
    "https://key@remote.test/v1",
    "https://remote.test/v1?key=abc",
  ])
    assert.throws(() => normalizeBaseUrl(url));
});
