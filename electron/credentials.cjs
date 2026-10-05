const fs = require("node:fs");
const path = require("node:path");
const { atomicWrite } = require("./store.cjs");
function createCredentials(directory, crypto) {
  const file = path.join(directory, "credential.json");
  function get(endpoint) {
    if (!fs.existsSync(file)) return "";
    try {
      const record = JSON.parse(fs.readFileSync(file, "utf8"));
      return record.endpoint === endpoint
        ? crypto.decryptString(Buffer.from(record.value, "base64"))
        : "";
    } catch {
      return "";
    }
  }
  function set(endpoint, key) {
    if (typeof key !== "string" || !key.trim() || key.length > 4096)
      throw new Error("Введите ключ API");
    if (!crypto.isEncryptionAvailable())
      throw new Error("Защищённое шифрование операционной системы недоступно");
    atomicWrite(
      file,
      JSON.stringify({
        endpoint,
        value: crypto.encryptString(key.trim()).toString("base64"),
      }),
    );
  }
  function clear() {
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }
  return {
    get,
    set,
    clear,
    changeEndpoint: (before, after) => {
      if (before !== after) clear();
    },
  };
}
module.exports = { createCredentials };
