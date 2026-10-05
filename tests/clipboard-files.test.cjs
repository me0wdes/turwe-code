const { test } = require("node:test");
const assert = require("node:assert/strict");

function parse(buffer, options) {
  let implementation;
  assert.doesNotThrow(() => { implementation = require("../electron/clipboard-files.cjs"); }, "clipboard file parser is available");
  return implementation.parseDropFiles(buffer, options);
}
function dropFiles(names, { wide = true, offset = 20, encoding = "utf16le" } = {}) {
  const payload = Buffer.from(names.join("\0") + "\0\0", wide ? "utf16le" : encoding);
  const header = Buffer.alloc(offset);
  header.writeUInt32LE(offset, 0);
  header.writeInt32LE(120, 4);
  header.writeInt32LE(-40, 8);
  header.writeUInt32LE(wide ? 1 : 0, 16);
  return Buffer.concat([header, payload]);
}

test("parses all Unicode paths in a padded Windows DROPFILES list", () => {
  const names = ["C:\\Проекты\\отчёт.docx", "D:\\Images\\📎 photo.png", "\\\\server\\share\\video.mp4"];
  assert.deepEqual(parse(dropFiles(names, { offset: 24 })), names);
});

test("parses ANSI ASCII names and explicitly encoded non-ASCII names", () => {
  assert.deepEqual(parse(dropFiles(["C:\\Code\\go.mod", "D:\\Docs\\notes.txt"], { wide: false, encoding: "ascii" })), ["C:\\Code\\go.mod", "D:\\Docs\\notes.txt"]);
  const encoded = dropFiles(["C:\\Docs\\caf\u00e9.txt"], { wide: false, encoding: "latin1" });
  assert.throws(() => parse(encoded), /ANSI|encoding|code page/i);
  assert.deepEqual(parse(encoded, { ansiEncoding: "windows-1252" }), ["C:\\Docs\\café.txt"]);
});

test("returns an empty list and accepts exactly eight absolute Windows paths", () => {
  assert.deepEqual(parse(dropFiles([])), []);
  const names = Array.from({ length: 8 }, (_, index) => `C:\\files\\${index}.txt`);
  assert.deepEqual(parse(dropFiles(names)), names);
  assert.throws(() => parse(dropFiles([...names, "C:\\files\\ninth.txt"])), /8|eight/i);
});

test("rejects invalid offsets, truncated headers and missing double terminators", () => {
  const valid = dropFiles(["C:\\files\\one.txt"]);
  for (const offset of [0, 4, 19, 21, valid.length, 0xffffffff]) {
    const damaged = Buffer.from(valid);
    damaged.writeUInt32LE(offset, 0);
    assert.throws(() => parse(damaged), `offset ${offset}`);
  }
  for (const buffer of [Buffer.alloc(0), Buffer.alloc(19), valid.subarray(0, valid.length - 1), valid.subarray(0, valid.length - 2), valid.subarray(0, 24)]) assert.throws(() => parse(buffer));
});

test("rejects malformed UTF-16, relative paths and device or alternate-stream paths", () => {
  const malformed = dropFiles(["C:\\files\\x.txt"]);
  malformed.writeUInt16LE(0xd800, 20 + 2 * "C:\\files\\".length);
  assert.throws(() => parse(malformed));
  for (const name of ["relative.txt", "C:relative.txt", "\\rooted.txt", "/unix.txt", "\\\\server", "\\\\.\\PhysicalDrive0", "\\\\?\\GLOBALROOT\\Device\\x", "C:\\file.txt:secret", "C:\\folder\\..\\file.txt", "C:\\bad\nname.txt"]) assert.throws(() => parse(dropFiles([name])), name);
});

test("preserves supported extended Windows drive and UNC paths", () => {
  const names = ["\\\\?\\C:\\files\\long.txt", "\\\\?\\UNC\\server\\share\\wide.txt"];
  assert.deepEqual(parse(dropFiles(names)), names);
});

test("bounds clipboard bytes and individual path lengths", () => {
  assert.throws(() => parse(Buffer.alloc(1024 * 1024 + 1)), /large|limit/i);
  assert.throws(() => parse(dropFiles(["C:\\" + "x".repeat(32768)])), /long|limit/i);
  assert.throws(() => parse("not a buffer"));
});
