import { icon, hydrateIcons } from '../shared/icons.js';
import { sanitizeHtml, escapeHtml } from '../shared/sanitize.js';
import { htmlToMarkdown } from '../shared/html-to-md.js';
import { cascadeCheck, sinkItem, ownText, dueLabel, isoDate, parentItem } from '../note/smart.js';
import palette from '../shared/colors.json' with { type: 'json' };
import { IS_MAC, modifierHint, keyLabel, localizeKeys } from '../shared/keys.js';
import { hydrateFileChips } from '../shared/file-icons.js';
import { urgency, playChime } from '../shared/reminder.js';
import { applyTranslations, refreshI18n, t as tr, tp, lang as uiLang, colorName, fontName } from '../shared/i18n.js';
import { deriveColors, deriveGradientColors, gradientCss, safeBackground } from '../shared/backgrounds.js';

const api = window.stickies;
const $ = (id) => document.getElementById(id);
const root = document.documentElement;

let notes = [];
let settings = null;
let theme = 'light';
let vaultState = { configured: false, unlocked: false };
let workspaces = { list: [], active: null, auto: true };
let templates = [];
let menuState = null;
let toastTimer = null;
let trashedTabs = [];
const state = { view: 'all', color: null, query: '', sort: 'updated', taskShow: 'open', taskGroup: 'note', taskQuery: '' };
const VIEW_TITLES = { all: 'manager.allNotes', open: 'manager.onDesktop', pinned: 'manager.keptOnTop', reminders: 'manager.reminders', tasks: 'manager.tasks', trash: 'manager.trash' };
// Translated text that goes into markup.
const tx = (key, params) => escapeHtml(tr(key, params));
// What the system's fingerprint/face unlock is called here (vault.js decides whether it exists).
const quickUnlock = () => (IS_MAC
  ? { name: 'Touch ID', ready: tr('manager.touchIdReady'), missing: tr('manager.touchIdMissing') }
  : api.platform === 'win32'
    ? { name: 'Windows Hello', ready: tr('manager.helloReady'), missing: tr('manager.helloMissing') }
    : { name: tr('manager.fingerprint'), ready: tr('manager.fingerprintReady'), missing: tr('manager.fingerprintMissing') });

try {
  const saved = JSON.parse(localStorage.getItem('stickies.list') || '{}');
  if (saved.sort) state.sort = saved.sort;
  if (saved.taskGroup) state.taskGroup = saved.taskGroup;
} catch { /* storage unavailable */ }

root.dataset.platform = api.platform || '';
applyTranslations();
hydrateIcons();
localizeKeys();
localizePlatformText();
init();

// Settings text that names the operating system doing the work.
function localizePlatformText() {
  const ocr = $('ocr-sub');
  if (ocr && IS_MAC) ocr.textContent = tr('manager.ocrSubMac');
  else if (ocr && api.platform !== 'win32') ocr.textContent = tr('manager.ocrSubLinux');
}

let initial = null; // first settings payload: buildSettings needs its version and data folder again on a language change

async function init() {
  const s = await api.getSettings();
  initial = s;
  settings = s.settings;
  theme = s.theme;
  vaultState = s.vault || vaultState;
  root.dataset.theme = theme;
  $('sort').value = state.sort;
  for (const b of $('task-group').children) b.classList.toggle('on', b.dataset.v === state.taskGroup);
  buildColorFilter();
  buildSettings(s);
  await Promise.all([refresh(), loadWorkspaces(), loadTemplates()]);
  route(decodeURIComponent(location.hash.slice(1)) || 'all');

  let t;
  api.onListChanged(() => { clearTimeout(t); t = setTimeout(refresh, 80); });
  api.onSettings(({ settings: next, theme: th }) => {
    settings = next;
    theme = th;
    root.dataset.theme = theme;
    if (relocalize()) return;
    syncSettingsUi();
    renderSidebar();
    render();
  });
  api.onView((v) => route(v));
  api.onWorkspaces(loadWorkspaces);
  api.onTemplates(loadTemplates);
  api.onVault((v) => { vaultState = v; renderPrivacy(); refresh(); });
}

// The language setting changed: translate the page again and rebuild everything drawn from code.
function relocalize() {
  if (!refreshI18n()) return false;
  rtf = new Intl.RelativeTimeFormat(uiLang(), { numeric: 'auto' });
  applyTranslations();
  localizeKeys();
  localizePlatformText();
  buildColorFilter();
  buildSettings(Object.assign({}, initial, { settings }));
  renderWorkspaces();
  renderTemplates();
  renderPrivacy();
  if (!$('view-settings').hidden) { $('appbar-title').textContent = tr('manager.settings'); refreshHotkeyStatus(); renderOpenCode(); }
  renderSidebar();
  render();
  return true;
}

async function refresh() {
  [notes, trashedTabs] = await Promise.all([api.list(), api.listTrashedTabs().catch(() => [])]);
  renderSidebar();
  render();
}

async function loadWorkspaces() {
  workspaces = await api.listWorkspaces();
  renderWorkspaces();
}

async function loadTemplates() {
  templates = await api.listTemplates();
  renderTemplates();
}

// ---------- navigation ----------
function route(v) {
  if (v === 'settings') return showSettings();
  if (v === 'privacy') { showSettings(); $('privacy').scrollIntoView({ block: 'start' }); return; }
  if (v === 'opencode') { showSettings(); $('opencode').scrollIntoView({ block: 'start' }); return; }
  if (v === 'workspaces') { setView('all'); openDrawer(); $('workspaces-section').scrollIntoView({ block: 'nearest' }); return; }
  if (v.startsWith('tag:')) { setView('all'); setQuery(`#${v.slice(4)}`); return; }
  setView(VIEW_TITLES[v] ? v : 'all');
}

function setView(view) {
  state.view = view;
  for (const b of document.querySelectorAll('[data-view]')) b.classList.toggle('on', b.dataset.view === view);
  $('view-settings').hidden = true;
  $('btn-back').hidden = true;
  $('btn-settings').hidden = false;
  $('appbar-title').textContent = 'OpenStickies';
  $('view-list').hidden = view === 'tasks';
  $('view-tasks').hidden = view !== 'tasks';
  closeDrawer();
  render();
  (view === 'tasks' ? $('task-search') : $('search')).focus();
}

async function renderOpenCode() {
  const st = await api.opencodeStatus();
  const color = settings.agentColor || 'blue';
  const pill = tr(st.connected ? (st.outdated ? 'manager.ocUpdateReady' : 'manager.ocConnected') : 'manager.ocNotConnected');
  const sub = st.found
    ? tx('manager.ocFoundSub')
    : tx('manager.ocMissingSub');
  const buttons = st.connected
    ? `${st.outdated ? `<button class="btn primary" id="oc-connect">${tx('manager.ocUpdate')}</button>` : ''}<button class="btn" id="oc-disconnect">${tx('manager.ocDisconnect')}</button>`
    : `<button class="btn primary" id="oc-connect">${tx('manager.ocConnect')}</button>`;
  const foot = st.connected
    ? tx('manager.ocFootConnected')
    : tx('manager.ocFoot');
  $('opencode-card').innerHTML = `
    <div class="row">
      <div class="row-label">${icon('checklist', { size: 17 })}<div>
        <div>${tx('manager.ocTaskNotes')} <span class="status-pill${st.connected ? ' ok' : ''}">${pill}</span></div>
        <div class="sub">${sub}</div>
      </div></div>
      ${buttons}
    </div>
    <label class="row">
      <div class="row-label">${icon('listOl', { size: 17 })}<div><div>${tx('manager.ocPlan')}</div><div class="sub">${tx('manager.ocPlanSub')}</div></div></div>
      <input type="checkbox" class="switch" id="oc-nudge" ${settings.agentPlanNudge !== false ? 'checked' : ''}>
    </label>
    <div class="row column">
      <div class="row-label">${icon('palette', { size: 17 })}<div><div>${tx('manager.ocColor')}</div></div></div>
      <div class="color-pick" id="oc-color">${palette.order.map(k => `<button data-v="${k}" class="${k === color ? 'on' : ''}" title="${escapeHtml(colorName(palette.notes[k].name))}" style="background:${palette.notes[k].swatch}"></button>`).join('')}</div>
    </div>
    <div class="row note-row">${foot}</div>`;
  const connectBtn = $('oc-connect');
  if (connectBtn) connectBtn.addEventListener('click', async () => { await api.opencodeConnect(); toast(tr('manager.ocConnectedToast')); renderOpenCode(); });
  const disc = $('oc-disconnect');
  if (disc) disc.addEventListener('click', async () => { await api.opencodeDisconnect(); toast(tr('manager.ocDisconnected')); renderOpenCode(); });
  $('oc-color').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) update({ agentColor: b.dataset.v }).then(renderOpenCode); });
  $('oc-nudge').addEventListener('change', (e) => update({ agentPlanNudge: e.target.checked }).then(() => toast(tr(e.target.checked ? 'manager.ocPlanOn' : 'manager.ocPlanOff'))));
}

function showSettings() {
  $('view-list').hidden = true;
  $('view-tasks').hidden = true;
  $('view-settings').hidden = false;
  $('btn-back').hidden = false;
  $('btn-settings').hidden = true;
  $('appbar-title').textContent = tr('manager.settings');
  for (const b of document.querySelectorAll('[data-view]')) b.classList.remove('on');
  closeDrawer();
  refreshHotkeyStatus();
  renderPrivacy();
  renderOpenCode();
}

