const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const {
  parseSkill,
  importSkill,
  resolveSkills,
  upsertSkill,
  assignSkill,
} = require("../electron/skills.cjs");
test("editing a personal skill inside a project filter preserves all project assignments", (t) => {
  const { dir, store } = fixture(t);
  store.state.projects.push(
    { id: "a", name: "A", path: dir },
    { id: "b", name: "B", path: dir },
  );
  const s = upsertSkill(store, { source: source("shared") });
  assignSkill(store, "a", s.id, true);
  assignSkill(store, "b", s.id, true);
  const edited = upsertSkill(store, {
    id: s.id,
    projectId: "a",
    source: source("shared", "", "UPDATED"),
  });
  assert.equal(edited.projectId, null);
  assert.equal(
    resolveSkills(store.state.skills, store.state.projects[1], "question")[0]
      .instructions,
    "UPDATED",
  );
});
test("editing an imported script skill retains its script reference without executing it", (t) => {
  const { dir, store } = fixture(t);
  fs.writeFileSync(path.join(dir, "run.py"), "print(1)");
  fs.writeFileSync(
    path.join(dir, "SKILL.md"),
    source("runner", "", "Run [script](run.py)."),
  );
  const s = upsertSkill(store, {}, importSkill(path.join(dir, "SKILL.md")));
  const edited = upsertSkill(store, { id: s.id, source: s.source });
  assert.equal(edited.unsupported.length,0);
  assert.equal(resolveSkills(store.state.skills,null,'@runner')[0].references[0].content,'print(1)');
});
test("editing references removes obsolete context and rejects missing new reference copies", (t) => {
  const { dir, store } = fixture(t);
  fs.writeFileSync(path.join(dir, "guide.md"), "OBSOLETE CONTEXT");
  fs.writeFileSync(
    path.join(dir, "SKILL.md"),
    source("review", "", "Use [guide](guide.md)."),
  );
  const s = upsertSkill(store, {}, importSkill(path.join(dir, "SKILL.md")));
  upsertSkill(store, {
    id: s.id,
    source: source("review", "", "New instructions only"),
  });
  assert.deepEqual(
    resolveSkills(store.state.skills, null, "@review")[0].references,
    [],
  );
  assert.throws(
    () =>
      upsertSkill(store, {
        id: s.id,
        source: source("review", "", "Use [new](new.md)."),
      }),
    /импорт/,
  );
});
const { createStore } = require("../electron/store.cjs");
const source = (name, extra = "", body = "Review $ARGUMENTS carefully.") =>
  `---\nname: ${name}\ndescription: |\n  Useful instructions\n${extra}---\n${body}`;
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "turwe-skills-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return { dir, store: createStore(dir) };
}
test("YAML metadata and argument interpolation work without executing content", () => {
  const s = {
    ...parseSkill(source("review", "disable-model-invocation: true\n")),
    id: "a",
  };
  assert.equal(s.description, "Useful instructions");
  assert.equal(resolveSkills([s], { skillIds: ["a"] }, "hello").length, 0);
  const used = resolveSkills([s], { skillIds: [] }, "/review src/main.ts");
  assert.equal(used[0].instructions, "Review src/main.ts carefully.");
});
test("project assignments and explicit mentions are isolated and deduplicated", () => {
  const a = { ...parseSkill(source("alpha")), id: "a" },
    b = { ...parseSkill(source("beta")), id: "b", projectId: "other" };
  assert.equal(
    resolveSkills([a, b], { id: "own", skillIds: ["a"] }, "@alpha inspect")
      .length,
    1,
  );
  assert.equal(resolveSkills([a, b], null, "normal message").length, 0);
  assert.throws(
    () => resolveSkills([a, b], { id: "own", skillIds: [] }, "@beta inspect"),
    /доступен/,
  );
  assert.equal(
    resolveSkills(
      [a],
      null,
      "email me@example.com or https://example.test/alpha",
    ).length,
    0,
  );
});
test("non user-invocable, unknown and unsupported invocations fail clearly", () => {
  const hidden = {
    ...parseSkill(source("hidden", "user-invocable: false\n")),
    id: "h",
  };
  assert.throws(() => resolveSkills([hidden], null, "/hidden"), /вызов/);
  assert.throws(() => resolveSkills([], null, "/missing test"), /найден/);
  const fork = { ...parseSkill(source("fork", "context: fork\n")), id: "f" };
  assert.equal(resolveSkills([fork], null, "@fork")[0].fork,true);
  assert.throws(() => parseSkill(source("bad", "name: duplicate\n")), /YAML/);
});
test("import includes bounded local references, rejects traversal and leaves source untouched", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "turwe-import-"));
  try {
    fs.writeFileSync(path.join(dir, "guide.md"), "Reference content");
    fs.writeFileSync(
      path.join(dir, "SKILL.md"),
      source("review", "", "Read [guide](guide.md)."),
    );
    const s = importSkill(path.join(dir, "SKILL.md"));
    assert.match(s.references[0].content, /Reference content/);
    fs.writeFileSync(
      path.join(dir, "SKILL.md"),
      source("review", "", "Read [bad](../outside.md)."),
    );
    assert.throws(() => importSkill(path.join(dir, "SKILL.md")), /папк/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
test("library persists, names cannot collide, assignments validate scope", (t) => {
  const { dir, store } = fixture(t);
  store.state.projects.push({ id: "p", name: "Project", path: dir });
  const skill = upsertSkill(store, { source: source("review") });
  assignSkill(store, "p", skill.id, true);
  assert.deepEqual(createStore(dir).state.projects[0].skillIds, [skill.id]);
  assert.equal(createStore(dir).state.skills[0].name, "review");
  assert.throws(
    () => upsertSkill(store, { source: source("review") }),
    /существует/,
  );
  assert.throws(() => assignSkill(store, "p", "missing", true), /найден/);
});
test("personal and project names cannot ambiguously collide in the same chat", (t) => {
  const { dir, store } = fixture(t);
  store.state.projects.push({ id: "p", name: "Project", path: dir });
  upsertSkill(store, { source: source("review") });
  assert.throws(
    () => upsertSkill(store, { source: source("review"), projectId: "p" }),
    /существует/,
  );
});
test("examples in code fences and inline code do not invoke skills", () => {
  const s = { ...parseSkill(source("review")), id: "a" };
  assert.deepEqual(
    resolveSkills(
      [s],
      null,
      "Example: `@review`\n```text\n/review sample\n```",
    ),
    [],
  );
});
