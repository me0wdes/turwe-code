const test = require('node:test');
const assert = require('node:assert/strict');
const { selectRelease, createUpdateChecker, REPOSITORY } = require('../electron/updates.cjs');

function release(version = '0.6.17') {
  return { tag_name: `v${version}`, html_url: `https://github.com/${REPOSITORY}/releases/tag/v${version}`,
    assets: ['Windows.exe', 'macOS-arm64.dmg', 'macOS-x64.dmg'].map(suffix => ({
      name: `Turwe-Code-${version}-${suffix}`,
      browser_download_url: `https://github.com/${REPOSITORY}/releases/download/v${version}/Turwe-Code-${version}-${suffix}`,
    })) };
}
test('selects the exact platform and architecture, never a source ZIP', () => {
  for (const [platform, arch, suffix] of [['win32','x64','Windows.exe'],['darwin','arm64','macOS-arm64.dmg'],['darwin','x64','macOS-x64.dmg']]) {
    assert.ok(selectRelease(release(), '0.6.16', platform, arch).downloadUrl.endsWith(suffix));
  }
  assert.equal(selectRelease(release(), '0.6.16', 'win32', 'arm64'), null);
});
test('compares numeric versions and rejects old, draft, prerelease and incomplete releases', () => {
  assert.ok(selectRelease(release('0.6.100'), '0.6.99', 'win32', 'x64'));
  for (const value of [release('0.6.16'), release('0.6.2'), {...release(), draft:true}, {...release(), prerelease:true}, release('0.7.0-beta.1'), {...release(), assets:[]}]) {
    assert.equal(selectRelease(value, '0.6.16', 'win32', 'x64'), null);
  }
});
test('untrusted release data cannot open an arbitrary URL or a different repository', () => {
  for (const url of ['file:///tmp/installer.exe', 'https://evil.invalid/a.exe', `https://github.com/${REPOSITORY}-evil/releases/download/v0.6.17/a.exe`, `https://github.com/${REPOSITORY}/releases/download/v0.6.17/../other.exe`]) {
    const r = release(); r.assets[0].browser_download_url = url;
    assert.equal(selectRelease(r, '0.6.16', 'win32', 'x64'), null);
  }
});
test('coalesces concurrent requests, opens only a checked asset and reports offline errors honestly', async () => {
  let requests = 0, opened = '', fail = false;
  const checker = createUpdateChecker({ version:'0.6.16', platform:'darwin', arch:'arm64',
    fetch: async () => { requests++; await new Promise(r=>setTimeout(r,5)); if(fail) throw new Error('offline'); return {ok:true, json:async()=>release()}; },
    openExternal:async url=>{opened=url;}, onChange:()=>{} });
  await assert.rejects(checker.openDownload(), /Сначала/);
  await Promise.all([checker.check(),checker.check()]);
  assert.equal(requests,1); assert.equal(checker.state().status,'available');
  await checker.openDownload(); assert.ok(opened.endsWith('macOS-arm64.dmg'));
  fail=true; await checker.check();
  assert.equal(checker.state().status,'error');
  assert.match(checker.state().error,/проверить/);
  fail=false; await checker.check(); assert.equal(checker.state().status,'available');
  checker.close();
});
test('no published release and current version are distinct from network failure', async () => {
  const checker = createUpdateChecker({version:'0.6.17',platform:'win32',arch:'x64',fetch:async()=>({ok:true,json:async()=>release()}),onChange:()=>{}});
  await checker.check(); assert.equal(checker.state().status,'current'); checker.close();
  const empty = createUpdateChecker({version:'0.6.16',platform:'win32',arch:'x64',fetch:async()=>({status:404,ok:false}),onChange:()=>{}});
  await empty.check(); assert.equal(empty.state().status,'unpublished'); empty.close();
});
