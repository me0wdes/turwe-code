/* Launch the built app without touching the developer's saved profile or API key. */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { version } = require("../package.json");
const root = path.resolve(__dirname, "..");
const release = path.join(root, "release");
const output = path.join(release, "smoke");
const executable = process.platform === "win32"
  ? path.join(release, `Turwe-Code-${version}-Windows.exe`)
  : path.join(release, process.arch === "arm64" ? "mac-arm64" : "mac", "Turwe Code.app", "Contents", "MacOS", "Turwe Code");

async function main() {
  if (!["win32", "darwin"].includes(process.platform)) throw new Error("Desktop smoke supports Windows and macOS runners");
  if (!fs.existsSync(executable)) throw new Error(`Build the matching package first: ${executable}`);
  fs.mkdirSync(output, { recursive: true });
  for (const name of ["launch.json", "desktop.png"]) fs.rmSync(path.join(output, name), { force: true });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "turwe-package-smoke-"));
  const env = { ...process.env, TURWE_DATA_DIR: profile, TURWE_SMOKE_OUTPUT: output };
  for (const key of ["TURWE_BOOTSTRAP_KEY", "ELECTRON_RUN_AS_NODE", "TURWE_SMOKE_STAY_OPEN", "TURWE_SMOKE_IMPORT_DIR"]) delete env[key];
  const status = await new Promise((resolve, reject) => {
    const log = fs.openSync(path.join(output, "process.log"), "w");
    const child = spawn(executable, ["--smoke-test"], { cwd: root, env, stdio: ["ignore", log, log], windowsHide: true });
    fs.closeSync(log);
    console.log(`Smoke process: ${child.pid}, isolated profile: ${profile}`);
    const timer = setTimeout(() => {
      if (process.platform === "win32" && child.pid) {
        spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore", timeout: 10000 });
      } else child.kill();
      reject(new Error("Packaged app did not exit within 90 seconds"));
    }, 90000);
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.once("exit", (code) => { clearTimeout(timer); resolve(code); });
  });
  if (status !== 0) throw new Error(`Packaged app exited with ${status}`);
  const report = JSON.parse(fs.readFileSync(path.join(output, "launch.json"), "utf8"));
  if (!report.loaded || report.hasKey || !report.sandbox) throw new Error(`Unexpected startup report: ${JSON.stringify(report)}`);
  // Test the helpers that were actually shipped, including their executable
  // permissions and app.asar.unpacked paths, without repairing the app bundle.
  const nativeExecutable = process.platform === "win32"
    ? path.join(release, "win-unpacked", "Turwe Code.exe") : executable;
  const appPath = process.platform === "win32"
    ? path.join(release, "win-unpacked", "resources", "app.asar")
    : path.resolve(path.dirname(executable), "../Resources/app.asar");
  const native = spawnSync(nativeExecutable, [path.join(__dirname, "check-native.cjs"), "--electron-probe", appPath], {
    cwd: root, env: { ...env, ELECTRON_RUN_AS_NODE: "1" }, encoding: "utf8", windowsHide: true, timeout: 60000,
  });
  fs.writeFileSync(path.join(output, "native.log"), `${native.stdout || ""}${native.stderr || ""}`);
  if (native.error || native.status !== 0) throw new Error(`Packaged native tools failed: ${native.error?.message || native.stderr || native.signal || native.status}`);
  report.nativeTools = true;
  fs.writeFileSync(path.join(output, "launch.json"), JSON.stringify(report));
  console.log(`Packaged app smoke OK: ${process.platform}-${process.arch}, Electron ${report.electron}`);
  console.log(`Evidence: ${output}`);
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
