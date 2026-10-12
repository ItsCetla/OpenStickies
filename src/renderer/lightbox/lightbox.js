// Full-screen image viewer opened by double-clicking an image in a note.
import { applyTranslations } from '../shared/i18n.js';
import { hydrateIcons } from '../shared/icons.js';

applyTranslations();

const api = window.stickies;
const $ = (id) => document.getElementById(id);
const stage = $('stage');
const img = $('img');

const MIN = 0.05;
const MAX = 16;
const MARGIN = 48;
const BAR_SPACE = 80;

let url = '';
let scale = 1;
let x = 0;
let y = 0;
let mode = 'fit'; // 'fit' follows the window size; 'free' once the user zooms or pans

hydrateIcons();

function fitScale() {
  const w = img.naturalWidth || 1;
  const h = img.naturalHeight || 1;
  return Math.min(1, (innerWidth - MARGIN * 2) / w, (innerHeight - MARGIN - BAR_SPACE) / h);
}

function apply() {
  // The bar sits at the bottom, so a fitted image is centered in the space above it.
  const lift = mode === 'fit' ? -(BAR_SPACE - MARGIN) / 2 : 0;
  img.style.transform = `translate(-50%, -50%) translate(${x}px, ${y + lift}px) scale(${scale})`;
  $('pct').textContent = `${Math.round(scale * 100)}%`;
  $('fit').classList.toggle('on', mode === 'fit');
  $('actual').classList.toggle('on', mode !== 'fit' && Math.abs(scale - 1) < 0.001);
  img.classList.toggle('pannable', img.naturalWidth * scale > innerWidth || img.naturalHeight * scale > innerHeight);
  img.classList.toggle('pixelated', scale >= 3);
}

function fit() {
  mode = 'fit';
  scale = fitScale();
  x = 0;
  y = 0;
  apply();
}

function actual() {
  mode = 'free';
  scale = 1;
  x = 0;
  y = 0;
  apply();
}

// Zoom keeping the point under (cx, cy) — relative to the window center — where it is.
function zoomTo(next, cx = 0, cy = 0) {
  next = Math.min(MAX, Math.max(MIN, next));
  if (mode === 'fit') { y += -(BAR_SPACE - MARGIN) / 2; mode = 'free'; }
  x = cx - (cx - x) * (next / scale);
  y = cy - (cy - y) * (next / scale);
  scale = next;
  apply();
}

function zoomStep(dir) {
  const steps = [0.05, 0.1, 0.25, 0.33, 0.5, 0.67, 0.75, 1, 1.25, 1.5, 2, 3, 4, 6, 8, 12, 16];
  const next = dir > 0 ? steps.find(s => s > scale + 0.001) : [...steps].reverse().find(s => s < scale - 0.001);
  zoomTo(next || scale);
}

function close() {
  api.closeLightbox();
}

function load() {
  let next = '';
  try { next = decodeURIComponent(location.hash.slice(1)); } catch { /* malformed */ }
  // Only our own attachments and web images; anything else is ignored.
  if (!/^(sticky-img:\/\/img\/[a-f0-9]{24}\.[a-z]{3,4}|https?:\/\/\S+)$/i.test(next)) next = '';
  url = next;
  $('msg').hidden = true;
  img.classList.remove('ready');
  $('save').hidden = !url.startsWith('sticky-img:');
  if (!url) { $('msg').hidden = false; img.removeAttribute('src'); return; }
  if (img.getAttribute('src') === url && img.complete && img.naturalWidth) { fit(); img.classList.add('ready'); return; }
  img.src = url;
}

img.addEventListener('load', () => {
  fit();
  img.classList.add('ready');
});
img.addEventListener('error', () => { $('msg').hidden = false; });

window.addEventListener('hashchange', load);
window.addEventListener('resize', () => { if (mode === 'fit') fit(); else apply(); });

stage.addEventListener('wheel', (e) => {
  e.preventDefault();
  if (!img.naturalWidth) return;
  const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? innerHeight : 1;
  const factor = Math.exp(-e.deltaY * unit * (e.ctrlKey ? 0.01 : 0.0018));
  zoomTo(scale * factor, e.clientX - innerWidth / 2, e.clientY - innerHeight / 2);
}, { passive: false });

// Drag to pan; a click on the backdrop that wasn't a drag closes the viewer.
let pan = null;
stage.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  pan = { id: e.pointerId, sx: e.clientX, sy: e.clientY, x, y, moved: false, onImage: e.target === img };
});
stage.addEventListener('pointermove', (e) => {
  if (!pan || e.pointerId !== pan.id) return;
  const dx = e.clientX - pan.sx;
  const dy = e.clientY - pan.sy;
  if (!pan.moved && Math.hypot(dx, dy) < 4) return;
  if (!pan.moved) {
    pan.moved = true;
    // Captured only once it's really a drag, so double-clicks still reach the image.
    stage.setPointerCapture(e.pointerId);
    if (mode === 'fit') { pan.y += -(BAR_SPACE - MARGIN) / 2; mode = 'free'; }
    stage.classList.add('panning');
  }
  x = pan.x + dx;
  y = pan.y + dy;
  apply();
});
const endPan = (e) => {
  if (!pan || e.pointerId !== pan.id) return;
  const { moved, onImage } = pan;
  pan = null;
  stage.classList.remove('panning');
  if (e.type === 'pointerup' && !moved && !onImage) close();
};
stage.addEventListener('pointerup', endPan);
stage.addEventListener('pointercancel', endPan);

img.addEventListener('dblclick', (e) => {
  if (mode === 'fit' && Math.abs(fitScale() - 1) > 0.001) {
    const cx = e.clientX - innerWidth / 2;
    const cy = e.clientY - innerHeight / 2;
    zoomTo(1, cx, cy);
  } else fit();
});

$('fit').addEventListener('click', fit);
$('actual').addEventListener('click', actual);
$('zoom-in').addEventListener('click', () => zoomStep(1));
$('zoom-out').addEventListener('click', () => zoomStep(-1));
// The viewer floats above everything, so it steps aside for the app that opens the image.
$('open').addEventListener('click', () => { if (url) api.openImage(url).finally(close); });
$('save').addEventListener('click', () => { if (url) api.saveImageAs(url); });
$('close').addEventListener('click', close);

window.addEventListener('keydown', (e) => {
  const mod = e.ctrlKey || e.metaKey;
  if (e.key === 'Escape') { e.preventDefault(); close(); return; }
  if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomStep(1); return; }
  if (e.key === '-' || e.key === '_') { e.preventDefault(); zoomStep(-1); return; }
  if (e.key === '0' && !mod) { fit(); return; }
  if (e.key === '1' && !mod) { actual(); return; }
  if (mod && e.key.toLowerCase() === 's' && url.startsWith('sticky-img:')) { e.preventDefault(); api.saveImageAs(url); return; }
  if (mod && e.key.toLowerCase() === 'w') { e.preventDefault(); close(); return; }
  const nudge = { ArrowLeft: [40, 0], ArrowRight: [-40, 0], ArrowUp: [0, 40], ArrowDown: [0, -40] }[e.key];
  if (nudge && mode !== 'fit') { x += nudge[0]; y += nudge[1]; apply(); }
});

load();
