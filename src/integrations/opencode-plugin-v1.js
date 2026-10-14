// openstickies-plugin-version: __VERSION__
// opencode-api: v1-legacy (OpenCode before 1.18.29)
//
// OpenStickies for OpenCode
// -------------------------
// Mirrors what the OpenCode agent is doing into a sticky note on your desktop:
// one note per task (session), with the agent's to-do list as a checklist — done steps
// ticked, the current step marked, and what's still left open. Sub-agents' to-do lists
// show up as sections of the same note.
//
// It also gives the agent tools to make notes on request: stickies_create, stickies_update,
// stickies_check and stickies_list. The agent can only change notes it created.
// While OpenStickies runs it asks the agent to plan every multi-part task as a to-do list, so
// each one gets a sticky (Settings → OpenCode → "Always plan multi-part tasks").
//
// Installed by OpenStickies (Settings → OpenCode → Connect) into ~/.config/opencode/plugins/.
// Talks only to OpenStickies on 127.0.0.1, using the token OpenStickies writes to its api.json.
// Does nothing if OpenStickies isn't running.

import { readFileSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';
import { homedir } from 'node:os';

// OpenStickies writes the same api.json to both places. The home-folder copy is the one to trust on
// Windows: if OpenStickies was started by a packaged app (e.g. Claude Desktop), its AppData copy lands
// in that app's private folder and can't be seen from here. Older builds only write AppData, and
// builds from before the rename write it under %APPDATA%\Stickies rather than %APPDATA%\OpenStickies.
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

const isPlaceholderTitle = (t) => !t || /^(New|Child) session - /i.test(t);

// Added to the agent's instructions while OpenStickies is running (Settings → OpenCode →
// "Always plan multi-part tasks"), so every task with more than one part gets a sticky.
const PLAN_RULE = [
  'The user\'s desktop sticky notes (OpenStickies) are connected to this session.',
  'Whenever a request involves two or more distinct subtasks or steps, use the todowrite tool BEFORE starting the work',
  'to write the plan as a to-do list (one item per subtask), then keep it current: mark the item you are working on',
  'in_progress and mark each item completed as soon as it is done. Each to-do list appears as a sticky note on the user\'s desktop,',
  'so do this even for short tasks that have more than one part. Single-step requests and plain questions do not need a to-do list.'
].join(' ');

// How to spot the rule among the agent's instructions so it is only added once. The second
// marker is the wording used before the app was renamed, in case an older copy of this plugin added it.
const PLAN_RULE_MARKERS = ['desktop sticky notes (OpenStickies)', 'desktop sticky notes (Stickies)'];

// A note appears once a plan has at least this many items (across the task and its sub-agents).
const MIN_ITEMS = 2;

async function callStickies(method, route, body) {
  const api = readApi();
  if (!api || !api.port || !api.token) throw new Error(`Can’t find OpenStickies on this PC (no ${API_FILES[0]}), so no note can be shown. Ask the user to start OpenStickies, or to quit and reopen it if it’s already open.`);
  let res;
  try {
    res = await fetch(`http://127.0.0.1:${api.port}${route}`, {
      method,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${api.token}` },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(5000)
    });
  } catch {
    throw new Error('Couldn’t reach OpenStickies. It may have just been closed; ask the user to start it.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `OpenStickies answered ${res.status}`);
  return data;
}

const COLORS = ['yellow', 'orange', 'pink', 'purple', 'blue', 'teal', 'green', 'gray', 'charcoal'];

function describeItems(items) {
  return items && items.length ? '\n' + items.map(i => `  ${i.n}. [${i.done ? 'x' : ' '}] ${i.text}`).join('\n') : '';
}

// Tools the agent can call directly. They need @opencode-ai/plugin (which OpenCode installs
// in its config folder); without it the to-do mirroring below still works.
async function makeTools(project) {
  let tool;
  try { ({ tool } = await import('@opencode-ai/plugin')); } catch { return null; }
  const s = tool.schema;
  return {
    stickies_create: tool({
      description: 'Put a sticky note on the user\'s desktop (the OpenStickies app) so they can keep it in view while they work. Use it when the user asks for a sticky/note, or for plans, checklists, summaries, commands or reminders they want to keep handy. Content is Markdown: "- [ ] task" makes a checkbox, "- [x] task" a ticked one, "# " headings, **bold**, `code`, links. Returns the note id for stickies_update and stickies_check.',
      args: {
        title: s.string().describe('Short title shown at the top of the note'),
        content: s.string().describe('Note body in Markdown. Use "- [ ] item" lines for a checklist.'),
        color: s.enum(COLORS).optional().describe('Note color (default: the user\'s color for agent notes)'),
        tags: s.array(s.string()).optional().describe('Extra tags without "#", e.g. ["deploy"]. #opencode and the project name are added automatically.')
      },
      async execute(args, ctx) {
        const r = await callStickies('POST', '/v1/notes', { title: args.title, content: args.content, color: args.color, tags: args.tags, source: 'OpenCode', project, session: ctx && ctx.sessionID });
        if (ctx && ctx.metadata) ctx.metadata({ title: `Sticky: ${args.title}` });
        return `Created sticky note "${r.title || args.title}" on the user's desktop (id: ${r.id}).${describeItems(r.items)}`;
      }
    }),
    stickies_update: tool({
      description: 'Change a sticky note you created earlier with stickies_create: replace its content, append Markdown to the end, rename it or change its color. Only works on notes created by the agent.',
      args: {
        id: s.string().describe('The note id returned by stickies_create or stickies_list'),
        content: s.string().optional().describe('New Markdown body; replaces the whole body'),
        append: s.string().optional().describe('Markdown to add at the end, e.g. "- [ ] new step"'),
        title: s.string().optional().describe('New title'),
        color: s.enum(COLORS).optional().describe('New color')
      },
      async execute(args, ctx) {
        const r = await callStickies('PATCH', `/v1/notes/${encodeURIComponent(args.id)}`, { content: args.content, append: args.append, title: args.title, color: args.color });
        if (ctx && ctx.metadata) ctx.metadata({ title: `Sticky updated: ${r.title || args.id}` });
        return `Updated sticky note "${r.title || args.id}" (id: ${r.id}).${describeItems(r.items)}`;
      }
    }),
    stickies_check: tool({
      description: 'Tick (or untick) a checklist item on a sticky note you created. Name the item by its text (exact or partial) or by its 1-based number.',
      args: {
        id: s.string().describe('The note id'),
        item: s.string().describe('Item text (or part of it), or its number like "2"'),
        done: s.boolean().optional().describe('true to tick (default), false to untick')
      },
      async execute(args, ctx) {
        const r = await callStickies('POST', `/v1/notes/${encodeURIComponent(args.id)}/check`, { item: args.item, done: args.done !== false });
        if (ctx && ctx.metadata) ctx.metadata({ title: `${r.done ? 'Ticked' : 'Unticked'}: ${r.item}` });
        return `${r.done ? 'Ticked' : 'Unticked'} "${r.item}".${describeItems(r.items)}`;
      }
    }),
    stickies_list: tool({
      description: 'List the sticky notes the agent has created (with ids and checklist items), e.g. to find and continue a note from an earlier session. Does not show the user\'s own notes.',
      args: {
        this_project_only: s.boolean().optional().describe('Only notes created for the current project')
      },
      async execute(args) {
        const r = await callStickies('GET', `/v1/notes${args.this_project_only ? `?project=${encodeURIComponent(project)}` : ''}`);
        if (!r.notes.length) return 'No agent-created sticky notes yet.';
        return r.notes.map(n => `- ${n.title || '(untitled)'} — id: ${n.id}${n.project ? `, project: ${n.project}` : ''}${n.open ? '' : ' (not on the desktop)'}${describeItems(n.items)}`).join('\n');
      }
    })
  };
}

