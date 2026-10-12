import { icon, hydrateIcons } from '../shared/icons.js';
import { htmlToMarkdown } from '../shared/html-to-md.js';
import { sanitizeHtml } from '../shared/sanitize.js';
import { Editor, normalizeUrl } from './editor.js';
import { Suggest, rank } from './suggest.js';
import { progress, checklistItems, applyResets, setReset, clearTicked, topChecklist, sinkItem, TAG_RE, ownText } from './smart.js';
import { escapeHtml } from '../shared/sanitize.js';
import { urgency, relativeLabel, playChime } from '../shared/reminder.js';
import palette from '../shared/colors.json' with { type: 'json' };

const api = window.stickies;
const $ = (id) => document.getElementById(id);
const root = document.documentElement;
const body = document.body;

let note = null;
let settings = null;
let theme = 'light';
let lastSaved = null;
let saveTimer = null;
let savePromise = Promise.resolve();
let openState = null;
let linkCtx = null;
let toastTimer = null;
let privateLocked = false;
let vaultState = { configured: false, unlocked: false, hello: false, helloAvailable: false, hint: '' };
// Messages that can arrive before init() has the note; applied once it does.
let pendingHighlight = null;
let pendingReminderFired = false;

// Toolbar buttons collapse into the "more" popover in this order as the note gets narrower.
const COLLAPSE_ORDER = ['table', 'strikeThrough', 'underline', 'link', 'insertOrderedList', 'style', 'image', 'color', 'checklist', 'insertUnorderedList', 'italic'];

hydrateIcons();

const editor = new Editor($('editor'), {
  api,
  content: $('content'),
  imgTools: $('img-tools'),
  dropCaret: $('img-drop-caret'),
  dropHint: $('drop-hint'),
  grip: $('li-grip'),
  itemDrop: $('item-drop'),
  onChange: scheduleSave,
  onSelection: scheduleToolbarState,
  toast
});

init().catch((err) => {
  console.error(err);
  toast('Something went wrong loading this note');
});

async function init() {
  const data = await api.init();
  note = data.note;
  settings = data.settings;
  theme = data.theme;
  vaultState = data.vault || vaultState;
  privateLocked = !!data.privateLocked;
  buildStaticUi();
  setupSmarts();
  applyAppearance();
  applyState();
  editor.setHTML(privateLocked ? '' : note.html);
  if (!privateLocked && applyResets(editor.el)) editor.changed();
  lastSaved = editor.getHTML();
  if (!privateLocked && editor.placeCursorToken()) lastSaved = null; // a note made from a template
  updateTitle(editor.getText());
  updateProgress();
  updateReminderUi();
  if (pendingHighlight) { showSearchHighlight(pendingHighlight); pendingHighlight = null; }
  if (pendingReminderFired) { pendingReminderFired = false; onReminderFired(); }
  if (document.hasFocus()) onFocus();
  if (privateLocked) setTimeout(() => $('lock-password').focus(), 50);
  else if (editor.isEmpty() && !note.locked) editor.focus(true);
  window.__stickiesFlush = flush;
}

// ---------- appearance ----------
function noteColors() {
  return (palette.notes[note.color] || palette.notes.yellow)[theme];
}

function applyAppearance() {
  root.dataset.theme = theme;
  const c = noteColors();
  root.style.setProperty('--bg', c.bg);
  root.style.setProperty('--bar', c.bar);
  root.style.setProperty('--text', c.text);
  root.style.setProperty('--accent', c.accent);
  const font = palette.fonts.find(f => f.id === note.font) || palette.fonts[0];
  root.style.setProperty('--note-font', font.css);
  root.style.setProperty('--note-size', `${settings.fontSize || 15}px`);
  root.style.setProperty('--zoom', String(note.zoom || 1));
  editor.setZoom(note.zoom || 1);
  editor.el.spellcheck = !!settings.spellcheck;
  editor.doneLast = !!settings.sinkTicked;
  editor.ocrEnabled = settings.ocrImages !== false;
  const mode = ['popup', 'editing', 'always'].includes(settings.toolbarMode) ? settings.toolbarMode : 'popup';
  body.classList.toggle('tb-popup', mode === 'popup');
  body.classList.toggle('tb-always', mode === 'always');
  updateToolbarVisibility();
}

// ---------- pop-up toolbar ----------
// Shown while text is selected, while the mouse is near the bottom edge, or while one of its
// menus is open; hidden as soon as you type. It floats, so the text area never changes size.
let pointerAtBottom = false;
function updateToolbarVisibility() {
  if (!body.classList.contains('tb-popup')) { body.classList.remove('show-toolbar'); return; }
  const sel = getSelection();
  const selecting = !!(sel.rangeCount && !sel.isCollapsed && editor.range());
  const busy = !!(openState && openState.anchor && openState.anchor.closest('.toolbar'));
  const show = !note || note.locked || note.rolled || privateLocked ? false : selecting || pointerAtBottom || busy;
  body.classList.toggle('show-toolbar', show);
}
document.addEventListener('mousemove', (e) => {
  const near = e.clientY > innerHeight - 52 && e.clientY < innerHeight;
  if (near !== pointerAtBottom) { pointerAtBottom = near; updateToolbarVisibility(); }
});
document.documentElement.addEventListener('mouseleave', () => { pointerAtBottom = false; updateToolbarVisibility(); });
document.addEventListener('selectionchange', () => updateToolbarVisibility());
document.addEventListener('keydown', (e) => {
  if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) { pointerAtBottom = false; updateToolbarVisibility(); }
});

function applyState() {
  body.classList.toggle('rolled', !!note.rolled);
  body.classList.toggle('locked', !!note.locked);
  editor.setLocked(note.locked);
  const pin = $('btn-pin');
  pin.classList.toggle('on', !!note.pinned);
  pin.innerHTML = icon(note.pinned ? 'pinFilled' : 'pin');
  pin.title = note.pinned ? 'Stop keeping on top (Ctrl+Shift+P)' : 'Keep on top (Ctrl+Shift+P)';
  const roll = $('btn-roll');
  roll.innerHTML = icon(note.rolled ? 'chevronDown' : 'chevronUp');
  roll.title = note.rolled ? 'Unroll (double-click title bar)' : 'Roll up (double-click title bar)';
  $('ind-lock').hidden = !note.locked;
  if (note.locked) closePops();
  $('ind-private').hidden = !note.private;
  body.classList.toggle('private-locked', !!(note.private && privateLocked));
  $('lockscreen').hidden = !(note.private && privateLocked);
  if (note.private && privateLocked) {
    $('lock-hello').hidden = !(vaultState.hello && vaultState.helloAvailable);
    $('lock-hint').textContent = vaultState.hint ? `Hint: ${vaultState.hint}` : '';
  }
}

