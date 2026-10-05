const fs = require("node:fs/promises");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { pathToFileURL } = require("node:url");
const {
  createMessageConnection,
  StreamMessageReader,
  StreamMessageWriter,
} = require("vscode-jsonrpc/node");
const { inside } = require("./workspace-files.cjs");
function diagnosticKey(uri, platform = process.platform) {
  const decoded = decodeURIComponent(uri);
  return platform === "win32" ? decoded.toLowerCase() : decoded;
}
function stopServer(server) {
  server.rpc.dispose();
  try {
    if (process.platform !== "win32" && server.child.pid)
      process.kill(-server.child.pid, "SIGTERM");
    else server.child.kill();
  } catch {}
}
function createLsp({ files, store }) {
  const servers = new Map();
  async function open(session, relative) {
    const root = files.root(session),
      target = await inside(root, relative),
      extension = path.extname(target).slice(1);
    const configured = (store.state.settings.lspServers || []).find((s) =>
      s.extensions.includes(extension),
    );
    const builtIn = ["ts", "tsx", "js", "jsx", "mjs", "cjs"].includes(
      extension,
    );
    if (!builtIn && !configured)
      throw new Error(
        `Для .${extension} настройте LSP-сервер в параметрах проекта`,
      );
    const key = root + "\0" + (configured?.id || "typescript");
    let server = servers.get(key);
    if (!server) {
      const bin = configured?.command || process.execPath;
      const entry = require
        .resolve("typescript-language-server/lib/cli.mjs")
        .replace("app.asar" + path.sep, "app.asar.unpacked" + path.sep);
      const child = spawn(bin, configured?.args || [entry, "--stdio"], {
        cwd: root,
        windowsHide: true,
        env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
        stdio: ["pipe", "pipe", "pipe"],
        detached: process.platform !== "win32",
      });
      const rpc = createMessageConnection(
        new StreamMessageReader(child.stdout),
        new StreamMessageWriter(child.stdin),
      );
      server = {
        rpc,
        child,
        documents: new Map(),
        diagnostics: new Map(),
        errors: "",
      };
      servers.set(key, server);
      child.stderr.on(
        "data",
        (d) => (server.errors = (server.errors + d).slice(-4000)),
      );
      child.on("error", (e) => {
        server.errors = e.message;
        rpc.dispose();
        if (servers.get(key) === server) servers.delete(key);
      });
      child.on("exit", () => {
        rpc.dispose();
        if (servers.get(key) === server) servers.delete(key);
      });
      rpc.onNotification("textDocument/publishDiagnostics", (p) =>
        server.diagnostics.set(diagnosticKey(p.uri), p.diagnostics),
      );
      rpc.onRequest("workspace/configuration", (p) => p.items.map(() => ({})));
      rpc.onRequest("client/registerCapability", () => null);
      rpc.listen();
      let initializeTimer;
      server.ready = Promise.race([
        rpc.sendRequest("initialize", {
          processId: process.pid,
          rootUri: pathToFileURL(root).href,
          capabilities: {
            textDocument: {
              publishDiagnostics: {},
              hover: { contentFormat: ["plaintext", "markdown"] },
            },
          },
          initializationOptions:
            builtIn && !configured
              ? {
                  tsserver: {
                    path: require
                      .resolve("typescript-lsp/lib/tsserver.js")
                      .replace(
                        "app.asar" + path.sep,
                        "app.asar.unpacked" + path.sep,
                      ),
                  },
                }
              : {},
        }),
        new Promise((_, reject) => {
          initializeTimer = setTimeout(
            () => reject(new Error("LSP не запустился за 20 секунд")),
            20000,
          );
          initializeTimer.unref();
        }),
      ])
        .then(() => rpc.sendNotification("initialized", {}))
        .catch((error) => {
          stopServer(server);
          if (servers.get(key) === server) servers.delete(key);
          throw error;
        })
        .finally(() => clearTimeout(initializeTimer));
    }
    await server.ready;
    const uri = pathToFileURL(target).href,
      text = await fs.readFile(target, "utf8"),
      prior = server.documents.get(uri);
    const version = (prior?.version || 0) + 1;
    if (!prior)
      await server.rpc.sendNotification("textDocument/didOpen", {
        textDocument: {
          uri,
          languageId: builtIn
            ? {
                tsx: "typescriptreact",
                jsx: "javascriptreact",
                ts: "typescript",
              }[extension] || "javascript"
            : configured.languageId || extension,
          version,
          text,
        },
      });
    else if (prior.text !== text)
      await server.rpc.sendNotification("textDocument/didChange", {
        textDocument: { uri, version },
        contentChanges: [{ text }],
      });
    server.documents.set(uri, { version, text });
    return { server, uri };
  }
  return {
    async request(session, args) {
      const { server, uri } = await open(session, args.path);
      const position = {
        line: Math.max(0, (Number(args.line) || 1) - 1),
        character: Math.max(0, (Number(args.character) || 1) - 1),
      };
      const operations = {
        definition: [
          "textDocument/definition",
          { textDocument: { uri }, position },
        ],
        references: [
          "textDocument/references",
          {
            textDocument: { uri },
            position,
            context: { includeDeclaration: true },
          },
        ],
        hover: ["textDocument/hover", { textDocument: { uri }, position }],
        symbols: ["textDocument/documentSymbol", { textDocument: { uri } }],
        workspaceSymbols: ["workspace/symbol", { query: args.query || "" }],
      };
      if (args.operation === "diagnostics") {
        await new Promise((r) => setTimeout(r, 1500));
        return {
          uri,
          diagnostics: server.diagnostics.get(diagnosticKey(uri)) || [],
        };
      }
      const request = operations[args.operation];
      if (!request) throw new Error("Неизвестная операция LSP");
      let timer;
      try {
        return await Promise.race([
          server.rpc.sendRequest(...request),
          new Promise(
            (_, reject) =>
              (timer = setTimeout(
                () => reject(new Error("LSP не ответил за 15 секунд")),
                15000,
              )),
          ),
        ]);
      } finally {
        clearTimeout(timer);
      }
    },
    close() {
      for (const s of servers.values()) {
        stopServer(s);
      }
      servers.clear();
    },
  };
}
module.exports = { createLsp, diagnosticKey };
