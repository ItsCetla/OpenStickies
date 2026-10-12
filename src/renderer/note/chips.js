// File shortcut chips: building them, checking the files are still there, and the hover preview card.
import { escapeHtml } from '../shared/sanitize.js';
import { fileIconUrl, fileKindLabel, hydrateFileChips } from '../shared/file-icons.js';

const HOVER_DELAY = 500;

// path -> Promise<info>. Cleared whenever the window regains focus, because that's when files
// are most likely to have been moved or deleted in the meantime.
const infoCache = new Map();

export function baseName(path) {
  return String(path || '').split(/[\\/]/).filter(Boolean).pop() || String(path || '');
}

function extOf(name) {
  const m = /\.([a-z0-9]{1,10})$/i.exec(name || '');
  return m ? m[1].toLowerCase() : '';
}

export function chipHtml(path, info) {
  const kind = info && info.kind === 'folder' ? 'folder' : 'file';
  const name = (info && info.name) || baseName(path);
  const ext = kind === 'file' ? extOf(name) : '';
  return `<a class="file-chip" data-path="${escapeHtml(path)}" data-kind="${kind}"${ext ? ` data-ext="${ext}"` : ''} contenteditable="false">${escapeHtml(name)}</a>`;
}

export function chipInfo(api, path) {
  let p = infoCache.get(path);
  if (!p) {
    // If the check itself fails we don't know, so the chip is left looking normal.
    p = Promise.resolve().then(() => api.fileInfo(path, false)).catch(() => null);
    infoCache.set(path, p);
    if (infoCache.size > 500) infoCache.delete(infoCache.keys().next().value);
  }
  return p;
}

export function forgetChipInfo() {
  infoCache.clear();
}

// Icons, drag-out and the "missing" look are display-only; getHTML() strips them again.
export function refreshChips(root, api) {
  hydrateFileChips(root);
  for (const a of root.querySelectorAll('a.file-chip')) {
    if (a.getAttribute('draggable') !== 'true') a.setAttribute('draggable', 'true');
    if (a.getAttribute('contenteditable') !== 'false') a.setAttribute('contenteditable', 'false');
    const path = a.getAttribute('data-path');
    if (!path) continue;
    chipInfo(api, path).then((info) => {
      if (!a.isConnected || a.getAttribute('data-path') !== path) return;
      a.classList.toggle('missing', !!info && info.exists === false);
    });
  }
}

export function formatSize(n) {
  if (!(n >= 0)) return '';
  if (n < 1024) return n === 1 ? '1 byte' : `${n} bytes`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

export function formatDate(ms) {
  if (!ms) return '';
  try { return new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }); } catch { return ''; }
}

// A preview card that appears after resting the pointer on a file chip or a shrunken image.
export class HoverPreview {
  constructor(card, { api, root, isBusy }) {
    this.card = card;
    this.api = api;
    this.root = root;
    this.isBusy = isBusy || (() => false);
    this.target = null;
    this.timer = null;
    this.token = 0;
    this._bind();
  }

  _bind() {
    this.root.addEventListener('mouseover', (e) => {
      const t = this._targetOf(e.target);
      if (t === this.target) return;
      this.hide();
      if (!t) return;
      this.target = t;
      this.timer = setTimeout(() => this.show(t), HOVER_DELAY);
    });
    this.root.addEventListener('mouseout', (e) => {
      if (!this.target) return;
      if (e.relatedTarget && this.target.contains(e.relatedTarget)) return;
      this.hide();
    });
    const hide = () => this.hide();
    window.addEventListener('scroll', hide, { capture: true, passive: true });
    window.addEventListener('keydown', hide, true);
    window.addEventListener('mousedown', hide, true);
    window.addEventListener('wheel', hide, { capture: true, passive: true });
    window.addEventListener('blur', hide);
    window.addEventListener('dragstart', hide, true);
  }

  _targetOf(node) {
    if (!node || node.nodeType !== 1 || !this.root.contains(node)) return null;
    const chip = node.closest('a.file-chip');
    if (chip && this.root.contains(chip)) return chip;
    if (node.nodeName === 'IMG') return node;
    return null;
  }

  hide() {
    clearTimeout(this.timer);
    this.timer = null;
    this.target = null;
    this.token++;
    if (!this.card.hidden) {
      this.card.hidden = true;
      this.card.replaceChildren();
    }
  }

