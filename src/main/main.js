'use strict';

const {
  app, protocol, ipcMain, shell, nativeTheme, globalShortcut, session, dialog, net, Menu, BrowserWindow, powerMonitor, Notification
} = require('electron');
const path = require('path');
const fs = require('fs');

const { Store, OPENABLE_RE, ATTACHMENT_RE, writeFileAtomic, MAX_TABS } = require('./store');
const { WindowManager } = require('./windows');
const { Reminders } = require('./reminders');
const { createTray } = require('./tray');
const { attachNoteContextMenu, buildNoteMenu } = require('./context-menu');
const { History } = require('./history');
const { Vault } = require('./vault');
const { Workspaces } = require('./workspaces');
const { Snipper } = require('./snip');
const { ApiServer } = require('./api-server');
const { upsertAgentNote, createNoteFromApi, updateApiNote, checkApiNote, listApiNotes } = require('./agent-notes');
const opencode = require('./opencode');
const ocr = require('./ocr');
const scan = require('./html-scan');
const { htmlToText, titleFromText } = require('./store-text');
const exporter = require('./exporter');
const files = require('./files');
const { migrateLegacyData, LEGACY_LOGIN_ITEM } = require('./migrate');
const palette = require('../renderer/shared/colors.json');

const isDev = process.argv.includes('--dev');
if (process.env.STICKIES_USER_DATA) app.setPath('userData', process.env.STICKIES_USER_DATA);
// Under Wayland, apps can only register system-wide shortcuts through the desktop portal.
if (process.platform === 'linux') app.commandLine.appendSwitch('enable-features', 'GlobalShortcutsPortal');

const SRC = path.join(__dirname, '..');
const RENDERER = path.join(SRC, 'renderer');
const ASSETS = path.join(SRC, '..', 'assets');
const PRELOAD = path.join(SRC, 'preload.js');
const ICON = path.join(ASSETS, process.platform === 'win32' ? 'icon.ico' : 'icon.png');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2'
};

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, codeCache: true } },
  { scheme: 'sticky-img', privileges: { standard: true, secure: true, supportFetchAPI: true } }
]);

let store;
let windows;
let reminders;
let tray;
let history;
let vault;
let workspaces;
let snipper;
let apiServer;
let quitReady = false;
const plain = new Map(); // decrypted private notes while unlocked: id -> { html, text, title }

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  if (process.platform === 'win32') app.setAppUserModelId('com.openstickies.desktop');
  app.on('second-instance', (_e, argv) => {
    if (argv.includes('--quit')) { app.quit(); return; } // lets installers/scripts close OpenStickies gracefully
    if (!windows) return;
    if (argv.includes('--new')) windows.newNote();
    else if (argv.includes('--snip')) snipper.start();
    else windows.showAll();
  });
  app.whenReady().then(init);
}