function updateTitle(text) {
  const line = (text || '').split('\n').map(s => s.trim()).find(Boolean) || '';
  const title = line.length > 80 ? line.slice(0, 77) + '…' : line;
  const shown = note && note.private && privateLocked ? 'Private note' : title || 'Sticky note';
  document.title = shown;
  $('title-text').textContent = shown;
  return title;
}

// "3/8" in the title bar when the note has checklist items.
function updateProgress() {
  const pill = $('progress');
  const p = privateLocked ? { total: 0, done: 0 } : progress(editor.el);
  pill.hidden = !p.total;
  pill.textContent = `${p.done}/${p.total}`;
  pill.title = `${p.done} of ${p.total} done`;
  pill.classList.toggle('complete', p.total > 0 && p.done === p.total);
  return p;
}

// ---------- saving ----------
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 350);
}

function save() {
  clearTimeout(saveTimer);
  saveTimer = null;
  savePromise = savePromise.then(async () => {
    if (privateLocked) return; // never save the empty editor of a locked private note
    const html = editor.getHTML();
    if (html === lastSaved) return;
    lastSaved = html;
    const text = editor.getText();
    const title = updateTitle(text);
    const tasks = updateProgress();
    note.html = html;
    note.text = text;
    try {
      const ok = await api.update({ html, text, title, tasks });
      if (ok === false) lastSaved = null;
    } catch (err) { console.error('save failed', err); lastSaved = null; }
  });
  return savePromise;
}

async function flush() {
  if (body.classList.contains('source-mode')) exitSource(true);
  await save();
  return true;
}

function patchNote(patch) {
  Object.assign(note, patch);
  return api.update(patch);
}

// ---------- static UI built from the palette ----------
function buildStaticUi() {
  const sw = $('note-swatches');
  sw.innerHTML = palette.order.map(k => {
    const n = palette.notes[k];
    return `<button class="swatch" data-color="${k}" title="${n.name}" style="background:${n.light.bg};box-shadow:inset 0 -9px 0 ${n.swatch}"></button>`;
  }).join('');

  $('font-select').innerHTML = palette.fonts.map(f => `<option value="${f.id}" style="font-family:${f.css.replace(/"/g, "'")}">${f.name}</option>`).join('');

  const chip = (c, kind) => `<button class="color-chip" data-${kind}="${c.value}" title="${c.name}" style="${kind === 'text' ? `color:${c.value};background:var(--pop-bg)` : `background:${c.value};color:#1d1d1d`}">A</button>`;
  $('text-colors').innerHTML = `<button class="color-chip none" data-text="" title="Default color">A</button>` + palette.text.map(c => chip(c, 'text')).join('');
  $('hl-colors').innerHTML = `<button class="color-chip none" data-hl="" title="No highlight">⌀</button>` + palette.highlight.map(c => chip(c, 'hl')).join('');

  const grid = $('table-grid');
  grid.innerHTML = Array.from({ length: 36 }, (_, i) => `<span data-r="${Math.floor(i / 6) + 1}" data-c="${(i % 6) + 1}"></span>`).join('');
  grid.addEventListener('mouseover', (e) => {
    const s = e.target.closest('span');
    if (!s) return;
    const r = +s.dataset.r;
    const c = +s.dataset.c;
    for (const cell of grid.children) cell.classList.toggle('on', +cell.dataset.r <= r && +cell.dataset.c <= c);
    $('table-label').textContent = `Insert ${r} × ${c} table`;
  });
  grid.addEventListener('click', (e) => {
    const s = e.target.closest('span');
    if (!s) return;
    closePops();
    editor.insertTable(+s.dataset.r, +s.dataset.c);
  });

  const fmt = $('pop-format');
  const overflow = document.createElement('div');
  overflow.className = 'icon-row';
  overflow.id = 'overflow-row';
  overflow.hidden = true;
  const sep = document.createElement('div');
  sep.className = 'menu-sep';
  sep.id = 'overflow-sep';
  sep.hidden = true;
  fmt.prepend(overflow, sep);

  new ResizeObserver(layoutTools).observe($('toolbar'));
}

function layoutTools() {
  const tools = $('tools');
  if (!body.classList.contains('focused') && !body.classList.contains('tb-popup') && !body.classList.contains('tb-always')) return;
  tools.classList.remove('tight');
  for (const t of tools.querySelectorAll('.tool.collapsed')) t.classList.remove('collapsed');
  const fits = () => tools.scrollWidth <= tools.clientWidth + 1;
  const hidden = [];
  if (!fits()) tools.classList.add('tight');
  for (const key of COLLAPSE_ORDER) {
    if (fits()) break;
    const el = tools.querySelector(`.tool[data-cmd="${key}"], .tool[data-pop="${key}"]`);
    if (el) { el.classList.add('collapsed'); hidden.push(el); }
  }
  const row = $('overflow-row');
  row.innerHTML = '';
  const order = [...tools.querySelectorAll('.tool.collapsed')];
  for (const el of order) {
    const clone = el.cloneNode(true);
    clone.classList.remove('collapsed', 'active');
    clone.removeAttribute('id');
    row.appendChild(clone);
  }
  row.hidden = $('overflow-sep').hidden = !order.length;
}

// ---------- toolbar state ----------
let stateFrame = 0;
function scheduleToolbarState() {
  if (stateFrame) return;
  stateFrame = requestAnimationFrame(() => {
    stateFrame = 0;
    if (!editor.range()) return;
    const s = editor.state();
    for (const b of document.querySelectorAll('.tool[data-cmd]')) {
      const k = b.dataset.cmd;
      if (k in s) b.classList.toggle('active', !!s[k]);
    }
    for (const b of document.querySelectorAll('.style-item')) b.classList.toggle('active', b.dataset.block === s.block);
  });
}

document.addEventListener('selectionchange', scheduleToolbarState);
document.addEventListener('keyup', scheduleToolbarState);

// ---------- popovers ----------
function openPop(name, anchor, placement) {
  if (openState && openState.name === name) { closePops(); return; }
  closePops();
  if (note.locked && !['menu', 'reminder'].includes(name)) return;
  editor.saveSelection();
  const pop = $(`pop-${name}`);
  preparePop(name);
  pop.hidden = false;
  positionPop(pop, anchor, placement || (anchor && anchor.closest('.titlebar') ? 'below' : 'above'));
  if (anchor) anchor.classList.add('active');
  openState = { name, pop, anchor };
  const first = name === 'link' && $('link-text').value ? $('link-url') : pop.querySelector('input[type="text"]');
  if (first) setTimeout(() => first.focus(), 0);
}

