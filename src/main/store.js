'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const palette = require('../renderer/shared/colors.json');
const { htmlToText, titleFromText } = require('./store-text');
const scan = require('./html-scan');

const NOTE_FIELDS = [
  'html', 'text', 'title', 'color', 'font', 'bounds', 'pinned', 'rolled', 'opacity',
  'zoom', 'locked', 'open', 'reminder', 'trashed', 'trashedAt', 'createdAt', 'updatedAt',
  // derived from the content (kept so the notes list can search/filter without parsing HTML)
  'tags', 'links', 'imageText', 'tasks',
  // private notes: content lives only in `cipher`; `refs` lists their (hash-named) images
  'private', 'cipher', 'refs',
  // notes written by an AI agent (OpenCode): { key, source, project }
  'agent'
];

// Fields whose change counts as a content edit (bumps updatedAt).
const CONTENT_FIELDS = new Set(['html', 'color', 'font']);

const DEFAULT_SETTINGS = {
  theme: 'system',            // 'system' | 'light' | 'dark'
  defaultColor: 'yellow',     // 'random' or a palette key
  defaultFont: 'default',
  fontSize: 15,
  showInTaskbar: false,
  launchAtLogin: false,
  spellcheck: true,
  confirmDelete: true,
  snapToEdges: true,
  opaqueOnHover: true,
  hotkeys: {
    newNote: 'CommandOrControl+Alt+N',
    showAll: 'CommandOrControl+Alt+S',
    toggleAll: 'CommandOrControl+Alt+H',
    snip: 'CommandOrControl+Alt+X',
    nextWorkspace: 'CommandOrControl+Alt+W'
  },
  snipTarget: 'new',            // 'new' | 'last'
  ocrImages: true,              // recognize text in images so search finds it
  sinkTicked: false,            // off: ticked checklist items stay where they are; on: they move below the unticked ones
  toolbarMode: 'popup',         // 'popup' | 'editing' | 'always'
  apiEnabled: true,             // local API for OpenCode and scripts (127.0.0.1 + token)
  agentColor: 'blue',           // color of notes written by AI agents
  agentPlanNudge: true,         // ask OpenCode to plan every multi-part task as a to-do list (→ a sticky)
  savedSearches: [
    { id: 's-unchecked', name: 'Unfinished tasks', query: 'has:unchecked' },
    { id: 's-week', name: 'Edited this week', query: 'edited:week' },
    { id: 's-images', name: 'With pictures', query: 'has:image' }
  ],
  workspaces: [],               // [{ id, name, layout: [{ id, bounds, open, pinned, rolled, opacity }], displayKey, updatedAt }]
  activeWorkspace: null,
  workspaceByDisplay: {},       // display setup signature -> workspace id
  autoWorkspace: true,          // switch workspace when the monitor setup changes
  autoLockMinutes: 5,           // lock private notes after this much inactivity (0 = never)
  managerBounds: null,
  welcomed: false,
  trayHintShown: false
};

const DEFAULT_TEMPLATES = [
  { id: 't-meeting', name: 'Meeting notes', color: 'blue', html: '<h2>Meeting — {{date}}</h2><p><b>Attendees:</b> {{cursor}}</p><p><b>Agenda</b></p><ul><li><br></li></ul><p><b>Notes</b></p><p><br></p><p><b>Action items</b></p><ul class="checklist"><li><br></li></ul>' },
  { id: 't-daily', name: 'Daily plan', color: 'yellow', html: '<h2>{{weekday}}, {{date}}</h2><p><b>Top 3</b></p><ul class="checklist"><li>{{cursor}}</li><li><br></li><li><br></li></ul><p><b>Schedule</b></p><ul><li><br></li></ul><p><b>Notes</b></p><p><br></p>' },
  { id: 't-habits', name: 'Daily habits (resets each day)', color: 'green', html: '<h2>Daily habits</h2><ul class="checklist" data-reset="daily"><li>{{cursor}}Drink water</li><li>Move for 30 minutes</li><li>Read 20 pages</li></ul>' },
  { id: 't-weekly', name: 'Weekly review', color: 'purple', html: '<h2>Week {{week}} review</h2><p><b>Wins</b></p><ul><li>{{cursor}}</li></ul><p><b>What got in the way</b></p><ul><li><br></li></ul><p><b>Next week</b></p><ul class="checklist"><li><br></li></ul>' },
  { id: 't-packing', name: 'Packing list', color: 'teal', html: '<h2>Packing list</h2><ul class="checklist"><li>{{cursor}}Passport / ID</li><li>Phone charger</li><li>Toiletries</li><li>Clothes</li><li>Medication</li></ul>' },
  { id: 't-shopping', name: 'Shopping list', color: 'orange', html: '<h2>Shopping — {{date}}</h2><ul class="checklist"><li>{{cursor}}</li></ul>' }
];

