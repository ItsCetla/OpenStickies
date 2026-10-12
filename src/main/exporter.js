'use strict';

const { dialog, BrowserWindow, app } = require('electron');
const fs = require('fs');
const path = require('path');
const { t: tr } = require('./i18n');
const palette = require('../renderer/shared/colors.json');
const { mdToHtml, textToHtml, esc } = require('./markdown');
const { IMAGE_EXT, sniffImageExt, ATTACHMENT_NAME_RE, writeFileAtomic } = require('./store');

const MIME_BY_EXT = Object.fromEntries(Object.entries(IMAGE_EXT).map(([m, e]) => [e, m]));
const IMG_URL_RE = /sticky-img:\/\/img\/([A-Za-z0-9._-]+)/g;

function safeFileName(title) {
  return String(title || 'Sticky note').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60) || 'Sticky note';
}

function inlineImages(html, store) {
  return html.replace(IMG_URL_RE, (m, name) => {
    const file = store.attachmentPath(name);
    if (!file || !fs.existsSync(file)) return m;
    const mime = MIME_BY_EXT[path.extname(name).slice(1).toLowerCase()] || 'application/octet-stream';
    return `data:${mime};base64,${fs.readFileSync(file).toString('base64')}`;
  });
}

function exportCss(note) {
  const c = (palette.notes[note.color] || palette.notes.yellow).light;
  const font = (palette.fonts.find(f => f.id === note.font) || palette.fonts[0]).css;
  return `
  :root { color-scheme: light; }
  body { margin: 0; padding: 32px; background: #ecebe8; font-family: ${font}; }
  .note { max-width: 760px; margin: 0 auto; background: ${c.bg}; color: ${c.text}; border-top: 14px solid ${c.bar};
          padding: 8px 10px 16px; box-shadow: 0 6px 24px rgba(0,0,0,.14); border-radius: 4px; font-size: 15px; line-height: 1.5; overflow-wrap: anywhere; }
  .meta { font: 12px "Segoe UI", system-ui, sans-serif; opacity: .55; padding: 8px 16px 0; }
  /* Same box model as the note editor, so "behind/in front of text" images land in the same spot. */
  .body { position: relative; z-index: 0; display: flow-root; padding: 10px 16px; white-space: pre-wrap; }
  img[data-wrap="left"] { float: left; margin: .25em .9em .35em 0; }
  img[data-wrap="right"] { float: right; margin: .25em 0 .35em .9em; }
  img[data-wrap="block"] { display: block; margin: .45em auto; }
  img[data-wrap="behind"], img[data-wrap="front"] { position: absolute; max-width: none; margin: 0; }
  img[data-wrap="behind"] { z-index: -1; }
  img[data-wrap="front"] { z-index: 2; }
  p { margin: 0 0 .2em; }
  h1, h2, h3 { line-height: 1.25; margin: .5em 0 .25em; } h1 { font-size: 1.6em; } h2 { font-size: 1.32em; } h3 { font-size: 1.12em; }
  a { color: ${c.accent}; }
  img { max-width: 100%; height: auto; border-radius: 4px; }
  ul, ol { padding-left: 1.6em; margin: .2em 0; }
  ul.checklist { list-style: none; padding-left: .2em; }
  ul.checklist > li { position: relative; padding-left: 1.7em; }
  ul.checklist > li::before { content: ""; position: absolute; left: 0; top: .22em; width: 1em; height: 1em; border: 1.6px solid currentColor; border-radius: 4px; opacity: .7; box-sizing: border-box; }
  ul.checklist > li.checked::before { content: "✓"; background: ${c.accent}; border-color: ${c.accent}; color: #fff; font-size: .8em; line-height: 1.15em; text-align: center; width: 1.25em; height: 1.25em; opacity: 1; }
  ul.checklist > li.checked { text-decoration: line-through; opacity: .6; }
  ul.checklist > li.h1 { font-size: 1.6em; font-weight: 700; } ul.checklist > li.h2 { font-size: 1.3em; font-weight: 700; } ul.checklist > li.h3 { font-size: 1.1em; font-weight: 650; }
  ul.checklist > :is(ul, ol) { margin-left: 1.7em; }
  blockquote { margin: .4em 0; padding: .1em 0 .1em .9em; border-left: 3px solid ${c.accent}; opacity: .85; }
  code { font-family: "Cascadia Code", Consolas, monospace; font-size: .9em; background: rgba(0,0,0,.07); padding: .1em .35em; border-radius: 4px; }
  pre { background: rgba(0,0,0,.07); padding: .7em .9em; border-radius: 6px; white-space: pre-wrap; }
  pre code { background: none; padding: 0; }
  hr { border: 0; border-top: 1.5px solid currentColor; opacity: .25; margin: .8em 0; }
  table { border-collapse: collapse; margin: .4em 0; width: 100%; }
  td, th { border: 1px solid rgba(0,0,0,.2); padding: .3em .5em; text-align: left; vertical-align: top; }
  th { background: rgba(0,0,0,.05); }
  @media print { body { background: #fff; padding: 0; } .note { box-shadow: none; max-width: none; } }`;
}

