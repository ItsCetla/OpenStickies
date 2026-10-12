'use strict';

// File shortcuts ("chips") in notes: looking up dropped files, opening them, dragging them back out
// and making preview thumbnails. Paths come from note HTML, which agents can write too, so every
// entry point checks the path again here instead of trusting the renderer.

const { app, nativeImage, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { t: tr } = require('./i18n');

const isWin = process.platform === 'win32';
const THUMB_SIZE = 320;
const THUMB_MAX_ENTRIES = 60;
const THUMB_MAX_CHARS = 24 * 1024 * 1024;
const RESIZE_MAX_BYTES = 30 * 1024 * 1024;

// Opening one of these runs code, so we ask first.
const RISKY_EXT = new Set([
  'exe', 'com', 'bat', 'cmd', 'msi', 'msp', 'msix', 'appx', 'ps1', 'psm1', 'vbs', 'vbe', 'js', 'jse', 'wsf', 'wsh',
  'hta', 'scr', 'pif', 'cpl', 'lnk', 'url', 'reg', 'jar', 'application', 'appref-ms', 'gadget', 'msc', 'inf', 'scf',
  'chm', 'dll', 'sys', 'app', 'command', 'tool', 'sh', 'bash', 'zsh', 'csh', 'ksh', 'fish', 'pkg', 'mpkg', 'terminal',
  'workflow', 'scpt', 'applescript', 'run', 'bin', 'appimage', 'desktop', 'deb', 'rpm', 'py', 'pyw', 'pl', 'rb',
  'php', 'action', 'definition', 'osx', 'out', 'elf', 'kext', 'prefpane', 'saver', 'docm', 'xlsm', 'pptm', 'dotm'
]);

// macOS shows these folders as single documents or apps.
const BUNDLE_RE = /\.(app|pkg|mpkg|bundle|framework|plugin|kext|prefpane|saver|photoslibrary|rtfd|key|pages|numbers|scptd|workflow)$/i;

const isUnc = (p) => /^\\\\/.test(p);

function validFilePath(p) {
  if (typeof p !== 'string' || !p || p.length > 1024 || /[\u0000-\u001f\u007f]/.test(p)) return null;
  if (isWin) {
    if (/^[A-Za-z]:[\\/]/.test(p)) return path.win32.normalize(p);
    if (/^\\\\[^\\?.][^\\]*\\[^\\]+/.test(p)) return p; // \\server\share\…; never \\?\ or \\.\ device paths
    return null;
  }
  if (/^\/(?!\/)/.test(p)) return path.posix.normalize(p);
  return null;
}

function baseName(p) {
  return p.split(/[\\/]/).filter(Boolean).pop() || p;
}

function extOf(name) {
  const m = /\.([A-Za-z0-9]{1,10})$/.exec(name);
  return m && m.index > 0 ? m[1].toLowerCase() : '';
}

async function isRisky(p, stat) {
  if (RISKY_EXT.has(extOf(baseName(p)))) return true;
  // An executable file without a telling extension still runs (in Terminal on macOS).
  if (!isWin && stat && stat.isFile() && (stat.mode & 0o111)) return true;
  return false;
}

// ---------- thumbnails ----------
const thumbs = new Map(); // `${path}|${mtimeMs}` → data URL or '' when there's none
let thumbChars = 0;

function rememberThumb(key, url) {
  if (thumbs.has(key)) { thumbChars -= thumbs.get(key).length; thumbs.delete(key); }
  if (url.length > THUMB_MAX_CHARS / 4) url = '';
  thumbs.set(key, url);
  thumbChars += url.length;
  for (const [k, v] of thumbs) {
    if (thumbs.size <= THUMB_MAX_ENTRIES && thumbChars <= THUMB_MAX_CHARS) break;
    thumbs.delete(k);
    thumbChars -= v.length;
  }
}

function fitImage(img) {
  const { width, height } = img.getSize();
  if (!width || !height) return '';
  const scale = Math.min(1, THUMB_SIZE / Math.max(width, height));
  const out = scale < 1 ? img.resize({ width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)), quality: 'good' }) : img;
  return out.toDataURL();
}

