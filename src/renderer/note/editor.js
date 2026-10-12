import { sanitizeHtml, escapeHtml, BLOCK_TAGS } from '../shared/sanitize.js';
import { decorate, syncDueDates, tagAt, sinkItem, moveItem, nudgeItem, topChecklist, cascadeCheck } from './smart.js';

const INTERNAL_MIME = 'application/x-stickies';
const ZWSP = '​';
const SENTINEL_COLOR = 'rgb(1, 2, 3)';
const IMAGE_SIZES = { small: '33%', medium: '50%', large: '75%', full: '100%', original: '' };
const WRAP_MODES = ['inline', 'left', 'right', 'block', 'behind', 'front'];
const INLINE_FORMAT = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'DEL', 'MARK', 'SUB', 'SUP', 'CODE', 'KBD', 'A', 'SPAN', 'SMALL', 'FONT']);
const URL_TAIL_RE =/(?:^|\s)((?:https?:\/\/|www\.)[^\s<]+[^\s<.,;:!?)\]'"])$/;

export class Editor {
  constructor(el, { api, content, imgTools, dropCaret, dropHint, grip, itemDrop, onChange, onSelection, toast }) {
    this.el = el;
    this.api = api;
    this.content = content;
    this.imgTools = imgTools;
    this.handles = [...imgTools.querySelectorAll('.img-handle')];
    this.imgBar = imgTools.querySelector('.img-bar');
    this.dropCaret = dropCaret;
    this.dropHint = dropHint;
    this.grip = grip;
    this.itemDrop = itemDrop;
    // Set by the note window:
    this.suggest = null;        // inline suggestion menu
    this.onTrigger = null;      // (trigger, textNode, offset) when "#", "[[" or "/" is typed
    this.onNoteLink = null;     // (noteId) when a link to another note is opened
    this.onTagClick = null;     // (tag) on Ctrl+Click of a #tag
    this.doneLast = false;      // ticked checklist items sink to the bottom (setting, off by default)
    this.ocrEnabled = true;
    this._ocrTried = new Set();
    this._decorateTimer = null;
    this.onChange = onChange || (() => {});
    this.onSelection = onSelection || (() => {});
    this.toast = toast || (() => {});
    this.locked = false;
    this.zoom = 1;
    this.savedRange = null;
    this.selectedImg = null;
    this.ctxTarget = null;
    this.internalDrag = false;
    this.plainPasteNext = false;
    this.find = { ranges: [], index: -1 };
    this._bind();
  }

  // ---------- content ----------
  setHTML(html) {
    const clean = sanitizeHtml(html || '', { mode: 'stored' });
    this.el.innerHTML = clean.trim() ? clean : '<p><br></p>';
    this.deselectImage();
    this.updateEmpty();
    this.localizeImages();
    this._decorateSoon(0);
    this.ocrImages();
  }

  getHTML() {
    const clone = this.el.cloneNode(true);
    clone.querySelectorAll('img.selected, img.loading, img.dragging, li.pop, li.sinking, li.flash, .dragging-item').forEach(n => n.classList.remove('selected', 'loading', 'dragging', 'pop', 'sinking', 'flash', 'dragging-item'));
    clone.querySelectorAll('[class=""]').forEach(n => n.removeAttribute('class'));
    clone.querySelectorAll('a[title]').forEach(a => a.removeAttribute('title'));
    let html = clone.innerHTML.replace(/​/g, '');
    if (/^<p><br><\/p>$/.test(html) || html === '<br>') html = '';
    return html;
  }

  getText() {
    return (this.el.innerText || '').replace(/​/g, '').replace(/\n{3,}/g, '\n\n').trim();
  }

  isEmpty() {
    return !this.getText() && !this.el.querySelector('img, hr, table');
  }

  updateEmpty() {
    if (this.isEmpty()) this.el.setAttribute('data-empty', '');
    else this.el.removeAttribute('data-empty');
  }

  changed() {
    this.updateEmpty();
    this.onChange();
    this._decorateSoon();
  }

  // Tag/date highlights and "@date" → data-due, a moment after typing stops.
  _decorateSoon(delay = 150) {
    clearTimeout(this._decorateTimer);
    this._decorateTimer = setTimeout(() => {
      if (!this.locked && syncDueDates(this.el)) this.onChange();
      decorate(this.el);
      this.ocrImages(); // pictures added by paste, drop or the image button
    }, delay);
  }

  // ---------- inserting things ----------
  replaceRange(range, content, { text = false } = {}) {
    if (this.locked) return;
    this.el.focus({ preventScroll: true });
    this.selectRange(range);
    document.execCommand(text ? 'insertText' : 'insertHTML', false, content);
    this.changed();
  }

  insertNoteLink(range, id, title) {
    this.replaceRange(range, `<a href="note://${id}">${escapeHtml(title)}</a>${ZWSP}`);
  }

  // Templates may contain {{cursor}}: the caret goes there after inserting.
  insertTemplate(html) {
    if (this.locked) return;
    this.restoreSelection();
    this.insertHTML(sanitizeHtml(html, { mode: 'stored' }));
    this.placeCursorToken();
  }

  placeCursorToken() {
    const walker = document.createTreeWalker(this.el, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const i = node.data.indexOf('{{cursor}}');
      if (i < 0) continue;
      node.deleteData(i, 10);
      const r = document.createRange();
      r.setStart(node, i);
      r.collapse(true);
      this.el.focus({ preventScroll: true });
      this.selectRange(r);
      const block = node.parentElement;
      if (block && !block.textContent && !block.querySelector('br,img')) block.appendChild(document.createElement('br'));
      this.changed();
      return true;
    }
    return false;
  }

  appendHTML(html) {
    if (this.locked) return;
    this.focus(true);
    const last = this.el.lastElementChild;
    if (last && last.textContent.trim()) document.execCommand('insertParagraph');
    this.insertHTML(html);
  }

  // Recognize text in pictures so it can be searched. Each image is asked about once.
  async ocrImages() {
    if (!this.ocrEnabled || this._ocrRunning) return;
    this._ocrRunning = true;
    try {
      for (const img of [...this.el.querySelectorAll('img[src^="sticky-img:"]')]) {
        const src = img.getAttribute('src');
        if (img.getAttribute('alt') || this._ocrTried.has(src)) continue;
        this._ocrTried.add(src);
        const text = await this.api.ocrImage(src);
        if (text && img.isConnected && !img.getAttribute('alt')) { img.setAttribute('alt', text); this.onChange(); }
      }
    } catch { /* recognition is best-effort */ } finally {
      this._ocrRunning = false;
    }
  }

