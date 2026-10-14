// openstickies-plugin-version: __VERSION__
// opencode-api: v1+v2
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
// One default export serves both plugin APIs: OpenCode 2 calls setup(), OpenCode 1 (1.18.29 or
// newer) calls server(). Older OpenCode 1 releases get a separate build from OpenStickies.
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

// OpenCode 2 has no todowrite tool, so there the plan goes straight onto a checklist note.
const PLAN_RULE_V2 = [
  'The user\'s desktop sticky notes (OpenStickies) are connected to this session.',
  'Whenever a request involves two or more distinct subtasks or steps, call stickies_create BEFORE starting the work',
  'to write the plan as a checklist (one "- [ ] " line per subtask), then tick each item with stickies_check as soon as it is done.',
  'Do this even for short tasks that have more than one part. Single-step requests and plain questions do not need a checklist.'
].join(' ');

// How to spot the rule among the agent's instructions so it is only added once. The second
// marker is the wording used before the app was renamed, in case an older copy of this plugin added it.
const PLAN_RULE_MARKERS = ['desktop sticky notes (OpenStickies)', 'desktop sticky notes (Stickies)'];
const hasPlanRule = (text) => typeof text === 'string' && PLAN_RULE_MARKERS.some(m => text.includes(m));
const planNudgeOn = () => {
  const api = readApi();
  return !!api && !(api.options && api.options.planNudge === false); // OpenStickies off, or the user turned this off
};

// A note appears once a plan has at least this many items (across the task and its sub-agents).
const MIN_ITEMS = 2;

const projectName = (dir) => basename(String(dir || '').replace(/[\\/]+$/, '')) || 'project';
const shortPrompt = (text) => {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  return t.length > 80 ? t.slice(0, 77) + '…' : t;
};

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

// The tools, described once and turned into each API's format below. Each argument is
// { type: 'string' | 'boolean' | 'color' | 'strings', description, optional }. run() returns the
// text the agent sees and a short title for the tool call.
const TOOLS = {
  stickies_create: {
    description: 'Put a sticky note on the user\'s desktop (the OpenStickies app) so they can keep it in view while they work. Use it when the user asks for a sticky/note, or for plans, checklists, summaries, commands or reminders they want to keep handy. Content is Markdown: "- [ ] task" makes a checkbox, "- [x] task" a ticked one, "# " headings, **bold**, `code`, links. Returns the note id for stickies_update and stickies_check.',
    args: {
      title: { type: 'string', description: 'Short title shown at the top of the note' },
      content: { type: 'string', description: 'Note body in Markdown. Use "- [ ] item" lines for a checklist.' },
      color: { type: 'color', optional: true, description: 'Note color (default: the user\'s color for agent notes)' },
      tags: { type: 'strings', optional: true, description: 'Extra tags without "#", e.g. ["deploy"]. #opencode and the project name are added automatically.' }
    },
    async run(args, { project, sessionID }) {
      const r = await callStickies('POST', '/v1/notes', { title: args.title, content: args.content, color: args.color, tags: args.tags, source: 'OpenCode', project, session: sessionID });
      return { title: `Sticky: ${args.title}`, text: `Created sticky note "${r.title || args.title}" on the user's desktop (id: ${r.id}).${describeItems(r.items)}` };
    }
  },
  stickies_update: {
    description: 'Change a sticky note you created earlier with stickies_create: replace its content, append Markdown to the end, rename it or change its color. Only works on notes created by the agent.',
    args: {
      id: { type: 'string', description: 'The note id returned by stickies_create or stickies_list' },
      content: { type: 'string', optional: true, description: 'New Markdown body; replaces the whole body' },
      append: { type: 'string', optional: true, description: 'Markdown to add at the end, e.g. "- [ ] new step"' },
      title: { type: 'string', optional: true, description: 'New title' },
      color: { type: 'color', optional: true, description: 'New color' }
    },
    async run(args) {
      const r = await callStickies('PATCH', `/v1/notes/${encodeURIComponent(args.id)}`, { content: args.content, append: args.append, title: args.title, color: args.color });
      return { title: `Sticky updated: ${r.title || args.id}`, text: `Updated sticky note "${r.title || args.id}" (id: ${r.id}).${describeItems(r.items)}` };
    }
  },
  stickies_check: {
    description: 'Tick (or untick) a checklist item on a sticky note you created. Name the item by its text (exact or partial) or by its 1-based number.',
    args: {
      id: { type: 'string', description: 'The note id' },
      item: { type: 'string', description: 'Item text (or part of it), or its number like "2"' },
      done: { type: 'boolean', optional: true, description: 'true to tick (default), false to untick' }
    },
    async run(args) {
      const r = await callStickies('POST', `/v1/notes/${encodeURIComponent(args.id)}/check`, { item: args.item, done: args.done !== false });
      return { title: `${r.done ? 'Ticked' : 'Unticked'}: ${r.item}`, text: `${r.done ? 'Ticked' : 'Unticked'} "${r.item}".${describeItems(r.items)}` };
    }
  },
  stickies_list: {
    description: 'List the sticky notes the agent has created (with ids and checklist items), e.g. to find and continue a note from an earlier session. Does not show the user\'s own notes.',
    args: {
      this_project_only: { type: 'boolean', optional: true, description: 'Only notes created for the current project' }
    },
    async run(args, { project }) {
      const r = await callStickies('GET', `/v1/notes${args.this_project_only ? `?project=${encodeURIComponent(project)}` : ''}`);
      const text = !r.notes.length ? 'No agent-created sticky notes yet.'
        : r.notes.map(n => `- ${n.title || '(untitled)'} — id: ${n.id}${n.project ? `, project: ${n.project}` : ''}${n.open ? '' : ' (not on the desktop)'}${describeItems(n.items)}`).join('\n');
      return { title: 'Sticky notes', text };
    }
  }
};

