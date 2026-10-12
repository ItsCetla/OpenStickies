'use strict';

const { Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const { t: tr } = require('./i18n');

// True when something owns org.kde.StatusNotifierWatcher (KDE, XFCE, Ubuntu's GNOME, ...). Asks
// D-Bus through dbus-send or gdbus, so no dependency is needed. A failed probe counts as no tray:
// opening the notes list beats starting invisibly.
function linuxTrayHost() {
  const { execFileSync } = require('child_process');
  const name = 'org.kde.StatusNotifierWatcher';
  const probes = [
    ['dbus-send', ['--session', '--print-reply', '--dest=org.freedesktop.DBus', '/org/freedesktop/DBus',
      'org.freedesktop.DBus.NameHasOwner', `string:${name}`], /boolean true/],
    ['gdbus', ['call', '--session', '--dest', 'org.freedesktop.DBus', '--object-path', '/org/freedesktop/DBus',
      '--method', 'org.freedesktop.DBus.NameHasOwner', name], /\(true,\)/]
  ];
  for (const [cmd, args, yes] of probes) {
    try {
      return yes.test(execFileSync(cmd, args, { timeout: 1500, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
    } catch { /* tool missing or no answer: try the next one */ }
  }
  return false;
}

function createTray({ windows, store, vault, workspaces, assetsDir, onQuit, onSnip, onTemplate, onLock }) {
  // The macOS menu bar wants a black-and-clear "template" image that it tints for light and dark
  // bars; everywhere else gets the yellow note.
  const mac = process.platform === 'darwin';
  const img = nativeImage.createFromPath(path.join(assetsDir, mac ? 'trayTemplate.png' : 'tray.png'));
  const hiDpi = path.join(assetsDir, mac ? 'trayTemplate@2x.png' : 'tray@2x.png');
  try { img.addRepresentation({ scaleFactor: 2, buffer: require('fs').readFileSync(hiDpi) }); } catch { /* optional */ }
  if (mac) img.setTemplateImage(true);
  // Some Linux desktops (stock GNOME without the AppIndicator extension) have no tray at all, but
  // Electron creates the Tray anyway and its icon is never shown. Check for a StatusNotifierWatcher
  // on the session bus first and skip the Tray without one, so the caller opens the notes list.
  if (process.platform === 'linux' && !linuxTrayHost()) {
    console.warn('OpenStickies: no system tray host on the session bus');
    return null;
  }
  let tray;
  try { tray = new Tray(img); } catch (err) { console.warn('OpenStickies: no system tray available', err); return null; }
  tray.setToolTip('OpenStickies');

  const rebuild = () => {
    const active = store.active();
    const open = active.filter(n => n.open).length;
    const hk = store.settings.hotkeys;
    const spaces = workspaces.list();
    const template = [
      { label: tr('tray.newNote'), accelerator: hk.newNote || undefined, click: () => windows.newNote() },
      {
        label: tr('tray.newFromTemplate'), submenu: store.templates.length
          ? store.templates.map(tpl => ({ label: tpl.name, click: () => onTemplate(tpl.id) }))
          : [{ label: tr('tray.noTemplates'), enabled: false }]
      },
      { label: tr('tray.snip'), accelerator: hk.snip || undefined, click: onSnip },
      { type: 'separator' },
      { label: open ? tr('tray.showAllCount', { count: open }) : tr('tray.showAll'), accelerator: hk.showAll || undefined, click: () => windows.showAll() },
      { label: tr('tray.hideAll'), click: () => windows.hideAll() },
      { label: tr('tray.notesList'), click: () => windows.openManager() },
      { label: tr('tray.tasks'), click: () => windows.openManager('tasks') }
    ];
    if (spaces.length) {
      template.push({
        label: tr('tray.workspaces'), submenu: [
          ...spaces.map(w => ({ label: w.name, type: 'radio', checked: w.id === workspaces.active(), click: () => workspaces.switchTo(w.id) })),
          { type: 'separator' },
          { label: tr('tray.manageWorkspaces'), click: () => windows.openManager('workspaces') }
        ]
      });
    }
    if (vault.unlocked) template.push({ label: tr('tray.lockPrivate'), click: onLock });
    template.push(
      { type: 'separator' },
      { label: tr('tray.settings'), click: () => windows.openManager('settings') },
      { type: 'separator' },
      { label: tr('tray.quit'), click: onQuit }
    );
    const menu = Menu.buildFromTemplate(template);
    tray.setContextMenu(menu);
  };

  rebuild();
  let t;
  const soon = () => { clearTimeout(t); t = setTimeout(rebuild, 500); };
  store.on('changed', soon);
  store.on('settings', soon);
  store.on('templates', soon);
  vault.on('locked', soon);
  vault.on('unlocked', soon);

  // New tray icons start out hidden behind the taskbar's ^ arrow, and Windows doesn't let an
  // app move itself out, so point it out once.
  if (process.platform === 'win32' && !store.settings.trayHintShown) {
    setTimeout(() => {
      try {
        tray.displayBalloon({
          iconType: 'custom',
          icon: nativeImage.createFromPath(path.join(assetsDir, 'icon.png')),
          title: tr('tray.balloonTitle'),
          content: tr('tray.balloonBody')
        });
      } catch { /* balloons unsupported */ }
      store.updateSettings({ trayHintShown: true });
    }, 2500);
  }
  tray.on('balloon-click', () => windows.showAll());
  tray.on('click', () => windows.showAll());
  tray.on('double-click', () => windows.openManager());
  return tray;
}

module.exports = { createTray };
