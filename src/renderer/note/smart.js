// Note "smarts": #tags and @due dates (highlighted without touching the DOM via the
// CSS Custom Highlight API), and checklist tools — ticked items sink to the bottom,
// drag to reorder, clear completed, scheduled resets and progress counts.

export const TAG_RE = /(^|[\s(,;])#([\p{L}\p{N}_][\p{L}\p{N}_\-/]{0,48})/gu;
const DUE_RE = /(^|\s)@([\w/+\-]{2,16})/g;
const SKIP = 'code, pre, a';

const pad = (n) => String(n).padStart(2, '0');
export const isoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

const WEEKDAYS = { sun: 0, sunday: 0, mon: 1, monday: 1, tue: 2, tues: 2, tuesday: 2, wed: 3, weds: 3, wednesday: 3, thu: 4, thur: 4, thurs: 4, thursday: 4, fri: 5, friday: 5, sat: 6, saturday: 6 };

// "@today", "@tomorrow", "@fri", "@nextweek", "@+3d", "@2w", "@2026-10-20", "@10/20" → "YYYY-MM-DD"
export function parseDue(token, now = new Date()) {
  const t = String(token).toLowerCase().replace(/[.,;:!?)]+$/, '');
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const add = (days) => { d.setDate(d.getDate() + days); return isoDate(d); };
  if (t === 'today' || t === 'tod' || t === 'tonight') return isoDate(d);
  if (t === 'tomorrow' || t === 'tmr' || t === 'tmrw') return add(1);
  if (t in WEEKDAYS) return add((WEEKDAYS[t] - d.getDay() + 7) % 7);
  if (t === 'nextweek' || t === 'next-week') return add(((8 - d.getDay()) % 7) || 7);
  if (t === 'weekend') return add((6 - d.getDay() + 7) % 7);
  let m = /^\+?(\d{1,3})([dw])$/.exec(t);
  if (m) return add(Number(m[1]) * (m[2] === 'w' ? 7 : 1));
  m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  if (m) return isoDate(new Date(+m[1], +m[2] - 1, +m[3]));
  m = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/.exec(t);
  if (m) {
    const y = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : d.getFullYear();
    const date = new Date(y, Number(m[1]) - 1, Number(m[2]));
    if (date.getMonth() !== Number(m[1]) - 1) return null;
    return isoDate(date);
  }
  return null;
}

export function dueLabel(iso, now = new Date()) {
  if (!iso) return '';
  const [y, mo, da] = iso.split('-').map(Number);
  const d = new Date(y, mo - 1, da);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diff = Math.round((d - today) / 864e5);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  if (diff > 1 && diff < 7) return d.toLocaleDateString(undefined, { weekday: 'long' });
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
}

// Text belonging to an item itself (not its sub-items or nested lists).
export function ownText(li) {
  let t = '';
  for (const c of li.childNodes) {
    if (c.nodeType === 1 && (c.nodeName === 'UL' || c.nodeName === 'OL')) continue;
    t += c.textContent;
  }
  return t.replace(/​/g, '');
}

function textNodes(root) {
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentElement && n.parentElement.closest(SKIP) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT)
  });
  const out = [];
  while (w.nextNode()) out.push(w.currentNode);
  return out;
}

// Highlight #tags and @dates, and keep each checklist item's data-due in sync with its "@…".
export function decorate(editorEl) {
  if (typeof Highlight === 'undefined') return;
  const tags = [];
  const due = [];
  const late = [];
  const today = isoDate(new Date());
  for (const node of textNodes(editorEl)) {
    const text = node.data;
    for (const m of text.matchAll(TAG_RE)) {
      if (/^\d+$/.test(m[2])) continue;
      const r = new Range();
      const start = m.index + m[1].length;
      r.setStart(node, start);
      r.setEnd(node, start + 1 + m[2].length);
      tags.push(r);
    }
    const li = node.parentElement && node.parentElement.closest('ul.checklist > li');
    if (!li) continue;
    for (const m of text.matchAll(DUE_RE)) {
      const iso = parseDue(m[2]);
      if (!iso) continue;
      const r = new Range();
      const start = m.index + m[1].length;
      r.setStart(node, start);
      r.setEnd(node, start + 1 + m[2].length);
      ((li.dataset.due || iso) < today && !li.classList.contains('checked') ? late : due).push(r);
    }
  }
  CSS.highlights.set('tag', new Highlight(...tags));
  CSS.highlights.set('due', new Highlight(...due));
  CSS.highlights.set('due-late', new Highlight(...late));
}

