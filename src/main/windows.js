'use strict';

const { BrowserWindow, screen, nativeTheme } = require('electron');
const path = require('path');
const palette = require('../renderer/shared/colors.json');
const { isBlankNote } = require('./store');

const HEADER_H = 34;
const DEFAULT_W = 320;
const DEFAULT_H = 340;
const MIN_W = 200;
const MIN_H = 130;
const SNAP = 14;
const WM_NCLBUTTONDBLCLK = 0x00a3;

class WindowManager {
  constructor({ store, preload, icon, isDev }) {
    this.store = store;
    this.preload = preload;
    this.icon = icon;
    this.isDev = isDev;
    this.notes = new Map();          // noteId -> BrowserWindow
    this.owners = new Map();         // webContents.id -> noteId
    this.manager = null;
    this.quitting = false;
    this.allHidden = false;
    this._boundsTimers = new Map();
    this._pendingCloses = new Map();
  }

  // ---------- theme helpers ----------
  theme() {
    const t = this.store.settings.theme;
    if (t === 'light' || t === 'dark') return t;
    return nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
  }

  colorsFor(note) {
    const entry = palette.notes[note.color] || palette.notes.yellow;
    return entry[this.theme()];
  }

  webPreferences() {
    return {
      preload: this.preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: !!this.store.settings.spellcheck,
      devTools: this.isDev
    };
  }

  // ---------- note windows ----------
  noteIdFor(webContents) {
    return this.owners.get(webContents.id) || null;
  }

  windowFor(noteId) {
    const w = this.notes.get(noteId);
    return w && !w.isDestroyed() ? w : null;
  }

  openNote(noteId, { focus = true, inactive = false } = {}) {
    const note = this.store.get(noteId);
    if (!note) return null;
    this.allHidden = false; // otherwise a note opened after "Hide all" would never appear
    if (note.trashed) this.store.restore(noteId);
    if (!note.open) this.store.update(noteId, { open: true });
    let win = this.windowFor(noteId);
    if (win) {
      if (focus) this.bringToFront(win);
      else if (!win.isVisible()) win.showInactive();
      return win;
    }
    win = this._createNoteWindow(note, { focus: focus && !inactive });
    return win;
  }

  _createNoteWindow(note, { focus }) {
    if (!note.bounds) {
      this.store.update(note.id, { bounds: this.placeNewBounds(null) });
    }
    const b = this.ensureVisible(note.bounds);
    const colors = this.colorsFor(note);
    const win = new BrowserWindow({
      x: b.x,
      y: b.y,
      width: b.width,
      height: note.rolled ? HEADER_H : b.height,
      minWidth: MIN_W,
      minHeight: note.rolled ? HEADER_H : MIN_H,
      maxHeight: note.rolled ? HEADER_H : undefined,
      frame: false,
      show: false,
      backgroundColor: colors.bg,
      skipTaskbar: !this.store.settings.showInTaskbar,
      maximizable: false,
      fullscreenable: false,
      alwaysOnTop: note.pinned,
      title: note.title || 'Sticky note',
      icon: this.icon,
      webPreferences: this.webPreferences()
    });

    const wcId = win.webContents.id;
    this.notes.set(note.id, win);
    this.owners.set(wcId, note.id);
    if (note.pinned) win.setAlwaysOnTop(true, 'floating');

    win.loadURL('app://stickies/note/note.html');
    win.once('ready-to-show', () => {
      win.setOpacity(note.opacity || 1);
      if (note.opacity < 1) this.startHoverWatch();
      if (this.allHidden) return;
      if (focus) { win.show(); win.focus(); } else win.showInactive();
    });

    const saveBounds = () => this._queueBoundsSave(note.id, win);
    win.on('focus', () => { this.lastFocusedNoteId = note.id; });
    win.on('resize', saveBounds);
    win.on('move', saveBounds);
    win.on('moved', () => {
      if (this.store.settings.snapToEdges) this.snap(win, note.id);
      saveBounds();
    });

    if (process.platform === 'win32') {
      // Double-clicking the title bar rolls the note up, like classic Stickies.
      win.hookWindowMessage(WM_NCLBUTTONDBLCLK, () => {
        setImmediate(() => this.toggleRoll(note.id));
      });
      win.on('system-context-menu', (e) => {
        e.preventDefault();
        const current = this.store.get(note.id);
        if (current) require('./context-menu').buildNoteMenu({ note: current, windows: this, noteId: note.id }).popup({ window: win });
      });
    }

    win.on('close', (e) => {
      if (this.quitting || win.__allowClose) return;
      // Give the renderer a moment to flush its last keystrokes before the window goes away.
      e.preventDefault();
      this.closeNote(note.id);
    });

    win.on('closed', () => {
      this.owners.delete(wcId);
      if (this.notes.get(note.id) === win) this.notes.delete(note.id);
      clearTimeout(this._boundsTimers.get(note.id));
      this._boundsTimers.delete(note.id);
    });

    win.webContents.on('will-navigate', (e) => e.preventDefault());
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    if (this.onNoteWindow) this.onNoteWindow(win, note.id);
    return win;
  }

