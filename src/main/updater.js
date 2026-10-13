'use strict';

// In-app updates from GitHub Releases, with no dependency. The check asks the GitHub API for the
// latest published release and compares version numbers; nothing else leaves the computer. A
// download only starts when the user asks for it, is checked against the SHA-256 that GitHub (or
// the release's SHA256SUMS.txt) lists for it, and is installed the way this copy was installed:
//
//   nsis      Windows installer: run the new Setup silently after quitting; it restarts the app.
//   portable  Windows portable .exe: a hidden PowerShell helper swaps the file once we've exited.
//   mac       macOS .app in a writable folder: a shell helper swaps the bundle from the .zip.
//   mac-dmg   macOS run from the disk image or a read-only folder: open the new .dmg instead.
//   appimage  Linux AppImage: replace the file in place and relaunch.
//   deb       Linux .deb in /opt/OpenStickies: install with pkexec, then relaunch.
//   manual    Anything else (and dev builds): point at the release page.

const { app, net, shell } = require('electron');
const { EventEmitter } = require('events');
const { spawn } = require('child_process');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

const REPO = 'ItsCetla/OpenStickies';
const API = `https://api.github.com/repos/${REPO}/releases/latest`;
const RELEASES_PAGE = `https://github.com/${REPO}/releases`;
const FIRST_CHECK_MS = 60 * 1000;
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 20 * 1000;

// '4.1.0', 'v4.1.0-beta.2' → { nums: [4, 1, 0], pre: 'beta.2' }
function parseVersion(v) {
  const m = /^v?(\d+(?:\.\d+)*)(?:-([0-9A-Za-z.-]+))?/.exec(String(v || '').trim());
  if (!m) return null;
  return { nums: m[1].split('.').map(Number), pre: m[2] || '' };
}

// > 0 when a is newer than b. A full release beats a prerelease of the same number.
function compareVersions(a, b) {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (!x || !y) return 0;
  for (let i = 0; i < Math.max(x.nums.length, y.nums.length); i++) {
    const d = (x.nums[i] || 0) - (y.nums[i] || 0);
    if (d) return d;
  }
  if (x.pre === y.pre) return 0;
  if (!x.pre) return 1;
  if (!y.pre) return -1;
  return x.pre.localeCompare(y.pre, 'en', { numeric: true });
}

function writable(dir) {
  try { fs.accessSync(dir, fs.constants.W_OK); return true; } catch { return false; }
}

// How this copy was installed, which decides which file to download and how to put it in place.
function detectInstall() {
  const arch = process.arch === 'x64' && app.runningUnderARM64Translation ? 'arm64' : process.arch;
  if (!app.isPackaged) return { kind: 'dev', arch };
  if (process.platform === 'win32') {
    const portable = process.env.PORTABLE_EXECUTABLE_FILE;
    return portable ? { kind: 'portable', arch, target: portable } : { kind: 'nsis', arch };
  }
  if (process.platform === 'darwin') {
    const bundle = path.resolve(process.execPath, '../../..');
    if (!bundle.endsWith('.app')) return { kind: 'manual', arch };
    const readOnly = bundle.includes('/AppTranslocation/') || bundle.startsWith('/Volumes/')
      || !writable(bundle) || !writable(path.dirname(bundle));
    return { kind: readOnly ? 'mac-dmg' : 'mac', arch, target: bundle };
  }
  if (process.platform === 'linux') {
    if (process.env.APPIMAGE) return { kind: 'appimage', arch, target: process.env.APPIMAGE };
    if (process.execPath.startsWith('/opt/OpenStickies/')) return { kind: 'deb', arch };
  }
  return { kind: 'manual', arch };
}

// The release file that fits this install, or null.
function pickAsset(assets, install) {
  const linuxArch = { x64: 'x86_64', arm64: 'arm64' }[install.arch];
  const debArch = { x64: 'amd64', arm64: 'arm64' }[install.arch];
  const tests = {
    nsis: (n) => /^OpenStickies-Setup-.+\.exe$/i.test(n),
    portable: (n) => /^OpenStickies-Portable-.+\.exe$/i.test(n),
    mac: (n) => n.endsWith(`-mac-${install.arch}.zip`),
    'mac-dmg': (n) => n.endsWith(`-mac-${install.arch}.dmg`),
    appimage: (n) => !!linuxArch && n.endsWith(`-linux-${linuxArch}.AppImage`),
    deb: (n) => !!debArch && n.endsWith(`_${debArch}.deb`)
  };
  const test = tests[install.kind];
  return (test && assets.find(a => test(a.name))) || null;
}

