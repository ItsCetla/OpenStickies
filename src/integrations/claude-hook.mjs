// OpenStickies hook for Claude Code
// ---------------------------------
// Mirrors what Claude Code is doing into a sticky note on the user's desktop: one note per
// session, with the agent's to-do list (TodoWrite) as a checklist — done steps ticked, the
// current step marked, and what's still left open.
//
// Installed by OpenStickies (Settings → Claude Code → Connect) into ~/.stickies/agents/ and
// registered in ~/.claude/settings.json for the UserPromptSubmit, PostToolUse (TodoWrite), Stop
// and SessionEnd events. Claude Code pipes the event as JSON on stdin. The hook never blocks
// the agent: it always exits 0 and prints nothing.
//
// Talks only to OpenStickies on 127.0.0.1, using the token OpenStickies writes to its api.json.
// Does nothing if OpenStickies isn't running.

import { readFileSync, statSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join, basename } from 'node:path';
import { homedir } from 'node:os';

const APPDATA = process.env.APPDATA || join(homedir(), 'AppData', 'Roaming');
const API_FILES = process.env.STICKIES_API_FILE ? [process.env.STICKIES_API_FILE] : [
  join(homedir(), '.stickies', 'api.json'),
  join(APPDATA, 'OpenStickies', 'data', 'api.json'),
  join(APPDATA, 'Stickies', 'data', 'api.json')
];

// The most recently written file wins, so a copy left behind by an older run can't shadow a live one.
function readApi() {
  let best = null;
  for (const file of API_FILES) {
    try {
      const api = JSON.parse(readFileSync(file, 'utf8'));
      const mtime = statSync(file).mtimeMs;
      if (!best || mtime > best.mtime) best = { api, mtime };
    } catch { /* missing or half-written */ }
  }
  return best && best.api;
}

// A note appears once a plan has at least this many items.
const MIN_ITEMS = 2;

// What the hook remembers between events of one session: each event is a fresh process.
const STATE_DIR = join(homedir(), '.stickies', 'claude-hook');
const stateFile = (id) => join(STATE_DIR, `${String(id).replace(/[^\w-]+/g, '_')}.json`);
function loadState(id) {
  try { return JSON.parse(readFileSync(stateFile(id), 'utf8')); } catch { return { title: '', todos: [], shown: false }; }
}
function saveState(id, state) {
  try { mkdirSync(STATE_DIR, { recursive: true }); writeFileSync(stateFile(id), JSON.stringify(state)); } catch { /* read-only home: the note just won't keep its title */ }
}

async function push(id, state, status, project) {
  if (!state.shown && state.todos.length < MIN_ITEMS) return; // single-step work doesn't get a note; once shown, keep it current
  const api = readApi();
  if (!api || !api.port || !api.token) return;
  const body = {
    source: 'Claude Code',
    project,
    title: state.title || 'Claude Code task',
    status,
    items: state.todos
  };
  try {
    const res = await fetch(`http://127.0.0.1:${api.port}/v1/agent/${encodeURIComponent(`claude:${id}`)}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${api.token}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(3000)
    });
    if (res.ok) state.shown = true;
  } catch { /* OpenStickies closed or busy: the next event will catch up */ }
}

async function main() {
  let event;
  try { event = JSON.parse(readFileSync(0, 'utf8')); } catch { return; }
  const id = event && event.session_id;
  if (!id) return;
  const project = basename(String(event.cwd || process.cwd()).replace(/[\\/]+$/, '')) || 'project';
  const state = loadState(id);
  switch (event.hook_event_name) {
    case 'UserPromptSubmit': {
      // The first thing the user asked becomes the note's title.
      const text = String(event.prompt || '').replace(/\s+/g, ' ').trim();
      if (!state.title && text) state.title = text.length > 80 ? text.slice(0, 77) + '…' : text;
      await push(id, state, 'busy', project);
      saveState(id, state); // after the push, so a shown note stays current even if the list shrinks
      break;
    }
    case 'PostToolUse': {
      if (event.tool_name !== 'TodoWrite') return;
      const todos = event.tool_input && Array.isArray(event.tool_input.todos) ? event.tool_input.todos : [];
      state.todos = todos.map(t => ({ text: String((t && t.content) || '').trim(), status: (t && t.status) || 'pending' })).filter(t => t.text);
      await push(id, state, 'busy', project);
      saveState(id, state);
      break;
    }
    case 'Stop':
      await push(id, state, 'idle', project);
      saveState(id, state);
      break;
    case 'SessionEnd':
      await push(id, state, 'idle', project);
      try { rmSync(stateFile(id), { force: true }); } catch { /* fine */ }
      break;
    default:
      break;
  }
}

main().catch(() => {}).finally(() => process.exit(0));
