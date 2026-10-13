'use strict';

// File shortcuts ("chips") in notes: looking up dropped files, opening them, dragging them back out
// and making preview thumbnails. Paths come from note HTML, which agents can write too, so every
// entry point checks the path again here instead of trusting the renderer.

const { app, nativeImage, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { pathToFileURL } = require('url');
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

// ---------- Linux previews ----------
// Electron has no createThumbnailFromPath on Linux. The desktop keeps the thumbnails it has made
// for files the file manager showed (the freedesktop thumbnail spec), and lists the programs it
// makes them with in *.thumbnailer files, so we take the cached picture when it's current and run
// the matching thumbnailer otherwise. A file previews here whenever it previews in the file manager.

const EXT_MIME = {
  pdf: 'application/pdf', ps: 'application/postscript', eps: 'image/x-eps', djvu: 'image/vnd.djvu', epub: 'application/epub+zip',
  cbz: 'application/vnd.comicbook+zip', cbr: 'application/vnd.comicbook-rar', xps: 'application/oxps',
  odt: 'application/vnd.oasis.opendocument.text', ods: 'application/vnd.oasis.opendocument.spreadsheet',
  odp: 'application/vnd.oasis.opendocument.presentation', odg: 'application/vnd.oasis.opendocument.graphics',
  doc: 'application/msword', xls: 'application/vnd.ms-excel', ppt: 'application/vnd.ms-powerpoint',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  rtf: 'application/rtf', svg: 'image/svg+xml', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', tif: 'image/tiff',
  tiff: 'image/tiff', avif: 'image/avif', heic: 'image/heif', heif: 'image/heif', ico: 'image/vnd.microsoft.icon',
  xcf: 'image/x-xcf', psd: 'image/vnd.adobe.photoshop', kra: 'application/x-krita',
  mp4: 'video/mp4', m4v: 'video/mp4', mkv: 'video/x-matroska', webm: 'video/webm', avi: 'video/x-msvideo',
  mov: 'video/quicktime', wmv: 'video/x-ms-wmv', flv: 'video/x-flv', mpg: 'video/mpeg', mpeg: 'video/mpeg', ogv: 'video/ogg',
  mp3: 'audio/mpeg', flac: 'audio/flac', ogg: 'audio/ogg', opus: 'audio/ogg', m4a: 'audio/mp4', wav: 'audio/x-wav',
  ttf: 'font/ttf', otf: 'font/otf', woff: 'font/woff', woff2: 'font/woff2', stl: 'model/stl', blend: 'application/x-blender'
};
const mimeByExt = new Map(); // extension → Promise<mime> from xdg-mime, for types not in the table
let thumbnailers = null; // [{ exec: argv, mimes: Set }] read once from *.thumbnailer files

function run(cmd, args, timeout = 5000) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout, maxBuffer: 1 << 20, windowsHide: true }, (err, stdout) => (err ? reject(err) : resolve(String(stdout))));
  });
}

function mimeTypeOf(p) {
  const ext = extOf(path.basename(p));
  if (EXT_MIME[ext]) return Promise.resolve(EXT_MIME[ext]);
  if (!ext) return Promise.resolve('');
  // The desktop's own database knows the rest. One xdg-mime run per extension, remembered.
  if (!mimeByExt.has(ext)) mimeByExt.set(ext, run('xdg-mime', ['query', 'filetype', p]).then(out => out.trim(), () => ''));
  return mimeByExt.get(ext);
}

function onPath(cmd) {
  if (path.isAbsolute(cmd)) return fs.existsSync(cmd);
  return (process.env.PATH || '').split(':').some(d => d && fs.existsSync(path.join(d, cmd)));
}

// Splits an Exec= line the way a shell would, enough for the quoting thumbnailer files use.
function splitExec(line) {
  const out = [];
  for (const m of String(line).matchAll(/"((?:[^"\\]|\\.)*)"|'([^']*)'|(\S+)/g)) {
    out.push(m[1] !== undefined ? m[1].replace(/\\(.)/g, '$1') : m[2] !== undefined ? m[2] : m[3]);
  }
  return out;
}

