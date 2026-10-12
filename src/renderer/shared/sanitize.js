// Allowlist HTML sanitizer for note content.
//
// mode 'stored' — content produced by our own editor (keeps our colors, sizes, image widths).
// mode 'paste'  — foreign HTML from the clipboard / files: keeps structure and emphasis,
//                 drops foreign colors, fonts and sizes so notes stay readable in any theme.

import { normalizeLang } from '../note/highlight.js';

const DROP = new Set([
  'SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'LINK', 'META', 'TITLE', 'HEAD', 'NOSCRIPT', 'TEMPLATE',
  'SVG', 'MATH', 'FORM', 'INPUT', 'BUTTON', 'SELECT', 'TEXTAREA', 'OPTION', 'CANVAS', 'VIDEO', 'AUDIO',
  'SOURCE', 'TRACK', 'FRAME', 'FRAMESET', 'APPLET', 'BASE', 'PARAM', 'DIALOG', 'PORTAL', 'MAP', 'AREA'
]);

const ATTRS = {
  P: [], DIV: [], BR: [], SPAN: [], B: [], STRONG: [], I: [], EM: [], U: [], S: [], MARK: [], SUB: [], SUP: [],
  SMALL: [], CODE: [], KBD: [], PRE: ['data-lang'], BLOCKQUOTE: [], H1: [], H2: [], H3: [], UL: ['data-reset', 'data-reset-at'], OL: ['start'], LI: ['data-due', 'data-due-src'],
  A: ['href', 'title'], IMG: ['src', 'alt', 'title', 'width', 'data-wrap'], HR: [], TABLE: [], THEAD: [], TBODY: [], TFOOT: [],
  TR: [], TD: ['colspan', 'rowspan'], TH: ['colspan', 'rowspan'], CAPTION: [], DETAILS: ['open'], SUMMARY: [],
  FIGURE: [], FIGCAPTION: []
};

const RENAME = { STRIKE: 'S', DEL: 'S', INS: 'U', H4: 'H3', H5: 'H3', H6: 'H3', TT: 'CODE', SAMP: 'CODE', VAR: 'I', CITE: 'I', DFN: 'I', ARTICLE: 'DIV', SECTION: 'DIV', MAIN: 'DIV', HEADER: 'DIV', FOOTER: 'DIV', ASIDE: 'DIV', NAV: 'DIV', CENTER: 'DIV', ADDRESS: 'P', DT: 'P', DD: 'BLOCKQUOTE', DL: 'DIV' };

