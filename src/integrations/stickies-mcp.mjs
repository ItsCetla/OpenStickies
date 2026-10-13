// OpenStickies MCP server for Claude Code and Codex
// --------------------------------------------------
// A small MCP server (stdio, JSON-RPC over newline-delimited JSON) that gives an agent tools to
// put notes on the user's desktop: stickies_create, stickies_update, stickies_check and
// stickies_list. The agent can only change notes it created.
//
// With --client codex it also has stickies_plan, which mirrors the agent's to-do list into one
// locked task sticky (done steps ticked, the current one marked). Claude Code doesn't need it:
// its own TodoWrite list is mirrored by claude-hook.mjs.
//
// Installed by OpenStickies (Settings → Claude Code / Codex → Connect) into ~/.stickies/agents/
// and registered in the client's config. Talks only to OpenStickies on 127.0.0.1, using the token
// OpenStickies writes to its api.json. No dependencies, so it runs on any Node 18+ (or on the
// app's own runtime with ELECTRON_RUN_AS_NODE).

import { readFileSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';
import { homedir } from 'node:os';
import { createInterface } from 'node:readline';

const VERSION = '1.0.0';

const CLIENTS = { claude: 'Claude Code', codex: 'Codex' };
const clientArg = process.argv[process.argv.indexOf('--client') + 1];
const CLIENT = CLIENTS[clientArg] ? clientArg : 'claude';
const SOURCE = CLIENTS[CLIENT];

// OpenStickies writes the same api.json to both places. The home-folder copy is the one to trust on
// Windows: if OpenStickies was started by a packaged app, its AppData copy lands in that app's
// private folder and can't be seen from here. Older builds only write AppData, and builds from
// before the rename write it under %APPDATA%\Stickies rather than %APPDATA%\OpenStickies.
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
const ITEM_STATUSES = ['pending', 'in_progress', 'completed', 'cancelled'];

// A task note appears once a plan has at least this many items.
const MIN_ITEMS = 2;

const project = basename(process.cwd().replace(/[\\/]+$/, '')) || 'project';

function describeItems(items) {
  return items && items.length ? '\n' + items.map(i => `  ${i.n}. [${i.done ? 'x' : ' '}] ${i.text}`).join('\n') : '';
}

// ---------- the plan note (Codex) ----------
// One note per server process, which Codex starts once per session.
const plan = { key: `${CLIENT}:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, title: '', shown: false };

async function pushPlan(args) {
  const items = (Array.isArray(args.items) ? args.items : []).map(i => ({
    text: String((i && (i.text || i.step || i.content)) || '').trim(),
    status: ITEM_STATUSES.includes(i && i.status) ? i.status : 'pending'
  })).filter(i => i.text);
  if (args.title) plan.title = String(args.title).replace(/\s+/g, ' ').trim().slice(0, 120);
  if (!plan.shown && items.length < MIN_ITEMS) return `No sticky: single-step work doesn’t get a task note (a plan needs at least ${MIN_ITEMS} items).`;
  const status = ['busy', 'idle', 'error'].includes(args.status) ? args.status : 'busy';
  await callStickies('PUT', `/v1/agent/${encodeURIComponent(plan.key)}`, { source: SOURCE, project, title: plan.title || `${SOURCE} task`, status, items });
  plan.shown = true;
  const done = items.filter(i => i.status === 'completed' || i.status === 'cancelled').length;
  return `Task sticky "${plan.title || `${SOURCE} task`}" updated on the user's desktop: ${done} of ${items.length} done. Call stickies_plan again as items change.`;
}

// ---------- tools ----------
const TOOLS = [
  {
    name: 'stickies_create',
    description: 'Put a sticky note on the user\'s desktop (the OpenStickies app) so they can keep it in view while they work. Use it when the user asks for a sticky/note, or for plans, checklists, summaries, commands or reminders they want to keep handy. Content is Markdown: "- [ ] task" makes a checkbox, "- [x] task" a ticked one, "# " headings, **bold**, `code`, links. Returns the note id for stickies_update and stickies_check.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Short title shown at the top of the note' },
        content: { type: 'string', description: 'Note body in Markdown. Use "- [ ] item" lines for a checklist.' },
        color: { type: 'string', enum: COLORS, description: 'Note color (default: the user\'s color for agent notes)' },
        tags: { type: 'array', items: { type: 'string' }, description: `Extra tags without "#", e.g. ["deploy"]. #${CLIENT === 'claude' ? 'claude-code' : 'codex'} and the project name are added automatically.` }
      },
      required: ['title', 'content']
    },
    async run(args) {
      const r = await callStickies('POST', '/v1/notes', { title: args.title, content: args.content, color: args.color, tags: args.tags, source: SOURCE, project });
      return `Created sticky note "${r.title || args.title}" on the user's desktop (id: ${r.id}).${describeItems(r.items)}`;
    }
  },
  {
    name: 'stickies_update',
    description: 'Change a sticky note you created earlier with stickies_create: replace its content, append Markdown to the end, rename it or change its color. Only works on notes created by the agent.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The note id returned by stickies_create or stickies_list' },
        content: { type: 'string', description: 'New Markdown body; replaces the whole body' },
        append: { type: 'string', description: 'Markdown to add at the end, e.g. "- [ ] new step"' },
        title: { type: 'string', description: 'New title' },
        color: { type: 'string', enum: COLORS, description: 'New color' }
      },
      required: ['id']
    },
    async run(args) {
      const r = await callStickies('PATCH', `/v1/notes/${encodeURIComponent(args.id)}`, { content: args.content, append: args.append, title: args.title, color: args.color });
      return `Updated sticky note "${r.title || args.id}" (id: ${r.id}).${describeItems(r.items)}`;
    }
  },
  {
    name: 'stickies_check',
    description: 'Tick (or untick) a checklist item on a sticky note you created. Name the item by its text (exact or partial) or by its 1-based number.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The note id' },
        item: { type: 'string', description: 'Item text (or part of it), or its number like "2"' },
        done: { type: 'boolean', description: 'true to tick (default), false to untick' }
      },
      required: ['id', 'item']
    },
    async run(args) {
      const r = await callStickies('POST', `/v1/notes/${encodeURIComponent(args.id)}/check`, { item: args.item, done: args.done !== false });
      return `${r.done ? 'Ticked' : 'Unticked'} "${r.item}".${describeItems(r.items)}`;
    }
  },
  {
    name: 'stickies_list',
    description: 'List the sticky notes the agent has created (with ids and checklist items), e.g. to find and continue a note from an earlier session. Does not show the user\'s own notes.',
    inputSchema: {
      type: 'object',
      properties: {
        this_project_only: { type: 'boolean', description: 'Only notes created for the current project' }
      }
    },
    async run(args) {
      const r = await callStickies('GET', `/v1/notes${args.this_project_only ? `?project=${encodeURIComponent(project)}` : ''}`);
      if (!r.notes.length) return 'No agent-created sticky notes yet.';
      return r.notes.map(n => `- ${n.title || '(untitled)'} — id: ${n.id}${n.project ? `, project: ${n.project}` : ''}${n.open ? '' : ' (not on the desktop)'}${describeItems(n.items)}`).join('\n');
    }
  }
];

