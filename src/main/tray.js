'use strict';

const { Tray, Menu, nativeImage } = require('electron');
const path = require('path');

function createTray({ windows, store, vault, workspaces, assetsDir, onQuit, onSnip, onTemplate, onLock }) {
  const img = nativeImage.createFromPath(path.join(assetsDir, 'tray.png'));
  const hiDpi = path.join(assetsDir, 'tray@2x.png');
  try { img.addRepresentation({ scaleFactor: 2, buffer: require('fs').readFileSync(hiDpi) }); } catch { /* optional */ }
  const tray = new Tray(img);
  tray.setToolTip('OpenStickies');

  const rebuild = () => {
    const active = store.active();
    const open = active.filter(n => n.open).length;
    const hk = store.settings.hotkeys;
    const spaces = workspaces.list();
    const template = [
      { label: 'New note', accelerator: hk.newNote || undefined, click: () => windows.newNote() },
      {
        label: 'New from template', submenu: store.templates.length
          ? store.templates.map(t => ({ label: t.name, click: () => onTemplate(t.id) }))
          : [{ label: 'No templates yet', enabled: false }]
      },
      { label: 'Snip screen to note', accelerator: hk.snip || undefined, click: onSnip },
      { type: 'separator' },
      { label: `Show all notes${open ? ` (${open})` : ''}`, accelerator: hk.showAll || undefined, click: () => windows.showAll() },
      { label: 'Hide all notes', click: () => windows.hideAll() },
      { label: 'Notes list…', click: () => windows.openManager() },
      { label: 'Tasks…', click: () => windows.openManager('tasks') }
    ];
    if (spaces.length) {
      template.push({
        label: 'Workspaces', submenu: [
          ...spaces.map(w => ({ label: w.name, type: 'radio', checked: w.id === workspaces.active(), click: () => workspaces.switchTo(w.id) })),
          { type: 'separator' },
          { label: 'Manage workspaces…', click: () => windows.openManager('workspaces') }
        ]
      });
    }
    if (vault.unlocked) template.push({ label: 'Lock private notes', click: onLock });
    template.push(
      { type: 'separator' },
      { label: 'Settings…', click: () => windows.openManager('settings') },
      { type: 'separator' },
      { label: `Quit OpenStickies`, click: onQuit }
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
  if (!store.settings.trayHintShown) {
    setTimeout(() => {
      try {
        tray.displayBalloon({
          iconType: 'custom',
          icon: nativeImage.createFromPath(path.join(assetsDir, 'icon.png')),
          title: 'OpenStickies is in your system tray',
          content: 'Click the ^ arrow at the right end of the taskbar, then drag the yellow OpenStickies icon onto the taskbar to keep it visible. Click it any time to bring your notes back.'
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
