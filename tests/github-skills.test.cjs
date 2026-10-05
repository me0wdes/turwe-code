const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { createHash } = require("node:crypto");
const { createStore } = require("../electron/store.cjs");
const { upsertSkill, resolveSkills } = require("../electron/skills.cjs");
const { createGithubInstaller } = require("../electron/github-skills.cjs");

const REVISION = "a".repeat(40);
const TREE = "b".repeat(40);
const ROOT = "https://github.com/acme/skills";
const source = (name = "review", body = "Review the supplied work.", extra = "") =>
  `---\nname: ${name}\n${extra}---\n${body}`;
const json = (value, status = 200, headers = {}) =>
  new Response(JSON.stringify(value), { status, headers });
const hash = (content) =>
  createHash("sha1")
    .update(`blob ${content.length}\0`)
    .update(content)
    .digest("hex");

function fixture(t, files = { "SKILL.md": source() }, options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "turwe-github-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = createStore(dir);
  const calls = [];
  const entries = [];
  const blobs = new Map();
  for (const [file, input] of Object.entries(files)) {
    const content = Buffer.isBuffer(input) ? input : Buffer.from(input);
    const sha = hash(content);
    entries.push({ path: file, type: "blob", mode: "100644", sha, size: content.length });
    blobs.set(sha, { sha, size: content.length, encoding: "base64", content: content.toString("base64") });
  }
  const fetchImpl = async (input, init) => {
    const url = new URL(input);
    calls.push({ url: url.href, init });
    assert.equal(url.origin, "https://api.github.com");
    const key = url.pathname + url.search;
    if (options.respond) {
      const response = await options.respond(key, init, { entries, blobs, calls });
      if (response) return response;
    }
    if (key === "/repos/acme/skills")
      return json({ private: false, default_branch: "main" });
    if (key === `/repos/acme/skills/commits/${encodeURIComponent(options.ref || "main")}` ||
      key === `/repos/acme/skills/commits/${REVISION}`)
      return json({ sha: REVISION, commit: { tree: { sha: TREE } } });
    if (key === `/repos/acme/skills/git/trees/${TREE}?recursive=1`)
      return json({ sha: TREE, tree: entries, truncated: false });
    const sha = key.match(/^\/repos\/acme\/skills\/git\/blobs\/([a-f0-9]{40})$/)?.[1];
    if (blobs.has(sha)) return json(blobs.get(sha));
    return json({ message: "Not Found" }, 404);
  };
  return { dir, store, calls, entries, blobs, installer: createGithubInstaller({ store, fetchImpl }) };
}

test("repository inspection lists all skill paths at one immutable revision", async (t) => {
  const { installer, calls } = fixture(t, {
    "skills/writing/SKILL.md": source("writing"),
    "skills/review/SKILL.md": source(),
    "README.md": "Repository notes",
  });
  const result = await installer.inspect(ROOT);
  assert.deepEqual(result, {
    url: ROOT,
    repo: "acme/skills",
    ref: "main",
    revision: REVISION,
    candidates: [
      { path: "skills/review/SKILL.md", name: "review" },
      { path: "skills/writing/SKILL.md", name: "writing" },
    ],
  });
  assert.equal(calls.some((call) => call.url.includes("/git/blobs/")), false);
});

test("sole root skill installs globally with pinned source and supports explicit mentions", async (t) => {
  const { installer, store, dir, calls } = fixture(t);
  const result = await installer.install({ url: ROOT });
  assert.equal(result.name, "review");
  assert.equal(result.projectId, null);
  assert.deepEqual(result.unsupported, []);
  assert.equal(result.sourceUrl, `${ROOT}/blob/${REVISION}/SKILL.md`);
  assert.equal(resolveSkills(store.state.skills, null, "@review")[0].id, result.skillId);
  assert.equal(createStore(dir).state.skills[0].sourceUrl, result.sourceUrl);
  for (const call of calls) {
    assert.equal(call.init.redirect, "error");
    assert.equal(call.init.credentials, "omit");
    assert.equal(new Headers(call.init.headers).has("authorization"), false);
  }
});

