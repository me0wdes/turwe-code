const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { listFiles, readProjectFile, openProjectFolder } = require("../electron/files.cjs");
async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "turwe-files-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const root = path.join(dir, "project");
  await fs.mkdir(root);
  return { dir, root };
}
test("lists directories first and reads UTF-8 selected text", async (t) => {
  const { root } = await fixture(t);
  await fs.mkdir(path.join(root, "src"));
  await fs.writeFile(path.join(root, "a.txt"), "Привет");
  assert.equal((await listFiles(root, ""))[0].name, "src");
  assert.equal((await readProjectFile(root, "a.txt")).content, "Привет");
});

test("Explorer receives the selected project folder, including spaces", async (t) => {
  const { root } = await fixture(t);
  const selected = path.join(root, "Проект с пробелами");
  await fs.mkdir(selected);
  const opened = [];
  await openProjectFolder(selected, async (folder) => { opened.push(folder); return ""; });
  assert.deepEqual(opened, [await fs.realpath(selected)]);
});

test("Explorer does not open missing folders, relative paths or regular files", async (t) => {
  const { root } = await fixture(t);
  const file = path.join(root, "not-a-project.exe");
  await fs.writeFile(file, "not executable");
  let opens = 0;
  const open = async () => { opens++; return ""; };
  for (const selected of [path.join(root, "missing"), file, ".", "", null])
    await assert.rejects(openProjectFolder(selected, open), /Папка проекта/);
  assert.equal(opens, 0);
});

test("Explorer launch errors are surfaced to the caller", async (t) => {
  const { root } = await fixture(t);
  await assert.rejects(openProjectFolder(root, async () => "Failed to open path"), /Не удалось открыть/);
});
test("rejects parent traversal and absolute paths", async (t) => {
  const { root, dir } = await fixture(t);
  await fs.writeFile(path.join(dir, "secret.txt"), "secret");
  await assert.rejects(readProjectFile(root, "../secret.txt"));
  await assert.rejects(readProjectFile(root, path.join(dir, "secret.txt")));
});
test("rejects junction escape from selected project", async (t) => {
  const { root, dir } = await fixture(t);
  const outside = path.join(dir, "outside");
  await fs.mkdir(outside);
  await fs.writeFile(path.join(outside, "secret.txt"), "secret");
  await fs.symlink(
    outside,
    path.join(root, "link"),
    process.platform === "win32" ? "junction" : "dir",
  );
  await assert.rejects(readProjectFile(root, "link/secret.txt"));
});
test("does not list secrets or read binaries and oversized files", async (t) => {
  const { root } = await fixture(t);
  await fs.writeFile(path.join(root, ".env"), "KEY=secret");
  await fs.writeFile(path.join(root, "binary.dat"), Buffer.from([0, 1, 2]));
  await fs.writeFile(path.join(root, "big.txt"), "a".repeat(524289));
  assert.ok(!(await listFiles(root, "")).some((x) => x.name === ".env"));
  await assert.rejects(readProjectFile(root, ".env"));
  await assert.rejects(readProjectFile(root, "binary.dat"));
  await assert.rejects(readProjectFile(root, "big.txt"));
});
