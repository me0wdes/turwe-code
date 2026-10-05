const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createCredentials } = require("../electron/credentials.cjs");
function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "turwe-key-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const crypto = {
    isEncryptionAvailable: () => true,
    encryptString: (s) => Buffer.from(s.split("").reverse().join("")),
    decryptString: (b) => b.toString().split("").reverse().join(""),
  };
  return { dir, crypto };
}
test("encrypted credential round trips only for its configured origin", (t) => {
  const { dir, crypto } = setup(t);
  const c = createCredentials(dir, crypto);
  c.set("https://a.test/v1", "private-token");
  assert.equal(c.get("https://a.test/v1"), "private-token");
  assert.equal(c.get("https://b.test/v1"), "");
  assert.ok(
    !fs
      .readFileSync(path.join(dir, "credential.json"), "utf8")
      .includes("private-token"),
  );
  assert.equal(
    createCredentials(dir, crypto).get("https://a.test/v1"),
    "private-token",
  );
});
test("changing endpoint clears the key unless explicitly supplied", (t) => {
  const { dir, crypto } = setup(t),
    c = createCredentials(dir, crypto);
  c.set("https://a.test/v1", "token");
  c.changeEndpoint("https://a.test/v1", "https://b.test/v1");
  assert.equal(c.get("https://a.test/v1"), "");
  assert.equal(c.get("https://b.test/v1"), "");
});
test("refuses plaintext fallback when OS encryption unavailable", (t) => {
  const { dir, crypto } = setup(t);
  crypto.isEncryptionAvailable = () => false;
  assert.throws(
    () => createCredentials(dir, crypto).set("https://a.test/v1", "token"),
    /шифрован/i,
  );
  assert.ok(!fs.existsSync(path.join(dir, "credential.json")));
});