test("tree and direct SKILL.md URLs resolve branch refs containing slashes", async (t) => {
  const { installer } = fixture(t, {
    "pack/review/SKILL.md": source(),
    "other/SKILL.md": source("other"),
  }, { ref: "feature/skills" });
  const scoped = await installer.inspect(`${ROOT}/tree/feature/skills/pack`);
  assert.equal(scoped.ref, "feature/skills");
  assert.deepEqual(scoped.candidates, [{ path: "pack/review/SKILL.md", name: "review" }]);
  const result = await installer.install({ url: `${ROOT}/blob/feature/skills/pack/review/SKILL.md` });
  assert.equal(result.sourceUrl, `${ROOT}/blob/${REVISION}/pack/review/SKILL.md`);
});

test("GitHub 422 for a missing ref continues resolving the path prefix", async (t) => {
  const { installer } = fixture(t, { "pack/review/SKILL.md": source() }, {
    ref: "feature/skills",
    respond: (key) => key.includes("/commits/") && key !== "/repos/acme/skills/commits/feature%2Fskills"
      ? json({ message: "No commit found for SHA" }, 422) : null,
  });
  const result = await installer.install({ url: `${ROOT}/blob/feature/skills/pack/review/SKILL.md` });
  assert.equal(result.name, "review");
  assert.equal(result.sourceUrl, `${ROOT}/blob/${REVISION}/pack/review/SKILL.md`);
});

test("multiple candidates require an explicit repo-relative path without changing the store", async (t) => {
  const { installer, store } = fixture(t, {
    "one/SKILL.md": source("one"),
    "two/SKILL.md": source("two"),
  });
  await assert.rejects(installer.install({ url: ROOT }), (error) => {
    assert.equal(error.code, "SKILL_SELECTION_REQUIRED");
    assert.equal(error.candidates.length, 2);
    return true;
  });
  assert.deepEqual(store.state.skills, []);
  const result = await installer.install({ url: ROOT, skillPath: "two/SKILL.md" });
  assert.equal(result.name, "two");
  assert.equal(store.state.skills.length, 1);
});

test("compatible skill and selected project assignment persist together", async (t) => {
  const { installer, store, dir } = fixture(t);
  store.state.projects.push({ id: "p", name: "Project", skillIds: [] });
  const result = await installer.install({ url: ROOT, projectId: "p" });
  const saved = createStore(dir).state;
  assert.equal(result.projectId, "p");
  assert.deepEqual(saved.projects[0].skillIds, [result.skillId]);
  assert.equal(saved.skills[0].projectId, "p");
  assert.equal(resolveSkills(saved.skills, saved.projects[0], "normal question")[0].id, result.skillId);
});

test("script, command and fork metadata is imported without executing scripts", async (t) => {
  const { installer, store, calls, entries } = fixture(t, {
    "SKILL.md": source("runner", "Run !`ls` and [script](run.py).", "context: fork\nallowed-tools: Bash\n"),
    "run.py": "raise RuntimeError('never execute')",
  });
  store.state.projects.push({ id: "p", name: "Project", skillIds: [] });
  const result = await installer.install({ url: ROOT, projectId: "p" });
  assert.deepEqual(result.unsupported, []);
  assert.deepEqual(store.state.projects[0].skillIds, [result.skillId]);
  assert.equal(store.state.skills[0].fork,true);
  assert.equal(store.state.skills[0].references[0].path,'run.py');
  assert.equal(calls.some((call) => call.url.endsWith(entries[1].sha)), true);
});

test("linked text references are copied once from the selected skill directory", async (t) => {
  const { installer, store } = fixture(t, {
    "review/SKILL.md": source("review", "Read [guide](references/guide.md#intro), [again](./references/guide.md), [site](https://example.com/ignored.md) and [anchor](#local)."),
    "review/references/guide.md": "Referenced instructions",
  });
  await installer.install({ url: ROOT });
  assert.deepEqual(store.state.skills[0].references, [
    { path: "references/guide.md", content: "Referenced instructions" },
  ]);
});

test("unsafe URLs, paths and refs are rejected before any request", async (t) => {
  const { installer, calls } = fixture(t);
  for (const url of [
    "http://github.com/acme/skills", "https://github.com.evil.test/acme/skills",
    "https://user:secret@github.com/acme/skills", "https://github.com:444/acme/skills",
    `${ROOT}/tree/main/../outside`, `${ROOT}/tree/main/%2e%2e/outside`,
    `${ROOT}/tree/main/%252e%252e/outside`, `${ROOT}/tree/main/%5c..%5csecret`,
    `${ROOT}?token=secret`, `${ROOT}/blob/main/README.md`,
    `${ROOT}/tree/main~1`, `${ROOT}/tree/main%40%7B1%7D`,
  ]) await assert.rejects(installer.inspect(url));
  assert.equal(calls.length, 0);
});