export const BLOCK_TAGS = new Set(['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'LI', 'PRE', 'BLOCKQUOTE', 'TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR', 'TD', 'TH', 'CAPTION', 'HR', 'FIGURE', 'FIGCAPTION', 'DETAILS', 'SUMMARY']);

const INLINE_WRAPPERS = new Set(['SPAN', 'B', 'STRONG', 'I', 'EM', 'U', 'S', 'MARK', 'SUB', 'SUP', 'SMALL', 'CODE', 'KBD', 'A']);

const FONT_SIZES = { 1: 'x-small', 2: 'small', 3: 'medium', 4: 'large', 5: 'x-large', 6: 'xx-large', 7: 'xxx-large' };
const SIZE_KEYWORDS = new Set(['x-small', 'small', 'medium', 'large', 'x-large', 'xx-large', 'xxx-large', '-webkit-xxx-large', 'smaller', 'larger']);

const COLOR_RE = /^(#[0-9a-f]{3,8}|rgba?\(\s*[\d.]+%?\s*,\s*[\d.]+%?\s*,\s*[\d.]+%?\s*(,\s*[\d.]+%?\s*)?\)|rgba?\(\s*[\d.]+%?\s+[\d.]+%?\s+[\d.]+%?\s*(\/\s*[\d.]+%?\s*)?\)|[a-z]{3,20})$/i;
const LENGTH_RE = /^\d{1,4}(\.\d+)?(px|%|em|rem)$/;

function safeHref(v) {
  const s = String(v || '').trim();
  if (/^(https?:|mailto:)/i.test(s)) return s;
  if (/^note:\/\/n[a-z0-9]{6,40}$/.test(s)) return s; // link to another note
  if (/^www\./i.test(s)) return 'https://' + s;
  return null;
}

function safeSrc(v) {
  const s = String(v || '').trim();
  if (/^sticky-img:\/\/img\/[a-f0-9]{24}\.(png|jpg|gif|webp|bmp|svg|avif|ico)$/.test(s)) return s;
  if (/^data:image\/(png|jpe?g|gif|webp|bmp|avif|svg\+xml);base64,[A-Za-z0-9+/=\s]+$/i.test(s)) return s;
  if (/^https?:\/\//i.test(s)) return s;
  return null;
}

// File shortcuts carry a local path in data-path. It's never used as a link target, only handed to
// the main process (which checks it again), so all we accept is a plain absolute path.
function safeFilePath(v) {
  const s = String(v || '');
  if (!s || s.length > 1024 || /[\u0000-\u001f\u007f]/.test(s)) return null;
  if (/^\/(?!\/)/.test(s)) return s; // macOS / Linux
  if (/^[A-Za-z]:[\\/]/.test(s)) return s; // Windows drive
  if (/^\\\\[^\\?.]/.test(s)) return s; // Windows network share (\\server\share)
  return null;
}

function isTransparent(c) {
  return /^(transparent|initial|inherit|none)$/i.test(c) || /rgba\([^)]*,\s*0(\.0+)?\s*\)$/i.test(c);
}

function parseStyle(el) {
  const out = {};
  const raw = el.getAttribute('style');
  if (!raw) return out;
  for (const decl of raw.split(';')) {
    const i = decl.indexOf(':');
    if (i < 0) continue;
    const prop = decl.slice(0, i).trim().toLowerCase();
    const value = decl.slice(i + 1).trim().replace(/\s*!important\s*$/i, '');
    if (!prop || !value || /url\(|expression|javascript:|\\|\/\*|@import/i.test(value)) continue;
    out[prop] = value;
  }
  return out;
}

function cleanStyle(tag, style, mode) {
  const keep = [];
  const align = style['text-align'];
  if (align && /^(left|right|center|justify|start|end)$/i.test(align) && BLOCK_TAGS.has(tag)) keep.push(`text-align: ${align.toLowerCase()}`);
  if (mode === 'stored') {
    if (style.color && COLOR_RE.test(style.color)) keep.push(`color: ${style.color}`);
    const bg = style['background-color'] || style.background;
    if (bg && COLOR_RE.test(bg) && !isTransparent(bg)) keep.push(`background-color: ${bg}`);
    const fs = style['font-size'];
    if (fs && (SIZE_KEYWORDS.has(fs.toLowerCase()) || /^\d{1,3}(\.\d+)?(em|%)$/.test(fs))) keep.push(`font-size: ${fs.toLowerCase()}`);
    if ((tag === 'IMG' || tag === 'TABLE' || tag === 'TD' || tag === 'TH') && style.width && LENGTH_RE.test(style.width)) keep.push(`width: ${style.width}`);
    // Position of "behind text" / "in front of text" images.
    if (tag === 'IMG') for (const side of ['left', 'top']) if (/^-?\d{1,5}(\.\d+)?px$/.test(style[side] || '')) keep.push(`${side}: ${style[side]}`);
    if (style['margin-left'] && LENGTH_RE.test(style['margin-left']) && BLOCK_TAGS.has(tag)) keep.push(`margin-left: ${style['margin-left']}`);
    // Lets a user un-bold part of a heading or un-italicize part of a quote.
    if (/^(normal|400)$/i.test(style['font-weight'] || '') && !BLOCK_TAGS.has(tag)) keep.push('font-weight: normal');
    if (/^normal$/i.test(style['font-style'] || '') && !BLOCK_TAGS.has(tag)) keep.push('font-style: normal');
    if (tag === 'BLOCKQUOTE' && /^0(px)?\s+0(px)?\s+0(px)?\s+\d+px$/.test(style.margin || '')) keep.push(`margin: ${style.margin}`, 'border: none', 'padding: 0px');
  }
  return keep.join('; ');
}

// Inline emphasis expressed through CSS (Google Docs, Word, many sites) → semantic tags.
function emphasisFromStyle(style) {
  const wraps = [];
  const fw = (style['font-weight'] || '').toLowerCase();
  if (fw === 'bold' || fw === 'bolder' || Number(fw) >= 600) wraps.push('B');
  if (/italic|oblique/i.test(style['font-style'] || '')) wraps.push('I');
  const deco = (style['text-decoration'] || '') + ' ' + (style['text-decoration-line'] || '');
  if (/underline/i.test(deco)) wraps.push('U');
  if (/line-through/i.test(deco)) wraps.push('S');
  const va = (style['vertical-align'] || '').toLowerCase();
  if (va === 'super') wraps.push('SUP');
  if (va === 'sub') wraps.push('SUB');
  return wraps;
}

export function sanitizeHtml(html, { mode = 'stored', normalize = mode === 'paste' } = {}) {
  const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
  const out = doc.createElement('div');

  const walk = (node, parent, depth) => {
    if (depth > 120) return;
    if (node.nodeType === 3) { parent.appendChild(doc.createTextNode(node.data)); return; }
    if (node.nodeType !== 1) return;

    let tag = node.nodeName.toUpperCase();
    if (DROP.has(tag)) return;

    const style = parseStyle(node);
    const children = () => { for (const c of [...node.childNodes]) walk(c, target, depth + 1); };
    let target = parent;

    // Google Docs wraps everything in <b style="font-weight:normal">.
    if ((tag === 'B' || tag === 'STRONG') && /^(normal|400)$/i.test(style['font-weight'] || '')) { children(); return; }

    if (tag === 'FONT') {
      if (mode === 'stored') {
        const span = doc.createElement('span');
        const css = [];
        const color = node.getAttribute('color');
        if (color && COLOR_RE.test(color)) css.push(`color: ${color}`);
        const size = FONT_SIZES[node.getAttribute('size')];
        if (size) css.push(`font-size: ${size}`);
        const extra = cleanStyle('SPAN', style, mode);
        if (extra) css.push(extra);
        if (css.length) { span.setAttribute('style', css.join('; ')); parent.appendChild(span); target = span; }
      }
      children();
      return;
    }

    if (RENAME[tag]) tag = RENAME[tag];

    if (!ATTRS[tag]) { children(); return; } // unknown tag: keep its text, drop the wrapper

    // Tight lists: <li><p>text</p></li> → <li>text</li>
    if (mode === 'paste' && tag === 'P' && parent.nodeName === 'LI' && parent.childNodes.length === 0 && !node.nextElementSibling) {
      children();
      return;
    }

    if (tag === 'IMG') {
      const src = safeSrc(node.getAttribute('src'));
      if (!src) return;
    }

    const el = doc.createElement(tag);
    for (const name of ATTRS[tag]) {
      let v = node.getAttribute(name);
      if (v == null) continue;
      if (name === 'href') v = safeHref(v);
      else if (name === 'src') v = safeSrc(v);
      else if (name === 'width' || name === 'colspan' || name === 'rowspan' || name === 'start') v = /^\d{1,4}$/.test(v) ? v : null;
      else if (name === 'data-wrap') v = mode === 'stored' && /^(left|right|block|behind|front)$/.test(v) ? v : null;
      else if (name === 'data-reset') v = mode === 'stored' && /^(daily|weekly)$/.test(v) ? v : null;
      else if (name === 'data-reset-at') v = mode === 'stored' && /^\d{1,15}$/.test(v) ? v : null;
      else if (name === 'data-due') v = mode === 'stored' && /^\d{4}-\d\d-\d\d$/.test(v) ? v : null;
      else if (name === 'data-due-src') v = mode === 'stored' ? String(v).slice(0, 40) : null;
      else if (name === 'alt') v = String(v).slice(0, 20000); // may hold text recognized in the image
      else if (name === 'data-lang') v = normalizeLang(v); // only known code-block language ids
      else v = String(v).slice(0, 300);
      if (v != null) el.setAttribute(name, v);
    }
    // A file shortcut chip: only its name is kept as content, so nothing else can hide inside it.
    if (tag === 'A' && !el.hasAttribute('href') && mode === 'stored' && /(^|\s)file-chip(\s|$)/.test(node.getAttribute('class') || '')) {
      const path = safeFilePath(node.getAttribute('data-path'));
      if (path) {
        const kind = node.getAttribute('data-kind') === 'folder' ? 'folder' : 'file';
        const ext = String(node.getAttribute('data-ext') || '').toLowerCase();
        el.className = 'file-chip';
        el.setAttribute('data-path', path);
        el.setAttribute('data-kind', kind);
        if (kind === 'file' && /^[a-z0-9]{1,10}$/.test(ext)) el.setAttribute('data-ext', ext);
        el.setAttribute('contenteditable', 'false');
        const base = path.split(/[\\/]/).filter(Boolean).pop() || path;
        el.textContent = (node.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 300) || base;
        parent.appendChild(el);
        return;
      }
    }
    if (tag === 'A' && !el.hasAttribute('href') && !el.hasAttribute('data-path')) { children(); return; }

    const cls = node.getAttribute('class') || '';
    if (tag === 'UL' && /\b(checklist|contains-task-list|task-list)\b/.test(cls)) el.className = 'checklist';
    if (tag === 'LI') {
      const keep = [];
      if (/\bchecked\b/.test(cls)) keep.push('checked');
      const level = /\b(h[1-3])\b/.exec(cls);
      if (level) keep.push(level[1]); // title/heading style on a checklist item
      if (keep.length) el.className = keep.join(' ');
      const box = node.querySelector(':scope > input[type=checkbox], :scope > p > input[type=checkbox], :scope > span > input[type=checkbox]');
      if (box) {
        if (box.hasAttribute('checked')) el.classList.add('checked');
        if (parent.nodeName === 'UL') parent.className = 'checklist';
      }
    }

    const css = cleanStyle(tag, style, mode);
    if (css) el.setAttribute('style', css);

    parent.appendChild(el);
    target = el;

    if (INLINE_WRAPPERS.has(tag) || BLOCK_TAGS.has(tag)) {
      for (const w of emphasisFromStyle(style)) {
        if (w === tag || (w === 'B' && /^H[1-3]$|^TH$/.test(tag))) continue;
        const wrap = doc.createElement(w);
        target.appendChild(wrap);
        target = wrap;
      }
    }
    children();

    // Prune wrappers that ended up empty or meaningless.
    if (INLINE_WRAPPERS.has(tag) && tag !== 'A' && !el.hasChildNodes()) el.remove();
    else if (tag === 'SPAN' && !el.attributes.length) el.replaceWith(...el.childNodes);
  };

  for (const c of [...doc.body.childNodes]) walk(c, out, 0);
  if (normalize) normalizeWhitespace(out, doc);
  for (const t of textNodes(out, doc)) if (t.data.includes('​')) t.data = t.data.replace(/​/g, '');
  return out.innerHTML;
}

function textNodes(root, doc) {
  const w = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const list = [];
  while (w.nextNode()) list.push(w.currentNode);
  return list;
}

const isBlock = (n) => n && n.nodeType === 1 && (BLOCK_TAGS.has(n.nodeName) || n.nodeName === 'BR');

// The editor uses `white-space: pre-wrap`, so source-formatting whitespace from
// foreign HTML has to be collapsed the way a browser would render it.
function normalizeWhitespace(root, doc) {
  for (const t of textNodes(root, doc)) {
    if (t.parentElement && t.parentElement.closest('pre')) continue;
    let v = t.data.replace(/[\t\n\r\f ]+/g, ' ');
    const prev = t.previousSibling;
    const next = t.nextSibling;
    const parentBlock = t.parentNode === root || isBlock(t.parentNode);
    if (!v.trim() && (!prev || !next || isBlock(prev) || isBlock(next))) { t.remove(); continue; }
    if ((!prev && parentBlock) || isBlock(prev)) v = v.replace(/^ /, '');
    if ((!next && parentBlock) || isBlock(next)) v = v.replace(/ $/, '');
    if (!v) t.remove(); else t.data = v;
  }
}

export function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