function documentHtml(note, bodyHtml) {
  const title = esc(note.title || 'Sticky note');
  const when = new Date(note.updatedAt || Date.now()).toLocaleString();
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: https:; style-src 'unsafe-inline'">
<title>${title}</title><style>${exportCss(note)}</style></head>
<body><article class="note"><div class="meta">${esc(when)}</div><div class="body">${bodyHtml}</div></article></body></html>`;
}

// A function so the names follow the current language.
const FILTERS = () => ({
  html: [{ name: tr('export.webPage'), extensions: ['html'] }],
  md: [{ name: tr('export.markdown'), extensions: ['md'] }],
  txt: [{ name: tr('export.text'), extensions: ['txt'] }],
  pdf: [{ name: 'PDF', extensions: ['pdf'] }],
  json: [{ name: 'JSON', extensions: ['json'] }]
});

async function renderOffscreen(html, fn) {
  const tmp = path.join(app.getPath('temp'), `stickies-print-${Date.now()}.html`);
  fs.writeFileSync(tmp, html);
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, javascript: false } });
  try {
    await win.loadFile(tmp);
    return await fn(win);
  } finally {
    if (!win.isDestroyed()) win.destroy();
    fs.unlink(tmp, () => {});
  }
}

async function exportNote({ parent, store, note, format, payload }) {
  const base = safeFileName(note.title);
  if (format === 'print') {
    const html = documentHtml(note, inlineImages(payload.html, store));
    return renderOffscreen(html, (win) => new Promise((resolve) => {
      win.webContents.print({ printBackground: true }, (ok, reason) => resolve({ ok, reason }));
    }));
  }

  const { canceled, filePath } = await dialog.showSaveDialog(parent, {
    title: tr('export.exportNote'),
    defaultPath: path.join(app.getPath('documents'), `${base}.${format}`),
    filters: FILTERS()[format]
  });
  if (canceled || !filePath) return { ok: false, canceled: true };

  if (format === 'html') {
    fs.writeFileSync(filePath, documentHtml(note, inlineImages(payload.html, store)));
  } else if (format === 'txt') {
    fs.writeFileSync(filePath, payload.text.replace(/\n/g, '\r\n'));
  } else if (format === 'md') {
    let md = payload.markdown;
    const names = [...new Set([...md.matchAll(IMG_URL_RE)].map(m => m[1]))];
    if (names.length) {
      const folderName = path.basename(filePath, path.extname(filePath)) + '-images';
      const folder = path.join(path.dirname(filePath), folderName);
      fs.mkdirSync(folder, { recursive: true });
      for (const name of names) {
        const src = store.attachmentPath(name);
        if (src && fs.existsSync(src)) fs.copyFileSync(src, path.join(folder, name));
      }
      md = md.replace(IMG_URL_RE, (_, name) => `${encodeURI(folderName)}/${name}`);
    }
    fs.writeFileSync(filePath, md);
  } else if (format === 'json') {
    const doc = { exportedAt: new Date().toISOString(), app: 'OpenStickies', version: app.getVersion(), notes: [noteJson(note, payload)] };
    writeFileAtomic(filePath, JSON.stringify(doc, null, 2));
  } else if (format === 'pdf') {
    const html = documentHtml(note, inlineImages(payload.html, store));
    const pdf = await renderOffscreen(html, (win) => win.webContents.printToPDF({ printBackground: true, pageSize: 'Letter' }));
    fs.writeFileSync(filePath, pdf);
  }
  return { ok: true, filePath };
}

// ---------- bulk export ----------
const isoOrNull = (t) => (Number.isFinite(t) ? new Date(t).toISOString() : (typeof t === 'string' && t ? t : null));

// The shape shared by the per-note and bulk JSON exports: plain, documented fields only, so other
// tools can read it without knowing OpenStickies' internal storage format.
function noteJson(note, content) {
  return {
    id: note.id,
    title: content.title || note.title || '',
    text: content.text || '',
    html: content.html || '',
    markdown: content.markdown || '',
    // a tabbed note's pages; title/text/html/markdown above hold all of them joined
    tabs: Array.isArray(content.tabs) && content.tabs.length > 1
      ? content.tabs.map(t => ({ title: String(t.title || ''), html: String(t.html || ''), text: String(t.text || ''), markdown: String(t.markdown || '') }))
      : null,
    color: note.color,
    tags: Array.isArray(note.tags) ? note.tags : [],
    createdAt: isoOrNull(note.createdAt),
    updatedAt: isoOrNull(note.updatedAt),
    pinned: !!note.pinned,
    reminder: note.reminder || null
  };
}

// Windows refuses these names whatever the extension; trailing dots and spaces get stripped by it too.
const RESERVED_NAME_RE = /^(con|prn|aux|nul|com\d|lpt\d)$/i;

function uniqueName(base, ext, used) {
  let stem = base.replace(/[. ]+$/, '') || 'Sticky note';
  if (RESERVED_NAME_RE.test(stem)) stem = `_${stem}`;
  let name = `${stem}${ext}`;
  for (let i = 2; used.has(name.toLowerCase()); i++) name = `${stem} (${i})${ext}`;
  used.add(name.toLowerCase());
  return name;
}

// A fresh folder (or file) next to anything already in the chosen folder, never on top of it.
function freePath(dir, stem, ext) {
  let p = path.join(dir, `${stem}${ext}`);
  for (let i = 2; fs.existsSync(p); i++) p = path.join(dir, `${stem} (${i})${ext}`);
  return p;
}

// items: [{ note, title, text, html, markdown, tabs? }] — the caller has already dropped trashed notes and
// private notes it can't decrypt. readImage(name) returns an image's bytes (decrypting if needed) or null.
async function exportAllNotes({ parent, format, items, readImage }) {
  if (!['md', 'txt', 'json'].includes(format)) throw new Error('Unknown format');
  const { canceled, filePaths } = await dialog.showOpenDialog(parent, {
    title: tr('export.chooseFolder'),
    defaultPath: app.getPath('documents'),
    buttonLabel: tr('export.exportHere'),
    properties: ['openDirectory', 'createDirectory']
  });
  if (canceled || !filePaths || !filePaths[0]) return { ok: false, canceled: true };
  const dir = filePaths[0];
  const stamp = new Date().toISOString().slice(0, 10);
  const stem = `OpenStickies notes ${stamp}`;

  if (format === 'json') {
    const filePath = freePath(dir, stem, '.json');
    const doc = { exportedAt: new Date().toISOString(), app: 'OpenStickies', version: app.getVersion(), notes: items.map(it => noteJson(it.note, it)) };
    writeFileAtomic(filePath, JSON.stringify(doc, null, 2));
    return { ok: true, count: items.length, path: filePath };
  }

  const folder = freePath(dir, stem, '');
  fs.mkdirSync(folder, { recursive: true });
  const used = new Set(['assets']);
  const copied = new Set();
  for (const it of items) {
    const name = uniqueName(safeFileName(it.title || it.note.title), `.${format}`, used);
    if (format === 'txt') {
      writeFileAtomic(path.join(folder, name), String(it.text || '').replace(/\r?\n/g, '\r\n'));
      continue;
    }
    let md = String(it.markdown || '');
    const names = [...new Set([...md.matchAll(IMG_URL_RE)].map(m => m[1]))].filter(n => ATTACHMENT_NAME_RE.test(n));
    for (const img of names) {
      if (copied.has(img)) continue;
      const bytes = readImage(img);
      if (!bytes) continue;
      fs.mkdirSync(path.join(folder, 'assets'), { recursive: true });
      writeFileAtomic(path.join(folder, 'assets', img), bytes);
      copied.add(img);
    }
    md = md.replace(IMG_URL_RE, (m, img) => (copied.has(img) ? `assets/${img}` : m));
    writeFileAtomic(path.join(folder, name), md);
  }
  return { ok: true, count: items.length, path: folder };
}

async function saveImageAs({ parent, store, url }) {
  const src = store.attachmentFromUrl(url);
  if (!src || !fs.existsSync(src)) return { ok: false };
  const ext = path.extname(src);
  const { canceled, filePath } = await dialog.showSaveDialog(parent, {
    title: tr('export.saveImage'),
    defaultPath: path.join(app.getPath('pictures'), `sticky-image${ext}`),
    filters: [{ name: tr('export.image'), extensions: [ext.slice(1)] }]
  });
  if (canceled || !filePath) return { ok: false, canceled: true };
  fs.copyFileSync(src, filePath);
  return { ok: true, filePath };
}

// ---------- full backups ----------
async function exportBackup({ parent, store, vault }) {
  const stamp = new Date().toISOString().slice(0, 10);
  const { canceled, filePath } = await dialog.showSaveDialog(parent, {
    title: tr('export.backup'),
    defaultPath: path.join(app.getPath('documents'), `OpenStickies backup ${stamp}.stickies.json`),
    filters: [{ name: tr('export.backupFile'), extensions: ['json'] }]
  });
  if (canceled || !filePath) return { ok: false, canceled: true };
  const attachments = {};
  const encryptedAttachments = {}; // images of private notes, still encrypted
  for (const name of store.referencedAttachments()) {
    const file = store.attachmentPath(name);
    if (file && fs.existsSync(file)) attachments[name] = fs.readFileSync(file).toString('base64');
    else if (file && fs.existsSync(file + '.enc')) encryptedAttachments[name] = fs.readFileSync(file + '.enc').toString('base64');
  }
  const { managerBounds, ...settings } = store.settings;
  const data = {
    app: 'stickies', version: 3, exportedAt: new Date().toISOString(), settings, notes: store.all(), attachments,
    templates: store.templates, trashedTabs: store.trashedTabs, encryptedAttachments,
    vault: vault ? vault.exportConfig() : null // the key stays wrapped by the password
  };
  fs.writeFileSync(filePath, JSON.stringify(data));
  return { ok: true, filePath, count: data.notes.length };
}

async function importBackup({ parent, store, vault }) {
  const { canceled, filePaths } = await dialog.showOpenDialog(parent, {
    title: tr('export.restore'),
    filters: [{ name: tr('export.backupFile'), extensions: ['json'] }],
    properties: ['openFile']
  });
  if (canceled || !filePaths.length) return { ok: false, canceled: true };
  const data = JSON.parse(fs.readFileSync(filePaths[0], 'utf8'));
  const notes = Array.isArray(data.notes) ? data.notes : (Array.isArray(data) ? data : null);
  if (!notes) throw new Error(tr('export.notBackup'));
  // A backup can come from anywhere, so never trust its file names or contents: only real
  // image bytes are accepted, and each is stored under the hash of what it actually contains.
  const renamed = new Map();
  for (const [name, b64] of Object.entries(data.attachments || {})) {
    if (!ATTACHMENT_NAME_RE.test(name) || typeof b64 !== 'string') continue;
    const buf = Buffer.from(b64, 'base64');
    const ext = name.split('.').pop();
    const sniffed = sniffImageExt(buf);
    const isSvg = ext === 'svg' && /^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(buf.slice(0, 2048).toString('utf8'));
    if (!sniffed && !isSvg && !['avif', 'ico'].includes(ext)) continue;
    try {
      const saved = store.saveAttachment(buf, MIME_BY_EXT[sniffed || ext]);
      if (saved.name !== name) renamed.set(name, saved.name);
    } catch { /* skip unreadable image */ }
  }
  const fixRefs = (html) => (renamed.size ? html.replace(IMG_URL_RE, (m, n) => (renamed.has(n) ? `sticky-img://img/${renamed.get(n)}` : m)) : html);
  // Background pictures point at attachments too; store.create drops them if the file is missing.
  const fixBackground = (bg) => (bg && bg.type === 'image' && typeof bg.src === 'string' ? { ...bg, src: fixRefs(bg.src) } : bg);

  // Private notes can only be restored into the same private-notes setup (same key).
  if (vault && data.vault && !vault.configured) vault.adoptConfig(data.vault);
  const sameVault = !!(vault && data.vault && vault.id === data.vault.id);
  if (sameVault) {
    for (const [name, b64] of Object.entries(data.encryptedAttachments || {})) {
      const file = store.attachmentPath(name);
      if (file && typeof b64 === 'string' && !fs.existsSync(file) && !fs.existsSync(file + '.enc')) fs.writeFileSync(file + '.enc', Buffer.from(b64, 'base64'));
    }
  }

  let added = 0;
  let skippedPrivate = 0;
  // Map html/cipher -> id so a skipped duplicate still gives its closed tabs a parent note.
  const existingHtml = new Map(store.all().filter(n => !n.private).map(n => [n.html, n.id]));
  const existingCipher = new Map(store.all().filter(n => n.private && n.cipher).map(n => [n.cipher.data, n.id]));
  // Restored notes get new ids; closed tabs in the backup still point at the old ones.
  const idMap = new Map();
  for (const raw of notes) {
    if (!raw) continue;
    if (raw.private) {
      if (!sameVault || !raw.cipher) { skippedPrivate++; continue; }
      if (existingCipher.has(raw.cipher.data)) { idMap.set(raw.id, existingCipher.get(raw.cipher.data)); continue; }
      const created = store.create({ ...raw, background: fixBackground(raw.background), open: false, bounds: raw.bounds || null });
      idMap.set(raw.id, created.id);
      added++;
      continue;
    }
    if (typeof raw.html !== 'string') continue;
    const html = fixRefs(raw.html);
    if (existingHtml.has(html)) { idMap.set(raw.id, existingHtml.get(html)); continue; } // skip exact duplicates
    // Tabs carry their own copy of the page HTML, so their image links need the same renaming.
    const tabs = Array.isArray(raw.tabs) ? raw.tabs.map(t => (t && typeof t.html === 'string' ? { ...t, html: fixRefs(t.html) } : t)) : null;
    const created = store.create({ ...raw, html, tabs, background: fixBackground(raw.background), open: false, trashed: !!raw.trashed, bounds: raw.bounds || null });
    idMap.set(raw.id, created.id);
    added++;
  }
  store.capTrash(); // imported trashed notes skip trash(), which normally applies the limit
  for (const t of Array.isArray(data.templates) ? data.templates : []) {
    if (t && typeof t.html === 'string' && !store.templates.some(x => x.id === t.id || (x.name === t.name && x.html === t.html))) {
      store.saveTemplate({ name: t.name, html: fixRefs(t.html), color: t.color });
    }
  }
  // Closed tabs in the Trash; skip ones this Trash already holds so a second restore adds nothing.
  const seenTabs = new Set(store.trashedTabs.map(t => t.html));
  let tabsAdded = 0;
  for (const t of Array.isArray(data.trashedTabs) ? data.trashedTabs : []) {
    if (!t || typeof t.html !== 'string') continue;
    const html = fixRefs(t.html);
    if (seenTabs.has(html)) continue;
    // id: null gets a fresh tab id, so restored tabs can't collide with existing ones.
    const norm = store._normalizeTrashedTab({ ...t, html, id: null, noteId: idMap.get(t.noteId) || '' });
    if (!norm) continue;
    store.trashedTabs.push(norm);
    seenTabs.add(html);
    tabsAdded++;
  }
  if (tabsAdded) {
    store._capTrashedTabs();
    store.saveSoon();
    store.emit('changed', { type: 'tab-restore', id: null });
  }
  return { ok: true, added, skipped: notes.length - added - skippedPrivate, skippedPrivate };
}