const IMAGE_EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/bmp': 'bmp', 'image/svg+xml': 'svg', 'image/avif': 'avif', 'image/x-icon': 'ico' };
const ATTACHMENT_RE = /sticky-img:\/\/img\/([A-Za-z0-9._-]+)/g;
const TRASH_RETENTION_MS = 30 * 24 * 3600 * 1000;
const BACKUPS_TO_KEEP = 14;

function uid() {
  return 'n' + Date.now().toString(36) + crypto.randomBytes(4).toString('hex');
}

function isBlankNote(note) {
  if (!note) return true;
  if (note.private) return false;
  if ((note.text || '').trim()) return false;
  return !/<(img|hr|table)\b/i.test(note.html || '');
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function writeFileAtomic(file, data) {
  const tmp = file + '.tmp';
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeSync(fd, data);
    fs.fsyncSync(fd); // the data must hit the disk before the rename does, or a power cut can leave an empty file
  } finally {
    fs.closeSync(fd);
  }
  // Antivirus and search indexers briefly lock files on Windows, so retry the swap.
  for (let attempt = 0; ; attempt++) {
    try { fs.renameSync(tmp, file); return; }
    catch (err) {
      if (attempt >= 6 || !['EPERM', 'EBUSY', 'EACCES'].includes(err.code)) throw err;
      sleepSync(40 * (attempt + 1));
    }
  }
}

// Attachment files are always "<24 hex chars of sha256>.<image extension>".
const ATTACHMENT_NAME_RE = /^[a-f0-9]{24}\.(png|jpg|gif|webp|bmp|svg|avif|ico)$/;
// SVGs can carry scripts when opened in a browser, so only raster images are handed to the OS.
const OPENABLE_RE = /\.(png|jpg|gif|webp|bmp|avif|ico)$/i;

class Store extends EventEmitter {
  constructor(dir) {
    super();
    this.dir = dir;
    this.notesFile = path.join(dir, 'notes.json');
    this.settingsFile = path.join(dir, 'settings.json');
    this.attachmentsDir = path.join(dir, 'attachments');
    this.backupsDir = path.join(dir, 'backups');
    this.templatesFile = path.join(dir, 'templates.json');
    this.notes = new Map();
    this.templates = [];
    this.extraRefs = []; // functions returning Sets of attachment names used elsewhere (history, …)
    this.settings = structuredClone(DEFAULT_SETTINGS);
    this._saveTimer = null;
    this._settingsTimer = null;
  }

  load() {
    for (const d of [this.dir, this.attachmentsDir, this.backupsDir]) fs.mkdirSync(d, { recursive: true });

    const notes = this._readJsonWithRecovery(this.notesFile, (d) => d && Array.isArray(d.notes));
    if (notes.data) {
      for (const raw of notes.data.notes) {
        const n = this._normalize(raw);
        this.notes.set(n.id, n);
      }
    }
    const settings = this._readJsonWithRecovery(this.settingsFile, (d) => d && typeof d === 'object' && !Array.isArray(d));
    if (settings.data) {
      const s = settings.data;
      this.settings = { ...structuredClone(DEFAULT_SETTINGS), ...s, hotkeys: { ...DEFAULT_SETTINGS.hotkeys, ...(s.hotkeys || {}) } };
    }

    const templates = this._readJsonWithRecovery(this.templatesFile, (d) => d && Array.isArray(d.templates));
    this.templates = templates.data ? templates.data.templates.filter(t => t && t.id && typeof t.html === 'string') : structuredClone(DEFAULT_TEMPLATES);
    if (!templates.data) this._writeTemplates();

    // After falling back to an older copy, unused-looking images may still belong to the
    // newer (unreadable) notes file, so don't clean anything up this session.
    this._housekeeping({ collectImages: notes.source !== 'fallback' });
    this._lastBak = Date.now();
    this._dailyBackup();
  }

