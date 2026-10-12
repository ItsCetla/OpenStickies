import { icon, hydrateIcons } from '../shared/icons.js';
import { sanitizeHtml, escapeHtml } from '../shared/sanitize.js';
import { cascadeCheck, sinkItem, ownText, dueLabel, isoDate, parentItem } from '../note/smart.js';
import palette from '../shared/colors.json' with { type: 'json' };

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
const state = { view: 'all', color: null, query: '', sort: 'updated', taskShow: 'open', taskGroup: 'note', taskQuery: '' };
const VIEW_TITLES = { all: 'All notes', open: 'On desktop', pinned: 'Kept on top', reminders: 'Reminders', tasks: 'Tasks', trash: 'Trash' };

try {
  const saved = JSON.parse(localStorage.getItem('stickies.list') || '{}');
  if (saved.sort) state.sort = saved.sort;
  if (saved.taskGroup) state.taskGroup = saved.taskGroup;
} catch { /* storage unavailable */ }

hydrateIcons();
init();

async function init() {
  const s = await api.getSettings();
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
    syncSettingsUi();
    renderSidebar();
    render();
  });
  api.onView((v) => route(v));
  api.onWorkspaces(loadWorkspaces);
  api.onTemplates(loadTemplates);
  api.onVault((v) => { vaultState = v; renderPrivacy(); refresh(); });
}

async function refresh() {
  notes = await api.list();
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
  $('appbar-title').textContent = 'Stickies';
  $('view-list').hidden = view === 'tasks';
  $('view-tasks').hidden = view !== 'tasks';
  closeDrawer();
  render();
  (view === 'tasks' ? $('task-search') : $('search')).focus();
}

async function renderOpenCode() {
  const st = await api.opencodeStatus();
  const color = settings.agentColor || 'blue';
  const pill = st.connected ? (st.outdated ? 'Update ready' : 'Connected') : 'Not connected';
  const sub = st.found
    ? 'When OpenCode works on a multi-step task, a sticky shows its plan: done steps ticked, the current one marked ▶, the rest still to do. You can also ask it to “put something on a sticky”.'
    : 'OpenCode wasn’t found on this PC. Install it from opencode.ai, then connect here.';
  const buttons = st.connected
    ? `${st.outdated ? '<button class="btn primary" id="oc-connect">Update</button>' : ''}<button class="btn" id="oc-disconnect">Disconnect</button>`
    : '<button class="btn primary" id="oc-connect">Connect</button>';
  const foot = st.connected
    ? 'Restart OpenCode after connecting. Task notes are locked so typing can’t clash with the agent, and they’re tagged #opencode and with the project name.'
    : 'Connecting adds a small plugin to OpenCode (in your user folder) that talks only to Stickies on this PC.';
  $('opencode-card').innerHTML = `
    <div class="row">
      <div class="row-label">${icon('checklist', { size: 17 })}<div>
        <div>Task notes from OpenCode <span class="status-pill${st.connected ? ' ok' : ''}">${pill}</span></div>
        <div class="sub">${sub}</div>
      </div></div>
      ${buttons}
    </div>
    <label class="row">
      <div class="row-label">${icon('listOl', { size: 17 })}<div><div>Always plan multi-part tasks</div><div class="sub">OpenCode is asked to list the subtasks of any task with more than one part, so every such task gets a sticky</div></div></div>
      <input type="checkbox" class="switch" id="oc-nudge" ${settings.agentPlanNudge !== false ? 'checked' : ''}>
    </label>
    <div class="row column">
      <div class="row-label">${icon('palette', { size: 17 })}<div><div>Color for task notes</div></div></div>
      <div class="color-pick" id="oc-color">${palette.order.map(k => `<button data-v="${k}" class="${k === color ? 'on' : ''}" title="${palette.notes[k].name}" style="background:${palette.notes[k].swatch}"></button>`).join('')}</div>
    </div>
    <div class="row note-row">${foot}</div>`;
  const connectBtn = $('oc-connect');
  if (connectBtn) connectBtn.addEventListener('click', async () => { await api.opencodeConnect(); toast('Connected — restart OpenCode to start getting task notes'); renderOpenCode(); });
  const disc = $('oc-disconnect');
  if (disc) disc.addEventListener('click', async () => { await api.opencodeDisconnect(); toast('OpenCode disconnected'); renderOpenCode(); });
  $('oc-color').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) update({ agentColor: b.dataset.v }).then(renderOpenCode); });
  $('oc-nudge').addEventListener('change', (e) => update({ agentPlanNudge: e.target.checked }).then(() => toast(e.target.checked ? 'OpenCode will plan multi-part tasks as stickies' : 'OpenCode decides on its own when to make a plan')));
}