// OpenCode 2 takes a plain JSON Schema for a tool's input.
function jsonSchema(args) {
  const properties = {};
  for (const [name, a] of Object.entries(args)) {
    const base = a.type === 'color' ? { type: 'string', enum: COLORS }
      : a.type === 'strings' ? { type: 'array', items: { type: 'string' } }
      : { type: a.type };
    properties[name] = { ...base, description: a.description };
  }
  const required = Object.entries(args).filter(([, a]) => !a.optional).map(([name]) => name);
  return { type: 'object', properties, required, additionalProperties: false };
}

// OpenCode 1 takes Zod schemas from @opencode-ai/plugin, which it installs in its config folder.
// Without it the to-do mirroring still works.
async function v1Tools(project) {
  let tool;
  try { ({ tool } = await import('@opencode-ai/plugin')); } catch { return null; }
  const s = tool.schema;
  const zod = (a) => {
    const z = a.type === 'color' ? s.enum(COLORS) : a.type === 'strings' ? s.array(s.string()) : a.type === 'boolean' ? s.boolean() : s.string();
    return (a.optional ? z.optional() : z).describe(a.description);
  };
  const tools = {};
  for (const [name, def] of Object.entries(TOOLS)) {
    tools[name] = tool({
      description: def.description,
      args: Object.fromEntries(Object.entries(def.args).map(([k, a]) => [k, zod(a)])),
      async execute(args, ctx) {
        const r = await def.run(args, { project, sessionID: ctx && ctx.sessionID });
        if (ctx && ctx.metadata) ctx.metadata({ title: r.title });
        return r.text;
      }
    });
  }
  return tools;
}

// What both APIs share: the sessions seen so far, and pushing each task's plan to its note.
function createMirror(project) {
  const sessions = new Map(); // id -> { title, prompt, todos, status, parentID, timer, shown }

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
    todos(id, list) {
      if (!id) return;
      const s = get(id);
      // Accept the todo shapes of both APIs: { content, status } items, with text/title as fallbacks.
      s.todos = (Array.isArray(list) ? list : [])
        .map(t => ({ content: String((t && (t.content ?? t.text ?? t.title)) || '').trim(), status: (t && t.status) || 'pending' }))
        .filter(t => t.content);
      s.status = 'busy';
      schedule(id);
    },
    session(id, { title, parentID } = {}) {
      if (!id) return;
      const s = get(id);
      if (title) s.title = title;
      if (parentID !== undefined) s.parentID = parentID || null;
      if (s.todos.length || sessions.size > 1) schedule(id);
    },
    status(id, status) {
      if (!id) return;
      get(id).status = status;
      schedule(id);
    },
    // The first thing the user asked becomes the note's title until OpenCode names the session.
    prompt(id, text) {
      if (!id) return;
      const s = get(id);
      if (!s.prompt && text) s.prompt = shortPrompt(text);
    },
    dispose() {
      for (const s of sessions.values()) clearTimeout(s.timer);
      sessions.clear();
    }
  };
}

// ----- OpenCode 1 -----

