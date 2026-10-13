'use strict';

const { Menu, clipboard, shell, nativeImage, ClipboardItem } = require('electron');
const { OPENABLE_RE, MAX_TABS } = require('./store');
const exporter = require('./exporter');
const files = require('./files');
const { t: tr } = require('./i18n');

// Same ids and labels as LANGUAGES in src/renderer/note/highlight.js (an ES module the
// main process can't require), in the order the menu shows them.
const CODE_LANGUAGES = [
  ['text', 'Plain text'], // shown through menu.plainText
  ['javascript', 'JavaScript'],
  ['typescript', 'TypeScript'],
  ['python', 'Python'],
  ['sql', 'SQL'],
  ['html', 'HTML'],
  ['xml', 'XML'],
  ['css', 'CSS'],
  ['json', 'JSON'],
  ['bash', 'Shell'],
  ['c', 'C'],
  ['cpp', 'C++'],
  ['java', 'Java'],
  ['csharp', 'C#'],
  ['go', 'Go'],
  ['rust', 'Rust'],
  ['yaml', 'YAML'],
  ['markdown', 'Markdown']
];

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
      if (!params.dictionarySuggestions.length) t.push({ label: tr('menu.noSuggestions'), enabled: false });
      t.push({ label: tr('menu.addToDictionary'), click: () => wc.session.addWordToSpellCheckerDictionary(params.misspelledWord) });
      t.push({ type: 'separator' });
    }

    // ctx.onImage also covers "behind text" images, which sit under the text Chromium hit-tests.
    const imageUrl = (params.mediaType === 'image' && params.srcURL) || (ctx.onImage && ctx.imageSrc) || null;
    if (imageUrl) {
      const url = imageUrl;
      const local = store.attachmentFromUrl(url);
      t.push({
        label: tr('menu.copyImage'),
        click: async () => {
          const img = local && nativeImage.createFromPath(local);
          if (img && !img.isEmpty()) {
            await clipboard.write([new ClipboardItem({ 'image/png': new Blob([img.toPNG()], { type: 'image/png' }) })]);
          } else wc.copyImageAt(params.x, params.y);
        }
      });
      if (local) {
        if (OPENABLE_RE.test(local)) t.push({ label: tr('menu.openImage'), click: () => shell.openPath(local) });
        t.push({ label: tr('menu.saveImageAs'), click: () => exporter.saveImageAs({ parent: win, store, url }) });
        t.push({ label: tr('menu.showInFolder'), click: () => shell.showItemInFolder(local) });
        if (ctx.imageText) t.push({ label: tr('menu.copyTextInPicture'), click: cmd('copy-image-text') });
      } else if (/^https?:/i.test(url)) {
        t.push({ label: tr('menu.openImageInBrowser'), click: () => openExternal(url) });
      }
      if (!locked) {
        t.push({ type: 'separator' });
        const wrap = ctx.imageWrap || 'inline';
        const layout = (label, value) => ({ label, type: 'radio', checked: wrap === value, click: cmd('image-wrap', value) });
        t.push({
          label: tr('menu.layout'), submenu: [
            layout(tr('menu.wrapInline'), 'inline'),
            layout(tr('menu.wrapLeft'), 'left'),
            layout(tr('menu.wrapRight'), 'right'),
            layout(tr('menu.wrapBlock'), 'block'),
            { type: 'separator' },
            layout(tr('menu.wrapBehind'), 'behind'),
            layout(tr('menu.wrapFront'), 'front')
          ]
        });
        t.push({
          label: tr('menu.imageSize'), submenu: [
            { label: tr('menu.sizeSmall'), click: cmd('image-size', 'small') },
            { label: tr('menu.sizeMedium'), click: cmd('image-size', 'medium') },
            { label: tr('menu.sizeLarge'), click: cmd('image-size', 'large') },
            { label: tr('menu.sizeFitWidth'), click: cmd('image-size', 'full') },
            { label: tr('menu.sizeOriginal'), click: cmd('image-size', 'original') }
          ]
        });
        t.push({ label: tr('menu.deleteImage'), click: cmd('image-delete') });
      }
      t.push({ type: 'separator' });
    }

    if (params.linkURL && params.linkURL.startsWith('note://')) {
      const target = store.get(params.linkURL.slice(7));
      t.push({ label: target && !target.trashed ? tr('menu.openLinkedNote') : tr('menu.linkedNoteDeleted'), enabled: !!(target && !target.trashed), click: () => windows.openNote(target.id, { focus: true }) });
      if (!locked) t.push({ label: tr('menu.removeLink'), click: cmd('link-remove') });
      t.push({ type: 'separator' });
    } else if (params.linkURL) {
      const url = params.linkURL;
      t.push({ label: tr('menu.openLink'), click: () => openExternal(url) });
      t.push({ label: tr('menu.copyLinkAddress'), click: () => clipboard.writeText(url) });
      if (!locked) {
        t.push({ label: tr('menu.editLink'), click: cmd('link-edit') });
        t.push({ label: tr('menu.removeLink'), click: cmd('link-remove') });
      }
      t.push({ type: 'separator' });
    }

    // A file shortcut chip. Opening goes through the note so it can warn about programs and say when the file is gone.
    const filePath = ctx.onFile && typeof ctx.filePath === 'string' ? files.validFilePath(ctx.filePath) : null;
    if (filePath) {
      const folder = ctx.fileKind === 'folder';
      t.push({ label: folder ? tr('menu.openFolder') : tr('menu.open'), click: cmd('file-open') });
      t.push({ label: tr('menu.showInFolder'), click: () => files.showFile(filePath) });
      t.push({ label: tr('menu.copyPath'), click: () => clipboard.writeText(filePath) });
      if (!locked) t.push({ label: tr('menu.remove'), click: cmd('file-remove') });
      t.push({ type: 'separator' });
    }

    if (ctx.inChecklist && !locked) {
      const reset = ctx.checklistReset || 'never';
      t.push({
        label: tr('menu.checklist'), submenu: [
          { label: tr('menu.untickDaily'), type: 'radio', checked: reset === 'daily', click: cmd('checklist', 'daily') },
          { label: tr('menu.untickWeekly'), type: 'radio', checked: reset === 'weekly', click: cmd('checklist', 'weekly') },
          { label: tr('menu.untickNever'), type: 'radio', checked: reset === 'never', click: cmd('checklist', 'never') },
          { type: 'separator' },
          { label: tr('menu.sinkTicked'), click: cmd('checklist', 'sink') },
        { label: tr('menu.foldTicked'), type: 'checkbox', checked: !!ctx.checklistFolded, click: cmd('checklist', 'fold') },
          { label: tr('menu.removeTicked'), click: cmd('checklist', 'clear') }
        ]
      });
      t.push({ type: 'separator' });
    }

    if (ctx.inTable && !locked) {
      t.push({
        label: tr('menu.table'), submenu: [
          { label: tr('menu.rowAbove'), click: cmd('table', 'row-above') },
          { label: tr('menu.rowBelow'), click: cmd('table', 'row-below') },
          { label: tr('menu.colLeft'), click: cmd('table', 'col-left') },
          { label: tr('menu.colRight'), click: cmd('table', 'col-right') },
          { type: 'separator' },
          { label: tr('menu.deleteRow'), click: cmd('table', 'row-delete') },
          { label: tr('menu.deleteCol'), click: cmd('table', 'col-delete') },
          { label: tr('menu.deleteTable'), click: cmd('table', 'delete') }
        ]
      });
      t.push({ type: 'separator' });
    }

    if (ctx.inCode && !locked) {
      const current = ctx.codeLang || 'auto';
      const lang = (id, label) => ({ label, type: 'radio', checked: current === id, click: cmd('code-lang', id) });
      t.push({
        label: tr('menu.codeLanguage'), submenu: [
          lang('auto', tr('menu.autoDetect')),
          { type: 'separator' },
          ...CODE_LANGUAGES.map(([id, label]) => lang(id, id === 'text' ? tr('menu.plainText') : label))
        ]
      });
      t.push({ type: 'separator' });
    }

    if (params.isEditable) {
      t.push(
        { role: 'undo', label: tr('menu.undo'), enabled: params.editFlags.canUndo },
        { role: 'redo', label: tr('menu.redo'), enabled: params.editFlags.canRedo },
        { type: 'separator' },
        { role: 'cut', label: tr('menu.cut'), enabled: params.editFlags.canCut },
        { role: 'copy', label: tr('menu.copy'), enabled: params.editFlags.canCopy },
        { role: 'paste', label: tr('menu.paste'), enabled: params.editFlags.canPaste },
        { label: tr('menu.pasteAsPlainText'), accelerator: 'CmdOrCtrl+Shift+V', enabled: params.editFlags.canPaste, click: async () => windows.emitCommand(noteId(), 'insert-text', await clipboard.readText()) },
        { role: 'selectAll', label: tr('menu.selectAll') }
      );
      if (ctx.editor && params.selectionText) {
        t.push({ type: 'separator' }, { label: tr('menu.clearFormatting'), click: cmd('format', 'clear') });
      }
    } else {
      if (params.selectionText) t.push({ role: 'copy', label: tr('menu.copy') });
      t.push({ role: 'selectAll', label: tr('menu.selectAll') });
    }

    if (ctx.editor) {
      t.push({ type: 'separator' });
      t.push({ label: locked ? tr('menu.unlockNote') : tr('menu.lockNote'), click: cmd('toggle-lock') });
      t.push({ label: tr('menu.customBackground'), click: cmd('custom-background') });
    }

    // Window-level toggles, so right-clicking anywhere (including a locked title bar, which no
    // longer gets the native system menu) reaches pin and roll-up.
    if (note) {
      t.push({ type: 'separator' });
      t.push({ label: tr('menu.alwaysOnTop'), type: 'checkbox', checked: !!note.pinned, click: cmd('toggle-pin') });
      t.push({ label: tr('menu.rollUp'), type: 'checkbox', checked: !!note.rolled, click: () => windows.toggleRoll(noteId()) });
    }

    if (ctx.editor && note && !note.private && !locked) {
      t.push({ label: tr('menu.newTab'), accelerator: 'CommandOrControl+Shift+T', enabled: !note.tabs || note.tabs.length < MAX_TABS, click: cmd('new-tab') });
    }

    while (t.length && t[t.length - 1].type === 'separator') t.pop();
    if (t.length) Menu.buildFromTemplate(t).popup({ window: win });
  });
}

