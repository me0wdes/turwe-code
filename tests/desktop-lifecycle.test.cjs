const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { EventEmitter } = require("node:events");

// Execute the real main entry with inert OS boundaries: no windows, user data,
// credentials, subprocesses or external API calls are created by this fixture.
async function desktop(platform, { smoke = false } = {}) {
  let startup,
    window,
    menu,
    smokeCallback,
    cleanups = 0,
    stopped = 0,
    quit = false,
    exit;
  const outputFiles = new Map();
  const app = new EventEmitter();
  Object.assign(app, {
    setName() {},
    setAppUserModelId() {},
    setPath() {},
    requestSingleInstanceLock: () => true,
    getPath: () => "/fixture/profile",
    whenReady: () => ({ then: (fn) => (startup = Promise.resolve().then(fn)) }),
    quit() {
      app.emit("before-quit");
      if (window && !window.destroyed) window.close();
      else quit = true;
    },
    exit: (code) => {
      exit = code;
    },
  });
  class Window extends EventEmitter {
    constructor(options) {
      super();
      window = this;
      this.options = options;
      this.webContents = Object.assign(new EventEmitter(), {
        setWindowOpenHandler() {},
        session: {
          setPermissionRequestHandler() {},
          setPermissionCheckHandler() {},
        },
        isLoading: () => false,
        capturePage: () => new Promise(() => {}),
      });
    }
    isDestroyed() {
      return !!this.destroyed;
    }
    isMinimized() {
      return false;
    }
    show() {
      this.hidden = false;
    }
    hide() {
      this.hidden = true;
    }
    focus() {
      this.focused = true;
    }
    close() {
      this.emit("close", { preventDefault() {} });
    }
    destroy() {
      this.destroyed = true;
      this.emit("closed");
      app.emit("window-all-closed");
    }
    async loadFile() {}
    getSize() {
      return [1200, 800];
    }
    setSize() {}
    getTitle() {
      return "Turwe Code";
    }
  }
  const state = {
    settings: { baseUrl: "https://fixture.invalid/v1" },
    sessions: [{ id: "existing" }],
    projects: [],
  };
  const mocks = {
    "node:fs": smoke
      ? {
          ...fs,
          mkdirSync() {},
          writeFileSync: (file, content) =>
            outputFiles.set(path.basename(file), content),
        }
      : fs,
    electron: {
      app,
      BrowserWindow: Window,
      ipcMain: { handle() {} },
      Menu: {
        buildFromTemplate: (t) => t,
        setApplicationMenu: (t) => {
          menu = t;
        },
      },
    },
    "./store.cjs": {
      createStore: () => ({ state, save() {}, models: { list: () => [] } }),
    },
    "./themes.mjs": { themeBackground: () => "#000", validateTheme: (v) => v },
    "./session-start.mjs": require("../electron/session-start.mjs"),
    "./updates.cjs": require("../electron/updates.cjs"),
    "./credentials.cjs": { createCredentials: () => ({ get: () => "" }) },
    "./processes.cjs": { restoreLoginPath: async () => {} },
    "./controller.cjs": {
      createController: () => ({
        stopAll() {
          stopped++;
        },
      }),
    },
    "./attachments.cjs": { createAttachmentStore: () => ({}) },
    "./github-skills.cjs": { createGithubInstaller: () => ({}) },
    "./mcp.cjs": {
      createMcpManager: () => ({
        list: () => [],
        close: async () => {
          cleanups++;
        },
      }),
    },
    "./tools.cjs": { createTools: () => ({}) },
    "./coding-runtime.cjs": {
      createCodingRuntime: () => ({
        bind() {},
        close: async () => {
          cleanups++;
        },
      }),
    },
    "./api.cjs": { safeError: (e) => String(e) },
    "./mcp-forms.cjs": {},
    "./clipboard-attachments.cjs": {},
    "./skills.cjs": {},
    "./files.cjs": {},
  };
  const filename = path.resolve(__dirname, "../electron/main.cjs");
  vm.runInNewContext(
    fs.readFileSync(filename, "utf8"),
    {
      require: (name) => (name in mocks ? mocks[name] : require(name)),
      __dirname: path.dirname(filename),
      process: {
        platform,
        env: smoke ? { TURWE_SMOKE_OUTPUT: "/fixture/output" } : {},
        argv: smoke ? ["--smoke-test"] : [],
        versions: {},
      },
      console: { error: () => {} },
      setTimeout: smoke
        ? (fn, ms) => (ms === 1300 ? (smokeCallback = fn) : setTimeout(fn, 0))
        : setTimeout,
      clearTimeout,
      setInterval: () => ({ unref() {} }),
      clearInterval() {},
    },
    { filename },
  );
  await startup;
  assert.equal(exit, undefined, "main entry initialized successfully");
  return {
    app,
    window,
    menu,
    outputFiles,
    runSmoke: () => smokeCallback(),
    stats: () => ({ cleanups, stopped, quit }),
  };
}

test("macOS keeps workspace after red close, restores from Dock, and cleans up on Cmd+Q", async () => {
  const d = await desktop("darwin");
  assert.equal(d.window.options.frame, true);
  assert.equal(d.window.options.titleBarStyle, "hiddenInset");
  assert.equal(
    d.menu.some((item) => item.role === "editMenu"),
    true,
  );
  assert.equal(
    d.menu.some((item) => item.role === "appMenu"),
    true,
  );
  d.window.close();
  assert.equal(d.window.hidden, true);
  assert.deepEqual(d.stats(), { cleanups: 0, stopped: 0, quit: false });
  d.app.emit("activate");
  assert.equal(d.window.hidden, false);
  assert.equal(d.window.focused, true);
  d.app.quit();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(d.window.destroyed, true);
  assert.deepEqual(d.stats(), { cleanups: 2, stopped: 1, quit: true });
});

test("Windows close still stops agents and quits with the rectangular custom frame", async () => {
  const d = await desktop("win32");
  assert.equal(d.window.options.frame, false);
  assert.equal(d.window.options.roundedCorners, false);
  d.window.close();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(d.window.destroyed, true);
  assert.deepEqual(d.stats(), { cleanups: 2, stopped: 1, quit: true });
});

test("smoke run writes launch evidence and exits even when hidden capture never returns", async () => {
  const d = await desktop("win32", { smoke: true });
  const run = d.runSmoke();
  assert.equal(
    JSON.parse(d.outputFiles.get("launch.json")).loaded,
    true,
    "launch evidence precedes capture",
  );
  await run;
  await new Promise((resolve) => setImmediate(resolve));
  const report = JSON.parse(d.outputFiles.get("launch.json"));
  assert.equal(report.loaded, true);
  assert.equal(report.screenshot, false);
  assert.match(report.screenshotError, /timed out/);
  assert.equal(d.stats().quit, true);
});
