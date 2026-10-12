import { icon, hydrateIcons } from '../shared/icons.js';
import { htmlToMarkdown, fileUrl } from '../shared/html-to-md.js';
import { sanitizeHtml } from '../shared/sanitize.js';
import { Editor, normalizeUrl } from './editor.js';
import { Suggest, rank } from './suggest.js';
import { progress, checklistItems, applyResets, setReset, clearTicked, topChecklist, sinkItem, TAG_RE, ownText } from './smart.js';
import { escapeHtml } from '../shared/sanitize.js';
import { IS_MAC, MOD_KEY, keyLabel, localizeKeys } from '../shared/keys.js';
import { HoverPreview } from './chips.js';
import { urgency, relativeLabel, playChime } from '../shared/reminder.js';
import palette from '../shared/colors.json' with { type: 'json' };
import { applyTranslations, refreshI18n, t as tr, tp, lang as uiLang, colorName, fontName, gradientName } from '../shared/i18n.js';
import { GRADIENT_PRESETS, deriveColors, deriveGradientColors, gradientCss, safeBackground, isHex } from '../shared/backgrounds.js';

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
let tabs = null; // null for a one-page note, else [{ id, title, renamed, html, text, scroll }]
let activeTab = 0;
// Messages that can arrive before init() has the note; applied once it does.
let pendingHighlight = null;
let pendingReminderFired = false;

// Toolbar buttons collapse into the "more" popover in this order as the note gets narrower.
const COLLAPSE_ORDER = ['table', 'strikeThrough', 'underline', 'link', 'insertOrderedList', 'style', 'image', 'color', 'checklist', 'insertUnorderedList', 'italic'];

applyTranslations();
hydrateIcons();
localizeKeys();
$('lock-hello-label').textContent = unlockMethodLabel();

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

new HoverPreview($('hover-card'), {
  api,
  root: editor.el,
  isBusy: () => !!editor._draggingItem || !!editor.el.querySelector('img.dragging')
});

init().catch((err) => {
  console.error(err);
  toast(tr('note.loadFailed'));
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
  initTabs();
  editor.setHTML(privateLocked ? '' : note.html);
  if (!privateLocked && applyResets(editor.el)) editor.changed();
  lastSaved = editor.getHTML();
  if (!privateLocked && editor.placeCursorToken()) lastSaved = null; // a note made from a template
  updateTitle(editor.getText());
  updateProgress();
  updateReminderUi();
  if (pendingReminderFired) { pendingReminderFired = false; onReminderFired(); }
  if (document.hasFocus()) onFocus();
  if (privateLocked) setTimeout(() => $('lock-password').focus(), 50);
  else if (editor.isEmpty() && !note.locked) editor.focus(true);
  if (tabs) afterTabLoad(tabs[activeTab]);
  // After afterTabLoad, so its scroll restore doesn't undo the scroll to the match.
  if (pendingHighlight) { showSearchHighlight(pendingHighlight); pendingHighlight = null; }
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
  // Code-token colours follow how dark the note actually is, not the app theme.
  root.dataset.noteTone = applyBackground(c) ? 'dark' : 'light';
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
  // Token colors follow the theme through CSS; repainting picks up blocks changed meanwhile.
  editor.highlightCode();
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
  pin.title = keyLabel(tr(note.pinned ? 'note.stopKeepOnTopHint' : 'note.keepOnTopHint'));
  const roll = $('btn-roll');
  roll.innerHTML = icon(note.rolled ? 'chevronDown' : 'chevronUp');
  roll.title = tr(note.rolled ? 'note.unrollHint' : 'note.rollUpHint');
  $('ind-lock').hidden = !note.locked;
  if (note.locked) closePops();
  $('ind-private').hidden = !note.private;
  body.classList.toggle('private-locked', !!(note.private && privateLocked));
  $('lockscreen').hidden = !(note.private && privateLocked);
  if (note.private && privateLocked) {
    $('lock-hello').hidden = !(vaultState.hello && vaultState.helloAvailable);
    $('lock-hint').textContent = vaultState.hint ? tr('note.hint', { hint: vaultState.hint }) : '';
  }
  renderTabs(); // locking hides the close and + buttons
}

function updateTitle(text) {
  const line = (text || '').split('\n').map(s => s.trim()).find(Boolean) || '';
  const title = line.length > 80 ? line.slice(0, 77) + '…' : line;
  const tab = tabs && tabs[activeTab];
  const named = tab && tab.renamed ? tab.title : title;
  const shown = note && note.private && privateLocked ? tr('note.privateNote') : named || tr('note.stickyNote');
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
  pill.title = tr('note.progressDone', { done: p.done, total: p.total });
  pill.classList.toggle('complete', p.total > 0 && p.done === p.total);
  return p;
}

// ---------- saving ----------
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 350);
  recordUndo();
}

function save() {
  clearTimeout(saveTimer);
  saveTimer = null;
  const forTab = tabs && tabs[activeTab] ? tabs[activeTab].id : null;
  savePromise = savePromise.then(async () => {
    if (privateLocked) return; // never save the empty editor of a locked private note
    // A save queued before a tab switch would otherwise write the new tab's page into the old one;
    // the switch already saved the old page, and typing in the new one schedules its own save.
    if (forTab !== (tabs && tabs[activeTab] ? tabs[activeTab].id : null)) return;
    const html = editor.getHTML();
    if (html === lastSaved) return;
    lastSaved = html;
    const text = editor.getText();
    const title = updateTitle(text);
    const tasks = updateProgress();
    note.html = html;
    note.text = text;
    // The main process writes this into the active tab too; keep our copy and its label in step.
    if (tabs && tabs[activeTab]) {
      Object.assign(tabs[activeTab], { html, text }, tabs[activeTab].renamed ? {} : { title });
      renderTabs();
    }
    try {
      const ok = await api.update({ html, text, title, tasks });
      if (ok === false) lastSaved = null;
    } catch (err) { console.error('save failed', err); lastSaved = null; }
  });
  return savePromise;
}

