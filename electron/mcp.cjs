const fs = require("node:fs");
const path = require("node:path");
const { randomUUID, createHash } = require("node:crypto");
const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const {
  StdioClientTransport,
} = require("@modelcontextprotocol/sdk/client/stdio.js");
const {
  StreamableHTTPClientTransport,
} = require("@modelcontextprotocol/sdk/client/streamableHttp.js");
const {
  UnauthorizedError,
} = require("@modelcontextprotocol/sdk/client/auth.js");
const {
  ToolListChangedNotificationSchema,
  ElicitRequestSchema,
} = require("@modelcontextprotocol/sdk/types.js");
const { createOAuthProvider, McpSafeError } = require("./mcp-oauth.cjs");
const { connectionFailure } = require("./mcp-errors.cjs");
const {
  createBoundedFetch,
  validateHttpUrl,
  MAX_PROTOCOL_BYTES,
} = require("./mcp-http.cjs");

const MAX_TOOLS = 128;
const MAX_SCHEMA_BYTES = 64 * 1024;
const MAX_RESULT_BYTES = 256 * 1024;
const MAX_IMAGE_BASE64_BYTES = 6 * 1024 * 1024;
const MAX_RESULT_IMAGES = 4;
const IMAGE_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);
const CALL_TIMEOUT = 60_000;
const CONNECT_TIMEOUT = 180_000;
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const clone = (value) => JSON.parse(JSON.stringify(value));
const hash = (value, length = 10) =>
  createHash("sha256").update(value).digest("hex").slice(0, length);

function atomicWrite(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, JSON.stringify(data, null, 2), { mode: 0o600 });
    fs.renameSync(temporary, file);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

function readJson(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  if (fs.statSync(file).size > 2 * 1024 * 1024)
    throw new McpSafeError("MCP configuration file is too large.");
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    throw new McpSafeError(
      "MCP configuration could not be read. Your saved files were preserved.",
    );
  }
}

function textField(value, label, max, optional = false) {
  if (optional && (value === undefined || value === null || value === ""))
    return undefined;
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > max ||
    /[\0\r\n]/.test(value)
  )
    throw new McpSafeError(`Enter a valid ${label}.`);
  return value.trim();
}

function normalizeConfig(input, old) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new McpSafeError("Invalid MCP connector configuration.");
  const id = old?.id || input.id || randomUUID();
  if (typeof id !== "string" || !/^[a-zA-Z0-9_-]{1,80}$/.test(id))
    throw new McpSafeError("Invalid connector ID.");
  const type = input.type || old?.type || "http";
  if (!["http", "stdio"].includes(type))
    throw new McpSafeError("Choose HTTP or stdio transport.");
  const config = {
    id,
    name: textField(input.name ?? old?.name, "connector name", 100),
    type,
    enabled: input.enabled ?? old?.enabled ?? true,
  };
  if (typeof config.enabled !== "boolean")
    throw new McpSafeError("Invalid connector enabled setting.");
  if (type === "http") {
    config.url = validateHttpUrl(input.url ?? old?.url, { query: false }).href;
    config.auth =
      input.auth ?? (old?.type === "http" ? old.auth : undefined) ?? "none";
    if (!["none", "oauth", "bearer"].includes(config.auth))
      throw new McpSafeError(
        "Choose no authentication, OAuth, or bearer token.",
      );
  } else {
    config.auth = "none";
    config.command = textField(
      input.command ?? old?.command,
      "MCP command",
      4096,
    );
    config.args = input.args ?? old?.args ?? [];
    if (
      !Array.isArray(config.args) ||
      config.args.length > 100 ||
      config.args.some(
        (arg) => typeof arg !== "string" || arg.length > 8192 || /\0/.test(arg),
      )
    )
      throw new McpSafeError("MCP arguments must be a list of text values.");
    config.args = [...config.args];
    const cwd = textField(
      input.cwd ?? old?.cwd,
      "working directory",
      4096,
      true,
    );
    if (cwd) {
      if (!path.isAbsolute(cwd))
        throw new McpSafeError(
          "MCP working directory must be an absolute path.",
        );
      config.cwd = cwd;
    }
  }
  return config;
}

