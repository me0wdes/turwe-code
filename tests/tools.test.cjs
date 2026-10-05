const { test } = require("node:test"),
  assert = require("node:assert/strict");
const { createTools } = require("../electron/tools.cjs");
test("failed image decoding preserves successful MCP mutation result instead of asking to repeat it", async () => {
  const { executeTool } = createTools({
    store: { state: { skills: [], projects: [] } },
    github: {},
    mcp: {
      callTool: async () => ({
        content: [
          { type: "text", text: "Created document id=123" },
          { type: "image", mimeType: "image/png", data: "bad" },
        ],
        structuredContent: { id: 123 },
      }),
    },
    attachments: {
      importBytes: async () => {
        throw new Error("Invalid image");
      },
    },
    emit: () => {},
  });
  const result = await executeTool(
    "create_document",
    {},
    { session: {}, signal: new AbortController().signal },
  );
  assert.match(result.text, /Created document id=123/);
  assert.match(result.text, /Не повторяй/);
  assert.deepEqual(result.attachments, []);
});