async function flush() {
  if (body.classList.contains('source-mode')) exitSource(true);
  if (bgSaveTimer) await saveBackground(); // so Duplicate / close never miss a just-picked background
  await save();
  await flushTabs();
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
    return `<button class="swatch" data-color="${k}" title="${escapeHtml(colorName(n.name))}" style="background:${n.light.bg};box-shadow:inset 0 -9px 0 ${n.swatch}"></button>`;
  }).join('');
  sw.insertAdjacentHTML('beforeend', `<button class="swatch-custom" id="swatch-custom" title="${escapeHtml(tr('note.customBackground'))}" aria-label="${escapeHtml(tr('note.customBackground'))}"></button>`);

  $('font-select').innerHTML = palette.fonts.map(f => `<option value="${f.id}" style="font-family:${f.css.replace(/"/g, "'")}">${escapeHtml(fontName(f))}</option>`).join('');

  const chip = (c, kind) => `<button class="color-chip" data-${kind}="${c.value}" title="${escapeHtml(colorName(c.name))}" style="${kind === 'text' ? `color:${c.value};background:var(--pop-bg)` : `background:${c.value};color:#1d1d1d`}">A</button>`;
  $('text-colors').innerHTML = `<button class="color-chip none" data-text="" title="${escapeHtml(tr('note.defaultColor'))}">A</button>` + palette.text.map(c => chip(c, 'text')).join('');
  $('hl-colors').innerHTML = `<button class="color-chip none" data-hl="" title="${escapeHtml(tr('note.noHighlight'))}">⌀</button>` + palette.highlight.map(c => chip(c, 'hl')).join('');

  const grid = $('table-grid');
  grid.innerHTML = Array.from({ length: 36 }, (_, i) => `<span data-r="${Math.floor(i / 6) + 1}" data-c="${(i % 6) + 1}"></span>`).join('');
  grid.addEventListener('mouseover', (e) => {
    const s = e.target.closest('span');
    if (!s) return;
    const r = +s.dataset.r;
    const c = +s.dataset.c;
    for (const cell of grid.children) cell.classList.toggle('on', +cell.dataset.r <= r && +cell.dataset.c <= c);
    $('table-label').textContent = tr('note.insertTableSize', { rows: r, cols: c });
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
  if (note.locked && !['menu', 'reminder', 'bg'].includes(name)) return;
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
    // A custom colour/gradient replaces the palette colour; a picture still uses it as its tint.
    const custom = !!note.background && note.background.type !== 'image';
    if (custom) for (const s of document.querySelectorAll('.swatch')) s.classList.remove('on');
    $('swatch-custom').classList.toggle('on', custom);
    const pct = Math.round((note.opacity || 1) * 100);
    $('opacity').value = pct;
    $('opacity-value').textContent = `${pct}%`;
    $('font-select').value = note.font || 'default';
    $('chk-pin').classList.toggle('on', !!note.pinned);
    $('chk-lock').classList.toggle('on', !!note.locked);
    $('chk-roll').classList.toggle('on', !!note.rolled);
    $('menu-reminder-hint').textContent = note.reminder ? shortTime(note.reminder.snoozeAt || note.reminder.at) : '';
    $('menu-private-label').textContent = tr(note.private ? 'note.makeNotPrivate' : 'note.makePrivateMenu');
    $('menu-history').hidden = !!note.private;
    $('menu-snip-hint').textContent = prettyKey(settings.hotkeys && settings.hotkeys.snip);
    fillTemplatesMenu();
    fillBacklinks();
    const text = editor.getText();
    const words = text ? text.split(/\s+/).filter(Boolean).length : 0;
    const d = (t) => new Date(t).toLocaleString(uiLang(), { dateStyle: 'medium', timeStyle: 'short' });
    $('menu-stats').innerHTML = escapeHtml(`${tp('note.words', words)} · ${tr('note.characters', { count: text.length.toLocaleString(uiLang()) })}`)
      + '<br>' + escapeHtml(tr('note.created', { date: d(note.createdAt) })) + '<br>' + escapeHtml(tr('note.edited', { date: d(note.updatedAt) }));
    $('menu-new-tab').hidden = !!note.private;
    $('menu-new-tab').disabled = !!(tabs && tabs.length >= MAX_TABS);
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
    $('table-label').textContent = tr('note.insertTable');
  } else if (name === 'bg') {
    prepareBgPop();
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
    case 'toggle-roll': closePops(); api.toggleRoll(); break;
    case 'reminder': closePops(); openPop('reminder', $('btn-menu'), 'below'); break;
    case 'source': enterSource(); break;
    case 'export-pdf': exportAs('pdf'); break;
    case 'export-html': exportAs('html'); break;
    case 'export-md': exportAs('md'); break;
    case 'export-txt': exportAs('txt'); break;
    case 'export-json': exportAs('json'); break;
    case 'print': exportAs('print'); break;
    case 'copy-md': closePops(); await navigator.clipboard.writeText(htmlToMarkdown(editor.el)); toast(tr('note.copiedMarkdown')); break;
    case 'copy-text': closePops(); await navigator.clipboard.writeText(editor.getText()); toast(tr('note.copiedText')); break;
    case 'duplicate': closePops(); await flush(); api.duplicate(); break;
    case 'toggle-private': togglePrivate(); break;
    case 'snip': closePops(); await flush(); api.startSnip('this'); break;
    case 'history': closePops(); await flush(); if (!(await api.openHistory())) toast(tr('note.noHistoryPrivate')); break;
    case 'save-template': saveAsTemplate(); break;
    case 'list': closePops(); api.showManager(); break;
    case 'delete': closePops(); deleteNote(); break;
    case 'new-tab': closePops(); newTab(); break;
    case 'custom-background': openBgPop(); break;
    default: break;
  }
}

// ---------- note-level actions ----------
function setColor(color) {
  if (!palette.notes[color]) return;
  // Picking a palette colour replaces a custom colour/gradient; a picture keeps it as its tint.
  const clearBg = !!note.background && note.background.type !== 'image';
  if (color === note.color && !clearBg) return;
  if (clearBg) clearTimeout(bgSaveTimer);
  patchNote(clearBg ? { color, background: null } : { color });
  applyAppearance();
  for (const s of document.querySelectorAll('.swatch')) s.classList.toggle('on', s.dataset.color === color);
  $('swatch-custom').classList.remove('on');
}

function togglePin() {
  patchNote({ pinned: !note.pinned });
  applyState();
  toast(tr(note.pinned ? 'note.keepingOnTop' : 'note.noLongerOnTop'));
}

function toggleLock() {
  patchNote({ locked: !note.locked });
  applyState();
  toast(tr(note.locked ? 'note.lockedToast' : 'note.unlockedToast'));
  if (!note.locked) editor.focus();
}

function setZoom(z) {
  const zoom = Math.round(Math.min(3, Math.max(0.5, z)) * 100) / 100;
  if (zoom === note.zoom) return;
  patchNote({ zoom });
  applyAppearance();
  toast(tr('note.zoom', { percent: Math.round(zoom * 100) }));
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
  const payload = { html: editor.exportHTML(), text: editor.exportText(), markdown: htmlToMarkdown(editor.el) };
  // The editor only holds the open tab, so a tabbed note is exported tab by tab, each under its title.
  if (tabs && tabs.length > 1) {
    const parts = tabs.map((t, i) => (i === activeTab ? { title: t.title || tr('note.untitled'), ...payload } : tabExport(t)));
    payload.html = parts.map(p => `<h2>${escapeHtml(p.title)}</h2>${p.html}`).join('');
    payload.text = parts.map(p => `${p.title}\n\n${p.text}`).join('\n\n');
    payload.markdown = parts.map(p => `## ${p.title}\n\n${p.markdown}`).join('\n\n');
    payload.tabs = parts;
  }
  try {
    const res = await api.exportNote(format, payload);
    if (res && res.ok && res.filePath) toast(tr('note.savedFile', { name: res.filePath.split(/[\\/]/).pop() }));
  } catch (err) {
    toast(tr('note.exportFailed', { error: err.message || err }));
  }
}

// A tab that isn't on screen, converted the way the editor exports the open one. DOMParser
// documents are inert, so nothing in the tab loads while converting.
function tabExport(t) {
  const doc = new DOMParser().parseFromString(sanitizeHtml(t.html || '', { mode: 'stored' }), 'text/html');
  const markdown = htmlToMarkdown(doc.body);
  for (const a of doc.body.querySelectorAll('a.file-chip')) {
    const link = doc.createElement('a');
    link.setAttribute('href', fileUrl(a.getAttribute('data-path')));
    link.textContent = a.textContent;
    a.replaceWith(link);
  }
  return { title: t.title || tr('note.untitled'), html: doc.body.innerHTML, text: t.text || '', markdown };
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
  if (!normalizeUrl(url)) { $('link-url').focus(); toast(tr('note.enterAddress')); return; }
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
  const time = d.toLocaleTimeString(uiLang(), { hour: 'numeric', minute: '2-digit' });
  if (sameDay) return time;
  if (tomorrow) return tr('reminder.tomorrow', { time });
  return d.toLocaleDateString(uiLang(), { month: 'short', day: 'numeric' }) + ' ' + time;
}

const REPEATS = ['daily', 'weekdays', 'weekly', 'monthly'];
const repeatLabel = (repeat) => (REPEATS.includes(repeat) ? tr(`note.repeat.${repeat}`) : '');

function updateReminderUi() {
  const r = note.reminder;
  const ind = $('ind-reminder');
  ind.hidden = !r;
  ind.classList.toggle('due', !!(r && r.pending));
  if (r) {
    const when = shortTime(r.snoozeAt || r.at);
    const rep = repeatLabel(r.repeat);
    ind.title = tr('note.reminderTitle', { when: rep ? tr('note.withRepeat', { when, repeat: rep }) : when });
  }
  $('reminder-banner').hidden = !(r && r.pending);
  if (r && r.pending) $('reminder-banner-text').textContent = note.title ? tr('note.reminderBanner', { title: note.title }) : tr('note.reminder');
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
  $('reminder-strip-open').title = tr('note.reminderStripTitle', { when: shortTime(r.snoozeAt || r.at) });
}