function setQuery(q) {
  state.query = q;
  $('search').value = q;
  renderSidebar();
  render();
}

function openDrawer() { $('shell').classList.add('drawer-open'); $('scrim').hidden = false; }
function closeDrawer() { $('shell').classList.remove('drawer-open'); $('scrim').hidden = true; }

$('btn-sidebar').addEventListener('click', () => ($('shell').classList.contains('drawer-open') ? closeDrawer() : openDrawer()));
$('scrim').addEventListener('click', closeDrawer);
$('views').addEventListener('click', (e) => { const b = e.target.closest('[data-view]'); if (b) setView(b.dataset.view); });
$('btn-settings').addEventListener('click', showSettings);
$('btn-back').addEventListener('click', () => setView(state.view));
$('btn-new').addEventListener('click', () => api.create());
$('btn-new-menu').addEventListener('click', (e) => {
  const r = e.currentTarget.getBoundingClientRect();
  openMenu({ x: r.right, y: r.bottom + 4, alignRight: true }, `
    <button class="menu-item" data-new="blank">${icon('plus', { size: 16 })}<span>${tx('manager.blankNote')}</span></button>
    <button class="menu-item" data-new="snip">${icon('snip', { size: 16 })}<span>${tx('manager.snipScreen')}</span></button>
    ${templates.length ? `<div class="menu-sep"></div><div class="pop-title">${tx('manager.fromTemplate')}</div>` : ''}
    ${templates.map(t => `<button class="menu-item" data-new-template="${t.id}"><span class="cdot" style="background:${swatch(t.color)};width:12px;height:12px"></span><span>${escapeHtml(t.name)}</span></button>`).join('')}`,
  (el) => {
    if (el.dataset.new === 'blank') api.create();
    else if (el.dataset.new === 'snip') api.startSnip('new');
    else if (el.dataset.newTemplate) api.newFromTemplate(el.dataset.newTemplate);
  });
});
$('empty-action').addEventListener('click', () => {
  if (state.query) { setQuery(''); return; }
  if (state.view !== 'all' || state.color) { state.color = null; buildColorFilter(); setView('all'); return; }
  api.create();
});
$('btn-show-all').addEventListener('click', () => api.showAll());
$('btn-hide-all').addEventListener('click', () => api.hideAll());
$('btn-empty-trash').addEventListener('click', async () => {
  const n = notes.filter(x => x.trashed).length;
  const tabs = trashedTabs.length;
  if (!n && !tabs) return;
  const items = n && tabs ? tr('manager.notesAndTabs', { notes: tp('manager.notesCount', n), tabs: tp('manager.tabsCount', tabs) })
    : n ? tp('manager.notesCount', n) : tp('manager.tabsCount', tabs);
  if (!confirm(tr('manager.emptyTrashConfirm', { items }))) return;
  await api.emptyTrash();
  toast(tr('manager.trashEmptied'));
});

const swatch = (c) => (palette.notes[c] || palette.notes.yellow).swatch;

// ---------- search language ----------
// Words must all appear; "#tag" (also matches #tag/sub), is:open|pinned|locked|private,
// has:unchecked|checklist|done|image|reminder|link, color:blue, edited:today|week|month|7d,
// created:…, due:today|week|overdue|any. "quoted phrases" match exactly.
function parseQuery(q) {
  const pq = { words: [], tags: [], is: [], has: [], color: null, edited: null, created: null, due: null };
  for (const m of String(q || '').matchAll(/"([^"]+)"|(\S+)/g)) {
    const tok = (m[1] || m[2]).toLowerCase();
    let f;
    if (!m[1] && tok.length > 1 && tok[0] === '#') pq.tags.push(tok.slice(1));
    else if (!m[1] && (f = /^(is|has|color|edited|created|due):(.+)$/.exec(tok))) {
      if (f[1] === 'is' || f[1] === 'has') pq[f[1]].push(f[2]);
      else pq[f[1]] = f[2];
    } else pq.words.push(tok);
  }
  return pq;
}

function since(spec) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  if (spec === 'today') return d.getTime();
  if (spec === 'yesterday') return d.getTime() - 864e5;
  if (spec === 'week') return d.getTime() - 6 * 864e5;
  if (spec === 'month') return d.getTime() - 30 * 864e5;
  const m = /^(\d+)d$/.exec(spec);
  return m ? d.getTime() - Number(m[1]) * 864e5 : 0;
}

function matchDue(n, spec) {
  const today = isoDate(new Date());
  const week = isoDate(new Date(Date.now() + 7 * 864e5));
  const dues = tasksOf(n).filter(t => !t.checked && t.due).map(t => t.due);
  if (spec === 'any') return dues.length > 0;
  if (spec === 'today') return dues.some(d => d <= today);
  if (spec === 'overdue' || spec === 'late') return dues.some(d => d < today);
  if (spec === 'week') return dues.some(d => d <= week);
  return false;
}

function matches(n, pq) {
  const empty = !pq.words.length && !pq.tags.length && !pq.has.length && !pq.due;
  if (n.privateLocked && !empty) return false;
  if (pq.tags.length && !pq.tags.every(t => n.tags.some(x => x === t || x.startsWith(t + '/')))) return false;
  for (const k of pq.is) {
    if ((k === 'open' || k === 'desktop') && !n.open) return false;
    if ((k === 'pinned' || k === 'ontop' || k === 'top') && !n.pinned) return false;
    if (k === 'locked' && !n.locked) return false;
    if (k === 'private' && !n.private) return false;
  }
  for (const k of pq.has) {
    if (['unchecked', 'todo', 'tasks', 'open'].includes(k) && !(n.tasks.total > n.tasks.done)) return false;
    if (k === 'checklist' && !n.tasks.total) return false;
    if (k === 'done' && !n.tasks.done) return false;
    if (['image', 'images', 'picture', 'pictures', 'photo'].includes(k) && !(n.hasImage || /<img\b/.test(n.html))) return false;
    if (k === 'reminder' && !n.reminder) return false;
    if (['link', 'links'].includes(k) && !n.links.length) return false;
    if (['tag', 'tags'].includes(k) && !n.tags.length) return false;
  }
  if (pq.color && n.color !== pq.color) return false;
  if (pq.edited && n.updatedAt < since(pq.edited)) return false;
  if (pq.created && n.createdAt < since(pq.created)) return false;
  if (pq.due && !matchDue(n, pq.due)) return false;
  if (pq.words.length) {
    // searchText covers every tab of a note, not only the one showing.
    const hay = `${n.title}\n${n.searchText || n.text}\n${n.imageText}\n${n.tags.map(t => '#' + t).join(' ')}`.toLowerCase();
    if (!pq.words.every(w => hay.includes(w))) return false;
  }
  return true;
}