function showSettings() {
  $('view-list').hidden = true;
  $('view-tasks').hidden = true;
  $('view-settings').hidden = false;
  $('btn-back').hidden = false;
  $('btn-settings').hidden = true;
  $('appbar-title').textContent = 'Settings';
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
    <button class="menu-item" data-new="blank">${icon('plus', { size: 16 })}<span>Blank note</span></button>
    <button class="menu-item" data-new="snip">${icon('snip', { size: 16 })}<span>Snip the screen</span></button>
    ${templates.length ? '<div class="menu-sep"></div><div class="pop-title">From a template</div>' : ''}
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
  if (!n) return;
  if (!confirm(`Permanently delete ${n} note${n === 1 ? '' : 's'} in Trash? This can't be undone.`)) return;
  await api.emptyTrash();
  toast('Trash emptied');
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
    if (['image', 'images', 'picture', 'pictures', 'photo'].includes(k) && !/<img\b/.test(n.html)) return false;
    if (k === 'reminder' && !n.reminder) return false;
    if (['link', 'links'].includes(k) && !n.links.length) return false;
    if (['tag', 'tags'].includes(k) && !n.tags.length) return false;
  }
  if (pq.color && n.color !== pq.color) return false;
  if (pq.edited && n.updatedAt < since(pq.edited)) return false;
  if (pq.created && n.createdAt < since(pq.created)) return false;
  if (pq.due && !matchDue(n, pq.due)) return false;
  if (pq.words.length) {
    const hay = `${n.title}\n${n.text}\n${n.imageText}\n${n.tags.map(t => '#' + t).join(' ')}`.toLowerCase();
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
    trash: notes.length - active.length
  };
  for (const [k, v] of Object.entries(counts)) $(`count-${k}`).textContent = v ? String(v) : '';

  const saved = settings.savedSearches || [];
  $('saved-list').innerHTML = saved.map(s => `
    <button class="side-item${state.query === s.query && state.view !== 'tasks' ? ' on' : ''}" data-saved="${escapeHtml(s.id)}" title="${escapeHtml(s.query)}">
      ${icon('bookmark', { size: 16 })}<span>${escapeHtml(s.name)}</span>
      <span class="count">${active.filter(n => matches(n, parseQuery(s.query))).length || ''}</span>
      <span class="tools"><span class="mini" data-saved-del="${escapeHtml(s.id)}" title="Remove">${icon('close', { size: 13 })}</span></span>
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
  const name = await promptDialog({ title: 'Name this search', value: state.query.trim(), ok: 'Save' });
  if (!name) return;
  await api.updateSettings({ savedSearches: [...(settings.savedSearches || []), { id: 's' + Date.now().toString(36), name, query: state.query.trim() }] });
  toast(`Saved “${name}”`);
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
    <button class="side-item${w.id === workspaces.active ? ' on' : ''}" data-ws="${w.id}" title="Switch to ${escapeHtml(w.name)}">
      ${icon('layers', { size: 16 })}<span>${escapeHtml(w.name)}</span>
      ${w.id === workspaces.active ? '<span class="active-dot" title="Current workspace"></span>' : `<span class="count">${w.count}</span>`}
      <span class="tools">
        <span class="mini" data-ws-update="${w.id}" title="Save the current layout into it">${icon('download', { size: 13 })}</span>
        <span class="mini" data-ws-rename="${w.id}" title="Rename">${icon('pencil', { size: 13 })}</span>
        <span class="mini" data-ws-del="${w.id}" title="Delete">${icon('trash', { size: 13 })}</span>
      </span>
    </button>`).join('') || '<div class="side-empty">Arrange your notes, then save the layout here to switch back to it later.</div>';
}

$('ws-list').addEventListener('click', async (e) => {
  const t = e.target;
  const pick = (attr) => { const el = t.closest(`[${attr}]`); return el && el.getAttribute(attr); };
  const ws = (id) => workspaces.list.find(w => w.id === id);
  let id;
  if ((id = pick('data-ws-update'))) { e.stopPropagation(); await api.updateWorkspace(id); toast(`Updated “${ws(id).name}” with the current layout`); return; }
  if ((id = pick('data-ws-rename'))) {
    e.stopPropagation();
    const name = await promptDialog({ title: 'Rename workspace', value: ws(id).name, ok: 'Rename' });
    if (name) await api.renameWorkspace(id, name);
    return;
  }
  if ((id = pick('data-ws-del'))) {
    e.stopPropagation();
    if (confirm(`Delete the workspace “${ws(id).name}”? Your notes stay as they are.`)) await api.deleteWorkspace(id);
    return;
  }
  if ((id = pick('data-ws'))) {
    if (id === workspaces.active) return;
    await api.switchWorkspace(id);
    toast(`Switched to “${ws(id).name}”`);
  }
});

