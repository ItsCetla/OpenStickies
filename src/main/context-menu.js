'use strict';

const { Menu, clipboard, shell, nativeImage, ClipboardItem } = require('electron');
const { OPENABLE_RE, MAX_TABS } = require('./store');
const exporter = require('./exporter');

function attachNoteContextMenu({ win, noteId, store, windows, openExternal }) {
  const wc = win.webContents;
  const cmd = (name, arg) => () => windows.emitCommand(noteId(), name, arg);

  wc.on('context-menu', async (_e, params) => {
    let ctx = null;
    try { ctx = await wc.executeJavaScript('window.__stickiesCtx || null', true); } catch { /* ignore */ }
    ctx = ctx || {};
    const note = store.get(noteId());
    const locked = !!(note && note.locked);
    const t = [];

    if (params.misspelledWord) {
      for (const s of params.dictionarySuggestions.slice(0, 6)) {
        t.push({ label: s, click: () => wc.replaceMisspelling(s) });
      }
      if (!params.dictionarySuggestions.length) t.push({ label: 'No suggestions', enabled: false });
      t.push({ label: 'Add to dictionary', click: () => wc.session.addWordToSpellCheckerDictionary(params.misspelledWord) });
      t.push({ type: 'separator' });
    }

    // ctx.onImage also covers "behind text" images, which sit under the text Chromium hit-tests.
    const imageUrl = (params.mediaType === 'image' && params.srcURL) || (ctx.onImage && ctx.imageSrc) || null;
    if (imageUrl) {
      const url = imageUrl;
      const local = store.attachmentFromUrl(url);
      t.push({
        label: 'Copy image',
        click: async () => {
          const img = local && nativeImage.createFromPath(local);
          if (img && !img.isEmpty()) {
            await clipboard.write([new ClipboardItem({ 'image/png': new Blob([img.toPNG()], { type: 'image/png' }) })]);
          } else wc.copyImageAt(params.x, params.y);
        }
      });
      if (local) {
        if (OPENABLE_RE.test(local)) t.push({ label: 'Open image', click: () => shell.openPath(local) });
        t.push({ label: 'Save image as…', click: () => exporter.saveImageAs({ parent: win, store, url }) });
        t.push({ label: 'Show in folder', click: () => shell.showItemInFolder(local) });
        if (ctx.imageText) t.push({ label: 'Copy text in picture', click: cmd('copy-image-text') });
      } else if (/^https?:/i.test(url)) {
        t.push({ label: 'Open image in browser', click: () => openExternal(url) });
      }
      if (!locked) {
        t.push({ type: 'separator' });
        const wrap = ctx.imageWrap || 'inline';
        const layout = (label, value) => ({ label, type: 'radio', checked: wrap === value, click: cmd('image-wrap', value) });
        t.push({
          label: 'Layout', submenu: [
            layout('In line with text', 'inline'),
            layout('Wrap text — image on the left', 'left'),
            layout('Wrap text — image on the right', 'right'),
            layout('Top and bottom', 'block'),
            { type: 'separator' },
            layout('Behind text', 'behind'),
            layout('In front of text', 'front')
          ]
        });
        t.push({
          label: 'Image size', submenu: [
            { label: 'Small', click: cmd('image-size', 'small') },
            { label: 'Medium', click: cmd('image-size', 'medium') },
            { label: 'Large', click: cmd('image-size', 'large') },
            { label: 'Fit width', click: cmd('image-size', 'full') },
            { label: 'Original size', click: cmd('image-size', 'original') }
          ]
        });
        t.push({ label: 'Delete image', click: cmd('image-delete') });
      }
      t.push({ type: 'separator' });
    }

    if (params.linkURL && params.linkURL.startsWith('note://')) {
      const target = store.get(params.linkURL.slice(7));
      t.push({ label: target && !target.trashed ? 'Open linked note' : 'Linked note was deleted', enabled: !!(target && !target.trashed), click: () => windows.openNote(target.id, { focus: true }) });
      if (!locked) t.push({ label: 'Remove link', click: cmd('link-remove') });
      t.push({ type: 'separator' });
    } else if (params.linkURL) {
      const url = params.linkURL;
      t.push({ label: 'Open link', click: () => openExternal(url) });
      t.push({ label: 'Copy link address', click: () => clipboard.writeText(url) });
      if (!locked) {
        t.push({ label: 'Edit link…', click: cmd('link-edit') });
        t.push({ label: 'Remove link', click: cmd('link-remove') });
      }
      t.push({ type: 'separator' });
    }

    if (ctx.inChecklist && !locked) {
      const reset = ctx.checklistReset || 'never';
      t.push({
        label: 'Checklist', submenu: [
          { label: 'Untick everything each day', type: 'radio', checked: reset === 'daily', click: cmd('checklist', 'daily') },
          { label: 'Untick everything each Monday', type: 'radio', checked: reset === 'weekly', click: cmd('checklist', 'weekly') },
          { label: 'Never untick automatically', type: 'radio', checked: reset === 'never', click: cmd('checklist', 'never') },
          { type: 'separator' },
          { label: 'Move ticked items to the bottom', click: cmd('checklist', 'sink') },
          { label: 'Remove ticked items', click: cmd('checklist', 'clear') }
        ]
      });
      t.push({ type: 'separator' });
    }

    if (ctx.inTable && !locked) {
      t.push({
        label: 'Table', submenu: [
          { label: 'Insert row above', click: cmd('table', 'row-above') },
          { label: 'Insert row below', click: cmd('table', 'row-below') },
          { label: 'Insert column left', click: cmd('table', 'col-left') },
          { label: 'Insert column right', click: cmd('table', 'col-right') },
          { type: 'separator' },
          { label: 'Delete row', click: cmd('table', 'row-delete') },
          { label: 'Delete column', click: cmd('table', 'col-delete') },
          { label: 'Delete table', click: cmd('table', 'delete') }
        ]
      });
      t.push({ type: 'separator' });
    }

    if (params.isEditable) {
      t.push(
        { role: 'undo', enabled: params.editFlags.canUndo },
        { role: 'redo', enabled: params.editFlags.canRedo },
        { type: 'separator' },
        { role: 'cut', enabled: params.editFlags.canCut },
        { role: 'copy', enabled: params.editFlags.canCopy },
        { role: 'paste', enabled: params.editFlags.canPaste },
        { label: 'Paste as plain text', accelerator: 'CmdOrCtrl+Shift+V', enabled: params.editFlags.canPaste, click: async () => windows.emitCommand(noteId(), 'insert-text', await clipboard.readText()) },
        { role: 'selectAll' }
      );
      if (ctx.editor && params.selectionText) {
        t.push({ type: 'separator' }, { label: 'Clear formatting', click: cmd('format', 'clear') });
      }
    } else {
      if (params.selectionText) t.push({ role: 'copy' });
      t.push({ role: 'selectAll' });
    }

    if (ctx.editor) {
      t.push({ type: 'separator' });
      t.push({ label: locked ? 'Unlock note' : 'Lock note', click: cmd('toggle-lock') });
    }

    if (ctx.editor && note && !note.private && !locked) {
      t.push({ label: 'New tab', accelerator: 'CommandOrControl+Shift+T', enabled: !note.tabs || note.tabs.length < MAX_TABS, click: cmd('new-tab') });
    }

    while (t.length && t[t.length - 1].type === 'separator') t.pop();
    if (t.length) Menu.buildFromTemplate(t).popup({ window: win });
  });
}