async function makeThumb(p, stat) {
  const key = `${p}|${stat.mtimeMs}`;
  if (thumbs.has(key)) {
    const v = thumbs.get(key);
    thumbs.delete(key); // keep recently used ones at the end
    thumbs.set(key, v);
    return v;
  }
  let url = '';
  // createThumbnailFromPath exists on macOS and Windows only; on Linux it throws.
  if (process.platform !== 'linux' && typeof nativeImage.createThumbnailFromPath === 'function') {
    try {
      const img = await nativeImage.createThumbnailFromPath(p, { width: THUMB_SIZE, height: THUMB_SIZE });
      if (img && !img.isEmpty()) url = img.toDataURL();
    } catch { /* no preview for this type */ }
  }
  if (!url && /\.(png|jpe?g)$/i.test(p) && stat.size < RESIZE_MAX_BYTES) {
    try {
      const img = nativeImage.createFromPath(p);
      if (!img.isEmpty()) url = fitImage(img);
    } catch { /* unreadable image */ }
  }
  rememberThumb(key, url);
  return url;
}

// ---------- drag icons ----------
const icons = new Map(); // path → nativeImage
let fallbackIcon = null;

function primeIcon(p) {
  if (icons.has(p) || isUnc(p)) return;
  icons.set(p, null);
  if (icons.size > 400) icons.delete(icons.keys().next().value);
  app.getFileIcon(p, { size: 'normal' })
    .then(img => { if (img && !img.isEmpty()) icons.set(p, img); else icons.delete(p); })
    .catch(() => icons.delete(p));
}

function dragIcon(p, assetsDir) {
  const cached = icons.get(p);
  if (cached) return cached;
  if (!fallbackIcon) {
    const img = nativeImage.createFromPath(path.join(assetsDir, 'icon.png'));
    fallbackIcon = img.isEmpty() ? img : img.resize({ width: 48, height: 48, quality: 'good' });
  }
  return fallbackIcon;
}

// ---------- public ----------
async function fileInfo(raw, { thumb = false } = {}) {
  const p = validFilePath(raw);
  if (!p) return { exists: false, invalid: true };
  const name = baseName(p);
  // Touching a network share can send the user's Windows credentials to that server, so a share
  // is only contacted when the user clicks it, never just because a note was shown.
  if (isUnc(p)) return { exists: true, remote: true, kind: 'file', name, ext: extOf(name), size: null, mtime: null };
  let stat;
  try { stat = await fs.promises.stat(p); } catch { return { exists: false, name, ext: extOf(name) }; }
  const dir = stat.isDirectory();
  const kind = dir && !(process.platform === 'darwin' && BUNDLE_RE.test(p)) ? 'folder' : 'file';
  const info = {
    exists: true,
    kind,
    name,
    ext: kind === 'file' ? extOf(name) : '',
    size: dir ? null : stat.size,
    mtime: stat.mtimeMs
  };
  primeIcon(p);
  if (thumb) {
    if (kind === 'folder') {
      try { info.items = (await fs.promises.readdir(p)).filter(n => !n.startsWith('.')).length; } catch { /* unreadable */ }
    } else {
      info.thumb = await makeThumb(p, stat);
    }
  }
  return info;
}

async function openFile(raw, parent) {
  const p = validFilePath(raw);
  if (!p) return { ok: false, reason: 'invalid' };
  let stat = null;
  if (!isUnc(p)) {
    try { stat = await fs.promises.stat(p); } catch { return { ok: false, reason: 'missing' }; }
  }
  if (await isRisky(p, stat)) {
    const opts = {
      type: 'warning',
      buttons: [tr('files.open'), tr('common.cancel')],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
      message: tr('files.openConfirm', { name: baseName(p) }),
      detail: tr('files.riskyDetail')
    };
    const { response } = parent && !parent.isDestroyed() ? await dialog.showMessageBox(parent, opts) : await dialog.showMessageBox(opts);
    if (response !== 0) return { ok: false, reason: 'cancelled' };
  }
  const err = await shell.openPath(p);
  return err ? { ok: false, reason: 'failed', error: err } : { ok: true };
}

function showFile(raw) {
  const p = validFilePath(raw);
  if (!p) return false;
  if (!isUnc(p) && !fs.existsSync(p)) {
    // Show the folder it used to be in, if that's still around.
    const dir = path.dirname(p);
    if (fs.existsSync(dir)) { shell.openPath(dir); return true; }
    return false;
  }
  shell.showItemInFolder(p);
  return true;
}

function startDrag(webContents, raw, assetsDir) {
  const p = validFilePath(raw);
  if (!p || (!isUnc(p) && !fs.existsSync(p))) return false;
  const icon = dragIcon(p, assetsDir);
  if (icon.isEmpty()) return false; // macOS refuses a drag without an image
  webContents.startDrag({ file: p, icon });
  return true;
}

module.exports = { validFilePath, fileInfo, openFile, showFile, startDrag };
