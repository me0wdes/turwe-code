const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const path = require("node:path");
const fs = require("node:fs/promises");
const { randomUUID } = require("node:crypto");
const exec = promisify(execFile);
function createGit({ files, store, directory }) {
  const run = async (s, bin, args) => {
    try {
      return (
        await exec(bin, args, {
          cwd: files.root(s),
          windowsHide: true,
          timeout: 60000,
          maxBuffer: 4 * 1024 * 1024,
        })
      ).stdout.trim();
    } catch (e) {
      if (e.code === "ENOENT")
        throw new Error(
          `${bin} не найден. Установите ${bin === "git" ? "Git for Windows" : "GitHub CLI и выполните gh auth login"}.`,
        );
      throw new Error(String(e.stderr || e.message).slice(0, 8000));
    }
  };
  async function worktree(s, args = {}) {
    if (s.worktreePath && !args.replace)
      throw new Error("Сессия уже использует worktree");
    const name = "turwe/" + randomUUID().slice(0, 8),
      folder = path.join(directory, "worktrees", randomUUID());
    await fs.mkdir(path.dirname(folder), { recursive: true });
    const base = args.base || "HEAD";
    if (typeof base !== "string" || base.startsWith("-") || base.length > 200)
      throw new Error("Некорректная база ветки");
    await run(
      args.sourceRoot ? { ...s, worktreePath: args.sourceRoot } : s,
      "git",
      ["worktree", "add", "-b", name, folder, base],
    );
    s.worktreePath = folder;
    s.branch = name;
    store.save();
    return { path: folder, branch: name };
  }
  async function status(s) {
    return {
      branch: await run(s, "git", ["branch", "--show-current"]),
      status: await run(s, "git", ["status", "--short"]),
      diff: await run(s, "git", ["diff", "--stat"]),
      worktreePath: s.worktreePath || null,
    };
  }
  async function execute(s, args) {
    switch (args.operation) {
      case "status":
        return status(s);
      case "diff":
        return {
          diff: await run(s, "git", [
            "diff",
            ...(args.staged ? ["--cached"] : []),
            "--",
          ]),
        };
      case "log":
        return { log: await run(s, "git", ["log", "-15", "--oneline"]) };
      case "worktree":
        return worktree(s, args);
      case "commit": {
        if (
          typeof args.message !== "string" ||
          !args.message.trim() ||
          args.message.length > 4000
        )
          throw new Error("Укажите сообщение коммита");
        if (!Array.isArray(args.paths) || !args.paths.length)
          throw new Error("Укажите конкретные файлы для коммита");
        const { safeRelative } = require("./workspace-files.cjs");
        const paths = args.paths.map(safeRelative);
        await run(s, "git", ["add", "--", ...paths]);
        return {
          output: await run(s, "git", [
            "commit",
            "-m",
            args.message,
            "--",
            ...paths,
          ]),
        };
      }
      case "push":
        return {
          output: await run(s, "git", [
            "push",
            "--set-upstream",
            "origin",
            "HEAD",
          ]),
        };
      case "create_pr": {
        if (
          typeof args.title !== "string" ||
          !args.title.trim() ||
          typeof args.body !== "string"
        )
          throw new Error("Укажите заголовок и описание PR");
        const temp = path.join(directory, "pr-" + randomUUID() + ".md");
        await fs.mkdir(directory, { recursive: true });
        await fs.writeFile(temp, args.body, "utf8");
        try {
          const url = await run(s, "gh", [
            "pr",
            "create",
            "--draft",
            "--title",
            args.title,
            "--body-file",
            temp,
          ]);
          s.pullRequest = url;
          store.save();
          return { url };
        } finally {
          await fs.unlink(temp).catch(() => {});
        }
      }
      case "ci":
        return JSON.parse(
          await run(s, "gh", [
            "pr",
            "view",
            "--json",
            "url,title,state,statusCheckRollup,headRefName",
          ]),
        );
      case "ci_logs":
        return {
          output: await run(s, "gh", [
            "run",
            "view",
            String(args.runId || ""),
            "--log-failed",
          ]),
        };
      default:
        throw new Error("Неизвестная операция Git");
    }
  }
  return { execute, status, worktree };
}
module.exports = { createGit };
