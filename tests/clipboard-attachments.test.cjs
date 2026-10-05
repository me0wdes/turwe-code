const { test } = require("node:test");
const assert = require("node:assert/strict");
const raw = (name) => `electron application/osclipboard;format="${name}"`;
function implementation() {
  let module;
  assert.doesNotThrow(() => {
    module = require("../electron/clipboard-attachments.cjs");
  });
  return module.importClipboardAttachments;
}
const entry = (data) => ({
  types: Object.keys(data),
  getType: async (type) => data[type],
});
const source = (...entries) => ({ read: async () => entries });
const store = {
  importBytes: async (value) => value,
  importFiles: async (paths) => paths,
};
function dropPaths(paths) {
  const header = Buffer.alloc(20);
  header.writeUInt32LE(20);
  header.writeUInt32LE(1, 16);
  return Buffer.concat([
    header,
    Buffer.from(paths.join("\0") + "\0\0", "utf16le"),
  ]);
}

test("pastes image bytes with the async Electron ClipboardItem API", async () => {
  const png = Buffer.from("89504e470d0a1a0a", "hex");
  const result = await implementation()(
    source(
      entry({
        "image/png": new Blob([png]),
        "text/plain": new Blob(["alternative"]),
      }),
    ),
    store,
  );
  assert.equal(result.length, 1);
  assert.match(result[0].name, /\.png$/);
  assert.deepEqual(Buffer.from(result[0].data, "base64"), png);
});
test("copied Explorer files take priority over the clipboard thumbnail", async () => {
  const paths = ["C:\\Pictures\\кот.png", "C:\\Docs\\notes.md"];
  const result = await implementation()(
    source(
      entry({
        "image/png": new Blob(["thumbnail"]),
        [raw("CF_HDROP")]: new Blob([dropPaths(paths)]),
      }),
    ),
    store,
  );
  assert.deepEqual(result, paths);
});
test("supports FileNameW and refuses device paths", async () => {
  const read = (path) =>
    source(
      entry({
        [raw("FileNameW")]: new Blob([Buffer.from(path + "\0", "utf16le")]),
      }),
    );
  assert.deepEqual(
    await implementation()(read("C:\\Pictures\\photo.jpg"), store),
    ["C:\\Pictures\\photo.jpg"],
  );
  await assert.rejects(
    implementation()(read("\\\\.\\PhysicalDrive0"), store),
    /device/i,
  );
});
test("pastes text as a UTF-8 attachment and rejects an empty clipboard", async () => {
  const [file] = await implementation()(
    source(entry({ "text/plain": new Blob(["Привет 📎"]) })),
    store,
  );
  assert.equal(file.name, "Буфер обмена.txt");
  assert.equal(Buffer.from(file.data, "base64").toString(), "Привет 📎");
  await assert.rejects(implementation()(source(), store), /буфер/i);
});
test("does not allocate oversized clipboard images or read unrelated OS data", async () => {
  let read = false;
  const huge = {
    size: 21 * 1024 * 1024,
    arrayBuffer: async () => {
      read = true;
      return new ArrayBuffer(0);
    },
  };
  await assert.rejects(
    implementation()(source(entry({ "image/png": huge })), store),
    /20|МБ/,
  );
  assert.equal(read, false);
  await assert.rejects(
    implementation()(
      source({
        types: [raw("Ole Private Data")],
        getType: async () => {
          throw Error("Unrelated OS data was read");
        },
      }),
      store,
    ),
    /буфер/i,
  );
});
test("clipboard read and attachment processing failures propagate", async () => {
  await assert.rejects(
    implementation()(
      {
        read: async () => {
          throw Error("clipboard busy");
        },
      },
      store,
    ),
    /clipboard busy/,
  );
  await assert.rejects(
    implementation()(source(entry({ "image/png": new Blob(["broken"]) })), {
      ...store,
      importBytes: async () => {
        throw Error("damaged image");
      },
    }),
    /damaged image/,
  );
});

test("Finder file URLs import every copied file before any thumbnail", async () => {
  const entries = [
    entry({
      [raw("public.file-url")]: new Blob([
        "file:///Users/test/Pictures/%D0%BA%D0%BE%D1%82.png\0",
      ]),
      "image/png": new Blob(["thumbnail"]),
    }),
    entry({
      [raw("public.file-url")]: new Blob([
        "file:///Users/test/Notes/plan%20one.md",
      ]),
    }),
  ];
  const result = await implementation()(source(...entries), store, {
    platform: "darwin",
  });
  assert.deepEqual(result, [
    "/Users/test/Pictures/кот.png",
    "/Users/test/Notes/plan one.md",
  ]);
});

test("URI lists preserve platform paths and reject remote or malformed local Mac URLs", async () => {
  const read = (text) => source(entry({ "text/uri-list": new Blob([text]) }));
  assert.deepEqual(
    await implementation()(
      read("# comment\n  file:///Users/test/a%20b.txt\n"),
      store,
      { platform: "darwin" },
    ),
    ["/Users/test/a b.txt"],
  );
  assert.deepEqual(
    await implementation()(read("file:///C:/Users/test/a.txt"), store, {
      platform: "win32",
    }),
    ["C:\\Users\\test\\a.txt"],
  );
  await assert.rejects(
    implementation()(read("file://server/secret"), store, {
      platform: "darwin",
    }),
  );
  await assert.rejects(
    implementation()(read("file:///Users/test/a%00b"), store, {
      platform: "darwin",
    }),
    /путь/,
  );
});

test("the file clipboard limit covers all Finder items and duplicate representations are ignored", async () => {
  const item = (index) =>
    entry({
      [raw("public.file-url")]: new Blob([`file:///Users/test/${index}.txt`]),
    });
  await assert.rejects(
    implementation()(
      source(...Array.from({ length: 9 }, (_, i) => item(i))),
      store,
      { platform: "darwin" },
    ),
    /8/,
  );
  assert.deepEqual(
    await implementation()(source(item(1), item(1), item(2)), store, {
      platform: "darwin",
    }),
    ["/Users/test/1.txt", "/Users/test/2.txt"],
  );
});