// ---------- sidebar ----------
function renderSidebar() {
  const active = notes.filter(n => !n.trashed);
  const openTasks = active.reduce((sum, n) => sum + Math.max(0, n.tasks.total - n.tasks.done), 0);
  const counts = {
    all: active.length,
    open: active.filter(n => n.open).length,
    pinned: active.filter(n => n.pinned).length,
    reminders: active.filter(n => n.reminder).length,
    tasks: openTasks,
    trash: notes.length - active.length + trashedTabs.length
  };
  for (const [k, v] of Object.entries(counts)) $(`count-${k}`).textContent = v ? String(v) : '';

  const saved = settings.savedSearches || [];
  $('saved-list').innerHTML = saved.map(s => `
    <button class="side-item${state.query === s.query && state.view !== 'tasks' ? ' on' : ''}" data-saved="${escapeHtml(s.id)}" title="${escapeHtml(s.query)}">
      ${icon('bookmark', { size: 16 })}<span>${escapeHtml(s.name)}</span>
      <span class="count">${active.filter(n => matches(n, parseQuery(s.query))).length || ''}</span>
      <span class="tools"><span class="mini" data-saved-del="${escapeHtml(s.id)}" title="${tx('common.remove')}">${icon('close', { size: 13 })}</span></span>
    </button>`).join('');
  $('btn-save-search').hidden = !state.query.trim() || saved.some(s => s.query === state.query.trim());

  const tagCounts = new Map();
  for (const n of active) for (const t of n.tags) tagCounts.set(t, (tagCounts.get(t) || 0) + 1);
  const pq = parseQuery(state.query);
  const tagsSorted = [...tagCounts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  $('tag-list').innerHTML = tagsSorted.map(([t, c]) => `
    <button class="side-item${pq.tags.includes(t) ? ' on' : ''}" data-tag="${escapeHtml(t)}">${icon('hash', { size: 16 })}<span>${escapeHtml(t)}</span><span class="count">${c}</span></button>`).join('');
  $('tag-empty').hidden = tagsSorted.length > 0;
}

$('saved-list').addEventListener('click', (e) => {
  const del = e.target.closest('[data-saved-del]');
  if (del) {
    e.stopPropagation();
    api.updateSettings({ savedSearches: (settings.savedSearches || []).filter(s => s.id !== del.dataset.savedDel) });
    return;
  }
  const item = e.target.closest('[data-saved]');
  if (!item) return;
  const s = (settings.savedSearches || []).find(x => x.id === item.dataset.saved);
  if (s) { if (state.view === 'tasks' || state.view === 'trash') setView('all'); setQuery(s.query); closeDrawer(); }
});

$('btn-save-search').addEventListener('click', async () => {
  const name = await promptDialog({ title: tr('manager.nameSearch'), value: state.query.trim(), ok: tr('common.save') });
  if (!name) return;
  await api.updateSettings({ savedSearches: [...(settings.savedSearches || []), { id: 's' + Date.now().toString(36), name, query: state.query.trim() }] });
  toast(tr('manager.savedNamed', { name }));
});

$('tag-list').addEventListener('click', (e) => {
  const b = e.target.closest('[data-tag]');
  if (!b) return;
  if (state.view === 'tasks' || state.view === 'trash') setView('all');
  const tag = `#${b.dataset.tag}`;
  setQuery(parseQuery(state.query).tags.includes(b.dataset.tag) ? '' : tag);
  closeDrawer();
});

function renderWorkspaces() {
  $('ws-list').innerHTML = workspaces.list.map(w => `
    <button class="side-item${w.id === workspaces.active ? ' on' : ''}" data-ws="${w.id}" title="${tx('manager.switchTo', { name: w.name })}">
      ${icon('layers', { size: 16 })}<span>${escapeHtml(w.name)}</span>
      ${w.id === workspaces.active ? `<span class="active-dot" title="${tx('manager.currentWorkspace')}"></span>` : `<span class="count">${w.count}</span>`}
      <span class="tools">
        <span class="mini" data-ws-update="${w.id}" title="${tx('manager.saveLayoutInto')}">${icon('download', { size: 13 })}</span>
        <span class="mini" data-ws-rename="${w.id}" title="${tx('manager.rename')}">${icon('pencil', { size: 13 })}</span>
        <span class="mini" data-ws-del="${w.id}" title="${tx('common.delete')}">${icon('trash', { size: 13 })}</span>
      </span>
    </button>`).join('') || `<div class="side-empty">${tx('manager.wsEmpty')}</div>`;
}

$('ws-list').addEventListener('click', async (e) => {
  const t = e.target;
  const pick = (attr) => { const el = t.closest(`[${attr}]`); return el && el.getAttribute(attr); };
  const ws = (id) => workspaces.list.find(w => w.id === id);
  let id;
  if ((id = pick('data-ws-update'))) { e.stopPropagation(); await api.updateWorkspace(id); toast(tr('manager.wsUpdated', { name: ws(id).name })); return; }
  if ((id = pick('data-ws-rename'))) {
    e.stopPropagation();
    const name = await promptDialog({ title: tr('manager.renameWorkspace'), value: ws(id).name, ok: tr('manager.rename') });
    if (name) await api.renameWorkspace(id, name);
    return;
  }
  if ((id = pick('data-ws-del'))) {
    e.stopPropagation();
    if (confirm(tr('manager.deleteWorkspaceConfirm', { name: ws(id).name }))) await api.deleteWorkspace(id);
    return;
  }
  if ((id = pick('data-ws'))) {
    if (id === workspaces.active) return;
    await api.switchWorkspace(id);
    toast(tr('manager.switchedTo', { name: ws(id).name }));
  }
});

$('btn-save-ws').addEventListener('click', async () => {
  const name = await promptDialog({ title: tr('manager.saveLayoutAs'), value: workspaces.list.length ? '' : tr('manager.defaultWorkspaceName'), ok: tr('common.save') });
  if (!name) return;
  await api.saveWorkspace(name);
  toast(tr('manager.wsSaved', { name }));
});

// ---------- filters ----------
$('search').addEventListener('input', (e) => { state.query = e.target.value; renderSidebar(); render(); });
$('sort').addEventListener('change', (e) => { state.sort = e.target.value; persist(); render(); });
function persist() {
  try { localStorage.setItem('stickies.list', JSON.stringify({ sort: state.sort, taskGroup: state.taskGroup })); } catch { /* ignore */ }
}

function buildColorFilter() {
  $('color-filter').innerHTML = palette.order.map(k => {
    const n = palette.notes[k];
    return `<button class="cdot${state.color === k ? ' on' : ''}" data-color="${k}" title="${escapeHtml(colorName(n.name))}" style="background:${n.swatch}"></button>`;
  }).join('');
}

$('color-filter').addEventListener('click', (e) => {
  const d = e.target.closest('.cdot');
  if (!d) return;
  state.color = state.color === d.dataset.color ? null : d.dataset.color;
  buildColorFilter();
  render();
});

// ---------- note cards ----------
let rtf = new Intl.RelativeTimeFormat(uiLang(), { numeric: 'auto' });
function ago(t) {
  const s = (t - Date.now()) / 1000;
  const a = Math.abs(s);
  if (a < 45) return tr('manager.justNow');
  if (a < 3600) return rtf.format(Math.round(s / 60), 'minute');
  if (a < 86400) return rtf.format(Math.round(s / 3600), 'hour');
  if (a < 7 * 86400) return rtf.format(Math.round(s / 86400), 'day');
  const d = new Date(t);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(uiLang(), { month: 'short', day: 'numeric', year: sameYear ? undefined : 'numeric' });
}

function reminderLabel(r) {
  const d = new Date(r.snoozeAt || r.at);
  const today = d.toDateString() === new Date().toDateString();
  const time = d.toLocaleTimeString(uiLang(), { hour: 'numeric', minute: '2-digit' });
  return r.pending ? tr('manager.due') : today ? time : `${d.toLocaleDateString(uiLang(), { month: 'short', day: 'numeric' })} ${time}`;
}

function filtered() {
  const pq = parseQuery(state.query);
  let list = notes.filter(n => {
    switch (state.view) {
      case 'trash': return n.trashed;
      case 'open': return !n.trashed && n.open;
      case 'pinned': return !n.trashed && n.pinned;
      case 'reminders': return !n.trashed && n.reminder;
      default: return !n.trashed;
    }
  });
  if (state.color) list = list.filter(n => n.color === state.color);
  list = list.filter(n => matches(n, pq));
  const byTitle = (a, b) => (a.title || '￿').localeCompare(b.title || '￿', undefined, { sensitivity: 'base' });
  const sorters = {
    updated: (a, b) => b.updatedAt - a.updatedAt,
    created: (a, b) => b.createdAt - a.createdAt,
    title: byTitle,
    color: (a, b) => palette.order.indexOf(a.color) - palette.order.indexOf(b.color) || b.updatedAt - a.updatedAt
  };
  if (state.view === 'reminders') list.sort((a, b) => (a.reminder.snoozeAt || a.reminder.at) - (b.reminder.snoozeAt || b.reminder.at));
  else if (state.view === 'trash') list.sort((a, b) => (b.trashedAt || 0) - (a.trashedAt || 0));
  else list.sort(sorters[state.sort] || sorters.updated);
  return { list, pq };
}

// Matches are found on the raw text and merged before escaping, so one term can never
// match inside another term's <mark> or inside an escaped entity.
function highlight(text, terms) {
  const src = String(text || '');
  const lower = src.toLowerCase();
  const spans = [];
  for (const t of new Set(terms.map(x => String(x).toLowerCase()).filter(Boolean))) {
    for (let i = lower.indexOf(t); i !== -1; i = lower.indexOf(t, i + t.length)) spans.push([i, i + t.length]);
  }
  spans.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
  let html = '';
  let pos = 0;
  for (const [s, e] of spans) {
    if (e <= pos) continue;
    const from = Math.max(s, pos);
    html += escapeHtml(src.slice(pos, from)) + '<mark>' + escapeHtml(src.slice(from, e)) + '</mark>';
    pos = e;
  }
  return html + escapeHtml(src.slice(pos));
}

// Everything in the search box that is looked for as text: words, "phrases" and #tags.
function searchTerms(pq) {
  return [...pq.words, ...pq.tags.map(t => '#' + t)];
}

function openFromList(n) {
  const terms = state.query ? searchTerms(parseQuery(state.query)) : [];
  return api.open(n.id, terms.length ? { highlight: terms } : undefined);
}

function urgencyDot(r) {
  const u = urgency(r);
  return u ? `<span class="urgency-dot" data-urgency="${u}"></span>` : '';
}

// Urgency drifts with time alone, so recolour the dots in place instead of rebuilding the list.
setInterval(() => {
  for (const dot of document.querySelectorAll('#list .urgency-dot')) {
    const card = dot.closest('.note-card');
    const n = card && notes.find(x => x.id === card.dataset.id);
    const u = n && urgency(n.reminder);
    if (u) dot.dataset.urgency = u;
  }
}, 30 * 1000);

function snippet(n, terms) {
  // Show the excerpt where the words were found: the note's text, or else a picture's text.
  const sources = [[n.text, ''], [n.tabCount > 1 ? n.searchText : '', tr('manager.inAnotherTab')], [n.imageText, tr('manager.inPicture')]];
  const [src, label] = sources.find(([s]) => terms.some(t => String(s || '').toLowerCase().includes(t))) || sources[0];
  const text = String(src || '').replace(/\n{2,}/g, '\n');
  const lower = text.toLowerCase();
  const idx = Math.min(...terms.map(t => { const i = lower.indexOf(t); return i < 0 ? Infinity : i; }));
  const start = idx === Infinity || idx < 60 ? 0 : text.lastIndexOf(' ', idx - 40) + 1;
  const body = (start > 0 ? '…' : '') + text.slice(start, start + 240) + (text.length > start + 240 ? '…' : '');
  return `<div class="snippet">${label ? `<i>${escapeHtml(label)} </i>` : ''}${highlight(body, terms)}</div>`;
}

function cardHtml(n, pq) {
  let c = (palette.notes[n.color] || palette.notes.yellow)[theme];
  // Custom colours and gradients preview on the card; a picture would be too busy at this size,
  // so it gets a badge instead and the card keeps the palette colour it is tinted with.
  const bg = safeBackground(n.background);
  let bgImage = '';
  if (bg && bg.type === 'solid') c = deriveColors(bg.color);
  else if (bg && bg.type === 'gradient') { c = deriveGradientColors(bg.from, bg.to); bgImage = gradientCss(bg); }
  const font = (palette.fonts.find(f => f.id === n.font) || palette.fonts[0]).css.replace(/"/g, "'");
  const style = `--n-bg:${c.bg};--n-bar:${c.bar};--n-text:${c.text};--n-accent:${c.accent};--n-font:${font}${bgImage ? `;--n-bgimg:${bgImage}` : ''}`;
  let content;
  if (n.privateLocked) content = `<div class="locked-card">${icon('shield', { size: 18 })}<span>${tx('manager.privateLocked')}</span></div>`;
  else if (pq.words.length || pq.tags.length) content = snippet(n, searchTerms(pq));
  else {
    const html = sanitizeHtml(n.html, { mode: 'stored' });
    const short = n.text.split('\n').length < 6 && !/<img\b/.test(html);
    content = `<div class="preview${short ? ' short' : ''}">${html.trim() ? html : `<span class="empty-note">${tx('manager.emptyNote')}</span>`}</div>`;
  }
  const badges = [];
  if (n.private) badges.push(`<span class="badge" title="${tx('manager.private')}">${icon('shield', { size: 13 })}</span>`);
  if (n.pinned && !n.trashed) badges.push(`<span class="badge" title="${tx('manager.keptOnTop')}">${icon('pinFilled', { size: 13 })}</span>`);
  if (n.reminder && !n.trashed) badges.push(`<span class="badge" title="${tx('note.reminder')}">${urgencyDot(n.reminder)}${icon('bell', { size: 13 })}${escapeHtml(reminderLabel(n.reminder))}</span>`);
  if (n.tasks.total) badges.push(`<span class="badge" title="${tx('manager.checklistProgress')}">${icon('checklist', { size: 13 })}${n.tasks.done}/${n.tasks.total}</span>`);
  if (bg && bg.type === 'image') badges.push(`<span class="badge" title="${tx('manager.pictureBackground')}">${icon('image', { size: 13 })}</span>`);
  if (n.locked) badges.push(`<span class="badge" title="${tx('manager.locked')}">${icon('lock', { size: 13 })}</span>`);
  if (!n.open && !n.trashed) badges.push(`<span class="badge" title="${tx('manager.notOnDesktop')}">${icon('eyeOff', { size: 13 })}</span>`);
  if (n.tabCount > 1) badges.push(`<span class="badge" title="${tx('note.tabs')}">${escapeHtml(tp('manager.tabsCount', n.tabCount))}</span>`);
  for (const t of n.tags.slice(0, 3)) badges.push(`<span class="chip-tag">${pq.tags.length ? highlight('#' + t, pq.tags.map(x => '#' + x)) : '#' + escapeHtml(t)}</span>`);
  const when = n.trashed ? tr('manager.deletedAgo', { when: ago(n.trashedAt || n.updatedAt) }) : ago(n.updatedAt);
  const actions = n.trashed
    ? `<button class="card-btn" data-act="restore" title="${tx('manager.restore')}">${icon('restore', { size: 16 })}</button>
       <button class="card-btn danger" data-act="purge" title="${tx('manager.deleteForever')}">${icon('trash', { size: 16 })}</button>`
    : `<button class="card-btn" data-act="${n.open ? 'hide' : 'open'}" title="${tx(n.open ? 'manager.hideFromDesktop' : 'manager.showOnDesktop')}">${icon(n.open ? 'eyeOff' : 'eye', { size: 16 })}</button>
       <button class="card-btn danger" data-act="trash" title="${tx('common.delete')}">${icon('trash', { size: 16 })}</button>
       <button class="card-btn" data-act="menu" title="${tx('manager.more')}">${icon('more', { size: 16 })}</button>`;
  return `<div class="note-card${n.open ? '' : ' closed'}${n.trashed ? ' trashed' : ''}${bgImage ? ' has-bgimg' : ''}" tabindex="0" data-id="${n.id}" style="${style}">
    <div class="card-body">${content}</div>
    <div class="card-meta">${badges.join('')}<span class="grow"></span><span>${escapeHtml(when)}</span></div>
    <div class="card-actions">${actions}</div>
  </div>`;
}

function render() {
  if (state.view === 'tasks') { renderTasks(); return; }
  const { list, pq } = filtered();
  const focusedId = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.id : null;
  const tabList = filteredTrashedTabs(pq);
  if (tabList.length) {
    // Closed tabs sit among the deleted notes, newest first.
    const items = [
      ...list.map(n => ({ at: n.trashedAt || 0, html: cardHtml(n, pq) })),
      ...tabList.map(t => ({ at: t.trashedAt || 0, html: tabCardHtml(t, pq) }))
    ].sort((a, b) => b.at - a.at);
    $('list').innerHTML = items.map(x => x.html).join('');
  } else $('list').innerHTML = list.map(n => cardHtml(n, pq)).join('');
  hydrateFileChips($('list'));
  if (focusedId) { const el = $('list').querySelector(`[data-id="${focusedId}"]`); if (el) el.focus({ preventScroll: true }); }
  $('view-title').textContent = tr(VIEW_TITLES[state.view] || 'manager.allNotes');

  const isEmpty = !list.length && !tabList.length;
  $('list').hidden = isEmpty;
  $('empty').hidden = !isEmpty;
  if (isEmpty) {
    let title = tr('manager.noNotesYet');
    let sub = tr('manager.createANoteAndIt');
    let action = tr('manager.newNoteButton');
    if (state.query) { title = tr('manager.noMatches'); sub = tr('manager.nothingMatches', { query: state.query }); action = tr('manager.clearSearch'); }
    else if (state.view === 'trash') { title = tr('manager.trashIsEmpty'); sub = tr('manager.trashEmptySub'); action = tr('manager.backToAllNotes'); }
    else if (state.view !== 'all' || state.color) {
      title = tr('manager.nothingHere');
      sub = tr({ open: 'manager.emptyOpen', pinned: 'manager.emptyPinned', reminders: 'manager.emptyReminders' }[state.view] || 'manager.emptyColor');
      action = tr('manager.showAllNotes');
    }
    $('empty-title').textContent = title;
    $('empty-sub').textContent = sub;
    $('empty-action').textContent = action;
  }
  const inTrash = state.view === 'trash';
  $('btn-empty-trash').hidden = !(inTrash && (notes.some(n => n.trashed) || trashedTabs.length));
  $('btn-show-all').hidden = inTrash;
  $('btn-hide-all').hidden = inTrash;
  $('status').textContent = tp('manager.notesCount', list.length);
  if (tabList.length) $('status').textContent += `, ${tp('manager.tabsCount', tabList.length)}`;
  $('status').title = inTrash ? tr('manager.trashNote') : '';
  if (inTrash && (list.length || tabList.length)) $('status').textContent += ` · ${tr('manager.trashNote')}`;
}

// Tabs closed from a note only show in the Trash, and only for plain word searches: the
// other filters (tags, colors, dates…) describe notes.
function filteredTrashedTabs(pq) {
  if (state.view !== 'trash' || state.color) return [];
  if (pq.tags.length || pq.has.length || pq.is.length || pq.due || pq.color || pq.edited || pq.created) return [];
  return trashedTabs.filter(t => {
    const hay = `${t.title}\n${t.text}\n${t.noteTitle}`.toLowerCase();
    return pq.words.every(w => hay.includes(w));
  });
}

function tabCardHtml(t, pq) {
  const owner = notes.find(n => n.id === t.noteId);
  const c = (palette.notes[owner && owner.color] || palette.notes.yellow)[theme];
  const style = `--n-bg:${c.bg};--n-bar:${c.bar};--n-text:${c.text};--n-accent:${c.accent}`;
  const label = tr('manager.tabFrom', { tab: t.title || tr('manager.untitled'), note: t.noteTitle || tr('manager.untitled') });
  let content;
  if (pq.words.length) content = snippet({ text: t.text, searchText: '', imageText: '' }, pq.words);
  else {
    const html = sanitizeHtml(t.html, { mode: 'stored' });
    const short = String(t.text || '').split('\n').length < 6 && !/<img\b/.test(html);
    content = `<div class="preview${short ? ' short' : ''}">${html.trim() ? html : `<span class="empty-note">${tx('manager.emptyTab')}</span>`}</div>`;
  }
  return `<div class="note-card trashed tab-card" tabindex="0" data-tab-id="${escapeHtml(t.id)}" style="${style}">
    <div class="card-body"><div class="tab-from" title="${escapeHtml(label)}">${escapeHtml(label)}</div>${content}</div>
    <div class="card-meta"><span class="grow"></span><span>${tx('manager.deletedAgo', { when: ago(t.trashedAt) })}</span></div>
    <div class="card-actions">
       <button class="card-btn" data-act="restore" title="${tx('manager.restore')}">${icon('restore', { size: 16 })}</button>
       <button class="card-btn danger" data-act="purge" title="${tx('manager.deleteForever')}">${icon('trash', { size: 16 })}</button>
    </div>
  </div>`;
}

async function tabAction(act, id) {
  const t = trashedTabs.find(x => x.id === id);
  if (!t) return;
  if (act === 'restore') {
    const r = await api.restoreTab(id);
    if (!r || !r.ok) { toast(tr('manager.tabRestoreFailed')); return; }
    if (r.created) { toast(tr('manager.restoredAsNote')); return; }
    const owner = notes.find(n => n.id === r.noteId);
    toast(tr('manager.tabRestoredTo', { title: (owner && owner.title) || r.noteTitle || tr('manager.untitled') }));
  } else if (act === 'purge') {
    if (!confirm(tr('manager.deleteTabConfirm'))) return;
    await api.purgeTab(id);
  }
}

$('list').addEventListener('click', async (e) => {
  const card = e.target.closest('.note-card');
  if (!card) return;
  if (card.dataset.tabId) {
    const tbtn = e.target.closest('[data-act]');
    if (tbtn) { e.stopPropagation(); await tabAction(tbtn.dataset.act, card.dataset.tabId); }
    return;
  }
  const n = notes.find(x => x.id === card.dataset.id);
  const btn = e.target.closest('[data-act]');
  if (btn) { e.stopPropagation(); await cardAction(btn.dataset.act, n, btn); return; }
  if (!n.trashed) openFromList(n);
});

$('list').addEventListener('contextmenu', (e) => {
  const card = e.target.closest('.note-card');
  if (!card) return;
  e.preventDefault();
  if (card.dataset.tabId) return;
  openCardMenu(notes.find(x => x.id === card.dataset.id), { x: e.clientX, y: e.clientY });
});

$('list').addEventListener('keydown', (e) => {
  const card = e.target.closest('.note-card');
  if (!card) return;
  if (card.dataset.tabId && (e.key === 'Enter' || e.key === 'Delete')) {
    e.preventDefault();
    if (e.key === 'Delete') tabAction('purge', card.dataset.tabId);
    return;
  }
  const n = notes.find(x => x.id === card.dataset.id);
  if (e.key === 'Enter') { e.preventDefault(); if (!n.trashed) openFromList(n); }
  else if (e.key === 'Delete') { e.preventDefault(); cardAction(n.trashed ? 'purge' : 'trash', n); }
  else if (['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft'].includes(e.key)) {
    e.preventDefault();
    const cards = [...$('list').querySelectorAll('.note-card')];
    const i = cards.indexOf(card) + (e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : -1);
    if (cards[i]) cards[i].focus();
  }
});

async function cardAction(act, n, anchor) {
  switch (act) {
    case 'open': await api.open(n.id); break;
    case 'hide': await api.closeNote(n.id); break;
    case 'trash': await api.trashNote(n.id); toast(tr('manager.movedToTrash')); break;
    case 'restore': await api.restore(n.id); toast(tr('manager.restored')); break;
    case 'purge':
      if (!confirm(tr('manager.deleteNoteConfirm'))) return;
      await api.purge(n.id);
      break;
    case 'menu': {
      const r = anchor.getBoundingClientRect();
      openCardMenu(n, { x: r.right, y: r.bottom + 4, alignRight: true });
      break;
    }
    case 'duplicate': await api.duplicateNote(n.id); break;
    case 'pin': await api.setPinned(n.id, !n.pinned); break;
    case 'history': if (!(await api.openHistory(n.id))) toast(tr('note.noHistoryPrivate')); break;
    case 'private': await togglePrivate(n); break;
    default: break;
  }
}

async function togglePrivate(n) {
  vaultState = await api.vaultStatus();
  if (!vaultState.configured) { showSettings(); $('privacy').scrollIntoView(); toast(tr('note.choosePasswordFirst')); return; }
  if (!vaultState.unlocked && !(await unlockPrompt())) return;
  const r = await api.setPrivate(!n.private, n.id);
  if (r && r.ok) toast(tr(n.private ? 'manager.noLongerPrivate' : 'manager.privateOn'));
}

async function unlockPrompt() {
  const pw = await promptDialog({ title: tr('note.passwordForPrivate'), ok: tr('note.unlock'), password: true });
  if (!pw) return false;
  if (await api.vaultUnlock(pw)) return true;
  toast(tr('note.wrongPassword'));
  return false;
}

function openMenu(pos, html, onPick, card) {
  closeMenu();
  const menu = $('card-menu');
  menu.innerHTML = html;
  menu.hidden = false;
  const w = menu.offsetWidth;
  const h = menu.offsetHeight;
  let x = pos.alignRight ? pos.x - w : pos.x;
  let y = pos.y;
  x = Math.max(6, Math.min(x, innerWidth - w - 6));
  if (y + h > innerHeight - 6) y = Math.max(6, (pos.alignRight ? pos.y - 34 : pos.y) - h);
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
  if (card) card.classList.add('menu-open');
  menuState = { onPick, card };
}

function openCardMenu(n, pos) {
  let html;
  if (n.trashed) {
    html = `
      <button class="menu-item" data-mact="restore">${icon('restore', { size: 16 })}<span>${tx('manager.restore')}</span></button>
      <div class="menu-sep"></div>
      <button class="menu-item danger" data-mact="purge">${icon('trash', { size: 16 })}<span>${tx('manager.deleteForever')}</span></button>`;
  } else {
    html = `
      <div class="swatch-row">${palette.order.map(k => `<button data-mcolor="${k}" class="${k === n.color ? 'on' : ''}" title="${escapeHtml(colorName(palette.notes[k].name))}" style="background:${palette.notes[k].swatch}"></button>`).join('')}</div>
      <div class="menu-sep"></div>
      <button class="menu-item" data-mact="open">${icon('external', { size: 16 })}<span>${tx(n.open ? 'manager.bringToFront' : 'manager.showOnDesktop')}</span></button>
      ${n.open ? `<button class="menu-item" data-mact="hide">${icon('eyeOff', { size: 16 })}<span>${tx('manager.hideFromDesktop')}</span></button>` : ''}
      <button class="menu-item" data-mact="pin">${icon(n.pinned ? 'pinFilled' : 'pin', { size: 16 })}<span>${tx(n.pinned ? 'manager.stopKeepOnTop' : 'note.keepOnTop')}</span></button>
      <button class="menu-item" data-mact="duplicate">${icon('copy', { size: 16 })}<span>${tx('manager.duplicate')}</span></button>
      ${n.private ? '' : `<button class="menu-item" data-mact="history">${icon('history', { size: 16 })}<span>${tx('note.versionHistory')}</span></button>`}
      <button class="menu-item" data-mact="private">${icon('shield', { size: 16 })}<span>${tx(n.private ? 'note.makeNotPrivate' : 'note.makePrivateMenu')}</span></button>
      <div class="menu-sep"></div>
      <button class="menu-item danger" data-mact="trash">${icon('trash', { size: 16 })}<span>${tx('common.delete')}</span></button>`;
  }
  const card = $('list').querySelector(`[data-id="${n.id}"]`);
  openMenu(pos, html, async (el) => {
    if (el.dataset.mcolor) await api.setColor(n.id, el.dataset.mcolor);
    else if (el.dataset.mact) await cardAction(el.dataset.mact, n);
  }, card);
}

function closeMenu() {
  if (!menuState) return;
  $('card-menu').hidden = true;
  if (menuState.card) menuState.card.classList.remove('menu-open');
  menuState = null;
}

$('card-menu').addEventListener('click', async (e) => {
  if (!menuState) return;
  const el = e.target.closest('[data-mcolor], [data-mact], [data-new], [data-new-template]');
  if (!el) return;
  const { onPick } = menuState;
  closeMenu();
  await onPick(el);
});

document.addEventListener('mousedown', (e) => {
  if (menuState && !e.target.closest('#card-menu') && !e.target.closest('[data-act="menu"], #btn-new-menu')) closeMenu();
});
window.addEventListener('blur', closeMenu);
$('list').addEventListener('scroll', closeMenu, { passive: true });

// ---------- tasks across notes ----------
const taskCache = new Map(); // note id -> { key, items }

function tasksOf(n) {
  if (n.privateLocked || !n.html.includes('checklist')) return [];
  const key = `${n.updatedAt}:${n.html.length}`;
  const hit = taskCache.get(n.id);
  if (hit && hit.key === key) return hit.items;
  const doc = new DOMParser().parseFromString(sanitizeHtml(n.html, { mode: 'stored' }), 'text/html');
  const items = [...doc.body.querySelectorAll('ul.checklist > li')].map((li, index) => {
    let depth = 0;
    for (let p = parentItem(li); p; p = parentItem(p)) depth++;
    const clone = li.cloneNode(true);
    clone.querySelectorAll('ul, ol').forEach(x => x.remove());
    return { index, checked: li.classList.contains('checked'), text: ownText(li).trim(), html: clone.innerHTML, due: li.dataset.due || null, depth };
  });
  taskCache.set(n.id, { key, items });
  return items;
}

function dueChip(iso) {
  if (!iso) return '';
  const today = isoDate(new Date());
  const cls = iso < today ? 'late' : iso === today ? 'today' : '';
  return `<span class="due-chip ${cls}">${escapeHtml(dueLabel(iso))}</span>`;
}

function taskRow(n, t, { showNote = false } = {}) {
  return `<div class="task${t.checked ? ' done' : ''}" style="padding-left:${12 + t.depth * 22}px" data-note="${n.id}" data-index="${t.index}">
    <button class="box" title="${tx(t.checked ? 'manager.markNotDone' : 'manager.markDone')}">${icon('check', { size: 12 })}</button>
    <div class="txt" title="${tx('manager.showInNote')}">${sanitizeHtml(t.html, { mode: 'stored' }) || escapeHtml(t.text) || `<i>${tx('manager.emptyItem')}</i>`}${showNote ? `<div class="from">${escapeHtml(n.title || tr('note.untitled'))}</div>` : ''}</div>
    ${dueChip(t.due)}
  </div>`;
}

function renderTasks() {
  const q = state.taskQuery.trim().toLowerCase();
  const showDone = state.taskShow === 'all';
  const groups = [];
  for (const n of notes.filter(x => !x.trashed)) {
    const items = tasksOf(n).filter(t => (showDone || !t.checked) && (!q || t.text.toLowerCase().includes(q) || (n.title || '').toLowerCase().includes(q)));
    if (items.length) groups.push({ n, items, all: tasksOf(n) });
  }
  let html = '';
  if (state.taskGroup === 'due') {
    const today = isoDate(new Date());
    const tomorrow = isoDate(new Date(Date.now() + 864e5));
    const week = isoDate(new Date(Date.now() + 7 * 864e5));
    const buckets = [['manager.overdue', 'late'], ['date.today', ''], ['date.tomorrow', ''], ['manager.next7Days', ''], ['manager.later', ''], ['manager.noDate', '']].map(([label, cls]) => ({ label, cls, rows: [] }));
    for (const { n, items } of groups) {
      for (const t of items) {
        const d = t.due;
        const b = !d ? 5 : d < today ? 0 : d === today ? 1 : d === tomorrow ? 2 : d <= week ? 3 : 4;
        buckets[b].rows.push({ n, t });
      }
    }
    for (const b of buckets) {
      if (!b.rows.length) continue;
      b.rows.sort((x, y) => (x.t.due || '9999').localeCompare(y.t.due || '9999'));
      html += `<div class="task-section ${b.cls}">${tx(b.label)}</div><div class="task-group">${b.rows.map(({ n, t }) => taskRow(n, t, { showNote: true })).join('')}</div>`;
    }
  } else {
    groups.sort((a, b) => b.n.updatedAt - a.n.updatedAt);
    for (const { n, items, all } of groups) {
      const done = all.filter(t => t.checked).length;
      html += `<div class="task-group">
        <div class="task-head"><span class="dot" style="background:${swatch(n.color)}"></span><span class="t">${escapeHtml(n.title || tr('note.untitled'))}</span><span class="n">${done}/${all.length}</span>
          <button class="open-note" data-open="${n.id}" title="${tx('manager.openNote')}">${icon('external', { size: 15 })}</button></div>
        ${items.map(t => taskRow(n, t)).join('')}
      </div>`;
    }
  }
  $('tasks').innerHTML = html;
  $('tasks').hidden = !html;
  $('tasks-empty').hidden = !!html;
  $('tasks-empty-title').textContent = tr(q ? 'manager.noMatchingTasks' : showDone ? 'manager.noChecklistItems' : 'manager.allDone');
}

$('task-search').addEventListener('input', (e) => { state.taskQuery = e.target.value; renderTasks(); });
$('task-show').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  state.taskShow = b.dataset.v;
  for (const x of $('task-show').children) x.classList.toggle('on', x === b);
  renderTasks();
});
$('task-group').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  state.taskGroup = b.dataset.v;
  for (const x of $('task-group').children) x.classList.toggle('on', x === b);
  persist();
  renderTasks();
});