function closePops() {
  setTimeout(updateToolbarVisibility, 0);
  if (!openState) return;
  openState.pop.hidden = true;
  if (openState.anchor) openState.anchor.classList.remove('active');
  for (const s of document.querySelectorAll('.submenu')) s.hidden = true;
  openState = null;
  scheduleToolbarState();
}

function positionPop(pop, anchor, placement) {
  const m = 6;
  const vw = innerWidth;
  const vh = innerHeight;
  const a = anchor ? anchor.getBoundingClientRect() : { left: vw / 2, right: vw / 2, top: vh / 2, bottom: vh / 2, width: 0 };
  pop.style.maxHeight = '';
  pop.style.left = '0px';
  pop.style.top = '0px';
  const w = pop.offsetWidth;
  let h = pop.offsetHeight;
  if (h > vh - 2 * m) { pop.style.maxHeight = `${vh - 2 * m}px`; h = vh - 2 * m; }
  let x = placement === 'below' ? a.right - w : a.left + a.width / 2 - w / 2;
  x = Math.max(m, Math.min(x, vw - w - m));
  const above = a.top - m;
  const below = vh - a.bottom - m;
  let y;
  if (placement === 'above') y = h <= above || above > below ? a.top - h - 4 : a.bottom + 4;
  else y = h <= below || below > above ? a.bottom + 4 : a.top - h - 4;
  y = Math.max(m, Math.min(y, vh - h - m));
  pop.style.left = `${Math.round(x)}px`;
  pop.style.top = `${Math.round(y)}px`;
}

function preparePop(name) {
  if (name === 'menu') {
    for (const s of document.querySelectorAll('.swatch')) s.classList.toggle('on', s.dataset.color === note.color);
    const pct = Math.round((note.opacity || 1) * 100);
    $('opacity').value = pct;
    $('opacity-value').textContent = `${pct}%`;
    $('font-select').value = note.font || 'default';
    $('chk-pin').classList.toggle('on', !!note.pinned);
    $('chk-lock').classList.toggle('on', !!note.locked);
    $('menu-reminder-hint').textContent = note.reminder ? shortTime(note.reminder.snoozeAt || note.reminder.at) : '';
    $('menu-private-label').textContent = note.private ? 'Make not private' : 'Make private…';
    $('menu-history').hidden = !!note.private;
    $('menu-snip-hint').textContent = prettyKey(settings.hotkeys && settings.hotkeys.snip);
    fillTemplatesMenu();
    fillBacklinks();
    const text = editor.getText();
    const words = text ? text.split(/\s+/).filter(Boolean).length : 0;
    const d = (t) => new Date(t).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
    $('menu-stats').innerHTML = `${words.toLocaleString()} word${words === 1 ? '' : 's'} · ${text.length.toLocaleString()} characters<br>Created ${d(note.createdAt)}<br>Edited ${d(note.updatedAt)}`;
  } else if (name === 'link') {
    linkCtx = linkCtx || editor.linkContext();
    $('link-text').value = linkCtx.text || '';
    $('link-url').value = linkCtx.url || '';
    $('link-remove').hidden = !linkCtx.anchor;
  } else if (name === 'reminder') {
    const r = note.reminder;
    const at = r ? new Date(r.snoozeAt || r.at) : roundedFuture(60);
    $('reminder-at').value = toLocalInput(at);
    $('reminder-repeat').value = r ? r.repeat || 'none' : 'none';
    $('reminder-clear').hidden = !r;
  } else if (name === 'table') {
    for (const cell of $('table-grid').children) cell.classList.remove('on');
    $('table-label').textContent = 'Insert table';
  }
}

document.addEventListener('mousedown', (e) => {
  const keepFocus = e.target.closest('.tool, .menu-item, .color-chip, .seg button, .swatch, .table-grid, .quick .chip, .tb-btn');
  if (keepFocus && !e.target.closest('input, select, textarea')) e.preventDefault();
  if (openState && !e.target.closest('.pop') && !(openState.anchor && openState.anchor.contains(e.target))) closePops();
});

document.addEventListener('click', async (e) => {
  const t = e.target;

  const sw = t.closest('.swatch');
  if (sw) { setColor(sw.dataset.color); return; }

  const textChip = t.closest('[data-text]');
  if (textChip && textChip.classList.contains('color-chip')) {
    editor.restoreSelection();
    editor.command('color', textChip.dataset.text);
    if (textChip.dataset.text) $('color-bar').style.background = textChip.dataset.text;
    closePops();
    return;
  }
  const hlChip = t.closest('[data-hl]');
  if (hlChip) {
    editor.restoreSelection();
    editor.command('highlight', hlChip.dataset.hl);
    closePops();
    return;
  }

  const blockBtn = t.closest('[data-block]');
  if (blockBtn) { editor.restoreSelection(); editor.command('block', blockBtn.dataset.block); closePops(); return; }

  const sizeBtn = t.closest('#size-seg [data-size]');
  if (sizeBtn) { editor.restoreSelection(); editor.command('size', sizeBtn.dataset.size); closePops(); return; }

  const tpl = t.closest('[data-template]');
  if (tpl) {
    closePops();
    const html = await api.expandTemplate(tpl.dataset.template);
    if (html) editor.insertTemplate(html);
    return;
  }
  const back = t.closest('[data-backlink]');
  if (back) { closePops(); openNoteLink(back.dataset.backlink); return; }

  const sub = t.closest('[data-sub]');
  if (sub) { const el = $(`sub-${sub.dataset.sub}`); el.hidden = !el.hidden; return; }

  const action = t.closest('[data-action]');
  if (action) { menuAction(action.dataset.action); return; }

  const popBtn = t.closest('[data-pop]');
  if (popBtn) {
    const anchor = popBtn.closest('.pop') ? $('tools').querySelector('[data-pop="format"]') : popBtn;
    openPop(popBtn.dataset.pop, anchor);
    return;
  }

  const cmdBtn = t.closest('[data-cmd]');
  if (cmdBtn) {
    const inPop = !!cmdBtn.closest('.pop');
    await runCmd(cmdBtn.dataset.cmd, cmdBtn);
    if (inPop && cmdBtn.classList.contains('menu-item')) closePops();
    scheduleToolbarState();
  }
});

async function runCmd(cmd, btn) {
  switch (cmd) {
    case 'image': {
      closePops();
      editor.saveSelection();
      const items = await api.pickImages();
      if (items && items.length) editor.insertImageUrls(items);
      else editor.restoreSelection();
      return;
    }
    case 'link': openLink(btn); return;
    case 'source': enterSource(); return;
    case 'find': closePops(); openFind(); return;
    default:
      if (openState) editor.restoreSelection();
      editor.command(cmd);
  }
}