export const StickiesPlugin = async ({ directory, worktree }) => {
  const project = basename(String(worktree || directory || '').replace(/[\\/]+$/, '')) || 'project';
  const tools = await makeTools(project);
  const sessions = new Map(); // id -> { title, prompt, todos, status, parentID, timer }

  const get = (id) => {
    if (!sessions.has(id)) sessions.set(id, { title: '', prompt: '', todos: [], status: 'busy', parentID: null, timer: null, shown: false });
    return sessions.get(id);
  };
  const rootOf = (id) => {
    let cur = id;
    for (let i = 0; i < 20; i++) {
      const s = sessions.get(cur);
      if (!s || !s.parentID) return cur;
      cur = s.parentID;
    }
    return cur;
  };
  const titleOf = (id) => {
    const s = get(id);
    return !isPlaceholderTitle(s.title) ? s.title : (s.prompt || 'OpenCode task');
  };

  async function push(rootId) {
    const root = get(rootId);
    const children = [...sessions.entries()].filter(([id, s]) => id !== rootId && rootOf(id) === rootId && s.todos.length);
    const total = root.todos.length + children.reduce((n, [, s]) => n + s.todos.length, 0);
    if (!root.shown && total < MIN_ITEMS) return; // single-step work doesn't get a note; once shown, keep it current
    const api = readApi();
    if (!api || !api.port || !api.token) return;
    const toItems = (todos) => todos.map(t => ({ text: t.content, status: t.status }));
    const body = {
      source: 'OpenCode',
      project,
      title: titleOf(rootId),
      status: root.status,
      items: toItems(root.todos),
      sections: children.map(([id, s]) => ({ title: titleOf(id), items: toItems(s.todos) }))
    };
    try {
      const res = await fetch(`http://127.0.0.1:${api.port}/v1/agent/${encodeURIComponent(`opencode:${rootId}`)}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${api.token}` },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(3000)
      });
      if (res.ok) root.shown = true;
    } catch { /* OpenStickies closed or busy: the next update will catch up */ }
  }

  const schedule = (id) => {
    const rootId = rootOf(id);
    const root = get(rootId);
    clearTimeout(root.timer);
    root.timer = setTimeout(() => push(rootId), 250);
  };

  return {
    ...(tools ? { tool: tools } : {}),
    // Ask the agent to plan any multi-part task as a to-do list (which becomes a sticky).
    'experimental.chat.system.transform': async (_input, output) => {
      if (!output || !Array.isArray(output.system)) return;
      const api = readApi();
      if (!api || (api.options && api.options.planNudge === false)) return; // OpenStickies off, or the user turned this off
      if (!output.system.some(s => typeof s === 'string' && PLAN_RULE_MARKERS.some(m => s.includes(m)))) output.system.push(PLAN_RULE);
    },
    event: async ({ event }) => {
      const p = (event && event.properties) || {};
      switch (event && event.type) {
        case 'todo.updated': {
          if (!p.sessionID) break;
          const s = get(p.sessionID);
          s.todos = Array.isArray(p.todos) ? p.todos : [];
          s.status = 'busy';
          schedule(p.sessionID);
          break;
        }
        case 'session.created':
        case 'session.updated': {
          const info = p.info;
          if (!info || !info.id) break;
          const s = get(info.id);
          if (info.title) s.title = info.title;
          s.parentID = info.parentID || null;
          if (s.todos.length || sessions.size > 1) schedule(info.id);
          break;
        }
        case 'session.status': {
          if (!p.sessionID) break;
          const s = get(p.sessionID);
          s.status = p.status && p.status.type === 'idle' ? 'idle' : 'busy';
          schedule(p.sessionID);
          break;
        }
        case 'session.idle': {
          if (!p.sessionID) break;
          get(p.sessionID).status = 'idle';
          schedule(p.sessionID);
          break;
        }
        case 'session.error': {
          if (!p.sessionID) break;
          get(p.sessionID).status = 'error';
          schedule(p.sessionID);
          break;
        }
        default:
          break;
      }
    },
    // The first thing the user asked becomes the note's title until OpenCode names the session.
    'chat.message': async (input, output) => {
      const id = input && input.sessionID;
      if (!id) return;
      const s = get(id);
      if (s.prompt) return;
      const text = ((output && output.parts) || []).filter(x => x && x.type === 'text').map(x => x.text).join(' ').replace(/\s+/g, ' ').trim();
      if (text) s.prompt = text.length > 80 ? text.slice(0, 77) + '…' : text;
    }
  };
};