$('tasks').addEventListener('click', async (e) => {
  const open = e.target.closest('[data-open]');
  if (open) { api.open(open.dataset.open); return; }
  const row = e.target.closest('.task');
  if (!row) return;
  const n = notes.find(x => x.id === row.dataset.note);
  const index = Number(row.dataset.index);
  const task = tasksOf(n).find(t => t.index === index);
  const text = task ? task.text : null;
  if (e.target.closest('.box')) {
    const checked = !row.classList.contains('done');
    row.classList.toggle('done', checked);
    await toggleTask(n, index, checked, text);
  } else if (e.target.closest('.txt')) {
    api.revealTask(n.id, index, text);
  }
});

// Open notes tick the item themselves; for closed ones edit the HTML here with the same
// rules as a note (sub-items follow, parents tick when all sub-items are done).
async function toggleTask(n, index, checked, text) {
  const res = await api.toggleTask(n.id, index, checked, text);
  if (!res || !res.needsHtml) return;
  const doc = new DOMParser().parseFromString(sanitizeHtml(n.html, { mode: 'stored' }), 'text/html');
  const items = [...doc.body.querySelectorAll('ul.checklist > li')];
  let li = items[index];
  if (li && text != null && ownText(li).trim() !== text) li = items.find(x => ownText(x).trim() === text) || li;
  if (!li) return;
  li.classList.toggle('checked', checked);
  const parents = cascadeCheck(li);
  if (settings.sinkTicked) for (const item of [li, ...parents]) sinkItem(item);
  await api.setHtml(n.id, doc.body.innerHTML);
}