async function menuAction(action) {
  switch (action) {
    case 'toggle-pin': togglePin(); closePops(); break;
    case 'toggle-lock': toggleLock(); closePops(); break;
    case 'reminder': closePops(); openPop('reminder', $('btn-menu'), 'below'); break;
    case 'source': enterSource(); break;
    case 'export-pdf': exportAs('pdf'); break;
    case 'export-html': exportAs('html'); break;
    case 'export-md': exportAs('md'); break;
    case 'export-txt': exportAs('txt'); break;
    case 'print': exportAs('print'); break;
    case 'copy-md': closePops(); await navigator.clipboard.writeText(htmlToMarkdown(editor.el)); toast('Copied as Markdown'); break;
    case 'copy-text': closePops(); await navigator.clipboard.writeText(editor.getText()); toast('Copied as plain text'); break;
    case 'duplicate': closePops(); await flush(); api.duplicate(); break;
    case 'toggle-private': togglePrivate(); break;
    case 'snip': closePops(); await flush(); api.startSnip('this'); break;
    case 'history': closePops(); await flush(); if (!(await api.openHistory())) toast('Private notes don’t keep version history'); break;
    case 'save-template': saveAsTemplate(); break;
    case 'list': closePops(); api.showManager(); break;
    case 'delete': closePops(); deleteNote(); break;
    default: break;
  }
}

// ---------- note-level actions ----------
function setColor(color) {
  if (!palette.notes[color] || color === note.color) return;
  patchNote({ color });
  applyAppearance();
  for (const s of document.querySelectorAll('.swatch')) s.classList.toggle('on', s.dataset.color === color);
}

function togglePin() {
  patchNote({ pinned: !note.pinned });
  applyState();
  toast(note.pinned ? 'Keeping this note on top' : 'No longer on top');
}

function toggleLock() {
  patchNote({ locked: !note.locked });
  applyState();
  toast(note.locked ? 'Note locked — checkboxes still work' : 'Note unlocked');
  if (!note.locked) editor.focus();
}

function setZoom(z) {
  const zoom = Math.round(Math.min(3, Math.max(0.5, z)) * 100) / 100;
  if (zoom === note.zoom) return;
  patchNote({ zoom });
  applyAppearance();
  toast(`Zoom ${Math.round(zoom * 100)}%`);
}

async function closeNote() {
  closePops();
  await flush();
  api.close();
}

async function deleteNote() {
  closePops();
  if (settings.confirmDelete && !editor.isEmpty()) {
    const r = await confirmDialog();
    if (!r.ok) return;
    if (r.check) api.updateSettings({ confirmDelete: false });
  }
  await flush();
  api.trash();
}

async function exportAs(format) {
  closePops();
  await flush();
  const payload = { html: editor.getHTML(), text: editor.getText(), markdown: htmlToMarkdown(editor.el) };
  try {
    const res = await api.exportNote(format, payload);
    if (res && res.ok && res.filePath) toast(`Saved ${res.filePath.split(/[\\/]/).pop()}`);
  } catch (err) {
    toast(`Export failed: ${err.message || err}`);
  }
}

// ---------- link popover ----------
function openLink(anchorBtn, anchorEl) {
  editor.saveSelection();
  linkCtx = anchorEl ? { anchor: anchorEl, text: anchorEl.textContent, url: anchorEl.getAttribute('href') } : editor.linkContext();
  // A button inside a popover (the overflow row) disappears when the link popover opens.
  const usable = anchorBtn && !anchorBtn.closest('.pop') ? anchorBtn : null;
  const btn = usable || $('tools').querySelector('[data-cmd="link"]:not(.collapsed)') || $('tools').querySelector('[data-pop="format"]');
  openPop('link', body.classList.contains('focused') ? btn : null);
}

$('link-save').addEventListener('click', () => {
  const url = $('link-url').value;
  if (!normalizeUrl(url)) { $('link-url').focus(); toast('Enter a web address or email'); return; }
  const ctx = { ...linkCtx, text: $('link-text').value, url };
  linkCtx = null;
  closePops();
  editor.applyLink(ctx);
});
$('link-remove').addEventListener('click', () => {
  const a = linkCtx && linkCtx.anchor;
  linkCtx = null;
  closePops();
  editor.removeLink(a);
});
$('link-cancel').addEventListener('click', () => { linkCtx = null; closePops(); editor.restoreSelection(); });
for (const id of ['link-text', 'link-url']) {
  $(id).addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('link-save').click(); } });
}

// ---------- reminders ----------
function toLocalInput(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function roundedFuture(minutes) {
  const d = new Date(Date.now() + minutes * 60000);
  d.setSeconds(0, 0);
  d.setMinutes(Math.ceil(d.getMinutes() / 5) * 5);
  return d;
}

function shortTime(t) {
  const d = new Date(t);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const tomorrow = new Date(now.getTime() + 86400000).toDateString() === d.toDateString();
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (sameDay) return time;
  if (tomorrow) return `Tomorrow ${time}`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' + time;
}

const REPEAT_LABEL = { daily: 'every day', weekdays: 'every weekday', weekly: 'every week', monthly: 'every month' };

function updateReminderUi() {
  const r = note.reminder;
  const ind = $('ind-reminder');
  ind.hidden = !r;
  ind.classList.toggle('due', !!(r && r.pending));
  if (r) ind.title = `Reminder: ${shortTime(r.snoozeAt || r.at)}${REPEAT_LABEL[r.repeat] ? ', ' + REPEAT_LABEL[r.repeat] : ''}`;
  $('reminder-banner').hidden = !(r && r.pending);
  if (r && r.pending) $('reminder-banner-text').textContent = `Reminder${note.title ? ': ' + note.title : ''}`;
  refreshReminderStrip();
}

function refreshReminderStrip() {
  const r = note && note.reminder;
  $('reminder-strip').hidden = !r;
  const level = urgency(r);
  if (level) body.dataset.urgency = level;
  else delete body.dataset.urgency;
  if (!r) return;
  const text = relativeLabel(r);
  $('reminder-strip-text').textContent = text;
  $('reminder-strip-open').title = `Reminder: ${shortTime(r.snoozeAt || r.at)} (click to change)`;
}

// Relative times ("in 2h 15m") and the urgency colour drift as time passes.
setInterval(() => { if (note) refreshReminderStrip(); }, 30 * 1000);

function onReminderFired() {
  updateReminderUi();
  playChime((settings && settings.reminderSound) || 'chime');
}

$('reminder-strip-open').addEventListener('click', (e) => openPop('reminder', e.currentTarget, 'below'));
$('reminder-strip-clear').addEventListener('click', () => { patchNote({ reminder: null }); updateReminderUi(); toast('Reminder removed'); });

$('reminder-quick').addEventListener('click', (e) => {
  const b = e.target.closest('.chip');
  if (!b) return;
  let d;
  if (b.dataset.in) d = new Date(Date.now() + Number(b.dataset.in) * 60000);
  else {
    d = new Date();
    d.setSeconds(0, 0);
    if (b.dataset.at === 'evening') { d.setHours(18, 0); if (d <= new Date()) d.setDate(d.getDate() + 1); }
    if (b.dataset.at === 'tomorrow') { d.setDate(d.getDate() + 1); d.setHours(9, 0); }
    if (b.dataset.at === 'monday') { d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7)); d.setHours(9, 0); }
  }
  $('reminder-at').value = toLocalInput(d);
});