function createMcpManager({
  directory,
  safeStorage,
  openExternal,
  onChange = () => {},
  onElicitation,
  fetch: fetchImpl,
} = {}) {
  if (!directory) throw new McpSafeError("MCP storage directory is required.");
  const configFile = path.join(directory, "mcp-connectors.json");
  const secretFile = path.join(directory, "mcp-secrets.json");
  const stored = readJson(configFile, { version: 1, connectors: [] });
  if (
    stored.version !== 1 ||
    !Array.isArray(stored.connectors) ||
    stored.connectors.length > 32
  )
    throw new McpSafeError("Unsupported MCP configuration.");
  const configs = new Map(
    stored.connectors.map((config) => {
      const value = normalizeConfig(config);
      return [value.id, value];
    }),
  );
  let vault = readJson(secretFile, { version: 1, entries: {} });
  if (
    vault.version !== 1 ||
    !vault.entries ||
    typeof vault.entries !== "object" ||
    Array.isArray(vault.entries)
  )
    throw new McpSafeError("Unsupported MCP credential storage.");
  const runtimes = new Map();
  const secrets = new Map();
  const mutations = new Set();
  let closed = false;

  function ensureOpen() {
    if (closed) throw new McpSafeError("MCP manager is closed.");
  }
  function getConfig(id) {
    const config = configs.get(id);
    if (!config) throw new McpSafeError("MCP connector was not found.");
    return config;
  }
  function getSecret(id) {
    if (secrets.has(id)) return secrets.get(id);
    const encrypted = vault.entries[id];
    if (!encrypted) return {};
    try {
      if (!safeStorage?.isEncryptionAvailable()) throw new Error();
      const value = JSON.parse(
        safeStorage.decryptString(Buffer.from(encrypted, "base64")),
      );
      if (!value || typeof value !== "object" || Array.isArray(value))
        throw new Error();
      secrets.set(id, value);
      return value;
    } catch {
      throw new McpSafeError(
        "Saved MCP credentials cannot be decrypted by this operating system account. Enter them again.",
      );
    }
  }
  function putSecret(id, value) {
    let encrypted;
    if (Object.keys(value).length) {
      if (!safeStorage?.isEncryptionAvailable())
        throw new McpSafeError(
          "Operating system encryption is unavailable. MCP credentials cannot be saved.",
        );
      try {
        encrypted = safeStorage
          .encryptString(JSON.stringify(value))
          .toString("base64");
      } catch {
        throw new McpSafeError("MCP credentials could not be encrypted.");
      }
    }
    const entries = { ...vault.entries };
    if (encrypted) entries[id] = encrypted;
    else delete entries[id];
    const next = { version: 1, entries };
    atomicWrite(secretFile, next);
    vault = next;
    secrets.set(id, value);
  }
  function redacted(value) {
    const sensitive = new Set();
    for (const privateValue of secrets.values()) {
      if (privateValue.bearerToken) sensitive.add(privateValue.bearerToken);
      for (const env of Object.values(privateValue.env || {}))
        if (env) sensitive.add(env);
      for (const key of ["access_token", "refresh_token", "id_token"])
        if (privateValue.oauth?.tokens?.[key])
          sensitive.add(privateValue.oauth.tokens[key]);
      if (privateValue.oauth?.clientInformation?.client_secret)
        sensitive.add(privateValue.oauth.clientInformation.client_secret);
    }
    const values = [...sensitive].sort((a, b) => b.length - a.length);
    const replace = (item) => {
      if (typeof item === "string") {
        for (const secret of values)
          item = item.split(secret).join("[redacted]");
        return item;
      }
      if (Array.isArray(item)) return item.map(replace);
      if (item && typeof item === "object")
        return Object.fromEntries(
          Object.entries(item).map(([key, val]) => [key, replace(val)]),
        );
      return item;
    };
    return replace(value);
  }
  function publicConfig(config) {
    const runtime = runtimes.get(config.id);
    let privateValue = {};
    let storageError;
    try {
      privateValue = getSecret(config.id);
    } catch (error) {
      storageError = error.message;
    }
    return {
      ...clone(config),
      envKeys: Object.keys(privateValue.env || {}),
      hasSecret: Boolean(
        privateValue.bearerToken ||
        privateValue.oauth?.tokens?.access_token ||
        Object.keys(privateValue.env || {}).length,
      ),
      status: runtime?.status || (storageError ? "error" : "disconnected"),
      toolCount:
        runtime?.status === "connected" ? runtime.definitions.length : 0,
      error: runtime?.error || storageError || "",
      ...(runtime?.diagnostic ? { diagnostic: runtime.diagnostic } : {}),
    };
  }
  function list() {
    return [...configs.values()].map(publicConfig);
  }
  const observers = new Set();
  function changed() {
    try {
      onChange(list());
    } catch {
      /* A renderer observer cannot break connection cleanup. */
    }
    for (const observer of observers) {
      try { observer(list()); } catch { /* Observers must not interrupt OAuth cleanup. */ }
    }
  }
  function persist() {
    atomicWrite(configFile, { version: 1, connectors: [...configs.values()] });
  }
  function errorMessage(error, config) {
    return connectionFailure(error, config).message;
  }
  async function dispose(runtime) {
    runtime.controller.abort();
    await runtime.oauth?.close().catch(() => {});
    await runtime.client?.close().catch(() => {});
    await runtime.transport?.close().catch(() => {});
    runtime.definitions = [];
  }
  async function disconnect(id) {
    const config = getConfig(id);
    const runtime = runtimes.get(id);
    runtimes.delete(id);
    if (runtime) await dispose(runtime);
    changed();
    return publicConfig(config);
  }
  async function save(input) {
    ensureOpen();
    const old = input?.id ? configs.get(input.id) : undefined;
    if (!old && configs.size >= 32)
      throw new McpSafeError("At most 32 MCP connectors can be saved.");
    const config = normalizeConfig(input, old);
    const endpointChanged =
      old &&
      (old.type !== config.type ||
        old.url !== config.url ||
        old.auth !== config.auth ||
        old.command !== config.command ||
        old.cwd !== config.cwd ||
        JSON.stringify(old.args) !== JSON.stringify(config.args));
    let value = {};
    if (old && !endpointChanged && input.clearSecret !== true) {
      try {
        value = { ...getSecret(config.id) };
      } catch (error) {
        if (!(
          (config.auth === "bearer" && own(input, "bearerToken")) ||
          (config.type === "stdio" && own(input, "env"))
        ))
          throw error;
      }
    }
    if (own(input, "bearerToken")) {
      if (
        typeof input.bearerToken !== "string" ||
        input.bearerToken.length > 16_384 ||
        /[\0\r\n]/.test(input.bearerToken)
      )
        throw new McpSafeError("Enter a valid bearer token.");
      if (input.bearerToken.trim())
        value.bearerToken = input.bearerToken.trim();
      else delete value.bearerToken;
    }
    if (own(input, "env")) {
      if (
        !input.env ||
        typeof input.env !== "object" ||
        Array.isArray(input.env) ||
        Object.keys(input.env).length > 100
      )
        throw new McpSafeError(
          "Environment variables must be an object of text values.",
        );
      const env = {};
      for (const [key, val] of Object.entries(input.env)) {
        if (
          !/^[A-Za-z_][A-Za-z0-9_]{0,99}$/.test(key) ||
          typeof val !== "string" ||
          val.length > 16_384 ||
          /\0/.test(val)
        )
          throw new McpSafeError(
            "Enter valid MCP environment variable names and text values.",
          );
        env[key] = val;
      }
      if (Object.keys(env).length) value.env = env;
      else delete value.env;
    }
    if (config.type !== "stdio") delete value.env;
    if (config.auth !== "bearer") delete value.bearerToken;
    if (config.auth !== "oauth") delete value.oauth;
    // Validate encryption before invalidating a working connection or saving config.
    if (Object.keys(value).length && !safeStorage?.isEncryptionAvailable())
      throw new McpSafeError(
        "Operating system encryption is unavailable. MCP credentials cannot be saved.",
      );
    if (mutations.has(config.id))
      throw new McpSafeError("This MCP connector is being changed. Try again.");
    mutations.add(config.id);
    try {
      if (old) await disconnect(old.id);
      putSecret(config.id, value);
      configs.set(config.id, config);
      persist();
      changed();
      return publicConfig(config);
    } finally {
      mutations.delete(config.id);
    }
  }
  async function remove(id) {
    ensureOpen();
    if (mutations.has(id))
      throw new McpSafeError("This MCP connector is being changed. Try again.");
    mutations.add(id);
    try {
      await disconnect(id);
      putSecret(id, {});
      configs.delete(id);
      secrets.delete(id);
      persist();
      changed();
    } finally {
      mutations.delete(id);
    }
  }

  async function discover(config, runtime) {
    if (!runtime.client.getServerCapabilities()?.tools) {
      runtime.definitions = [];
      return;
    }
    const definitions = [];
    const names = new Set();
    const cursors = new Set();
    let cursor;
    let schemaBytes = 0;
    do {
      const result = await runtime.client.listTools(cursor ? { cursor } : {}, {
        signal: runtime.controller.signal,
        timeout: 30_000,
        maxTotalTimeout: 30_000,
      });
      for (const tool of result.tools) {
        if (definitions.length >= MAX_TOOLS)
          throw new McpSafeError(
            "MCP server exceeds the 128 tool limit.",
            "MCP_LIMIT",
          );
        if (names.has(tool.name)) continue;
        if (
          !tool.name ||
          tool.name.length > 256 ||
          tool.inputSchema?.type !== "object"
        )
          continue;
        if (
          Buffer.byteLength(JSON.stringify(tool.inputSchema)) > MAX_SCHEMA_BYTES
        )
          continue;
        schemaBytes += Buffer.byteLength(JSON.stringify(tool));
        if (schemaBytes > 1024 * 1024)
          throw new McpSafeError("MCP tool catalog is too large.", "MCP_LIMIT");
        names.add(tool.name);
        const suffix = tool.name.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 32);
        definitions.push({
          type: "function",
          function: {
            name: `mcp_${hash(config.id)}_${suffix}_${hash(tool.name, 8)}`,
            description:
              `${config.name}: ${tool.description || tool.name}`.slice(0, 4096),
            parameters: tool.inputSchema,
          },
          mcp: {
            connectorId: config.id,
            permissionIdentity: hash(JSON.stringify(config), 64),
            connectorName: config.name,
            toolName: tool.name,
            readOnly:
              tool.annotations?.readOnlyHint === true &&
              tool.annotations?.destructiveHint !== true,
          },
        });
      }
      cursor = result.nextCursor;
      if (cursor && cursors.has(cursor))
        throw new McpSafeError(
          "MCP server returned a repeated tool catalog page.",
        );
      if (cursor) cursors.add(cursor);
      if (cursors.size > 20)
        throw new McpSafeError(
          "MCP tool catalog has too many pages.",
          "MCP_LIMIT",
        );
    } while (cursor);
    if (
      runtimes.get(config.id) === runtime &&
      !runtime.controller.signal.aborted
    )
      runtime.definitions = definitions;
  }

  async function connect(id, { signal } = {}) {
    ensureOpen();
    signal?.throwIfAborted();
    const config = getConfig(id);
    if (mutations.has(id))
      throw new McpSafeError(
        "This MCP connector is being changed. Use Connect after saving.",
      );
    if (runtimes.get(id)?.status === "connected") return publicConfig(config);
    if (runtimes.get(id)?.pending) {
      const pending = runtimes.get(id).pending;
      if (!signal) return pending;
      // A second chat can stop waiting without cancelling the first chat's sign-in.
      return new Promise((resolve, reject) => {
        const cancel = () => reject(signal.reason);
        signal.addEventListener('abort', cancel, { once: true });
        pending.then(
          value => { signal.removeEventListener('abort', cancel); resolve(value); },
          error => { signal.removeEventListener('abort', cancel); reject(error); },
        );
        if (signal.aborted) cancel();
      });
    }
    const previous = runtimes.get(id);
    const runtime = {
      status: "connecting",
      definitions: [],
      error: "",
      controller: new AbortController(),
    };
    previous?.controller.abort();
    runtimes.set(id, runtime);
    changed();
    const onAbort = () => runtime.controller.abort();
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) onAbort();
    const timeout = setTimeout(onAbort, CONNECT_TIMEOUT);
    timeout.unref();
    runtime.pending = (async () => {
      try {
        if (previous) await dispose(previous);
        if (!config.enabled)
          throw new McpSafeError(
            "Enable this MCP connector before connecting.",
          );
        if (runtime.controller.signal.aborted || runtimes.get(id) !== runtime)
          throw new McpSafeError("MCP connection cancelled.", "MCP_CANCELLED");
        const value = getSecret(id);
        if (
          config.type === "http" &&
          config.auth === "bearer" &&
          !value.bearerToken
        )
          throw new McpSafeError("Enter a bearer token before connecting.");
        if (config.auth === "oauth")
          runtime.oauth = await createOAuthProvider({
            read: () => getSecret(id).oauth || {},
            write: (oauth) => {
              if (
                runtime.controller.signal.aborted ||
                runtimes.get(id) !== runtime ||
                configs.get(id) !== config
              )
                throw new McpSafeError(
                  "MCP connection cancelled.",
                  "MCP_CANCELLED",
                );
              putSecret(id, { ...getSecret(id), oauth });
            },
            openExternal,
            signal: runtime.controller.signal,
            onAuthorize: () => {
              runtime.status = "authorizing";
              changed();
            },
          });
        const newTransport = () =>
          config.type === "stdio"
            ? new StdioClientTransport({
                command: config.command,
                args: config.args,
                cwd: config.cwd,
                env: value.env || {},
                stderr: "ignore",
                maxBufferSize: MAX_PROTOCOL_BYTES,
              })
            : new StreamableHTTPClientTransport(new URL(config.url), {
                authProvider: runtime.oauth,
                fetch: createBoundedFetch({
                  signal: runtime.controller.signal,
                  oauthMetadata: () => runtime.oauth?.discoveryState()?.authorizationServerMetadata,
                  ...(fetchImpl ? { fetch: fetchImpl } : {}),
                }),
                requestInit: value.bearerToken
                  ? {
                      headers: { Authorization: `Bearer ${value.bearerToken}` },
                    }
                  : undefined,
                reconnectionOptions: {
                  maxRetries: 0,
                  initialReconnectionDelay: 1000,
                  maxReconnectionDelay: 1000,
                  reconnectionDelayGrowFactor: 1,
                },
              });
        const start = async () => {
          runtime.client = new Client(
            { name: "Turwe Code", version: "0.6.0" },
            { capabilities: { elicitation: { form: {} } } },
          );
          runtime.client.setRequestHandler(
            ElicitRequestSchema,
            async (request) => {
              if (
                !onElicitation ||
                request.params.mode === "url" ||
                !runtime.activeContext
              )
                return { action: "decline" };
              return onElicitation(
                {
                  ...request.params,
                  connectorId: id,
                  connectorName: config.name,
                },
                runtime.activeContext,
              );
            },
          );
          runtime.transport = newTransport();
          runtime.client.onerror = () => {};
          runtime.client.onclose = () => {
            if (runtimes.get(id) !== runtime || runtime.status !== "connected")
              return;
            runtime.status = "disconnected";
            runtime.definitions = [];
            changed();
          };
          await runtime.client.connect(runtime.transport, {
            signal: runtime.controller.signal,
            timeout: 30_000,
            maxTotalTimeout: 30_000,
          });
        };
        try {
          await start();
        } catch (error) {
          if (
            !(error instanceof UnauthorizedError) ||
            !runtime.oauth ||
            runtime.status !== "authorizing"
          )
            throw error;
          const code = await runtime.oauth.waitForCallback();
          await runtime.transport.finishAuth(code);
          await runtime.client.close();
          await start();
        }
        await discover(config, runtime);
        if (runtime.controller.signal.aborted || runtimes.get(id) !== runtime)
          throw new McpSafeError("MCP connection cancelled.", "MCP_CANCELLED");
        await runtime.oauth?.complete();
        runtime.status = "connected";
        runtime.client.setNotificationHandler(
          ToolListChangedNotificationSchema,
          () => {
            if (runtime.refreshing || runtime.status !== "connected") return;
            runtime.refreshing = true;
            void discover(config, runtime)
              .then(changed)
              .catch(() => {
                runtime.error =
                  "MCP tool catalog could not be refreshed. Reconnect the server.";
                changed();
              })
              .finally(() => {
                runtime.refreshing = false;
              });
          },
        );
        changed();
      } catch (error) {
        const cancelled = runtime.controller.signal.aborted;
        const failure = connectionFailure(error, config);
        await dispose(runtime);
        if (runtimes.get(id) === runtime) {
          runtime.status = cancelled ? "disconnected" : "error";
          runtime.error = cancelled
            ? "MCP connection cancelled."
            : failure.message;
          runtime.diagnostic = cancelled ? undefined : failure.diagnostic;
          changed();
        }
      } finally {
        clearTimeout(timeout);
        signal?.removeEventListener("abort", onAbort);
        runtime.pending = undefined;
      }
      return configs.has(id)
        ? publicConfig(configs.get(id))
        : { ...config, status: "disconnected", toolCount: 0, error: "" };
    })();
    return runtime.pending;
  }

  function tools() {
    return redacted(
      [...runtimes.values()]
        .filter((runtime) => runtime.status === "connected")
        .flatMap((runtime) => clone(runtime.definitions)),
    );
  }
  function boundedResult(original) {
    const result = redacted(original);
    const imageData = new Map();
    let imageBytes = 0;
    let omittedImages = 0;
    // Use small placeholders while applying the text/structured-data budget.
    // The original image payload is restored only after that budget is met.
    result.content = (result.content || []).flatMap((block) => {
      if (block.type !== "image") return [block];
      if (
        !IMAGE_MIME_TYPES.has(block.mimeType) ||
        typeof block.data !== "string" ||
        !block.data.length ||
        block.data.length % 4 !== 0 ||
        block.data.length > MAX_IMAGE_BASE64_BYTES ||
        !/^[A-Za-z0-9+/]+={0,2}$/.test(block.data) ||
        imageData.size >= MAX_RESULT_IMAGES ||
        imageBytes + block.data.length > MAX_IMAGE_BASE64_BYTES
      ) {
        omittedImages++;
        return [];
      }
      const placeholder = { type: "image", mimeType: block.mimeType, data: "" };
      imageData.set(placeholder, block.data);
      imageBytes += block.data.length;
      return [placeholder];
    });
    const notices = omittedImages
      ? [
          {
            type: "text",
            text: `[${omittedImages} MCP image(s) omitted: unsupported or invalid data, or the limit of 4 images / 6 MiB total base64 data was exceeded. Ask the server for a smaller selection.]`,
          },
        ]
      : [];
    const restoreImages = (value) => ({
      ...value,
      content: value.content.map((block) =>
        imageData.has(block) ? { ...block, data: imageData.get(block) } : block,
      ),
    });
    const complete = { ...result, content: [...result.content, ...notices] };
    if (Buffer.byteLength(JSON.stringify(complete)) <= MAX_RESULT_BYTES)
      return restoreImages(complete);
    let remaining = MAX_RESULT_BYTES - 4096;
    const content = [];
    for (const block of result.content) {
      if (imageData.has(block)) {
        content.push(block);
        continue;
      }
      if (block.type !== "text" || remaining < 128) continue;
      let low = 0;
      let high = block.text.length;
      while (low < high) {
        const middle = Math.ceil((low + high) / 2);
        if (
          Buffer.byteLength(
            JSON.stringify({ type: "text", text: block.text.slice(0, middle) }),
          ) <= remaining
        )
          low = middle;
        else high = middle - 1;
      }
      const clipped = { type: "text", text: block.text.slice(0, low) };
      remaining -= Buffer.byteLength(JSON.stringify(clipped)) + 1;
      content.push(clipped);
    }
    content.push(
      {
        type: "text",
        text: "[MCP text/structured result truncated to 256 KB. Ask the server for a smaller selection.]",
      },
      ...notices,
    );
    return restoreImages({ content, isError: Boolean(result.isError) });
  }
  async function callTool(name, args, { signal, session } = {}) {
    ensureOpen();
    let selected;
    let runtime;
    for (const item of runtimes.values()) {
      if (item.status !== "connected") continue;
      const definition = item.definitions.find(
        (tool) => tool.function.name === name,
      );
      if (definition) {
        selected = definition;
        runtime = item;
        break;
      }
    }
    if (!selected)
      throw new McpSafeError(
        "MCP tool is not available. Connect its server first.",
      );
    if (!args || typeof args !== "object" || Array.isArray(args))
      throw new McpSafeError("MCP tool arguments must be an object.");
    if (Buffer.byteLength(JSON.stringify(args)) > MAX_RESULT_BYTES)
      throw new McpSafeError("MCP tool arguments are too large.", "MCP_LIMIT");
    return requestScope(runtime, { signal, session }, async (options) => {
      try {
        return boundedResult(
          await runtime.client.callTool(
            { name: selected.mcp.toolName, arguments: args },
            undefined,
            options,
          ),
        );
      } catch (error) {
        if (options.signal.aborted)
          throw new McpSafeError("MCP tool call cancelled.", "MCP_CANCELLED");
        const message = errorMessage(
          error,
          configs.get(selected.mcp.connectorId),
        );
        if (
          error instanceof UnauthorizedError ||
          error?.code === "MCP_AUTH" ||
          error?.code === 401 ||
          error?.code === 403 ||
          error?.code === -32001 ||
          error instanceof TypeError
        ) {
          runtime.status = "error";
          runtime.error = message;
          await dispose(runtime);
          changed();
        }
        throw new McpSafeError(message);
      }
    });
  }
  // A connector has one active request context so server forms cannot cross chats.
  async function requestScope(runtime, { signal, session }, request) {
    const lifetime = new AbortController();
    const combined = AbortSignal.any([
      runtime.controller.signal,
      lifetime.signal,
      ...(signal ? [signal] : []),
    ]);
    const previous = runtime.callQueue || Promise.resolve();
    let release;
    const complete = new Promise((resolve) => {
      release = resolve;
    });
    runtime.callQueue = previous.catch(() => {}).then(() => complete);
    let active = false;
    try {
      await new Promise((resolve, reject) => {
        const cancel = () => {
          combined.removeEventListener("abort", cancel);
          reject(combined.reason);
        };
        if (combined.aborted) {
          cancel();
          return;
        }
        combined.addEventListener("abort", cancel, { once: true });
        previous
          .catch(() => {})
          .then(() => {
            combined.removeEventListener("abort", cancel);
            resolve();
          });
      });
      combined.throwIfAborted();
      runtime.activeContext = { signal: combined, session };
      active = true;
      const timeout = session ? 10 * 60_000 : CALL_TIMEOUT;
      return await request({
        signal: combined,
        timeout,
        maxTotalTimeout: timeout,
      });
    } finally {
      lifetime.abort();
      if (active) runtime.activeContext = undefined;
      release();
    }
  }
  async function resourceOperation(
    id,
    operation,
    args = {},
    { signal, session } = {},
  ) {
    const runtime = runtimes.get(id);
    if (!runtime || runtime.status !== "connected")
      throw new McpSafeError("Подключите MCP-сервер");
    return requestScope(runtime, { signal, session }, async (options) => {
      let value;
      if (operation === "resources")
        value = await runtime.client.listResources(
          { cursor: args.cursor },
          options,
        );
      else if (operation === "templates")
        value = await runtime.client.listResourceTemplates(
          { cursor: args.cursor },
          options,
        );
      else if (operation === "read")
        value = await runtime.client.readResource({ uri: args.uri }, options);
      else if (operation === "prompts")
        value = await runtime.client.listPrompts(
          { cursor: args.cursor },
          options,
        );
      else if (operation === "prompt")
        value = await runtime.client.getPrompt(
          { name: args.name, arguments: args.arguments || {} },
          options,
        );
      else throw new McpSafeError("Неизвестная операция MCP");
      const text = JSON.stringify(redacted(value));
      if (Buffer.byteLength(text) > MAX_RESULT_BYTES)
        throw new McpSafeError(
          "Ответ MCP больше 256 КБ. Запросите меньший ресурс.",
        );
      return JSON.parse(text);
    });
  }
  async function close() {
    if (closed) return;
    closed = true;
    const values = [...runtimes.values()];
    runtimes.clear();
    await Promise.allSettled(values.map(dispose));
    secrets.clear();
    observers.clear();
  }
  return {
    list,
    subscribe(observer) { observers.add(observer); return () => observers.delete(observer); },
    async reopenAuthorization(id) {
      const runtime = runtimes.get(id);
      if (runtime?.status !== 'authorizing' || !runtime.oauth) throw new McpSafeError('Вход уже завершён или истёк. Подключитесь снова.');
      await runtime.oauth.reopenAuthorization();
      return null;
    },
    save,
    remove,
    connect,
    disconnect,
    tools,
    callTool,
    resourceOperation,
    close,
  };
}

module.exports = { createMcpManager };