// ---------- keyboard ----------
document.addEventListener('keydown', (e) => {
  const mod = e.ctrlKey || e.metaKey;
  if (e.target.classList && e.target.classList.contains('hk')) return;
  if (!$('prompt').hidden) return;
  if (mod && e.key.toLowerCase() === 'n') { e.preventDefault(); api.create(); }
  else if (mod && e.key.toLowerCase() === 'f') {
    e.preventDefault();
    if (!$('view-settings').hidden) setView(state.view);
    const box = state.view === 'tasks' ? $('task-search') : $('search');
    box.focus();
    box.select();
  } else if (mod && e.key === ',') { e.preventDefault(); showSettings(); }
  else if (e.key === 'Escape') {
    if (menuState) closeMenu();
    else if ($('shell').classList.contains('drawer-open')) closeDrawer();
    else if (!$('view-settings').hidden) setView(state.view);
    else if ($('search').value && state.view !== 'tasks') setQuery('');
  } else if (e.key === 'ArrowDown' && e.target === $('search')) {
    e.preventDefault();
    const first = $('list').querySelector('.note-card');
    if (first) first.focus();
  }
});

// ---------- settings ----------
// Functions, not constants, so a language change rebuilds them.
const NOTE_SHORTCUTS = () => [
  [tr('sc.newNote'), 'Ctrl+N'], [tr('sc.closeNote'), 'Ctrl+W'], [tr('sc.deleteNote'), 'Ctrl+D'], [tr('sc.allNotes'), 'Ctrl+H'],
  [tr('sc.biu'), 'Ctrl+B / I / U'], [tr('sc.strike'), 'Ctrl+T'], [tr('sc.inlineCode'), 'Ctrl+E'],
  [tr('sc.bulleted'), 'Ctrl+Shift+L'], [tr('sc.numbered'), 'Ctrl+Shift+O'], [tr('sc.checklist'), 'Ctrl+Shift+C'],
  [tr('sc.moveItem'), 'Alt+Shift+↑ / ↓'], [tr('sc.indent'), 'Tab / Shift+Tab'],
  [tr('sc.headings'), 'Ctrl+Alt+1 / 2 / 3'], [tr('sc.normal'), 'Ctrl+Alt+0'],
  [tr('sc.link'), 'Ctrl+K'], [tr('sc.clearFormat'), 'Ctrl+\\'], [tr('sc.dateTime'), 'Ctrl+;'],
  [tr('sc.find'), 'Ctrl+F'], [tr('sc.editHtml'), 'Ctrl+Shift+H'], [tr('sc.pastePlain'), 'Ctrl+Shift+V'],
  [tr('sc.keepOnTop'), 'Ctrl+Shift+P'], [tr('sc.roll'), tr('sc.rollKeys')],
  [tr('sc.zoom'), 'Ctrl+= / Ctrl+- / Ctrl+0'], [tr('sc.print'), 'Ctrl+P'], [tr('sc.openLink'), 'Ctrl+Click']
];
const MD_SHORTCUTS = () => [
  [tr('sc.command'), '/'], [tr('sc.tag'), '#word'], [tr('sc.noteLink'), '[['],
  [tr('sc.due'), '@fri  @tomorrow  @10/20'],
  [tr('sc.headingsMd'), '# ␣  ## ␣  ### ␣'], [tr('sc.bulleted'), '- ␣'], [tr('sc.numbered'), '1. ␣'],
  [tr('sc.checkItem'), '[] ␣   [x] ␣'], [tr('sc.quote'), '> ␣'], [tr('sc.codeBlock'), '``` Enter'], [tr('sc.divider'), '--- Enter'],
  [tr('sc.bold'), '**text**'], [tr('sc.italic'), '*text*'], [tr('sc.strike'), '~~text~~'], [tr('sc.inlineCode'), '`code`'], [tr('sc.highlight'), '==text==']
];
const SEARCH_TIPS = () => [
  [tr('sc.tipTag'), '#work'], [tr('sc.tipUnchecked'), 'has:unchecked'], [tr('sc.tipImage'), 'has:image'],
  [tr('sc.tipEdited'), 'edited:today  edited:week  edited:3d'], [tr('sc.tipDue'), 'due:today  due:week  due:overdue'],
  [tr('sc.tipOpen'), 'is:open  is:pinned'], [tr('sc.tipColor'), 'color:blue'], [tr('sc.tipPhrase'), '"call back"']
];