$('reminder-save').addEventListener('click', () => {
  const at = new Date($('reminder-at').value).getTime();
  if (!Number.isFinite(at)) { toast('Pick a date and time'); return; }
  if (at <= Date.now()) { toast('Pick a time in the future'); return; }
  patchNote({ reminder: { at, repeat: $('reminder-repeat').value, pending: false, snoozeAt: null, dom: new Date(at).getDate(), setAt: Date.now() } });
  updateReminderUi();
  closePops();
  toast(`I'll remind you ${shortTime(at).startsWith('Tomorrow') ? '' : 'at '}${shortTime(at)}`);
});
$('reminder-clear').addEventListener('click', () => { patchNote({ reminder: null }); updateReminderUi(); closePops(); toast('Reminder removed'); });
$('reminder-cancel').addEventListener('click', closePops);

$('btn-dismiss').addEventListener('click', () => {
  const r = note.reminder;
  if (!r) return;
  patchNote({ reminder: r.repeat && r.repeat !== 'none' ? { ...r, pending: false } : null });
  updateReminderUi();
});
$('btn-snooze').addEventListener('click', () => {
  const r = note.reminder;
  if (!r) return;
  const later = Date.now() + 10 * 60000;
  patchNote({ reminder: r.repeat && r.repeat !== 'none' ? { ...r, pending: false, snoozeAt: later, setAt: Date.now() } : { ...r, at: later, pending: false, snoozeAt: null, setAt: Date.now() } });
  updateReminderUi();
  toast('Snoozed for 10 minutes');
});

// ---------- HTML source mode ----------
function prettyHtml(html) {
  return html
    .replace(/(<\/(p|h[1-6]|li|blockquote|pre|table|thead|tbody|tr|div)>|<br>|<hr>)(?!\n)/g, '$1\n')
    .replace(/(<(ul|ol|table|thead|tbody|tr)( [^>]*)?>)(?!\n)/g, '$1\n');
}

function enterSource() {
  closePops();
  if (note.locked) { toast('Unlock the note to edit its HTML'); return; }
  $('source').value = prettyHtml(editor.getHTML());
  body.classList.add('source-mode');
  $('source').hidden = false;
  $('source-bar').hidden = false;
  $('source').focus();
  $('source').setSelectionRange(0, 0);
}

function exitSource(apply) {
  if (!body.classList.contains('source-mode')) return;
  if (apply) {
    // Collapse the source's formatting whitespace so it doesn't turn into blank lines in the note.
    editor.setHTML(sanitizeHtml($('source').value, { mode: 'stored', normalize: true }));
    scheduleSave();
  }
  body.classList.remove('source-mode');
  $('source').hidden = true;
  $('source-bar').hidden = true;
  editor.focus();
}

$('source-apply').addEventListener('click', () => exitSource(true));
$('source-cancel').addEventListener('click', () => exitSource(false));
$('source').addEventListener('keydown', (e) => {
  if (e.key === 'Tab') {
    e.preventDefault();
    const ta = e.target;
    const s = ta.selectionStart;
    ta.setRangeText('  ', s, ta.selectionEnd, 'end');
  } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    exitSource(true);
  }
});

// ---------- find ----------
function openFind() {
  $('findbar').hidden = false;
  const input = $('find-input');
  const r = editor.range();
  if (r && !r.collapsed && r.toString().length < 80) input.value = r.toString();
  input.focus();
  input.select();
  runFind();
}

function runFind() {
  const q = $('find-input').value;
  const n = editor.findAll(q);
  $('find-count').textContent = q ? (n ? `${editor.find.index + 1} of ${n}` : 'No results') : '';
}

function closeFind(select = true) {
  if ($('findbar').hidden) return;
  if (select) editor.selectFindResult();
  editor.clearFind();
  $('findbar').hidden = true;
  if (!select) editor.focus();
}

$('find-input').addEventListener('input', runFind);
$('find-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    editor.findStep(e.shiftKey ? -1 : 1);
    const n = editor.find.ranges.length;
    if (n) $('find-count').textContent = `${editor.find.index + 1} of ${n}`;
  } else if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    closeFind(true);
  }
});
$('find-next').addEventListener('click', () => { editor.findStep(1); runFindCount(); });
$('find-prev').addEventListener('click', () => { editor.findStep(-1); runFindCount(); });
$('find-close').addEventListener('click', () => closeFind(false));
function runFindCount() {
  const n = editor.find.ranges.length;
  if (n) $('find-count').textContent = `${editor.find.index + 1} of ${n}`;
}

// ---------- search matches carried over from the notes list ----------
// Painted with the Highlight API so the note's HTML is never touched (and never saved with marks).
let searchHighlightOn = false;

function showSearchHighlight(terms) {
  clearSearchHighlight();
  if (privateLocked || typeof Highlight === 'undefined' || !CSS.highlights) return;
  const needles = [...new Set(terms.map(t => String(t).toLowerCase().trim()).filter(Boolean))];
  if (!needles.length) return;
  const ranges = [];
  const walker = document.createTreeWalker(editor.el, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    const text = node.data.toLowerCase();
    for (const q of needles) {
      for (let i = text.indexOf(q); i !== -1; i = text.indexOf(q, i + q.length)) {
        const r = document.createRange();
        r.setStart(node, i);
        r.setEnd(node, i + q.length);
        ranges.push(r);
      }
    }
  }
  if (!ranges.length) return;
  CSS.highlights.set('search-match', new Highlight(...ranges));
  searchHighlightOn = true;
  const first = ranges.reduce((a, b) => (a.compareBoundaryPoints(Range.START_TO_START, b) <= 0 ? a : b));
  const rect = first.getBoundingClientRect();
  const cr = $('content').getBoundingClientRect();
  if (rect.top < cr.top || rect.bottom > cr.bottom) $('content').scrollTop += rect.top - cr.top - cr.height / 3;
}