async function fetchWithTimeout(url, opts = {}, ms = REQUEST_TIMEOUT_MS) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    return await net.fetch(url, { ...opts, signal: ctl.signal, headers: { 'User-Agent': `OpenStickies/${app.getVersion()}`, ...(opts.headers || {}) } });
  } finally {
    clearTimeout(timer);
  }
}

function waitForExit(child) {
  return new Promise((resolve) => {
    let out = '';
    child.stderr?.on('data', (d) => { out += d; });
    child.on('error', (err) => resolve({ code: null, err, out }));
    child.on('close', (code) => resolve({ code, out }));
  });
}

class Updater extends EventEmitter {
  constructor({ store }) {
    super();
    this.store = store;
    this.install = detectInstall();
    this.state = { status: 'idle', current: app.getVersion(), kind: this.install.kind, latest: null, progress: 0, error: '', lastChecked: 0 };
    this.release = null; // the raw release the latest check found
    this.file = null; // the verified download, ready to install
    this.pending = null; // what to run as the app quits
    this.timer = null;
    this.workDir = path.join(app.getPath('temp'), 'OpenStickies-update');
  }

  status() { return { ...this.state, canInstall: this.canInstall() }; }

  // Whether this copy can download and install by itself (otherwise: the release page).
  canInstall() {
    if (['dev', 'manual'].includes(this.install.kind)) return false;
    return !this.release || !!pickAsset(this.release.assets || [], this.install);
  }

  set(patch) {
    Object.assign(this.state, patch);
    this.emit('changed', this.status());
  }

  // Checks a minute after launch and every few hours, while the setting is on.
  start() {
    this.removeLeftovers();
    this.reschedule();
  }

  reschedule() {
    clearTimeout(this.timer);
    this.timer = null;
    if (!this.store.settings.autoUpdateCheck) return;
    const since = Date.now() - (this.state.lastChecked || 0);
    const wait = this.state.lastChecked ? Math.max(FIRST_CHECK_MS, CHECK_EVERY_MS - since) : FIRST_CHECK_MS;
    this.timer = setTimeout(async () => {
      await this.check({ quiet: true });
      this.reschedule();
    }, wait);
    this.timer.unref?.();
  }

  stop() { clearTimeout(this.timer); this.timer = null; }

  removeLeftovers() {
    try { fs.rmSync(this.workDir, { recursive: true, force: true }); } catch { /* in use or gone */ }
  }

  async check({ quiet = false } = {}) {
    if (['checking', 'downloading', 'installing'].includes(this.state.status)) return this.status();
    if (this.state.status === 'ready') return this.status();
    const before = this.state.status === 'error' ? 'idle' : this.state.status;
    this.set({ status: 'checking', error: '' });
    try {
      const res = await fetchWithTimeout(API, { headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' } });
      if (res.status === 404) { this.release = null; this.set({ status: 'none', latest: null, lastChecked: Date.now() }); return this.status(); }
      if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
      const rel = await res.json();
      const version = String(rel.tag_name || '').replace(/^v/, '');
      if (!parseVersion(version)) throw new Error('The latest release has no version number');
      const latest = { version, url: rel.html_url || RELEASES_PAGE, publishedAt: rel.published_at || '' };
      if (compareVersions(version, app.getVersion()) > 0) {
        this.release = rel;
        this.set({ status: 'available', latest, lastChecked: Date.now() });
        this.emit('available', latest);
      } else {
        this.release = null;
        this.set({ status: 'none', latest, lastChecked: Date.now() });
      }
    } catch (err) {
      const msg = err?.name === 'AbortError' ? 'The request timed out' : (err?.message || String(err));
      console.warn('[update] check failed:', msg);
      // A failed background check shouldn't paint the settings page red.
      this.set(quiet ? { status: before } : { status: 'error', error: msg });
    }
    return this.status();
  }

  // The SHA-256 the release lists for an asset: GitHub's own digest, else SHA256SUMS.txt.
  async expectedHash(asset) {
    const m = /^sha256:([0-9a-f]{64})$/i.exec(asset.digest || '');
    if (m) return m[1].toLowerCase();
    const sums = (this.release.assets || []).find(a => a.name === 'SHA256SUMS.txt');
    if (!sums) return null;
    const res = await fetchWithTimeout(sums.browser_download_url);
    if (!res.ok) return null;
    for (const line of (await res.text()).split(/\r?\n/)) {
      const [hash, name] = line.trim().split(/\s+\*?/);
      if (name === asset.name && /^[0-9a-f]{64}$/i.test(hash)) return hash.toLowerCase();
    }
    return null;
  }

  async download() {
    if (this.state.status === 'ready') return this.status();
    if (!['available', 'error'].includes(this.state.status) || !this.release) return this.status();
    const asset = pickAsset(this.release.assets || [], this.install);
    if (!asset) { this.set({ status: 'error', error: 'This release has no download for this computer' }); return this.status(); }
    this.set({ status: 'downloading', progress: 0, error: '' });
    try {
      const expected = await this.expectedHash(asset);
      if (!expected) throw new Error('The release lists no checksum for this file');
      this.removeLeftovers();
      fs.mkdirSync(this.workDir, { recursive: true });
      const file = path.join(this.workDir, path.basename(asset.name));
      const actual = await this.fetchTo(asset.browser_download_url, file, asset.size || 0);
      if (actual !== expected) {
        fs.rmSync(file, { force: true });
        throw new Error('The download is damaged (its checksum doesn\'t match). Please try again.');
      }
      this.file = await this.prepare(file);
      this.set({ status: 'ready', progress: 1 });
    } catch (err) {
      console.error('[update] download failed:', err);
      // The release stays in hand, so downloading again retries it.
      this.set({ status: 'error', error: err?.message || String(err), progress: 0 });
    }
    return this.status();
  }

  // Streams a URL into a file, hashing on the way and reporting progress.
  async fetchTo(url, file, sizeHint) {
    const res = await net.fetch(url, { headers: { 'User-Agent': `OpenStickies/${app.getVersion()}` } });
    if (!res.ok || !res.body) throw new Error(`Download failed (${res.status})`);
    const total = Number(res.headers.get('content-length')) || sizeHint;
    const hash = crypto.createHash('sha256');
    const out = fs.createWriteStream(file);
    const reader = res.body.getReader();
    let got = 0;
    let lastEmit = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        hash.update(value);
        got += value.length;
        if (!out.write(value)) await new Promise((r) => out.once('drain', r));
        const now = Date.now();
        if (total && now - lastEmit > 150) { lastEmit = now; this.set({ progress: Math.min(0.99, got / total) }); }
      }
    } finally {
      await new Promise((resolve, reject) => { out.once('error', reject); out.end(resolve); });
    }
    return hash.digest('hex');
  }

