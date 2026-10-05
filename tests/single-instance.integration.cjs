const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const assert = require("node:assert/strict");
const root = path.resolve(__dirname, ".."),
  electron = path.join(root, "node_modules/electron/dist/electron.exe");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "turwe-instance-"));
const primary = spawn(electron, [root, "--smoke-test"], {
  windowsHide: true,
  stdio: "ignore",
  env: {
    ...process.env,
    TURWE_DATA_DIR: path.join(dir, "data"),
    TURWE_SMOKE_OUTPUT: path.join(dir, "first"),
    TURWE_SMOKE_STAY_OPEN: "1",
  },
});
async function run() {
  try {
    const timeout = Date.now() + 15000;
    while (
      !fs.existsSync(path.join(dir, "first/launch.json")) &&
      Date.now() < timeout
    )
      await new Promise((r) => setTimeout(r, 100));
    assert.ok(
      fs.existsSync(path.join(dir, "first/launch.json")),
      "primary window loaded",
    );
    const secondary = spawn(electron, [root, "--smoke-test"], {
      windowsHide: true,
      stdio: "ignore",
      env: {
        ...process.env,
        TURWE_DATA_DIR: path.join(dir, "data"),
        TURWE_SMOKE_OUTPUT: path.join(dir, "second"),
        TURWE_SMOKE_STAY_OPEN: "",
      },
    });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        secondary.kill();
        reject(new Error("second process did not exit"));
      }, 8000);
      secondary.on("exit", () => {
        clearTimeout(timer);
        resolve();
      });
      secondary.on("error", reject);
    });
    assert.ok(
      !fs.existsSync(path.join(dir, "second/launch.json")),
      "second process must not initialize another window/store",
    );
    console.log("PASS: second launch did not initialize another store/window");
  } finally {
    primary.kill();
    await new Promise((r) => setTimeout(r, 500));
    const resolved = path.resolve(dir);
    if (
      !resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) ||
      !path.basename(resolved).startsWith("turwe-instance-")
    )
      throw new Error("unsafe cleanup");
    fs.rmSync(resolved, { recursive: true, force: true });
  }
}
run().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