  _queueBoundsSave(noteId, win) {
    clearTimeout(this._boundsTimers.get(noteId));
    this._boundsTimers.set(noteId, setTimeout(() => {
      if (win.isDestroyed() || win.isMinimized()) return;
      const note = this.store.get(noteId);
      if (!note) return;
      const cur = win.getBounds();
      const height = note.rolled ? (note.bounds ? note.bounds.height : DEFAULT_H) : cur.height;
      this.store.update(noteId, { bounds: { x: cur.x, y: cur.y, width: cur.width, height } });
    }, 250));
  }

  async flushRenderer(win, timeout = 800) {
    if (!win || win.isDestroyed()) return;
    try {
      await Promise.race([
        win.webContents.executeJavaScript('window.__stickiesFlush ? window.__stickiesFlush() : null', true),
        new Promise(r => setTimeout(r, timeout))
      ]);
    } catch { /* renderer gone */ }
  }

  async closeNote(noteId) {
    if (this._pendingCloses.has(noteId)) return this._pendingCloses.get(noteId);
    const p = (async () => {
      const win = this.windowFor(noteId);
      await this.flushRenderer(win);
      const note = this.store.get(noteId);
      if (note) {
        if (isBlankNote(note)) this.store.purge(noteId);
        else this.store.update(noteId, { open: false });
      }
      if (win && !win.isDestroyed()) { win.__allowClose = true; win.close(); }
    })().finally(() => this._pendingCloses.delete(noteId));
    this._pendingCloses.set(noteId, p);
    return p;
  }

  async trashNote(noteId) {
    const win = this.windowFor(noteId);
    await this.flushRenderer(win, 400);
    const note = this.store.get(noteId);
    if (note && isBlankNote(note)) this.store.purge(noteId);
    else this.store.trash(noteId);
    if (win && !win.isDestroyed()) { win.__allowClose = true; win.close(); }
  }

  destroyWindowFor(noteId) {
    const win = this.windowFor(noteId);
    if (win) { win.__allowClose = true; win.close(); }
  }

  bringToFront(win) {
    if (!win || win.isDestroyed()) return;
    if (win.isMinimized()) win.restore();
    if (!win.isVisible()) win.show();
    win.moveTop();
    win.focus();
  }

  newNote({ fromId = null, html = '', color, focus = true } = {}) {
    const from = fromId ? this.store.get(fromId) : null;
    const note = this.store.create({
      html,
      color: color || undefined,
      bounds: this.placeNewBounds(from),
      open: true
    });
    this.allHidden = false;
    this.openNote(note.id, { focus });
    return note;
  }

  async duplicateNote(noteId) {
    await this.flushRenderer(this.windowFor(noteId), 600); // include the last few keystrokes
    const src = this.store.get(noteId);
    if (!src) return null;
    const note = this.store.create({
      html: src.html, text: src.text, color: src.color, font: src.font,
      private: src.private, cipher: src.cipher, refs: src.refs,
      opacity: src.opacity, zoom: src.zoom, bounds: this.placeNewBounds(src), open: true
    });
    this.openNote(note.id);
    return note;
  }

  // Put a note where a workspace says it belongs (used when switching workspaces).
  applyLayoutEntry(noteId, entry) {
    const note = this.store.get(noteId);
    if (!note) return;
    const bounds = entry.bounds ? this.ensureVisible(entry.bounds) : note.bounds;
    this.store.update(noteId, { bounds, pinned: !!entry.pinned, rolled: !!entry.rolled, opacity: entry.opacity || 1, open: true });
    const win = this.windowFor(noteId);
    if (!win) { this.openNote(noteId, { focus: false }); return; }
    win.setBounds({ x: bounds.x, y: bounds.y, width: bounds.width, height: entry.rolled ? HEADER_H : bounds.height });
    this.applyNoteProps(noteId, ['pinned', 'opacity', 'rolled']);
    this.sendToNote(noteId, 'note:changed', { pinned: !!entry.pinned, rolled: !!entry.rolled, opacity: entry.opacity || 1 });
    if (!win.isVisible()) win.showInactive();
  }