  _readJsonWithRecovery(file, valid) {
    const candidates = [file, file + '.bak'];
    if (file === this.notesFile) {
      try {
        const backups = fs.readdirSync(this.backupsDir).filter(f => f.startsWith('notes-')).sort().reverse();
        candidates.push(...backups.map(b => path.join(this.backupsDir, b)));
      } catch { /* no backups yet */ }
    }
    for (let i = 0; i < candidates.length; i++) {
      const f = candidates[i];
      if (!fs.existsSync(f)) continue;
      let text = null;
      for (let attempt = 0; attempt < 4 && text === null; attempt++) {
        try { text = fs.readFileSync(f, 'utf8'); }
        catch (err) { if (attempt === 3) console.error(`[store] could not read ${f}:`, err.message); else sleepSync(120); }
      }
      if (text === null) continue; // locked, not corrupt: leave it alone and try the next copy
      let data = null;
      try { data = JSON.parse(text); } catch { data = null; }
      if (data && valid(data)) {
        if (i === 0) {
          try { fs.copyFileSync(f, f + '.bak'); } catch { /* best effort */ }
        } else {
          console.warn(`[store] recovered ${path.basename(file)} from ${f}`);
        }
        return { data, source: i === 0 ? 'primary' : 'fallback' };
      }
      if (i === 0) {
        // Keep the damaged file around so nothing is ever silently lost.
        try { fs.copyFileSync(f, `${f}.corrupt-${Date.now()}`); } catch { /* ignore */ }
        console.error(`[store] ${f} is damaged; trying backups`);
      }
    }
    const anyExisted = candidates.some(f => fs.existsSync(f));
    return { data: null, source: anyExisted ? 'fallback' : 'none' };
  }

  _normalize(raw) {
    const now = Date.now();
    const n = {
      id: typeof raw.id === 'string' && raw.id ? raw.id : uid(),
      html: typeof raw.html === 'string' ? raw.html : '',
      text: typeof raw.text === 'string' ? raw.text : '',
      title: typeof raw.title === 'string' ? raw.title : '',
      color: palette.notes[raw.color] ? raw.color : 'yellow',
      font: palette.fonts.some(f => f.id === raw.font) ? raw.font : 'default',
      bounds: raw.bounds && Number.isFinite(raw.bounds.x) ? raw.bounds : null,
      pinned: !!raw.pinned,
      rolled: !!raw.rolled,
      opacity: Number.isFinite(raw.opacity) ? Math.min(1, Math.max(0.25, raw.opacity)) : 1,
      zoom: Number.isFinite(raw.zoom) ? Math.min(3, Math.max(0.5, raw.zoom)) : 1,
      locked: !!raw.locked,
      open: raw.open !== false,
      reminder: raw.reminder && Number.isFinite(raw.reminder.at) ? raw.reminder : null,
      trashed: !!raw.trashed,
      trashedAt: raw.trashedAt || null,
      createdAt: raw.createdAt || now,
      updatedAt: raw.updatedAt || now
    };
    n.agent = raw.agent && typeof raw.agent.key === 'string' ? {
      key: raw.agent.key,
      source: String(raw.agent.source || ''),
      project: String(raw.agent.project || ''),
      title: String(raw.agent.title || ''),
      tags: Array.isArray(raw.agent.tags) ? raw.agent.tags.map(String).slice(0, 10) : []
    } : null;
    n.private = !!raw.private;
    n.cipher = raw.cipher && typeof raw.cipher.data === 'string' ? raw.cipher : null;
    n.refs = Array.isArray(raw.refs) ? raw.refs.filter(r => ATTACHMENT_NAME_RE.test(r)) : [];
    if (n.private) {
      n.html = ''; n.text = ''; n.title = ''; n.tags = []; n.links = []; n.imageText = ''; n.tasks = { total: 0, done: 0 };
      return n;
    }
    if (!n.text && n.html) n.text = htmlToText(n.html);
    if (!n.title) n.title = titleFromText(n.text);
    this._derive(n, raw);
    return n;
  }

  // Search/filter metadata derived from the HTML.
  _derive(n, given = {}) {
    n.tags = scan.extractTags(n.html);
    n.links = scan.extractLinks(n.html);
    n.imageText = typeof given.imageText === 'string' ? given.imageText : scan.extractImageText(n.html);
    n.tasks = given.tasks && Number.isFinite(given.tasks.total) ? { total: given.tasks.total, done: given.tasks.done || 0 } : scan.taskCounts(n.html);
  }

  _housekeeping({ collectImages }) {
    const now = Date.now();
    for (const n of [...this.notes.values()]) {
      // Closed notes that were never written in are just clutter.
      if (!n.trashed && !n.open && isBlankNote(n)) this.notes.delete(n.id);
      else if (n.trashed && n.trashedAt && now - n.trashedAt > TRASH_RETENTION_MS) this.notes.delete(n.id);
    }
    if (collectImages) this.gcAttachments();
  }