function init() {
  if (process.argv.includes('--quit')) { app.quit(); return; }
  Menu.setApplicationMenu(null);

  // The app used to be called Stickies: bring its notes over on the first start. Runs with their
  // own data folder (STICKIES_USER_DATA, used for testing) leave the old folder alone.
  const moved = process.env.STICKIES_USER_DATA
    ? { migrated: false }
    : migrateLegacyData({ appData: app.getPath('appData'), userData: app.getPath('userData') });
  if (moved.error) {
    const choice = dialog.showMessageBoxSync({
      type: 'error',
      title: 'OpenStickies',
      message: 'Your notes couldn’t be brought over from Stickies',
      detail: `They’re safe where they were, in ${moved.from}\n\n${moved.error.message}\n\n` +
        'Quit and try again, or start without them. To bring them over later, quit OpenStickies and copy that folder’s contents into ' +
        `${path.join(app.getPath('userData'), 'data')}.`,
      buttons: ['Quit', 'Start without them'],
      defaultId: 0,
      cancelId: 0,
      noLink: true
    });
    if (choice === 0) { app.quit(); return; }
  }

  const dataDir = path.join(app.getPath('userData'), 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  history = new History(dataDir);
  store = new Store(dataDir);
  store.extraRefs.push(() => history.refs()); // before load(): load() cleans up unused images
  store.load();
  if (moved.migrated) carryOverLoginItem();
  vault = new Vault(dataDir);
  nativeTheme.themeSource = store.settings.theme;
  session.defaultSession.setSpellCheckerEnabled(!!store.settings.spellcheck);

  windows = new WindowManager({ store, preload: PRELOAD, icon: ICON, isDev });
  snipper = new Snipper({ store, windows, preload: PRELOAD });
  workspaces = new Workspaces({ store, windows, onChange: () => windows.notifyManager('workspaces:changed') });
  registerProtocols();

  windows.onNoteWindow = (win, noteId) => {
    attachNoteContextMenu({ win, noteId: () => windows.noteIdFor(win.webContents) || noteId, store, windows, openExternal });
    win.on('session-end', () => { store.flush(); history.flush(); });
    win.on('focus', () => vault.touch());
    if (isDev) {
      win.webContents.on('before-input-event', (_e, input) => {
        if (input.type === 'keyDown' && input.control && input.shift && input.key.toLowerCase() === 'i') win.webContents.toggleDevTools();
      });
    }
  };

  registerIpc();
  wireEvents();

  tray = createTray({
    windows, store, vault, workspaces, assetsDir: ASSETS,
    onQuit: () => app.quit(),
    onSnip: () => snipper.start(),
    onTemplate: (id) => newNoteFromTemplate(id),
    onLock: () => lockVault()
  });
  reportHotkeyFailures(registerHotkeys());
  setUserTasks();
  if (process.platform === 'darwin') setupMac();

  reminders = new Reminders({ store, windows, icon: ICON });
  reminders.start();
  runChecklistResets();
  setInterval(runChecklistResets, 60 * 1000);
  setInterval(() => { if (vault.unlocked) { const before = vault.unlocked; vault.idleLock(store.settings.autoLockMinutes); if (before && !vault.unlocked) onVaultLocked(); } }, 30 * 1000);
  workspaces.watchDisplays();

  apiServer = new ApiServer({
    dataDir,
    // A copy outside AppData, where Windows never redirects it (see api-server.js). Skipped for
    // runs with their own data folder (tests), so they can't hijack the real app's connection.
    extraFiles: process.env.STICKIES_USER_DATA ? [] : [path.join(app.getPath('home'), '.stickies', 'api.json')],
    version: app.getVersion(),
    options: () => ({ planNudge: store.settings.agentPlanNudge !== false }),
    handlers: {
      upsertAgent: (key, body) => upsertAgentNote({ store, windows, key, body }),
      createNote: (body) => createNoteFromApi({ store, windows, body }),
      updateNote: (id, body) => updateApiNote({ store, windows, history, id, body }),
      checkItem: (id, body) => checkApiNote({ store, windows, id, body }),
      listNotes: (query) => listApiNotes({ store, query })
    }
  });
  if (store.settings.apiEnabled !== false) apiServer.start();

  nativeTheme.on('updated', () => {
    windows.applyThemeToWindows();
    broadcastSettings();
  });

  if (!store.settings.welcomed) {
    store.create({ html: welcomeHtml(), color: 'yellow', bounds: welcomeBounds() });
    store.updateSettings({ welcomed: true });
  }

  const hidden = process.argv.includes('--hidden') || openedAtMacLogin();
  windows.restoreOpenNotes();
  if (process.argv.includes('--new')) windows.newNote();
  else if (!store.active().some(n => n.open) && (!hidden || !tray || (process.platform !== 'win32' && !store.active().length))) {
    // Without a tray icon (or, on macOS and Linux, with no notes at all) a hidden start would
    // leave nothing on screen to get back in through, so show the notes list.
    windows.openManager();
  }
}

function welcomeBounds() {
  const { screen } = require('electron');
  const wa = screen.getPrimaryDisplay().workArea;
  return { x: wa.x + wa.width - 400, y: wa.y + 40, width: 360, height: 470 };
}

// ---------- protocols ----------
function registerProtocols() {
  protocol.handle('app', async (req) => {
    const url = new URL(req.url);
    if (url.host !== 'stickies') return new Response('Not found', { status: 404 });
    if (url.pathname.startsWith('/__snip/')) {
      const jpg = snipper.serve(url.pathname);
      return jpg ? new Response(jpg, { headers: { 'content-type': 'image/jpeg', 'cache-control': 'no-store' } }) : new Response('Not found', { status: 404 });
    }
    const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    const file = path.normalize(path.join(RENDERER, rel));
    if (!file.startsWith(RENDERER + path.sep)) return new Response('Forbidden', { status: 403 });
    try {
      const data = await fs.promises.readFile(file);
      return new Response(data, { headers: { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-cache' } });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });

  protocol.handle('sticky-img', async (req) => {
    const url = new URL(req.url);
    const file = url.host === 'img' ? store.attachmentPath(decodeURIComponent(url.pathname.slice(1))) : null;
    if (!file) return new Response('Not found', { status: 404 });
    const headers = {
      'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'"
    };
    try {
      if (!fs.existsSync(file) && fs.existsSync(file + '.enc')) {
        // An image from a private note: only viewable while private notes are unlocked.
        const data = vault.unlocked ? vault.readEncryptedFile(file) : null;
        return data ? new Response(data, { headers: { ...headers, 'cache-control': 'no-store' } }) : new Response('Locked', { status: 403 });
      }
      const data = await fs.promises.readFile(file);
      return new Response(data, { headers: { ...headers, 'cache-control': 'max-age=31536000, immutable' } });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });
}

// ---------- helpers ----------
function openExternal(url) {
  try {
    const u = new URL(String(url));
    if (['http:', 'https:', 'mailto:'].includes(u.protocol)) return shell.openExternal(u.toString());
  } catch { /* invalid */ }
  return null;
}

function themeName() { return windows.theme(); }

function broadcastSettings() {
  windows.broadcast('settings:changed', { settings: store.settings, theme: themeName() });
}

function setLoginItem(enabled) {
  if (process.platform === 'linux') { setLinuxAutostart(enabled); return; }
  // macOS login items take no arguments; init() asks whether it was a login start instead.
  if (process.platform === 'darwin') { app.setLoginItemSettings({ openAtLogin: !!enabled }); return; }
  const opts = { openAtLogin: !!enabled, args: ['--hidden'] };
  if (process.env.PORTABLE_EXECUTABLE_FILE) opts.path = process.env.PORTABLE_EXECUTABLE_FILE;
  else if (!app.isPackaged) { opts.path = process.execPath; opts.args = [path.resolve(SRC, '..'), '--hidden']; }
  app.setLoginItemSettings(opts);
}

// Linux desktops start whatever .desktop files are in ~/.config/autostart (the XDG autostart spec).
function setLinuxAutostart(enabled) {
  const dir = path.join(process.env.XDG_CONFIG_HOME || path.join(app.getPath('home'), '.config'), 'autostart');
  const file = path.join(dir, 'openstickies.desktop');
  try {
    if (!enabled) { fs.rmSync(file, { force: true }); return; }
    // Exec= quoting: reserved characters need double quotes, with " ` $ \ escaped inside them,
    // then the whole value is unescaped once more as a desktop-file string.
    const arg = (s) => {
      let v = String(s).replace(/%/g, '%%');
      if (/[\s"'\\$`<>~|&;*?#()]/.test(v)) v = `"${v.replace(/(["`$\\])/g, '\\$1')}"`;
      return v.replace(/\\/g, '\\\\');
    };
    // An AppImage runs from a temporary mount, so start the .AppImage file itself.
    const program = process.env.APPIMAGE || process.execPath;
    const args = [...(app.isPackaged ? [] : [path.resolve(SRC, '..')]), '--hidden'];
    fs.mkdirSync(dir, { recursive: true });
    writeFileAtomic(file, [
      '[Desktop Entry]',
      'Type=Application',
      'Name=OpenStickies',
      'Comment=Desktop sticky notes',
      `Exec=${[program, ...args].map(arg).join(' ')}`,
      'Icon=openstickies',
      'Terminal=false',
      'X-GNOME-Autostart-enabled=true',
      ''
    ].join('\n'));
  } catch (err) {
    console.warn('OpenStickies: could not update the autostart entry', err);
  }
}

// macOS login items can't pass --hidden, but the system says whether it started us at login.
function openedAtMacLogin() {
  if (process.platform !== 'darwin') return false;
  try { return !!app.getLoginItemSettings().wasOpenedAtLogin; } catch { return false; }
}

// Shortcut text as this platform writes it: "⌥⌘N" on a Mac, "Ctrl+Alt+N" elsewhere.
function accelLabel(acc) {
  if (process.platform !== 'darwin') return String(acc).replace(/CommandOrControl|CmdOrCtrl/g, 'Ctrl');
  const sym = { CommandOrControl: '⌘', CmdOrCtrl: '⌘', Command: '⌘', Cmd: '⌘', Super: '⌘', Meta: '⌘', Control: '⌃', Ctrl: '⌃', Alt: '⌥', Option: '⌥', AltGr: '⌥', Shift: '⇧' };
  const order = ['⌃', '⌥', '⇧', '⌘'];
  const parts = String(acc).split('+');
  const key = parts.pop();
  return parts.map(p => sym[p] || p).sort((a, b) => order.indexOf(a) - order.indexOf(b)).join('') + key;
}

// A shortcut another app already owns (or that a Wayland desktop refused) just does nothing, so
// say which ones didn't register instead of failing silently.
function reportHotkeyFailures(results) {
  const failed = Object.entries(results || {}).filter(([, r]) => r === 'taken' || r === 'invalid').map(([k]) => store.settings.hotkeys[k]);
  if (!failed.length) return;
  console.warn('OpenStickies: these global shortcuts could not be registered:', failed.join(', '));
  try {
    if (!Notification.isSupported()) return;
    const n = new Notification({
      title: 'Some OpenStickies shortcuts aren’t working',
      body: `${failed.map(accelLabel).join(', ')} couldn’t be set up, probably because another app uses ${failed.length > 1 ? 'them' : 'it'}. Pick different keys in Settings.`
    });
    n.on('click', () => windows.openManager('settings'));
    n.show();
  } catch { /* notifications unavailable */ }
}

// macOS expects an application menu: it carries the standard Edit shortcuts (copy, paste, undo)
// for every window plus About, Hide and Quit. Other platforms keep no menu bar.
function setupMac() {
  const SITE = 'https://openstickies.cetla.dev';
  // The note and list windows already handle their own shortcuts, and the global ones belong to
  // globalShortcut, so these only label the keys rather than registering them a second time.
  const shown = (accelerator) => (accelerator ? { accelerator, registerAccelerator: false } : {});
  const build = () => {
    const hk = store.settings.hotkeys;
    const templates = store.templates.length
      ? store.templates.map(t => ({ label: t.name, click: () => newNoteFromTemplate(t.id) }))
      : [{ label: 'No templates yet', enabled: false }];
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      {
        label: app.name,
        submenu: [
          { role: 'about' },
          { type: 'separator' },
          { label: 'Settings…', accelerator: 'Command+,', click: () => windows.openManager('settings') },
          { type: 'separator' },
          { role: 'services' },
          { type: 'separator' },
          { role: 'hide' },
          { role: 'hideOthers' },
          { role: 'unhide' },
          { type: 'separator' },
          { role: 'quit' }
        ]
      },
      {
        label: 'File',
        submenu: [
          { label: 'New Note', ...shown('Command+N'), click: () => windows.newNote() },
          { label: 'New from Template', submenu: templates },
          { type: 'separator' },
          { label: 'Notes List', click: () => windows.openManager() },
          { label: 'Tasks', click: () => windows.openManager('tasks') },
          { type: 'separator' },
          { label: 'Snip Screen to Note', ...shown(hk.snip), click: () => snipper.start() }
        ]
      },
      {
        label: 'Edit',
        submenu: [
          { role: 'undo' },
          { role: 'redo' },
          { type: 'separator' },
          { role: 'cut' },
          { role: 'copy' },
          { role: 'paste' },
          { role: 'pasteAndMatchStyle' },
          { role: 'selectAll' }
        ]
      },
      {
        label: 'View',
        submenu: [
          { label: 'Show All Notes', ...shown(hk.showAll), click: () => windows.showAll() },
          { label: 'Hide All Notes', click: () => windows.hideAll() },
          ...(isDev ? [{ type: 'separator' }, { role: 'reload' }, { role: 'toggleDevTools' }] : [])
        ]
      },
      { role: 'windowMenu' },
      {
        role: 'help',
        submenu: [{ label: 'OpenStickies Website', click: () => openExternal(SITE) }]
      }
    ]));
  };
  build();
  let t;
  const soon = () => { clearTimeout(t); t = setTimeout(build, 500); };
  store.on('templates', soon);
  store.on('settings', soon);

  // Running from source, the Dock would otherwise show Electron's icon.
  if (!app.isPackaged) { try { app.dock.setIcon(path.join(ASSETS, 'icon.png')); } catch { /* optional */ } }
  // Clicking the Dock icon with nothing on screen opens the notes list.
  app.on('activate', () => {
    if (windows && !BrowserWindow.getAllWindows().some(w => w.isVisible())) windows.openManager();
  });
}

// "Launch at login" came across in the settings, but Windows' entry still starts the old program.
function carryOverLoginItem() {
  if (process.platform === 'win32') app.setLoginItemSettings({ openAtLogin: false, name: LEGACY_LOGIN_ITEM });
  if (store.settings.launchAtLogin) setLoginItem(true);
}

function setUserTasks() {
  if (process.platform !== 'win32') return;
  const base = app.isPackaged ? [] : [path.resolve(SRC, '..')];
  const quote = (s) => (/\s/.test(s) ? `"${s}"` : s);
  const task = (arg, title, description) => ({ program: process.execPath, arguments: [...base, arg].map(quote).join(' '), iconPath: process.execPath, iconIndex: 0, title, description });
  try {
    app.setUserTasks([task('--new', 'New note', 'Create a new sticky note'), task('--snip', 'Snip screen to note', 'Capture part of the screen into a note')]);
  } catch { /* not critical */ }
}

const HOTKEY_KEYS = ['newNote', 'showAll', 'toggleAll', 'snip', 'nextWorkspace'];

function registerHotkeys() {
  globalShortcut.unregisterAll();
  const actions = {
    newNote: () => windows.newNote(),
    showAll: () => windows.showAll(),
    toggleAll: () => windows.toggleAll(),
    snip: () => snipper.start(),
    nextWorkspace: () => workspaces.next()
  };
  const results = {};
  for (const [key, fn] of Object.entries(actions)) {
    const acc = store.settings.hotkeys[key];
    if (!acc) { results[key] = 'off'; continue; }
    try { results[key] = globalShortcut.register(acc, fn) ? 'ok' : 'taken'; }
    catch { results[key] = 'invalid'; }
  }
  return results;
}

// ---------- private notes ----------
function privatePlain(note) {
  if (!note || !note.private) return null;
  if (plain.has(note.id)) return plain.get(note.id);
  if (!vault.unlocked || !note.cipher) return null;
  try {
    const { html } = JSON.parse(vault.decryptText(note.cipher));
    const text = htmlToText(html);
    const entry = { html, text, title: titleFromText(text) };
    plain.set(note.id, entry);
    return entry;
  } catch (err) {
    console.error('[vault] could not decrypt note', note.id, err.message);
    return null;
  }
}

function attachmentNames(html) {
  return [...new Set([...String(html || '').matchAll(ATTACHMENT_RE)].map(m => m[1]))];
}

// Encrypt images that only private notes use (an image shared with a normal note stays readable).
function encryptPrivateImages(names) {
  if (!vault.unlocked || !names.length) return;
  const publicRefs = store.referencedAttachments({ publicOnly: true });
  for (const name of names) {
    if (publicRefs.has(name)) continue;
    const file = store.attachmentPath(name);
    if (file && fs.existsSync(file)) vault.encryptFile(file);
  }
}

function savePrivate(id, html) {
  const refs = attachmentNames(html);
  store.update(id, { cipher: vault.encryptText(JSON.stringify({ html })), refs }, { touch: true });
  const text = htmlToText(html);
  plain.set(id, { html, text, title: titleFromText(text) });
  encryptPrivateImages(refs);
}

async function setPrivate(id, on) {
  const note = store.get(id);
  if (!note || !!note.private === !!on) return { ok: true };
  // Only the note's single page is encrypted, so other tabs would stay readable on disk.
  if (on && note.tabs && note.tabs.length > 1) return { ok: false, reason: 'tabs' };
  if (!vault.unlocked) return { ok: false, reason: vault.configured ? 'locked' : 'setup' };
  await windows.flushRenderer(windows.windowFor(id));
  if (on) {
    const { html, text, title } = note;
    const refs = attachmentNames(html);
    store.update(id, {
      private: true, cipher: vault.encryptText(JSON.stringify({ html })), refs,
      html: '', text: '', title: '', tags: [], links: [], imageText: '', tasks: { total: 0, done: 0 }
    });
    plain.set(id, { html, text, title });
    encryptPrivateImages(refs);
    history.remove(id); // old versions would be readable on disk
  } else {
    const p = privatePlain(note);
    if (!p) return { ok: false, reason: 'locked' };
    for (const name of note.refs) {
      const file = store.attachmentPath(name);
      if (file) vault.decryptFile(file);
    }
    store.update(id, { private: false, cipher: null, refs: [], html: p.html });
    plain.delete(id);
  }
  windows.sendToNote(id, 'note:changed', { private: !!on, privateLocked: false });
  windows.applyNoteProps(id, ['title']);
  return { ok: true };
}

async function lockVault() {
  if (!vault.unlocked) return;
  const wins = store.all().filter(n => n.private).map(n => windows.windowFor(n.id)).filter(Boolean);
  await Promise.all(wins.map(w => windows.flushRenderer(w, 600)));
  vault.lock();
  onVaultLocked();
}

function onVaultLocked() {
  plain.clear();
  for (const n of store.all().filter(x => x.private)) windows.sendToNote(n.id, 'note:changed', { privateLocked: true });
  windows.notifyManager('notes:changed');
  windows.broadcast('vault:changed', vault.status());
}

function onVaultUnlocked() {
  for (const n of store.all().filter(x => x.private)) {
    const p = privatePlain(n);
    if (p) windows.sendToNote(n.id, 'note:changed', { privateLocked: false, html: p.html });
  }
  windows.notifyManager('notes:changed');
  windows.broadcast('vault:changed', vault.status());
}

// ---------- checklist resets ----------
function runChecklistResets() {
  for (const n of store.active()) {
    if (n.tabs && n.tabs.some(t => t.html.includes('data-reset='))) {
      if (windows.windowFor(n.id)) { windows.emitCommand(n.id, 'checklist-reset'); continue; }
      let any = false;
      const tabs = n.tabs.map(t => {
        const next = scan.resetChecklists(t.html);
        if (next) any = true;
        return next ? { ...t, html: next, text: '' } : t;
      });
      if (any) store.update(n.id, { tabs, activeTab: n.activeTab });
      continue;
    }
    if (n.private || !n.html.includes('data-reset=')) continue;
    if (windows.windowFor(n.id)) { windows.emitCommand(n.id, 'checklist-reset'); continue; }
    const next = scan.resetChecklists(n.html);
    if (next) store.update(n.id, { html: next });
  }
}

// ---------- templates ----------
function isoWeek(d) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  return Math.ceil(((t - new Date(Date.UTC(t.getUTCFullYear(), 0, 1))) / 864e5 + 1) / 7);
}

function expandTemplate(html, now = new Date()) {
  const tomorrow = new Date(now.getTime() + 864e5);
  const map = {
    date: now.toLocaleDateString(undefined, { dateStyle: 'medium' }),
    time: now.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }),
    datetime: now.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }),
    weekday: now.toLocaleDateString(undefined, { weekday: 'long' }),
    tomorrow: tomorrow.toLocaleDateString(undefined, { dateStyle: 'medium' }),
    week: String(isoWeek(now)),
    month: now.toLocaleDateString(undefined, { month: 'long' }),
    year: String(now.getFullYear())
  };
  return String(html).replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k) => (k in map ? map[k] : m));
}

function newNoteFromTemplate(id, fromId = null) {
  const t = store.getTemplate(id);
  if (!t) return null;
  return windows.newNote({ fromId, html: expandTemplate(t.html), color: t.color });
}

// ---------- summaries for the notes list ----------
function noteSummary(n) {
  const base = {
    id: n.id, title: n.title, text: n.text.slice(0, 4000), html: n.html, color: n.color, font: n.font,
    open: n.open, pinned: n.pinned, locked: n.locked, trashed: n.trashed, trashedAt: n.trashedAt,
    reminder: n.reminder, createdAt: n.createdAt, updatedAt: n.updatedAt,
    tags: n.tags || [], links: n.links || [], imageText: (n.imageText || '').slice(0, 4000), tasks: n.tasks || { total: 0, done: 0 },
    private: !!n.private, privateLocked: false,
    // search looks at every tab, not just the one on screen
    searchText: n.private ? '' : store.searchText(n).slice(0, 20000),
    tabCount: n.tabs ? n.tabs.length : 1,
    hasImage: n.tabs ? n.tabs.some(t => /<img\b/.test(t.html)) : /<img\b/.test(n.html)
  };
  if (n.private) {
    const p = privatePlain(n);
    if (p) Object.assign(base, { html: p.html, text: p.text.slice(0, 4000), title: p.title, tags: scan.extractTags(p.html), tasks: scan.taskCounts(p.html) });
    else base.privateLocked = true;
  }
  return base;
}

function wireEvents() {
  let t;
  store.on('changed', (ev) => {
    if (ev && ev.type === 'purge') { history.remove(ev.id); plain.delete(ev.id); }
    clearTimeout(t);
    t = setTimeout(() => windows.notifyManager('notes:changed'), 120);
  });
  store.on('templates', () => windows.broadcast('templates:changed'));
  vault.on('status', () => windows.broadcast('vault:changed', vault.status()));
  for (const ev of ['lock-screen', 'suspend']) powerMonitor.on(ev, () => lockVault());
}

// ---------- IPC ----------
const NOTE_PATCH_KEYS = ['html', 'text', 'title', 'color', 'font', 'pinned', 'opacity', 'zoom', 'locked', 'reminder', 'tasks', 'imageText'];
NOTE_PATCH_KEYS.push('tabs', 'activeTab');

// Shape check only; the store does the full normalization (ids, titles, the 2..MAX_TABS rule).
function cleanTabs(list) {
  if (!Array.isArray(list)) return null;
  return list.slice(0, MAX_TABS).filter(t => t && typeof t === 'object').map(t => ({
    id: String(t.id || '').slice(0, 40),
    title: String(t.title || '').slice(0, 80),
    renamed: !!t.renamed,
    html: typeof t.html === 'string' ? t.html : '',
    text: typeof t.text === 'string' ? t.text : '',
    scroll: Math.max(0, Number(t.scroll) || 0)
  }));
}

function cleanPatch(patch) {
  const out = {};
  if (!patch || typeof patch !== 'object') return out;
  for (const k of NOTE_PATCH_KEYS) if (k in patch) out[k] = patch[k];
  if ('html' in out && typeof out.html !== 'string') delete out.html;
  if ('text' in out && typeof out.text !== 'string') delete out.text;
  if ('imageText' in out) out.imageText = String(out.imageText || '').slice(0, 50000);
  if ('tasks' in out) out.tasks = { total: Math.max(0, out.tasks && out.tasks.total | 0), done: Math.max(0, out.tasks && out.tasks.done | 0) };
  if ('title' in out) out.title = String(out.title || '').slice(0, 120);
  if ('color' in out && !palette.notes[out.color]) delete out.color;
  if ('font' in out && !palette.fonts.some(f => f.id === out.font)) delete out.font;
  if ('opacity' in out) out.opacity = Math.min(1, Math.max(0.25, Number(out.opacity) || 1));
  if ('zoom' in out) out.zoom = Math.min(3, Math.max(0.5, Number(out.zoom) || 1));
  for (const b of ['pinned', 'locked']) if (b in out) out[b] = !!out[b];
  if ('reminder' in out && out.reminder !== null) {
    const r = out.reminder;
    if (!r || !Number.isFinite(r.at)) delete out.reminder;
    else out.reminder = {
      at: r.at,
      repeat: ['none', 'daily', 'weekdays', 'weekly', 'monthly'].includes(r.repeat) ? r.repeat : 'none',
      pending: !!r.pending,
      snoozeAt: Number.isFinite(r.snoozeAt) ? r.snoozeAt : null,
      dom: Number.isInteger(r.dom) && r.dom >= 1 && r.dom <= 31 ? r.dom : new Date(r.at).getDate()
    };
  }
  if ('tabs' in out) out.tabs = cleanTabs(out.tabs);
  if ('activeTab' in out) out.activeTab = Number.isInteger(out.activeTab) ? Math.min(MAX_TABS - 1, Math.max(0, out.activeTab)) : 0;
  return out;
}

function registerIpc() {
  const noteOf = (e) => {
    const id = windows.noteIdFor(e.sender);
    if (!id) throw new Error('Not a note window');
    return id;
  };
  const managerOnly = (e) => {
    if (!windows.manager || windows.manager.isDestroyed() || e.sender !== windows.manager.webContents) throw new Error('Not allowed');
  };
  const historyNote = (e) => {
    const id = windows.historyNoteFor(e.sender);
    if (!id) throw new Error('Not a history window');
    return id;
  };
  const parentOf = (e) => BrowserWindow.fromWebContents(e.sender);

  // ----- note window -----
  ipcMain.handle('note:init', (e) => {
    const id = noteOf(e);
    const note = { ...store.get(id) };
    let privateLocked = false;
    if (note.private) {
      const p = privatePlain(store.get(id));
      if (p) Object.assign(note, { html: p.html, text: p.text, title: p.title });
      else privateLocked = true;
      delete note.cipher;
    }
    return { note, privateLocked, vault: vault.status(), settings: store.settings, theme: themeName(), isDev, version: app.getVersion() };
  });

  ipcMain.handle('note:update', (e, patch) => {
    const id = noteOf(e);
    const note = store.get(id);
    const clean = cleanPatch(patch);
    if (note && note.private) {
      const content = 'html' in clean ? clean.html : null;
      for (const k of ['html', 'text', 'title', 'tasks', 'imageText']) delete clean[k];
      delete clean.tabs; delete clean.activeTab; // private notes keep one page (see setPrivate)
      if (content !== null) {
        if (!vault.unlocked) return false; // never write plaintext; the window shows its lock screen
        savePrivate(id, content);
        windows.applyNoteProps(id, ['title']);
      }
    } else if (note && 'html' in clean && clean.html !== note.html) {
      history.beforeChange(id, note.html, note.updatedAt);
    }
    const keys = Object.keys(clean);
    if (!keys.length) return true;
    store.update(id, clean);
    // Switching or renaming tabs changes the mirrored title, so the window title follows.
    if (('tabs' in clean || 'activeTab' in clean) && !keys.includes('title')) keys.push('title');
    windows.applyNoteProps(id, keys);
    return true;
  });

  ipcMain.handle('note:toggle-roll', (e) => windows.toggleRoll(noteOf(e)));
  ipcMain.handle('note:new', (e) => { windows.newNote({ fromId: noteOf(e) }); });
  ipcMain.handle('note:close', (e) => windows.closeNote(noteOf(e)));
  ipcMain.handle('note:trash', (e) => windows.trashNote(noteOf(e)));
  ipcMain.handle('note:duplicate', (e) => { windows.duplicateNote(noteOf(e)); });
  ipcMain.handle('note:show-manager', (_e, view) => { windows.openManager(typeof view === 'string' ? view : undefined); });

  ipcMain.handle('note:export', async (e, format, payload) => {
    const id = noteOf(e);
    if (!['html', 'md', 'txt', 'pdf', 'print'].includes(format)) throw new Error('Unknown format');
    const p = payload || {};
    const note = store.get(id);
    const forExport = note.private ? { ...note, title: (plain.get(id) || {}).title || 'Private note' } : note;
    return exporter.exportNote({
      parent: parentOf(e), store, note: forExport, format,
      payload: { html: String(p.html || ''), text: String(p.text || ''), markdown: String(p.markdown || '') }
    });
  });

  // links between notes
  ipcMain.handle('note:titles', (e) => {
    const self = windows.noteIdFor(e.sender);
    return store.active().filter(n => n.id !== self && (!n.private || plain.has(n.id) || vault.unlocked))
      .map(n => ({ id: n.id, title: n.private ? (privatePlain(n) || {}).title || 'Private note' : n.title || 'Untitled note', color: n.color, updatedAt: n.updatedAt }))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  });
  ipcMain.handle('note:open-link', (_e, id) => {
    const n = store.get(String(id));
    if (!n) return { ok: false, reason: 'missing' };
    if (n.trashed) return { ok: false, reason: 'trashed' };
    windows.openNote(n.id, { focus: true });
    return { ok: true };
  });
  ipcMain.handle('note:create-linked', (e, title) => {
    const t = String(title || '').trim().slice(0, 120) || 'New note';
    const esc = t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const n = windows.newNote({ fromId: windows.noteIdFor(e.sender), html: `<h1>${esc}</h1><p><br></p>`, focus: false });
    return { id: n.id, title: t };
  });
  ipcMain.handle('note:backlinks', (e) => {
    const id = noteOf(e);
    return store.active().filter(n => n.id !== id && ((n.links || []).includes(id) || (n.private && (privatePlain(n) || { html: '' }).html.includes(`note://${id}"`))))
      .map(n => ({ id: n.id, title: n.private ? (privatePlain(n) || {}).title || 'Private note' : n.title || 'Untitled note', color: n.color }));
  });

  ipcMain.handle('tags:list', () => {
    const counts = new Map();
    for (const n of store.active()) for (const t of n.tags || []) counts.set(t, (counts.get(t) || 0) + 1);
    return [...counts].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
  });

  // templates
  ipcMain.handle('templates:list', () => store.templates.map(({ id, name, color }) => ({ id, name, color })));
  ipcMain.handle('templates:get', (_e, id) => store.getTemplate(id));
  ipcMain.handle('templates:expand', (_e, id) => {
    const t = store.getTemplate(id);
    return t ? expandTemplate(t.html) : null;
  });
  ipcMain.handle('templates:save', (_e, t) => store.saveTemplate(t || {}));
  ipcMain.handle('templates:delete', (e, id) => { managerOnly(e); store.deleteTemplate(id); });
  ipcMain.handle('templates:new-note', (e, id) => { newNoteFromTemplate(id, windows.noteIdFor(e.sender)); });

  // snipping
  ipcMain.handle('snip:start', (e, target) => {
    const self = windows.noteIdFor(e.sender);
    snipper.start(target === 'this' && self ? self : (target === 'last' ? 'last' : (target === 'new' ? 'new' : undefined)));
  });
  ipcMain.handle('snip:info', (e) => snipper.info(e.sender));
  ipcMain.handle('snip:done', (e, rect, choice) => {
    if (!rect || !(rect.width > 2) || !(rect.height > 2)) return null;
    if (choice === 'new' || choice === 'last') store.updateSettings({ snipTarget: choice });
    return snipper.finish(e.sender, rect, choice);
  });
  ipcMain.handle('snip:cancel', () => snipper.cancel());

  // ----- images -----
  ipcMain.handle('img:save', (_e, bytes, mime) => {
    if (!(bytes instanceof Uint8Array)) throw new Error('Expected bytes');
    return store.saveAttachment(bytes, mime);
  });

  ipcMain.handle('img:pick', async (e) => {
    const { canceled, filePaths } = await dialog.showOpenDialog(parentOf(e), {
      title: 'Insert image',
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'avif'] }],
      properties: ['openFile', 'multiSelections']
    });
    if (canceled) return [];
    const out = [];
    for (const f of filePaths) {
      try { out.push(exporter.imageFileToAttachment(store, f)); } catch (err) { console.warn('[img] skipped', f, err.message); }
    }
    return out;
  });

  ipcMain.handle('img:localize', async (_e, url) => {
    const src = String(url || '');
    try {
      if (src.startsWith('data:image/')) {
        const m = /^data:(image\/[\w+.-]+);base64,(.*)$/s.exec(src);
        if (!m) return null;
        return store.saveAttachment(Buffer.from(m[2], 'base64'), m[1]);
      }
      if (/^https?:\/\//i.test(src)) {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 15000);
        try {
          const res = await net.fetch(src, { signal: ctrl.signal });
          const type = (res.headers.get('content-type') || '').split(';')[0].trim();
          const len = Number(res.headers.get('content-length') || 0);
          if (!res.ok || !type.startsWith('image/') || len > 25 * 1024 * 1024) return null;
          const buf = Buffer.from(await res.arrayBuffer());
          return store.saveAttachment(buf, type);
        } finally { clearTimeout(timer); }
      }
    } catch (err) {
      console.warn('[img] localize failed:', err.message);
    }
    return null;
  });

  // Text recognition. Results are cached beside the image, except for private notes.
  ipcMain.handle('img:ocr', async (e, url) => {
    if (!store.settings.ocrImages) return '';
    const file = store.attachmentFromUrl(url);
    if (!file) return '';
    const id = windows.noteIdFor(e.sender);
    const note = id && store.get(id);
    if (note && note.private) {
      if (!vault.unlocked) return '';
      if (!fs.existsSync(file) && fs.existsSync(file + '.enc')) {
        const tmp = path.join(app.getPath('temp'), `stickies-ocr-${Date.now()}${path.extname(file)}`);
        fs.writeFileSync(tmp, vault.readEncryptedFile(file));
        try { return await ocr.recognize(tmp, { cache: false }); } finally { fs.rm(tmp, { force: true }, () => {}); }
      }
      return ocr.recognize(file, { cache: false });
    }
    return fs.existsSync(file) ? ocr.recognize(file) : '';
  });

  ipcMain.handle('img:open', (_e, url) => {
    const file = store.attachmentFromUrl(url);
    if (file && fs.existsSync(file)) {
      if (OPENABLE_RE.test(file)) return shell.openPath(file);
      shell.showItemInFolder(file); // e.g. SVG: don't hand a scriptable file to the browser
      return null;
    }
    if (/^https?:/i.test(String(url))) return openExternal(url);
    return null;
  });

  ipcMain.handle('img:save-as', (e, url) => exporter.saveImageAs({ parent: parentOf(e), store, url }));

  ipcMain.handle('shell:open-external', (_e, url) => { openExternal(url); });

  // ----- version history -----
  ipcMain.handle('history:open', (e, id) => {
    const noteId = windows.noteIdFor(e.sender) || (windows.manager && e.sender === windows.manager.webContents ? id : null);
    const n = noteId && store.get(noteId);
    if (!n || n.private) return false;
    windows.openHistory(noteId);
    return true;
  });
  ipcMain.handle('history:list', (e) => {
    const id = historyNote(e);
    const n = store.get(id);
    return { note: n ? { id: n.id, title: n.title, color: n.color, html: n.html, updatedAt: n.updatedAt } : null, versions: history.list(id), theme: themeName() };
  });
  ipcMain.handle('history:get', (e, t) => history.get(historyNote(e), Number(t)));
  ipcMain.handle('history:restore', async (e, t) => {
    const id = historyNote(e);
    const html = history.get(id, Number(t));
    const n = store.get(id);
    if (html === null || !n) return false;
    await windows.flushRenderer(windows.windowFor(id));
    history.beforeChange(id, n.html, n.updatedAt, { force: true }); // the current version stays restorable
    store.update(id, { html });
    windows.sendToNote(id, 'note:changed', { html });
    history.flush();
    return true;
  });

  // ----- private notes -----
  ipcMain.handle('vault:status', () => vault.status());
  ipcMain.handle('vault:setup', (_e, password, hint) => {
    try { const s = vault.setup(password, hint); onVaultUnlocked(); return { ok: true, status: s }; }
    catch (err) { return { ok: false, error: err.message }; }
  });
  ipcMain.handle('vault:unlock', (_e, password) => {
    const ok = vault.unlock(password);
    if (ok) onVaultUnlocked();
    return ok;
  });
  ipcMain.handle('vault:unlock-hello', async () => {
    const ok = await vault.unlockWithHello();
    if (ok) onVaultUnlocked();
    return ok;
  });
  ipcMain.handle('vault:lock', () => lockVault());
  ipcMain.handle('vault:set-hello', (_e, on) => {
    try { return { ok: true, status: vault.setHello(!!on) }; } catch (err) { return { ok: false, error: err.message }; }
  });
  ipcMain.handle('vault:change-password', (_e, pw, hint) => {
    try { return { ok: true, status: vault.changePassword(pw, hint) }; } catch (err) { return { ok: false, error: err.message }; }
  });
  ipcMain.handle('note:set-private', (e, on, id) => {
    const target = windows.noteIdFor(e.sender) || (windows.manager && e.sender === windows.manager.webContents ? id : null);
    return target ? setPrivate(target, !!on) : { ok: false };
  });

  // ----- workspaces -----
  ipcMain.handle('workspaces:list', () => ({ list: workspaces.list().map(({ layout, ...w }) => ({ ...w, count: layout.filter(l => l.open).length })), active: workspaces.active(), auto: !!store.settings.autoWorkspace }));
  ipcMain.handle('workspaces:save', (_e, name) => workspaces.save(name).id);
  ipcMain.handle('workspaces:update', (_e, id) => workspaces.update(id));
  ipcMain.handle('workspaces:switch', (_e, id) => workspaces.switchTo(id));
  ipcMain.handle('workspaces:rename', (_e, id, name) => workspaces.rename(id, name));
  ipcMain.handle('workspaces:delete', (_e, id) => workspaces.remove(id));

  // ----- settings -----
  ipcMain.handle('settings:get', () => ({ settings: store.settings, theme: themeName(), version: app.getVersion(), dataDir: store.dir, vault: vault.status() }));

  ipcMain.handle('settings:update', (_e, patch) => {
    const p = patch || {};
    const clean = {};
    const bool = (k) => { if (k in p) clean[k] = !!p[k]; };
    ['showInTaskbar', 'launchAtLogin', 'spellcheck', 'confirmDelete', 'snapToEdges', 'opaqueOnHover', 'ocrImages', 'sinkTicked', 'autoWorkspace', 'apiEnabled', 'agentPlanNudge'].forEach(bool);
    if (palette.notes[p.agentColor]) clean.agentColor = p.agentColor;
    if (['system', 'light', 'dark'].includes(p.theme)) clean.theme = p.theme;
    if (p.defaultColor === 'random' || palette.notes[p.defaultColor]) clean.defaultColor = p.defaultColor;
    if (palette.fonts.some(f => f.id === p.defaultFont)) clean.defaultFont = p.defaultFont;
    if (Number.isFinite(p.fontSize)) clean.fontSize = Math.min(28, Math.max(10, Math.round(p.fontSize)));
    if (['new', 'last'].includes(p.snipTarget)) clean.snipTarget = p.snipTarget;
    if (['popup', 'editing', 'always'].includes(p.toolbarMode)) clean.toolbarMode = p.toolbarMode;
    if (Number.isFinite(p.autoLockMinutes)) clean.autoLockMinutes = Math.min(240, Math.max(0, Math.round(p.autoLockMinutes)));
    if (Array.isArray(p.savedSearches)) {
      clean.savedSearches = p.savedSearches.filter(s => s && typeof s.query === 'string').slice(0, 50)
        .map(s => ({ id: String(s.id || 's' + Date.now().toString(36)).slice(0, 40), name: String(s.name || s.query).slice(0, 60), query: s.query.slice(0, 300) }));
    }
    if (p.hotkeys && typeof p.hotkeys === 'object') {
      clean.hotkeys = {};
      for (const k of HOTKEY_KEYS) if (typeof p.hotkeys[k] === 'string') clean.hotkeys[k] = p.hotkeys[k].slice(0, 60);
    }

    store.updateSettings(clean);
    let hotkeyResults = null;
    if ('theme' in clean) { nativeTheme.themeSource = clean.theme; windows.applyThemeToWindows(); }
    if ('showInTaskbar' in clean) windows.setSkipTaskbar(!clean.showInTaskbar);
    if ('launchAtLogin' in clean) setLoginItem(clean.launchAtLogin);
    if ('spellcheck' in clean) session.defaultSession.setSpellCheckerEnabled(clean.spellcheck);
    if (clean.hotkeys) hotkeyResults = registerHotkeys();
    if ('apiEnabled' in clean) { if (clean.apiEnabled) apiServer.start(); else apiServer.stop(); }
    if ('agentPlanNudge' in clean) apiServer.publish();
    broadcastSettings();
    return { settings: store.settings, theme: themeName(), hotkeyResults };
  });

  // ----- OpenCode -----
  ipcMain.handle('opencode:status', () => ({ ...opencode.status(), api: apiServer.running }));
  ipcMain.handle('opencode:connect', () => {
    if (!apiServer.running) { store.updateSettings({ apiEnabled: true }); apiServer.start(); }
    return { ...opencode.connect(), api: true };
  });
  ipcMain.handle('opencode:disconnect', () => ({ ...opencode.disconnect(), api: apiServer.running }));

  ipcMain.handle('settings:hotkey-status', () => {
    const out = {};
    for (const k of HOTKEY_KEYS) {
      const acc = store.settings.hotkeys[k];
      out[k] = !acc ? 'off' : (globalShortcut.isRegistered(acc) ? 'ok' : 'taken');
    }
    return out;
  });

  // ----- notes list (manager window) -----
  ipcMain.handle('notes:list', (e) => { managerOnly(e); return store.all().map(noteSummary); });
  ipcMain.handle('notes:open', (e, id) => { managerOnly(e); windows.openNote(id, { focus: true }); });
  ipcMain.handle('notes:close', (e, id) => { managerOnly(e); return windows.closeNote(id); });
  ipcMain.handle('notes:trash', (e, id) => { managerOnly(e); return windows.trashNote(id); });
  ipcMain.handle('notes:restore', (e, id) => { managerOnly(e); store.restore(id); });
  ipcMain.handle('notes:purge', (e, id) => {
    managerOnly(e);
    windows.destroyWindowFor(id);
    store.purge(id);
  });
  ipcMain.handle('notes:empty-trash', (e) => {
    managerOnly(e);
    for (const n of store.all().filter(n => n.trashed)) store.purge(n.id);
    store.emptyTrashedTabs();
  });
  ipcMain.handle('notes:new', (e) => { managerOnly(e); windows.newNote(); });
  ipcMain.handle('notes:duplicate', (e, id) => { managerOnly(e); windows.duplicateNote(id); });
  ipcMain.handle('notes:set-color', (e, id, color) => {
    managerOnly(e);
    if (!palette.notes[color]) return;
    store.update(id, { color });
    windows.applyNoteProps(id, ['color']);
    windows.sendToNote(id, 'note:changed', { color });
  });
  ipcMain.handle('notes:set-pinned', (e, id, pinned) => {
    managerOnly(e);
    store.update(id, { pinned: !!pinned });
    windows.applyNoteProps(id, ['pinned']);
    windows.sendToNote(id, 'note:changed', { pinned: !!pinned });
  });
  ipcMain.handle('notes:show-all', (e) => { managerOnly(e); windows.showAll(); });
  ipcMain.handle('notes:hide-all', (e) => { managerOnly(e); windows.hideAll(); });

  // Task list: tick an item in a note. Open notes do it themselves (keeps the caret and undo);
  // for closed ones the notes list edits the HTML and sends it back.
  ipcMain.handle('notes:toggle-task', (e, id, index, checked, text) => {
    managerOnly(e);
    const n = store.get(id);
    if (!n || (n.private && !vault.unlocked)) return { ok: false };
    if (windows.windowFor(id)) { windows.emitCommand(id, 'toggle-task', { index, checked, text }); return { ok: true }; }
    return { ok: false, needsHtml: true };
  });
  ipcMain.handle('notes:set-html', (e, id, html) => {
    managerOnly(e);
    const n = store.get(id);
    if (!n || typeof html !== 'string') return false;
    if (n.private) { if (!vault.unlocked) return false; savePrivate(id, html); return true; }
    store.update(id, { html });
    return true;
  });
  ipcMain.handle('notes:reveal-task', (e, id, index, text) => {
    managerOnly(e);
    windows.openNote(id, { focus: true });
    const win = windows.windowFor(id);
    const send = () => windows.emitCommand(id, 'reveal-task', { index, text });
    if (win && win.webContents.isLoading()) win.webContents.once('did-finish-load', () => setTimeout(send, 300));
    else send();
  });

  ipcMain.handle('data:export-backup', async (e) => {
    managerOnly(e);
    await Promise.all([...windows.notes.values()].map(w => windows.flushRenderer(w, 600)));
    return exporter.exportBackup({ parent: parentOf(e), store, vault });
  });
  ipcMain.handle('data:import-backup', async (e) => {
    managerOnly(e);
    try { return await exporter.importBackup({ parent: parentOf(e), store, vault }); }
    catch (err) { return { ok: false, error: err.message }; }
  });
  ipcMain.handle('data:import-files', async (e) => {
    managerOnly(e);
    const items = await exporter.importFiles({ parent: parentOf(e) });
    for (const it of items) {
      const note = store.create({ html: it.html, bounds: windows.placeNewBounds(null) });
      windows.openNote(note.id, { focus: false });
    }
    return { ok: true, added: items.length };
  });
  ipcMain.handle('data:open-folder', (e) => { managerOnly(e); return shell.openPath(store.dir); });
  // Right-click on a note's title bar outside Windows (Windows reports it natively, see windows.js).
  ipcMain.handle('note:titlebar-menu', (e) => {
    const id = noteOf(e);
    const note = id && store.get(id);
    const win = BrowserWindow.fromWebContents(e.sender);
    if (note && win) buildNoteMenu({ note, windows, noteId: note.id }).popup({ window: win });
  });

  // ----- tabs -----
  // The window saves its tabs first (note:update), so the closed tab is trashed with its latest text.
  ipcMain.handle('note:close-tab', (e, tabId) => {
    const id = noteOf(e);
    const n = store.trashTab(id, String(tabId || ''));
    if (!n) return null;
    windows.applyNoteProps(id, ['title']);
    return { tabs: n.tabs, activeTab: n.activeTab, html: n.html };
  });
  ipcMain.handle('notes:list-trashed-tabs', (e) => {
    managerOnly(e);
    return store.listTrashedTabs().map(t => ({
      id: t.id, noteId: t.noteId, noteTitle: t.noteTitle, title: t.title,
      text: t.text.slice(0, 4000), html: t.html, trashedAt: t.trashedAt
    }));
  });
  ipcMain.handle('notes:restore-tab', async (e, tabId) => {
    managerOnly(e);
    const t = store.trashedTabs.find(x => x.id === tabId);
    if (!t) return { ok: false };
    // Let an open note save its last keystrokes, or its next save would drop the restored tab.
    await windows.flushRenderer(windows.windowFor(t.noteId), 600);
    const r = store.restoreTab(tabId);
    if (!r) return { ok: false };
    const n = store.get(r.noteId);
    if (!r.created && n) {
      windows.sendToNote(n.id, 'note:changed', { tabs: n.tabs, activeTab: n.activeTab, html: n.html });
      windows.applyNoteProps(n.id, ['title']);
    }
    return { ok: true, created: r.created, noteId: r.noteId, noteTitle: t.noteTitle };
  });
  ipcMain.handle('notes:purge-tab', (e, tabId) => { managerOnly(e); return store.purgeTab(String(tabId || '')); });

  // ----- file shortcuts -----
  ipcMain.handle('file:info', (e, p, withThumb) => { noteOf(e); return files.fileInfo(p, { thumb: !!withThumb }); });
  ipcMain.handle('file:open', (e, p) => { noteOf(e); return files.openFile(p, parentOf(e)); });
  ipcMain.handle('file:show', (e, p) => { noteOf(e); return files.showFile(p); });
  ipcMain.handle('file:start-drag', (e, p) => { noteOf(e); return files.startDrag(e.sender, p, ASSETS); });

  // ----- image lightbox -----
  ipcMain.handle('img:lightbox', (e, url) => {
    noteOf(e);
    const s = String(url || '');
    if (!store.attachmentFromUrl(s) && !/^https?:\/\//i.test(s)) return false;
    windows.openLightbox(s, parentOf(e));
    return true;
  });
  ipcMain.handle('lightbox:close', (e) => {
    if (!windows.isLightbox(e.sender)) throw new Error('Not allowed');
    windows.closeLightbox();
  });
}

// ---------- lifecycle ----------
app.on('window-all-closed', () => { /* keep running in the tray */ });

app.on('before-quit', async (e) => {
  if (quitReady || !windows) return;
  e.preventDefault();
  windows.quitting = true;
  snipper.cancel();
  await Promise.all([...windows.notes.values()].map(w => windows.flushRenderer(w, 700)));
  store.flush();
  history.flush();
  if (apiServer) apiServer.stop();
  quitReady = true;
  app.quit();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  if (reminders) reminders.stop();
  if (tray) { try { tray.destroy(); } catch { /* ignore */ } }
  if (store) store.flush();
  if (history) history.flush();
  if (vault) vault.lock();
});

const WELCOME_HTML = [
  '<h2>Welcome to OpenStickies ✨</h2>',
  '<p>Notes can now hold <b>bold</b>, <i>italic</i>, <u>underline</u>, <s>strikethrough</s>, ',
  '<span style="color: #E5484D;">colored text</span>, <span style="background-color: #FFE45C;">highlights</span>, ',
  '<code>code</code> and <a href="https://example.com">links</a>.</p>',
  '<ul class="checklist">',
  '<li class="checked">Click a box to tick it off</li>',
  '<li>Paste, drop or insert an <b>image</b></li>',
  '<li>Type <code>/</code> for commands, <code>#</code> for tags, <code>[[</code> to link notes</li>',
  '</ul>',
  '<blockquote>Double-click the top bar to roll a note up. Right-click it for more options.</blockquote>',
  '<p><b>Shortcuts</b></p>',
  '<ul><li><b>Ctrl+N</b> new note · <b>Ctrl+D</b> delete</li>',
  '<li><b>Ctrl+Alt+N</b> new note from anywhere</li>',
  '<li><b>Ctrl+Alt+X</b> snip the screen into a note</li>',
  '<li><b>Ctrl+Alt+S</b> bring all notes to front</li></ul>'
].join('');

// The welcome note with its shortcuts written the way this keyboard labels them.
function welcomeHtml() {
  if (process.platform !== 'darwin') return WELCOME_HTML;
  return WELCOME_HTML.replace(/Ctrl\+Alt\+/g, '⌥⌘').replace(/Ctrl\+/g, '⌘');
}