  // ---------- version history window ----------
  openHistory(noteId) {
    const existing = this.historyWindows && this.historyWindows.get(noteId);
    if (existing && !existing.isDestroyed()) { this.bringToFront(existing); return existing; }
    this.historyWindows = this.historyWindows || new Map();
    const dark = this.theme() === 'dark';
    const note = this.store.get(noteId);
    const win = new BrowserWindow({
      width: 820,
      height: 600,
      minWidth: 560,
      minHeight: 380,
      show: false,
      title: `History — ${(note && note.title) || 'Sticky note'}`,
      icon: this.icon,
      backgroundColor: dark ? '#1f1f22' : '#f7f6f3',
      titleBarStyle: 'hidden',
      titleBarOverlay: this._overlay(),
      webPreferences: { ...this.webPreferences(), spellcheck: false }
    });
    this.historyWindows.set(noteId, win);
    this.historyOwners = this.historyOwners || new Map();
    this.historyOwners.set(win.webContents.id, noteId);
    const wcId = win.webContents.id;
    win.loadURL('app://stickies/history/history.html');
    win.once('ready-to-show', () => { win.show(); win.focus(); });
    win.on('closed', () => { this.historyWindows.delete(noteId); this.historyOwners.delete(wcId); });
    win.webContents.on('will-navigate', (e) => e.preventDefault());
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    return win;
  }

  historyNoteFor(webContents) {
    return (this.historyOwners && this.historyOwners.get(webContents.id)) || null;
  }

  showAll() {
    this.allHidden = false;
    const open = this.store.active().filter(n => n.open);
    if (!open.length) { this.openManager(); return; }
    let last = null;
    for (const n of open) {
      const win = this.windowFor(n.id) || this._createNoteWindow(n, { focus: false });
      if (win.webContents.isLoading()) win.once('ready-to-show', () => { win.showInactive(); win.moveTop(); });
      else { if (!win.isVisible() || win.isMinimized()) win.showInactive(); win.moveTop(); }
      last = win;
    }
    if (last && !last.webContents.isLoading()) last.focus();
  }

  hideAll() {
    this.allHidden = true;
    for (const win of this.notes.values()) if (!win.isDestroyed()) win.hide();
  }

  toggleAll() {
    const anyVisible = [...this.notes.values()].some(w => !w.isDestroyed() && w.isVisible());
    if (anyVisible) this.hideAll(); else this.showAll();
  }

  restoreOpenNotes() {
    for (const n of this.store.active().filter(n => n.open)) this.openNote(n.id, { focus: false });
  }

  // ---------- per-note window props ----------
  applyNoteProps(noteId, keys) {
    const win = this.windowFor(noteId);
    const note = this.store.get(noteId);
    if (!win || !note) return;
    if (keys.includes('pinned')) win.setAlwaysOnTop(!!note.pinned, 'floating');
    if (keys.includes('opacity')) {
      win.setOpacity(note.opacity || 1);
      win.__opacityPreviewUntil = Date.now() + 1500; // let the user see the new opacity while dragging the slider
      if (note.opacity < 1) this.startHoverWatch();
    }
    if (keys.includes('color')) win.setBackgroundColor(this.colorsFor(note).bg);
    if (keys.includes('title')) win.setTitle(note.title || 'Sticky note');
    if (keys.includes('rolled')) this._applyRoll(win, note);
  }

  // Translucent notes turn solid while the cursor is over them. Polling the cursor is more
  // reliable than renderer mouse events, which never fire over the draggable title bar.
  startHoverWatch() {
    if (this._hoverTimer) return;
    this._hoverTimer = setInterval(() => this._hoverTick(), 200);
  }

  _hoverTick() {
    const pt = screen.getCursorScreenPoint();
    let any = false;
    for (const [id, win] of this.notes) {
      if (win.isDestroyed()) continue;
      const note = this.store.get(id);
      if (!note || note.opacity >= 1) continue;
      any = true;
      const b = win.getBounds();
      const inside = pt.x >= b.x && pt.x < b.x + b.width && pt.y >= b.y && pt.y < b.y + b.height;
      const previewing = win.__opacityPreviewUntil && Date.now() < win.__opacityPreviewUntil;
      const want = inside && this.store.settings.opaqueOnHover && !previewing ? 1 : note.opacity;
      if (Math.abs(win.getOpacity() - want) > 0.01) win.setOpacity(want);
    }
    if (!any) { clearInterval(this._hoverTimer); this._hoverTimer = null; }
  }