$('btn-save-ws').addEventListener('click', async () => {
  const name = await promptDialog({ title: 'Save current layout as', value: workspaces.list.length ? '' : 'Work', ok: 'Save' });
  if (!name) return;
  await api.saveWorkspace(name);
  toast(`Saved workspace “${name}”`);
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
    return `<button class="cdot${state.color === k ? ' on' : ''}" data-color="${k}" title="${n.name}" style="background:${n.swatch}"></button>`;
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
const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
function ago(t) {
  const s = (t - Date.now()) / 1000;
  const a = Math.abs(s);
  if (a < 45) return 'just now';
  if (a < 3600) return rtf.format(Math.round(s / 60), 'minute');
  if (a < 86400) return rtf.format(Math.round(s / 3600), 'hour');
  if (a < 7 * 86400) return rtf.format(Math.round(s / 86400), 'day');
  const d = new Date(t);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: sameYear ? undefined : 'numeric' });
}

function reminderLabel(r) {
  const d = new Date(r.snoozeAt || r.at);
  const today = d.toDateString() === new Date().toDateString();
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return r.pending ? 'Due' : today ? time : `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${time}`;
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

function highlight(text, terms) {
  let html = escapeHtml(text);
  for (const t of terms) {
    const re = new RegExp(escapeHtml(t).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    html = html.replace(re, (m) => `<mark>${m}</mark>`);
  }
  return html;
}

function snippet(n, terms) {
  // Show the excerpt where the words were found: the note's text, or else a picture's text.
  const sources = [[n.text, ''], [n.imageText, 'In a picture: ']];
  const [src, label] = sources.find(([s]) => terms.some(t => String(s || '').toLowerCase().includes(t))) || sources[0];
  const text = String(src || '').replace(/\n{2,}/g, '\n');
  const lower = text.toLowerCase();
  const idx = Math.min(...terms.map(t => { const i = lower.indexOf(t); return i < 0 ? Infinity : i; }));
  const start = idx === Infinity || idx < 60 ? 0 : text.lastIndexOf(' ', idx - 40) + 1;
  const body = (start > 0 ? '…' : '') + text.slice(start, start + 240) + (text.length > start + 240 ? '…' : '');
  return `<div class="snippet">${label ? `<i>${label}</i>` : ''}${highlight(body, terms)}</div>`;
}

function cardHtml(n, pq) {
  const c = (palette.notes[n.color] || palette.notes.yellow)[theme];
  const font = (palette.fonts.find(f => f.id === n.font) || palette.fonts[0]).css.replace(/"/g, "'");
  const style = `--n-bg:${c.bg};--n-bar:${c.bar};--n-text:${c.text};--n-accent:${c.accent};--n-font:${font}`;
  let content;
  if (n.privateLocked) content = `<div class="locked-card">${icon('shield', { size: 18 })}<span>Private note — locked</span></div>`;
  else if (pq.words.length) content = snippet(n, pq.words);
  else {
    const html = sanitizeHtml(n.html, { mode: 'stored' });
    const short = n.text.split('\n').length < 6 && !/<img\b/.test(html);
    content = `<div class="preview${short ? ' short' : ''}">${html.trim() ? html : '<span class="empty-note">Empty note</span>'}</div>`;
  }
  const badges = [];
  if (n.private) badges.push(`<span class="badge" title="Private">${icon('shield', { size: 13 })}</span>`);
  if (n.pinned && !n.trashed) badges.push(`<span class="badge" title="Kept on top">${icon('pinFilled', { size: 13 })}</span>`);
  if (n.reminder && !n.trashed) badges.push(`<span class="badge" title="Reminder">${icon('bell', { size: 13 })}${escapeHtml(reminderLabel(n.reminder))}</span>`);
  if (n.tasks.total) badges.push(`<span class="badge" title="Checklist progress">${icon('checklist', { size: 13 })}${n.tasks.done}/${n.tasks.total}</span>`);
  if (n.locked) badges.push(`<span class="badge" title="Locked">${icon('lock', { size: 13 })}</span>`);
  if (!n.open && !n.trashed) badges.push(`<span class="badge" title="Not on the desktop">${icon('eyeOff', { size: 13 })}</span>`);
  for (const t of n.tags.slice(0, 3)) badges.push(`<span class="chip-tag">#${escapeHtml(t)}</span>`);
  const when = n.trashed ? `Deleted ${ago(n.trashedAt || n.updatedAt)}` : ago(n.updatedAt);
  const actions = n.trashed
    ? `<button class="card-btn" data-act="restore" title="Restore">${icon('restore', { size: 16 })}</button>
       <button class="card-btn danger" data-act="purge" title="Delete forever">${icon('trash', { size: 16 })}</button>`
    : `<button class="card-btn" data-act="${n.open ? 'hide' : 'open'}" title="${n.open ? 'Hide from desktop' : 'Show on desktop'}">${icon(n.open ? 'eyeOff' : 'eye', { size: 16 })}</button>
       <button class="card-btn danger" data-act="trash" title="Delete">${icon('trash', { size: 16 })}</button>
       <button class="card-btn" data-act="menu" title="More">${icon('more', { size: 16 })}</button>`;
  return `<div class="note-card${n.open ? '' : ' closed'}${n.trashed ? ' trashed' : ''}" tabindex="0" data-id="${n.id}" style="${style}">
    <div class="card-body">${content}</div>
    <div class="card-meta">${badges.join('')}<span class="grow"></span><span>${escapeHtml(when)}</span></div>
    <div class="card-actions">${actions}</div>
  </div>`;
}

function render() {
  if (state.view === 'tasks') { renderTasks(); return; }
  const { list, pq } = filtered();
  const focusedId = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.id : null;
  $('list').innerHTML = list.map(n => cardHtml(n, pq)).join('');
  if (focusedId) { const el = $('list').querySelector(`[data-id="${focusedId}"]`); if (el) el.focus({ preventScroll: true }); }
  $('view-title').textContent = VIEW_TITLES[state.view] || 'All notes';

  const isEmpty = !list.length;
  $('list').hidden = isEmpty;
  $('empty').hidden = !isEmpty;
  if (isEmpty) {
    let title = 'No notes yet';
    let sub = 'Create a note and it will show up here.';
    let action = 'New note';
    if (state.query) { title = 'No matches'; sub = `Nothing matches “${state.query}”.`; action = 'Clear search'; }
    else if (state.view === 'trash') { title = 'Trash is empty'; sub = 'Deleted notes stay here for 30 days.'; action = 'Back to all notes'; }
    else if (state.view !== 'all' || state.color) {
      title = 'Nothing here';
      sub = { open: 'No notes are on the desktop right now.', pinned: 'No notes are kept on top.', reminders: 'No notes have reminders.' }[state.view] || 'No notes in this color.';
      action = 'Show all notes';
    }
    $('empty-title').textContent = title;
    $('empty-sub').textContent = sub;
    $('empty-action').textContent = action;
  }
  const inTrash = state.view === 'trash';
  $('btn-empty-trash').hidden = !(inTrash && notes.some(n => n.trashed));
  $('btn-show-all').hidden = inTrash;
  $('btn-hide-all').hidden = inTrash;
  $('status').textContent = `${list.length} note${list.length === 1 ? '' : 's'}`;
}

$('list').addEventListener('click', async (e) => {
  const card = e.target.closest('.note-card');
  if (!card) return;
  const n = notes.find(x => x.id === card.dataset.id);
  const btn = e.target.closest('[data-act]');
  if (btn) { e.stopPropagation(); await cardAction(btn.dataset.act, n, btn); return; }
  if (!n.trashed) api.open(n.id);
});

$('list').addEventListener('contextmenu', (e) => {
  const card = e.target.closest('.note-card');
  if (!card) return;
  e.preventDefault();
  openCardMenu(notes.find(x => x.id === card.dataset.id), { x: e.clientX, y: e.clientY });
});

$('list').addEventListener('keydown', (e) => {
  const card = e.target.closest('.note-card');
  if (!card) return;
  const n = notes.find(x => x.id === card.dataset.id);
  if (e.key === 'Enter') { e.preventDefault(); if (!n.trashed) api.open(n.id); }
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
    case 'trash': await api.trashNote(n.id); toast('Moved to Trash'); break;
    case 'restore': await api.restore(n.id); toast('Restored'); break;
    case 'purge':
      if (!confirm('Delete this note forever? This can\'t be undone.')) return;
      await api.purge(n.id);
      break;
    case 'menu': {
      const r = anchor.getBoundingClientRect();
      openCardMenu(n, { x: r.right, y: r.bottom + 4, alignRight: true });
      break;
    }
    case 'duplicate': await api.duplicateNote(n.id); break;
    case 'pin': await api.setPinned(n.id, !n.pinned); break;
    case 'history': if (!(await api.openHistory(n.id))) toast('Private notes don’t keep version history'); break;
    case 'private': await togglePrivate(n); break;
    default: break;
  }
}

async function togglePrivate(n) {
  vaultState = await api.vaultStatus();
  if (!vaultState.configured) { showSettings(); $('privacy').scrollIntoView(); toast('First choose a password for private notes'); return; }
  if (!vaultState.unlocked && !(await unlockPrompt())) return;
  const r = await api.setPrivate(!n.private, n.id);
  if (r && r.ok) toast(n.private ? 'No longer private' : 'Private: encrypted and hidden until unlocked');
}

async function unlockPrompt() {
  const pw = await promptDialog({ title: 'Password for private notes', ok: 'Unlock', password: true });
  if (!pw) return false;
  if (await api.vaultUnlock(pw)) return true;
  toast('That password isn’t right');
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
      <button class="menu-item" data-mact="restore">${icon('restore', { size: 16 })}<span>Restore</span></button>
      <div class="menu-sep"></div>
      <button class="menu-item danger" data-mact="purge">${icon('trash', { size: 16 })}<span>Delete forever</span></button>`;
  } else {
    html = `
      <div class="swatch-row">${palette.order.map(k => `<button data-mcolor="${k}" class="${k === n.color ? 'on' : ''}" title="${palette.notes[k].name}" style="background:${palette.notes[k].swatch}"></button>`).join('')}</div>
      <div class="menu-sep"></div>
      <button class="menu-item" data-mact="open">${icon('external', { size: 16 })}<span>${n.open ? 'Bring to front' : 'Show on desktop'}</span></button>
      ${n.open ? `<button class="menu-item" data-mact="hide">${icon('eyeOff', { size: 16 })}<span>Hide from desktop</span></button>` : ''}
      <button class="menu-item" data-mact="pin">${icon(n.pinned ? 'pinFilled' : 'pin', { size: 16 })}<span>${n.pinned ? 'Stop keeping on top' : 'Keep on top'}</span></button>
      <button class="menu-item" data-mact="duplicate">${icon('copy', { size: 16 })}<span>Duplicate</span></button>
      ${n.private ? '' : `<button class="menu-item" data-mact="history">${icon('history', { size: 16 })}<span>Version history…</span></button>`}
      <button class="menu-item" data-mact="private">${icon('shield', { size: 16 })}<span>${n.private ? 'Make not private' : 'Make private…'}</span></button>
      <div class="menu-sep"></div>
      <button class="menu-item danger" data-mact="trash">${icon('trash', { size: 16 })}<span>Delete</span></button>`;
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
    <button class="box" title="${t.checked ? 'Mark as not done' : 'Mark as done'}">${icon('check', { size: 12 })}</button>
    <div class="txt" title="Show in note">${sanitizeHtml(t.html, { mode: 'stored' }) || escapeHtml(t.text) || '<i>Empty item</i>'}${showNote ? `<div class="from">${escapeHtml(n.title || 'Untitled note')}</div>` : ''}</div>
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
    const buckets = [['Overdue', 'late'], ['Today', ''], ['Tomorrow', ''], ['Next 7 days', ''], ['Later', ''], ['No date', '']].map(([label, cls]) => ({ label, cls, rows: [] }));
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
      html += `<div class="task-section ${b.cls}">${b.label}</div><div class="task-group">${b.rows.map(({ n, t }) => taskRow(n, t, { showNote: true })).join('')}</div>`;
    }
  } else {
    groups.sort((a, b) => b.n.updatedAt - a.n.updatedAt);
    for (const { n, items, all } of groups) {
      const done = all.filter(t => t.checked).length;
      html += `<div class="task-group">
        <div class="task-head"><span class="dot" style="background:${swatch(n.color)}"></span><span class="t">${escapeHtml(n.title || 'Untitled note')}</span><span class="n">${done}/${all.length}</span>
          <button class="open-note" data-open="${n.id}" title="Open note">${icon('external', { size: 15 })}</button></div>
        ${items.map(t => taskRow(n, t)).join('')}
      </div>`;
    }
  }
  $('tasks').innerHTML = html;
  $('tasks').hidden = !html;
  $('tasks-empty').hidden = !!html;
  $('tasks-empty-title').textContent = q ? 'No matching tasks' : showDone ? 'No checklist items yet' : 'All done 🎉';
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
const NOTE_SHORTCUTS = [
  ['New note', 'Ctrl+N'], ['Close note', 'Ctrl+W'], ['Delete note', 'Ctrl+D'], ['All notes', 'Ctrl+H'],
  ['Bold / italic / underline', 'Ctrl+B / I / U'], ['Strikethrough', 'Ctrl+T'], ['Inline code', 'Ctrl+E'],
  ['Bulleted list', 'Ctrl+Shift+L'], ['Numbered list', 'Ctrl+Shift+O'], ['Checklist', 'Ctrl+Shift+C'],
  ['Move a list item up / down', 'Alt+Shift+↑ / ↓'], ['Indent / outdent an item', 'Tab / Shift+Tab'],
  ['Title / heading / subheading', 'Ctrl+Alt+1 / 2 / 3'], ['Normal text', 'Ctrl+Alt+0'],
  ['Link', 'Ctrl+K'], ['Clear formatting', 'Ctrl+\\'], ['Insert date & time', 'Ctrl+;'],
  ['Find in note', 'Ctrl+F'], ['Edit HTML source', 'Ctrl+Shift+H'], ['Paste as plain text', 'Ctrl+Shift+V'],
  ['Keep on top', 'Ctrl+Shift+P'], ['Roll up / unroll', 'Ctrl+Shift+R or double-click title bar'],
  ['Zoom in / out / reset', 'Ctrl+= / Ctrl+- / Ctrl+0'], ['Print', 'Ctrl+P'], ['Open a link or #tag', 'Ctrl+Click']
];
const MD_SHORTCUTS = [
  ['Command menu (templates, table, snip…)', '/'], ['Tag a note', '#word'], ['Link to another note', '[['],
  ['Due date on a checklist item', '@fri  @tomorrow  @10/20'],
  ['Title, heading, subheading', '# ␣  ## ␣  ### ␣'], ['Bulleted list', '- ␣'], ['Numbered list', '1. ␣'],
  ['Checklist item (ticked)', '[] ␣   [x] ␣'], ['Quote', '> ␣'], ['Code block', '``` Enter'], ['Divider', '--- Enter'],
  ['Bold', '**text**'], ['Italic', '*text*'], ['Strikethrough', '~~text~~'], ['Inline code', '`code`'], ['Highlight', '==text==']
];
const SEARCH_TIPS = [
  ['Notes with a tag', '#work'], ['Unfinished checklists', 'has:unchecked'], ['Notes with pictures', 'has:image'],
  ['Edited recently', 'edited:today  edited:week  edited:3d'], ['Tasks due soon', 'due:today  due:week  due:overdue'],
  ['On the desktop / on top', 'is:open  is:pinned'], ['By color', 'color:blue'], ['Exact phrase', '"call back"']
];

function buildSettings(s) {
  $('set-color').innerHTML = palette.order.map(k => `<button data-v="${k}" title="${palette.notes[k].name}" style="background:${palette.notes[k].swatch}"></button>`).join('') +
    '<button class="random" data-v="random" title="Random color"></button>';
  $('set-font').innerHTML = palette.fonts.map(f => `<option value="${f.id}">${f.name}</option>`).join('');
  const rows = (list) => list.map(([a, b]) => `<div>${escapeHtml(a)}</div><div class="k">${b.split(' / ').map(x => `<kbd>${escapeHtml(x)}</kbd>`).join(' ')}</div>`).join('');
  $('shortcuts').innerHTML = rows(NOTE_SHORTCUTS);
  $('md-shortcuts').innerHTML = MD_SHORTCUTS.map(([a, b]) => `<div>${escapeHtml(a)}</div><div class="k"><kbd>${escapeHtml(b)}</kbd></div>`).join('');
  $('search-tips').innerHTML = SEARCH_TIPS.map(([a, b]) => `<div>${escapeHtml(a)}</div><div class="k"><kbd>${escapeHtml(b)}</kbd></div>`).join('');
  $('data-dir').textContent = s.dataDir;
  $('about').innerHTML = `Stickies ${escapeHtml(s.version)}<br>Your notes are stored only on this computer.`;
  syncSettingsUi();
}

const SWITCHES = ['launchAtLogin', 'showInTaskbar', 'spellcheck', 'confirmDelete', 'snapToEdges', 'opaqueOnHover', 'sinkTicked', 'ocrImages', 'autoWorkspace'];

function syncSettingsUi() {
  for (const b of $('set-theme').children) b.classList.toggle('on', b.dataset.v === settings.theme);
  for (const b of $('set-color').children) b.classList.toggle('on', b.dataset.v === settings.defaultColor);
  for (const b of $('set-snipTarget').children) b.classList.toggle('on', b.dataset.v === (settings.snipTarget || 'new'));
  const tbMode = settings.toolbarMode || 'popup';
  for (const b of $('set-toolbarMode').children) b.classList.toggle('on', b.dataset.v === tbMode);
  $('tb-mode-sub').textContent = {
    popup: 'Appears when you select text or point at the bottom of a note — notes never change size',
    editing: 'Sits under the text while you’re working in a note',
    always: 'Always visible, so a note’s text area never changes size'
  }[tbMode];
  $('set-font').value = settings.defaultFont;
  $('set-size').value = settings.fontSize;
  $('set-size-value').textContent = `${settings.fontSize}px`;
  for (const k of SWITCHES) $(`set-${k}`).checked = settings[k] !== false && !!settings[k];
  for (const input of document.querySelectorAll('.hk')) {
    if (!input.classList.contains('capturing')) input.value = prettyAccel(settings.hotkeys[input.dataset.hk]);
  }
}

async function update(patch) {
  const res = await api.updateSettings(patch);
  settings = res.settings;
  syncSettingsUi();
  return res;
}

$('set-theme').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) update({ theme: b.dataset.v }); });
$('set-snipTarget').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) update({ snipTarget: b.dataset.v }); });
$('set-toolbarMode').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) update({ toolbarMode: b.dataset.v }); });
$('set-color').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) update({ defaultColor: b.dataset.v }); });
$('set-font').addEventListener('change', (e) => update({ defaultFont: e.target.value }));
$('set-size').addEventListener('input', (e) => { $('set-size-value').textContent = `${e.target.value}px`; });
$('set-size').addEventListener('change', (e) => update({ fontSize: Number(e.target.value) }));
for (const k of SWITCHES) $(`set-${k}`).addEventListener('change', (e) => update({ [k]: e.target.checked }));