// Resolve "@fri" to a fixed date once, when it's typed, so it doesn't drift to next Friday.
export function syncDueDates(editorEl) {
  let changed = false;
  for (const li of editorEl.querySelectorAll('ul.checklist > li')) {
    const m = /(?:^|\s)@([\w/+\-]{2,16})/.exec(ownText(li));
    const token = m ? m[1].toLowerCase() : null;
    const iso = token ? parseDue(token) : null;
    if (!iso) {
      if (li.hasAttribute('data-due')) { li.removeAttribute('data-due'); li.removeAttribute('data-due-src'); changed = true; }
      continue;
    }
    if (li.dataset.dueSrc === token && li.dataset.due) continue;
    li.dataset.due = iso;
    li.dataset.dueSrc = token;
    changed = true;
  }
  return changed;
}

export function tagAt(node, offset) {
  if (!node || node.nodeType !== 3 || (node.parentElement && node.parentElement.closest(SKIP))) return null;
  for (const m of node.data.matchAll(TAG_RE)) {
    const start = m.index + m[1].length;
    if (offset >= start && offset <= start + 1 + m[2].length && !/^\d+$/.test(m[2])) return m[2].toLowerCase();
  }
  return null;
}

// ---------- checklists ----------
export function checklistItems(editorEl) {
  return [...editorEl.querySelectorAll('ul.checklist > li')];
}

export function progress(editorEl) {
  const items = checklistItems(editorEl);
  return { total: items.length, done: items.filter(li => li.classList.contains('checked')).length };
}

// Sub-items directly under an item, for both nesting styles: the list right after the
// item (what Tab produces) or a list inside it (pasted HTML).
export function subItems(li) {
  const lists = [];
  const next = li.nextElementSibling;
  if (next && (next.nodeName === 'UL' || next.nodeName === 'OL')) lists.push(next);
  for (const c of li.children) if (c.nodeName === 'UL' || c.nodeName === 'OL') lists.push(c);
  return lists.flatMap(l => [...l.children].filter(c => c.nodeName === 'LI'));
}

export function parentItem(li) {
  const list = li.parentElement;
  const holder = list && list.parentElement;
  if (!holder) return null;
  if (holder.nodeName === 'LI') return holder;
  if (holder.nodeName === 'UL' || holder.nodeName === 'OL') {
    const prev = list.previousElementSibling;
    return prev && prev.nodeName === 'LI' ? prev : null;
  }
  return null;
}

const isCheckItem = (li) => !!(li && li.parentElement && li.parentElement.matches('ul.checklist'));

// After an item is (un)ticked: its sub-items follow it, and each parent above it is ticked
// exactly when all of its sub-items are. Returns the parents whose state changed.
export function cascadeCheck(li) {
  const checked = li.classList.contains('checked');
  const down = (item) => {
    for (const c of subItems(item)) {
      if (isCheckItem(c)) c.classList.toggle('checked', checked);
      down(c);
    }
  };
  down(li);
  const changed = [];
  for (let p = parentItem(li); p && isCheckItem(p); p = parentItem(p)) {
    const kids = subItems(p).filter(isCheckItem);
    if (!kids.length) break;
    const all = kids.every(k => k.classList.contains('checked'));
    if (p.classList.contains('checked') === all) break;
    p.classList.toggle('checked', all);
    changed.push(p);
  }
  return changed;
}

// An item plus the sub-list that holds its sub-items (the list right after it).
export function itemGroup(li) {
  const next = li.nextElementSibling;
  return next && (next.nodeName === 'UL' || next.nodeName === 'OL') ? [li, next] : [li];
}

