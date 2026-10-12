'use strict';

// Lets people keep their notes in a folder of their choosing (a synced Dropbox/OneDrive/iCloud
// folder, a second drive, …). The choice lives in a tiny pointer file in the DEFAULT userData
// folder, because it has to be readable before the store, which lives in the chosen folder, exists.

const fs = require('fs');
const path = require('path');
const { writeFileAtomic } = require('./store');

const POINTER = 'data-location.json';
// What makes up a data folder. api.json is deliberately absent: it holds the local API token and
// stays in the default folder, where the OpenCode plugin looks for it and no sync service sees it.
const DATA_FILES = ['notes.json', 'settings.json', 'templates.json', 'vault.json'];
const DATA_DIRS = ['attachments', 'history', 'backups'];

function pointerFile(defaultUserData) {
  return path.join(defaultUserData, POINTER);
}

// The chosen folder, or null for the default. A damaged or relative pointer counts as "default"
// rather than stopping the app from starting.
function readDataLocation(defaultUserData) {
  try {
    const raw = JSON.parse(fs.readFileSync(pointerFile(defaultUserData), 'utf8'));
    const p = raw && typeof raw.path === 'string' ? raw.path : '';
    return p && path.isAbsolute(p) ? path.normalize(p) : null;
  } catch {
    return null;
  }
}

function writeDataLocation(defaultUserData, dir) {
  const file = pointerFile(defaultUserData);
  if (!dir) {
    try { fs.unlinkSync(file); } catch (err) { if (err.code !== 'ENOENT') throw err; }
    return;
  }
  fs.mkdirSync(defaultUserData, { recursive: true });
  writeFileAtomic(file, JSON.stringify({ path: dir }, null, 2));
}

function samePath(a, b) {
  const norm = (p) => {
    const r = path.resolve(p);
    return process.platform === 'linux' ? r : r.toLowerCase(); // macOS and Windows are case-insensitive by default
  };
  return norm(a) === norm(b);
}

function isInside(child, parent) {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function hasNotes(dir) {
  return fs.existsSync(path.join(dir, 'notes.json'));
}

// Every write goes through writeFileAtomic, so an interrupted copy never leaves a half-written
// notes.json behind for the next start to choke on.
function copyFile(from, to) {
  writeFileAtomic(to, fs.readFileSync(from));
}

function copyDir(from, to) {
  let entries;
  try { entries = fs.readdirSync(from, { withFileTypes: true }); } catch (err) {
    if (err.code === 'ENOENT') return 0;
    throw err;
  }
  fs.mkdirSync(to, { recursive: true });
  let count = 0;
  for (const ent of entries) {
    if (ent.name.endsWith('.tmp')) continue; // leftovers of an interrupted atomic write
    const src = path.join(from, ent.name);
    const dst = path.join(to, ent.name);
    if (ent.isDirectory()) count += copyDir(src, dst);
    else if (ent.isFile()) { copyFile(src, dst); count++; } // symlinks are skipped on purpose
  }
  return count;
}

// Copies a data folder's contents into another folder. The source is left untouched, so the old
// folder doubles as a backup until the person removes it. notes.json goes last: hasNotes() keys
// on it, so a copy that fails partway (disk full, no permission) never makes the destination look
// like an existing notes folder, and a retry just overwrites the partial files.
function copyDataFolder(from, to) {
  fs.mkdirSync(to, { recursive: true });
  let count = 0;
  for (const d of DATA_DIRS) count += copyDir(path.join(from, d), path.join(to, d));
  return count + copyDataFiles(from, to);
}

// Just the top-level data files, notes.json last. Also run on the way out of a move, to carry
// over anything saved after the main copy.
function copyDataFiles(from, to) {
  let count = 0;
  for (const f of [...DATA_FILES.filter(n => n !== 'notes.json'), 'notes.json']) {
    const src = path.join(from, f);
    if (fs.existsSync(src)) { copyFile(src, path.join(to, f)); count++; }
  }
  return count;
}

module.exports = { readDataLocation, writeDataLocation, copyDataFolder, copyDataFiles, hasNotes, samePath, isInside, pointerFile };
