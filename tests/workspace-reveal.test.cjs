const { test } = require("node:test");
const assert = require("node:assert/strict");
const { completedReveal } = require("../electron/workspace-reveal.cjs");
const { createRevealTracker } = require("../src/workspace-reveal.ts");
const { revealPanel, emptyLayout } = require("../src/workspace-panels.ts");

test("only successful visible actions reveal their real result", () => {
  assert.deepEqual(
    completedReveal(
      "Preview",
      { operation: "navigate" },
      { url: "https://example.test/final" },
    ),
    { panel: "preview", url: "https://example.test/final" },
  );
  for (const operation of ["inspect", "logs", "click", "fill", "screenshot"])
    assert.equal(
      completedReveal(
        "Preview",
        { operation },
        { url: "https://example.test" },
      ),
      undefined,
    );
  assert.equal(
    completedReveal("Preview", { operation: "navigate" }, { isError: true }),
    undefined,
  );
  assert.equal(
    completedReveal("Bash", { background: true }, { id: "p", isError: true }),
    undefined,
  );
  assert.deepEqual(completedReveal("Bash", { background: true }, { id: "p" }), {
    panel: "terminal",
    processId: "p",
  });
  assert.equal(completedReveal("Bash", {}, { id: "p" }), undefined);
  assert.equal(
    completedReveal("FileRead", {}, { path: "README.md" }),
    undefined,
  );
  assert.deepEqual(
    completedReveal("FileRead", { show: true }, { path: "README.md" }),
    { panel: "files", path: "README.md" },
  );
  assert.deepEqual(completedReveal("FileWrite", {}, { path: "src/a.ts" }), {
    panel: "changes",
    path: "src/a.ts",
  });
  assert.deepEqual(
    completedReveal("apply_patch", {}, [{ path: "a.ts" }, { path: "b.ts" }]),
    { panel: "changes", path: "a.ts" },
  );
});

function session(id, calls) {
  return {
    id,
    messages: [{ id: "m", role: "assistant", toolRounds: [{ calls }] }],
  };
}
const call = (id, status = "complete", panel = "preview") => ({
  id,
  status,
  reveal: { panel, url: "https://example.test/" + id },
});

test("history is not replayed, live completion is consumed once and another session waits", () => {
  const tracker = createRevealTracker();
  tracker.observe([
    session("a", [call("old"), call("running", "running")]),
    session("b", []),
  ]);
  assert.deepEqual(tracker.take("a"), []);
  tracker.observe([
    session("a", [call("old"), call("running")]),
    session("b", [call("background")]),
  ]);
  assert.equal(tracker.take("a")[0].id, "a:m:running");
  assert.deepEqual(tracker.take("a"), []);
  // State changes after the user closes the panel must not reopen it.
  tracker.observe([
    session("a", [call("old"), call("running")]),
    session("b", [call("background")]),
  ]);
  assert.deepEqual(tracker.take("a"), []);
  assert.equal(tracker.take("b")[0].sessionId, "b");
  tracker.observe([
    session("a", [call("old"), call("running")]),
    session("branch", [call("old"), call("running")]),
  ]);
  assert.deepEqual(
    tracker.take("branch"),
    [],
    "branch history is not a new browser navigation",
  );
  tracker.observe([
    session("a", [
      call("next"),
      call("error", "error"),
      call("denied", "denied"),
      call("stopped", "stopped"),
    ]),
  ]);
  assert.deepEqual(
    tracker.take("a").map((e) => e.id),
    ["a:m:next"],
  );
});

test("pending actions retain only the newest target per panel in completion order", () => {
  const tracker = createRevealTracker();
  tracker.observe([]);
  tracker.observe([
    session("a", [
      call("first"),
      call("write", "complete", "changes"),
      call("last"),
    ]),
  ]);
  assert.deepEqual(
    tracker.take("a").map((e) => e.id),
    ["a:m:write", "a:m:last"],
  );
});

test("reveal opens a widget even when both slots are full and preserves the editor", () => {
  assert.deepEqual(revealPanel(emptyLayout, "preview").panels, ["preview"]);
  for (const panels of [
    ["files", "terminal"],
    ["terminal", "files"],
  ]) {
    const initial = { ...emptyLayout, panels, axis: "columns", split: 42 };
    const next = revealPanel(initial, "preview");
    assert.equal(next.panels.length, 2);
    assert.ok(next.panels.includes("files"));
    assert.ok(next.panels.includes("preview"));
    assert.equal(next.split, 42);
    assert.equal(next.axis, "columns");
    assert.equal(revealPanel(next, "preview"), next);
    assert.deepEqual(initial.panels, panels);
  }
});