function keepSelection(fn) {
  const sel = getSelection();
  const saved = sel.rangeCount ? [sel.anchorNode, sel.anchorOffset, sel.focusNode, sel.focusOffset] : null;
  fn();
  if (saved && saved[0] && saved[0].isConnected && saved[2].isConnected) {
    try { sel.setBaseAndExtent(...saved); } catch { /* ignore */ }
  }
}

// Move a just-(un)ticked item: ticked ones go below the unticked ones in their list.
export function sinkItem(li) {
  const list = li.parentElement;
  if (!list || !list.matches('ul.checklist')) return false;
  const group = itemGroup(li);
  const items = [...list.children].filter(c => c.nodeName === 'LI' && c !== li);
  const follows = (a, b) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING); // b comes after a
  let ref; // insert the group before this node (null = at the end)
  if (li.classList.contains('checked')) {
    const lastOpen = items.filter(c => !c.classList.contains('checked')).pop();
    if (!lastOpen || follows(lastOpen, li)) return false; // nothing unticked below it
    const g = itemGroup(lastOpen);
    ref = g[g.length - 1].nextSibling;
  } else {
    const firstDone = items.find(c => c.classList.contains('checked'));
    if (!firstDone || follows(li, firstDone)) return false; // already above the ticked ones
    ref = firstDone;
  }
  keepSelection(() => { for (const n of group) list.insertBefore(n, ref); });
  return true;
}

export function moveItem(li, target, before) {
  const group = itemGroup(li);
  if (group.some(n => n === target || n.contains(target))) return false;
  const tGroup = itemGroup(target);
  const ref = before ? target : tGroup[tGroup.length - 1].nextSibling;
  const parent = target.parentElement;
  const oldList = li.parentElement;
  keepSelection(() => { for (const n of group) parent.insertBefore(n, ref); });
  if (oldList && !oldList.children.length) oldList.remove();
  return true;
}

// Alt+Shift+Up/Down: swap an item with its neighbour in the same list.
export function nudgeItem(li, up) {
  const list = li.parentElement;
  const siblings = [...list.children].filter(c => c.nodeName === 'LI');
  const i = siblings.indexOf(li);
  const other = siblings[i + (up ? -1 : 1)];
  if (!other) return false;
  return moveItem(li, other, up);
}

export function clearTicked(scope) {
  const done = [...scope.querySelectorAll('ul.checklist > li.checked')];
  for (const li of done) for (const n of itemGroup(li)) n.remove();
  for (const ul of scope.querySelectorAll('ul.checklist')) if (!ul.children.length) ul.remove();
  return done.length;
}

export function topChecklist(node, editorEl) {
  let el = node && (node.nodeType === 1 ? node : node.parentElement);
  let top = null;
  while (el && el !== editorEl) {
    if (el.matches && el.matches('ul.checklist')) top = el;
    el = el.parentElement;
  }
  return top;
}

export function setReset(list, mode) {
  if (!list) return;
  if (mode === 'daily' || mode === 'weekly') {
    list.dataset.reset = mode;
    list.dataset.resetAt = String(Date.now());
  } else {
    delete list.dataset.reset;
    delete list.dataset.resetAt;
  }
}

function isResetDue(mode, last, now) {
  const d = new Date(last || 0);
  d.setHours(0, 0, 0, 0);
  if (mode === 'daily') d.setDate(d.getDate() + 1);
  else if (mode === 'weekly') d.setDate(d.getDate() + (((8 - d.getDay()) % 7) || 7));
  else return false;
  return now >= d.getTime();
}

export function applyResets(editorEl, now = Date.now()) {
  let changed = false;
  for (const list of editorEl.querySelectorAll('ul.checklist[data-reset]')) {
    if (!isResetDue(list.dataset.reset, Number(list.dataset.resetAt), now)) continue;
    list.querySelectorAll('li.checked').forEach(li => li.classList.remove('checked'));
    list.dataset.resetAt = String(now);
    changed = true;
  }
  return changed;
}