function clearSearchHighlight() {
  if (!searchHighlightOn) return false;
  searchHighlightOn = false;
  if (typeof CSS !== 'undefined' && CSS.highlights) CSS.highlights.delete('search-match');
  return true;
}

$('editor').addEventListener('input', clearSearchHighlight);
api.onHighlight((terms) => {
  if (!Array.isArray(terms)) return;
  if (note) showSearchHighlight(terms);
  else pendingHighlight = terms;
});

// ---------- confirm dialog ----------
function confirmDialog() {
  return new Promise((resolve) => {
    const modal = $('confirm');
    $('confirm-check').checked = false;
    modal.hidden = false;
    $('confirm-ok').focus();
    const done = (ok) => {
      modal.hidden = true;
      $('confirm-ok').removeEventListener('click', onOk);
      $('confirm-cancel').removeEventListener('click', onCancel);
      modal.removeEventListener('keydown', onKey);
      resolve({ ok, check: $('confirm-check').checked });
    };
    const onOk = () => done(true);
    const onCancel = () => done(false);
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); done(false); } };
    $('confirm-ok').addEventListener('click', onOk);
    $('confirm-cancel').addEventListener('click', onCancel);
    modal.addEventListener('keydown', onKey);
  });
}

function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2200);
}

// ---------- title bar & controls ----------
$('btn-new').addEventListener('click', () => api.newNote());
$('btn-pin').addEventListener('click', togglePin);
$('btn-roll').addEventListener('click', () => api.toggleRoll());
$('btn-menu').addEventListener('click', (e) => openPop('menu', e.currentTarget, 'below'));
$('btn-close').addEventListener('click', closeNote);
$('ind-lock').addEventListener('click', toggleLock);
$('ind-reminder').addEventListener('click', (e) => openPop('reminder', e.currentTarget, 'below'));

$('opacity').addEventListener('input', (e) => {
  const v = Number(e.target.value) / 100;
  $('opacity-value').textContent = `${e.target.value}%`;
  patchNote({ opacity: v });
});
$('font-select').addEventListener('change', (e) => {
  patchNote({ font: e.target.value });
  applyAppearance();
});

// ---------- focus, keyboard & zoom ----------
function onFocus() {
  body.classList.add('focused');
  requestAnimationFrame(layoutTools);
}
new ResizeObserver(() => requestAnimationFrame(layoutTools)).observe(document.body);

window.addEventListener('focus', onFocus);
window.addEventListener('blur', () => {
  body.classList.remove('focused', 'ctrl');
  closePops();
  if (saveTimer) save();
});

document.addEventListener('keyup', (e) => { if (e.key === 'Control') body.classList.remove('ctrl'); });

document.addEventListener('keydown', (e) => {
  if (e.key === 'Control') body.classList.add('ctrl');
  if (e.key === 'Escape') {
    if (!$('confirm').hidden) return;
    if (openState) { closePops(); editor.restoreSelection(); e.preventDefault(); return; }
    if (!$('findbar').hidden) { closeFind(e.target.id === 'find-input'); e.preventDefault(); return; }
    if (body.classList.contains('source-mode')) { exitSource(false); e.preventDefault(); return; }
    if (clearSearchHighlight()) e.preventDefault();
    return;
  }
  const mod = e.ctrlKey || e.metaKey;
  if (!mod || e.getModifierState('AltGraph')) return;
  const k = e.key.toLowerCase();
  const { shiftKey: shift, altKey: alt } = e;
  // Inside text fields (link, find, HTML source) only window-level shortcuts apply.
  if (e.target.closest('input, textarea, select') && !(!shift && !alt && 'nwdh'.includes(k) && k.length === 1)) return;
  let handled = true;

  if (alt && !shift && /^Digit[0-3]$/.test(e.code)) editor.command('block', ['p', 'h1', 'h2', 'h3'][Number(e.code.slice(5))]);
  else if (alt) handled = false;
  else if (!shift && k === 'n') api.newNote();
  else if (!shift && k === 'w') closeNote();
  else if (!shift && k === 'd') deleteNote();
  else if (!shift && k === 'h') api.showManager();
  else if (shift && k === 'h') enterSource();
  else if (!shift && k === 't') editor.command('strikeThrough');
  else if (shift && k === 'l') editor.command('insertUnorderedList');
  else if (shift && k === 'o') editor.command('insertOrderedList');
  else if (shift && k === 'c') editor.command('checklist');
  else if (!shift && k === 'k') openLink(null);
  else if (!shift && k === 'e') editor.command('code');
  else if (k === '\\') editor.command('removeFormat');
  else if (k === ';') editor.command('date');
  else if (!shift && k === 'f') openFind();
  else if (!shift && k === 'p') exportAs('print');
  else if (shift && k === 'p') togglePin();
  else if (shift && k === 'r') api.toggleRoll();
  else if (k === '=' || k === '+') setZoom((note.zoom || 1) + 0.1);
  else if (k === '-' || k === '_') setZoom((note.zoom || 1) - 0.1);
  else if (k === '0') setZoom(1);
  else if (shift && k === 'v') { editor.plainPasteNext = true; handled = false; }
  else handled = false;

  if (handled) { e.preventDefault(); e.stopPropagation(); }
}, true);

window.addEventListener('wheel', (e) => {
  if (!e.ctrlKey) return;
  e.preventDefault();
  setZoom((note.zoom || 1) + (e.deltaY < 0 ? 0.1 : -0.1));
}, { passive: false });

// ---------- messages from the main process ----------
api.onChanged((patch) => {
  if (!note) return;
  const { privateLocked: lockedNow, html, ...rest } = patch;
  Object.assign(note, rest);
  if ('color' in patch || 'font' in patch) applyAppearance();
  if (lockedNow === true) {
    privateLocked = true;
    closePops();
    editor.setHTML('');
    lastSaved = editor.getHTML();
  } else if (lockedNow === false) {
    privateLocked = false;
  }
  if (typeof html === 'string') {
    editor.setHTML(html);
    lastSaved = editor.getHTML();
  }
  applyState();
  updateTitle(editor.getText());
  updateProgress();
  if ('reminder' in patch) updateReminderUi();
  if (lockedNow === true) setTimeout(() => $('lock-password').focus(), 50);
});

api.onVault((status) => {
  vaultState = status;
  applyState();
});