  toggleRoll(noteId) {
    const note = this.store.get(noteId);
    if (!note) return;
    if (!note.rolled) {
      // Remember the unrolled height before collapsing.
      const win = this.windowFor(noteId);
      if (win) {
        const cur = win.getBounds();
        this.store.update(noteId, { bounds: { ...cur } });
      }
    }
    this.store.update(noteId, { rolled: !note.rolled });
    this.applyNoteProps(noteId, ['rolled']);
    this.sendToNote(noteId, 'note:changed', { rolled: this.store.get(noteId).rolled });
  }

  _applyRoll(win, note) {
    const cur = win.getBounds();
    if (note.rolled) {
      win.setMinimumSize(MIN_W, HEADER_H);
      win.setMaximumSize(0, HEADER_H);
      win.setBounds({ x: cur.x, y: cur.y, width: cur.width, height: HEADER_H });
    } else {
      const h = Math.max(MIN_H, (note.bounds && note.bounds.height) || DEFAULT_H);
      win.setMaximumSize(0, 0);
      win.setMinimumSize(MIN_W, MIN_H);
      win.setBounds({ x: cur.x, y: cur.y, width: cur.width, height: h });
    }
  }

  // ---------- geometry ----------
  ensureVisible(b) {
    const bounds = { width: DEFAULT_W, height: DEFAULT_H, ...b };
    bounds.width = Math.max(MIN_W, Math.round(bounds.width));
    bounds.height = Math.max(MIN_H, Math.round(bounds.height));
    const displays = screen.getAllDisplays();
    const visible = displays.some(d => {
      const wa = d.workArea;
      return bounds.x + 60 < wa.x + wa.width && bounds.x + bounds.width - 60 > wa.x &&
        bounds.y >= wa.y - 10 && bounds.y + HEADER_H < wa.y + wa.height;
    });
    if (!visible || !Number.isFinite(bounds.x) || !Number.isFinite(bounds.y)) {
      const wa = screen.getPrimaryDisplay().workArea;
      bounds.x = wa.x + Math.round((wa.width - bounds.width) / 2);
      bounds.y = wa.y + Math.round((wa.height - bounds.height) / 3);
    }
    return bounds;
  }

  placeNewBounds(from) {
    const W = DEFAULT_W;
    const H = DEFAULT_H;
    const gap = 14;
    const occupied = [...this.notes.values()]
      .filter(w => !w.isDestroyed() && w.isVisible())
      .map(w => w.getBounds());
    const free = (r) => !occupied.some(o => r.x < o.x + o.width && r.x + r.width > o.x && r.y < o.y + o.height && r.y + r.height > o.y);

    if (from && from.bounds) {
      const fb = from.bounds;
      const wa = screen.getDisplayMatching(fb).workArea;
      const candidates = [
        { x: fb.x + fb.width + gap, y: fb.y },
        { x: fb.x - W - gap, y: fb.y },
        { x: fb.x, y: fb.y + (from.rolled ? HEADER_H : fb.height) + gap }
      ].map(c => ({ ...c, width: W, height: H }))
        .filter(c => c.x >= wa.x && c.y >= wa.y && c.x + W <= wa.x + wa.width && c.y + H <= wa.y + wa.height);
      const pick = candidates.find(free) || candidates[0];
      if (pick) return pick;
      return { x: Math.min(fb.x + 32, wa.x + wa.width - W), y: Math.min(fb.y + 32, wa.y + wa.height - H), width: W, height: H };
    }

    const pt = screen.getCursorScreenPoint();
    const wa = screen.getDisplayNearestPoint(pt).workArea;
    // Fill a grid from the top-right corner, the way people tend to stack sticky notes.
    for (let col = 0; col < 6; col++) {
      for (let row = 0; row < 4; row++) {
        const r = { x: wa.x + wa.width - (W + gap) * (col + 1) - 24, y: wa.y + 24 + (H + gap) * row, width: W, height: H };
        if (r.x < wa.x || r.y + H > wa.y + wa.height) continue;
        if (free(r)) return r;
      }
    }
    const n = occupied.length % 10;
    return { x: wa.x + 80 + n * 28, y: wa.y + 80 + n * 28, width: W, height: H };
  }

