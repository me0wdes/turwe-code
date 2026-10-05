const MAX_BYTES = 1024 * 1024;
const MAX_FILES = 8;
const MAX_PATH = 32767;
const HEADER_BYTES = 20;

function invalid(message = "Invalid or truncated Windows clipboard file list") {
  throw new Error(message);
}

function validateWindowsPath(value) {
  if (!value || value.length > MAX_PATH) invalid("Clipboard file path exceeds the length limit");
  let candidate = value;
  // Permit long drive/UNC file paths, but never Windows device namespaces.
  if (candidate.startsWith("\\\\?\\")) {
    if (/^\\\\\?\\UNC\\/i.test(candidate)) candidate = "\\\\" + candidate.slice(8);
    else if (/^\\\\\?\\[a-z]:\\/i.test(candidate)) candidate = candidate.slice(4);
    else invalid("Clipboard contains a device path");
  }
  if (candidate.startsWith("\\\\.\\")) invalid("Clipboard contains a device path");
  const normalized = candidate.replaceAll("/", "\\");
  const drive = /^[a-z]:\\/i.test(normalized);
  if (!drive && !/^\\\\[^\\]+\\[^\\]+(?:\\|$)/.test(normalized)) invalid("Clipboard file paths must be absolute Windows paths");
  const rest = drive ? normalized.slice(2) : normalized;
  if (/[\x00-\x1f\x7f<>:"|?*]/.test(rest) || normalized.split("\\").some((part) => part === "." || part === "..")) invalid("Clipboard contains an invalid Windows file path");
  return value;
}

/**
 * Decode the payload for native Windows clipboard format CF_HDROP (ID 15).
 * This does not discover or read the clipboard. Electron's format-string
 * mapping must be verified by the caller; FileNameW is a different, single-path
 * format and cannot be passed to this parser.
 *
 * Modern Shell payloads use UTF-16. ANSI payloads contain no code-page marker;
 * without an explicit known encoding, only ASCII paths can be decoded safely.
 * See https://learn.microsoft.com/en-us/windows/win32/shell/clipboard#cf_hdrop
 */
function parseDropFiles(buffer, { ansiEncoding } = {}) {
  if (!Buffer.isBuffer(buffer)) invalid("Clipboard file list must be a Buffer");
  if (buffer.length > MAX_BYTES) invalid("Clipboard file list exceeds the size limit");
  if (buffer.length < HEADER_BYTES) invalid();
  const offset = buffer.readUInt32LE(0);
  const wideFlag = buffer.readUInt32LE(16);
  if (wideFlag !== 0 && wideFlag !== 1) invalid();
  const width = wideFlag ? 2 : 1;
  if (offset < HEADER_BYTES || offset > buffer.length - 2 * width || (wideFlag && offset % 2)) invalid();

  const names = [];
  const unitAt = (position) => wideFlag ? buffer.readUInt16LE(position) : buffer[position];
  let start = offset;
  for (let position = offset; position + width <= buffer.length; position += width) {
    if (unitAt(position) !== 0) continue;
    if (position === start) {
      // After a path's terminator this is the required second NUL. An empty
      // list also requires two NULs, rather than a single truncated character.
      if (!names.length && (position + 2 * width > buffer.length || unitAt(position + width) !== 0)) invalid();
      return names;
    }
    if (names.length === MAX_FILES) invalid("Choose up to 8 files from the clipboard");
    const bytes = buffer.subarray(start, position);
    if (bytes.length > MAX_PATH * (wideFlag ? 2 : 4)) invalid("Clipboard file path exceeds the length limit");
    let name;
    if (wideFlag) {
      try { name = new TextDecoder("utf-16le", { fatal: true, ignoreBOM: true }).decode(bytes); }
      catch { invalid("Clipboard contains malformed UTF-16 file names"); }
    } else if (ansiEncoding) {
      try { name = new TextDecoder(ansiEncoding, { fatal: true, ignoreBOM: true }).decode(bytes); }
      catch { invalid("Clipboard ANSI file-name encoding is invalid or unsupported"); }
    } else {
      if (bytes.some((byte) => byte > 0x7f)) invalid("Non-ASCII ANSI clipboard paths require a known code page; copy the files as Unicode");
      name = bytes.toString("ascii");
    }
    names.push(validateWindowsPath(name));
    start = position + width;
  }
  invalid();
}

module.exports = { parseDropFiles, validateWindowsPath };
