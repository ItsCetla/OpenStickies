'use strict';

// Regenerates the screenshots in docs/screenshots/ from the real app.
//
//   npm run screenshots                     all scenes
//   npm run screenshots -- --only=hero,tasks
//   npm run screenshots -- --keep-raw       keep the per-window captures and seeded data
//
// Each scene starts Stickies against its own throwaway data folder (your notes are never
// touched), stages the UI, and captures every window. compose.js then lays the windows out
// on a backdrop. On Linux without a display it runs under xvfb-run.

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { scenes } = require('./scenes');

const SCALE = 2.5;
const SCENE_TIMEOUT_MS = 90 * 1000;
const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(ROOT, 'docs', 'screenshots');

const flag = (name) => process.argv.find(a => a === `--${name}` || a.startsWith(`--${name}=`));
const onlyArg = flag('only');
const only = onlyArg ? onlyArg.split('=')[1].split(',').map(s => s.trim()).filter(Boolean) : null;
const keepRaw = !!flag('keep-raw');

let electronBin;
try {
  electronBin = require('electron'); // the electron package exports the path to its binary
} catch {
  console.error('Electron is not installed. Run `npm install` first.');
  process.exit(1);
}

function command(args) {
  const extra = [];
  if (process.platform === 'linux' && typeof process.getuid === 'function' && process.getuid() === 0) extra.push('--no-sandbox');
  const full = [...extra, `--force-device-scale-factor=${SCALE}`, ...args];
  if (process.platform === 'linux' && !process.env.DISPLAY) {
    const probe = spawnSync('xvfb-run', ['--help'], { stdio: 'ignore' });
    if (probe.error) {
      console.error('No display found. Install Xvfb (e.g. `sudo apt install xvfb`) or run this from a desktop session.');
      process.exit(1);
    }
    // A big virtual screen keeps every window clear of the pointer, which sits in the middle
    // and would otherwise trigger hover effects.
    return { cmd: 'xvfb-run', args: ['-a', '-s', '-screen 0 8000x5000x24', electronBin, ...full] };
  }
  return { cmd: electronBin, args: full };
}

function run(label, args) {
  const { cmd, args: full } = command(args);
  const res = spawnSync(cmd, full, { cwd: ROOT, encoding: 'utf8', timeout: SCENE_TIMEOUT_MS });
  // Chromium logs harmless GPU/D-Bus noise on Linux; only show our own messages.
  const ours = `${res.stdout || ''}${res.stderr || ''}`.split('\n').filter(l => /^(runner|compose|\s{2}\S)/.test(l));
  if (ours.length) console.log(ours.join('\n'));
  if (res.error && res.error.code === 'ETIMEDOUT') return `${label} timed out after ${SCENE_TIMEOUT_MS / 1000}s`;
  if (res.error) return `${label} failed to start: ${res.error.message}`;
  if (res.status !== 0) return `${label} exited with code ${res.status}`;
  return null;
}

const raw = fs.mkdtempSync(path.join(os.tmpdir(), 'stickies-shots-'));
const wanted = scenes.filter(s => !only || only.includes(s.name));
if (only && only.includes('social-preview') && !wanted.some(s => s.name === 'hero')) {
  wanted.push(scenes.find(s => s.name === 'hero')); // the social card reuses the hero captures
}
if (!wanted.length) {
  console.error(`No scenes match ${only.join(', ')}. Known: ${scenes.map(s => s.name).join(', ')}, social-preview`);
  process.exit(1);
}

const failures = [];
for (const scene of wanted) {
  process.stdout.write(`capturing ${scene.name}…\n`);
  const err = run(scene.name, [path.join(__dirname, 'runner.js'), `--scene=${scene.name}`, `--out=${raw}`]);
  if (err) failures.push(err);
}

if (failures.length) {
  console.error(`\n${failures.length} scene(s) failed:\n  ${failures.join('\n  ')}`);
  console.error(`Raw captures kept in ${raw}`);
  process.exit(1);
}

console.log('composing…');
const composeArgs = [path.join(__dirname, 'compose.js'), `--raw=${raw}`, `--out=${OUT}`, `--scale=${SCALE}`];
if (only) composeArgs.push(`--only=${only.join(',')}`);
const err = run('compose', composeArgs);
if (err) {
  console.error(err);
  console.error(`Raw captures kept in ${raw}`);
  process.exit(1);
}

if (keepRaw) console.log(`Raw captures kept in ${raw}`);
else fs.rmSync(raw, { recursive: true, force: true });
console.log(`Done. Screenshots are in ${path.relative(process.cwd(), OUT) || OUT}`);