function buildSettings(s) {
  $('set-color').innerHTML = palette.order.map(k => `<button data-v="${k}" title="${escapeHtml(colorName(palette.notes[k].name))}" style="background:${palette.notes[k].swatch}"></button>`).join('') +
    `<button class="random" data-v="random" title="${tx('manager.randomColor')}"></button>`;
  $('set-font').innerHTML = palette.fonts.map(f => `<option value="${f.id}">${escapeHtml(fontName(f))}</option>`).join('');
  const rows = (list) => list.map(([a, b]) => `<div>${escapeHtml(a)}</div><div class="k">${b.split(' / ').map(x => `<kbd>${escapeHtml(keyLabel(x))}</kbd>`).join(' ')}</div>`).join('');
  $('shortcuts').innerHTML = rows(NOTE_SHORTCUTS());
  $('md-shortcuts').innerHTML = MD_SHORTCUTS().map(([a, b]) => `<div>${escapeHtml(a)}</div><div class="k"><kbd>${escapeHtml(b)}</kbd></div>`).join('');
  $('search-tips').innerHTML = SEARCH_TIPS().map(([a, b]) => `<div>${escapeHtml(a)}</div><div class="k"><kbd>${escapeHtml(b)}</kbd></div>`).join('');
  $('data-dir').textContent = s.dataDir;
  refreshDataLocation();
  $('about').innerHTML = `OpenStickies ${escapeHtml(s.version)}<br>${tx('manager.about')}`;
  syncSettingsUi();
}