  _dailyBackup() {
    if (!fs.existsSync(this.notesFile)) return;
    const stamp = new Date().toISOString().slice(0, 10);
    this._backupDay = stamp;
    const target = path.join(this.backupsDir, `notes-${stamp}.json`);
    try {
      if (!fs.existsSync(target)) fs.copyFileSync(this.notesFile, target);
      const all = fs.readdirSync(this.backupsDir).filter(f => /^notes-\d{4}-\d\d-\d\d\.json$/.test(f)).sort();
      for (const old of all.slice(0, Math.max(0, all.length - BACKUPS_TO_KEEP))) fs.unlinkSync(path.join(this.backupsDir, old));
    } catch (err) {
      console.warn('[store] backup failed:', err.message);
    }
  }

  // ---------- notes ----------
  get(id) { return this.notes.get(id) || null; }
  all() { return [...this.notes.values()]; }
  active() { return this.all().filter(n => !n.trashed); }

  create(partial = {}) {
    const color = partial.color || this.pickDefaultColor();
    const note = this._normalize({
      ...partial,
      id: uid(),
      color,
      font: partial.font || this.settings.defaultFont,
      createdAt: partial.createdAt || Date.now(),
      updatedAt: partial.updatedAt || Date.now(),
      open: partial.open !== false
    });
    this.notes.set(note.id, note);
    this.saveSoon();
    this.emit('changed', { type: 'create', id: note.id });
    return note;
  }

  pickDefaultColor() {
    const d = this.settings.defaultColor;
    if (d === 'random') {
      const keys = palette.order.filter(k => k !== 'charcoal');
      return keys[Math.floor(Math.random() * keys.length)];
    }
    return palette.notes[d] ? d : 'yellow';
  }

  update(id, patch, { touch } = {}) {
    const note = this.notes.get(id);
    if (!note) return null;
    let changed = false;
    let contentChanged = false;
    for (const key of Object.keys(patch)) {
      if (!NOTE_FIELDS.includes(key)) continue;
      const before = JSON.stringify(note[key]);
      const after = JSON.stringify(patch[key]);
      if (before === after) continue;
      note[key] = patch[key];
      changed = true;
      if (CONTENT_FIELDS.has(key)) contentChanged = true;
    }
    if (!changed) return note;
    if (!note.private) {
      if ('html' in patch && !('text' in patch)) note.text = htmlToText(note.html);
      if ('html' in patch || 'text' in patch) note.title = patch.title || titleFromText(note.text);
      if ('html' in patch) this._derive(note, patch);
    }
    if (contentChanged || touch) note.updatedAt = Date.now();
    this.saveSoon();
    this.emit('changed', { type: 'update', id, keys: Object.keys(patch) });
    return note;
  }

  trash(id) {
    const n = this.update(id, { trashed: true, trashedAt: Date.now(), open: false });
    return n;
  }

  restore(id) {
    return this.update(id, { trashed: false, trashedAt: null });
  }

  purge(id) {
    if (!this.notes.delete(id)) return false;
    this.saveSoon();
    this.emit('changed', { type: 'purge', id });
    return true;
  }

  // ---------- settings ----------
  updateSettings(patch) {
    const next = { ...this.settings, ...patch };
    if (patch.hotkeys) next.hotkeys = { ...this.settings.hotkeys, ...patch.hotkeys };
    this.settings = next;
    clearTimeout(this._settingsTimer);
    this._settingsTimer = setTimeout(() => this._writeSettings(), 300);
    this.emit('settings', this.settings);
    return this.settings;
  }

  _writeSettings() {
    try { writeFileAtomic(this.settingsFile, JSON.stringify(this.settings, null, 2)); }
    catch (err) { console.error('[store] settings write failed:', err); }
  }

