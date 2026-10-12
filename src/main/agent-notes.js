'use strict';

// Task notes kept up to date by AI coding agents (OpenCode, via its plugin). One note per
// task, identified by a key such as "opencode:<session id>". The agent's plan is shown as a
// checklist: done steps ticked, the current step marked ▶, skipped steps struck through, and
// everything still to do left open. The note is locked so typing can't fight the agent.

const { esc, mdToHtml, textToHtml } = require('./markdown');
const scan = require('./html-scan');

const STATUS = ['pending', 'in_progress', 'completed', 'cancelled'];

function cleanItems(list) {
  return (Array.isArray(list) ? list : []).slice(0, 150).map(it => ({
    text: String((it && (it.text ?? it.content)) || '').replace(/\s+/g, ' ').trim().slice(0, 400),
    status: STATUS.includes(it && it.status) ? it.status : (it && it.done ? 'completed' : 'pending')
  })).filter(it => it.text);
}

function itemHtml(it) {
  if (it.status === 'completed') return `<li class="checked">${esc(it.text)}</li>`;
  if (it.status === 'cancelled') return `<li class="checked"><s>${esc(it.text)}</s> <i>(skipped)</i></li>`;
  if (it.status === 'in_progress') return `<li><b>▶ ${esc(it.text)}</b></li>`;
  return `<li>${esc(it.text)}</li>`;
}

function statusLine(items, status) {
  const total = items.length;
  const done = items.filter(i => i.status === 'completed' || i.status === 'cancelled').length;
  const current = items.findIndex(i => i.status === 'in_progress');
  if (status === 'error') return `⚠ Stopped with an error — ${done} of ${total} done`;
  if (total && done === total) return `✓ All ${total} step${total === 1 ? '' : 's'} done`;
  if (status === 'idle') return `⏸ Waiting for you — ${done} of ${total} done`;
  if (current >= 0) return `Working on step ${current + 1} of ${total}`;
  return `Working — ${done} of ${total} done`;
}

const toTag = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}_-]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 40);

function renderAgentNote(body, now = new Date()) {
  const source = String(body.source || 'AI agent').slice(0, 40);
  const project = String(body.project || '').slice(0, 80);
  const title = String(body.title || `${source} task`).replace(/\s+/g, ' ').trim().slice(0, 120);
  const items = cleanItems(body.items);
  const sections = (Array.isArray(body.sections) ? body.sections : []).slice(0, 20)
    .map(s => ({ title: String((s && s.title) || 'Sub-task').slice(0, 120), items: cleanItems(s && s.items) }))
    .filter(s => s.items.length);
  const all = [...items, ...sections.flatMap(s => s.items)];
  const meta = [source, project, statusLine(all, body.status)].filter(Boolean).map(esc).join(' · ');
  const time = now.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const tags = ['#' + toTag(source), project ? '#' + toTag(project) : ''].filter(t => t.length > 1).join(' ');
  let html = `<h2>${esc(title)}</h2><p><span style="font-size: small;">${meta}</span></p>`;
  if (items.length) html += `<ul class="checklist">${items.map(itemHtml).join('')}</ul>`;
  for (const s of sections) html += `<p><b>↳ ${esc(s.title)}</b></p><ul class="checklist">${s.items.map(itemHtml).join('')}</ul>`;
  if (body.notes) html += `<p>${esc(String(body.notes).slice(0, 2000))}</p>`;
  html += `<p><span style="font-size: small;">${esc(tags)} · updated ${esc(time)}</span></p>`;
  return html;
}

// On a tabbed note the agent owns the first tab; note.html only mirrors whichever tab the
// user has open, so reading or writing it would clobber a tab the user added for themselves.
function agentHtml(note) {
  return note.tabs && note.tabs.length > 1 ? note.tabs[0].html : note.html;
}

