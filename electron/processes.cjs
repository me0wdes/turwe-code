const { spawn, execFile } = require("node:child_process");
const { existsSync } = require("node:fs");
const path = require("node:path");
const { homedir } = require("node:os");
const { randomUUID } = require("node:crypto");
function defaultShell(platform = process.platform) {
  return platform === "win32"
    ? "powershell"
    : platform === "darwin"
      ? "zsh"
      : "bash";
}

// Finder does not inherit a terminal's login PATH. Import only PATH, never
// arbitrary shell variables, and retain useful defaults if a profile fails.
async function restoreLoginPath({
  platform = process.platform,
  env = process.env,
  run = execFile,
} = {}) {
  if (platform !== "darwin") return;
  const inherited = env.PATH || "";
  let loginPath = "";
  const shell = ["/bin/zsh", "/bin/bash", "/bin/sh"].includes(env.SHELL)
    ? env.SHELL
    : "/bin/zsh";
  try {
    loginPath = await new Promise((resolve) =>
      run(
        shell,
        ["-ilc", "printf '\\0%s\\0' \"$PATH\""],
        { encoding: "utf8", timeout: 4000, maxBuffer: 256 * 1024, env },
        (error, stdout) =>
          resolve(error ? "" : String(stdout).split("\0").at(-2) || ""),
      ),
    );
  } catch {}
  env.PATH = [
    ...new Set(
      [
        ...loginPath.split(":"),
        ...inherited.split(":"),
        "/opt/homebrew/bin",
        "/opt/homebrew/sbin",
        "/usr/local/bin",
        "/usr/local/sbin",
        "/usr/bin",
        "/bin",
        "/usr/sbin",
        "/sbin",
      ].filter((part) => part.startsWith("/") && !/[\r\n\0]/.test(part)),
    ),
  ].join(":");
}