const SWITCHES = ['launchAtLogin', 'showInTaskbar', 'spellcheck', 'confirmDelete', 'snapToEdges', 'opaqueOnHover', 'sinkTicked', 'ocrImages', 'autoWorkspace', 'snapToGrid'];

function syncSettingsUi() {
  for (const b of $('set-theme').children) b.classList.toggle('on', b.dataset.v === settings.theme);
  for (const b of $('set-color').children) b.classList.toggle('on', b.dataset.v === settings.defaultColor);
  for (const b of $('set-snipTarget').children) b.classList.toggle('on', b.dataset.v === (settings.snipTarget || 'new'));
  const tbMode = settings.toolbarMode || 'popup';
  for (const b of $('set-toolbarMode').children) b.classList.toggle('on', b.dataset.v === tbMode);
  $('tb-mode-sub').textContent = tr({ popup: 'manager.tbPopupSub', editing: 'manager.tbEditingSub', always: 'manager.tbAlwaysSub' }[tbMode] || 'manager.tbPopupSub');
  $('set-language').value = settings.language || 'system';
  $('set-font').value = settings.defaultFont;
  $('set-reminderSound').value = ['chime', 'soft', 'none'].includes(settings.reminderSound) ? settings.reminderSound : 'chime';
  $('set-size').value = settings.fontSize;
  $('set-size-value').textContent = `${settings.fontSize}px`;
  $('set-gridSize').value = settings.gridSize || 24;
  $('set-gridSize-value').textContent = `${settings.gridSize || 24}px`;
  for (const k of SWITCHES) $(`set-${k}`).checked = settings[k] !== false && !!settings[k];
  for (const input of document.querySelectorAll('.hk')) {
    if (!input.classList.contains('capturing')) input.value = prettyAccel(settings.hotkeys[input.dataset.hk]);
  }
}

async function update(patch) {
  const res = await api.updateSettings(patch);
  settings = res.settings;
  if (!relocalize()) syncSettingsUi();
  return res;
}

$('set-theme').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) update({ theme: b.dataset.v }); });
$('set-snipTarget').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) update({ snipTarget: b.dataset.v }); });
$('set-toolbarMode').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) update({ toolbarMode: b.dataset.v }); });
$('set-color').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) update({ defaultColor: b.dataset.v }); });
$('set-font').addEventListener('change', (e) => update({ defaultFont: e.target.value }));
$('set-language').addEventListener('change', (e) => update({ language: e.target.value }));
$('set-reminderSound').addEventListener('change', (e) => { update({ reminderSound: e.target.value }); playChime(e.target.value); });
$('set-reminderSound-test').addEventListener('click', () => {
  const kind = $('set-reminderSound').value;
  if (kind === 'none') toast(tr('manager.silent'));
  else playChime(kind);
});
$('set-size').addEventListener('input', (e) => { $('set-size-value').textContent = `${e.target.value}px`; });
$('set-size').addEventListener('change', (e) => update({ fontSize: Number(e.target.value) }));
for (const k of SWITCHES) $(`set-${k}`).addEventListener('change', (e) => update({ [k]: e.target.checked }));

$('act-backup').addEventListener('click', async () => {
  const r = await api.exportBackup();
  if (r && r.ok) toast(tp('manager.backedUp', r.count));
});
$('act-restore').addEventListener('click', async () => {
  const r = await api.importBackup();
  if (!r) return;
  if (r.ok) {
    const extra = r.skippedPrivate ? ` · ${tp('manager.skippedBackup', r.skippedPrivate)}` : '';
    toast((r.added ? tp('manager.restoredNotes', r.added) : tr('manager.allAlreadyHere')) + extra);
  } else if (r.error) toast(r.error);
});
$('act-import').addEventListener('click', async () => {
  const r = await api.importFiles();
  if (r && r.added) toast(tp('manager.importedFiles', r.added));
});
$('act-folder').addEventListener('click', () => api.openDataFolder());
$('set-gridSize').addEventListener('input', (e) => { $('set-gridSize-value').textContent = `${e.target.value}px`; });
$('set-gridSize').addEventListener('change', (e) => update({ gridSize: Number(e.target.value) }));

// ----- bulk export -----
// Markdown needs a DOM to convert from, so it's made here; DOMParser documents are inert, so
// nothing in a note (images included) loads while converting.
function notesAsMarkdown() {
  const out = [];
  for (const n of notes) {
    if (n.trashed || n.privateLocked) continue;
    if (n.tabs) {
      // n.html is only the open tab: convert every tab and join them under their titles.
      const tabs = n.tabs.map(t => htmlToMarkdown(new DOMParser().parseFromString(sanitizeHtml(t.html || ''), 'text/html').body));
      out.push({ id: n.id, markdown: n.tabs.map((t, i) => `## ${t.title || tr('note.untitled')}\n\n${tabs[i]}`).join('\n\n'), tabs });
      continue;
    }
    const doc = new DOMParser().parseFromString(sanitizeHtml(n.html || ''), 'text/html');
    out.push({ id: n.id, markdown: htmlToMarkdown(doc.body) });
  }
  return out;
}

async function exportAll(format) {
  try {
    const r = await api.exportAll(format, format === 'txt' ? [] : notesAsMarkdown());
    if (!r || !r.ok) return;
    const skipped = r.skippedPrivate ? ` · ${tp('manager.skippedExport', r.skippedPrivate)}` : '';
    toast(tp('manager.exported', r.count) + skipped);
  } catch (err) {
    toast(tr('manager.exportFailed', { error: err.message || err }));
  }
}
$('act-export-md').addEventListener('click', () => exportAll('md'));
$('act-export-txt').addEventListener('click', () => exportAll('txt'));
$('act-export-json').addEventListener('click', () => exportAll('json'));

// ----- data folder location -----
async function refreshDataLocation() {
  const loc = await api.dataLocation();
  $('data-location').textContent = loc.custom ? loc.path : tr('manager.defaultLocation', { path: loc.path });
  $('act-location-change').disabled = loc.fixed;
  $('act-location-reset').disabled = loc.fixed || !loc.custom;
}
async function locationAction(fn) {
  const r = await fn();
  if (r && r.error) toast(r.error);
  else if (r && r.ok) toast(tr('manager.restarting'));
}
$('act-location-change').addEventListener('click', () => locationAction(api.chooseDataFolder));
$('act-location-reset').addEventListener('click', () => locationAction(api.resetDataFolder));