test("selection cannot escape a tree URL scope or use a traversal path", async (t) => {
  const { installer, store } = fixture(t, {
    "one/SKILL.md": source("one"), "two/SKILL.md": source("two"),
  });
  await assert.rejects(installer.install({ url: `${ROOT}/tree/main/one`, skillPath: "two/SKILL.md" }));
  for (const skillPath of ["../one/SKILL.md", "/one/SKILL.md", "one\\SKILL.md", "one/%2e%2e/SKILL.md"])
    await assert.rejects(installer.install({ url: ROOT, skillPath }));
  assert.deepEqual(store.state.skills, []);
});

test("reference traversal, symlinks and missing references leave the store untouched", async (t) => {
  for (const reference of ["../secret.md", "%2e%2e/secret.md", "/secret.md", "C:/secret.md", "missing.md", "linked.md"] ) {
    const { installer, store, entries } = fixture(t, {
      "review/SKILL.md": source("review", `Read [reference](${reference}).`),
      "review/linked.md": "../secret.md",
      "secret.md": "Must not be copied",
    });
    entries.find((entry) => entry.path === "review/linked.md").mode = "120000";
    await assert.rejects(installer.install({ url: ROOT }));
    assert.deepEqual(store.state.skills, []);
  }
});

test("invalid YAML, invalid UTF-8 and binary SKILL.md never become installed skills", async (t) => {
  for (const content of ["---\nname: bad\nname: duplicate\n---\nBody", Buffer.from([0xff, 0xfe]), source("review", "text\0binary")]) {
    const { installer, store } = fixture(t, { "SKILL.md": content });
    await assert.rejects(installer.install({ url: ROOT }));
    assert.deepEqual(store.state.skills, []);
  }
});

test("existing name collisions never overwrite a saved skill", async (t) => {
  const { installer, store } = fixture(t);
  const old = upsertSkill(store, { source: source("review", "Keep my custom instructions.") });
  await assert.rejects(installer.install({ url: ROOT }), /существует/);
  assert.equal(store.state.skills.length, 1);
  assert.equal(store.state.skills[0].id, old.id);
  assert.equal(store.state.skills[0].body, "Keep my custom instructions.");
});

test("invalid project is rejected without network requests or state changes", async (t) => {
  const { installer, store, calls } = fixture(t);
  await assert.rejects(installer.install({ url: ROOT, projectId: "missing" }), /Проект/);
  await assert.rejects(installer.install({ url: ROOT, projectId: 2 }));
  assert.equal(calls.length, 0);
  assert.deepEqual(store.state.skills, []);
});

test("failed save rolls back skill and project state", async (t) => {
  const { installer, store } = fixture(t);
  store.state.projects.push({ id: "p", name: "Project", skillIds: ["existing"] });
  const before = JSON.stringify(store.state);
  store.save = () => { throw new Error("Disk full"); };
  await assert.rejects(installer.install({ url: ROOT, projectId: "p" }), /Disk full/);
  assert.equal(JSON.stringify(store.state), before);
});

test("GitHub 404, rate limit, redirect and malformed responses fail without persistence", async (t) => {
  for (const [response, code] of [
    [() => json({}, 404), "GITHUB_NOT_FOUND"],
    [() => json({ message: "secret untrusted server text" }, 403, { "x-ratelimit-remaining": "0" }), "GITHUB_RATE_LIMIT"],
    [() => json({}, 429), "GITHUB_RATE_LIMIT"],
    [() => new Response(null, { status: 302, headers: { location: "http://127.0.0.1/secret" } }), "GITHUB_REDIRECT"],
    [() => new Response("not json"), "GITHUB_RESPONSE"],
  ]) {
    const { installer, store } = fixture(t, undefined, { respond: () => response() });
    await assert.rejects(installer.install({ url: ROOT }), (error) => {
      assert.equal(error.code, code);
      assert.equal(error.message.includes("secret"), false);
      return true;
    });
    assert.deepEqual(store.state.skills, []);
  }
});

