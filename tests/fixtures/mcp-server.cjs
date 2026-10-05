const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { z } = require('zod');
const { crc32 } = require('node:zlib');
const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=', 'base64');
function largePng(size) {
  const payload = Buffer.concat([Buffer.from('Comment\0'), Buffer.alloc(size, 65)]);
  const chunk = Buffer.alloc(payload.length + 12);
  chunk.writeUInt32BE(payload.length, 0);
  chunk.write('tEXt', 4);
  payload.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(chunk.subarray(4, -4)), chunk.length - 4);
  return Buffer.concat([pixel.subarray(0, -12), chunk, pixel.subarray(-12)]).toString('base64');
}
if (process.env.MCP_START_MARKER) require('node:fs').appendFileSync(process.env.MCP_START_MARKER, 'start\n');
const server = new McpServer({ name: 'turwe-test', version: '1.0.0' });
server.registerTool('echo', { inputSchema: { text: z.string() }, annotations: { readOnlyHint: true } }, async ({ text }) => ({ content: [{ type: 'text', text }] }));
server.registerTool('unannotated', {}, async () => ({ content: [{ type: 'text', text: 'done' }] }));
server.registerTool('secret_error', {}, async () => ({ isError: true, content: [{ type: 'text', text: `Problem: ${process.env.MCP_TEST_SECRET}` }] }));
server.registerTool('large', {}, async () => ({ content: [{ type: 'text', text: 'large-result-'.repeat(40_000) }] }));
server.registerTool('escaped_large', {}, async () => ({ content: [{ type: 'text', text: '\\"'.repeat(200_000) }] }));
server.registerTool('image_and_text', {}, async () => ({
  content: [{ type: 'image', mimeType: 'image/png', data: largePng(256 * 1024) }, { type: 'text', text: `${process.env.MCP_TEST_SECRET}: ${'image-description-'.repeat(30_000)}` }],
  structuredContent: { secret: process.env.MCP_TEST_SECRET, description: 'structured-description-'.repeat(20_000) },
}));
server.registerTool('images_over_bytes', {}, async () => ({ content: Array.from({ length: 4 }, () => ({ type: 'image', mimeType: 'image/png', data: largePng(1280 * 1024) })) }));
server.registerTool('images_over_count', {}, async () => ({ content: Array.from({ length: 5 }, () => ({ type: 'image', mimeType: 'image/png', data: pixel.toString('base64') })) }));
server.registerTool('unsupported_images', {}, async () => ({ content: [{ type: 'image', mimeType: 'image/svg+xml', data: Buffer.from('<svg/>').toString('base64') }] }));
server.registerTool('invalid_images', {}, async () => ({ content: [{ type: 'image', mimeType: 'image/png', data: '@not-base64@' }] }));
server.registerTool('delay', { inputSchema: {} }, async (_, extra) => {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, 15_000);
    extra.signal.addEventListener('abort', () => { clearTimeout(timer); reject(new Error('cancelled')); }, { once: true });
  });
  return { content: [{ type: 'text', text: 'finished' }] };
});
server.connect(new StdioServerTransport()).catch(() => process.exit(1));