// Relative times ("in 2h 15m") and the urgency colour drift as time passes.
setInterval(() => { if (note) refreshReminderStrip(); }, 30 * 1000);

function onReminderFired() {
  updateReminderUi();
  playChime((settings && settings.reminderSound) || 'chime');
}

$('reminder-strip-open').addEventListener('click', (e) => openPop('reminder', e.currentTarget, 'below'));
$('reminder-strip-clear').addEventListener('click', () => { patchNote({ reminder: null }); updateReminderUi(); toast(tr('note.reminderRemoved')); });

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
  if (!Number.isFinite(at)) { toast(tr('note.pickDateTime')); return; }
  if (at <= Date.now()) { toast(tr('note.pickFuture')); return; }
  patchNote({ reminder: { at, repeat: $('reminder-repeat').value, pending: false, snoozeAt: null, dom: new Date(at).getDate(), setAt: Date.now() } });
  updateReminderUi();
  closePops();
  toast(tr(new Date(Date.now() + 86400000).toDateString() === new Date(at).toDateString() ? 'note.remindWhen' : 'note.remindAt', { time: shortTime(at) }));
});
$('reminder-clear').addEventListener('click', () => { patchNote({ reminder: null }); updateReminderUi(); closePops(); toast(tr('note.reminderRemoved')); });
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
  toast(tr('note.snoozed'));
});

// ---------- HTML source mode ----------
function prettyHtml(html) {
  return html
    .replace(/(<\/(p|h[1-6]|li|blockquote|pre|table|thead|tbody|tr|div)>|<br>|<hr>)(?!\n)/g, '$1\n')
    .replace(/(<(ul|ol|table|thead|tbody|tr)( [^>]*)?>)(?!\n)/g, '$1\n');
}

function enterSource() {
  closePops();
  if (note.locked) { toast(tr('note.unlockToEditHtml')); return; }
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
  $('find-count').textContent = q ? (n ? tr('note.findCount', { index: editor.find.index + 1, total: n }) : tr('note.noResults')) : '';
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
    if (n) $('find-count').textContent = tr('note.findCount', { index: editor.find.index + 1, total: n });
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
  if (n) $('find-count').textContent = tr('note.findCount', { index: editor.find.index + 1, total: n });
}

// ---------- search matches carried over from the notes list ----------
// Painted with the Highlight API so the note's HTML is never touched (and never saved with marks).
let searchHighlightOn = false;

function showSearchHighlight(terms) {
  clearSearchHighlight();
  if (privateLocked || typeof Highlight === 'undefined' || !CSS.highlights) return;
  const needles = [...new Set(terms.map(t => String(t).toLowerCase().trim()).filter(Boolean))];
  if (!needles.length) return;
  // The notes list searches every tab, so the hit may be in another one: open that tab first.
  if (tabs && tabs.length > 1) {
    const has = s => needles.some(q => (s || '').toLowerCase().includes(q));
    if (!has(editor.getText())) {
      let i = tabs.findIndex((t, k) => k !== activeTab && has(t.text));
      if (i < 0) i = tabs.findIndex((t, k) => k !== activeTab && has(t.title));
      if (i >= 0) switchTab(i);
    }
  }
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
  // Two frames, so this lands after restoreScroll's frame from loading the tab.
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const rect = first.getBoundingClientRect();
    const cr = $('content').getBoundingClientRect();
    if (rect.top < cr.top || rect.bottom > cr.bottom) $('content').scrollTop += rect.top - cr.top - cr.height / 3;
  }));
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
// Windows reports title bar double-clicks and right-clicks through a native hook in the main
// process. Elsewhere the page sees them (where the drag region lets them through), so handle them here.
if (api.platform !== 'win32') {
  const onButton = (e) => e.target.closest('button, .tb-btn, .indicator, input, select');
  $('titlebar').addEventListener('dblclick', (e) => { if (!onButton(e)) api.toggleRoll(); });
  $('titlebar').addEventListener('contextmenu', (e) => {
    if (onButton(e)) return;
    e.preventDefault();
    api.titlebarMenu();
  });
}

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
// Files may have been moved or deleted while the note was in the background.
window.addEventListener('focus', () => { if (note && !privateLocked) editor.recheckChips(); });
window.addEventListener('blur', () => {
  body.classList.remove('focused', 'ctrl');
  // The native colour picker and file dialog take focus; keep the background popover open.
  if (!(bgNativeUi && openState && openState.name === 'bg')) closePops();
  if (saveTimer) save();
});

document.addEventListener('keyup', (e) => { if (e.key === MOD_KEY) body.classList.remove('ctrl'); });

document.addEventListener('keydown', (e) => {
  if (e.key === MOD_KEY) body.classList.add('ctrl');
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
  if (!e.ctrlKey && !e.metaKey) return; // Ctrl on Windows and Linux, Command (or a pinch, which arrives as Ctrl) on a Mac
  e.preventDefault();
  setZoom((note.zoom || 1) + (e.deltaY < 0 ? 0.1 : -0.1));
}, { passive: false });

