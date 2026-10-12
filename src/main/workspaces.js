'use strict';

// Workspaces: named arrangements of notes (which are on the desktop, where, how big,
// kept on top, rolled up, opacity). Switching saves the current arrangement first, so
// each workspace remembers changes like a virtual desktop. Each monitor setup remembers
// the workspace last used with it and switches back when that setup returns.

const crypto = require('crypto');
const { screen } = require('electron');

class Workspaces {
  constructor({ store, windows, onChange }) {
    this.store = store;
    this.windows = windows;
    this.onChange = onChange || (() => {});
    this._displayTimer = null;
    this._switching = false;
  }

  list() { return this.store.settings.workspaces || []; }
  active() { return this.store.settings.activeWorkspace; }
  get(id) { return this.list().find(w => w.id === id) || null; }

  displayKey() {
    return screen.getAllDisplays()
      .map(d => `${d.bounds.x},${d.bounds.y},${d.bounds.width}x${d.bounds.height}@${d.scaleFactor}`)
      .sort().join('|');
  }

  capture() {
    return this.store.active().map(n => {
      const win = this.windows.windowFor(n.id);
      let bounds = n.bounds;
      if (win && !win.isDestroyed() && !n.rolled) bounds = win.getBounds();
      return { id: n.id, open: !!n.open && !!win && win.isVisible(), bounds, pinned: !!n.pinned, rolled: !!n.rolled, opacity: n.opacity || 1 };
    });
  }

  _write(list, extra = {}) {
    this.store.updateSettings({ workspaces: list, ...extra });
    this.onChange();
  }

  save(name) {
    const ws = {
      id: 'w' + Date.now().toString(36) + crypto.randomBytes(2).toString('hex'),
      name: String(name || '').trim().slice(0, 60) || `Workspace ${this.list().length + 1}`,
      layout: this.capture(),
      displayKey: this.displayKey(),
      updatedAt: Date.now()
    };
    this._write([...this.list(), ws], { activeWorkspace: ws.id, workspaceByDisplay: { ...this.store.settings.workspaceByDisplay, [ws.displayKey]: ws.id } });
    return ws;
  }

  update(id) {
    const list = this.list().map(w => (w.id === id ? { ...w, layout: this.capture(), displayKey: this.displayKey(), updatedAt: Date.now() } : w));
    this._write(list);
  }

  rename(id, name) {
    this._write(this.list().map(w => (w.id === id ? { ...w, name: String(name || '').trim().slice(0, 60) || w.name } : w)));
  }

  remove(id) {
    const map = { ...this.store.settings.workspaceByDisplay };
    for (const k of Object.keys(map)) if (map[k] === id) delete map[k];
    this._write(this.list().filter(w => w.id !== id), {
      activeWorkspace: this.active() === id ? null : this.active(),
      workspaceByDisplay: map
    });
  }

  async switchTo(id, { saveCurrent = true } = {}) {
    const ws = this.get(id);
    if (!ws || this._switching) return false;
    this._switching = true;
    try {
      const current = this.active();
      if (saveCurrent && current && current !== id && this.get(current)) this.update(current);
      const byId = new Map(ws.layout.map(e => [e.id, e]));
      for (const note of this.store.active()) {
        const entry = byId.get(note.id);
        if (entry && entry.open) this.windows.applyLayoutEntry(note.id, entry);
        else if (note.open) await this.windows.closeNote(note.id);
      }
      this.store.updateSettings({
        activeWorkspace: id,
        workspaceByDisplay: { ...this.store.settings.workspaceByDisplay, [this.displayKey()]: id }
      });
      this.onChange();
      return true;
    } finally {
      this._switching = false;
    }
  }

  next() {
    const list = this.list();
    if (!list.length) return null;
    const i = list.findIndex(w => w.id === this.active());
    const target = list[(i + 1) % list.length];
    this.switchTo(target.id);
    return target;
  }

  // Monitors plugged in or removed: switch to the workspace last used with this setup.
  watchDisplays() {
    const changed = () => {
      clearTimeout(this._displayTimer);
      this._displayTimer = setTimeout(() => {
        if (!this.store.settings.autoWorkspace) return;
        const id = (this.store.settings.workspaceByDisplay || {})[this.displayKey()];
        if (id && id !== this.active() && this.get(id)) this.switchTo(id, { saveCurrent: false });
      }, 1500);
    };
    screen.on('display-added', changed);
    screen.on('display-removed', changed);
    screen.on('display-metrics-changed', (_e, _d, metrics) => { if (metrics.includes('bounds') || metrics.includes('scaleFactor')) changed(); });
  }
}

module.exports = { Workspaces };