// Let an open window save its last keystrokes first, or a pending tabs save could undo the
// write (or a tab added a moment ago would be missed). Re-read the note afterwards.
async function flushNote(windows, id) {
  await windows.flushRenderer(windows.windowFor(id), 600);
}

function writeAgentHtml(store, windows, note, html, extra = {}) {
  if (note.tabs && note.tabs.length > 1) {
    // Only the agent's page (tab 0) changes; text '' makes the store recompute it from html.
    const tabs = note.tabs.map((t, i) => (i === 0 ? { ...t, html, text: '' } : { ...t }));
    store.update(note.id, { ...extra, tabs, activeTab: note.activeTab });
    const n = store.get(note.id);
    windows.sendToNote(note.id, 'note:changed', { tabs: n.tabs, activeTab: n.activeTab, html: n.html });
    windows.applyNoteProps(note.id, ['title']);
  } else {
    store.update(note.id, { ...extra, html });
    windows.sendToNote(note.id, 'note:changed', { html });
  }
}

async function upsertAgentNote({ store, windows, key, body }) {
  if (!/^[\w.:\-]{1,200}$/.test(key)) throw new Error('Bad key');
  const html = renderAgentNote(body);
  let existing = store.all().find(n => n.agent && n.agent.key === key);
  if (existing) {
    if (existing.trashed) return { id: existing.id, skipped: 'deleted' }; // the user threw it away; leave it
    await flushNote(windows, existing.id);
    existing = store.get(existing.id) || existing;
    if (agentHtml(existing) !== html) writeAgentHtml(store, windows, existing, html);
    return { id: existing.id, updated: true };
  }
  const note = store.create({
    html,
    color: store.settings.agentColor || 'blue',
    bounds: windows.placeNewBounds(null),
    open: true,
    locked: true,
    agent: { key, source: String(body.source || '').slice(0, 40), project: String(body.project || '').slice(0, 80) }
  });
  windows.openNote(note.id, { focus: false }); // don't steal focus from the terminal
  return { id: note.id, created: true };
}

// ---------- notes an agent creates on request (the stickies_* tools / POST /v1/notes) ----------
// These remember their title and tags (in note.agent) so the agent can rewrite them later.
// The agent may only change notes it created; the user's own notes are off limits.