async function server({ directory, worktree }) {
  const mirror = createMirror(projectName(worktree || directory));
  const tools = await v1Tools(projectName(worktree || directory));
  return {
    ...(tools ? { tool: tools } : {}),
    // Ask the agent to plan any multi-part task as a to-do list (which becomes a sticky).
    'experimental.chat.system.transform': async (_input, output) => {
      if (!output || !Array.isArray(output.system) || !planNudgeOn()) return;
      if (!output.system.some(hasPlanRule)) output.system.push(PLAN_RULE);
    },
    event: async ({ event }) => {
      const p = (event && event.properties) || {};
      switch (event && event.type) {
        case 'todo.updated': mirror.todos(p.sessionID, p.todos); break;
        case 'session.created':
        case 'session.updated':
          if (p.info && p.info.id) mirror.session(p.info.id, { title: p.info.title, parentID: p.info.parentID || null });
          break;
        case 'session.status': mirror.status(p.sessionID, p.status && p.status.type === 'idle' ? 'idle' : 'busy'); break;
        case 'session.idle': mirror.status(p.sessionID, 'idle'); break;
        case 'session.error': mirror.status(p.sessionID, 'error'); break;
        default: break;
      }
    },
    'chat.message': async (input, output) => {
      const text = ((output && output.parts) || []).filter(x => x && x.type === 'text').map(x => x.text).join(' ');
      mirror.prompt(input && input.sessionID, text);
    }
  };
}

// ----- OpenCode 2 -----

// OpenCode 2 has no to-do event, so the plan is read from each todowrite call instead.
const isTodoTool = (name) => /(^|[_.])todo_?write$/i.test(String(name || ''));

async function setup(ctx) {
  // An OpenCode 1 host that somehow calls setup() gets nothing; it uses server() above.
  if (!ctx || !ctx.session || typeof ctx.session.hook !== 'function' || !ctx.tool || typeof ctx.tool.transform !== 'function') return;
  const loc = ctx.location || {};
  const project = projectName(loc.directory || (loc.project && loc.project.directory));
  const mirror = createMirror(project);
  const registrations = [];
  const stop = new AbortController();

  registrations.push(await ctx.tool.transform((editor) => {
    for (const [name, def] of Object.entries(TOOLS)) {
      editor.add({
        name,
        description: def.description,
        input: jsonSchema(def.args),
        // Plain tools the model calls directly, like the built-in ones, rather than code-mode helpers
        // it would only reach through the execute tool.
        options: { codemode: false },
        async execute(input, tc) {
          const r = await def.run(input || {}, { project, sessionID: tc && tc.sessionID });
          if (tc && typeof tc.progress === 'function') { try { await tc.progress({ title: r.title }); } catch { /* cosmetic */ } }
          return { content: r.text, metadata: { title: r.title } };
        }
      });
    }
  }));

  // Ask the agent to plan any multi-part task as a checklist note.
  registrations.push(await ctx.session.hook('context', (e) => {
    if (!e || !Array.isArray(e.system) || !planNudgeOn()) return;
    if (!e.system.some(part => hasPlanRule(typeof part === 'string' ? part : part && part.text))) e.system.push({ type: 'text', text: PLAN_RULE_V2 });
  }));

  registrations.push(await ctx.session.hook('prompt', (e) => {
    mirror.prompt(e && e.sessionID, e && e.prompt && e.prompt.text);
  }));

  registrations.push(await ctx.tool.hook('execute.after', (e) => {
    try {
      if (!e || e.status !== 'completed' || !isTodoTool(e.tool)) return;
      const input = e.input && typeof e.input === 'object' ? e.input : {};
      mirror.todos(e.sessionID, input.todos);
    } catch { /* never fail the agent's own tool call */ }
  }));

  (async () => {
    try {
      const events = await ctx.event.subscribe({ signal: stop.signal });
      for await (const ev of events) {
        const d = (ev && (ev.data || ev.properties)) || {};
        switch (ev && ev.type) {
          case 'session.created': mirror.session(d.sessionID, { title: d.title, parentID: d.parentID || null }); break;
          case 'session.renamed': mirror.session(d.sessionID, { title: d.title }); break;
          case 'session.status': mirror.status(d.sessionID, d.status && d.status.type === 'idle' ? 'idle' : 'busy'); break;
          case 'session.idle': mirror.status(d.sessionID, 'idle'); break;
          case 'session.execution.failed': mirror.status(d.sessionID, 'error'); break;
          default: break;
        }
      }
    } catch { /* stream closed: the plugin is unloading */ }
  })();

  return async () => {
    stop.abort();
    mirror.dispose();
    await Promise.all(registrations.map(r => r && r.dispose && r.dispose().catch(() => {})));
  };
}

export default { id: 'openstickies', setup, server };