async function importFiles({ parent }) {
  const { canceled, filePaths } = await dialog.showOpenDialog(parent, {
    title: tr('export.importFiles'),
    filters: [
      { name: tr('export.notes'), extensions: ['txt', 'md', 'markdown', 'html', 'htm'] },
      { name: tr('export.allFiles'), extensions: ['*'] }
    ],
    properties: ['openFile', 'multiSelections']
  });
  if (canceled) return [];
  return filePaths.map(fileToNote).filter(Boolean);
}

function fileToNote(file) {
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size > 5 * 1024 * 1024) return null;
    const raw = fs.readFileSync(file, 'utf8');
    const ext = path.extname(file).toLowerCase();
    let html;
    if (ext === '.md' || ext === '.markdown') html = mdToHtml(raw);
    else if (ext === '.html' || ext === '.htm') {
      const body = /<body[^>]*>([\s\S]*)<\/body>/i.exec(raw);
      html = body ? body[1] : raw;
    } else html = textToHtml(raw);
    return { html, title: path.basename(file, ext) };
  } catch {
    return null;
  }
}

function imageFileToAttachment(store, file) {
  const buf = fs.readFileSync(file);
  const ext = path.extname(file).slice(1).toLowerCase();
  const mime = MIME_BY_EXT[ext === 'jpeg' ? 'jpg' : ext] || (sniffImageExt(buf) ? `image/${sniffImageExt(buf)}` : '');
  return store.saveAttachment(buf, mime);
}

module.exports = { exportNote, saveImageAs, exportBackup, importBackup, importFiles, imageFileToAttachment, documentHtml, safeFileName, exportAllNotes };