function buildNoteMenu({ note, windows, noteId }) {
  const emit = (c, a) => () => windows.emitCommand(noteId, c, a);
  return Menu.buildFromTemplate([
    { label: 'New note', accelerator: 'CmdOrCtrl+N', click: () => windows.newNote({ fromId: noteId }) },
    { label: 'Notes list', click: () => windows.openManager() },
    { type: 'separator' },
    { label: 'Always on top', type: 'checkbox', checked: !!note.pinned, click: emit('toggle-pin') },
    { label: 'Roll up', type: 'checkbox', checked: !!note.rolled, click: () => windows.toggleRoll(noteId) },
    { label: 'Lock editing', type: 'checkbox', checked: !!note.locked, click: emit('toggle-lock') },
    { type: 'separator' },
    { label: 'Duplicate', click: () => windows.duplicateNote(noteId) },
    { label: 'Close', accelerator: 'CmdOrCtrl+W', click: () => windows.closeNote(noteId) },
    { label: 'Delete note', accelerator: 'CmdOrCtrl+D', click: emit('delete') },
    { label: 'New tab', accelerator: 'CommandOrControl+Shift+T', visible: !note.private, enabled: !note.locked && (!note.tabs || note.tabs.length < MAX_TABS), click: emit('new-tab') }
  ]);
}

module.exports = { attachNoteContextMenu, buildNoteMenu };
