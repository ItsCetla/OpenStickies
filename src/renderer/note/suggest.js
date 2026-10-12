import { icon } from '../shared/icons.js';
import { escapeHtml } from '../shared/sanitize.js';

// An inline suggestion menu that follows the caret: "#" for tags, "[[" for links to
// other notes and "/" for commands. The text typed after the trigger filters the list.
//
// Usage: suggest.open({ trigger, node, start, source(query) -> items, pick(item, query) })
// items: { label, sub?, icon?, color?, … }

const RULES = {
  '#': { maxLen: 48, stop: /\s/ },
  '[[': { maxLen: 80, stop: /\]\]|\n/ },
  '/': { maxLen: 30, stop: /\s\s|\n/ }
};

export class Suggest {
  constructor(el) {
    this.el = el;
    this.session = null;
    this.items = [];
    this.index = 0;
    this._seq = 0;
    el.addEventListener('mousedown', (e) => {
      e.preventDefault(); // keep the caret in the editor
      const row = e.target.closest('[data-i]');
      if (row) { this.index = Number(row.dataset.i); this.accept(); }
    });
    el.addEventListener('mousemove', (e) => {
      const row = e.target.closest('[data-i]');
      if (row && Number(row.dataset.i) !== this.index) { this.index = Number(row.dataset.i); this._highlight(); }
    });
  }

  get isOpen() { return !!this.session; }

  open(session) {
    this.session = { ...session, rule: RULES[session.trigger] };
    this.refresh();
  }

  close() {
    if (!this.session) return;
    this.session = null;
    this.el.hidden = true;
    this.items = [];
  }

  // Text typed after the trigger, or null when the caret has left the trigger's text.
  query() {
    const s = this.session;
    const sel = getSelection();
    if (!s || !sel.isCollapsed || sel.anchorNode !== s.node || !s.node.isConnected) return null;
    const from = s.start + s.trigger.length;
    if (sel.anchorOffset < from || s.node.data.slice(s.start, from) !== s.trigger) return null;
    const q = s.node.data.slice(from, sel.anchorOffset).replace(/ /g, ' ');
    if (q.length > s.rule.maxLen || s.rule.stop.test(q)) return null;
    return q;
  }

  // Range covering the trigger and the typed query (what a pick replaces).
  range() {
    const r = document.createRange();
    r.setStart(this.session.node, this.session.start);
    r.setEnd(this.session.node, getSelection().anchorOffset);
    return r;
  }

  async refresh() {
    const q = this.query();
    if (q === null) { this.close(); return; }
    const seq = ++this._seq;
    const items = await this.session.source(q);
    if (!this.session || seq !== this._seq) return;
    this.items = items.slice(0, 9);
    this.index = 0;
    this._render(q);
  }

  _render(q) {
    if (!this.items.length) { this.el.hidden = true; return; }
    this.el.innerHTML = this.items.map((it, i) => `
      <div class="sg-item" data-i="${i}">
        ${it.color ? `<span class="sg-dot" style="background:${it.color}"></span>` : `<span class="sg-icon">${icon(it.icon || 'chevronRight', { size: 16 })}</span>`}
        <span class="sg-label">${highlight(it.label, q)}</span>
        ${it.sub ? `<span class="sg-sub">${escapeHtml(it.sub)}</span>` : ''}
      </div>`).join('');
    this.el.hidden = false;
    this._highlight();
    this._position();
  }

  _highlight() {
    [...this.el.children].forEach((row, i) => row.classList.toggle('active', i === this.index));
    const active = this.el.children[this.index];
    if (active) active.scrollIntoView({ block: 'nearest' });
  }

  _position() {
    const sel = getSelection();
    if (!sel.rangeCount) return;
    const r = sel.getRangeAt(0).cloneRange();
    let rect = r.getClientRects()[0] || r.getBoundingClientRect();
    if (!rect || (!rect.height && !rect.left)) rect = this.session.node.parentElement.getBoundingClientRect();
    const w = this.el.offsetWidth;
    const h = this.el.offsetHeight;
    let x = Math.max(6, Math.min(rect.left - 10, innerWidth - w - 6));
    let y = rect.bottom + 4;
    if (y + h > innerHeight - 6) y = Math.max(6, rect.top - h - 4);
    this.el.style.left = `${Math.round(x)}px`;
    this.el.style.top = `${Math.round(y)}px`;
  }

  accept() {
    const item = this.items[this.index];
    const s = this.session;
    if (!item || !s) return false;
    const q = this.query() ?? '';
    const range = this.range();
    this.close();
    s.pick(item, q, range);
    return true;
  }

  // Returns true when the key was used by the menu.
  handleKey(e) {
    if (!this.session || this.el.hidden) {
      if (this.session && e.key === 'Escape') { this.close(); return true; }
      return false;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const n = this.items.length;
      this.index = (this.index + (e.key === 'ArrowDown' ? 1 : -1) + n) % n;
      this._highlight();
      return true;
    }
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      return this.accept();
    }
    if (e.key === 'Escape') { e.preventDefault(); this.close(); return true; }
    return false;
  }
}

function highlight(label, q) {
  const text = String(label);
  const i = q ? text.toLowerCase().indexOf(q.toLowerCase()) : -1;
  if (i < 0) return escapeHtml(text);
  return escapeHtml(text.slice(0, i)) + '<b>' + escapeHtml(text.slice(i, i + q.length)) + '</b>' + escapeHtml(text.slice(i + q.length));
}

// Rank items whose label/keywords match the query: word starts first, then anywhere.
export function rank(items, q, key = (it) => `${it.label} ${it.keywords || ''}`) {
  const query = q.trim().toLowerCase();
  if (!query) return items;
  const scored = [];
  for (const it of items) {
    const hay = key(it).toLowerCase();
    let score = -1;
    if (hay.startsWith(query)) score = 3;
    else if (new RegExp(`(^|[\\s\\-_/(])${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(hay)) score = 2;
    else if (hay.includes(query)) score = 1;
    if (score > 0) scored.push([score, it]);
  }
  return scored.sort((a, b) => b[0] - a[0]).map(x => x[1]);
}
