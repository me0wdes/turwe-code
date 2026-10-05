const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { createWorkspaceFiles } = require("../electron/workspace-files.cjs");
async function setup(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "turwe-code-files-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const project = path.join(root, "project");
  await fs.mkdir(project);
  const session = { id: "s", projectId: "p" };
  const store = {
    state: { projects: [{ id: "p", path: project }], sessions: [session] },
    save() {},
  };
  return {
    files: createWorkspaceFiles({ store, directory: path.join(root, "data") }),
    project,
    session,
    store,
  };
}
test("editing preserves CRLF, detects stale editor and restores a checkpoint", async (t) => {
  const { files, project, session } = await setup(t);
  await fs.writeFile(path.join(project, "a.ts"), "one\r\ntwo\r\n");
  const read = await files.read(session, { path: "a.ts" });
  const edit = await files.edit(session, {
    path: "a.ts",
    oldText: "one\ntwo",
    newText: "one\nthree",
  });
  assert.equal(
    await fs.readFile(path.join(project, "a.ts"), "utf8"),
    "one\r\nthree\r\n",
  );
  await assert.rejects(
    files.write(session, {
      path: "a.ts",
      content: "stale",
      expectedHash: read.hash,
    }),
    /измен/,
  );
  assert.match((await files.changes(session))[0].patch, /three/);
  await files.restore(session, edit.checkpointId);
  assert.equal(
    await fs.readFile(path.join(project, "a.ts"), "utf8"),
    "one\r\ntwo\r\n",
  );
  assert.deepEqual(await files.changes(session), []);
});

test("project paths use native canonical roots when legacy realpath resolves a different mount alias", async (t) => {
  const { files, project, session } = await setup(t);
  await fs.writeFile(path.join(project, "inside.txt"), "mounted-root-marker");
  const syncFs = require("node:fs"), legacy = syncFs.realpathSync;
  t.mock.method(syncFs, "realpathSync", (value, ...args) =>
    path.resolve(value) === path.resolve(project)
      ? path.join(path.dirname(project), "legacy-mount-alias")
      : legacy(value, ...args));
  const read = await files.read(session, { path: "inside.txt" });
  assert.equal(read.path, "inside.txt");
  assert.equal(read.external, false);
  assert.deepEqual((await files.glob(session, {})).files, ["inside.txt"]);
  assert.equal((await files.grep(session, { pattern: "mounted-root-marker" })).matches[0].path, "inside.txt");
});

test("full-file writes require the read hash and deletion patches reject stale content", async (t) => {
  const { files, project, session } = await setup(t);
  await files.write(session, { path: "a.txt", content: "original\n" });
  await assert.rejects(
    files.write(session, { path: "a.txt", content: "replace" }),
    /expectedHash/,
  );
  await fs.writeFile(path.join(project, "a.txt"), "external\n");
  await assert.rejects(
    files.patch(session, {
      patch: "--- a/a.txt\n+++ /dev/null\n@@ -1 +0,0 @@\n-original\n",
    }),
  );
  assert.equal(
    await fs.readFile(path.join(project, "a.txt"), "utf8"),
    "external\n",
  );
});
test("new files are checkpointed; outside paths and ambiguous edits fail", async (t) => {
  const { files, project, session } = await setup(t);
  const result = await files.write(session, {
    path: "src/new.ts",
    content: "x x",
  });
  await assert.rejects(
    files.edit(session, { path: "src/new.ts", oldText: "x", newText: "y" }),
    /нескольк/,
  );
  await assert.rejects(
    files.write(session, { path: "../outside", content: "x" }),
    /путь/,
  );
  await assert.rejects(
    files.write(session, { path: ".env", content: "x" }),
    /путь/,
  );
  await files.restore(session, result.checkpointId);
  assert.equal(
    await fs.stat(path.join(project, "src/new.ts")).catch(() => null),
    null,
  );
});
test("restore never overwrites a later external edit", async (t) => {
  const { files, project, session } = await setup(t);
  const result = await files.write(session, { path: "a", content: "agent" });
  await fs.writeFile(path.join(project, "a"), "user");
  await assert.rejects(files.restore(session, result.checkpointId), /измен/);
  assert.equal(await fs.readFile(path.join(project, "a"), "utf8"), "user");
});
test("glob excludes dependencies and patch applies exact file changes", async (t) => {
  const { files, session } = await setup(t);
  await files.write(session, { path: "src/a.ts", content: "old\n" });
  assert.deepEqual((await files.glob(session, { pattern: "**/*.ts" })).files, [
    "src/a.ts",
  ]);
  await files.patch(session, {
    patch: "--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n-old\n+new\n",
  });
  assert.equal(
    (await files.read(session, { path: "src/a.ts" })).content,
    "new\n",
  );
});

test("glob omits dependencies, secret files and supports brace patterns", async (t) => {
  const { files, session, project } = await setup(t);
  await fs.mkdir(path.join(project, "node_modules/pkg"), { recursive: true });
  await fs.writeFile(
    path.join(project, "node_modules/pkg/index.ts"),
    "dependency",
  );
  await fs.writeFile(path.join(project, ".env"), "secret");
  await files.write(session, { path: "src/a.ts", content: "a" });
  await files.write(session, { path: "src/b.js", content: "b" });
  assert.deepEqual(
    (await files.glob(session, { pattern: "**/*.{ts,js}" })).files,
    ["src/a.ts", "src/b.js"],
  );
  assert.deepEqual((await files.glob(session, { pattern: "**/*" })).files, [
    "src/a.ts",
    "src/b.js",
  ]);
});

test("glob includes hidden project configuration and ignored local source", async (t) => {
  const { files, session, project } = await setup(t);
  for (const file of [
    ".github/workflows/test.yml",
    ".claude/rules/code.md",
    "src/.config/settings.json",
    "local/source.ts",
  ]) {
    await fs.mkdir(path.dirname(path.join(project, file)), { recursive: true });
    await fs.writeFile(path.join(project, file), "test");
  }
  await fs.writeFile(path.join(project, ".gitignore"), "local/\n");
  assert.deepEqual((await files.glob(session, { pattern: "**/*" })).files, [
    ".claude/rules/code.md",
    ".github/workflows/test.yml",
    ".gitignore",
    "local/source.ts",
    "src/.config/settings.json",
  ]);
  assert.deepEqual((await files.glob(session, { pattern: "**/*.yml" })).files, [
    ".github/workflows/test.yml",
  ]);
  assert.deepEqual(
    (await files.glob(session, { pattern: "**/*.missing" })).files,
    [],
  );
});