  // Anything that can fail before quitting happens here, so "Restart to update" only quits once
  // the new version is ready to go in.
  async prepare(file) {
    if (this.install.kind !== 'mac') return file;
    const dir = path.join(this.workDir, 'unpacked');
    fs.mkdirSync(dir, { recursive: true });
    const r = await waitForExit(spawn('/usr/bin/ditto', ['-x', '-k', file, dir], { stdio: ['ignore', 'ignore', 'pipe'] }));
    if (r.code !== 0) throw new Error(`Couldn't unpack the update: ${(r.out || r.err?.message || '').trim()}`);
    const appDir = fs.readdirSync(dir).find(n => n.endsWith('.app'));
    if (!appDir) throw new Error('The update has no app inside');
    fs.rmSync(file, { force: true });
    return path.join(dir, appDir);
  }

  // Installs the downloaded update. Most kinds quit first and finish in runPendingInstall().
  async installNow() {
    if (this.state.status !== 'ready' || !this.file) return this.status();
    const kind = this.install.kind;
    try {
      if (kind === 'mac-dmg') {
        const err = await shell.openPath(this.file);
        if (err) throw new Error(err);
        this.set({ status: 'installing' });
        app.quit();
      } else if (kind === 'appimage') {
        const target = this.install.target;
        const tmp = path.join(path.dirname(target), `.OpenStickies-update-${process.pid}.AppImage`);
        fs.copyFileSync(this.file, tmp);
        fs.chmodSync(tmp, 0o755);
        fs.renameSync(tmp, target); // the running copy keeps its mounted image
        this.set({ status: 'installing' });
        app.relaunch({ execPath: target, args: [] });
        app.quit();
      } else if (kind === 'deb') {
        this.set({ status: 'installing' });
        const apt = fs.existsSync('/usr/bin/apt-get');
        const args = apt ? ['/usr/bin/apt-get', 'install', '-y', '--allow-downgrades', this.file] : ['/usr/bin/dpkg', '-i', this.file];
        const r = await waitForExit(spawn('pkexec', args, { stdio: ['ignore', 'ignore', 'pipe'] }));
        if (r.err?.code === 'ENOENT') {
          // No polkit: hand the package to the desktop's software installer.
          const err = await shell.openPath(this.file);
          if (err) throw new Error(err);
          this.set({ status: 'ready' });
          return this.status();
        }
        if (r.code === 126 || r.code === 127) { this.set({ status: 'ready' }); return this.status(); } // cancelled
        if (r.code !== 0) throw new Error(`The package didn't install: ${r.out.trim().split('\n').pop() || `exit ${r.code}`}`);
        app.relaunch();
        app.quit();
      } else if (['nsis', 'portable', 'mac'].includes(kind)) {
        this.pending = { kind, file: this.file };
        this.set({ status: 'installing' });
        app.quit();
      }
    } catch (err) {
      console.error('[update] install failed:', err);
      this.set({ status: 'ready', error: err?.message || String(err) });
    }
    return this.status();
  }