const FOOTER_RE = /<p><span style="font-size: small;?">(#[^<]*)<\/span><\/p>$/;

function cleanTags(tags, source, project) {
  const list = (Array.isArray(tags) ? tags : []).map(toTag).filter(Boolean);
  if (source) list.unshift(toTag(source));
  if (project) list.push(toTag(project));
  return [...new Set(list)].slice(0, 10);
}

function contentHtml(body) {
  if (typeof body.content === 'string') return mdToHtml(body.content);
  if (typeof body.markdown === 'string') return mdToHtml(body.markdown);
  if (typeof body.html === 'string') return body.html; // sanitized when the note window loads it
  return textToHtml(String(body.text || ''));
}

function apiNoteHtml(title, inner, tags) {
  let html = title ? `<h2>${esc(title)}</h2>` : '';
  html += inner;
  if (tags.length) html += `<p><span style="font-size: small;">${esc(tags.map(t => '#' + t).join(' '))}</span></p>`;
  return html;
}

function ownedNote(store, id) {
  const note = store.get(String(id || ''));
  if (!note || note.trashed) throw new Error('No such sticky note (it may have been deleted). Use stickies_list to see your notes.');
  if (!note.agent || !String(note.agent.key).startsWith('api:')) throw new Error('That note wasn’t created by the agent, so it can’t be changed.');
  if (note.private) throw new Error('That note has been made private by the user.');
  return note;
}

function itemsOf(html) {
  return scan.checklistEntries(html).map((e, i) => ({ n: i + 1, text: e.text, done: e.checked }));
}

function createNoteFromApi({ store, windows, body }) {
  const source = String(body.source || '').slice(0, 40);
  const project = String(body.project || '').slice(0, 80);
  const title = String(body.title || '').replace(/\s+/g, ' ').trim().slice(0, 120);
  const tags = cleanTags(body.tags, source, project);
  const html = apiNoteHtml(title, contentHtml(body), tags);
  const color = store.settings && body.color === undefined ? store.settings.agentColor : body.color;
  const note = store.create({
    html,
    color,
    bounds: windows.placeNewBounds(null),
    open: body.open !== false,
    agent: { key: `api:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, source, project, title, tags }
  });
  if (note.open) windows.openNote(note.id, { focus: false });
  return { id: note.id, title, items: itemsOf(html) };
}

async function updateApiNote({ store, windows, history, id, body }) {
  await flushNote(windows, ownedNote(store, id).id);
  const note = ownedNote(store, id);
  const before = agentHtml(note);
  const agent = { ...note.agent };
  if (typeof body.title === 'string' && body.title.trim()) agent.title = body.title.replace(/\s+/g, ' ').trim().slice(0, 120);
  if (Array.isArray(body.tags)) agent.tags = cleanTags(body.tags, agent.source, agent.project);
  let html;
  if (typeof body.content === 'string' || typeof body.markdown === 'string' || typeof body.html === 'string') {
    html = apiNoteHtml(agent.title, contentHtml(body), agent.tags || []);
  } else {
    html = before;
    if (typeof body.title === 'string' && body.title.trim()) {
      html = /^<h2>[\s\S]*?<\/h2>/.test(html) ? html.replace(/^<h2>[\s\S]*?<\/h2>/, `<h2>${esc(agent.title)}</h2>`) : `<h2>${esc(agent.title)}</h2>` + html;
    }
    if (typeof body.append === 'string' && body.append.trim()) {
      const extra = mdToHtml(body.append);
      const footer = FOOTER_RE.exec(html);
      html = footer ? html.slice(0, footer.index) + extra + footer[0] : html + extra;
    }
  }
  if (body.color && body.color !== note.color) {
    store.update(note.id, { color: body.color });
    windows.applyNoteProps(note.id, ['color']);
    windows.sendToNote(note.id, 'note:changed', { color: store.get(note.id).color });
  }
  if (html !== before) {
    if (history) history.beforeChange(note.id, before, note.updatedAt); // the user's own edits stay recoverable
    writeAgentHtml(store, windows, store.get(note.id) || note, html, { agent });
  } else {
    store.update(note.id, { agent });
  }
  return { id: note.id, title: agent.title, items: itemsOf(html) };
}

async function checkApiNote({ store, windows, id, body }) {
  await flushNote(windows, ownedNote(store, id).id);
  const note = ownedNote(store, id);
  const before = agentHtml(note);
  const entries = scan.checklistEntries(before);
  if (!entries.length) throw new Error('That note has no checklist. Add "- [ ] item" lines with stickies_update first.');
  const entry = scan.findChecklistEntry(entries, body.item);
  if (!entry) throw new Error(`No checklist item matches "${body.item}". Items: ${entries.map((e, i) => `${i + 1}. ${e.text}`).join('; ')}`);
  const done = body.done !== false;
  const html = scan.setEntryChecked(before, entry, done);
  if (html !== before) writeAgentHtml(store, windows, note, html);
  return { id: note.id, item: entry.text, done, items: itemsOf(html) };
}

function listApiNotes({ store, query = {} }) {
  const project = query.project ? String(query.project).toLowerCase() : null;
  return store.active()
    .filter(n => n.agent && String(n.agent.key).startsWith('api:') && !n.private)
    .filter(n => !project || String(n.agent.project).toLowerCase() === project)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 50)
    .map(n => ({ id: n.id, title: n.agent.title || n.title, project: n.agent.project, open: n.open, updatedAt: n.updatedAt, items: itemsOf(agentHtml(n)) }));
}

module.exports = { renderAgentNote, upsertAgentNote, createNoteFromApi, updateApiNote, checkApiNote, listApiNotes };