  // ---------- persistence ----------
  saveSoon() {
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => this.saveNow(), 400);
  }

  saveNow() {
    clearTimeout(this._saveTimer);
    this._saveTimer = null;
    try {
      // Refresh the recovery copy hourly and the dated backup daily: a tray app can run for weeks.
      if (Date.now() - (this._lastBak || 0) > 3600 * 1000 && fs.existsSync(this.notesFile)) {
        try { fs.copyFileSync(this.notesFile, this.notesFile + '.bak'); } catch { /* best effort */ }
        this._lastBak = Date.now();
      }
      const payload = { version: 2, savedAt: Date.now(), notes: this.all() };
      writeFileAtomic(this.notesFile, JSON.stringify(payload));
      if (this._backupDay !== new Date().toISOString().slice(0, 10)) this._dailyBackup();
    } catch (err) {
      console.error('[store] notes write failed:', err);
    }
  }

  flush() {
    this.saveNow();
    if (this._settingsTimer) { clearTimeout(this._settingsTimer); this._writeSettings(); }
  }

  // ---------- attachments ----------
  saveAttachment(bytes, mime) {
    const buf = Buffer.from(bytes);
    if (!buf.length) throw new Error('Empty image');
    if (buf.length > 40 * 1024 * 1024) throw new Error('Image is larger than 40 MB');
    const ext = IMAGE_EXT[String(mime).toLowerCase()] || sniffImageExt(buf);
    if (!ext) throw new Error('Unsupported image type');
    const hash = crypto.createHash('sha256').update(buf).digest('hex').slice(0, 24);
    const name = `${hash}.${ext}`;
    const file = path.join(this.attachmentsDir, name);
    if (!fs.existsSync(file)) fs.writeFileSync(file, buf);
    return { name, url: `sticky-img://img/${name}` };
  }

  attachmentPath(name) {
    if (!ATTACHMENT_NAME_RE.test(String(name))) return null;
    const file = path.join(this.attachmentsDir, name);
    return path.dirname(file) === this.attachmentsDir ? file : null;
  }

  attachmentFromUrl(url) {
    const m = /^sticky-img:\/\/img\/([A-Za-z0-9._-]+)$/.exec(String(url || ''));
    return m ? this.attachmentPath(m[1]) : null;
  }

  referencedAttachments({ publicOnly = false } = {}) {
    const refs = new Set();
    const add = (html) => { for (const m of String(html || '').matchAll(ATTACHMENT_RE)) refs.add(m[1]); };
    for (const n of this.notes.values()) {
      if (n.private) { if (!publicOnly) n.refs.forEach(r => refs.add(r)); continue; }
      add(n.html);
    }
    for (const t of this.templates) add(t.html);
    for (const fn of this.extraRefs) { try { for (const r of fn()) refs.add(r); } catch { /* ignore */ } }
    return refs;
  }

  // ---------- templates ----------
  _writeTemplates() {
    try { writeFileAtomic(this.templatesFile, JSON.stringify({ version: 1, templates: this.templates }, null, 1)); }
    catch (err) { console.error('[store] templates write failed:', err); }
  }

  getTemplate(id) { return this.templates.find(t => t.id === id) || null; }

  saveTemplate({ id, name, html, color }) {
    const existing = id && this.getTemplate(id);
    const t = existing || { id: 't' + Date.now().toString(36) + crypto.randomBytes(3).toString('hex') };
    if (typeof name === 'string') t.name = name.slice(0, 80) || 'Template';
    if (typeof html === 'string') t.html = html;
    if (palette.notes[color]) t.color = color;
    if (!existing) this.templates.push(t);
    this._writeTemplates();
    this.emit('templates', this.templates);
    return t;
  }

  deleteTemplate(id) {
    this.templates = this.templates.filter(t => t.id !== id);
    this._writeTemplates();
    this.emit('templates', this.templates);
  }

  gcAttachments() {
    try {
      const refs = this.referencedAttachments();
      const dayAgo = Date.now() - 24 * 3600 * 1000;
      for (const f of fs.readdirSync(this.attachmentsDir)) {
        // "<name>.txt" (recognized text) and "<name>.enc" (encrypted image) follow their image.
        if (refs.has(f.replace(/\.(txt|enc)$/, ''))) continue;
        const full = path.join(this.attachmentsDir, f);
        // Leave recent files alone: they may belong to an edit that hasn't been saved yet.
        if (fs.statSync(full).mtimeMs < dayAgo) fs.unlinkSync(full);
      }
    } catch (err) {
      console.warn('[store] attachment gc failed:', err.message);
    }
  }
}

function sniffImageExt(buf) {
  if (buf[0] === 0x89 && buf[1] === 0x50) return 'png';
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'jpg';
  if (buf.slice(0, 3).toString() === 'GIF') return 'gif';
  if (buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP') return 'webp';
  if (buf[0] === 0x42 && buf[1] === 0x4d) return 'bmp';
  return null;
}

module.exports = { Store, htmlToText, titleFromText, isBlankNote, writeFileAtomic, DEFAULT_SETTINGS, DEFAULT_TEMPLATES, IMAGE_EXT, ATTACHMENT_RE, ATTACHMENT_NAME_RE, OPENABLE_RE, sniffImageExt };
