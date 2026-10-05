const test = require("node:test");
const assert = require("node:assert/strict");
const {
  defaultShell,
  shellSpec,
  restoreLoginPath,
  createProcesses,
} = require("../electron/processes.cjs");
const { diagnosticKey } = require("../electron/lsp.cjs");

test("macOS selects zsh and keeps explicitly requested Bash/sh semantics", () => {
  const mac = { platform: "darwin", env: {}, exists: () => true };
  assert.equal(defaultShell("darwin"), "zsh");
  assert.equal(defaultShell("win32"), "powershell");
  assert.deepEqual(shellSpec(undefined, "echo ok", mac), {
    bin: "/bin/zsh",
    shell: "zsh",
    args: ["-f", "-c", "echo ok"],
  });
  assert.equal(shellSpec("powershell", "echo ok", mac).shell, "zsh");
  assert.deepEqual(shellSpec("zsh", undefined, mac).args, ["-f", "-i"]);
  assert.deepEqual(shellSpec("bash", "echo ok", mac).args, [
    "--noprofile",
    "--norc",
    "-c",
    "echo ok",
  ]);
  assert.deepEqual(shellSpec("sh", "echo ok", mac).args, ["-c", "echo ok"]);
  assert.throws(() => shellSpec("cmd", "echo ok", mac), /Windows/);
  assert.throws(
    () => shellSpec("zsh", undefined, { ...mac, exists: () => false }),
    /не найдена/,
  );
});

test("Windows retains encoded PowerShell and command shell arguments", () => {
  const windows = {
    platform: "win32",
    env: { SystemRoot: "C:\\Windows", ComSpec: "cmd.exe" },
    exists: () => true,
  };
  const spec = shellSpec(undefined, 'Write-Output "Привет"', windows);
  assert.equal(spec.shell, "powershell");
  assert.ok(
    Buffer.from(spec.args.at(-1), "base64")
      .toString("utf16le")
      .includes('Write-Output "Привет"'),
  );
  assert.deepEqual(shellSpec("cmd", "echo ok", windows).args, [
    "/d",
    "/s",
    "/c",
    "echo ok",
  ]);
  assert.throws(() => shellSpec("zsh", undefined, windows), /оболочка/);
});

test("Finder launch imports login PATH without importing other environment or profile chatter", async () => {
  const env = { SHELL: "/bin/zsh", PATH: "/usr/bin:/bin", SECRET: "unchanged" };
  await restoreLoginPath({
    platform: "darwin",
    env,
    run: (bin, args, options, cb) => {
      assert.equal(bin, "/bin/zsh");
      assert.deepEqual(args.slice(0, 1), ["-ilc"]);
      assert.equal(options.timeout, 4000);
      cb(
        null,
        "Login banner\n\0/Users/test/.nvm/bin:/opt/homebrew/bin:/usr/bin\0\n",
      );
    },
  });
  assert.ok(
    env.PATH.startsWith("/Users/test/.nvm/bin:/opt/homebrew/bin:/usr/bin"),
  );
  assert.ok(env.PATH.includes("/usr/local/bin"));
  assert.equal(new Set(env.PATH.split(":")).size, env.PATH.split(":").length);
  assert.equal(env.SECRET, "unchanged");
  assert.equal(env.PATH.includes("banner"), false);
});

test("failed macOS shell profile falls back to system and Homebrew directories; Windows is untouched", async () => {
  const env = { PATH: "/custom/bin:/usr/bin", SHELL: "/untrusted/shell" };
  await restoreLoginPath({
    platform: "darwin",
    env,
    run: (bin, args, options, cb) => {
      assert.equal(bin, "/bin/zsh");
      cb(new Error("profile timed out"));
    },
  });
  assert.ok(env.PATH.startsWith("/custom/bin:/usr/bin"));
  assert.ok(env.PATH.includes("/opt/homebrew/bin"));
  const win = { PATH: "C:\\Windows" };
  await restoreLoginPath({
    platform: "win32",
    env: win,
    run: () => assert.fail("must not execute a shell"),
  });
  assert.equal(win.PATH, "C:\\Windows");
});

test("LSP distinguishes case-sensitive macOS/Linux files while normalizing Windows URIs", () => {
  const upper = "file:///Users/Test/A%20B.ts",
    lower = "file:///Users/Test/a%20b.ts";
  assert.notEqual(
    diagnosticKey(upper, "darwin"),
    diagnosticKey(lower, "darwin"),
  );
  assert.equal(diagnosticKey(upper, "win32"), diagnosticKey(lower, "win32"));
});

test(
  "stopping a POSIX command stops the descendant process group",
  { skip: process.platform === "win32" },
  async (t) => {
    const processes = createProcesses({
      store: { state: {} },
      files: { root: () => require("node:os").tmpdir() },
      emit() {},
    });
    t.after(() => processes.close());
    const session = { id: "fixture" };
    const job = await processes.start(session, {
      shell: "bash",
      command: 'sleep 60 & child=$!; echo "child-pid:$child"; wait',
      background: true,
    });
    let pid;
    for (let i = 0; i < 100 && !pid; i++) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      pid = Number(
        processes.status(session, job.id).output.match(/child-pid:(\d+)/)?.[1],
      );
    }
    assert.ok(pid, "descendant started");
    t.after(() => {
      try {
        process.kill(pid, "SIGKILL");
      } catch {}
    });
    await processes.stop(session, job.id);
    // A reaped macOS process disappears; on Linux it can briefly be a zombie.
    let alive = true;
    for (let i = 0; i < 100 && alive; i++) {
      try {
        process.kill(pid, 0);
      } catch {
        alive = false;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(alive, false, "descendant cannot keep running after stop");
  },
);