function buildNoteMenu({ note, windows, noteId }) {
  const emit = (c, a) => () => windows.emitCommand(noteId, c, a);
  return Menu.buildFromTemplate([
    { label: tr('menu.newNote'), accelerator: 'CmdOrCtrl+N', click: () => windows.newNote({ fromId: noteId }) },
    { label: tr('menu.notesList'), click: () => windows.openManager() },
    { type: 'separator' },
    { label: tr('menu.alwaysOnTop'), type: 'checkbox', checked: !!note.pinned, click: emit('toggle-pin') },
    { label: tr('menu.rollUp'), type: 'checkbox', checked: !!note.rolled, click: () => windows.toggleRoll(noteId) },
    { label: tr('menu.lockNote'), type: 'checkbox', checked: !!note.locked, click: emit('toggle-lock') },
    { type: 'separator' },
    { label: tr('menu.duplicate'), click: () => windows.duplicateNote(noteId) },
    { label: tr('menu.close'), accelerator: 'CmdOrCtrl+W', click: () => windows.closeNote(noteId) },
    { label: tr('menu.deleteNote'), accelerator: 'CmdOrCtrl+D', click: emit('delete') },
    { label: tr('menu.newTab'), accelerator: 'CommandOrControl+Shift+T', visible: !note.private, enabled: !note.locked && (!note.tabs || note.tabs.length < MAX_TABS), click: emit('new-tab') },
    { type: 'separator' },
    { label: tr('menu.customBackground'), click: emit('custom-background') }
  ]);
}

module.exports = { attachNoteContextMenu, buildNoteMenu };
