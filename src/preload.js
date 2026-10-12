'use strict';

const { contextBridge, ipcRenderer, webUtils } = require('electron');

const invoke = (ch, ...args) => ipcRenderer.invoke(ch, ...args);
const listen = (ch) => (cb) => {
  const fn = (_e, payload) => cb(payload);
  ipcRenderer.on(ch, fn);
  return () => ipcRenderer.removeListener(ch, fn);
};

contextBridge.exposeInMainWorld('stickies', {
  platform: process.platform,

  // note window
  init: () => invoke('note:init'),
  update: (patch) => invoke('note:update', patch),
  toggleRoll: () => invoke('note:toggle-roll'),
  newNote: () => invoke('note:new'),
  close: () => invoke('note:close'),
  trash: () => invoke('note:trash'),
  duplicate: () => invoke('note:duplicate'),
  exportNote: (format, payload) => invoke('note:export', format, payload),
  showManager: (view) => invoke('note:show-manager', view),
  onChanged: listen('note:changed'),
  onCommand: listen('note:command'),

  // images
  saveImage: (bytes, mime) => invoke('img:save', bytes, mime),
  pickImages: () => invoke('img:pick'),
  localizeImage: (url) => invoke('img:localize', url),
  openImage: (url) => invoke('img:open', url),
  saveImageAs: (url) => invoke('img:save-as', url),
  filePath: (file) => { try { return webUtils.getPathForFile(file); } catch { return ''; } },

  openExternal: (url) => invoke('shell:open-external', url),

  // settings
  getSettings: () => invoke('settings:get'),
  updateSettings: (patch) => invoke('settings:update', patch),
  hotkeyStatus: () => invoke('settings:hotkey-status'),
  onSettings: listen('settings:changed'),

  // notes list
  list: () => invoke('notes:list'),
  open: (id) => invoke('notes:open', id),
  closeNote: (id) => invoke('notes:close', id),
  trashNote: (id) => invoke('notes:trash', id),
  restore: (id) => invoke('notes:restore', id),
  purge: (id) => invoke('notes:purge', id),
  emptyTrash: () => invoke('notes:empty-trash'),
  create: () => invoke('notes:new'),
  duplicateNote: (id) => invoke('notes:duplicate', id),
  setColor: (id, color) => invoke('notes:set-color', id, color),
  setPinned: (id, pinned) => invoke('notes:set-pinned', id, pinned),
  showAll: () => invoke('notes:show-all'),
  hideAll: () => invoke('notes:hide-all'),
  onListChanged: listen('notes:changed'),
  onView: listen('manager:view'),

  toggleTask: (id, index, checked, text) => invoke('notes:toggle-task', id, index, checked, text),
  setHtml: (id, html) => invoke('notes:set-html', id, html),
  revealTask: (id, index, text) => invoke('notes:reveal-task', id, index, text),

  // links, tags, templates
  noteTitles: () => invoke('note:titles'),
  openNoteLink: (id) => invoke('note:open-link', id),
  createLinkedNote: (title) => invoke('note:create-linked', title),
  backlinks: () => invoke('note:backlinks'),
  listTags: () => invoke('tags:list'),
  listTemplates: () => invoke('templates:list'),
  getTemplate: (id) => invoke('templates:get', id),
  expandTemplate: (id) => invoke('templates:expand', id),
  saveTemplate: (t) => invoke('templates:save', t),
  deleteTemplate: (id) => invoke('templates:delete', id),
  newFromTemplate: (id) => invoke('templates:new-note', id),
  onTemplates: listen('templates:changed'),

  // screen snip + text recognition
  startSnip: (target) => invoke('snip:start', target),
  snipInfo: () => invoke('snip:info'),
  snipDone: (rect, choice) => invoke('snip:done', rect, choice),
  snipCancel: () => invoke('snip:cancel'),
  ocrImage: (url) => invoke('img:ocr', url),

  // version history
  openHistory: (id) => invoke('history:open', id),
  historyList: () => invoke('history:list'),
  historyGet: (t) => invoke('history:get', t),
  historyRestore: (t) => invoke('history:restore', t),

  // private notes
  vaultStatus: () => invoke('vault:status'),
  vaultSetup: (password, hint) => invoke('vault:setup', password, hint),
  vaultUnlock: (password) => invoke('vault:unlock', password),
  vaultUnlockHello: () => invoke('vault:unlock-hello'),
  vaultLock: () => invoke('vault:lock'),
  vaultSetHello: (on) => invoke('vault:set-hello', on),
  vaultChangePassword: (password, hint) => invoke('vault:change-password', password, hint),
  setPrivate: (on, id) => invoke('note:set-private', on, id),
  onVault: listen('vault:changed'),

  // workspaces
  listWorkspaces: () => invoke('workspaces:list'),
  saveWorkspace: (name) => invoke('workspaces:save', name),
  updateWorkspace: (id) => invoke('workspaces:update', id),
  switchWorkspace: (id) => invoke('workspaces:switch', id),
  renameWorkspace: (id, name) => invoke('workspaces:rename', id, name),
  deleteWorkspace: (id) => invoke('workspaces:delete', id),
  onWorkspaces: listen('workspaces:changed'),

  // OpenCode integration
  opencodeStatus: () => invoke('opencode:status'),
  opencodeConnect: () => invoke('opencode:connect'),
  opencodeDisconnect: () => invoke('opencode:disconnect'),

  // data
  exportBackup: () => invoke('data:export-backup'),
  importBackup: () => invoke('data:import-backup'),
  importFiles: () => invoke('data:import-files'),
  openDataFolder: () => invoke('data:open-folder')
});