// ----- private notes -----
function renderPrivacy() {
  const v = vaultState;
  const card = $('privacy-card');
  if (!v.configured) {
    card.innerHTML = `
      <div class="form-row">
        <div>${tx('manager.pvIntro')}</div>
        <input type="password" id="pv-pw" placeholder="${tx('manager.choosePassword')}" autocomplete="new-password">
        <input type="password" id="pv-pw2" placeholder="${tx('manager.typeAgain')}" autocomplete="new-password">
        <input type="text" id="pv-hint" placeholder="${tx('manager.hintPlaceholder')}">
        <div class="warn">${tx('manager.forgetWarn')}</div>
        <div class="inline"><button class="btn primary" id="pv-create">${tx('manager.setUpPrivate')}</button></div>
      </div>`;
    $('pv-create').addEventListener('click', async () => {
      const pw = $('pv-pw').value;
      if (pw.length < 4) { toast(tr('manager.min4')); return; }
      if (pw !== $('pv-pw2').value) { toast(tr('manager.noMatch')); return; }
      const r = await api.vaultSetup(pw, $('pv-hint').value);
      if (r.ok) { vaultState = r.status; renderPrivacy(); toast(tr('manager.privateReady')); }
      else toast(r.error);
    });
    return;
  }
  const minutes = settings.autoLockMinutes ?? 5;
  card.innerHTML = `
    <div class="row">
      <div class="row-label">${icon('shield', { size: 17 })}<div><div>${tx('manager.privateNotesAre')} <span class="status-pill${v.unlocked ? ' ok' : ''}">${tx(v.unlocked ? 'manager.unlocked' : 'manager.locked')}</span></div><div class="sub">${tx('manager.privateFromMenu')}</div></div></div>
      <button class="btn" id="pv-toggle">${tx(v.unlocked ? 'manager.lockNow' : 'manager.unlockMenu')}</button>
    </div>
    <div class="row">
      <div class="row-label">${icon('clock', { size: 17 })}<div><div>${tx('manager.lockAuto')}</div><div class="sub">${tx(IS_MAC ? 'manager.autoLockSubMac' : 'manager.autoLockSub')}</div></div></div>
      <select id="pv-auto">${[[0, tr('manager.never')], [1, tp('manager.afterMinutes', 1)], [5, tp('manager.afterMinutes', 5)], [15, tp('manager.afterMinutes', 15)], [30, tp('manager.afterMinutes', 30)], [60, tr('manager.after1Hour')]].map(([m, l]) => `<option value="${m}"${m === minutes ? ' selected' : ''}>${l}</option>`).join('')}</select>
    </div>
    <label class="row">
      <div class="row-label">${icon('fingerprint', { size: 17 })}<div><div>${tx('manager.unlockWith', { name: quickUnlock().name })}</div><div class="sub">${escapeHtml(v.helloAvailable ? quickUnlock().ready : quickUnlock().missing)}</div></div></div>
      <input type="checkbox" class="switch" id="pv-hello" ${v.hello ? 'checked' : ''} ${v.helloAvailable ? '' : 'disabled'}>
    </label>
    ${v.unlocked ? `
    <div class="form-row">
      <div>${tx('manager.changePassword')}</div>
      <input type="password" id="pv-new" placeholder="${tx('manager.newPassword')}" autocomplete="new-password">
      <input type="password" id="pv-new2" placeholder="${tx('manager.typeAgain')}" autocomplete="new-password">
      <input type="text" id="pv-newhint" placeholder="${tx('manager.newHint')}" value="${escapeHtml(v.hint || '')}">
      <div class="inline"><button class="btn" id="pv-change">${tx('manager.changePassword')}</button></div>
    </div>` : ''}`;
  $('pv-toggle').addEventListener('click', async () => {
    if (vaultState.unlocked) { await api.vaultLock(); toast(tr('manager.privateLockedToast')); }
    else if (await unlockPrompt()) toast(tr('manager.privateUnlockedToast'));
    vaultState = await api.vaultStatus();
    renderPrivacy();
  });
  $('pv-auto').addEventListener('change', (e) => update({ autoLockMinutes: Number(e.target.value) }));
  $('pv-hello').addEventListener('change', async (e) => {
    if (!vaultState.unlocked && !(await unlockPrompt())) { e.target.checked = !e.target.checked; return; }
    const r = await api.vaultSetHello(e.target.checked);
    if (!r.ok) { toast(r.error); e.target.checked = !e.target.checked; }
    vaultState = await api.vaultStatus();
    renderPrivacy();
  });
  if (v.unlocked) {
    $('pv-change').addEventListener('click', async () => {
      const pw = $('pv-new').value;
      if (pw.length < 4) { toast(tr('manager.min4')); return; }
      if (pw !== $('pv-new2').value) { toast(tr('manager.noMatch')); return; }
      const r = await api.vaultChangePassword(pw, $('pv-newhint').value);
      toast(r.ok ? tr('manager.passwordChanged') : r.error);
      if (r.ok) { vaultState = r.status; renderPrivacy(); }
    });
  }
}

// ----- templates -----
function renderTemplates() {
  $('templates-card').innerHTML = templates.map(t => `
    <div class="tpl-row" data-tpl="${t.id}">
      <span class="dot" style="background:${swatch(t.color)}"></span><span class="name">${escapeHtml(t.name)}</span>
      <button class="mini" data-tpl-act="new">${tx('manager.newNoteButton')}</button>
      <button class="mini" data-tpl-act="rename">${tx('manager.rename')}</button>
      <button class="mini danger" data-tpl-act="delete">${tx('common.delete')}</button>
    </div>`).join('') + `<div class="row note-row">${tr('manager.templatesHelp')}</div>`;
}

$('templates-card').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-tpl-act]');
  if (!b) return;
  const id = b.closest('[data-tpl]').dataset.tpl;
  const t = templates.find(x => x.id === id);
  if (b.dataset.tplAct === 'new') api.newFromTemplate(id);
  else if (b.dataset.tplAct === 'rename') {
    const name = await promptDialog({ title: tr('manager.renameTemplate'), value: t.name, ok: tr('manager.rename') });
    if (name) await api.saveTemplate({ id, name });
  } else if (b.dataset.tplAct === 'delete') {
    if (confirm(tr('manager.deleteTemplateConfirm', { name: t.name }))) await api.deleteTemplate(id);
  }
});

// ----- global hotkey capture -----
function prettyAccel(acc) {
  return acc ? keyLabel(acc).replace(/\+/g, ' + ') : tr('manager.off');
}

const KEY_NAMES = { ' ': 'Space', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', Enter: 'Enter', Tab: 'Tab', Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown', Insert: 'Insert' };

function accelFromEvent(e) {
  if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return null;
  let key = null;
  if (/^Key[A-Z]$/.test(e.code)) key = e.code.slice(3);
  else if (/^Digit\d$/.test(e.code)) key = e.code.slice(5);
  else if (/^F([1-9]|1\d|2[0-4])$/.test(e.key)) key = e.key;
  else if (KEY_NAMES[e.key]) key = KEY_NAMES[e.key];
  else if (e.key.length === 1 && /[`\-=[\];',./\\]/.test(e.key)) key = e.key;
  if (!key) return null;
  const mods = [];
  // Command is the main modifier on a Mac, so there Control is the extra one.
  if (IS_MAC ? e.metaKey : e.ctrlKey) mods.push('CommandOrControl');
  if (e.altKey) mods.push('Alt');
  if (e.shiftKey) mods.push('Shift');
  if (IS_MAC ? e.ctrlKey : e.metaKey) mods.push(IS_MAC ? 'Control' : 'Super');
  if (!mods.length && !/^F\d+$/.test(key)) return 'needs-mod';
  return [...mods, key].join('+');
}

for (const input of document.querySelectorAll('.hk')) {
  input.addEventListener('focus', () => { input.classList.add('capturing'); input.value = tr('manager.pressKeys'); });
  input.addEventListener('blur', () => { input.classList.remove('capturing'); syncSettingsUi(); });
  input.addEventListener('keydown', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'Escape') { input.blur(); return; }
    let acc;
    if ((e.key === 'Backspace' || e.key === 'Delete') && !e.ctrlKey && !e.metaKey && !e.altKey) acc = '';
    else {
      acc = accelFromEvent(e);
      if (acc === null) return;
      if (acc === 'needs-mod') { input.value = modifierHint(); return; }
    }
    const res = await update({ hotkeys: { [input.dataset.hk]: acc } });
    input.blur();
    showHotkeyStatus(res.hotkeyResults);
    const st = res.hotkeyResults && res.hotkeyResults[input.dataset.hk];
    if (st === 'taken') toast(tr('manager.shortcutTaken'));
    else if (st === 'invalid') toast(tr('manager.shortcutInvalid'));
  });
}

async function refreshHotkeyStatus() {
  showHotkeyStatus(await api.hotkeyStatus());
}

function showHotkeyStatus(results) {
  if (!results) return;
  for (const el of document.querySelectorAll('[data-hk-status]')) {
    const st = results[el.dataset.hkStatus];
    el.className = `hk-status ${st === 'ok' ? 'ok' : st === 'taken' || st === 'invalid' ? 'taken' : ''}`;
    el.title = tr(st === 'ok' ? 'manager.hkActive' : st === 'taken' ? 'manager.hkTaken' : st === 'invalid' ? 'manager.hkInvalid' : 'manager.off');
  }
}

// ---------- small dialogs ----------
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
    const done = (v) => {
      modal.hidden = true;
      $('prompt-form').removeEventListener('submit', onSubmit);
      $('prompt-cancel').removeEventListener('click', onCancel);
      modal.removeEventListener('keydown', onKey);
      resolve(v);
    };
    const onSubmit = (e) => { e.preventDefault(); done(input.value.trim() ? input.value.trim() : null); };
    const onCancel = () => done(null);
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); done(null); } };
    $('prompt-form').addEventListener('submit', onSubmit);
    $('prompt-cancel').addEventListener('click', onCancel);
    modal.addEventListener('keydown', onKey);
  });
}

function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2800);
}
