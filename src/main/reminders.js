'use strict';

const { Notification } = require('electron');

// Steps by calendar days (not fixed milliseconds) so 9:00 stays 9:00 across daylight-saving
// changes. `dom` is the day of month the reminder was created for, so a reminder on the 31st
// returns to the 31st after a short month instead of drifting to the 28th.
function nextOccurrence(at, repeat, now = Date.now(), dom) {
  const d = new Date(at);
  const day = dom || d.getDate();
  const step = () => {
    switch (repeat) {
      case 'daily': d.setDate(d.getDate() + 1); return true;
      case 'weekly': d.setDate(d.getDate() + 7); return true;
      case 'weekdays':
        do { d.setDate(d.getDate() + 1); } while (d.getDay() === 0 || d.getDay() === 6);
        return true;
      case 'monthly': {
        const y = d.getFullYear();
        const m = d.getMonth() + 1;
        d.setFullYear(y, m, Math.min(day, new Date(y, m + 1, 0).getDate()));
        return true;
      }
      default: return false;
    }
  };
  let guard = 0;
  do { if (!step()) return null; } while (d.getTime() <= now && ++guard < 5000);
  return d.getTime();
}

class Reminders {
  constructor({ store, windows, icon }) {
    this.store = store;
    this.windows = windows;
    this.icon = icon;
    this.timer = null;
    this.live = new Set(); // keep Notification objects alive until clicked/closed
  }

  start() {
    this.check();
    this.timer = setInterval(() => this.check(), 10 * 1000);
  }

  stop() { clearInterval(this.timer); }

  check() {
    const now = Date.now();
    for (const note of this.store.active()) {
      const r = note.reminder;
      if (!r) continue;
      if (r.snoozeAt && r.snoozeAt <= now) {
        this.fire(note, { ...r, snoozeAt: null, pending: true });
      } else if (!r.snoozeAt && r.at <= now) {
        // A repeating reminder keeps firing even if an earlier one was never dismissed.
        // setAt restarts so the border colour counts down to the next occurrence, not the first.
        if (r.repeat && r.repeat !== 'none') this.fire(note, { ...r, at: nextOccurrence(r.at, r.repeat, now, r.dom), setAt: now, pending: true });
        else if (!r.pending) this.fire(note, { ...r, pending: true });
      }
    }
  }

  fire(note, reminder) {
    this.store.update(note.id, { reminder });
    const title = note.title || 'Sticky note';
    this.windows.openNote(note.id, { focus: false });
    const win = this.windows.windowFor(note.id);
    const notify = () => {
      this.windows.sendToNote(note.id, 'note:changed', { reminder });
      this.windows.emitCommand(note.id, 'reminder-fired');
      if (win && !win.isDestroyed()) { win.moveTop(); win.flashFrame(true); }
    };
    if (win && win.webContents.isLoading()) win.webContents.once('did-finish-load', () => setTimeout(notify, 300));
    else notify();

    if (Notification.isSupported()) {
      const body = (note.text || '').replace(/\s+/g, ' ').trim().slice(0, 180) || 'You asked to be reminded about this note.';
      const n = new Notification({ title: `⏰ ${title}`, body, icon: this.icon, silent: false });
      this.live.add(n);
      n.on('click', () => { this.live.delete(n); this.windows.openNote(note.id, { focus: true }); });
      n.on('close', () => this.live.delete(n));
      n.show();
    }
  }
}

module.exports = { Reminders, nextOccurrence };