// ---------- messages from the main process ----------
api.onChanged((patch) => {
  if (!note) return;
  const { privateLocked: lockedNow, html, ...rest } = patch;
  Object.assign(note, rest);
  if ('color' in patch || 'font' in patch || 'background' in patch) applyAppearance();
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

api.onSettings(async ({ settings: s, theme: t }) => {
  // A new UI language reloads the window (after saving) so every string is rebuilt in it.
  if (refreshI18n()) { if (note) await flush(); location.reload(); return; }
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
    case 'checklist-reset': if (applyResets(editor.el)) editor.changed(); resetOtherTabs(); break;
    case 'checklist': {
      const list = topChecklist(target, editor.el);
      if (arg === 'daily' || arg === 'weekly' || arg === 'never') {
        setReset(list, arg);
        toast(tr(arg === 'never' ? 'note.neverUntick' : arg === 'daily' ? 'note.ticksClearDaily' : 'note.ticksClearWeekly'));
      } else if (arg === 'clear') {
        const n = clearTicked(list || editor.el);
        toast(n ? tp('note.removedTicked', n) : tr('note.nothingTicked'));
      } else if (arg === 'sink') {
        for (const li of [...(list || editor.el).querySelectorAll('ul.checklist > li.checked')]) sinkItem(li);
      }
      editor.changed();
      break;
    }
    case 'copy-image-text':
      if (target && target.alt) { navigator.clipboard.writeText(target.alt); toast(tr('note.copiedPictureText')); }
      break;
    case 'format': if (arg === 'clear') editor.command('removeFormat'); break;
    case 'new-tab': newTab(); break;
    case 'close-tab': if (tabs) closeTab(Number.isInteger(arg) ? arg : activeTab); break;
    case 'file-remove': { const a = target && target.closest && target.closest('a.file-chip'); if (a) editor.removeChip(a); break; }
    case 'file-open': { const a = target && target.closest && target.closest('a.file-chip'); if (a) editor.openChip(a); break; }
    case 'code-lang': { const pre = target && target.closest && target.closest('pre'); if (pre) editor.setCodeLang(pre, arg); break; }
    case 'custom-background': openBgPop(); break;
    default: break;
  }
});


// ---------- tags, links between notes, "/" commands ----------
let tagsCache = null;
let titlesCache = null;
let templatesCache = null;

const SLASH = [
  { label: tr('slash.title'), icon: 'heading', keywords: 'h1 heading big', run: () => editor.command('block', 'h1') },
  { label: tr('slash.heading'), icon: 'heading', keywords: 'h2', run: () => editor.command('block', 'h2') },
  { label: tr('slash.subheading'), icon: 'heading', keywords: 'h3', run: () => editor.command('block', 'h3') },
  { label: tr('slash.normal'), icon: 'textSize', keywords: 'paragraph plain', run: () => editor.command('block', 'p') },
  { label: tr('slash.checklist'), icon: 'checklist', keywords: 'todo task tick box', run: () => editor.command('checklist') },
  { label: tr('slash.bulleted'), icon: 'listUl', keywords: 'bullet', run: () => editor.command('insertUnorderedList') },
  { label: tr('slash.numbered'), icon: 'listOl', keywords: 'ordered number', run: () => editor.command('insertOrderedList') },
  { label: tr('slash.quote'), icon: 'quote', keywords: 'blockquote', run: () => editor.command('block', 'blockquote') },
  { label: tr('slash.code'), icon: 'codeBlock', keywords: 'pre code', run: () => editor.command('block', 'pre') },
  { label: tr('slash.divider'), icon: 'hr', keywords: 'line rule separator', run: () => editor.command('hr') },
  { label: tr('slash.table'), icon: 'table', keywords: 'grid', run: () => editor.insertTable(3, 3) },
  { label: tr('slash.image'), icon: 'image', keywords: 'picture photo', run: () => runCmd('image') },
  { label: tr('slash.snip'), icon: 'snip', keywords: 'screenshot capture', run: async () => { await flush(); api.startSnip('this'); } },
  { label: tr('slash.noteLink'), icon: 'notes', keywords: 'wiki note [[', run: () => editor.insertPlainText('[[') },
  { label: tr('slash.webLink'), icon: 'link', keywords: 'url', run: () => openLink(null) },
  { label: tr('slash.tag'), icon: 'hash', keywords: '# label', run: () => editor.insertPlainText('#') },
  { label: tr('slash.date'), icon: 'calendar', keywords: 'today', run: () => editor.insertPlainText(new Date().toLocaleDateString(uiLang(), { dateStyle: 'medium' })) },
  { label: tr('slash.time'), icon: 'clock', keywords: 'now', run: () => editor.insertPlainText(new Date().toLocaleTimeString(uiLang(), { hour: 'numeric', minute: '2-digit' })) },
  { label: tr('slash.dateTime'), icon: 'calendarClock', keywords: 'now', run: () => editor.command('date') },
  { label: tr('slash.reminder'), icon: 'bell', keywords: 'alarm remind', run: () => openPop('reminder', $('btn-menu'), 'below') }
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
  const items = rank(tagsCache.map(t => ({ label: `#${t.tag}`, sub: tp('note.tagNotes', t.count), icon: 'hash', tag: t.tag })), query, it => it.tag);
  if (query && !tagsCache.some(t => t.tag === query)) items.push({ label: `#${q}`, sub: tr('note.newTag'), icon: 'plus', tag: q });
  return items;
}

function pickTag(item, q, range) {
  tagsCache = null;
  editor.replaceRange(range, `#${item.tag} `, { text: true });
}

async function linkSource(q) {
  if (!titlesCache) titlesCache = await api.noteTitles();
  const items = rank(titlesCache.map(n => ({ label: n.title, id: n.id, color: palette.notes[n.color] ? palette.notes[n.color].swatch : null })), q, it => it.label);
  if (q.trim()) items.push({ label: tr('note.createNoteNamed', { title: q.trim() }), icon: 'plus', create: q.trim() });
  return items.length ? items : [{ label: tr('note.typeNoteTitle'), icon: 'notes', disabled: true }];
}

async function pickLink(item, q, range) {
  titlesCache = null;
  if (item.disabled) return;
  if (item.create) {
    const created = await api.createLinkedNote(item.create);
    editor.insertNoteLink(range, created.id, created.title);
    toast(tr('note.createdNamed', { title: created.title }));
  } else {
    editor.insertNoteLink(range, item.id, item.label);
  }
}

async function slashSource(q) {
  if (!templatesCache) templatesCache = await api.listTemplates();
  const templates = templatesCache.map(t => ({ label: t.name, sub: tr('slash.template'), icon: 'template', keywords: 'template', template: t.id }));
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
  if (!r.ok) toast(tr(r.reason === 'trashed' ? 'note.linkTrashed' : 'note.linkMissing'));
}

async function fillTemplatesMenu() {
  const list = await api.listTemplates();
  templatesCache = list;
  $('sub-templates').innerHTML = list.length
    ? list.map(t => `<button class="menu-item" data-template="${t.id}"><span class="sg-dot" style="background:${(palette.notes[t.color] || palette.notes.yellow).swatch}"></span><span>${escapeHtml(t.name)}</span></button>`).join('')
    : `<div class="menu-foot">${escapeHtml(tr('note.noTemplates'))}</div>`;
}

async function fillBacklinks() {
  const list = await api.backlinks();
  $('menu-backlinks').hidden = !list.length;
  $('menu-backlinks-list').innerHTML = list.slice(0, 8).map(n => `<button class="backlink" data-backlink="${n.id}"><span class="sg-dot" style="background:${(palette.notes[n.color] || palette.notes.yellow).swatch}"></span><span>${escapeHtml(n.title)}</span></button>`).join('');
}

function prettyKey(acc) {
  return acc ? keyLabel(acc) : '';
}

// What the lock screen's quick-unlock button is called on this platform.
function unlockMethodLabel() {
  return tr(IS_MAC ? 'note.useTouchId' : api.platform === 'win32' ? 'note.useWindowsHello' : 'note.useQuickUnlock');
}

// ---------- templates ----------
async function saveAsTemplate() {
  closePops();
  if (privateLocked) return;
  const name = await promptDialog({ title: tr('note.saveAsTemplateTitle'), value: note.title || tr('note.myTemplate'), ok: tr('common.save') });
  if (!name) return;
  await flush();
  await api.saveTemplate({ name, html: editor.getHTML(), color: note.color });
  templatesCache = null;
  toast(tr('note.templateSaved', { name }));
}

function promptDialog({ title, value = '', ok = tr('common.ok'), password = false }) {
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
      toast(tr('note.choosePasswordFirst'));
      api.showManager('privacy');
      return;
    }
    if (!vaultState.unlocked) {
      const pw = await promptDialog({ title: tr('note.passwordForPrivate'), ok: tr('note.unlock'), password: true });
      if (!pw) return;
      if (!(await api.vaultUnlock(pw))) { toast(tr('note.wrongPassword')); return; }
    }
    await flush();
    const r = await api.setPrivate(true);
    if (r && r.ok) toast(tr('note.privateOn'));
    else if (r && r.reason === 'tabs') toast(tr('note.privateTabs'));
  } else {
    if (!vaultState.unlocked) { toast(tr('note.unlockPrivateFirst')); return; }
    await flush();
    const r = await api.setPrivate(false);
    if (r && r.ok) toast(tr('note.privateOff'));
  }
}