api.onSettings(({ settings: s, theme: t }) => {
  if (!note) return;
  settings = s;
  theme = t;
  applyAppearance();
});

api.onTemplates(() => { templatesCache = null; });

api.onCommand(({ cmd, arg }) => {
  const target = editor.ctxTarget;
  switch (cmd) {
    case 'open-menu': openPop('menu', $('btn-menu'), 'below'); break;
    case 'toggle-pin': togglePin(); break;
    case 'toggle-lock': toggleLock(); break;
    case 'delete': deleteNote(); break;
    case 'reminder-fired': if (note) onReminderFired(); else pendingReminderFired = true; break;
    case 'image-size': if (target && target.nodeName === 'IMG') editor.setImageSize(target, arg); break;
    case 'image-delete': if (target && target.nodeName === 'IMG') editor.deleteImage(target); break;
    case 'image-wrap': if (target && target.nodeName === 'IMG') editor.setImageWrap(target, arg); break;
    case 'link-edit': { const a = target && target.closest('a'); if (a) openLink(null, a); break; }
    case 'link-remove': { const a = target && target.closest('a'); if (a) editor.removeLink(a); break; }
    case 'table': editor.tableOp(arg, target); break;
    case 'insert-text': editor.insertPlainText(arg); break;
    case 'insert-snip': editor.appendHTML(arg.html); editor.ocrImages(); break;
    case 'toggle-task': {
      const li = findTask(arg);
      if (li && li.classList.contains('checked') !== !!arg.checked) editor.toggleCheck(li);
      break;
    }
    case 'reveal-task': {
      const li = findTask(arg);
      if (li) { li.scrollIntoView({ block: 'center' }); li.classList.add('flash'); setTimeout(() => li.classList.remove('flash'), 1500); }
      break;
    }
    case 'checklist-reset': if (applyResets(editor.el)) editor.changed(); break;
    case 'checklist': {
      const list = topChecklist(target, editor.el);
      if (arg === 'daily' || arg === 'weekly' || arg === 'never') {
        setReset(list, arg);
        toast(arg === 'never' ? 'This list won’t untick by itself' : `Ticks clear ${arg === 'daily' ? 'every day' : 'every Monday'}`);
      } else if (arg === 'clear') {
        const n = clearTicked(list || editor.el);
        toast(n ? `Removed ${n} ticked item${n === 1 ? '' : 's'}` : 'Nothing ticked to remove');
      } else if (arg === 'sink') {
        for (const li of [...(list || editor.el).querySelectorAll('ul.checklist > li.checked')]) sinkItem(li);
      }
      editor.changed();
      break;
    }
    case 'copy-image-text':
      if (target && target.alt) { navigator.clipboard.writeText(target.alt); toast('Copied the text in the picture'); }
      break;
    case 'format': if (arg === 'clear') editor.command('removeFormat'); break;
    default: break;
  }
});


// ---------- tags, links between notes, "/" commands ----------
let tagsCache = null;
let titlesCache = null;
let templatesCache = null;

const SLASH = [
  { label: 'Title', icon: 'heading', keywords: 'h1 heading big', run: () => editor.command('block', 'h1') },
  { label: 'Heading', icon: 'heading', keywords: 'h2', run: () => editor.command('block', 'h2') },
  { label: 'Subheading', icon: 'heading', keywords: 'h3', run: () => editor.command('block', 'h3') },
  { label: 'Normal text', icon: 'textSize', keywords: 'paragraph plain', run: () => editor.command('block', 'p') },
  { label: 'Checklist', icon: 'checklist', keywords: 'todo task tick box', run: () => editor.command('checklist') },
  { label: 'Bulleted list', icon: 'listUl', keywords: 'bullet', run: () => editor.command('insertUnorderedList') },
  { label: 'Numbered list', icon: 'listOl', keywords: 'ordered number', run: () => editor.command('insertOrderedList') },
  { label: 'Quote', icon: 'quote', keywords: 'blockquote', run: () => editor.command('block', 'blockquote') },
  { label: 'Code block', icon: 'codeBlock', keywords: 'pre code', run: () => editor.command('block', 'pre') },
  { label: 'Divider', icon: 'hr', keywords: 'line rule separator', run: () => editor.command('hr') },
  { label: 'Table', icon: 'table', keywords: 'grid', run: () => editor.insertTable(3, 3) },
  { label: 'Image…', icon: 'image', keywords: 'picture photo', run: () => runCmd('image') },
  { label: 'Screen snip', icon: 'snip', keywords: 'screenshot capture', run: async () => { await flush(); api.startSnip('this'); } },
  { label: 'Link to note', icon: 'notes', keywords: 'wiki note [[', run: () => editor.insertPlainText('[[') },
  { label: 'Web link…', icon: 'link', keywords: 'url', run: () => openLink(null) },
  { label: 'Tag', icon: 'hash', keywords: '# label', run: () => editor.insertPlainText('#') },
  { label: 'Date', icon: 'calendar', keywords: 'today', run: () => editor.insertPlainText(new Date().toLocaleDateString(undefined, { dateStyle: 'medium' })) },
  { label: 'Time', icon: 'clock', keywords: 'now', run: () => editor.insertPlainText(new Date().toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })) },
  { label: 'Date and time', icon: 'calendarClock', keywords: 'now', run: () => editor.command('date') },
  { label: 'Reminder…', icon: 'bell', keywords: 'alarm remind', run: () => openPop('reminder', $('btn-menu'), 'below') }
];

function setupSmarts() {
  const suggest = new Suggest($('suggest'));
  editor.suggest = suggest;
  editor.onNoteLink = openNoteLink;
  editor.onTagClick = (tag) => api.showManager(`tag:${tag}`);
  editor.onTrigger = (trigger, node, start) => {
    if (trigger === '#') { tagsCache = null; suggest.open({ trigger, node, start, source: tagSource, pick: pickTag }); }
    else if (trigger === '[[') suggest.open({ trigger, node, start, source: linkSource, pick: pickLink });
    else suggest.open({ trigger, node, start, source: slashSource, pick: pickSlash });
  };
}

async function tagSource(q) {
  if (!tagsCache) {
    // Tags from all notes, plus ones typed in this note that haven't been saved yet.
    const known = await api.listTags();
    const here = new Set();
    for (const m of editor.getText().matchAll(TAG_RE)) if (!/^\d+$/.test(m[2])) here.add(m[2].toLowerCase());
    for (const t of known) here.delete(t.tag);
    tagsCache = [...known, ...[...here].map(tag => ({ tag, count: 1 }))];
  }
  const query = q.toLowerCase();
  const items = rank(tagsCache.map(t => ({ label: `#${t.tag}`, sub: `${t.count} note${t.count === 1 ? '' : 's'}`, icon: 'hash', tag: t.tag })), query, it => it.tag);
  if (query && !tagsCache.some(t => t.tag === query)) items.push({ label: `#${q}`, sub: 'New tag', icon: 'plus', tag: q });
  return items;
}

