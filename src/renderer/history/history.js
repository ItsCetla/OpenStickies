import { applyTranslations } from '../shared/i18n.js';
import { hydrateIcons } from '../shared/icons.js';
import { t, tp, lang } from '../shared/i18n.js';
import { sanitizeHtml, escapeHtml } from '../shared/sanitize.js';
import palette from '../shared/colors.json' with { type: 'json' };
import { hydrateFileChips } from '../shared/file-icons.js';

const api = window.stickies;
const $ = (id) => document.getElementById(id);
let data = null;        // { note, versions: [{ t, title, words, tab }] (newest first), theme }
let selected = 'current';
let mode = 'preview';
const htmlCache = new Map();

document.documentElement.dataset.platform = api.platform || '';
applyTranslations();
hydrateIcons();
load();

async function load() {
  data = await api.historyList();
  document.documentElement.dataset.theme = data.theme;
  if (!data.note) { $('doc').textContent = t('history.gone'); return; }
  const c = (palette.notes[data.note.color] || palette.notes.yellow)[data.theme];
  const doc = $('doc');
  doc.style.setProperty('--n-bg', c.bg);
  doc.style.setProperty('--n-bar', c.bar);
  doc.style.setProperty('--n-text', c.text);
  doc.style.setProperty('--n-accent', c.accent);
  $('note-title').textContent = data.note.title || t('note.untitled');
  htmlCache.set('current', data.note.html);
  renderList();
  show(selected);
}

function fmt(t, opts) { return new Date(t).toLocaleString(lang(), opts); }

function renderList() {
  const rows = [];
  rows.push(`<div class="day">${escapeHtml(t('history.now'))}</div><button class="ver${selected === 'current' ? ' on' : ''}" data-t="current">
    <span class="w1">${escapeHtml(t('history.currentVersion'))} <span class="tagnow">${escapeHtml(t('history.live'))}</span></span><span class="w2">${escapeHtml(data.note.title || t('note.untitled'))}</span></button>`);
  let lastDay = '';
  const tabTitles = new Map((data.note.tabs || []).map(x => [x.id, x.title]));
  for (const v of data.versions) {
    const day = fmt(v.t, { weekday: 'long', month: 'long', day: 'numeric' });
    if (day !== lastDay) { rows.push(`<div class="day">${escapeHtml(day)}</div>`); lastDay = day; }
    rows.push(`<button class="ver${selected === v.t ? ' on' : ''}" data-t="${v.t}">
      <span class="w1">${escapeHtml(fmt(v.t, { hour: 'numeric', minute: '2-digit' }))}</span>
      <span class="w2">${escapeHtml(v.title || t('history.untitled'))} · ${escapeHtml(tp('history.words', v.words))}${tabLabel(tabTitles, v.tab)}</span></button>`);
  }
  if (!data.versions.length) rows.push(`<div class="none">${escapeHtml(t('history.none'))}</div>`);
  $('versions').innerHTML = rows.join('');
}

// Which tab a version came from, so restoring one into another tab is no surprise.
function tabLabel(tabTitles, tab) {
  if (!tab || !tabTitles.has(tab)) return '';
  return ` · ${escapeHtml(t('history.inTab', { tab: tabTitles.get(tab) || t('note.untitled') }))}`;
}

async function htmlOf(key) {
  if (htmlCache.has(key)) return htmlCache.get(key);
  const html = await api.historyGet(key);
  htmlCache.set(key, html || '');
  return html || '';
}

async function show(key) {
  selected = key;
  for (const b of document.querySelectorAll('.ver')) b.classList.toggle('on', String(b.dataset.t) === String(key));
  $('when').textContent = key === 'current' ? t('history.currentVersion') : fmt(key, { dateStyle: 'full', timeStyle: 'short' });
  $('restore').disabled = key === 'current';
  const html = await htmlOf(key);
  const doc = $('doc');
  $('legend').hidden = mode !== 'changes';
  if (mode === 'preview') {
    doc.classList.remove('diff');
    doc.innerHTML = sanitizeHtml(html, { mode: 'stored' });
    hydrateFileChips(doc);
    return;
  }
  // Changes: compare with the version before this one.
  const idx = key === 'current' ? -1 : data.versions.findIndex(v => v.t === key);
  const older = data.versions[idx + 1];
  const before = older ? await htmlOf(older.t) : '';
  doc.classList.add('diff');
  doc.innerHTML = older ? diffHtml(textOf(before), textOf(html)) : `<i>${escapeHtml(t('history.oldest'))}</i>\n\n${escapeHtml(textOf(html))}`;
}

function textOf(html) {
  const holder = document.createElement('div');
  holder.style.cssText = 'position:fixed;left:-9999px;top:0;width:600px;white-space:pre-wrap';
  holder.innerHTML = sanitizeHtml(html, { mode: 'stored' });
  for (const li of holder.querySelectorAll('ul.checklist > li')) li.prepend(li.classList.contains('checked') ? '☑ ' : '☐ ');
  document.body.appendChild(holder);
  const text = holder.innerText;
  holder.remove();
  return text.replace(/\n{3,}/g, '\n\n').trim();
}

// Word-level diff (longest common subsequence over words and the spaces between them).
function diffHtml(a, b) {
  const A = a.split(/(\s+)/).filter(Boolean);
  const B = b.split(/(\s+)/).filter(Boolean);
  if (A.length * B.length > 9e6) return `<i>${escapeHtml(t('history.tooMany'))}</i>\n\n${escapeHtml(b)}`;
  const n = A.length;
  const m = B.length;
  const dp = new Uint32Array((n + 1) * (m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * (m + 1) + j] = A[i] === B[j] ? dp[(i + 1) * (m + 1) + j + 1] + 1 : Math.max(dp[(i + 1) * (m + 1) + j], dp[i * (m + 1) + j + 1]);
    }
  }
  const out = [];
  let i = 0;
  let j = 0;
  const push = (cls, s) => {
    const last = out[out.length - 1];
    if (last && last.cls === cls) last.s += s; else out.push({ cls, s });
  };
  while (i < n && j < m) {
    if (A[i] === B[j]) { push('', A[i]); i++; j++; }
    else if (dp[(i + 1) * (m + 1) + j] >= dp[i * (m + 1) + j + 1]) push('del', A[i++]);
    else push('ins', B[j++]);
  }
  while (i < n) push('del', A[i++]);
  while (j < m) push('ins', B[j++]);
  return out.map(p => (p.cls ? `<span class="${p.cls}">${escapeHtml(p.s)}</span>` : escapeHtml(p.s))).join('');
}

$('versions').addEventListener('click', (e) => {
  const b = e.target.closest('.ver');
  if (b) show(b.dataset.t === 'current' ? 'current' : Number(b.dataset.t));
});

$('mode').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  mode = b.dataset.v;
  for (const x of $('mode').children) x.classList.toggle('on', x === b);
  show(selected);
});

$('restore').addEventListener('click', async () => {
  if (selected === 'current') return;
  const when = fmt(selected, { dateStyle: 'medium', timeStyle: 'short' });
  if (!confirm(t('history.restoreConfirm', { when }))) return;
  if (await api.historyRestore(selected)) {
    toast(t('history.restored'));
    htmlCache.clear();
    selected = 'current';
    await load();
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
  e.preventDefault();
  const keys = ['current', ...data.versions.map(v => v.t)];
  const i = keys.indexOf(selected) + (e.key === 'ArrowDown' ? 1 : -1);
  if (keys[i] !== undefined) { show(keys[i]); document.querySelector('.ver.on')?.scrollIntoView({ block: 'nearest' }); }
});

let toastTimer;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
}