$('lock-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = $('lock-password');
  const ok = await api.vaultUnlock(input.value);
  input.value = '';
  if (!ok) {
    $('lock-sub').textContent = tr('note.wrongPasswordRetry');
    const ls = $('lockscreen');
    ls.classList.remove('shake');
    void ls.offsetWidth;
    ls.classList.add('shake');
    input.focus();
  }
});
$('lock-hello').addEventListener('click', async () => {
  if (!(await api.vaultUnlockHello())) toast(tr(IS_MAC ? 'note.touchIdFailed' : 'note.helloFailed'));
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

// ---------- tabs ----------
// One editor shows the active tab; the others live in `tabs` as saved HTML. Every change to the
// tab list goes to the main process as the whole list (`persistTabs`), queued on savePromise so
// it can never overtake, or be overtaken by, an autosave of the page being edited.
const MAX_TABS = 3;
const TAB_LABEL_MAX = 18;
const UNDO_LIMIT = 100;
const TAB_DRAG_TYPE = 'application/x-stickies-tab';

// Undo per tab. Chromium keeps one undo stack per editable element and swapping the editor's
// HTML on a tab switch would leave it pointing at nodes that are gone, so once a note has had
// tabs this window keeps its own history: snapshots taken after each burst of typing.
const undoBooks = new Map(); // tab id ('_' for a one-page note) -> { undo, redo, base, burst, timer, caret }
let customUndo = false;
let undoApplying = false;
let renaming = null; // { input, id } while a tab name is being edited
let tabBusy = false; // a close is waiting on the main process
let dragTabId = null;

function initTabs() {
  const list = !note.private && Array.isArray(note.tabs) && note.tabs.length > 1 ? note.tabs : null;
  tabs = list ? list.slice(0, MAX_TABS).map(t => ({ ...t })) : null;
  activeTab = tabs ? Math.min(tabs.length - 1, Math.max(0, note.activeTab | 0)) : 0;
  if (tabs) customUndo = true;
  renderTabs();
}

function afterTabLoad(tab) {
  syncUndoBase();
  restoreScroll(tab && tab.scroll);
}

function autoTitle(text) {
  const line = (text || '').split('\n').map(s => s.trim()).find(Boolean) || '';
  return line.length > 80 ? line.slice(0, 77) + '…' : line;
}

function tabName(tab) {
  return tab.renamed && tab.title ? tab.title : autoTitle(tab.text);
}

function tabLabel(tab) {
  const name = tabName(tab);
  if (tab.renamed) return name;
  return name.length > TAB_LABEL_MAX ? name.slice(0, TAB_LABEL_MAX - 1).trimEnd() + '…' : name;
}

function newTabId() {
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  return 'b' + Date.now().toString(36) + [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
}

function undoKey() {
  return tabs && tabs[activeTab] ? tabs[activeTab].id : '_';
}

function renderTabs() {
  const nav = $('tabbar');
  if (!nav || renaming) return;
  nav.hidden = !tabs;
  body.classList.toggle('has-tabs', !!tabs);
  if (!tabs) { nav.textContent = ''; return; }
  const editable = !(note && note.locked);
  let html = '';
  tabs.forEach((t, i) => {
    const on = i === activeTab;
    const name = tabName(t) || tr('note.newTab');
    html += `<div class="tab${on ? ' active' : ''}" role="tab" aria-selected="${on}" tabindex="${on ? 0 : -1}"`
      + ` draggable="${editable}" data-tab-index="${i}" title="${escapeHtml(name)}">`
      + `<span class="tab-label">${escapeHtml(tabLabel(t) || tr('note.newTab'))}</span>`
      + (editable ? `<button class="tab-close" data-tab-close="${i}" tabindex="-1" title="${escapeHtml(tr('note.closeTab'))}" aria-label="${escapeHtml(tr('note.closeTab'))}">${icon('close', { size: 12 })}</button>` : '')
      + '</div>';
  });
  if (editable && tabs.length < MAX_TABS) {
    html += `<button class="tab-add" data-tab-add title="${escapeHtml(keyLabel(tr('note.newTabHint')))}" aria-label="${escapeHtml(tr('note.newTab'))}">${icon('plus', { size: 14 })}</button>`;
  }
  nav.innerHTML = html;
}

function restoreScroll(y) {
  const top = Number(y) || 0;
  // After layout, so the page is tall enough to scroll that far.
  requestAnimationFrame(() => { $('content').scrollTop = top; });
}

// Copy what the editor shows back into the active tab (text, caret, scroll).
function stashActiveTab() {
  if (!tabs || privateLocked) return;
  const tab = tabs[activeTab];
  if (!tab) return;
  const book = undoBooks.get(tab.id);
  if (book) { sealUndo(book); book.caret = caretOffset(); }
  const html = editor.getHTML();
  if (html !== tab.html) {
    tab.html = html;
    tab.text = editor.getText();
    if (!tab.renamed) tab.title = autoTitle(tab.text);
  }
  tab.scroll = Math.round($('content').scrollTop);
  note.html = tab.html;
  note.text = tab.text;
}

// Stash, and drop the pending autosave: the next persistTabs carries those keystrokes.
function syncActive() {
  stashActiveTab();
  clearTimeout(saveTimer);
  saveTimer = null;
  if (tabs && tabs[activeTab]) lastSaved = tabs[activeTab].html;
}

function persistTabs() {
  if (!tabs) return savePromise;
  const list = tabs.map(t => ({ ...t }));
  const active = activeTab;
  note.tabs = list;
  note.activeTab = active;
  savePromise = savePromise.then(async () => {
    try {
      const ok = await api.update({ tabs: list, activeTab: active });
      if (ok === false) lastSaved = null;
    } catch (err) { console.error('saving tabs failed', err); }
  });
  return savePromise;
}

async function flushTabs() {
  if (!tabs || privateLocked || !tabs[activeTab]) return;
  // Only the scroll position can be unsaved here; skip the write when it hasn't moved.
  if (tabs[activeTab].scroll === Math.round($('content').scrollTop)) return;
  syncActive();
  await persistTabs();
}

function loadTab(tab, { focus = true } = {}) {
  editor.setHTML(tab.html);
  const reset = !note.locked && applyResets(editor.el);
  lastSaved = reset ? null : editor.getHTML();
  note.html = tab.html;
  note.text = editor.getText();
  updateTitle(editor.getText());
  updateProgress();
  renderTabs();
  syncUndoBase();
  if (reset) saveTimer = setTimeout(save, 350);
  if (focus && !note.locked) {
    const book = undoBooks.get(undoKey());
    editor.focus();
    if (!placeCaret(book && book.caret)) editor.focus(true);
  }
  restoreScroll(tab.scroll);
}

function leaveEditingModes() {
  if (renaming) finishRename(true);
  if (body.classList.contains('source-mode')) exitSource(true);
  closePops();
  closeFind(false);
}

function switchTab(i) {
  if (!tabs || privateLocked || tabBusy || !Number.isInteger(i) || i < 0 || i >= tabs.length || i === activeTab) return;
  leaveEditingModes();
  syncActive();
  activeTab = i;
  loadTab(tabs[i]);
  persistTabs();
}

function newTab() {
  if (!note || privateLocked || tabBusy) return;
  if (note.private) { toast(tr('note.privateOnePage')); return; }
  if (note.locked) { toast(tr('note.unlockToAddTab')); return; }
  if (tabs && tabs.length >= MAX_TABS) { toast(tr('note.maxTabs', { max: MAX_TABS })); return; }
  leaveEditingModes();
  if (!tabs) {
    // The page so far becomes the first tab, keeping its undo history.
    const first = { id: newTabId(), title: '', renamed: false, html: '', text: '', scroll: 0 };
    const book = undoBooks.get('_');
    if (book) { undoBooks.delete('_'); undoBooks.set(first.id, book); }
    tabs = [first];
    activeTab = 0;
    customUndo = true;
    first.html = null; // forces stashActiveTab to take the editor's text and title
  }
  syncActive();
  if (!undoBooks.has(tabs[activeTab].id)) undoBooks.set(tabs[activeTab].id, newUndoBook(tabs[activeTab].html));
  tabs.push({ id: newTabId(), title: '', renamed: false, html: '', text: '', scroll: 0 });
  activeTab = tabs.length - 1;
  loadTab(tabs[activeTab], { focus: false });
  persistTabs();
  editor.focus(true);
}

async function closeTab(i) {
  if (!tabs || privateLocked || tabBusy || !tabs[i] || tabs.length < 2) return;
  if (note.locked) { toast(tr('note.unlockToCloseTab')); return; }
  leaveEditingModes();
  const wasActive = i === activeTab;
  syncActive();
  const tab = tabs[i];
  const blank = !tab.text.trim() && !/<(img|hr|table)\b/i.test(tab.html);
  const survivor = tabs.length === 2 ? tabs[1 - i] : null;
  persistTabs();
  tabBusy = true;
  const pending = savePromise.then(() => api.closeTab(tab.id)).catch((err) => { console.error('closing tab failed', err); return null; });
  savePromise = pending.then(() => {});
  const r = await pending;
  tabBusy = false;
  if (!r) { toast(tr('note.closeTabFailed')); return; }
  undoBooks.delete(tab.id);
  if (survivor && !(Array.isArray(r.tabs) && r.tabs.length > 1)) {
    const book = undoBooks.get(survivor.id);
    undoBooks.delete(survivor.id);
    if (book) undoBooks.set('_', book);
  }
  adoptTabs(r, !wasActive, survivor);
  toast(tr(blank ? 'note.tabClosed' : 'note.tabTrashed'));
}

// Take the tab list the main process settled on after a close.
function adoptTabs(r, keepEditor, survivor) {
  const list = Array.isArray(r.tabs) && r.tabs.length > 1 ? r.tabs.map(t => ({ ...t })) : null;
  const html = typeof r.html === 'string' ? r.html : '';
  tabs = list;
  activeTab = list ? Math.min(list.length - 1, Math.max(0, r.activeTab | 0)) : 0;
  note.tabs = list ? list.map(t => ({ ...t })) : null;
  note.activeTab = activeTab;
  if (keepEditor) {
    // The editor already shows this page; anything typed while the close was in flight still saves.
    note.html = html;
    lastSaved = html;
    if (editor.getHTML() !== html) scheduleSave();
    renderTabs();
    updateTitle(editor.getText());
    return;
  }
  const page = list ? list[activeTab] : { html, text: '', scroll: survivor ? survivor.scroll : 0 };
  loadTab({ ...page, html });
}

// ----- rename -----
function startRename(i) {
  if (!tabs || !tabs[i] || renaming || privateLocked) return;
  if (note.locked) { toast(tr('note.unlockToRenameTab')); return; }
  const el = $('tabbar').querySelector(`.tab[data-tab-index="${i}"]`);
  const label = el && el.querySelector('.tab-label');
  if (!label) return;
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'tab-rename';
  input.maxLength = 80;
  input.spellcheck = false;
  input.value = tabName(tabs[i]);
  input.setAttribute('aria-label', tr('note.tabName'));
  el.draggable = false;
  label.replaceWith(input);
  renaming = { input, id: tabs[i].id };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); finishRename(true, true); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finishRename(false, true); }
  });
  input.addEventListener('blur', () => finishRename(true));
  input.addEventListener('click', (e) => e.stopPropagation());
  input.addEventListener('dblclick', (e) => e.stopPropagation());
  input.focus();
  input.select();
}

