'use strict';

// Runs inside Electron (started by capture.js): seeds a throwaway data folder, boots the real
// app against it, plays one scene's steps and saves a PNG of each window it lists.

const fs = require('fs');
const path = require('path');

const arg = (name) => {
  const hit = process.argv.find(a => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};
const sceneName = arg('scene');
const rawDir = arg('out');
const { scenes, library, IMAGES, BASE_SETTINGS } = require('./scenes');
const scene = scenes.find(s => s.name === sceneName);
if (!scene || !rawDir) {
  console.error(`runner: unknown scene "${sceneName}" or missing --out`);
  process.exit(2);
}

const now = Date.now();
const userData = path.join(rawDir, '_data', scene.name);
fs.rmSync(userData, { recursive: true, force: true });
const dataDir = path.join(userData, 'data');
fs.mkdirSync(path.join(dataDir, 'attachments'), { recursive: true });
fs.mkdirSync(path.join(dataDir, 'history'), { recursive: true });
for (const im of Object.values(IMAGES)) fs.writeFileSync(path.join(dataDir, 'attachments', im.name), im.content);
fs.writeFileSync(path.join(dataDir, 'notes.json'), JSON.stringify({ notes: scene.notes(library(now)) }));
fs.writeFileSync(path.join(dataDir, 'settings.json'), JSON.stringify({ ...BASE_SETTINGS, theme: scene.theme || 'light', ...(scene.settings || {}) }));
for (const [id, snapshots] of Object.entries(scene.history ? scene.history(now) : {})) {
  fs.writeFileSync(path.join(dataDir, 'history', `${id}.json`), JSON.stringify({ snapshots }));
}

process.env.STICKIES_USER_DATA = userData;
const { app, BrowserWindow } = require('electron');
const { htmlToText, titleFromText } = require('../../src/main/store-text');
require('../../src/main/main.js');

const wait = (ms) => new Promise(r => setTimeout(r, ms));

function windowKind(win) {
  const url = win.webContents.getURL();
  if (url.includes('/manager/')) return 'manager';
  if (url.includes('/history/')) return 'history';
  if (url.includes('/note/')) return 'note';
  return 'other';
}

// Note windows are matched by their note's title, which the app keeps as the window title.
// A private note hides its title, so a lone leftover window is paired with the lone leftover note.
function noteWindowsById() {
  const notes = scene.notes(library(now)).filter(n => n.open);
  const wins = BrowserWindow.getAllWindows().filter(w => windowKind(w) === 'note');
  const map = new Map();
  for (const n of notes) {
    const title = titleFromText(htmlToText(n.html));
    const win = wins.find(w => w.getTitle() === title && ![...map.values()].includes(w));
    if (win) map.set(n.id, win);
  }
  const leftNotes = notes.filter(n => !map.has(n.id));
  const leftWins = wins.filter(w => ![...map.values()].includes(w));
  if (leftNotes.length === 1 && leftWins.length === 1) map.set(leftNotes[0].id, leftWins[0]);
  return map;
}

const ctx = {
  wait,
  noteWindow(id) {
    const win = noteWindowsById().get(id);
    if (!win) throw new Error(`no window for note ${id}`);
    return win;
  },
  async waitForWindow(kind, timeout = 8000) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      const win = BrowserWindow.getAllWindows().find(w => windowKind(w) === kind && w.isVisible());
      if (win && !win.webContents.isLoading()) return win;
      await wait(100);
    }
    throw new Error(`${kind} window never appeared`);
  },
  js: (win, code) => win.webContents.executeJavaScript(code, true),
  async focus(win) {
    win.show();
    win.focus();
    win.webContents.focus();
    await wait(150);
  },
  async type(win, text) {
    for (const ch of text) {
      win.webContents.sendInputEvent({ type: 'keyDown', keyCode: ch });
      win.webContents.sendInputEvent({ type: 'char', keyCode: ch });
      win.webContents.sendInputEvent({ type: 'keyUp', keyCode: ch });
      await wait(40);
    }
  },
  async click(win, selector) {
    const r = await ctx.js(win, `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; const b = el.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; })()`);
    if (!r) throw new Error(`nothing matches ${selector}`);
    const pos = { x: Math.round(r.x), y: Math.round(r.y) };
    win.webContents.sendInputEvent({ type: 'mouseMove', ...pos });
    win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...pos });
    win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...pos });
    await wait(100);
  },
  async selectText(win, text) {
    const ok = await ctx.js(win, `(() => {
      const ed = document.querySelector('.editor');
      const walker = document.createTreeWalker(ed, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const i = walker.currentNode.data.indexOf(${JSON.stringify(text)});
        if (i < 0) continue;
        const r = document.createRange();
        r.setStart(walker.currentNode, i);
        r.setEnd(walker.currentNode, i + ${text.length});
        const s = getSelection(); s.removeAllRanges(); s.addRange(r);
        document.dispatchEvent(new Event('selectionchange'));
        ed.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
        return true;
      }
      return false;
    })()`);
    if (!ok) throw new Error(`text not found: ${text}`);
  }
};

async function captureAll() {
  const notes = noteWindowsById();
  for (const shot of scene.shots) {
    const win = notes.get(shot) || BrowserWindow.getAllWindows().find(w => windowKind(w) === shot);
    if (!win) throw new Error(`nothing to capture for "${shot}"`);
    const image = await win.webContents.capturePage();
    fs.writeFileSync(path.join(rawDir, `${scene.name}--${shot}.png`), image.toPNG());
    // Where Windows draws the caption buttons (titleBarOverlay), so compose.js can draw them back in.
    const overlay = await ctx.js(win, `(() => {
      const o = navigator.windowControlsOverlay;
      if (!o || !o.visible) return null;
      const r = o.getTitlebarAreaRect();
      return { width: innerWidth - (r.x + r.width), height: r.height };
    })()`);
    if (overlay) fs.writeFileSync(path.join(rawDir, `${scene.name}--${shot}.json`), JSON.stringify(overlay));
  }
}

async function waitForNotes(timeout = 15000) {
  const expected = scene.notes(library(now)).filter(n => n.open).length;
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const visible = BrowserWindow.getAllWindows().filter(w => windowKind(w) === 'note' && w.isVisible() && !w.webContents.isLoading());
    if (visible.length >= expected) return;
    await wait(100);
  }
  throw new Error('note windows did not open');
}

app.whenReady().then(async () => {
  try {
    await waitForNotes();
    await wait(1500); // fonts, tag/date highlights, image loads
    if (scene.steps) await scene.steps(ctx);
    await wait(300);
    await captureAll();
    app.exit(0);
  } catch (err) {
    console.error(`runner [${scene.name}]:`, err && err.stack || err);
    app.exit(1);
  }
});