  show(t) {
    if (!t.isConnected || this.isBusy()) return;
    if (t.nodeName === 'IMG') this._showImage(t);
    else this._showFile(t);
  }

  _showImage(img) {
    // Only worth it when the picture is shown smaller than it really is.
    if (img.classList.contains('selected') || img.classList.contains('dragging')) return;
    const r = img.getBoundingClientRect();
    if (!img.naturalWidth || img.naturalWidth <= r.width * 1.15) return;
    const maxW = Math.min(img.naturalWidth, innerWidth - 24, 420);
    const maxH = Math.min(img.naturalHeight, innerHeight - 24, 420);
    const s = Math.min(maxW / img.naturalWidth, maxH / img.naturalHeight);
    if (img.naturalWidth * s <= r.width * 1.15) return;
    const big = document.createElement('img');
    big.src = img.currentSrc || img.src;
    big.alt = '';
    big.width = Math.round(img.naturalWidth * s);
    big.height = Math.round(img.naturalHeight * s);
    big.className = 'hover-image';
    this.card.className = 'hover-card image';
    this.card.replaceChildren(big);
    this._place(r);
  }

  _showFile(a) {
    const path = a.getAttribute('data-path');
    if (!path) return;
    const kind = a.getAttribute('data-kind') === 'folder' ? 'folder' : 'file';
    const ext = a.getAttribute('data-ext') || '';
    const token = ++this.token;

    const thumb = document.createElement('div');
    thumb.className = 'hover-thumb';
    const icon = document.createElement('img');
    icon.className = 'hover-icon';
    icon.alt = '';
    icon.src = fileIconUrl(ext, kind);
    thumb.append(icon);

    const name = document.createElement('div');
    name.className = 'hover-name';
    name.textContent = baseName(path);
    const meta = document.createElement('div');
    meta.className = 'hover-meta';
    meta.textContent = fileKindLabel(ext, kind);
    const where = document.createElement('div');
    where.className = 'hover-path';
    where.textContent = path;

    this.card.className = 'hover-card file';
    this.card.replaceChildren(thumb, name, meta, where);
    this._place(a.getBoundingClientRect());

    Promise.resolve().then(() => this.api.fileInfo(path, true)).then((info) => {
      if (token !== this.token || !info) return;
      if (info.exists === false) {
        a.classList.add('missing');
        meta.textContent = info.invalid ? "This isn't a file path this computer can open" : "Can't find this file. It may have been moved or deleted.";
        meta.classList.add('warn');
      } else {
        a.classList.remove('missing');
        const bits = [fileKindLabel(info.ext || ext, info.kind || kind)];
        if (info.kind === 'folder' && typeof info.items === 'number') bits.push(info.items === 1 ? '1 item' : `${info.items} items`);
        else if (info.kind !== 'folder' && typeof info.size === 'number' && !info.remote) bits.push(formatSize(info.size));
        const when = formatDate(info.mtime);
        meta.textContent = bits.filter(Boolean).join(' · ');
        if (when) {
          const mod = document.createElement('div');
          mod.className = 'hover-meta';
          mod.textContent = `Modified ${when}`;
          meta.after(mod);
        }
        if (typeof info.thumb === 'string' && /^data:image\/(png|jpeg);base64,/.test(info.thumb)) {
          const pic = document.createElement('img');
          pic.className = 'hover-pic';
          pic.alt = '';
          pic.src = info.thumb;
          thumb.replaceChildren(pic);
          thumb.classList.add('has-pic');
        }
      }
      this._place(a.getBoundingClientRect());
    }).catch(() => { /* the basic card is already showing */ });
  }

  // Below the target when it fits, otherwise above, always kept inside the window.
  _place(r) {
    const card = this.card;
    card.hidden = false;
    card.style.left = '0px';
    card.style.top = '0px';
    const w = card.offsetWidth;
    const h = card.offsetHeight;
    const gap = 6;
    let left = Math.min(Math.max(8, r.left), innerWidth - w - 8);
    let top = r.bottom + gap;
    if (top + h > innerHeight - 8) top = r.top - gap - h >= 8 ? r.top - gap - h : Math.max(8, innerHeight - h - 8);
    card.style.left = `${Math.max(8, left)}px`;
    card.style.top = `${top}px`;
  }
}