function finishRename(commit, refocus = false) {
  if (!renaming) return;
  const { input, id } = renaming;
  renaming = null;
  const tab = tabs && tabs.find(t => t.id === id);
  if (commit && tab) {
    const name = input.value.replace(/\s+/g, ' ').trim().slice(0, 80);
    const auto = autoTitle(tab.text);
    const next = name && (tab.renamed || name !== auto) ? { title: name, renamed: true } : { title: auto, renamed: false };
    if (next.title !== tab.title || next.renamed !== !!tab.renamed) {
      syncActive();
      Object.assign(tab, next);
      persistTabs();
    }
  }
  renderTabs();
  updateTitle(editor.getText());
  if (refocus && !note.locked) editor.focus();
}

// ----- drag to reorder -----
function tabAt(e) {
  const el = e.target.closest && e.target.closest('.tab');
  return el && $('tabbar').contains(el) ? el : null;
}

function clearDropMarks() {
  for (const el of $('tabbar').querySelectorAll('.drop-before, .drop-after')) el.classList.remove('drop-before', 'drop-after');
}

function dropSide(el, e) {
  const r = el.getBoundingClientRect();
  return e.clientX < r.left + r.width / 2 ? 'before' : 'after';
}

function moveTab(fromId, toIndex, side) {
  if (!tabs) return;
  const from = tabs.findIndex(t => t.id === fromId);
  if (from < 0 || !tabs[toIndex]) return;
  syncActive();
  const activeId = tabs[activeTab].id;
  const targetId = tabs[toIndex].id;
  if (targetId === fromId) return;
  const [moved] = tabs.splice(from, 1);
  const at = tabs.findIndex(t => t.id === targetId) + (side === 'after' ? 1 : 0);
  tabs.splice(at, 0, moved);
  activeTab = tabs.findIndex(t => t.id === activeId);
  renderTabs();
  persistTabs();
}

// ----- undo -----
function newUndoBook(html) {
  return { undo: [], redo: [], base: { html: html == null ? editor.getHTML() : html, caret: null }, burst: false, timer: null, caret: null };
}

// Make the active tab's undo base match the editor, keeping an outside change (a restored
// version, a tab put back from the Trash) as one step that Ctrl+Z can take back.
function syncUndoBase() {
  if (!customUndo || privateLocked) return;
  const key = undoKey();
  const html = editor.getHTML();
  const book = undoBooks.get(key);
  if (!book) { undoBooks.set(key, newUndoBook(html)); return; }
  clearTimeout(book.timer);
  book.timer = null;
  book.burst = false;
  if (book.base.html !== html) {
    book.undo.push(book.base);
    if (book.undo.length > UNDO_LIMIT) book.undo.shift();
    book.redo = [];
    book.base = { html, caret: null };
  }
}

function recordUndo() {
  if (!customUndo || undoApplying || privateLocked) return;
  const key = undoKey();
  let book = undoBooks.get(key);
  if (!book) { book = newUndoBook(lastSaved); undoBooks.set(key, book); }
  if (!book.burst) { book.burst = true; book.base.caret = book.caret; }
  clearTimeout(book.timer);
  book.timer = setTimeout(() => { if (undoBooks.get(undoKey()) === book) sealUndo(book); }, 600);
}

function sealUndo(book) {
  clearTimeout(book.timer);
  book.timer = null;
  if (!book.burst) return;
  book.burst = false;
  const html = editor.getHTML();
  book.caret = caretOffset();
  if (html === book.base.html) return;
  book.undo.push(book.base);
  if (book.undo.length > UNDO_LIMIT) book.undo.shift();
  book.redo = [];
  book.base = { html, caret: book.caret };
}

function undoStep(dir) {
  if (!customUndo || privateLocked || note.locked || body.classList.contains('source-mode')) return;
  const book = undoBooks.get(undoKey());
  if (!book) return;
  sealUndo(book);
  const from = dir < 0 ? book.undo : book.redo;
  const to = dir < 0 ? book.redo : book.undo;
  const state = from.pop();
  if (!state) return;
  to.push(book.base);
  const top = $('content').scrollTop;
  undoApplying = true;
  try {
    editor.setHTML(state.html);
    editor.changed();
  } finally { undoApplying = false; }
  book.base = { html: editor.getHTML(), caret: state.caret };
  editor.focus();
  if (!placeCaret(state.caret)) editor.focus(true);
  $('content').scrollTop = top;
  updateProgress();
}

// Caret positions are kept as a count of characters from the start, which survives the
// editor's HTML being replaced.
function caretOffset() {
  const r = editor.range();
  if (!r) return null;
  const pre = document.createRange();
  pre.selectNodeContents(editor.el);
  try { pre.setEnd(r.startContainer, r.startOffset); } catch { return null; }
  return pre.toString().length;
}

function placeCaret(offset) {
  if (!Number.isInteger(offset)) return false;
  const walker = document.createTreeWalker(editor.el, NodeFilter.SHOW_TEXT);
  let left = offset;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (left <= node.length) {
      const r = document.createRange();
      r.setStart(node, left);
      r.collapse(true);
      const sel = getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
      return true;
    }
    left -= node.length;
  }
  return false;
}