if (CLIENT === 'codex') {
  TOOLS.push({
    name: 'stickies_plan',
    description: 'Show your plan for the current task as a locked task sticky on the user\'s desktop, and keep it current. Send the whole to-do list each time: one item per subtask with its status (pending, in_progress, completed or cancelled). Call it before starting a task with two or more subtasks, again whenever an item\'s status changes, and with status "idle" when you hand back to the user. Single-step requests and plain questions don\'t need it.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'What the task is, in a few words (the note\'s title). Needed on the first call.' },
        items: {
          type: 'array',
          description: 'The whole to-do list, in order',
          items: {
            type: 'object',
            properties: {
              text: { type: 'string', description: 'The subtask' },
              status: { type: 'string', enum: ITEM_STATUSES }
            },
            required: ['text', 'status']
          }
        },
        status: { type: 'string', enum: ['busy', 'idle', 'error'], description: '"busy" while working (default), "idle" when waiting for the user, "error" if you had to stop' }
      },
      required: ['items']
    },
    run: pushPlan
  });
}

// Added to the agent's instructions while the user wants every multi-part task planned (Settings →
// OpenCode → "Always plan multi-part tasks", which applies to every connected agent).
function instructions() {
  const api = readApi();
  const nudge = !api || !api.options || api.options.planNudge !== false;
  const lines = ['The user\'s desktop sticky notes (OpenStickies) are connected to this session. Use the stickies_* tools when the user asks for a sticky or note, or for a plan, checklist, summary or reminder they want to keep in view.'];
  if (nudge && CLIENT === 'codex') {
    lines.push('Whenever a request involves two or more distinct subtasks or steps, call stickies_plan BEFORE starting the work with the plan as a to-do list (one item per subtask), then keep it current: call it again with the item you are working on marked in_progress and each item marked completed as soon as it is done. The list appears as a sticky note on the user\'s desktop, so do this even for short tasks that have more than one part. Single-step requests and plain questions do not need it.');
  } else if (nudge) {
    lines.push('Whenever a request involves two or more distinct subtasks or steps, use the TodoWrite tool BEFORE starting the work to write the plan as a to-do list (one item per subtask), then keep it current: mark the item you are working on in_progress and mark each item completed as soon as it is done. Each to-do list appears as a sticky note on the user\'s desktop, so do this even for short tasks that have more than one part. Single-step requests and plain questions do not need a to-do list.');
  }
  return lines.join(' ');
}

// ---------- JSON-RPC over stdio ----------
function send(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

async function handle(req) {
  const { id, method, params } = req;
  const reply = (result) => { if (id !== undefined) send({ jsonrpc: '2.0', id, result }); };
  const fail = (code, message) => { if (id !== undefined) send({ jsonrpc: '2.0', id, error: { code, message } }); };
  switch (method) {
    case 'initialize':
      return reply({
        protocolVersion: (params && params.protocolVersion) || '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'openstickies', version: VERSION },
        instructions: instructions()
      });
    case 'ping':
      return reply({});
    case 'tools/list':
      return reply({ tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
    case 'tools/call': {
      const tool = TOOLS.find(t => t.name === (params && params.name));
      if (!tool) return fail(-32602, `Unknown tool: ${params && params.name}`);
      try {
        const text = await tool.run((params && params.arguments) || {});
        return reply({ content: [{ type: 'text', text }], isError: false });
      } catch (e) {
        return reply({ content: [{ type: 'text', text: String(e && e.message || e) }], isError: true });
      }
    }
    default:
      if (method && method.startsWith('notifications/')) return; // nothing to answer
      return fail(-32601, `Method not found: ${method}`);
  }
}

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on('line', (line) => {
  line = line.trim();
  if (!line) return;
  let req;
  try { req = JSON.parse(line); } catch { return send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); }
  handle(req).catch(e => { if (req.id !== undefined) send({ jsonrpc: '2.0', id: req.id, error: { code: -32603, message: String(e && e.message || e) } }); });
});
rl.on('close', () => process.exit(0));
process.stdin.on('error', () => process.exit(0));
process.stdout.on('error', () => process.exit(0));