function shellSpec(
  shell,
  command,
  { platform = process.platform, env = process.env, exists = existsSync } = {},
) {
  shell ||= defaultShell(platform);
  // Profiles created on Windows used PowerShell as the implicit default.
  if (platform !== "win32" && shell === "powershell")
    shell = defaultShell(platform);
  if (shell === "bash") {
    const candidates =
      platform === "win32"
        ? [
            path.join(
              env.ProgramFiles || "C:\\Program Files",
              "Git",
              "bin",
              "bash.exe",
            ),
            path.join(
              env.LOCALAPPDATA || "",
              "Programs",
              "Git",
              "bin",
              "bash.exe",
            ),
          ]
        : ["/bin/bash"];
    const bin = candidates.find(exists);
    if (!bin)
      throw new Error(
        platform === "win32"
          ? "Bash не найден. Установите Git for Windows или выберите PowerShell."
          : "Bash не найден: /bin/bash.",
      );
    return {
      bin,
      shell,
      args:
        command === undefined
          ? ["--noprofile", "--norc"]
          : ["--noprofile", "--norc", "-c", command],
    };
  }
  if (platform !== "win32" && ["zsh", "sh"].includes(shell)) {
    const bin = `/bin/${shell}`;
    if (!exists(bin)) throw new Error(`Оболочка не найдена: ${bin}`);
    return {
      bin,
      shell,
      args:
        shell === "zsh"
          ? ["-f", ...(command === undefined ? ["-i"] : ["-c", command])]
          : command === undefined
            ? []
            : ["-c", command],
    };
  }
  if (!["powershell", "cmd"].includes(shell))
    throw new Error("Неизвестная оболочка");
  if (platform !== "win32")
    throw new Error("Эта оболочка доступна только в Windows");
  if (shell === "cmd")
    return {
      bin: env.ComSpec || "cmd.exe",
      shell,
      args: command === undefined ? [] : ["/d", "/s", "/c", command],
    };
  return {
    bin: path.join(
      env.SystemRoot || "C:\\Windows",
      "System32",
      "WindowsPowerShell",
      "v1.0",
      "powershell.exe",
    ),
    shell,
    args: [
      "-NoLogo",
      "-NoProfile",
      ...(command === undefined
        ? ["-NoExit"]
        : [
            "-NonInteractive",
            "-OutputFormat",
            "Text",
            "-EncodedCommand",
            Buffer.from(
              "$ProgressPreference = 'SilentlyContinue'\n" +
                "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)\n" +
                "$OutputEncoding = [Console]::OutputEncoding\n" +
                "$ErrorActionPreference = 'Stop'\n" +
                "try {\n" +
                command +
                "\n" +
                "if ($null -ne $LASTEXITCODE) { exit $LASTEXITCODE }\n" +
                "} catch { [Console]::Error.WriteLine($_.ToString()); exit 1 }",
              "utf16le",
            ).toString("base64"),
          ]),
    ],
  };
}
function createProcesses({ store, files, emit }) {
  const jobs = new Map();
  store.state.processes = [];
  const visible = () => {
    store.state.processes = [...jobs.values()].map((j) => j.info);
    emit();
  };
  function owned(session, id) {
    const job = jobs.get(id);
    if (
      !job ||
      (job.info.sessionId !== session.id &&
        (session.rootSessionId || job.info.rootSessionId !== session.id))
    )
      throw new Error("Процесс не принадлежит этой сессии");
    return job;
  }
  async function kill(job) {
    if (job.killing) return job.killing;
    if (job.info.status !== "running") return;
    job.stopped = true;
    job.killing = (async () => {
      if (process.platform === "win32" && job.pid) {
        const killed = await new Promise((resolve) =>
          execFile(
            "taskkill.exe",
            ["/pid", String(job.pid), "/t", "/f"],
            { windowsHide: true, timeout: 10000 },
            (error) => resolve(!error),
          ),
        );
        if (killed) return;
      }
      if (process.platform !== "win32" && job.pid && !job.info.terminal) {
        // Each command has its own process group, so stopping a shell also
        // stops its build servers and other descendants.
        try {
          process.kill(-job.pid, "SIGTERM");
        } catch {}
        await new Promise((resolve) => setTimeout(resolve, 200));
        try {
          process.kill(-job.pid, "SIGKILL");
        } catch {}
        return;
      }
      try {
        job.child.kill();
      } catch {}
    })();
    return job.killing;
  }
  function start(session, args = {}, signal) {
    if (
      typeof args.command !== "string" ||
      !args.command.trim() ||
      args.command.length > 32000
    )
      throw new Error("Введите команду до 32 000 символов");
    return launch(session, args, signal, false);
  }
  function launch(session, args, signal, terminal) {
    if (
      [...jobs.values()].filter((j) => j.info.status === "running").length >= 16
    )
      throw new Error("Уже запущено 16 процессов. Остановите ненужные.");
    const {
        bin,
        args: argv,
        shell,
      } = shellSpec(args.shell, terminal ? undefined : args.command),
      id = randomUUID();
    const info = {
      id,
      sessionId: session.id,
      rootSessionId: session.rootSessionId || session.id,
      command: terminal ? "Терминал" : args.command,
      shell,
      terminal,
      status: "running",
      output: "",
      createdAt: new Date().toISOString(),
      cwd: session.projectId ? files.root(session) : homedir(),
    };
    let resolve;
    const job = { info, done: new Promise((r) => (resolve = r)) };
    jobs.set(id, job);
    const append = (data) => {
      info.output = (info.output + data).slice(-200000);
      visible();
    };
    const finish = (code, error) => {
      if (info.status !== "running") return;
      clearTimeout(job.timer);
      signal?.removeEventListener("abort", abort);
      info.status = job.stopped
        ? "stopped"
        : error || code !== 0
          ? "error"
          : "exited";
      info.exitCode = code;
      info.isError = info.status === "error" || info.status === "stopped";
      info.error =
        error ||
        (info.timedOut
          ? "Превышено время команды"
          : code
            ? `Команда завершилась с кодом ${code}`
            : undefined);
      info.finishedAt = new Date().toISOString();
      resolve({ ...info });
      visible();
    };
    const abort = () => kill(job);
    const env = { ...process.env };
    delete env.TURWE_BOOTSTRAP_KEY;
    try {
      if (terminal) {
        const pty = require("node-pty");
        job.child = pty.spawn(bin, argv, {
          name: "xterm-256color",
          cols: 100,
          rows: 24,
          cwd: info.cwd,
          env,
          windowsHide: true,
        });
        job.pid = job.child.pid;
        job.child.onData(append);
        job.child.onExit((e) => finish(e.exitCode));
      } else {
        job.child = spawn(bin, argv, {
          cwd: info.cwd,
          env,
          windowsHide: true,
          stdio: ["pipe", "pipe", "pipe"],
          detached: process.platform !== "win32",
        });
        job.pid = job.child.pid;
        job.child.stdout.setEncoding("utf8");
        job.child.stderr.setEncoding("utf8");
        job.child.stdout.on("data", append);
        job.child.stderr.on("data", append);
        job.child.on("error", (e) => finish(null, e.message));
        job.child.on("close", (code) => finish(code));
      }
      if (!args.background && signal) {
        if (signal.aborted) abort();
        else signal.addEventListener("abort", abort, { once: true });
      }
      if (!terminal && !args.background)
        job.timer = setTimeout(
          () => {
            info.timedOut = true;
            append("\nПревышено время команды.\n");
            kill(job);
          },
          Math.max(1000, Math.min(Number(args.timeoutMs) || 120000, 600000)),
        );
    } catch (e) {
      finish(null, e.message);
    }
    visible();
    return args.background || terminal
      ? Promise.resolve({ ...info })
      : job.done;
  }
  return {
    start,
    terminal: (s, a = {}) =>
      launch(s, { ...a, background: true }, undefined, true),
    list: (s) =>
      [...jobs.values()]
        .filter((j) => j.info.rootSessionId === (s.rootSessionId || s.id))
        .map((j) => j.info),
    status: (s, id) => ({ ...owned(s, id).info }),
    stop: async (s, id) => {
      const job = owned(s, id);
      await kill(job);
      await job.done;
      return { id: job.info.id, status: job.info.status };
    },
    input: (s, id, data) => {
      const j = owned(s, id);
      if (
        typeof data !== "string" ||
        data.length > 32000 ||
        j.info.status !== "running"
      )
        throw new Error("Процесс не ожидает ввод");
      if (j.info.terminal) j.child.write(data);
      else j.child.stdin.write(data);
      return null;
    },
    resize: (s, id, cols, rows) => {
      const j = owned(s, id);
      if (j.info.terminal && Number.isInteger(cols) && Number.isInteger(rows))
        j.child.resize(
          Math.max(20, Math.min(cols, 400)),
          Math.max(5, Math.min(rows, 100)),
        );
      return null;
    },
    stopSession: (s) =>
      Promise.all(
        [...jobs.values()]
          .filter((j) =>
            s.rootSessionId
              ? j.info.sessionId === s.id
              : j.info.rootSessionId === s.id,
          )
          .map(kill),
      ),
    close: () => Promise.all([...jobs.values()].map(kill)),
  };
}
module.exports = { createProcesses, shellSpec, defaultShell, restoreLoginPath };