// The daily/weekly checklist reset for the tabs that aren't showing.
function resetOtherTabs() {
  if (!tabs || privateLocked) return;
  const doc = document.implementation.createHTMLDocument('');
  let changed = false;
  tabs.forEach((tab, i) => {
    if (i === activeTab || !tab.html.includes('data-reset')) return;
    const div = doc.createElement('div');
    div.innerHTML = sanitizeHtml(tab.html, { mode: 'stored' });
    if (applyResets(div)) { tab.html = div.innerHTML; changed = true; }
  });
  if (changed) { syncActive(); persistTabs(); }
}

const tabbar = $('tabbar');
tabbar.addEventListener('click', (e) => {
  if (renaming && renaming.input.contains(e.target)) return;
  const close = e.target.closest('[data-tab-close]');
  if (close) { e.stopPropagation(); closeTab(Number(close.dataset.tabClose)); return; }
  if (e.target.closest('[data-tab-add]')) { newTab(); return; }
  const el = tabAt(e);
  if (!el) return;
  const i = Number(el.dataset.tabIndex);
  if (i === activeTab) { if (!note.locked) editor.focus(); } else switchTab(i);
});
tabbar.addEventListener('auxclick', (e) => {
  const el = e.button === 1 && tabAt(e);
  if (el) { e.preventDefault(); closeTab(Number(el.dataset.tabIndex)); }
});
tabbar.addEventListener('dblclick', (e) => {
  if (e.target.closest('[data-tab-close], [data-tab-add]')) return;
  const el = tabAt(e);
  if (el) { e.preventDefault(); startRename(Number(el.dataset.tabIndex)); }
});
tabbar.addEventListener('keydown', (e) => {
  const el = tabAt(e);
  if (!el || !tabs || (renaming && renaming.input === e.target)) return;
  const i = Number(el.dataset.tabIndex);
  let next = null;
  if (e.key === 'ArrowRight') next = (i + 1) % tabs.length;
  else if (e.key === 'ArrowLeft') next = (i - 1 + tabs.length) % tabs.length;
  else if (e.key === 'F2') { e.preventDefault(); startRename(i); return; }
  else if (e.key === 'Delete') { e.preventDefault(); closeTab(i); return; }
  if (next === null) return;
  e.preventDefault();
  switchTab(next);
  const target = tabbar.querySelector(`.tab[data-tab-index="${activeTab}"]`);
  if (target) target.focus();
});
tabbar.addEventListener('dragstart', (e) => {
  const el = tabAt(e);
  if (!el || !tabs || renaming || note.locked) { e.preventDefault(); return; }
  dragTabId = tabs[Number(el.dataset.tabIndex)].id;
  e.dataTransfer.setData(TAB_DRAG_TYPE, dragTabId);
  e.dataTransfer.effectAllowed = 'move';
  el.classList.add('dragging');
});
tabbar.addEventListener('dragover', (e) => {
  if (!dragTabId) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  clearDropMarks();
  const el = tabAt(e);
  if (el && tabs[Number(el.dataset.tabIndex)].id !== dragTabId) el.classList.add(`drop-${dropSide(el, e)}`);
});
tabbar.addEventListener('dragleave', (e) => {
  if (!e.relatedTarget || !tabbar.contains(e.relatedTarget)) clearDropMarks();
});
tabbar.addEventListener('drop', (e) => {
  if (!dragTabId) return;
  e.preventDefault();
  const el = tabAt(e);
  const id = dragTabId;
  clearDropMarks();
  if (!el) {
    // Dropped on the empty end of the row: move it last.
    if (tabs && tabs.length) moveTab(id, tabs.length - 1, 'after');
    return;
  }
  moveTab(id, Number(el.dataset.tabIndex), dropSide(el, e));
});
tabbar.addEventListener('dragend', () => {
  dragTabId = null;
  clearDropMarks();
  for (const el of tabbar.querySelectorAll('.dragging')) el.classList.remove('dragging');
});

document.addEventListener('keydown', (e) => {
  if (e.defaultPrevented || !note || e.getModifierState('AltGraph')) return;
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
  if (e.target.closest && e.target.closest('input, textarea, select')) return;
  const k = e.key.toLowerCase();
  const digit = /^Digit[1-9]$/.test(e.code) ? Number(e.code.slice(5)) : 0;
  let handled = true;
  if (e.shiftKey && k === 't') newTab();
  else if (e.ctrlKey && e.key === 'Tab') {
    if (tabs) switchTab((activeTab + (e.shiftKey ? -1 : 1) + tabs.length) % tabs.length);
    else handled = false;
  } else if (!e.shiftKey && digit >= 1 && digit <= MAX_TABS) {
    if (tabs && digit <= tabs.length) switchTab(digit - 1);
    else handled = false;
  } else if (customUndo && !e.shiftKey && k === 'z') undoStep(-1);
  else if (customUndo && ((e.shiftKey && k === 'z') || (!e.shiftKey && k === 'y'))) undoStep(1);
  else handled = false;
  if (handled) { e.preventDefault(); e.stopPropagation(); }
}, true);

// Undo/Redo from the right-click menu reach the editor as history input events.
editor.el.addEventListener('beforeinput', (e) => {
  if (!customUndo || (e.inputType !== 'historyUndo' && e.inputType !== 'historyRedo')) return;
  e.preventDefault();
  undoStep(e.inputType === 'historyUndo' ? -1 : 1);
});

// Runs after the listener above that already put any new html into the editor.
api.onChanged((patch) => {
  if (!note) return;
  if ('tabs' in patch) {
    if (renaming) finishRename(false);
    const list = !note.private && Array.isArray(patch.tabs) && patch.tabs.length > 1 ? patch.tabs.slice(0, MAX_TABS).map(t => ({ ...t })) : null;
    if (list && !tabs) {
      customUndo = true;
      const book = undoBooks.get('_');
      undoBooks.delete('_');
      if (book && list[0]) undoBooks.set(list[0].id, book);
    }
    tabs = list;
    activeTab = list ? Math.min(list.length - 1, Math.max(0, patch.activeTab | 0)) : 0;
    note.tabs = list ? list.map(t => ({ ...t })) : null;
    note.activeTab = activeTab;
    renderTabs();
    updateTitle(editor.getText());
    syncUndoBase();
    if (tabs) restoreScroll(tabs[activeTab].scroll);
  } else if (typeof patch.html === 'string') {
    if (tabs && tabs[activeTab]) {
      const tab = tabs[activeTab];
      tab.html = editor.getHTML();
      tab.text = editor.getText();
      if (!tab.renamed) tab.title = autoTitle(tab.text);
      renderTabs();
      updateTitle(editor.getText());
    }
    syncUndoBase();
  }
});

// ---------- custom backgrounds ----------
// note.background is { type: 'solid', color } | { type: 'gradient', from, to, angle } |
// { type: 'image', src, fit, dim } | null. Main validates it again on every save.
let bgTab = 'solid';
let bgSaveTimer = null;
let bgNativeUi = false; // a native colour picker / file dialog is open on top of the popover

// Overrides the palette colours set by applyAppearance() when the note has a custom background.
// Returns whether the note ends up dark, so the code-token colours can match it.
function applyBackground(c) {
  const bg = safeBackground(note.background);
  const layer = $('bg-layer');
  body.classList.toggle('has-bg', !!bg);
  layer.hidden = !bg || bg.type === 'solid';
  layer.style.backgroundImage = '';
  layer.style.removeProperty('--dim');
  delete layer.dataset.fit;
  root.style.setProperty('--bg-base', c.bg);
  if (!bg) return deriveColors(c.bg).dark;
  let d;
  if (bg.type === 'solid') {
    d = deriveColors(bg.color);
  } else if (bg.type === 'gradient') {
    d = deriveGradientColors(bg.from, bg.to);
    layer.style.backgroundImage = gradientCss(bg);
  } else {
    d = imageColors(c);
    layer.style.backgroundImage = `url("${bg.src}")`;
    layer.dataset.fit = bg.fit;
    layer.style.setProperty('--dim', String((bg.dim || 0) / 100));
  }
  root.style.setProperty('--bg', d.bg);
  root.style.setProperty('--bar', d.bar);
  root.style.setProperty('--text', d.text);
  root.style.setProperty('--accent', d.accent);
  return d.dark;
}