  snap(win, noteId) {
    if (win.isDestroyed()) return;
    const b = win.getBounds();
    const wa = screen.getDisplayMatching(b).workArea;
    let { x, y } = b;
    const edgesX = [[wa.x, 'l'], [wa.x + wa.width, 'r']];
    const edgesY = [[wa.y, 't'], [wa.y + wa.height, 'b']];
    for (const [id, other] of this.notes) {
      if (id === noteId || other.isDestroyed() || !other.isVisible()) continue;
      const o = other.getBounds();
      const vOverlap = b.y < o.y + o.height + SNAP && b.y + b.height > o.y - SNAP;
      const hOverlap = b.x < o.x + o.width + SNAP && b.x + b.width > o.x - SNAP;
      if (vOverlap) edgesX.push([o.x + o.width + 6, 'l'], [o.x - 6, 'r'], [o.x, 'l']);
      if (hOverlap) edgesY.push([o.y + o.height + 6, 't'], [o.y - 6, 'b'], [o.y, 't']);
    }
    let best = SNAP;
    for (const [e, side] of edgesX) {
      const d = side === 'l' ? Math.abs(b.x - e) : Math.abs(b.x + b.width - e);
      if (d < best) { best = d; x = side === 'l' ? e : e - b.width; }
    }
    best = SNAP;
    for (const [e, side] of edgesY) {
      const d = side === 't' ? Math.abs(b.y - e) : Math.abs(b.y + b.height - e);
      if (d < best) { best = d; y = side === 't' ? e : e - b.height; }
    }
    if (x !== b.x || y !== b.y) win.setPosition(Math.round(x), Math.round(y));
  }

  // ---------- messaging ----------
  sendToNote(noteId, channel, payload) {
    const win = this.windowFor(noteId);
    if (win && !win.webContents.isLoading()) win.webContents.send(channel, payload);
  }

  emitCommand(noteId, cmd, arg) {
    this.sendToNote(noteId, 'note:command', { cmd, arg });
  }

  broadcast(channel, payload) {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send(channel, payload);
    }
  }

  notifyManager(channel, payload) {
    if (this.manager && !this.manager.isDestroyed()) this.manager.webContents.send(channel, payload);
  }

  applyThemeToWindows() {
    for (const [id, win] of this.notes) {
      const note = this.store.get(id);
      if (note && !win.isDestroyed()) win.setBackgroundColor(this.colorsFor(note).bg);
    }
    if (this.manager && !this.manager.isDestroyed()) {
      const dark = this.theme() === 'dark';
      this.manager.setBackgroundColor(dark ? '#1f1f22' : '#f7f6f3');
      try { this.manager.setTitleBarOverlay(this._overlay()); } catch { /* not supported */ }
    }
  }

  setSkipTaskbar(skip) {
    for (const win of this.notes.values()) if (!win.isDestroyed()) win.setSkipTaskbar(skip);
  }

  // ---------- notes list / settings window ----------
  _overlay() {
    const dark = this.theme() === 'dark';
    return { color: dark ? '#1f1f22' : '#f7f6f3', symbolColor: dark ? '#e8e8ea' : '#2b2b2b', height: 44 };
  }

  openManager(view) {
    if (this.manager && !this.manager.isDestroyed()) {
      this.bringToFront(this.manager);
      if (view) this.manager.webContents.send('manager:view', view);
      return this.manager;
    }
    const saved = this.store.settings.managerBounds;
    const wa = screen.getPrimaryDisplay().workArea;
    const b = saved ? this.ensureVisible(saved) : { width: 400, height: 640, x: wa.x + Math.round((wa.width - 400) / 2), y: wa.y + Math.round((wa.height - 640) / 2) };
    const dark = this.theme() === 'dark';
    const win = new BrowserWindow({
      ...b,
      minWidth: 320,
      minHeight: 400,
      show: false,
      title: 'OpenStickies',
      icon: this.icon,
      backgroundColor: dark ? '#1f1f22' : '#f7f6f3',
      titleBarStyle: 'hidden',
      titleBarOverlay: this._overlay(),
      fullscreenable: false,
      webPreferences: { ...this.webPreferences(), spellcheck: false }
    });
    this.manager = win;
    win.loadURL('app://stickies/manager/manager.html' + (view ? `#${encodeURIComponent(view)}` : ''));
    win.once('ready-to-show', () => { win.show(); win.focus(); });
    let t;
    const save = () => { clearTimeout(t); t = setTimeout(() => { if (!win.isDestroyed()) this.store.updateSettings({ managerBounds: win.getBounds() }); }, 400); };
    win.on('resize', save);
    win.on('move', save);
    win.on('closed', () => { this.manager = null; });
    win.webContents.on('will-navigate', (e) => e.preventDefault());
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    return win;
  }
}

module.exports = { WindowManager, HEADER_H, DEFAULT_W, DEFAULT_H };
