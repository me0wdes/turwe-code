const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizeBrowserUrl,
  browserError,
  zoomFactor,
} = require("../electron/browser-address.cjs");
test("browser address accepts domains and local dev servers without a scheme", () => {
  assert.equal(
    normalizeBrowserUrl(" meowdes.tech/work "),
    "https://meowdes.tech/work",
  );
  assert.equal(normalizeBrowserUrl("localhost:3000"), "http://localhost:3000/");
  assert.equal(
    normalizeBrowserUrl("127.0.0.1:8181/qa"),
    "http://127.0.0.1:8181/qa",
  );
  assert.equal(
    normalizeBrowserUrl("https://example.com:8443/a?q=b#c"),
    "https://example.com:8443/a?q=b#c",
  );
  for (const value of [
    "",
    "file:///secret",
    "javascript:alert(1)",
    "data:text/html,x",
    "https://name:password@example.com",
    "not a site",
  ])
    assert.throws(() => normalizeBrowserUrl(value));
});
test("browser zoom is bounded and failures give actionable messages", () => {
  assert.equal(zoomFactor(5), 2);
  assert.equal(zoomFactor(0.1), 0.5);
  assert.equal(zoomFactor(1.100000000002), 1.1);
  assert.throws(() => zoomFactor(NaN));
  assert.throws(() => zoomFactor("1.2"));
  assert.match(browserError(-102), /подключиться/);
  assert.match(browserError(-105), /найден/);
  assert.match(browserError(-202), /защищённое/);
  assert.match(browserError(-999), /загрузить/);
});
