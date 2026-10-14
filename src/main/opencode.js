'use strict';

// Installs/removes the OpenStickies plugin in OpenCode's global plugin folder, keeps an installed
// copy current, and asks OpenCode 2 whether it actually loaded.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const INTEGRATIONS = path.join(__dirname, '..', 'integrations');
// Works on OpenCode 1 (named export) and OpenCode 2 (default export with id + setup).
const PLUGIN_SOURCE = path.join(INTEGRATIONS, 'opencode-plugin.js');
// OpenCode 1 before 1.18.29 trips over a default export object, so it gets the old named-export plugin.
const PLUGIN_SOURCE_V1 = path.join(INTEGRATIONS, 'opencode-plugin-v1.js');
const DEFAULT_EXPORT_SINCE = [1, 18, 29];
const VERSION_HEADER = 'openstickies-plugin-version:';
const APP_VERSION = require('../../package.json').version;

function configDir() {
  return process.env.OPENCODE_CONFIG_DIR || path.join(os.homedir(), '.config', 'opencode');
}

function pluginPath() {
  return path.join(configDir(), 'plugins', 'stickies.js');
}

function findBinary() {
  const win = process.platform === 'win32';
  const exts = win ? ['.cmd', '.exe', ''] : [''];
  const dirs = String(process.env.PATH || '').split(path.delimiter);
  // Apps started from the Dock or a desktop launcher get a short PATH without the user's shell
  // additions, so also look where the OpenCode installer and Homebrew put the binary.
  if (!win) dirs.push(path.join(os.homedir(), '.opencode', 'bin'), path.join(os.homedir(), '.local', 'bin'), '/opt/homebrew/bin', '/usr/local/bin');
  for (const dir of dirs) {
    if (!dir) continue;
    for (const ext of exts) {
      const file = path.join(dir, 'opencode' + ext);
      try { if (fs.statSync(file).isFile()) return file; } catch { /* not here */ }
    }
  }
  return null;
}

// Runs the opencode binary. npm installs a .cmd shim on Windows, which only runs through a shell.
function run(bin, args, timeout) {
  const shell = process.platform === 'win32' && /\.(cmd|bat)$/i.test(bin);
  return new Promise((resolve) => {
    execFile(shell ? `"${bin}"` : bin, args, { timeout, shell, windowsHide: true, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 },
      (err, stdout) => resolve(err ? null : String(stdout || '')));
  });
}

// The installed OpenCode's version as [major, minor, patch], or null when it can't be told.
// Remembered after the first answer; Connect asks again in case OpenCode was upgraded.
let detected; // undefined = not asked yet
async function detectVersion({ fresh = false } = {}) {
  if (detected !== undefined && !fresh) return detected;
  const bin = findBinary();
  const out = bin ? await run(bin, ['--version'], 15000) : null;
  const m = out && out.match(/(\d+)\.(\d+)\.(\d+)/);
  detected = m ? m.slice(1, 4).map(Number) : null;
  return detected;
}

const older = (a, b) => { for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] < b[i]; return false; };

// The plugin as it should be on disk for the OpenCode that is installed. An unknown version gets
// the plugin that works on both.
function rendered(version = detected) {
  const src = version && older(version, DEFAULT_EXPORT_SINCE) ? PLUGIN_SOURCE_V1 : PLUGIN_SOURCE;
  return fs.readFileSync(src, 'utf8').replace('__VERSION__', APP_VERSION);
}

function status() {
  const file = pluginPath();
  const connected = fs.existsSync(file);
  let outdated = false;
  if (connected) {
    try { outdated = fs.readFileSync(file, 'utf8') !== rendered(); } catch { outdated = false; }
  }
  const v = detected ? detected.join('.') : null;
  return { found: fs.existsSync(configDir()) || !!findBinary(), connected, outdated, path: file, version: v };
}

function write(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, rendered());
}

async function connect() {
  await detectVersion({ fresh: true });
  write(pluginPath());
  return status();
}

function disconnect() {
  fs.rmSync(pluginPath(), { force: true });
  return status();
}

// Brings an installed plugin up to date, e.g. after an OpenStickies or OpenCode upgrade. Copies from
// before plugins carried a version header (4.1.2 and older) are kept once as stickies.js.bak, in
// case someone edited theirs. Does nothing when OpenCode isn't connected.
async function heal() {
  const file = pluginPath();
  let current;
  try { current = fs.readFileSync(file, 'utf8'); } catch { return false; }
  await detectVersion();
  const want = rendered();
  if (current === want) return false;
  if (!current.includes(VERSION_HEADER)) {
    const bak = file + '.bak';
    if (!fs.existsSync(bak)) fs.writeFileSync(bak, current);
  }
  fs.writeFileSync(file, want);
  return true;
}

const samePath = (a, b) => {
  const norm = (p) => { const r = path.resolve(String(p)); return process.platform === 'win32' ? r.toLowerCase() : r; };
  return norm(a) === norm(b);
};

// Asks OpenCode 2 whether it loaded the plugin: { state: 'active' | 'failed' | ..., error }.
// null when that can't be told: OpenCode 1 has no such command, or OpenCode isn't there.
// Plugins load lazily, so an empty list is asked again a few times.
async function verify() {
  const file = pluginPath();
  if (!fs.existsSync(file)) return null;
  const v = await detectVersion();
  const bin = findBinary();
  if (!bin || (v && v[0] < 2)) return null;
  for (let attempt = 0; attempt < 5; attempt++) {
    if (attempt) await new Promise(r => setTimeout(r, 2000));
    const out = await run(bin, ['api', 'get', '/api/plugin'], 20000);
    let list;
    try { list = JSON.parse(out).data; } catch { return null; }
    if (!Array.isArray(list)) return null;
    if (!list.length) continue;
    const mine = list.find(p => p && p.source && p.source.path && samePath(p.source.path, file)) || list.find(p => p && p.id === 'openstickies');
    if (!mine) return { state: 'missing', error: null };
    const s = mine.state || {};
    return { state: s.status || 'unknown', error: s.error || null };
  }
  return null;
}

module.exports = { status, connect, disconnect, heal, verify, detectVersion, pluginPath, PLUGIN_SOURCE, PLUGIN_SOURCE_V1 };