$('act-backup').addEventListener('click', async () => {
  const r = await api.exportBackup();
  if (r && r.ok) toast(`Backed up ${r.count} note${r.count === 1 ? '' : 's'}`);
});
$('act-restore').addEventListener('click', async () => {
  const r = await api.importBackup();
  if (!r) return;
  if (r.ok) {
    const extra = r.skippedPrivate ? ` · ${r.skippedPrivate} private note${r.skippedPrivate === 1 ? '' : 's'} used a different password and were skipped` : '';
    toast((r.added ? `Restored ${r.added} note${r.added === 1 ? '' : 's'}` : 'All of those notes are already here') + extra);
  } else if (r.error) toast(r.error);
});
$('act-import').addEventListener('click', async () => {
  const r = await api.importFiles();
  if (r && r.added) toast(`Imported ${r.added} file${r.added === 1 ? '' : 's'}`);
});
$('act-folder').addEventListener('click', () => api.openDataFolder());

// ----- private notes -----
function renderPrivacy() {
  const v = vaultState;
  const card = $('privacy-card');
  if (!v.configured) {
    card.innerHTML = `
      <div class="form-row">
        <div>Lock individual notes behind a password. Their words and pictures are encrypted on this PC, and they stay out of search, previews and exports until you unlock them.</div>
        <input type="password" id="pv-pw" placeholder="Choose a password" autocomplete="new-password">
        <input type="password" id="pv-pw2" placeholder="Type it again" autocomplete="new-password">
        <input type="text" id="pv-hint" placeholder="Password hint (optional — anyone can see it)">
        <div class="warn">If you forget this password, private notes can’t be recovered.</div>
        <div class="inline"><button class="btn primary" id="pv-create">Set up private notes</button></div>
      </div>`;
    $('pv-create').addEventListener('click', async () => {
      const pw = $('pv-pw').value;
      if (pw.length < 4) { toast('Use at least 4 characters'); return; }
      if (pw !== $('pv-pw2').value) { toast('The passwords don’t match'); return; }
      const r = await api.vaultSetup(pw, $('pv-hint').value);
      if (r.ok) { vaultState = r.status; renderPrivacy(); toast('Private notes are ready — choose “Make private…” in a note’s menu'); }
      else toast(r.error);
    });
    return;
  }
  const minutes = settings.autoLockMinutes ?? 5;
  card.innerHTML = `
    <div class="row">
      <div class="row-label">${icon('shield', { size: 17 })}<div><div>Private notes are <span class="status-pill${v.unlocked ? ' ok' : ''}">${v.unlocked ? 'Unlocked' : 'Locked'}</span></div><div class="sub">Make a note private from its ⋯ menu</div></div></div>
      <button class="btn" id="pv-toggle">${v.unlocked ? 'Lock now' : 'Unlock…'}</button>
    </div>
    <div class="row">
      <div class="row-label">${icon('clock', { size: 17 })}<div><div>Lock automatically</div><div class="sub">Also locks when Windows locks or sleeps</div></div></div>
      <select id="pv-auto">${[[0, 'Never'], [1, 'After 1 minute'], [5, 'After 5 minutes'], [15, 'After 15 minutes'], [30, 'After 30 minutes'], [60, 'After 1 hour']].map(([m, l]) => `<option value="${m}"${m === minutes ? ' selected' : ''}>${l}</option>`).join('')}</select>
    </div>
    <label class="row">
      <div class="row-label">${icon('fingerprint', { size: 17 })}<div><div>Unlock with Windows Hello</div><div class="sub">${v.helloAvailable ? 'Use your face, fingerprint or PIN instead of the password' : 'Windows Hello isn’t set up on this PC'}</div></div></div>
      <input type="checkbox" class="switch" id="pv-hello" ${v.hello ? 'checked' : ''} ${v.helloAvailable ? '' : 'disabled'}>
    </label>
    ${v.unlocked ? `
    <div class="form-row">
      <div>Change password</div>
      <input type="password" id="pv-new" placeholder="New password" autocomplete="new-password">
      <input type="password" id="pv-new2" placeholder="Type it again" autocomplete="new-password">
      <input type="text" id="pv-newhint" placeholder="New hint (optional)" value="${escapeHtml(v.hint || '')}">
      <div class="inline"><button class="btn" id="pv-change">Change password</button></div>
    </div>` : ''}`;
  $('pv-toggle').addEventListener('click', async () => {
    if (vaultState.unlocked) { await api.vaultLock(); toast('Private notes locked'); }
    else if (await unlockPrompt()) toast('Private notes unlocked');
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
      if (pw.length < 4) { toast('Use at least 4 characters'); return; }
      if (pw !== $('pv-new2').value) { toast('The passwords don’t match'); return; }
      const r = await api.vaultChangePassword(pw, $('pv-newhint').value);
      toast(r.ok ? 'Password changed' : r.error);
      if (r.ok) { vaultState = r.status; renderPrivacy(); }
    });
  }
}