test("truncated trees and symlink SKILL.md do not produce a misleading partial selection", async (t) => {
  const truncated = fixture(t, undefined, { respond: (key, _init, { entries }) =>
    key.includes("/git/trees/") ? json({ sha: TREE, tree: entries, truncated: true }) : null,
  });
  await assert.rejects(truncated.installer.inspect(ROOT), /обрезан|слишком|лимит/i);
  const linked = fixture(t);
  linked.entries[0].mode = "120000";
  await assert.rejects(linked.installer.install({ url: ROOT }));
  assert.deepEqual(linked.store.state.skills, []);
});

test("oversized source and reference context limits are enforced before persistence", async (t) => {
  const oversized = fixture(t, { "SKILL.md": source("review", "x".repeat(64001)) });
  await assert.rejects(oversized.installer.install({ url: ROOT }), /64|больш|лимит/);
  const references = fixture(t, {
    "SKILL.md": source("review", "Read [one](one.md) and [two](two.md)."),
    "one.md": "x".repeat(100000), "two.md": "y".repeat(100000),
  });
  await assert.rejects(references.installer.install({ url: ROOT }), /лимит/);
  assert.deepEqual(references.store.state.skills, []);
});

test("streaming response size limit applies even without a Content-Length header", async (t) => {
  const { installer, store } = fixture(t, undefined, { respond: () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(9000000)); controller.close(); },
  })) });
  await assert.rejects(installer.install({ url: ROOT }), /больш|лимит/);
  assert.deepEqual(store.state.skills, []);
});

test("cancellation before and during network work leaves no imported skill", async (t) => {
  const controller = new AbortController();
  controller.abort();
  const before = fixture(t);
  await assert.rejects(before.installer.install({ url: ROOT }, { signal: controller.signal }), (error) => error.name === "AbortError");
  assert.equal(before.calls.length, 0);
  const active = new AbortController();
  const during = fixture(t, undefined, { respond: async (_key, init) => {
    active.abort();
    init.signal.throwIfAborted();
  } });
  await assert.rejects(during.installer.install({ url: ROOT }, { signal: active.signal }), (error) => error.name === "AbortError");
  assert.deepEqual(during.store.state.skills, []);
});

test("a stalled GitHub request times out and leaves the library intact", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const started = Promise.withResolvers();
  const { installer, store } = fixture(t, undefined, { respond: (_key, init) =>
    new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
      started.resolve();
    }),
  });
  const pending = installer.install({ url: ROOT });
  const rejected = assert.rejects(pending, (error) => error.code === "GITHUB_TIMEOUT");
  await started.promise;
  t.mock.timers.tick(16000);
  await rejected;
  assert.deepEqual(store.state.skills, []);
});

test("network errors do not expose sensitive transport details", async (t) => {
  const { installer, store } = fixture(t, undefined, { respond: () => {
    throw Object.assign(new Error("secret proxy credential"), { code: 42 });
  } });
  await assert.rejects(installer.install({ url: ROOT }), (error) => {
    assert.equal(error.code, "GITHUB_NETWORK");
    assert.equal(error.message.includes("secret"), false);
    return true;
  });
  assert.deepEqual(store.state.skills, []);
});

test("API blob URLs are ignored and mismatched blob content is rejected", async (t) => {
  const { installer, store, entries, blobs } = fixture(t);
  entries[0].url = "http://127.0.0.1/secrets";
  const payload = blobs.get(entries[0].sha);
  payload.content = Buffer.from(source("hacker")).toString("base64");
  await assert.rejects(installer.install({ url: ROOT }), /ревиз|содержим/i);
  assert.deepEqual(store.state.skills, []);
});

test("reference count, individual size and UTF-8 limits apply before installation", async (t) => {
  const files = { "SKILL.md": source("review", Array.from({ length: 13 }, (_, i) => `[${i}](${i}.md)`).join(" ")) };
  for (let i = 0; i < 13; i++) files[`${i}.md`] = "Read me";
  const count = fixture(t, files);
  await assert.rejects(count.installer.install({ url: ROOT }), /лимит/);
  assert.deepEqual(count.store.state.skills, []);
  for (const content of ["x".repeat(128001), Buffer.from([0xff]), "text\0data"]) {
    const reference = fixture(t, { "SKILL.md": source("review", "Read [guide](guide.md)."), "guide.md": content });
    await assert.rejects(reference.installer.install({ url: ROOT }));
    assert.deepEqual(reference.store.state.skills, []);
  }
});
