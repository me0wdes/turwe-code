/* Check the actual Electron runtime, not the ABI of the host Node process. */
const { spawnSync } = require("node:child_process");
const path = require("node:path");

async function probe() {
  const pty = require("node-pty");
  const { rgPath } = await import("@vscode/ripgrep");
  const ffmpeg = require("ffmpeg-static");
  for (const [name, binary, args] of [
    ["ripgrep", rgPath, ["--version"]],
    ["FFmpeg", ffmpeg, ["-version"]],
  ]) {
    if (!binary) throw new Error(`${name}: no binary for this platform`);
    const result = spawnSync(binary, args, { encoding: "utf8", windowsHide: true, timeout: 15000 });
    if (result.error || result.status !== 0) throw new Error(`${name}: ${result.error?.message || result.stderr}`);
    console.log(`${name}: ${result.stdout.split(/\r?\n/)[0]}`);
  }
  await new Promise((resolve, reject) => {
    const token = "turwe-native-ready";
    const windows = process.platform === "win32";
    const terminal = pty.spawn(windows ? process.env.ComSpec || "cmd.exe" : "/bin/sh",
      windows ? ["/d", "/c", `echo ${token}`] : ["-c", `printf '${token}\\n'`],
      { name: "xterm-256color", cols: 80, rows: 24, cwd: process.cwd(), env: process.env });
    let output = "";
    const timer = setTimeout(() => { terminal.kill(); reject(new Error("PTY smoke timed out")); }, 15000);
    terminal.onData((chunk) => { output += chunk; });
    terminal.onExit(({ exitCode }) => {
      clearTimeout(timer);
      if (exitCode !== 0 || !output.includes(token)) reject(new Error(`PTY smoke failed (${exitCode}): ${output}`));
      else resolve();
    });
  });
  console.log(`Native tools OK: Electron ${process.versions.electron}, ${process.platform}-${process.arch}`);
}

if (process.argv.includes("--electron-probe")) {
  probe().then(() => process.exit(0)).catch((error) => { console.error(error.message); process.exit(1); });
} else {
  const [targetPlatform = process.platform, targetArch = process.arch] = process.argv.slice(2);
  if (targetPlatform !== process.platform || targetArch !== process.arch) {
    console.error(`Build ${targetPlatform}-${targetArch} on a matching runner. This machine is ${process.platform}-${process.arch}; FFmpeg, ripgrep and Electron must match.`);
    process.exit(1);
  }
  const result = spawnSync(require("electron"), [path.resolve(__filename), "--electron-probe"], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" }, stdio: "inherit", windowsHide: true, timeout: 60000,
  });
  if (result.error) console.error(result.error.message);
  if (result.status !== 0) console.error("Native tools failed. Reinstall on this platform with npm ci; if an addon has no compatible prebuild, run npm run native:rebuild, then npm run native:check.");
  process.exitCode = result.status === 0 ? 0 : 1;
}