function loadThumbnailers() {
  if (thumbnailers) return thumbnailers;
  thumbnailers = [];
  const home = process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share');
  const dirs = [home, ...(process.env.XDG_DATA_DIRS || '/usr/local/share:/usr/share').split(':').filter(Boolean)];
  const seen = new Set();
  for (const dir of dirs) {
    let names;
    try { names = fs.readdirSync(path.join(dir, 'thumbnailers')); } catch { continue; }
    for (const name of names.sort()) {
      // Same name earlier in the list wins, so a user's copy shadows the system one.
      if (!name.endsWith('.thumbnailer') || seen.has(name)) continue;
      seen.add(name);
      let text;
      try { text = fs.readFileSync(path.join(dir, 'thumbnailers', name), 'utf8'); } catch { continue; }
      const entry = {};
      let inEntry = false;
      for (const raw of text.split('\n')) {
        const line = raw.trim();
        if (line.startsWith('[')) { inEntry = line === '[Thumbnailer Entry]'; continue; }
        const eq = line.indexOf('=');
        if (inEntry && eq > 0 && !line.startsWith('#')) entry[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
      }
      const exec = splitExec(entry.Exec);
      if (!exec.length || !onPath(entry.TryExec || exec[0])) continue;
      thumbnailers.push({ exec, mimes: new Set((entry.MimeType || '').split(';').map(s => s.trim()).filter(Boolean)) });
    }
  }
  return thumbnailers;
}

// The thumbnail the desktop already holds for this file, when it was made from the current
// version (its Thumb::MTime text chunk matches the file's mtime; older thumbnailers that wrote
// none pass when the thumbnail is the newer of the two).
async function cachedThumb(p, stat) {
  const hash = crypto.createHash('md5').update(pathToFileURL(p).href).digest('hex');
  const base = process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache');
  for (const size of ['x-large', 'large', 'normal']) {
    const file = path.join(base, 'thumbnails', size, hash + '.png');
    let buf;
    try { buf = await fs.promises.readFile(file); } catch { continue; }
    const m = /Thumb::MTime\0(\d+)/.exec(buf.toString('latin1', 0, Math.min(buf.length, 65536)));
    let fresh;
    if (m) fresh = Number(m[1]) === Math.floor(stat.mtimeMs / 1000);
    else { try { fresh = (await fs.promises.stat(file)).mtimeMs >= stat.mtimeMs; } catch { fresh = false; } }
    if (!fresh) continue;
    try {
      const img = nativeImage.createFromBuffer(buf);
      if (!img.isEmpty()) return fitImage(img);
    } catch { /* not a picture after all */ }
  }
  return '';
}

async function runThumbnailer(p, mime) {
  const t = loadThumbnailers().find(x => x.mimes.has(mime));
  if (!t) return '';
  const out = path.join(os.tmpdir(), `openstickies-thumb-${crypto.randomBytes(6).toString('hex')}.png`);
  const subs = { '%s': String(THUMB_SIZE), '%u': pathToFileURL(p).href, '%i': p, '%o': out, '%%': '%' };
  const [cmd, ...args] = t.exec.map(a => a.replace(/%[suio%]/g, k => subs[k]));
  try {
    await run(cmd, args);
    const img = nativeImage.createFromPath(out);
    return img.isEmpty() ? '' : fitImage(img);
  } catch {
    return ''; // the thumbnailer couldn't read it, or took longer than we wait for a hover
  } finally {
    fs.promises.unlink(out).catch(() => {});
  }
}

async function linuxThumb(p, stat) {
  const cached = await cachedThumb(p, stat);
  if (cached) return cached;
  const mime = await mimeTypeOf(p);
  return mime ? runThumbnailer(p, mime) : '';
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
  // createThumbnailFromPath exists on macOS and Windows only; Linux goes through the desktop's
  // thumbnail cache and thumbnailers instead.
  if (process.platform === 'linux') {
    url = await linuxThumb(p, stat);
  } else if (typeof nativeImage.createThumbnailFromPath === 'function') {
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
