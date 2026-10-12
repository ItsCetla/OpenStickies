'use strict';

// Screen snip: freeze every display, let the user drag a rectangle on any of them,
// then crop that region at full resolution and put it in a note.

const crypto = require('crypto');
const { BrowserWindow, desktopCapturer, screen } = require('electron');

class Snipper {
  constructor({ store, windows, preload }) {
    this.store = store;
    this.windows = windows;
    this.preload = preload;
    this.session = null; // { token, shots: Map(displayId -> NativeImage), overlays: [], target, resolve }
  }

  // Serves the frozen screenshots to the overlays: app://stickies/__snip/<token>/<displayId>.jpg
  serve(pathname) {
    const m = /^\/__snip\/([a-f0-9]+)\/(\d+)\.jpg$/.exec(pathname);
    if (!m || !this.session || m[1] !== this.session.token) return null;
    const img = this.session.shots.get(Number(m[2]));
    return img ? img.toJPEG(92) : null;
  }

  overlayFor(webContents) {
    return this.session && this.session.overlays.find(o => o.win.webContents === webContents);
  }

  // target: 'new' | 'last' | a note id (insert into that note)
  async start(target = this.store.settings.snipTarget || 'new') {
    if (this.session) { this.session.overlays.forEach(o => !o.win.isDestroyed() && o.win.focus()); return; }
    const displays = screen.getAllDisplays();
    const maxW = Math.max(...displays.map(d => Math.round(d.size.width * d.scaleFactor)));
    const maxH = Math.max(...displays.map(d => Math.round(d.size.height * d.scaleFactor)));
    let sources;
    try {
      sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: maxW, height: maxH } });
    } catch (err) {
      console.error('[snip] capture failed:', err);
      return;
    }
    const session = { token: crypto.randomBytes(8).toString('hex'), shots: new Map(), overlays: [], target };
    displays.forEach((d, i) => {
      const src = sources.find(s => String(s.display_id) === String(d.id)) || sources[i];
      if (src && !src.thumbnail.isEmpty()) session.shots.set(d.id, src.thumbnail);
    });
    if (!session.shots.size) return;
    this.session = session;

    const cursor = screen.getCursorScreenPoint();
    for (const d of displays) {
      if (!session.shots.has(d.id)) continue;
      const win = new BrowserWindow({
        ...d.bounds,
        frame: false,
        show: false,
        resizable: false,
        movable: false,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        skipTaskbar: true,
        hasShadow: false,
        enableLargerThanScreen: true,
        alwaysOnTop: true,
        backgroundColor: '#000000',
        webPreferences: { preload: this.preload, contextIsolation: true, nodeIntegration: false, sandbox: true }
      });
      win.setAlwaysOnTop(true, 'screen-saver');
      session.overlays.push({ win, display: d });
      win.loadURL(`app://stickies/snip/snip.html`);
      win.once('ready-to-show', () => {
        win.setBounds(d.bounds); // re-apply after creation so mixed-DPI setups land exactly
        win.show();
        const b = d.bounds;
        if (cursor.x >= b.x && cursor.x < b.x + b.width && cursor.y >= b.y && cursor.y < b.y + b.height) win.focus();
      });
      win.on('closed', () => { if (this.session === session) this.cancel(); });
    }
  }

  info(webContents) {
    const o = this.overlayFor(webContents);
    if (!o) return null;
    const lastId = this.windows.lastFocusedNoteId;
    const last = lastId && this.store.get(lastId);
    const target = this.session.target;
    return {
      image: `app://stickies/__snip/${this.session.token}/${o.display.id}.jpg`,
      target: target === 'new' || target === 'last' ? target : 'note',
      lastTitle: target !== 'new' && target !== 'last' ? (this.store.get(target) || {}).title || 'this note' : (last && !last.trashed ? last.title || 'Sticky note' : null)
    };
  }

  cancel() {
    const s = this.session;
    if (!s) return;
    this.session = null;
    for (const o of s.overlays) if (!o.win.isDestroyed()) o.win.destroy();
  }

  // rect: CSS pixels within the overlay's display. choice: 'new' | 'last' | 'note'
  finish(webContents, rect, choice) {
    const s = this.session;
    const o = this.overlayFor(webContents);
    if (!s || !o) return null;
    const img = s.shots.get(o.display.id);
    const size = img.getSize();
    const sx = size.width / o.display.bounds.width;
    const sy = size.height / o.display.bounds.height;
    const crop = {
      x: Math.max(0, Math.round(rect.x * sx)),
      y: Math.max(0, Math.round(rect.y * sy)),
      width: Math.round(rect.width * sx),
      height: Math.round(rect.height * sy)
    };
    crop.width = Math.max(1, Math.min(crop.width, size.width - crop.x));
    crop.height = Math.max(1, Math.min(crop.height, size.height - crop.y));
    const saved = this.store.saveAttachment(img.crop(crop).toPNG(), 'image/png');
    const target = s.target;
    this.cancel();

    // Show the snip at its on-screen size (DIPs), not its pixel size, so it looks the same.
    const width = Math.round(rect.width);
    const html = `<p><img src="${saved.url}" alt="" style="width: ${width}px;"></p>`;
    const intoId = choice === 'note' ? target : choice === 'last' ? this.windows.lastFocusedNoteId : null;
    const into = intoId && this.store.get(intoId);
    if (into && !into.trashed && !(into.private)) {
      this.windows.openNote(into.id, { focus: true });
      const send = () => this.windows.emitCommand(into.id, 'insert-snip', { html });
      const win = this.windows.windowFor(into.id);
      if (win && win.webContents.isLoading()) win.webContents.once('did-finish-load', () => setTimeout(send, 250));
      else send();
    } else {
      this.windows.newNote({ html });
    }
    return saved;
  }
}

module.exports = { Snipper };
