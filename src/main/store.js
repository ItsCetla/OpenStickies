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
  'agent',
  // up to MAX_TABS tabs: [{ id, title, renamed, html, text, scroll }], or null for the usual single page.
  // html/text/title above always mirror tabs[activeTab] so everything that reads them keeps working.
  'tabs',
  'activeTab',
  // custom note background (solid / gradient / image); null = the palette color
  'background'
];

const MAX_TABS = 3;

// Fields whose change counts as a content edit (bumps updatedAt).
const CONTENT_FIELDS = new Set(['html', 'color', 'font', 'background']);

const DEFAULT_SETTINGS = {
  theme: 'system',            // 'system' | 'light' | 'dark'
  language: 'system',         // 'system' or a supported locale code (see i18n.js)
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
  trayHintShown: false,
  reminderSound: 'chime',       // 'chime' | 'soft' | 'none'
  snapToGrid: false,
  gridSize: 24
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
// Trash is a size cap rather than an age limit, so nothing vanishes just because time passed.
const TRASH_LIMIT = 300;
const BACKUPS_TO_KEEP = 14;

function uid() {
  return 'n' + Date.now().toString(36) + crypto.randomBytes(4).toString('hex');
}

function tabId() {
  return 'b' + Date.now().toString(36) + crypto.randomBytes(4).toString('hex');
}

// Tolerant reader for the `tabs` field. Anything that isn't at least two usable tabs means
// "no tabs", which is exactly how notes from before tabs existed behave.
function normalizeTabs(raw, active) {
  if (!Array.isArray(raw)) return null;
  const seen = new Set();
  const tabs = [];
  for (const t of raw) {
    if (!t || typeof t !== 'object' || tabs.length >= MAX_TABS) continue;
    const html = typeof t.html === 'string' ? t.html : '';
    const text = typeof t.text === 'string' && (t.text || !html) ? t.text : htmlToText(html);
    let id = typeof t.id === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(t.id) ? t.id : tabId();
    if (seen.has(id)) id = tabId();
    seen.add(id);
    const custom = typeof t.title === 'string' ? t.title.replace(/\s+/g, ' ').trim().slice(0, 80) : '';
    const renamed = !!t.renamed && !!custom;
    tabs.push({
      id,
      title: renamed ? custom : titleFromText(text),
      renamed,
      html,
      text,
      scroll: Number.isFinite(t.scroll) && t.scroll > 0 ? Math.round(t.scroll) : 0
    });
  }
  if (tabs.length < 2) return null;
  const i = Number.isInteger(active) ? Math.min(tabs.length - 1, Math.max(0, active)) : 0;
  return { tabs, activeTab: i };
}

function isBlankNote(note) {
  if (!note) return true;
  if (note.private) return false;
  if (Array.isArray(note.tabs) && note.tabs.length > 1) return note.tabs.every(t => isBlankNote({ text: t.text, html: t.html }));
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
const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;
// SVGs can carry scripts when opened in a browser, so only raster images are handed to the OS.
const OPENABLE_RE = /\.(png|jpg|gif|webp|bmp|avif|ico)$/i;

const REMINDER_REPEATS = ['none', 'daily', 'weekdays', 'weekly', 'monthly'];

// Shared by load, backup restore and IPC patches so a hand-edited or foreign repeat value
// can never reach Reminders.check (an unknown repeat used to refire every tick).
function cleanReminder(r) {
  if (!r || typeof r !== 'object' || !Number.isFinite(r.at)) return null;
  return {
    at: r.at,
    repeat: REMINDER_REPEATS.includes(r.repeat) ? r.repeat : 'none',
    pending: !!r.pending,
    snoozeAt: Number.isFinite(r.snoozeAt) ? r.snoozeAt : null,
    dom: Number.isInteger(r.dom) && r.dom >= 1 && r.dom <= 31 ? r.dom : new Date(r.at).getDate(),
    // When the countdown started; drives the border urgency colour. Callers fill in a default.
    setAt: Number.isFinite(r.setAt) ? r.setAt : null
  };
}

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
    this.trashedTabs = []; // tabs closed from a note: [{ id, noteId, noteTitle, title, html, text, trashedAt }]
    this.templates = [];
    this.extraRefs = []; // functions returning Sets of attachment names used elsewhere (history, …)
    this.onDropped = null; // called with ids that housekeeping removed, so their history goes too
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
      this.trashedTabs = Array.isArray(notes.data.trashedTabs) ? notes.data.trashedTabs.map(t => this._normalizeTrashedTab(t)).filter(Boolean) : [];
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
      reminder: cleanReminder(raw.reminder),
      trashed: !!raw.trashed,
      trashedAt: raw.trashedAt || null,
      createdAt: raw.createdAt || now,
      updatedAt: raw.updatedAt || now
    };
    // Older files have no setAt; the note's creation time is the best guess for when the countdown began.
    if (n.reminder && !Number.isFinite(n.reminder.setAt)) n.reminder = { ...n.reminder, setAt: Math.min(n.createdAt, n.reminder.at) };
    n.agent = raw.agent && typeof raw.agent.key === 'string' ? {
      key: raw.agent.key,
      source: String(raw.agent.source || ''),
      project: String(raw.agent.project || ''),
      title: String(raw.agent.title || ''),
      tags: Array.isArray(raw.agent.tags) ? raw.agent.tags.map(String).slice(0, 10) : []
    } : null;
    n.background = this.normalizeBackground(raw.background);
    n.private = !!raw.private;
    n.cipher = raw.cipher && typeof raw.cipher.data === 'string' ? raw.cipher : null;
    n.refs = Array.isArray(raw.refs) ? raw.refs.filter(r => ATTACHMENT_NAME_RE.test(r)) : [];
    // A private note's tabs live inside `cipher` (see main.js savePrivate); the record keeps none.
    const tabbed = n.private ? null : normalizeTabs(raw.tabs, raw.activeTab);
    n.tabs = tabbed ? tabbed.tabs : null;
    n.activeTab = tabbed ? tabbed.activeTab : 0;
    if (n.private) {
      n.html = ''; n.text = ''; n.title = ''; n.tags = []; n.links = []; n.imageText = ''; n.tasks = { total: 0, done: 0 };
      return n;
    }
    if (n.tabs) this._mirrorActiveTab(n);
    if (!n.text && n.html) n.text = htmlToText(n.html);
    if (!n.title) n.title = titleFromText(n.text);
    this._derive(n, raw);
    return n;
  }

  // Search/filter metadata derived from the HTML.
  _derive(n, given = {}) {
    if (n.tabs) {
      // Tags, links, picture text and task counts describe the whole note, so a search for
      // "#work" or "has:unchecked" finds it whichever tab holds the match.
      const all = n.tabs.map(t => t.html).join('\n');
      n.tags = scan.extractTags(all);
      n.links = scan.extractLinks(all);
      n.imageText = scan.extractImageText(all);
      n.tasks = scan.taskCounts(all);
      return;
    }
    n.tags = scan.extractTags(n.html);
    n.links = scan.extractLinks(n.html);
    n.imageText = typeof given.imageText === 'string' ? given.imageText : scan.extractImageText(n.html);
    n.tasks = given.tasks && Number.isFinite(given.tasks.total) ? { total: given.tasks.total, done: given.tasks.done || 0 } : scan.taskCounts(n.html);
  }

  _housekeeping({ collectImages }) {
    // No 'purge' event fires here (nothing listens yet), so dropped ids go to onDropped instead.
    const dropped = [];
    for (const n of [...this.notes.values()]) {
      // Closed notes that were never written in are just clutter.
      if (!n.trashed && !n.open && isBlankNote(n)) { this.notes.delete(n.id); dropped.push(n.id); }
    }
    for (const id of this._trashOverflow()) { this.notes.delete(id); dropped.push(id); }
    this._capTrashedTabs();
    if (dropped.length && this.onDropped) this.onDropped(dropped);
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
      if (CONTENT_FIELDS.has(key) || key === 'tabs') contentChanged = true;
    }
    if (!changed) return note;
    // How tabs stay in sync (see _syncTabs): a patch carrying `tabs`/`activeTab` is the source
    // of truth and html/text/title are re-mirrored from the active tab; a plain html/text/title
    // patch (the note window's autosave, history restore, the local API…) edits the active tab.
    const tabsPatch = 'tabs' in patch || 'activeTab' in patch;
    if (note.private) { note.tabs = null; note.activeTab = 0; }
    else if (tabsPatch) this._syncTabs(note);
    if (!note.private && !tabsPatch) {
      if ('html' in patch && !('text' in patch)) note.text = htmlToText(note.html);
      if ('html' in patch || 'text' in patch) note.title = patch.title || titleFromText(note.text);
      if (note.tabs && ('html' in patch || 'text' in patch || 'title' in patch)) this._writeActiveTab(note);
      if ('html' in patch) this._derive(note, patch);
    }
    if (contentChanged || touch) note.updatedAt = Date.now();
    this.saveSoon();
    this.emit('changed', { type: 'update', id, keys: Object.keys(patch) });
    return note;
  }

  trash(id) {
    const n = this.update(id, { trashed: true, trashedAt: Date.now(), open: false });
    if (n) for (const old of this._trashOverflow()) this.purge(old);
    return n;
  }

  // For callers that add trashed notes without trash(), such as import.
  capTrash() {
    for (const id of this._trashOverflow()) this.purge(id);
  }

  // Ids of the oldest trashed notes beyond TRASH_LIMIT.
  _trashOverflow() {
    const trashed = [...this.notes.values()].filter(n => n.trashed);
    if (trashed.length <= TRASH_LIMIT) return [];
    trashed.sort((a, b) => (b.trashedAt || 0) - (a.trashedAt || 0));
    return trashed.slice(TRASH_LIMIT).map(n => n.id);
  }

  // Closed tabs share the same limit: keep the newest TRASH_LIMIT, drop the rest.
  _capTrashedTabs() {
    if (this.trashedTabs.length <= TRASH_LIMIT) return;
    this.trashedTabs.sort((a, b) => (b.trashedAt || 0) - (a.trashedAt || 0));
    this.trashedTabs.length = TRASH_LIMIT;
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
      const payload = { version: 2, savedAt: Date.now(), notes: this.all(), trashedTabs: this.trashedTabs };
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

  // Validates a note background. Anything malformed becomes null (the palette color), so a
  // hand-edited or older notes.json can never inject arbitrary CSS into the renderer.
  normalizeBackground(bg) {
    if (!bg || typeof bg !== 'object') return null;
    const hex = (c) => (typeof c === 'string' && HEX_COLOR_RE.test(c) ? c.toLowerCase() : null);
    const num = (v, lo, hi, def) => (Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Math.round(Number(v)))) : def);
    if (bg.type === 'solid') {
      const color = hex(bg.color);
      return color ? { type: 'solid', color } : null;
    }
    if (bg.type === 'gradient') {
      const from = hex(bg.from);
      const to = hex(bg.to);
      return from && to ? { type: 'gradient', from, to, angle: num(bg.angle, 0, 360, 135) } : null;
    }
    if (bg.type === 'image') {
      const file = this.attachmentFromUrl(bg.src);
      // Only images we actually hold (plain, or encrypted for a private note); a dangling
      // reference would just render an empty note.
      if (!file || !(fs.existsSync(file) || fs.existsSync(file + '.enc'))) return null;
      const fit = ['cover', 'contain', 'tile'].includes(bg.fit) ? bg.fit : 'cover';
      return { type: 'image', src: `sticky-img://img/${path.basename(file)}`, fit, dim: num(bg.dim, 0, 80, 0) };
    }
    return null;
  }

  referencedAttachments({ publicOnly = false } = {}) {
    const refs = new Set();
    const add = (html) => { for (const m of String(html || '').matchAll(ATTACHMENT_RE)) refs.add(m[1]); };
    for (const n of this.notes.values()) {
      const bgFile = n.background && n.background.type === 'image' ? this.attachmentFromUrl(n.background.src) : null;
      const bgName = bgFile ? path.basename(bgFile) : null;
      if (n.private) {
        // A private note's background is encrypted along with its other pictures (it's in
        // `refs` once the note was saved while unlocked), so it never counts as a public use.
        if (!publicOnly) { n.refs.forEach(r => refs.add(r)); if (bgName) refs.add(bgName); }
        continue;
      }
      if (bgName) refs.add(bgName);
      add(n.html);
      if (n.tabs) n.tabs.forEach(t => add(t.html));
    }
    for (const t of this.trashedTabs) add(t.html);
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

  // ---------- tabs ----------
  // The note-level html/text/title are a copy of the active tab, so code that predates tabs
  // (history, export, reminders, the local API, the notes list) sees "the page you're looking at".
  _mirrorActiveTab(note) {
    const tab = note.tabs && note.tabs[note.activeTab];
    if (!tab) return;
    note.html = tab.html;
    note.text = tab.text;
    note.title = tab.title;
  }

  // An edit to html/text/title lands in the active tab. A tab the user renamed keeps its name.
  _writeActiveTab(note) {
    const tab = note.tabs && note.tabs[note.activeTab];
    if (!tab) return;
    tab.html = note.html;
    tab.text = note.text;
    if (tab.renamed) note.title = tab.title;
    else tab.title = titleFromText(note.text);
  }

  // After a patch that set `tabs`/`activeTab` directly: validate them and re-mirror the note.
  _syncTabs(note) {
    const raw = note.tabs;
    const tabbed = normalizeTabs(raw, note.activeTab);
    if (tabbed) {
      note.tabs = tabbed.tabs;
      note.activeTab = tabbed.activeTab;
      this._mirrorActiveTab(note);
    } else {
      // Down to one tab: the note goes back to being a plain single-page note.
      const only = Array.isArray(raw) ? raw.find(t => t && typeof t.html === 'string') : null;
      note.tabs = null;
      note.activeTab = 0;
      if (only) {
        note.html = only.html;
        note.text = typeof only.text === 'string' && only.text ? only.text : htmlToText(only.html);
        note.title = titleFromText(note.text);
      }
    }
    this._derive(note, {});
  }

  // Everything search should look at, across all tabs (the note-level fields only hold one).
  searchText(note) {
    if (!note) return '';
    if (!note.tabs) return `${note.title || ''}\n${note.text || ''}`;
    return note.tabs.map(t => `${t.title}\n${t.text}`).join('\n');
  }

  _normalizeTrashedTab(t) {
    if (!t || typeof t !== 'object' || typeof t.html !== 'string') return null;
    const text = typeof t.text === 'string' ? t.text : htmlToText(t.html);
    return {
      id: typeof t.id === 'string' && t.id ? t.id : tabId(),
      noteId: typeof t.noteId === 'string' ? t.noteId : '',
      noteTitle: typeof t.noteTitle === 'string' ? t.noteTitle.slice(0, 120) : '',
      title: typeof t.title === 'string' && t.title ? t.title.slice(0, 80) : titleFromText(text),
      renamed: !!t.renamed,
      html: t.html,
      text,
      trashedAt: Number.isFinite(t.trashedAt) ? t.trashedAt : Date.now()
    };
  }

  // Close one tab of a note (by id). A tab with something in it goes to the Trash so it can
  // be brought back; the last tab can't be closed. Returns the note, or null if nothing changed.
  trashTab(noteId, id) {
    const note = this.notes.get(noteId);
    if (!note || !note.tabs || note.tabs.length < 2) return null;
    const i = note.tabs.findIndex(t => t.id === id);
    if (i < 0) return null;
    const tab = note.tabs[i];
    if (!isBlankNote({ text: tab.text, html: tab.html })) {
      const otherTitles = note.tabs.filter((_, j) => j !== i).map(t => t.title).filter(Boolean);
      this.trashedTabs.push(this._normalizeTrashedTab({
        ...tab, id: tabId(), noteId, noteTitle: otherTitles[0] || note.title, trashedAt: Date.now()
      }));
      this._capTrashedTabs();
    }
    const rest = note.tabs.filter((_, j) => j !== i).map(t => ({ ...t }));
    let active = note.activeTab;
    if (i < active) active--;
    else if (i === active) active = Math.min(i, rest.length - 1);
    return this.update(noteId, { tabs: rest, activeTab: active }, { touch: true });
  }

  listTrashedTabs() {
    return this.trashedTabs.slice().sort((a, b) => b.trashedAt - a.trashedAt);
  }

  // Put a closed tab back: into its own note while that note is around and has room, otherwise
  // as a note of its own. Returns { noteId, created } or null.
  restoreTab(id) {
    const i = this.trashedTabs.findIndex(t => t.id === id);
    if (i < 0) return null;
    const t = this.trashedTabs[i];
    const note = this.notes.get(t.noteId);
    const count = note ? (note.tabs ? note.tabs.length : 1) : 0;
    let result;
    if (note && !note.trashed && !note.private && count < MAX_TABS) {
      const tabs = note.tabs
        ? note.tabs.map(x => ({ ...x }))
        : [{ id: tabId(), title: note.title, renamed: false, html: note.html, text: note.text, scroll: 0 }];
      tabs.push({ id: tabId(), title: t.title, renamed: t.renamed, html: t.html, text: t.text, scroll: 0 });
      this.trashedTabs.splice(i, 1);
      this.update(note.id, { tabs, activeTab: tabs.length - 1 }, { touch: true });
      result = { noteId: note.id, created: false };
    } else {
      this.trashedTabs.splice(i, 1);
      const created = this.create({ html: t.html, text: t.text, color: note ? note.color : undefined, open: false });
      result = { noteId: created.id, created: true };
    }
    this.saveSoon();
    this.emit('changed', { type: 'tab-restore', id: result.noteId });
    return result;
  }

  purgeTab(id) {
    const before = this.trashedTabs.length;
    this.trashedTabs = this.trashedTabs.filter(t => t.id !== id);
    if (this.trashedTabs.length === before) return false;
    this.saveSoon();
    this.emit('changed', { type: 'tab-purge', id });
    return true;
  }

  emptyTrashedTabs() {
    if (!this.trashedTabs.length) return;
    this.trashedTabs = [];
    this.saveSoon();
    this.emit('changed', { type: 'tab-purge', id: null });
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

module.exports = { Store, cleanReminder, htmlToText, titleFromText, isBlankNote, writeFileAtomic, DEFAULT_SETTINGS, DEFAULT_TEMPLATES, IMAGE_EXT, ATTACHMENT_RE, ATTACHMENT_NAME_RE, OPENABLE_RE, sniffImageExt, MAX_TABS, normalizeTabs };
