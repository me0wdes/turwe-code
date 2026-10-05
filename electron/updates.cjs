const REPOSITORY = 'me0wdes/turwe-code';
const RELEASES_URL = `https://github.com/${REPOSITORY}/releases`;
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function newer(a, b) {
  if (!VERSION.test(a) || !VERSION.test(b)) return false;
  const left = a.split('.').map(Number), right = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return left[i] > right[i];
  return false;
}

function selectRelease(release, currentVersion, platform, arch) {
  const version = String(release?.tag_name || '').replace(/^v/, '');
  if (release?.draft || release?.prerelease || !newer(version, currentVersion)) return null;
  const suffix = platform === 'win32' && arch === 'x64' ? 'Windows.exe'
    : platform === 'darwin' && ['arm64', 'x64'].includes(arch) ? `macOS-${arch}.dmg` : '';
  if (!suffix) return null;
  const name = `Turwe-Code-${version}-${suffix}`;
  const downloadUrl = `${RELEASES_URL}/download/v${version}/${name}`;
  // Match the complete URL, not just a host/prefix supplied by the server.
  const asset = release.assets?.find(a => a.name === name && a.browser_download_url === downloadUrl);
  return asset ? { version, downloadUrl, releaseUrl: `${RELEASES_URL}/tag/v${version}` } : null;
}

function createUpdateChecker({ version, platform = process.platform, arch = process.arch,
  fetch: request = globalThis.fetch, openExternal, onChange = () => {} }) {
  let value = { status: 'idle', currentVersion: version, releaseUrl: RELEASES_URL };
  let pending, startup, interval, controller, closed = false;
  const state = () => ({ ...value });
  const set = patch => { if (!closed) { value = { ...value, ...patch }; onChange(state()); } };
  async function performCheck() {
    set({ status: 'checking', error: '' });
    controller = new AbortController();
    const timeout = setTimeout(() => controller?.abort(), 15000);
    timeout.unref?.();
    try {
      const response = await request(`https://api.github.com/repos/${REPOSITORY}/releases/latest`, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': `Turwe-Code/${version}` },
        signal: controller.signal,
      });
      if (response.status === 404) set({ status: 'unpublished', checkedAt: Date.now() });
      else {
        if (!response.ok) throw new Error('Release service unavailable');
        const release = await response.json();
        if (!release || typeof release.tag_name !== 'string') throw new Error('Invalid release');
        const update = selectRelease(release, version, platform, arch);
        set(update ? { ...update, status: 'available', checkedAt: Date.now() }
          : { status: newer(release.tag_name.replace(/^v/, ''), version) ? 'unavailable' : 'current', checkedAt: Date.now() });
      }
    } catch {
      set({ status: 'error', error: 'Не удалось проверить обновления. Проверьте интернет и попробуйте ещё раз.' });
    } finally { clearTimeout(timeout); controller = null; }
    return state();
  }
  function check() {
    if (closed) return Promise.resolve(state());
    if (!pending) pending = performCheck().finally(() => { pending = null; });
    return pending;
  }
  return {
    state, check,
    start() {
      if (closed || startup || interval) return;
      startup = setTimeout(() => { startup = null; void check(); }, 15000);
      interval = setInterval(() => void check(), 6 * 60 * 60 * 1000);
      startup.unref?.(); interval.unref?.();
    },
    async openDownload() {
      if (value.status !== 'available' || !value.downloadUrl) throw new Error('Сначала проверьте наличие обновления.');
      await openExternal(value.downloadUrl);
    },
    close() { closed = true; clearTimeout(startup); clearInterval(interval); controller?.abort(); },
  };
}
module.exports = { createUpdateChecker, selectRelease, REPOSITORY };
