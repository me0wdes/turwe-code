// node-pty 1.1.0 publishes the macOS spawn-helper with mode 0644.
// Repair build inputs before packaging/signing, never the installed app bundle.
// Upstream: https://github.com/microsoft/node-pty/issues/850
const fs = require('node:fs');
const path = require('node:path');

if (process.platform === 'darwin') {
  const root = path.dirname(require.resolve('node-pty/package.json'));
  let found = false;
  for (const relative of [`prebuilds/darwin-${process.arch}/spawn-helper`, 'build/Release/spawn-helper', 'build/Debug/spawn-helper']) {
    const helper = path.join(root, relative);
    if (!fs.existsSync(helper)) continue;
    fs.chmodSync(helper, fs.statSync(helper).mode | 0o111);
    fs.accessSync(helper, fs.constants.X_OK);
    found = true;
    console.log(`Executable PTY helper ready: ${relative}`);
  }
  if (!found) throw new Error(`node-pty spawn-helper missing for darwin-${process.arch}`);
}