// ----- templates -----
function renderTemplates() {
  $('templates-card').innerHTML = templates.map(t => `
    <div class="tpl-row" data-tpl="${t.id}">
      <span class="dot" style="background:${swatch(t.color)}"></span><span class="name">${escapeHtml(t.name)}</span>
      <button class="mini" data-tpl-act="new">New note</button>
      <button class="mini" data-tpl-act="rename">Rename</button>
      <button class="mini danger" data-tpl-act="delete">Delete</button>
    </div>`).join('') + `<div class="row note-row">In any note: ⋯ → <b>Save as template…</b> to add one, or type <b>/</b> to insert one. Placeholders: {{date}} {{time}} {{weekday}} {{week}} {{tomorrow}} {{cursor}}</div>`;
}

$('templates-card').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-tpl-act]');
  if (!b) return;
  const id = b.closest('[data-tpl]').dataset.tpl;
  const t = templates.find(x => x.id === id);
  if (b.dataset.tplAct === 'new') api.newFromTemplate(id);
  else if (b.dataset.tplAct === 'rename') {
    const name = await promptDialog({ title: 'Rename template', value: t.name, ok: 'Rename' });
    if (name) await api.saveTemplate({ id, name });
  } else if (b.dataset.tplAct === 'delete') {
    if (confirm(`Delete the template “${t.name}”?`)) await api.deleteTemplate(id);
  }
});

