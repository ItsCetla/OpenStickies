import { applyTranslations } from '../shared/i18n.js';
import { escapeHtml } from '../shared/sanitize.js';
import { t } from '../shared/i18n.js';

applyTranslations();

const api = window.stickies;
const $ = (id) => document.getElementById(id);
let choice = 'new';
let start = null;
let rect = null;

init();

async function init() {
  const info = await api.snipInfo();
  if (!info) { api.snipCancel(); return; }
  $('shot').src = info.image;
  choice = info.target === 'note' ? 'note' : (info.target === 'last' && info.lastTitle ? 'last' : 'new');
  const opts = info.target === 'note'
    ? [['note', t('snip.addTo', { title: info.lastTitle })]]
    : [['new', t('snip.newNote')], ...(info.lastTitle ? [['last', t('snip.addTo', { title: info.lastTitle })]] : [])];
  $('target').innerHTML = opts.map(([v, label]) => `<button data-v="${v}" class="${v === choice ? 'on' : ''}" title="${escapeHtml(label)}">${escapeHtml(label)}</button>`).join('');
  window.focus();
}

$('target').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  choice = b.dataset.v;
  for (const x of $('target').children) x.classList.toggle('on', x === b);
});
$('cancel').addEventListener('click', () => api.snipCancel());
$('full').addEventListener('click', () => api.snipDone({ x: 0, y: 0, width: innerWidth, height: innerHeight }, choice));

function draw() {
  const sel = $('sel');
  const size = $('size');
  if (!rect) { sel.hidden = true; size.hidden = true; $('dim').hidden = false; return; }
  $('dim').hidden = true;
  Object.assign(sel.style, { left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.width}px`, height: `${rect.height}px` });
  sel.hidden = false;
  size.textContent = `${Math.round(rect.width * devicePixelRatio)} × ${Math.round(rect.height * devicePixelRatio)}`;
  size.style.left = `${rect.x}px`;
  size.style.top = `${rect.y + rect.height + 6 > innerHeight - 24 ? rect.y - 24 : rect.y + rect.height + 6}px`;
  size.hidden = false;
}

window.addEventListener('mousedown', (e) => {
  if (e.target.closest('.bar')) return;
  if (e.button === 2) { api.snipCancel(); return; }
  if (e.button !== 0) return;
  start = { x: e.clientX, y: e.clientY };
  rect = null;
  $('bar').style.opacity = '0.25';
  draw();
});

window.addEventListener('mousemove', (e) => {
  if (!start) return;
  const x = Math.max(0, Math.min(start.x, e.clientX));
  const y = Math.max(0, Math.min(start.y, e.clientY));
  rect = { x, y, width: Math.min(innerWidth, Math.max(start.x, e.clientX)) - x, height: Math.min(innerHeight, Math.max(start.y, e.clientY)) - y };
  draw();
});

window.addEventListener('mouseup', () => {
  if (!start) return;
  start = null;
  $('bar').style.opacity = '';
  if (rect && rect.width > 3 && rect.height > 3) api.snipDone(rect, choice);
  else { rect = null; draw(); }
});

window.addEventListener('contextmenu', (e) => e.preventDefault());
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') api.snipCancel();
  else if (e.key === 'Enter' && rect) api.snipDone(rect, choice);
});