  _detectTrigger(ch) {
    const sel = getSelection();
    if (!this.onTrigger || !sel.isCollapsed || !sel.anchorNode || sel.anchorNode.nodeType !== 3) return;
    if (this.closest('code, pre, a')) return;
    const node = sel.anchorNode;
    const off = sel.anchorOffset;
    const prev = off >= 2 ? node.data[off - 2] : '';
    const atStart = off === 1 || /[\s(\u00a0]/.test(prev);
    if (ch === '#' && atStart) this.onTrigger('#', node, off - 1);
    else if (ch === '[' && prev === '[') this.onTrigger('[[', node, off - 2);
    else if (ch === '/' && atStart) this.onTrigger('/', node, off - 1);
  }

  // Chromium's insertHTML stamps the surrounding computed style (text color, pixel font
  // size, font family) onto everything it inserts. Left alone, that text would keep the
  // old color after a theme change and ignore the note's font and zoom.
  _stripLeakedStyles() {
    const inherited = getComputedStyle(this.el).color;
    for (const n of this.el.querySelectorAll('[style]')) {
      const s = n.style;
      if (s.color && (s.color === inherited || s.color === 'inherit')) this._dropStyle(n, 'color');
      if (!n.isConnected) continue;
      if (/px$/.test(s.fontSize)) this._dropStyle(n, 'font-size');
      if (!n.isConnected) continue;
      for (const prop of ['font-family', 'line-height', 'letter-spacing', 'word-spacing', 'white-space']) {
        if (s.getPropertyValue(prop)) { this._dropStyle(n, prop); if (!n.isConnected) break; }
      }
    }
  }

  // Chromium nests lists, tables and rules inside <p>/<h*> (invalid HTML that the parser
  // would later split into stray blank paragraphs). Lift them out, keeping the caret.
  _fixBlockNesting() {
    const bad = this.el.querySelectorAll(':is(p, h1, h2, h3) > :is(ul, ol, table, hr, pre, blockquote, div, p, h1, h2, h3)');
    if (!bad.length) return;
    const sel = getSelection();
    const saved = sel.rangeCount ? [sel.anchorNode, sel.anchorOffset, sel.focusNode, sel.focusOffset] : null;
    const isBlank = (n) => !n.textContent.replace(/​/g, '').trim() && !n.querySelector('img, hr, table');
    for (const child of bad) {
      const parent = child.parentElement;
      if (!parent || !this.el.contains(parent)) continue;
      const after = parent.cloneNode(false);
      while (child.nextSibling) after.appendChild(child.nextSibling);
      parent.after(child);
      if (!isBlank(after)) child.after(after);
      if (isBlank(parent)) parent.remove();
    }
    if (saved && saved[0] && saved[0].isConnected && saved[2].isConnected) {
      try { sel.setBaseAndExtent(saved[0], saved[1], saved[2], saved[3]); } catch { /* offsets moved */ }
    }
  }

  setLocked(locked) {
    this.locked = !!locked;
    this.el.contentEditable = this.locked ? 'false' : 'true';
    if (this.locked) this.deselectImage();
  }

  setZoom(z) {
    this.zoom = z;
    this.positionImgTools();
  }

  focus(atEnd = false) {
    this.el.focus({ preventScroll: true });
    if (atEnd) {
      const r = document.createRange();
      r.selectNodeContents(this.el);
      r.collapse(false);
      const sel = getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
    }
  }

  // ---------- selection helpers ----------
  range() {
    const sel = getSelection();
    if (!sel.rangeCount) return null;
    const r = sel.getRangeAt(0);
    return this.el.contains(r.commonAncestorContainer) ? r : null;
  }

  saveSelection() {
    const r = this.range();
    if (r) this.savedRange = r.cloneRange();
  }

  restoreSelection() {
    if (!this.savedRange) { this.el.focus({ preventScroll: true }); return; }
    this.el.focus({ preventScroll: true });
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(this.savedRange);
  }

  selectRange(r) {
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
  }

  anchorElement() {
    const r = this.range();
    if (!r) return null;
    const n = r.startContainer;
    return n.nodeType === 1 ? n : n.parentElement;
  }

  closest(selector) {
    const el = this.anchorElement();
    const hit = el && el.closest(selector);
    return hit && this.el.contains(hit) && hit !== this.el ? hit : null;
  }

  blockOf(node) {
    let n = node && node.nodeType === 3 ? node.parentNode : node;
    while (n && n !== this.el) {
      if (n.nodeType === 1 && BLOCK_TAGS.has(n.nodeName) && n.nodeName !== 'UL' && n.nodeName !== 'OL') return n;
      n = n.parentNode;
    }
    return this.el;
  }

  // ---------- commands ----------
  exec(cmd, value = null) {
    if (this.locked) return;
    this.el.focus({ preventScroll: true });
    document.execCommand(cmd, false, value);
    this.changed();
    this.onSelection();
  }

  command(cmd, arg) {
    if (this.locked) return;
    switch (cmd) {
      case 'bold': case 'italic': case 'underline': case 'strikeThrough':
      case 'superscript': case 'subscript':
      case 'justifyLeft': case 'justifyCenter': case 'justifyRight':
        return this.exec(cmd);
      case 'indent': case 'outdent':
        if (this.closest('li')) return this.indentList(cmd === 'outdent');
        return this.exec(cmd);
      case 'removeFormat':
        this.exec('removeFormat');
        this.exec('unlink');
        return;
      case 'insertUnorderedList': {
        const list = this.closest('ul.checklist');
        if (list) { list.classList.remove('checklist'); list.querySelectorAll(':scope > li.checked').forEach(li => li.classList.remove('checked')); this.changed(); this.onSelection(); return; }
        return this.exec('insertUnorderedList');
      }
      case 'insertOrderedList': return this.exec('insertOrderedList');
      case 'checklist': return this.toggleChecklist();
      case 'code': return this.toggleInlineCode();
      case 'hr': return this.insertRule();
      case 'date': return this.exec('insertText', new Date().toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }));
      case 'block': return this.formatBlock(arg);
      case 'size': return this.setFontSize(arg);
      case 'color': return this.setColor(arg);
      case 'highlight': return this.setHighlight(arg);
      default: return undefined;
    }
  }

  // Checklist items in the selection (innermost first), so styles can apply per item.
  checklistItems() {
    const r = this.range();
    if (!r || !this.closest('ul.checklist > li')) return [];
    const hits = [...this.el.querySelectorAll('ul.checklist > li')].filter(li => r.intersectsNode(li));
    return hits.filter(li => !hits.some(other => other !== li && li.contains(other)));
  }

  formatBlock(tag) {
    // Inside a checklist, Title/Heading/Subheading style the whole item and keep its checkbox.
    const items = this.checklistItems();
    if (items.length) {
      if (tag === 'blockquote' || tag === 'pre') { this.toast('Quotes and code blocks can’t go inside a checklist — try inline code (Ctrl+E)'); return; }
      const cls = /^h[1-3]$/.test(tag) ? tag : null;
      const toggleOff = cls && items.every(li => li.classList.contains(cls));
      for (const li of items) {
        li.classList.remove('h1', 'h2', 'h3');
        if (cls && !toggleOff) li.classList.add(cls);
        if (!li.className) li.removeAttribute('class');
      }
      this.changed();
      this.onSelection();
      return;
    }
    const current = this.blockOf(this.anchorElement());
    const name = current && current !== this.el ? current.nodeName.toLowerCase() : 'p';
    const inQuote = !!this.closest('blockquote');
    if (tag === 'blockquote' && inQuote) return this.exec('formatBlock', 'p');
    if (name === tag && tag !== 'p') return this.exec('formatBlock', 'p');
    this.exec('formatBlock', tag);
  }

  setFontSize(size) {
    if (this.locked) return;
    this.el.focus({ preventScroll: true });
    document.execCommand('styleWithCSS', false, true);
    document.execCommand('fontSize', false, String(size));
    document.execCommand('styleWithCSS', false, false);
    if (String(size) === '3') {
      // "Normal" means: no explicit size at all.
      for (const n of this.el.querySelectorAll('[style*="font-size"]')) {
        if (/font-size:\s*medium/.test(n.getAttribute('style'))) this._dropStyle(n, 'font-size');
      }
      for (const f of this.el.querySelectorAll('font[size="3"]')) f.replaceWith(...f.childNodes);
    }
    this.changed();
  }

  setColor(color) {
    if (this.locked) return;
    this.el.focus({ preventScroll: true });
    document.execCommand('styleWithCSS', false, true);
    document.execCommand('foreColor', false, color || SENTINEL_COLOR);
    document.execCommand('styleWithCSS', false, false);
    if (!color) this._cleanupSentinel('color');
    this.changed();
  }

  setHighlight(color) {
    if (this.locked) return;
    this.el.focus({ preventScroll: true });
    document.execCommand('styleWithCSS', false, true);
    document.execCommand('hiliteColor', false, color || SENTINEL_COLOR);
    document.execCommand('styleWithCSS', false, false);
    if (!color) this._cleanupSentinel('background-color');
    this.changed();
  }

  _cleanupSentinel(prop) {
    for (const n of this.el.querySelectorAll('[style]')) {
      const v = n.style.getPropertyValue(prop);
      if (v && v.replace(/\s/g, '') === SENTINEL_COLOR.replace(/\s/g, '')) this._dropStyle(n, prop);
    }
    for (const f of this.el.querySelectorAll('font[color]')) {
      if (f.getAttribute('color').toLowerCase() === '#010203') f.replaceWith(...f.childNodes);
    }
  }

  _dropStyle(node, prop) {
    node.style.removeProperty(prop);
    if (!node.getAttribute('style')) node.removeAttribute('style');
    if (node.nodeName === 'SPAN' && !node.attributes.length) node.replaceWith(...node.childNodes);
  }

  toggleChecklist() {
    if (this.locked) return;
    const list = this.closest('ul, ol');
    if (list && list.matches('ul.checklist')) return this.exec('insertUnorderedList');
    if (list && list.nodeName === 'UL') { list.classList.add('checklist'); this.changed(); this.onSelection(); return; }
    this.exec('insertUnorderedList');
    const ul = this.closest('ul');
    if (ul) { ul.classList.add('checklist'); this.changed(); this.onSelection(); }
  }

  // Tab / Shift+Tab in lists. Checklist items are moved by hand: Chromium's indent/outdent
  // drops the item's classes (ticked, title style) and bakes its look into inline styles.
  indentList(outdent) {
    const here = this.closest('li');
    const items = here && here.parentElement.matches('ul.checklist') ? this.checklistItems() : [];
    if (!items.length) { this.exec(outdent ? 'outdent' : 'indent'); return; }
    if (this.locked) return;
    const sel = getSelection();
    const saved = sel.rangeCount ? [sel.anchorNode, sel.anchorOffset, sel.focusNode, sel.focusOffset] : null;
    let moved = false;
    for (const li of outdent ? [...items].reverse() : items) {
      moved = (outdent ? this._outdentItem(li) : this._indentItem(li)) || moved;
    }
    if (saved && saved[0].isConnected && saved[2].isConnected) {
      try { sel.setBaseAndExtent(...saved); } catch { /* offsets changed */ }
    }
    if (moved) { this.changed(); this.onSelection(); }
  }

  // An item's sub-items live in the list right after it (<ul><li>a</li><ul>…</ul></ul>),
  // matching what Chromium produces, so a ticked parent doesn't strike through its children.
  _subListOf(li) {
    const next = li.nextElementSibling;
    return next && (next.nodeName === 'UL' || next.nodeName === 'OL') ? next : null;
  }

  _newChecklist() {
    const ul = document.createElement('ul');
    ul.className = 'checklist';
    return ul;
  }

  _indentItem(li) {
    let prev = li.previousElementSibling;
    if (!prev) return false; // the first item has nothing to nest under
    const kids = this._subListOf(li);
    let sub = prev.matches('ul.checklist') ? prev : null;
    if (!sub) { sub = this._newChecklist(); li.before(sub); }
    sub.appendChild(li);
    if (kids) sub.appendChild(kids); // the item's own sub-items come along, one level deeper
    return true;
  }

  _outdentItem(li) {
    const list = li.parentElement;
    const holder = list.parentElement;
    const kids = this._subListOf(li);
    const rest = [];
    for (let n = (kids || li).nextElementSibling; n; n = n.nextElementSibling) rest.push(n);

    if (holder && (holder.nodeName === 'UL' || holder.nodeName === 'OL' || holder.nodeName === 'LI')) {
      // Following items were nested under the same parent; they now nest under this item.
      const target = holder.nodeName === 'LI' ? holder : list;
      let tail = kids;
      if (rest.length && !tail) { tail = this._newChecklist(); }
      for (const r of rest) tail.appendChild(r);
      target.after(li);
      if (tail) li.after(tail);
    } else {
      // Top level: the item becomes a normal paragraph between the two halves of the list.
      const p = document.createElement('p');
      for (const c of [...li.childNodes]) p.appendChild(c);
      if (!p.hasChildNodes()) p.innerHTML = '<br>';
      const after = document.createElement(list.nodeName);
      if (list.className) after.className = list.className;
      for (const r of rest) after.appendChild(r);
      list.after(p);
      let ref = p;
      if (kids) { ref.after(kids); ref = kids; }
      if (after.children.length) ref.after(after);
      li.remove();
    }
    if (!list.children.length) list.remove();
    return true;
  }

  toggleCheck(li) {
    li.classList.toggle('checked');
    const parents = cascadeCheck(li); // sub-items follow; parents tick when all their sub-items are
    li.classList.add('pop');
    setTimeout(() => li.classList.remove('pop'), 160);
    this.changed();
    if (this.doneLast) {
      setTimeout(() => {
        let moved = false;
        for (const item of [li, ...parents]) {
          if (!item.isConnected) continue;
          item.classList.add('sinking');
          moved = sinkItem(item) || moved;
          setTimeout(() => item.classList.remove('sinking'), 300);
        }
        if (moved) this.changed();
      }, 260);
    }
  }

  // ---------- checklist drag-to-reorder ----------
  _itemAt(x, y, exclude) {
    let best = null;
    for (const li of this.el.querySelectorAll('ul.checklist > li')) {
      if (exclude && exclude.some(n => n === li || n.contains(li))) continue;
      const r = li.getBoundingClientRect();
      if (y >= r.top && y <= r.bottom && x >= r.left - 30 && x <= r.right && (!best || r.height < best.r.height)) best = { li, r };
    }
    return best;
  }

  _placeGrip(li) {
    if (!li || this.locked) { this.grip.hidden = true; return; }
    const probe = document.createRange();
    probe.selectNodeContents(li);
    const first = probe.getClientRects()[0] || li.getBoundingClientRect();
    const r = li.getBoundingClientRect();
    const cr = this.content.getBoundingClientRect();
    this.grip.style.left = `${r.left - cr.left + this.content.scrollLeft - 15}px`;
    this.grip.style.top = `${first.top - cr.top + this.content.scrollTop + first.height / 2 - 9}px`;
    this.grip.hidden = false;
    this._gripLi = li;
  }

  _dragItem(e) {
    const li = this._gripLi;
    if (!li || this.locked) return;
    e.preventDefault();
    this.grip.setPointerCapture(e.pointerId);
    const group = [li, ...(li.nextElementSibling && /^(UL|OL)$/.test(li.nextElementSibling.nodeName) ? [li.nextElementSibling] : [])];
    group.forEach(n => n.classList.add('dragging-item'));
    this._draggingItem = true;
    let target = null;
    let before = true;
    const move = (ev) => {
      const hit = this._itemAt(ev.clientX, ev.clientY, group);
      if (!hit) { target = null; this.itemDrop.hidden = true; return; }
      target = hit.li;
      before = ev.clientY < hit.r.top + hit.r.height / 2;
      const cr = this.content.getBoundingClientRect();
      this.itemDrop.style.left = `${hit.r.left - cr.left + this.content.scrollLeft}px`;
      this.itemDrop.style.width = `${hit.r.width}px`;
      this.itemDrop.style.top = `${(before ? hit.r.top : hit.r.bottom) - cr.top + this.content.scrollTop - 1}px`;
      this.itemDrop.hidden = false;
    };
    const up = () => {
      this.grip.removeEventListener('pointermove', move);
      this.grip.removeEventListener('pointerup', up);
      this.grip.removeEventListener('pointercancel', up);
      group.forEach(n => n.classList.remove('dragging-item'));
      this._draggingItem = false;
      this.itemDrop.hidden = true;
      if (target && moveItem(li, target, before)) this.changed();
      this._placeGrip(li.isConnected ? li : null);
    };
    this.grip.addEventListener('pointermove', move);
    this.grip.addEventListener('pointerup', up);
    this.grip.addEventListener('pointercancel', up);
  }

  toggleInlineCode() {
    const code = this.closest('code');
    if (code && !code.closest('pre')) {
      const text = document.createTextNode(code.textContent.replace(/​/g, ''));
      code.replaceWith(text);
      const r = document.createRange();
      r.selectNodeContents(text);
      this.selectRange(r);
      this.changed();
      return;
    }
    const r = this.range();
    if (!r) return;
    if (r.collapsed) {
      this.exec('insertHTML', `<code>${ZWSP}</code>`);
      return;
    }
    const text = r.toString();
    if (text.includes('\n')) return this.exec('formatBlock', 'pre');
    this.exec('insertHTML', `<code>${escapeHtml(text)}</code>${ZWSP}`);
  }

  insertRule() {
    this.exec('insertHorizontalRule');
    const hr = this.closest('hr') || [...this.el.querySelectorAll('hr')].pop();
    if (hr && !hr.nextElementSibling) {
      const p = document.createElement('p');
      p.innerHTML = '<br>';
      hr.after(p);
      const r = document.createRange();
      r.setStart(p, 0);
      r.collapse(true);
      this.selectRange(r);
    }
    this.changed();
  }

  insertHTML(html) {
    if (this.locked || !html) return;
    this.el.focus({ preventScroll: true });
    document.execCommand('insertHTML', false, html);
    this.changed();
  }

  insertPlainText(text) {
    if (this.locked || !text) return;
    this.el.focus({ preventScroll: true });
    document.execCommand('insertText', false, text.replace(/\r\n?/g, '\n'));
    this.changed();
  }

  // ---------- state for toolbar ----------
  state() {
    const q = (c) => { try { return document.queryCommandState(c); } catch { return false; } };
    const inChecklist = !!this.closest('ul.checklist');
    const checkItem = this.closest('ul.checklist > li');
    const block = this.blockOf(this.anchorElement());
    return {
      bold: q('bold'),
      italic: q('italic'),
      underline: q('underline'),
      strikeThrough: q('strikeThrough'),
      superscript: q('superscript'),
      subscript: q('subscript'),
      insertUnorderedList: q('insertUnorderedList') && !inChecklist,
      insertOrderedList: q('insertOrderedList'),
      checklist: inChecklist,
      code: !!this.closest('code'),
      link: !!this.closest('a'),
      justifyLeft: false,
      justifyCenter: q('justifyCenter'),
      justifyRight: q('justifyRight'),
      block: checkItem
        ? ((/\b(h[1-3])\b/.exec(checkItem.className) || [])[1] || 'p')
        : (block && block !== this.el ? block.nodeName.toLowerCase() : 'p')
    };
  }

  // ---------- links ----------
  linkContext() {
    const a = this.closest('a');
    const r = this.range();
    return { anchor: a, text: a ? a.textContent : (r ? r.toString() : ''), url: a ? a.getAttribute('href') : '' };
  }

  applyLink({ anchor, text, url }) {
    const href = normalizeUrl(url);
    this.restoreSelection();
    if (!href) return;
    if (anchor && this.el.contains(anchor)) {
      anchor.setAttribute('href', href);
      if (text && text !== anchor.textContent) anchor.textContent = text;
      this.changed();
      return;
    }
    const r = this.range();
    const selected = r ? r.toString() : '';
    if (selected && (!text || text === selected)) this.exec('createLink', href);
    else this.insertHTML(`<a href="${escapeHtml(href)}">${escapeHtml(text || url)}</a>${ZWSP}`);
  }

  removeLink(anchor) {
    const a = anchor || this.closest('a');
    if (!a) return;
    a.replaceWith(...a.childNodes);
    this.changed();
  }

  // ---------- images ----------
  async insertImageFiles(files, range) {
    const imgs = files.filter(f => f && f.type && f.type.startsWith('image/'));
    if (!imgs.length) return 0;
    const html = [];
    for (const f of imgs) {
      try {
        const bytes = new Uint8Array(await f.arrayBuffer());
        const { url } = await this.api.saveImage(bytes, f.type);
        html.push(`<img src="${url}" alt="">`);
      } catch (err) {
        this.toast(`Couldn't add image: ${err.message || err}`);
      }
    }
    if (!html.length) return 0;
    if (range) this.selectRange(range);
    this.insertHTML(html.join(''));
    return html.length;
  }

  async insertImageUrls(items) {
    if (!items.length) return;
    this.restoreSelection();
    this.insertHTML(items.map(it => `<img src="${it.url}" alt="">`).join(''));
  }

  async localizeImages() {
    const pending = [...this.el.querySelectorAll('img')].filter(img => !img.getAttribute('src').startsWith('sticky-img:') && !img.dataset.tried);
    for (const img of pending) {
      img.dataset.tried = '1';
      img.classList.add('loading');
      try {
        const res = await this.api.localizeImage(img.getAttribute('src'));
        if (res && res.url && img.isConnected) {
          img.setAttribute('src', res.url);
          this.onChange();
        }
      } catch { /* keep remote image */ }
      img.classList.remove('loading');
      delete img.dataset.tried;
    }
  }

  selectImage(img) {
    if (this.selectedImg && this.selectedImg !== img) this.selectedImg.classList.remove('selected');
    this.selectedImg = img;
    img.classList.add('selected');
    const r = document.createRange();
    r.selectNode(img);
    this.selectRange(r);
    if (!this.locked) { this.imgTools.hidden = false; this.positionImgTools(); }
  }

  deselectImage() {
    if (this.selectedImg) this.selectedImg.classList.remove('selected');
    this.selectedImg = null;
    this.imgTools.hidden = true;
  }

  deleteImage(img) {
    if (!img || this.locked) return;
    this.selectImage(img);
    document.execCommand('delete');
    this.deselectImage();
    this.changed();
  }

  // "Behind text" and "In front of text" images are absolutely positioned in the editor.
  isFloating(img) {
    const w = img && img.getAttribute('data-wrap');
    return w === 'behind' || w === 'front';
  }

  positionImgTools() {
    const img = this.selectedImg;
    if (!img || !img.isConnected || this.imgTools.hidden) return;
    const ir = img.getBoundingClientRect();
    const cr = this.content.getBoundingClientRect();
    const ox = this.content.scrollLeft - cr.left;
    const oy = this.content.scrollTop - cr.top;
    const corners = { nw: [ir.left, ir.top], ne: [ir.right, ir.top], sw: [ir.left, ir.bottom], se: [ir.right, ir.bottom] };
    for (const h of this.handles) {
      const [x, y] = corners[h.dataset.corner];
      h.style.left = `${x + ox}px`;
      h.style.top = `${y + oy}px`;
    }
    // Layout bar: above the image when it fits in view, otherwise below it, otherwise inside the top edge.
    const bar = this.imgBar;
    const bw = bar.offsetWidth;
    const bh = bar.offsetHeight;
    const bx = Math.max(cr.left + 4, Math.min(ir.left + ir.width / 2 - bw / 2, cr.right - bw - 4));
    let by = ir.top - bh - 12;
    if (by < cr.top + 4) by = ir.bottom + 12;
    if (by + bh > cr.bottom - 4) by = Math.max(cr.top + 4, ir.top + 8);
    bar.style.left = `${bx + ox}px`;
    bar.style.top = `${by + oy}px`;
    const wrap = img.getAttribute('data-wrap') || 'inline';
    for (const b of bar.querySelectorAll('[data-set-wrap]')) b.classList.toggle('active', b.dataset.setWrap === wrap);
  }

  setImageSize(img, size) {
    if (!img || this.locked) return;
    const w = IMAGE_SIZES[size];
    if (w === undefined) return;
    if (w) img.style.width = w; else img.style.removeProperty('width');
    img.removeAttribute('width');
    if (!img.getAttribute('style')) img.removeAttribute('style');
    this.positionImgTools();
    this.changed();
  }

  setImageWrap(img, mode) {
    if (!img || this.locked || !WRAP_MODES.includes(mode)) return;
    const wasFloating = this.isFloating(img);
    const willFloat = mode === 'behind' || mode === 'front';
    if (willFloat && !wasFloating) {
      // Pin it exactly where it is now so switching layout doesn't make it jump.
      const er = this.el.getBoundingClientRect();
      const ir = img.getBoundingClientRect();
      img.style.left = `${Math.round((ir.left - er.left) / this.zoom)}px`;
      img.style.top = `${Math.round((ir.top - er.top) / this.zoom)}px`;
      img.style.width = `${Math.round(ir.width / this.zoom)}px`;
    } else if (!willFloat && wasFloating) {
      img.style.removeProperty('left');
      img.style.removeProperty('top');
    }
    if (mode === 'inline') img.removeAttribute('data-wrap');
    else img.setAttribute('data-wrap', mode);
    img.removeAttribute('width');
    this.selectImage(img);
    this.changed();
  }

  nudgeImage(img, dx, dy) {
    img.style.left = `${Math.round((parseFloat(img.style.left) || 0) + dx)}px`;
    img.style.top = `${Math.round(Math.max(0, (parseFloat(img.style.top) || 0) + dy))}px`;
    this.positionImgTools();
    this.changed();
  }

  // Resize from any corner, keeping the aspect ratio. The corner follows whichever
  // mouse axis moved further, like Word.
  _startResize(e, corner) {
    const img = this.selectedImg;
    if (!img || this.locked) return;
    e.preventDefault();
    e.stopPropagation();
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    const z = this.zoom;
    const r0 = img.getBoundingClientRect();
    const startW = r0.width / z;
    const startH = r0.height / z;
    const ratio = startW / (startH || 1);
    const sx = corner.includes('e') ? 1 : -1;
    const sy = corner.includes('s') ? 1 : -1;
    const floating = this.isFloating(img);
    const left0 = parseFloat(img.style.left) || 0;
    const top0 = parseFloat(img.style.top) || 0;
    const maxW = floating ? 4000 : Math.max(40, this.el.clientWidth - 32);
    const x0 = e.clientX;
    const y0 = e.clientY;
    const move = (ev) => {
      const fromX = startW + sx * (ev.clientX - x0) / z;
      const fromY = startW + sy * ((ev.clientY - y0) / z) * ratio;
      let w = Math.abs(fromX - startW) >= Math.abs(fromY - startW) ? fromX : fromY;
      w = Math.round(Math.max(24, Math.min(maxW, w)));
      img.style.width = `${w}px`;
      img.removeAttribute('width');
      if (floating) {
        // Keep the opposite corner anchored.
        if (sx < 0) img.style.left = `${Math.round(left0 + startW - w)}px`;
        if (sy < 0) img.style.top = `${Math.round(top0 + startH - w / ratio)}px`;
      }
      this.positionImgTools();
    };
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
      this.changed();
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  }

  // Drag an image: floating images move freely; inline/wrapped ones move to a new spot in the text.
  _startImageDrag(e, img) {
    const z = this.zoom;
    const x0 = e.clientX;
    const y0 = e.clientY;
    const floating = this.isFloating(img);
    const left0 = parseFloat(img.style.left) || 0;
    const top0 = parseFloat(img.style.top) || 0;
    const caret = this.dropCaret;
    let dragging = false;
    let dropRange = null;
    const move = (ev) => {
      if (!dragging) {
        if (this.locked || Math.hypot(ev.clientX - x0, ev.clientY - y0) < 4) return;
        dragging = true;
        if (!floating) img.classList.add('dragging');
      }
      if (floating) {
        img.style.left = `${Math.round(left0 + (ev.clientX - x0) / z)}px`;
        img.style.top = `${Math.round(Math.max(0, top0 + (ev.clientY - y0) / z))}px`;
        this.positionImgTools();
        return;
      }
      const r = document.caretRangeFromPoint(ev.clientX, ev.clientY);
      if (!r || !this.el.contains(r.startContainer) || r.startContainer === img) { dropRange = null; caret.hidden = true; return; }
      dropRange = r;
      let rect = r.getClientRects()[0] || r.getBoundingClientRect();
      if (!rect || !rect.height) {
        const near = r.startContainer.nodeType === 1 ? (r.startContainer.childNodes[r.startOffset] || r.startContainer) : r.startContainer.parentElement;
        if (near && near.getBoundingClientRect) rect = near.getBoundingClientRect();
      }
      const cr = this.content.getBoundingClientRect();
      caret.style.left = `${rect.left - cr.left + this.content.scrollLeft}px`;
      caret.style.top = `${rect.top - cr.top + this.content.scrollTop}px`;
      caret.style.height = `${Math.max(14, Math.min(rect.height || 20, 60))}px`;
      caret.hidden = false;
    };
    const up = () => {
      window.removeEventListener('mousemove', move, true);
      window.removeEventListener('mouseup', up, true);
      caret.hidden = true;
      img.classList.remove('dragging');
      if (!dragging) return;
      if (!floating && dropRange) {
        const oldParent = img.parentNode;
        dropRange.insertNode(img);
        if (oldParent && oldParent !== this.el && oldParent.isConnected && !oldParent.textContent.trim() && !oldParent.querySelector('img, br, hr, table')) {
          oldParent.innerHTML = '<br>';
        }
      }
      this.selectImage(img);
      this.changed();
    };
    window.addEventListener('mousemove', move, true);
    window.addEventListener('mouseup', up, true);
  }

  // A behind-text image sits under the paragraphs, so a click there normally lands on the text.
  // Treat it as a click on the image when the point isn't on actual characters (or Alt is held).
  _behindImageAt(x, y, force) {
    const imgs = [...this.el.querySelectorAll('img[data-wrap="behind"]')].reverse();
    const hit = imgs.find(img => { const b = img.getBoundingClientRect(); return x >= b.left && x <= b.right && y >= b.top && y <= b.bottom; });
    if (!hit || force) return hit || null;
    const pos = document.caretRangeFromPoint(x, y);
    if (pos && pos.startContainer.nodeType === 3) {
      const node = pos.startContainer;
      const probe = document.createRange();
      for (const [a, b] of [[pos.startOffset - 1, pos.startOffset], [pos.startOffset, pos.startOffset + 1]]) {
        if (a < 0 || b > node.length) continue;
        probe.setStart(node, a);
        probe.setEnd(node, b);
        const r = probe.getBoundingClientRect();
        if (x >= r.left - 2 && x <= r.right + 2 && y >= r.top && y <= r.bottom) return null;
      }
    }
    return hit;
  }

  // ---------- tables ----------
  insertTable(rows, cols) {
    const head = `<tr>${'<th><br></th>'.repeat(cols)}</tr>`;
    const body = `<tr>${'<td><br></td>'.repeat(cols)}</tr>`.repeat(Math.max(0, rows - 1));
    this.restoreSelection();
    this.insertHTML(`<table><thead>${head}</thead><tbody>${body}</tbody></table><p><br></p>`);
    // The caret lands in the paragraph after the new table; move it into the first cell.
    const block = this.blockOf(this.anchorElement());
    const prev = block && block !== this.el ? block.previousElementSibling : null;
    const table = prev && prev.nodeName === 'TABLE' ? prev : [...this.el.querySelectorAll('table')].pop();
    const cell = table && table.querySelector('th, td');
    if (cell) this._caretInto(cell);
  }

  _caretInto(cell) {
    const r = document.createRange();
    r.selectNodeContents(cell);
    r.collapse(true);
    this.selectRange(r);
  }

  tableOp(op, from) {
    const cell = (from && from.closest && from.closest('td, th')) || this.closest('td, th');
    if (!cell || this.locked) return;
    const row = cell.parentElement;
    const table = cell.closest('table');
    const rows = [...table.querySelectorAll('tr')];
    const col = [...row.children].indexOf(cell);
    const blankRow = () => {
      const tr = document.createElement('tr');
      for (let i = 0; i < row.children.length; i++) { const td = document.createElement('td'); td.innerHTML = '<br>'; tr.appendChild(td); }
      return tr;
    };
    switch (op) {
      case 'row-above': {
        const tr = blankRow();
        if (row.parentElement.nodeName === 'THEAD') { const tbody = table.tBodies[0] || table.appendChild(document.createElement('tbody')); tbody.prepend(tr); }
        else row.before(tr);
        break;
      }
      case 'row-below': {
        const tr = blankRow();
        if (row.parentElement.nodeName === 'THEAD') { const tbody = table.tBodies[0] || table.appendChild(document.createElement('tbody')); tbody.prepend(tr); }
        else row.after(tr);
        this._caretInto(tr.firstElementChild);
        break;
      }
      case 'col-left': case 'col-right':
        for (const tr of rows) {
          const ref = tr.children[col];
          const c = document.createElement(ref && ref.nodeName === 'TH' ? 'th' : 'td');
          c.innerHTML = '<br>';
          if (!ref) tr.appendChild(c);
          else if (op === 'col-left') ref.before(c); else ref.after(c);
        }
        break;
      case 'row-delete':
        if (rows.length <= 1) table.remove(); else row.remove();
        break;
      case 'col-delete':
        if (row.children.length <= 1) table.remove();
        else for (const tr of rows) if (tr.children[col]) tr.children[col].remove();
        break;
      case 'delete':
        table.remove();
        break;
      default: return;
    }
    this.changed();
  }

  _tabInTable(back) {
    const cell = this.closest('td, th');
    if (!cell) return false;
    const cells = [...cell.closest('table').querySelectorAll('th, td')];
    const i = cells.indexOf(cell);
    let next = cells[i + (back ? -1 : 1)];
    if (!next && !back) {
      this.tableOp('row-below', cells[cells.length - 1]);
      return true;
    }
    if (next) {
      const r = document.createRange();
      r.selectNodeContents(next);
      this.selectRange(r);
    }
    return true;
  }

  // ---------- find ----------
  findAll(query) {
    this.clearFind();
    const q = String(query || '').toLowerCase();
    if (!q || typeof Highlight === 'undefined') return 0;
    const walker = document.createTreeWalker(this.el, NodeFilter.SHOW_TEXT);
    const ranges = [];
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const text = node.data.toLowerCase();
      let i = text.indexOf(q);
      while (i !== -1) {
        const r = document.createRange();
        r.setStart(node, i);
        r.setEnd(node, i + q.length);
        ranges.push(r);
        i = text.indexOf(q, i + q.length);
      }
    }
    this.find = { ranges, index: ranges.length ? 0 : -1 };
    if (ranges.length) CSS.highlights.set('find', new Highlight(...ranges));
    this._showFind();
    return ranges.length;
  }

  findStep(dir) {
    const { ranges } = this.find;
    if (!ranges.length) return;
    this.find.index = (this.find.index + dir + ranges.length) % ranges.length;
    this._showFind();
  }

  _showFind() {
    const r = this.find.ranges[this.find.index];
    if (!r) { CSS.highlights && CSS.highlights.delete('find-current'); return; }
    CSS.highlights.set('find-current', new Highlight(r));
    const rect = r.getBoundingClientRect();
    const cr = this.content.getBoundingClientRect();
    if (rect.top < cr.top + 30 || rect.bottom > cr.bottom - 10) {
      this.content.scrollTop += rect.top - cr.top - cr.height / 3;
    }
  }

  clearFind() {
    if (typeof CSS !== 'undefined' && CSS.highlights) { CSS.highlights.delete('find'); CSS.highlights.delete('find-current'); }
    this.find = { ranges: [], index: -1 };
  }

  selectFindResult() {
    const r = this.find.ranges[this.find.index];
    if (r) { this.el.focus({ preventScroll: true }); this.selectRange(r); }
  }

  // ---------- markdown-style autoformat ----------
  _autoformatBlock() {
    const sel = getSelection();
    if (!sel.isCollapsed || !sel.anchorNode) return false;
    let block = this.blockOf(sel.anchorNode);
    if (block === this.el) {
      document.execCommand('formatBlock', false, 'p');
      block = this.blockOf(getSelection().anchorNode);
      if (block === this.el) return false;
    }
    const pre = document.createRange();
    pre.setStart(block, 0);
    pre.setEnd(sel.anchorNode, sel.anchorOffset);
    const t = pre.toString().replace(/ /g, ' ');
    const inLi = block.nodeName === 'LI';
    if (block.nodeName === 'PRE') return false;

    let action = null;
    let m;
    if (!inLi && (m = /^(#{1,3}) $/.exec(t))) action = () => document.execCommand('formatBlock', false, 'h' + m[1].length);
    else if (inLi && block.parentElement.matches('ul.checklist') && (m = /^(#{1,3}) $/.exec(t))) {
      action = () => { block.classList.remove('h1', 'h2', 'h3'); block.classList.add('h' + m[1].length); };
    }
    else if (!inLi && /^[-*+] $/.test(t)) action = () => document.execCommand('insertUnorderedList');
    else if (!inLi && /^1[.)] $/.test(t)) action = () => document.execCommand('insertOrderedList');
    else if ((m = /^\[( |x|X)?\] $/.exec(t))) {
      const checked = m[1] && m[1].toLowerCase() === 'x';
      action = () => {
        const list = this.closest('ul, ol');
        if (!list || list.nodeName !== 'UL') document.execCommand('insertUnorderedList');
        const ul = this.closest('ul');
        if (ul) ul.classList.add('checklist');
        const li = this.closest('li');
        if (li && checked) li.classList.add('checked');
      };
    } else if (!inLi && /^> $/.test(t)) action = () => document.execCommand('formatBlock', false, 'blockquote');
    if (!action) return false;

    this.selectRange(pre);
    document.execCommand('delete');
    action();
    this.changed();
    this.onSelection();
    return true;
  }

  _autoformatInline(ch) {
    const sel = getSelection();
    if (!sel.isCollapsed || !sel.anchorNode || sel.anchorNode.nodeType !== 3) return false;
    if (this.closest('code, pre')) return false;
    const node = sel.anchorNode;
    const before = node.data.slice(0, sel.anchorOffset);
    // `m` = marker length on each side.
    const rules = [
      { ch: '*', m: 2, re: /\*\*([^*\s](?:[^*]*[^*\s])?)\*\*$/, tag: 'b' },
      { ch: '_', m: 2, re: /__([^_\s](?:[^_]*[^_\s])?)__$/, tag: 'b' },
      { ch: '*', m: 1, re: /(?:^|[^*\w])\*([^*\s](?:[^*]*[^*\s])?)\*$/, tag: 'i' },
      { ch: '_', m: 1, re: /(?:^|[^_\w])_([^_\s](?:[^_]*[^_\s])?)_$/, tag: 'i' },
      { ch: '~', m: 2, re: /~~([^~\s](?:[^~]*[^~\s])?)~~$/, tag: 's' },
      { ch: '`', m: 1, re: /(?:^|[^`])`([^`]+)`$/, tag: 'code' },
      { ch: '=', m: 2, re: /==([^=\s](?:[^=]*[^=\s])?)==$/, tag: 'mark' }
    ];
    for (const rule of rules) {
      if (rule.ch !== ch) continue;
      const m = rule.re.exec(before);
      if (!m) continue;
      const inner = m[1];
      const start = sel.anchorOffset - inner.length - rule.m * 2;
      const r = document.createRange();
      r.setStart(node, start);
      r.setEnd(node, sel.anchorOffset);
      this.selectRange(r);
      const body = escapeHtml(inner);
      if (rule.tag === 'code') document.execCommand('insertHTML', false, `<code>${body}</code>${ZWSP}`);
      else if (rule.tag === 'mark') document.execCommand('insertHTML', false, `<span style="background-color: #FFE45C;">${body}</span>${ZWSP}`);
      else {
        document.execCommand('insertHTML', false, `<${rule.tag}>${body}</${rule.tag}>`);
        const cmd = { b: 'bold', i: 'italic', s: 'strikeThrough' }[rule.tag];
        if (document.queryCommandState(cmd)) document.execCommand(cmd); // stop the style from continuing
      }
      this.changed();
      return true;
    }
    return false;
  }

  _linkifyBeforeCaret(offsetFromCaret = 0) {
    const sel = getSelection();
    if (!sel.isCollapsed || !sel.anchorNode || sel.anchorNode.nodeType !== 3) return false;
    if (this.closest('a, code, pre')) return false;
    const node = sel.anchorNode;
    const end = sel.anchorOffset - offsetFromCaret;
    const m = URL_TAIL_RE.exec(node.data.slice(0, end));
    if (!m) return false;
    const url = m[1];
    const start = end - url.length;
    const caret = sel.anchorOffset;
    const r = document.createRange();
    r.setStart(node, start);
    r.setEnd(node, end);
    this.selectRange(r);
    document.execCommand('createLink', false, url.startsWith('www.') ? 'https://' + url : url);
    // Put the caret back after the space that triggered the link.
    const a = this.closest('a');
    const after = a && a.nextSibling;
    const back = document.createRange();
    if (after && after.nodeType === 3) back.setStart(after, Math.min(after.length, caret - end));
    else if (a) back.setStartAfter(a);
    else back.setStart(node, Math.min(node.length, caret));
    back.collapse(true);
    this.selectRange(back);
    this.changed();
    return true;
  }

  // ---------- events ----------
  _bind() {
    const el = this.el;
    document.execCommand('defaultParagraphSeparator', false, 'p');

    el.addEventListener('input', (e) => {
      this._stripLeakedStyles();
      this._fixBlockNesting();
      if (e.inputType === 'insertText' && e.data === ' ') {
        if (!this._autoformatBlock()) this._linkifyBeforeCaret(1);
      } else if (e.inputType === 'insertText' && e.data && '*_~`='.includes(e.data)) {
        this._autoformatInline(e.data);
      } else if (e.inputType === 'insertParagraph') {
        const li = this.closest('ul.checklist > li');
        // Enter clones the item's classes; a fresh empty item starts unticked and in normal style.
        if (li && !li.textContent.trim()) {
          li.classList.remove('checked', 'h1', 'h2', 'h3');
          if (!li.className) li.removeAttribute('class');
        }
      }
      if (e.inputType === 'insertText' && e.data) this._detectTrigger(e.data.slice(-1));
      if (this.suggest && this.suggest.isOpen) this.suggest.refresh();
      if (!el.firstChild) el.innerHTML = '<p><br></p>';
      this.deselectImage();
      this.changed();
    });

    document.addEventListener('selectionchange', () => {
      if (this.suggest && this.suggest.isOpen && this.suggest.query() === null) this.suggest.close();
    });
    el.addEventListener('blur', () => { if (this.suggest) setTimeout(() => { if (document.activeElement !== el) this.suggest.close(); }, 100); });

    if (this.grip) {
      this.content.addEventListener('mousemove', (e) => {
        if (this._draggingItem) return;
        if (e.target === this.grip) return;
        const hit = this._itemAt(e.clientX, e.clientY);
        if (!hit) { if (e.clientX > (this._gripLi ? this._gripLi.getBoundingClientRect().left : 0)) this.grip.hidden = true; return; }
        if (hit.li !== this._gripLi || this.grip.hidden) this._placeGrip(hit.li);
      });
      this.content.addEventListener('mouseleave', (e) => { if (e.relatedTarget !== this.grip) this.grip.hidden = true; });
      this.content.addEventListener('scroll', () => { this.grip.hidden = true; }, { passive: true });
      this.grip.addEventListener('pointerdown', (e) => this._dragItem(e));
    }

    el.addEventListener('keydown', (e) => this._onKeyDown(e));

    el.addEventListener('paste', (e) => this._onPaste(e));
    el.addEventListener('copy', (e) => this._onCopy(e, false));
    el.addEventListener('cut', (e) => this._onCopy(e, true));

    el.addEventListener('dragstart', () => { this.internalDrag = true; });
    el.addEventListener('dragend', () => { this.internalDrag = false; });
    this.content.addEventListener('dragover', (e) => {
      if (this.locked) return;
      if (this.internalDrag) return;
      const types = [...(e.dataTransfer.types || [])];
      if (types.includes('Files') || types.includes('text/html') || types.includes('text/plain')) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        if (types.includes('Files')) this.dropHint.hidden = false;
      }
    });
    this.content.addEventListener('dragleave', (e) => {
      if (!this.content.contains(e.relatedTarget)) this.dropHint.hidden = true;
    });
    this.content.addEventListener('drop', (e) => this._onDrop(e));

    el.addEventListener('mousedown', (e) => {
      const li = e.target.closest && e.target.closest('ul.checklist > li');
      if (li && el.contains(li)) {
        const r = li.getBoundingClientRect();
        const cs = getComputedStyle(li);
        const pad = parseFloat(cs.paddingLeft) * this.zoom;
        // The box sits on the first line, which large text in the item can make taller.
        let lineBottom = r.top + (parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.5) * this.zoom;
        const probe = document.createRange();
        probe.selectNodeContents(li);
        const first = probe.getClientRects()[0];
        if (first && first.top < lineBottom) lineBottom = Math.max(lineBottom, first.bottom);
        if (e.clientX - r.left < pad && e.clientY < lineBottom + 2) {
          e.preventDefault();
          this.toggleCheck(li);
          return;
        }
      }
      let img = e.target.nodeName === 'IMG' && el.contains(e.target) ? e.target : null;
      if (!img && e.button === 0) img = this._behindImageAt(e.clientX, e.clientY, e.altKey);
      if (img) {
        e.preventDefault();
        this.el.focus({ preventScroll: true });
        this.selectImage(img);
        if (e.button === 0) this._startImageDrag(e, img);
        return;
      }
      if (this.selectedImg) this.deselectImage();
    });

    el.addEventListener('click', (e) => {
      const a = e.target.closest && e.target.closest('a[href]');
      if (a && (e.ctrlKey || e.metaKey || this.locked)) {
        e.preventDefault();
        const href = a.getAttribute('href');
        if (href.startsWith('note://')) { if (this.onNoteLink) this.onNoteLink(href.slice(7)); }
        else this.api.openExternal(href);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && this.onTagClick) {
        const pos = document.caretRangeFromPoint(e.clientX, e.clientY);
        const tag = pos && tagAt(pos.startContainer, pos.startOffset);
        if (tag) { e.preventDefault(); this.onTagClick(tag); }
      }
    });

    el.addEventListener('dblclick', (e) => {
      if (e.target.nodeName === 'IMG') {
        e.preventDefault();
        this.api.openImage(e.target.getAttribute('src'));
      }
    });

    el.addEventListener('mouseover', (e) => {
      const a = e.target.closest && e.target.closest('a[href]');
      if (a && !a.title) {
        const internal = a.getAttribute('href').startsWith('note://');
        a.title = internal ? `${this.locked ? 'Click' : 'Ctrl+Click'} to open this note` : `${a.getAttribute('href')}\n${this.locked ? 'Click' : 'Ctrl+Click'} to open`;
      }
    });

    for (const h of this.handles) h.addEventListener('pointerdown', (e) => this._startResize(e, h.dataset.corner));
    this.imgBar.addEventListener('mousedown', (e) => e.preventDefault());
    this.imgBar.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b || !this.selectedImg) return;
      if (b.dataset.setWrap) this.setImageWrap(this.selectedImg, b.dataset.setWrap);
      else if (b.dataset.imgAction === 'delete') this.deleteImage(this.selectedImg);
    });
    this.content.addEventListener('scroll', () => this.positionImgTools(), { passive: true });
    new ResizeObserver(() => this.positionImgTools()).observe(this.el);

    document.addEventListener('contextmenu', (e) => {
      let t = e.target;
      if (t.nodeName !== 'IMG' && el.contains(t)) t = this._behindImageAt(e.clientX, e.clientY, e.altKey) || t;
      const isImg = t.nodeName === 'IMG' && el.contains(t);
      this.ctxTarget = t;
      window.__stickiesCtx = {
        editor: el.contains(t),
        inTable: !!(t.closest && t.closest('td, th') && el.contains(t)),
        onImage: isImg,
        imageSrc: isImg ? t.getAttribute('src') : null,
        imageWrap: isImg ? (t.getAttribute('data-wrap') || 'inline') : null,
        imageText: isImg ? (t.getAttribute('alt') || '') : '',
        inChecklist: !!(t.closest && t.closest('ul.checklist') && el.contains(t)),
        checklistReset: ((topChecklist(t, el) || {}).dataset || {}).reset || 'never',
        onLink: !!(t.closest && t.closest('a[href]'))
      };
      if (isImg) this.selectImage(t);
    }, true);
  }

  _onKeyDown(e) {
    if (this.locked) return;
    const mod = e.ctrlKey || e.metaKey;
    if (this.suggest && this.suggest.handleKey(e)) return;

    if (e.altKey && e.shiftKey && !mod && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      const li = this.closest('li');
      if (li) { e.preventDefault(); if (nudgeItem(li, e.key === 'ArrowUp')) this.changed(); }
      return;
    }

    if (this.selectedImg && this.isFloating(this.selectedImg) && /^Arrow/.test(e.key) && !mod && !e.altKey) {
      e.preventDefault();
      const step = e.shiftKey ? 10 : 1;
      const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
      const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
      this.nudgeImage(this.selectedImg, dx, dy);
      return;
    }

    if (e.key === 'Tab' && !mod && !e.altKey) {
      e.preventDefault();
      if (this._tabInTable(e.shiftKey)) return;
      if (this.closest('li')) { this.indentList(e.shiftKey); return; }
      if (!e.shiftKey) this.exec('insertText', '\t');
      return;
    }

    if (e.key === 'Enter' && !mod && !e.shiftKey) {
      this._linkifyBeforeCaret(0);
      const block = this.blockOf(getSelection().anchorNode);
      const text = block && block !== this.el ? block.textContent.replace(/​/g, '').trim() : '';
      if (block && block !== this.el && block.nodeName !== 'PRE') {
        if (/^(-{3,}|\*{3,}|_{3,})$/.test(text)) {
          e.preventDefault();
          const r = document.createRange();
          r.selectNodeContents(block);
          this.selectRange(r);
          document.execCommand('delete');
          this.insertRule();
          return;
        }
        if (/^(```|~~~)[\w-]*$/.test(text)) {
          e.preventDefault();
          const r = document.createRange();
          r.selectNodeContents(block);
          this.selectRange(r);
          document.execCommand('delete');
          this.exec('formatBlock', 'pre');
          return;
        }
      }
      // Leave a code block with Enter on an empty last line.
      const pre = this.closest('pre');
      if (pre) {
        const r = this.range();
        const tail = document.createRange();
        tail.setStart(r.endContainer, r.endOffset);
        tail.setEnd(pre, pre.childNodes.length);
        if (!tail.toString().length && /\n$/.test(pre.textContent)) {
          e.preventDefault();
          pre.textContent = pre.textContent.replace(/\n$/, '');
          const p = document.createElement('p');
          p.innerHTML = '<br>';
          pre.after(p);
          this._caretInto(p);
          this.changed();
          return;
        }
        e.preventDefault();
        this.exec('insertText', '\n');
        return;
      }
    }

    if (e.key === 'Backspace' && !mod) {
      // Backspace at the start of a heading/quote turns it back into normal text first.
      const r = this.range();
      if (r && r.collapsed) {
        const block = this.blockOf(r.startContainer);
        if (block && block.nodeName === 'LI' && /\bh[1-3]\b/.test(block.className)) {
          const pre = document.createRange();
          pre.setStart(block, 0);
          pre.setEnd(r.startContainer, r.startOffset);
          if (!pre.toString().length) { e.preventDefault(); this.formatBlock('p'); return; }
        }
        if (block && /^(H1|H2|H3|BLOCKQUOTE|PRE)$/.test(block.nodeName)) {
          const pre = document.createRange();
          pre.setStart(block, 0);
          pre.setEnd(r.startContainer, r.startOffset);
          if (!pre.toString().length) {
            e.preventDefault();
            this.exec('formatBlock', 'p');
            return;
          }
        }
      }
    }

    if (e.key === 'Escape' && this.selectedImg) { this.deselectImage(); return; }
  }

  async _onPaste(e) {
    e.preventDefault();
    if (this.locked) return;
    const dt = e.clipboardData;
    const plain = this.plainPasteNext;
    this.plainPasteNext = false;
    const text = dt.getData('text/plain');
    if (plain) { this.insertPlainText(text); return; }

    const internal = dt.getData(INTERNAL_MIME);
    if (internal) { this.insertHTML(sanitizeHtml(internal, { mode: 'stored' })); this.localizeImages(); return; }

    const html = dt.getData('text/html');
    const files = [...dt.files].filter(f => f.type.startsWith('image/'));
    const htmlIsJustImage = html && !stripTags(html).trim() && /<img\b/i.test(html);
    if (files.length && (!html || htmlIsJustImage)) {
      const range = this.range() && this.range().cloneRange();
      await this.insertImageFiles(files, range);
      return;
    }
    if (html) {
      const clean = sanitizeHtml(html, { mode: 'paste' });
      if (clean.trim()) { this.insertHTML(clean); this.localizeImages(); return; }
    }
    if (text) {
      const t = text.trim();
      if (/^(https?:\/\/|www\.)\S+$/i.test(t) && !/\s/.test(t)) {
        const r = this.range();
        if (r && !r.collapsed) { this.exec('createLink', normalizeUrl(t)); return; }
        this.insertHTML(`<a href="${escapeHtml(normalizeUrl(t))}">${escapeHtml(t)}</a>${ZWSP}`);
        return;
      }
      this.insertPlainText(text);
    }
  }

  _onCopy(e, cut) {
    const r = this.range();
    if (!r || r.collapsed) return;
    const holder = document.createElement('div');
    holder.appendChild(r.cloneContents());
    // A selection inside <b>/<span style=color>… doesn't include those elements, so
    // re-wrap the copy in its inline formatting ancestors to keep how it looks.
    let anc = r.commonAncestorContainer.nodeType === 3 ? r.commonAncestorContainer.parentNode : r.commonAncestorContainer;
    while (anc && anc !== this.el && !BLOCK_TAGS.has(anc.nodeName)) {
      if (INLINE_FORMAT.has(anc.nodeName)) {
        const wrap = anc.cloneNode(false);
        wrap.append(...holder.childNodes);
        holder.append(wrap);
      }
      anc = anc.parentNode;
    }
    holder.querySelectorAll('img.selected, li.pop').forEach(n => n.classList.remove('selected', 'pop'));
    const html = holder.innerHTML.replace(/​/g, '');
    e.preventDefault();
    e.clipboardData.setData('text/html', html);
    e.clipboardData.setData('text/plain', getSelection().toString().replace(/​/g, ''));
    e.clipboardData.setData(INTERNAL_MIME, html);
    if (cut && !this.locked) { document.execCommand('delete'); this.changed(); }
  }

  async _onDrop(e) {
    this.dropHint.hidden = true;
    if (this.locked || this.internalDrag) return;
    const dt = e.dataTransfer;
    const files = [...(dt.files || [])];
    const html = dt.getData('text/html');
    const text = dt.getData('text/plain');
    if (!files.length && !html && !text) return;
    e.preventDefault();
    const pos = document.caretRangeFromPoint(e.clientX, e.clientY);
    const range = pos && this.el.contains(pos.startContainer) ? pos : null;
    if (range) { this.el.focus({ preventScroll: true }); this.selectRange(range); }
    else this.focus(true);

    if (files.length) {
      const images = files.filter(f => f.type.startsWith('image/'));
      const texts = files.filter(f => !f.type.startsWith('image/') && (/^text\//.test(f.type) || /\.(md|markdown|txt|csv|json|log)$/i.test(f.name)));
      if (images.length) await this.insertImageFiles(images, this.range() && this.range().cloneRange());
      for (const f of texts) {
        if (f.size > 2 * 1024 * 1024) { this.toast(`${f.name} is too large to paste in`); continue; }
        this.insertPlainText(await f.text());
      }
      const skipped = files.length - images.length - texts.length;
      if (skipped) this.toast('Only images and text files can be dropped into a note');
      return;
    }
    if (html) {
      const clean = sanitizeHtml(html, { mode: 'paste' });
      if (clean.trim()) { this.insertHTML(clean); this.localizeImages(); return; }
    }
    if (text) this.insertPlainText(text);
  }
}

function stripTags(html) {
  return String(html).replace(/<!--[\s\S]*?-->/g, '').replace(/<(style|script)[\s\S]*?<\/\1>/gi, '').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ');
}

export function normalizeUrl(url) {
  const u = String(url || '').trim();
  if (!u) return '';
  if (/^(https?:|mailto:)/i.test(u)) return u;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(u)) return 'mailto:' + u;
  if (/^[\w-]+(\.[\w-]+)+(:\d+)?(\/\S*)?$/.test(u) || /^www\./i.test(u)) return 'https://' + u;
  return '';
}