// Text over a picture keeps the palette's colours: the dim overlay is the palette colour, so
// raising Dim always makes the text readable. (Sampling the picture on a canvas is not possible:
// sticky-img:// is a different origin from the page, so the canvas would be tainted.)
function imageColors(c) {
  const dark = deriveColors(c.bg.toLowerCase()).dark;
  return { ...c, bar: dark ? 'rgba(0, 0, 0, 0.28)' : 'rgba(255, 255, 255, 0.45)', dark };
}

function setBackground(bg) {
  note.background = bg;
  applyAppearance();
  $('swatch-custom').classList.toggle('on', !!bg && bg.type !== 'image');
  // Colour pickers fire many input events while dragging; save once things settle.
  clearTimeout(bgSaveTimer);
  bgSaveTimer = setTimeout(saveBackground, 150);
}

function saveBackground() {
  clearTimeout(bgSaveTimer);
  bgSaveTimer = null;
  return api.update({ background: note.background || null });
}

function openBgPop(tab) {
  closePops();
  bgTab = tab || (note.background ? note.background.type : 'solid');
  openPop('bg', $('btn-menu'), 'below');
  if (bgTab !== 'solid' && openState && openState.name === 'bg') setTimeout(() => $(`bg-tab-${bgTab}`).focus(), 0);
}

function prepareBgPop() {
  const bg = note.background;
  const base = noteColors().bg.toLowerCase();
  const solid = bg && bg.type === 'solid' ? bg.color : base;
  $('bg-color').value = solid;
  $('bg-hex').value = solid;
  const grad = bg && bg.type === 'gradient' ? bg : GRADIENT_PRESETS[0];
  $('bg-from').value = grad.from;
  $('bg-to').value = grad.to;
  $('bg-angle').value = grad.angle;
  $('bg-angle-value').textContent = `${grad.angle}°`;
  const img = bg && bg.type === 'image' ? bg : null;
  $('bg-thumb').style.backgroundImage = img ? `url("${img.src}")` : '';
  $('bg-thumb').classList.toggle('empty', !img);
  $('bg-fit').value = img ? img.fit : 'cover';
  $('bg-dim').value = img ? img.dim : 0;
  $('bg-dim-value').textContent = `${img ? img.dim : 0}%`;
  $('bg-fit').disabled = !img;
  $('bg-dim').disabled = !img;
  $('bg-reset').disabled = !bg;
  for (const p of $('bg-presets').children) {
    const pr = GRADIENT_PRESETS[Number(p.dataset.preset)];
    p.classList.toggle('on', !!bg && bg.type === 'gradient' && bg.from === pr.from && bg.to === pr.to);
  }
  selectBgTab(bgTab);
}

function selectBgTab(name) {
  bgTab = name;
  for (const t of document.querySelectorAll('.bg-tab')) {
    const on = t.dataset.bgTab === name;
    t.setAttribute('aria-selected', String(on));
    t.tabIndex = on ? 0 : -1;
    t.classList.toggle('on', on);
  }
  for (const k of ['solid', 'gradient', 'image']) $(`bg-panel-${k}`).hidden = k !== name;
}

function gradientFromInputs() {
  return { type: 'gradient', from: $('bg-from').value, to: $('bg-to').value, angle: Number($('bg-angle').value) || 0 };
}

function updateImageBg(changes) {
  const bg = note.background;
  if (!bg || bg.type !== 'image') return;
  setBackground({ ...bg, ...changes });
}

$('bg-presets').innerHTML = GRADIENT_PRESETS.map((p, i) =>
  `<button type="button" class="bg-preset" data-preset="${i}" title="${escapeHtml(gradientName(p.name))}" aria-label="${escapeHtml(tr('note.gradientAria', { name: gradientName(p.name) }))}" style="background:${gradientCss(p)}"></button>`).join('');

// The custom swatch is added by buildStaticUi(), which runs after this module has loaded.
$('note-swatches').addEventListener('click', (e) => {
  if (e.target.closest('.swatch-custom')) openBgPop('solid');
});

$('pop-bg').querySelector('.bg-tabs').addEventListener('click', (e) => {
  const t = e.target.closest('.bg-tab');
  if (t) selectBgTab(t.dataset.bgTab);
});
$('pop-bg').querySelector('.bg-tabs').addEventListener('keydown', (e) => {
  const order = ['solid', 'gradient', 'image'];
  const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
  let next = null;
  if (step) next = order[(order.indexOf(bgTab) + step + order.length) % order.length];
  else if (e.key === 'Home') next = order[0];
  else if (e.key === 'End') next = order[order.length - 1];
  if (!next) return;
  e.preventDefault();
  selectBgTab(next);
  $(`bg-tab-${next}`).focus();
});

for (const id of ['bg-color', 'bg-from', 'bg-to']) {
  $(id).addEventListener('click', () => { bgNativeUi = true; });
  $(id).addEventListener('change', () => { bgNativeUi = false; });
}
window.addEventListener('focus', () => { bgNativeUi = false; });

$('bg-color').addEventListener('input', (e) => {
  $('bg-hex').value = e.target.value;
  setBackground({ type: 'solid', color: e.target.value.toLowerCase() });
});
$('bg-hex').addEventListener('input', (e) => {
  let v = e.target.value.trim();
  if (!v.startsWith('#')) v = `#${v}`;
  if (/^#[0-9a-f]{3}$/i.test(v)) v = `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`;
  if (!isHex(v)) return;
  $('bg-color').value = v.toLowerCase();
  setBackground({ type: 'solid', color: v.toLowerCase() });
});
$('bg-hex').addEventListener('change', (e) => {
  // Snap an unfinished entry back to the colour actually in use.
  if (!isHex(e.target.value.trim())) e.target.value = $('bg-color').value;
});
$('bg-hex').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); closePops(); editor.restoreSelection(); }
});

$('bg-presets').addEventListener('click', (e) => {
  const b = e.target.closest('.bg-preset');
  if (!b) return;
  const p = GRADIENT_PRESETS[Number(b.dataset.preset)];
  $('bg-from').value = p.from;
  $('bg-to').value = p.to;
  $('bg-angle').value = p.angle;
  $('bg-angle-value').textContent = `${p.angle}°`;
  for (const x of $('bg-presets').children) x.classList.toggle('on', x === b);
  setBackground(gradientFromInputs());
});
for (const id of ['bg-from', 'bg-to', 'bg-angle']) {
  $(id).addEventListener('input', () => {
    $('bg-angle-value').textContent = `${$('bg-angle').value}°`;
    for (const x of $('bg-presets').children) x.classList.remove('on');
    setBackground(gradientFromInputs());
  });
}

$('bg-pick').addEventListener('click', async () => {
  bgNativeUi = true;
  let items = null;
  try { items = await api.pickImages(); } finally { bgNativeUi = false; }
  const pic = items && items[0];
  if (!pic || typeof pic.url !== 'string') return;
  const prev = note.background && note.background.type === 'image' ? note.background : null;
  setBackground({ type: 'image', src: pic.url, fit: prev ? prev.fit : 'cover', dim: prev ? prev.dim : 0 });
  if (openState && openState.name === 'bg') prepareBgPop();
  else openBgPop('image');
});
$('bg-fit').addEventListener('change', (e) => updateImageBg({ fit: e.target.value }));
$('bg-dim').addEventListener('input', (e) => {
  $('bg-dim-value').textContent = `${e.target.value}%`;
  updateImageBg({ dim: Number(e.target.value) || 0 });
});

$('bg-reset').addEventListener('click', () => {
  setBackground(null);
  saveBackground();
  prepareBgPop();
  $('bg-done').focus();
  toast(tr('note.backToColor'));
});
$('bg-done').addEventListener('click', () => {
  if (bgSaveTimer) saveBackground();
  closePops();
  editor.restoreSelection();
});
