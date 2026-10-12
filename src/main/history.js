'use strict';

// Version history: before a note starts changing again after a pause, the previous
// content is saved as a snapshot. One file per note in data/history/<id>.json.
//
// Thinning keeps it small: everything from the last day, one per hour for the last
// week, one per day after that, and at most MAX_PER_NOTE snapshots.
//
// Notes with tabs: a snapshot is note.html, which is only the tab that was active at the time
// (the store mirrors it). Switching tabs sends the tab list without html, so it never snapshots;
// restoring a version replaces the active tab's page and leaves the other tabs alone.

const fs = require('fs');
const path = require('path');
const { writeFileAtomic, ATTACHMENT_RE } = require('./store');
const { htmlToText, titleFromText } = require('./store-text');

const SESSION_GAP = 5 * 60 * 1000;
const MAX_PER_NOTE = 150;
const ID_RE = /^n[a-z0-9]{6,40}$/;

class History {
  constructor(dataDir) {
    this.dir = path.join(dataDir, 'history');
    fs.mkdirSync(this.dir, { recursive: true });
    this.cache = new Map();   // id -> snapshots [{ t, html }]
    this.lastSeen = new Map(); // id -> time of the last change we saw
    this.dirty = new Set();
    this.timer = null;
  }

  file(id) { return ID_RE.test(id) ? path.join(this.dir, `${id}.json`) : null; }

  load(id) {
    if (this.cache.has(id)) return this.cache.get(id);
    let list = [];
    const f = this.file(id);
    if (f) {
      try {
        const data = JSON.parse(fs.readFileSync(f, 'utf8'));
        if (Array.isArray(data.snapshots)) list = data.snapshots.filter(s => s && Number.isFinite(s.t) && typeof s.html === 'string');
      } catch { /* none yet */ }
    }
    this.cache.set(id, list);
    return list;
  }

  // Call before a note's HTML changes. `prevHtml` is the content about to be replaced and
  // `prevTime` when it was last edited. Snapshots it when a new editing session starts.
  beforeChange(id, prevHtml, prevTime, { force = false } = {}) {
    const now = Date.now();
    const last = this.lastSeen.get(id) || 0;
    this.lastSeen.set(id, now);
    if (!force && now - last < SESSION_GAP) return;
    if (!prevHtml || !htmlToText(prevHtml).trim() && !/<img\b/i.test(prevHtml)) return;
    const list = this.load(id);
    const top = list[list.length - 1];
    if (top && top.html === prevHtml) return;
    list.push({ t: prevTime || now, html: prevHtml });
    this._thin(list);
    this._markDirty(id);
  }

  _thin(list) {
    const now = Date.now();
    const keep = [];
    const seen = new Set();
    for (let i = list.length - 1; i >= 0; i--) {
      const s = list[i];
      const age = now - s.t;
      let bucket = null;
      if (age > 7 * 864e5) bucket = 'd' + Math.floor(s.t / 864e5);
      else if (age > 864e5) bucket = 'h' + Math.floor(s.t / 36e5);
      if (bucket && seen.has(bucket)) continue;
      if (bucket) seen.add(bucket);
      keep.push(s);
    }
    keep.reverse();
    list.splice(0, list.length, ...keep.slice(-MAX_PER_NOTE));
  }

  _markDirty(id) {
    this.dirty.add(id);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 1500);
  }

  flush() {
    clearTimeout(this.timer);
    for (const id of this.dirty) {
      const f = this.file(id);
      if (!f) continue;
      try { writeFileAtomic(f, JSON.stringify({ version: 1, snapshots: this.cache.get(id) || [] })); }
      catch (err) { console.warn('[history] write failed:', err.message); }
    }
    this.dirty.clear();
  }

  list(id) {
    return this.load(id).map(s => {
      const text = htmlToText(s.html);
      return { t: s.t, title: titleFromText(text), words: text ? text.split(/\s+/).filter(Boolean).length : 0 };
    }).reverse();
  }

  get(id, t) {
    const s = this.load(id).find(x => x.t === t);
    return s ? s.html : null;
  }

  remove(id) {
    this.cache.delete(id);
    this.lastSeen.delete(id);
    this.dirty.delete(id);
    const f = this.file(id);
    if (f) fs.rm(f, { force: true }, () => {});
  }

  // Images used by any snapshot, so restoring an old version brings its pictures back.
  refs() {
    const refs = new Set();
    let files = [];
    try { files = fs.readdirSync(this.dir).filter(f => f.endsWith('.json')); } catch { /* empty */ }
    for (const f of files) {
      const list = this.load(f.slice(0, -5));
      for (const s of list) for (const m of s.html.matchAll(ATTACHMENT_RE)) refs.add(m[1]);
    }
    return refs;
  }
}

module.exports = { History };