function pickTag(item, q, range) {
  tagsCache = null;
  editor.replaceRange(range, `#${item.tag} `, { text: true });
}

async function linkSource(q) {
  if (!titlesCache) titlesCache = await api.noteTitles();
  const items = rank(titlesCache.map(n => ({ label: n.title, id: n.id, color: palette.notes[n.color] ? palette.notes[n.color].swatch : null })), q, it => it.label);
  if (q.trim()) items.push({ label: `Create note “${q.trim()}”`, icon: 'plus', create: q.trim() });
  return items.length ? items : [{ label: 'Type a note title…', icon: 'notes', disabled: true }];
}

async function pickLink(item, q, range) {
  titlesCache = null;
  if (item.disabled) return;
  if (item.create) {
    const created = await api.createLinkedNote(item.create);
    editor.insertNoteLink(range, created.id, created.title);
    toast(`Created “${created.title}”`);
  } else {
    editor.insertNoteLink(range, item.id, item.label);
  }
}

async function slashSource(q) {
  if (!templatesCache) templatesCache = await api.listTemplates();
  const templates = templatesCache.map(t => ({ label: t.name, sub: 'Template', icon: 'template', keywords: 'template', template: t.id }));
  return rank([...SLASH, ...templates], q);
}

async function pickSlash(item, q, range) {
  editor.el.focus({ preventScroll: true });
  editor.selectRange(range);
  document.execCommand('delete');
  if (item.template) {
    const html = await api.expandTemplate(item.template);
    if (html) { editor.saveSelection(); editor.insertTemplate(html); }
  } else {
    item.run();
  }
}

async function openNoteLink(id) {
  const r = await api.openNoteLink(id);
  if (!r.ok) toast(r.reason === 'trashed' ? 'That note is in the Trash' : 'That note no longer exists');
}

async function fillTemplatesMenu() {
  const list = await api.listTemplates();
  templatesCache = list;
  $('sub-templates').innerHTML = list.length
    ? list.map(t => `<button class="menu-item" data-template="${t.id}"><span class="sg-dot" style="background:${(palette.notes[t.color] || palette.notes.yellow).swatch}"></span><span>${escapeHtml(t.name)}</span></button>`).join('')
    : '<div class="menu-foot">No templates yet — use “Save as template…”</div>';
}

async function fillBacklinks() {
  const list = await api.backlinks();
  $('menu-backlinks').hidden = !list.length;
  $('menu-backlinks-list').innerHTML = list.slice(0, 8).map(n => `<button class="backlink" data-backlink="${n.id}"><span class="sg-dot" style="background:${(palette.notes[n.color] || palette.notes.yellow).swatch}"></span><span>${escapeHtml(n.title)}</span></button>`).join('');
}

function prettyKey(acc) {
  return acc ? acc.replace(/CommandOrControl|CmdOrCtrl/g, 'Ctrl') : '';
}

// ---------- templates ----------
async function saveAsTemplate() {
  closePops();
  if (privateLocked) return;
  const name = await promptDialog({ title: 'Save as template', value: note.title || 'My template', ok: 'Save' });
  if (!name) return;
  await flush();
  await api.saveTemplate({ name, html: editor.getHTML(), color: note.color });
  templatesCache = null;
  toast(`Saved template “${name}” — type / to use it`);
}

function promptDialog({ title, value = '', ok = 'OK', password = false }) {
  return new Promise((resolve) => {
    const modal = $('prompt');
    const input = $('prompt-input');
    $('prompt-title').textContent = title;
    $('prompt-ok').textContent = ok;
    input.type = password ? 'password' : 'text';
    input.value = value;
    modal.hidden = false;
    input.focus();
    input.select();
    editor.saveSelection();
    const done = (v) => {
      modal.hidden = true;
      if (!privateLocked && !note.locked) editor.restoreSelection(); // give the caret back to the note
      $('prompt-form').removeEventListener('submit', onSubmit);
      $('prompt-cancel').removeEventListener('click', onCancel);
      modal.removeEventListener('keydown', onKey);
      resolve(v);
    };
    const onSubmit = (e) => { e.preventDefault(); done(input.value.trim() ? input.value : null); };
    const onCancel = () => done(null);
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); done(null); } };
    $('prompt-form').addEventListener('submit', onSubmit);
    $('prompt-cancel').addEventListener('click', onCancel);
    modal.addEventListener('keydown', onKey);
  });
}

// ---------- private notes ----------
async function togglePrivate() {
  closePops();
  vaultState = await api.vaultStatus();
  if (!note.private) {
    if (!vaultState.configured) {
      toast('First choose a password for private notes');
      api.showManager('privacy');
      return;
    }
    if (!vaultState.unlocked) {
      const pw = await promptDialog({ title: 'Password for private notes', ok: 'Unlock', password: true });
      if (!pw) return;
      if (!(await api.vaultUnlock(pw))) { toast('That password isn’t right'); return; }
    }
    await flush();
    const r = await api.setPrivate(true);
    if (r && r.ok) toast('Private: encrypted, and hidden from search until unlocked');
  } else {
    if (!vaultState.unlocked) { toast('Unlock private notes first'); return; }
    await flush();
    const r = await api.setPrivate(false);
    if (r && r.ok) toast('This note is no longer private');
  }
}

$('lock-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = $('lock-password');
  const ok = await api.vaultUnlock(input.value);
  input.value = '';
  if (!ok) {
    $('lock-sub').textContent = 'That password isn’t right. Try again.';
    const ls = $('lockscreen');
    ls.classList.remove('shake');
    void ls.offsetWidth;
    ls.classList.add('shake');
    input.focus();
  }
});
$('lock-hello').addEventListener('click', async () => {
  if (!(await api.vaultUnlockHello())) toast('Windows Hello didn’t unlock your notes');
});
$('ind-private').addEventListener('click', async () => {
  if (!privateLocked) { await flush(); api.vaultLock(); }
});

// Items are addressed by position plus text: ticked items sink, so positions can shift
// between the notes list reading the note and the click arriving.
function findTask({ index, text }) {
  const items = checklistItems(editor.el);
  const at = items[index];
  if (!at || text == null || ownText(at).trim() === text) return at;
  return items.find(li => ownText(li).trim() === text) || at;
}