// ----- global hotkey capture -----
function prettyAccel(acc) {
  return acc ? acc.replace(/CommandOrControl|CmdOrCtrl/g, 'Ctrl').replace(/\+/g, ' + ') : 'Off';
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
  if (e.ctrlKey) mods.push('CommandOrControl');
  if (e.altKey) mods.push('Alt');
  if (e.shiftKey) mods.push('Shift');
  if (e.metaKey) mods.push('Super');
  if (!mods.length && !/^F\d+$/.test(key)) return 'needs-mod';
  return [...mods, key].join('+');
}

for (const input of document.querySelectorAll('.hk')) {
  input.addEventListener('focus', () => { input.classList.add('capturing'); input.value = 'Press keys…'; });
  input.addEventListener('blur', () => { input.classList.remove('capturing'); syncSettingsUi(); });
  input.addEventListener('keydown', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'Escape') { input.blur(); return; }
    let acc;
    if ((e.key === 'Backspace' || e.key === 'Delete') && !e.ctrlKey && !e.altKey) acc = '';
    else {
      acc = accelFromEvent(e);
      if (acc === null) return;
      if (acc === 'needs-mod') { input.value = 'Add Ctrl, Alt or Shift'; return; }
    }
    const res = await update({ hotkeys: { [input.dataset.hk]: acc } });
    input.blur();
    showHotkeyStatus(res.hotkeyResults);
    const st = res.hotkeyResults && res.hotkeyResults[input.dataset.hk];
    if (st === 'taken') toast('That shortcut is used by another app');
    else if (st === 'invalid') toast('That key combination isn\'t supported');
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
    el.title = st === 'ok' ? 'Active' : st === 'taken' ? 'In use by another app' : st === 'invalid' ? 'Not supported' : 'Off';
  }
}

// ---------- small dialogs ----------
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
