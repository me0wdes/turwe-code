const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { version } = require('../package.json');
const release = path.resolve(__dirname, '../release');
const expected = ['Windows.exe', 'macOS-arm64.dmg', 'macOS-arm64.zip', 'macOS-x64.dmg', 'macOS-x64.zip']
  .map(suffix => `Turwe-Code-${version}-${suffix}`);
const sums = expected.map(name => {
  const file = path.join(release, name);
  if (!fs.existsSync(file) || fs.statSync(file).size < 1000000) throw new Error(`Missing or incomplete release asset: ${name}`);
  return `${createHash('sha256').update(fs.readFileSync(file)).digest('hex')}  ${name}`;
});
fs.writeFileSync(path.join(release, 'SHA256SUMS.txt'), sums.join('\n') + '\n');
console.log(`Verified ${expected.length} installers/archives for ${version}`);
