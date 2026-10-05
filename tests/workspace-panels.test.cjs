const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  emptyLayout,
  readPanelLayout,
  addPanel,
  dockPanel,
  dockSide,
} = require("../src/workspace-panels.ts");

test("persisted panel layouts ignore unknown or duplicate plugins and invalid sizes", () => {
  assert.deepEqual(readPanelLayout(null), emptyLayout);
  assert.deepEqual(
    readPanelLayout({
      panels: ["files", "files", "obsolete", "preview", "terminal"],
      axis: "bad",
      width: Infinity,
      split: -40,
    }),
    {
      panels: ["files", "preview"],
      axis: "rows",
      width: 560,
      split: 25,
    },
  );
  assert.deepEqual(
    readPanelLayout({ panels: "files", width: 99999, split: NaN }),
    {
      panels: [],
      axis: "rows",
      width: 1600,
      split: 50,
    },
  );
});

test("adding a panel cannot duplicate a native preview or exceed the two-panel limit", () => {
  const first = addPanel(emptyLayout, "preview");
  assert.equal(addPanel(first, "preview"), first);
  const two = addPanel(first, "terminal");
  assert.equal(addPanel(two, "files"), two);
  assert.deepEqual(emptyLayout.panels, []);
});

test("snapping keeps both panel identities while selecting order and split direction", () => {
  const initial = { ...emptyLayout, panels: ["files", "terminal"] };
  const top = dockPanel(initial, "terminal", "top");
  assert.deepEqual(top.panels, ["terminal", "files"]);
  assert.equal(top.axis, "rows");
  const right = dockPanel(top, "terminal", "right");
  assert.deepEqual(right.panels, ["files", "terminal"]);
  assert.equal(right.axis, "columns");
  assert.ok(right.width >= 660);
  assert.equal(dockPanel(initial, "preview", "left"), initial);
  assert.deepEqual(initial.panels, ["files", "terminal"]);
});

test("dropping outside cancels; narrow layouts snap only vertically", () => {
  assert.equal(dockSide(-0.01, 0.5), null);
  assert.equal(dockSide(0.5, 1.01), null);
  assert.equal(dockSide(0.05, 0.5), "left");
  assert.equal(dockSide(0.95, 0.5), "right");
  assert.equal(dockSide(0.5, 0.1), "top");
  assert.equal(dockSide(0.5, 0.9), "bottom");
  assert.equal(dockSide(0.95, 0.1, false), "top");
  assert.equal(dockSide(0.05, 0.9, false), "bottom");
});