  // Called from will-quit, after the notes are saved: starts the helper that puts the new version
  // in place once this process has exited, and opens it again.
  runPendingInstall() {
    const job = this.pending;
    this.pending = null;
    if (!job) return;
    try {
      if (job.kind === 'nsis') this.runNsis(job.file);
      else if (job.kind === 'portable') this.runPortable(job.file);
      else if (job.kind === 'mac') this.runMac(job.file);
    } catch (err) {
      console.error('[update] could not start the installer:', err);
      if (job.kind === 'nsis') shell.openPath(job.file);
    }
  }

  runNsis(file) {
    // /S installs silently into the existing folder (asking for admin rights itself when the
    // first install was for all users); --force-run starts OpenStickies again afterwards.
    const child = spawn(file, ['/S', '--updated', '--force-run'], { detached: true, stdio: 'ignore' });
    child.on('error', () => shell.openPath(file));
    child.unref();
  }

  runPortable(file) {
    const current = this.install.target;
    const dir = path.dirname(current);
    const latest = this.state.latest?.version;
    // A file still called OpenStickies-Portable-<old>.exe gets the new version's name; a renamed
    // one keeps the user's name.
    const versioned = /^OpenStickies-Portable-[\w.-]+\.exe$/i.test(path.basename(current)) && latest;
    const dest = versioned ? path.join(dir, `OpenStickies-Portable-${latest}.exe`) : current;
    const script = [
      "$ErrorActionPreference = 'Stop'",
      'try { Wait-Process -Id ([int]$env:OSU_PID) -Timeout 60 -ErrorAction SilentlyContinue } catch {}',
      // The portable launcher outlives the app for a moment and keeps its .exe locked.
      '$ok = $false',
      'for ($i = 0; $i -lt 120 -and -not $ok; $i++) {',
      '  try { Copy-Item -LiteralPath $env:OSU_SRC -Destination $env:OSU_DEST -Force; $ok = $true } catch { Start-Sleep -Milliseconds 500 }',
      '}',
      'if ($ok -and $env:OSU_DEST -ne $env:OSU_OLD) {',
      '  for ($i = 0; $i -lt 60; $i++) { try { Remove-Item -LiteralPath $env:OSU_OLD -Force; break } catch { Start-Sleep -Milliseconds 500 } }',
      '}',
      'if ($ok) { Start-Process -FilePath $env:OSU_DEST } else { Start-Process -FilePath $env:OSU_OLD }',
      'Remove-Item -LiteralPath $env:OSU_WORK -Recurse -Force -ErrorAction SilentlyContinue'
    ].join('\n');
    const encoded = Buffer.from(script, 'utf16le').toString('base64');
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-EncodedCommand', encoded], {
      detached: true, stdio: 'ignore', windowsHide: true,
      env: { ...process.env, OSU_PID: String(process.pid), OSU_SRC: file, OSU_DEST: dest, OSU_OLD: current, OSU_WORK: this.workDir }
    });
    child.unref();
  }

  runMac(newApp) {
    const script = [
      'i=0',
      'while kill -0 "$OSU_PID" 2>/dev/null && [ $i -lt 300 ]; do sleep 0.2; i=$((i+1)); done',
      'BAK="$OSU_DEST.update-backup"',
      'rm -rf "$BAK"',
      'if mv "$OSU_DEST" "$BAK"; then',
      '  if /usr/bin/ditto "$OSU_SRC" "$OSU_DEST"; then rm -rf "$BAK"; else rm -rf "$OSU_DEST"; mv "$BAK" "$OSU_DEST"; fi',
      'fi',
      '/usr/bin/xattr -dr com.apple.quarantine "$OSU_DEST" 2>/dev/null',
      '/usr/bin/open "$OSU_DEST"',
      'rm -rf "$OSU_WORK"'
    ].join('\n');
    const child = spawn('/bin/sh', ['-c', script], {
      detached: true, stdio: 'ignore',
      env: { ...process.env, OSU_PID: String(process.pid), OSU_SRC: newApp, OSU_DEST: this.install.target, OSU_WORK: this.workDir }
    });
    child.unref();
  }

  releasePage() { return this.state.latest?.url || RELEASES_PAGE; }
}

module.exports = { Updater, compareVersions, parseVersion, pickAsset };
