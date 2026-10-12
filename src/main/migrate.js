'use strict';

// One-time move of the notes folder from the app's old name. Electron names the user-data folder
// after productName, so after the rename from "Stickies" to "OpenStickies" the app starts with an
// empty %APPDATA%\OpenStickies. On the first start, this copies %APPDATA%\Stickies\data across.
//
// It copies rather than moves: the old folder stays behind as a backup, and an old copy of the app
// that is still running (or a portable copy started later) keeps working against its own files.
// The copy is made in a temporary folder and renamed into place at the end, so a crash or a full
// disk halfway through never leaves a half-filled data folder that would block the next attempt.

const fs = require('fs');
const path = require('path');

const LEGACY_NAME = 'Stickies';
// AppUserModelID the old app registered its "launch at login" entry under.
const LEGACY_LOGIN_ITEM = 'com.stickies.desktop';
const README_NAME = 'MOVED TO OPENSTICKIES.txt';

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// Antivirus and search indexers briefly lock new files on Windows, so retry the final rename.
function renameWithRetry(from, to) {
  for (let attempt = 0; ; attempt++) {
    try { fs.renameSync(from, to); return; }
    catch (err) {
      if (attempt >= 6 || !['EPERM', 'EBUSY', 'EACCES'].includes(err.code)) throw err;
      sleepSync(60 * (attempt + 1));
    }
  }
}

function readme(newDir) {
  return [
    'Stickies is now called OpenStickies.',
    '',
    `Your notes were copied to: ${newDir}`,
    '',
    'This folder is the copy your notes were moved from. OpenStickies no longer reads it,',
    'so you can delete it once you have checked that your notes are all there.',
    ''
  ].join('\r\n');
}

// Returns { migrated: true, from, to } after a copy, { migrated: false } when there was nothing
// to do, or { migrated: false, from, error } when the copy failed (the old folder is untouched).
function migrateLegacyData({ appData, userData }) {
  const from = path.join(appData, LEGACY_NAME, 'data');
  const to = path.join(userData, 'data');
  if (path.resolve(from).toLowerCase() === path.resolve(to).toLowerCase()) return { migrated: false };
  if (fs.existsSync(path.join(to, 'notes.json'))) return { migrated: false }; // already set up here
  if (!fs.existsSync(path.join(from, 'notes.json'))) return { migrated: false }; // nothing to bring over

  const tmp = `${to}.migrating`;
  try {
    fs.rmSync(tmp, { recursive: true, force: true }); // left over from an interrupted attempt
    // api.json holds the old app's port and token; OpenStickies writes its own on start.
    fs.cpSync(from, tmp, { recursive: true, filter: (src) => path.basename(src) !== 'api.json' });
    // A data folder without notes.json is from a first start that never saved anything; keep it
    // aside instead of deleting it.
    if (fs.existsSync(to)) renameWithRetry(to, `${to}-before-move-${Date.now()}`);
    renameWithRetry(tmp, to);
  } catch (error) {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* best effort */ }
    return { migrated: false, from, error };
  }
  try { fs.writeFileSync(path.join(path.dirname(from), README_NAME), readme(to)); } catch { /* only a hint */ }
  return { migrated: true, from, to };
}

module.exports = { migrateLegacyData, LEGACY_LOGIN_ITEM };
