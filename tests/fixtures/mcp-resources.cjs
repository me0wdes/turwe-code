const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const {
  StdioServerTransport,
} = require("@modelcontextprotocol/sdk/server/stdio.js");
const { z } = require("zod");
const server = new McpServer({ name: "resources-fixture", version: "1" });
const schema = {
  type: "object",
  properties: {
    choice: {
      type: "array",
      items: { type: "string", enum: ["a", "b"] },
      minItems: 1,
    },
  },
  required: ["choice"],
};
const ask = (message) =>
  server.server.elicitInput({ mode: "form", message, requestedSchema: schema });
server.registerResource("fixture", "fixture://resource", {}, async (uri) => ({
  contents: [{ uri: uri.href, text: JSON.stringify(await ask("resource")) }],
}));
server.registerPrompt(
  "fixture",
  { argsSchema: { name: z.string() } },
  async ({ name }) => ({
    messages: [
      { role: "user", content: { type: "text", text: "Prompt for " + name } },
    ],
  }),
);
if (process.argv.includes("--tools"))
  server.registerTool("ask", {}, async () => ({
    content: [{ type: "text", text: JSON.stringify(await ask("tool")) }],
  }));
server.connect(new StdioServerTransport());
