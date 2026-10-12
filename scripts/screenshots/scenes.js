'use strict';

// Demo content and the steps that stage each screenshot. Every scene boots the real app
// against its own throwaway data folder, so nothing here touches the user's notes.

const crypto = require('crypto');
const art = require('./art');
const { renderAgentNote } = require('../../src/main/agent-notes');

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

function attachmentName(content, ext) {
  return crypto.createHash('sha256').update(content).digest('hex').slice(0, 24) + '.' + ext;
}

const IMAGES = {
  mountains: { name: attachmentName(art.mountains, 'svg'), content: art.mountains },
  chart: { name: attachmentName(art.chart, 'svg'), content: art.chart }
};
const img = (key) => `sticky-img://img/${IMAGES[key].name}`;

function isoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// The demo notes. Scenes pick from these and decide which are open and where.
function library(now) {
  const overdueDay = new Date(now - 2 * DAY);
  const overdue = isoDate(overdueDay);
  const overdueToken = `${overdueDay.getMonth() + 1}/${overdueDay.getDate()}`;
  const notes = {
    launch: {
      id: 'nlaunchweek', color: 'yellow', updatedAt: now - 4 * MIN,
      html: '<h2>Launch week</h2><ul class="checklist">' +
        '<li class="checked">Freeze features</li>' +
        '<li>Final QA pass @tomorrow</li>' +
        '<ul class="checklist"><li class="checked">Installer on Windows 10</li><li class="checked">Installer on Windows 11</li><li>Portable build</li></ul>' +
        '<li>Write release notes @fri</li>' +
        `<li data-due="${overdue}" data-due-src="${overdueToken}">Update screenshots @${overdueToken}</li>` +
        '<li>Announce #launch @nextweek</li>' +
        '</ul><p>Ask Sam about the store listing. #work</p>'
    },
    sync: {
      id: 'ndesignsync', color: 'purple', updatedAt: now - 22 * MIN,
      html: '<h1>Design sync</h1>' +
        '<p><b>With:</b> Ana, Ravi, Mei</p>' +
        '<h3>Decisions</h3>' +
        '<ul><li>Ship the <b>new color palette</b> in 3.0</li><li>The toolbar pops up <i>only</i> when you select text</li><li><s>Custom fonts</s> moved to the next release</li></ul>' +
        '<blockquote>Notes should never change size while you type.</blockquote>' +
        '<p><span style="background-color: #FFE45C">Needs icon review</span> · <span style="color: #E5484D"><b>blocker</b></span> for Friday</p>' +
        '<p>Build with <code>npm run dist</code> #design #work</p>'
    },
    hike: {
      id: 'nweekendhike', color: 'teal', updatedAt: now - 3 * HOUR,
      html: '<h2>Weekend hike</h2>' +
        `<p><img src="${img('mountains')}" data-wrap="left" style="width: 150px">Lake loop, about <b>11 km</b>. Trailhead at <b>7:30</b>, so leave by 6:45. The ridge gets windy after noon, so bring layers and turn back by 1. Parking fills up early on Saturdays.</p>` +
        '<ul class="checklist"><li class="checked">Check the forecast</li><li>Snacks &amp; water</li><li>Rain jacket</li><li>Charge the camera</li></ul>' +
        '<p>#personal</p>'
    },
    signups: {
      id: 'nsignupsnip', color: 'blue', updatedAt: now - 50 * MIN,
      html: '<h3>Sign-ups this week</h3>' +
        '<p>Snipped from the dashboard with <b>Ctrl+Alt+X</b>. Up 18% since the new onboarding. #work #metrics</p>' +
        // Room above the chart for its layout bar, which shows up there when the picture is selected.
        `<p><br></p><p><br></p><p><img src="${img('chart')}" data-wrap="block" style="width: 300px"></p>`
    },
    habits: {
      id: 'ndailyhabits', color: 'green', updatedAt: now - 2 * HOUR,
      html: `<h2>Daily habits</h2><ul class="checklist" data-reset="daily" data-reset-at="${now}">` +
        '<li class="checked">Drink water</li><li class="checked">Stretch</li><li>Move for 30 minutes</li><li>Read 20 pages</li></ul>'
    },
    groceries: {
      id: 'ngroceries01', color: 'orange', updatedAt: now - 5 * HOUR,
      html: '<h2>Groceries</h2><ul class="checklist"><li class="checked">Oat milk</li><li>Eggs</li><li>Sourdough</li><li>Limes</li><li>Coffee beans</li></ul>'
    },
    reading: {
      id: 'nreadinglist', color: 'pink', updatedAt: now - 1 * DAY,
      html: '<h2>Reading list</h2><ol><li><i>The Design of Everyday Things</i></li><li><i>Shape Up</i></li><li><i>A Philosophy of Software Design</i></li></ol><p>#books #personal</p>'
    },
    ideas: {
      id: 'nappideas001', color: 'blue', updatedAt: now - 2 * DAY,
      html: '<h2>App ideas</h2><ul><li>Workspaces per monitor setup</li><li>Snip straight into a note</li><li>Link to <a href="note://ndesignsync">Design sync</a></li></ul><p>#ideas #work</p>'
    },
    quotes: {
      id: 'nquotes0001', color: 'charcoal', updatedAt: now - 3 * DAY,
      html: '<h2>Quotes</h2><blockquote>Simple things should be simple, complex things should be possible.</blockquote><p><span style="font-size: small;">Alan Kay</span></p>'
    },
    standup: {
      id: 'nstandup001', color: 'gray', updatedAt: now - 6 * HOUR,
      html: '<h2>Stand-up</h2><ul class="checklist"><li class="checked">Review PR for the notes list</li><li>Pair with Mei on snips @today</li><li>Draft the FAQ</li></ul><p>#work</p>'
    },
    agent: {
      id: 'nopencodetask', color: 'blue', updatedAt: now - 1 * MIN, locked: true,
      agent: { key: 'opencode:demo-session', source: 'OpenCode', project: 'storefront' },
      html: renderAgentNote({
        source: 'OpenCode',
        project: 'storefront',
        title: 'Add dark mode to the storefront',
        items: [
          { text: 'Find every hard-coded color', status: 'completed' },
          { text: 'Add theme tokens to theme.css', status: 'completed' },
          { text: 'Swap components over to the tokens', status: 'in_progress' },
          { text: 'Add the theme toggle to settings', status: 'pending' },
          { text: 'Update snapshot tests', status: 'pending' }
        ],
        sections: [{
          title: 'Explore: component audit',
          items: [
            { text: 'List components with inline styles', status: 'completed' },
            { text: 'Check contrast of the new palette', status: 'completed' }
          ]
        }]
      }, new Date(now))
    },
    deploy: {
      id: 'ndeploysteps', color: 'yellow', updatedAt: now - 8 * MIN, locked: false,
      agent: { key: 'api:deploy-steps', source: 'OpenCode', project: 'storefront', title: 'Deploy steps', tags: ['opencode', 'storefront'] },
      html: '<h2>Deploy steps</h2><ul class="checklist">' +
        '<li class="checked">Run the test suite</li><li class="checked">Bump version to 2.4.0</li><li>Build the Docker image</li><li>Push to staging and smoke-test</li><li>Promote to production</li>' +
        '</ul><p><span style="font-size: small;">#opencode #storefront</span></p>'
    },
    friday: {
      id: 'nfridayplan', color: 'yellow', updatedAt: now - 2 * MIN,
      html: '<h2>Friday</h2><p>Lunch with Ana at <b>12:30</b></p><p>Pick up the prints #errands</p>'
    },
    privateNote: {
      id: 'nprivatecodes', color: 'purple', updatedAt: now - 30 * MIN,
      html: '<h2>Door &amp; Wi-Fi codes</h2><p>Studio door: 4417</p>'
    }
  };
  for (const n of Object.values(notes)) n.createdAt = n.createdAt || n.updatedAt - 3 * DAY;
  return notes;
}

const at = (note, x, y, width, height, extra = {}) => ({ ...note, open: true, bounds: { x, y, width, height }, ...extra });
const closed = (note) => ({ ...note, open: false });

// Older versions of "Design sync" for the version history window.
function syncHistory(now) {
  const v1 = '<h1>Design sync</h1><p><b>With:</b> Ana, Ravi</p><h3>Decisions</h3><ul><li>Ship the palette in 3.0</li><li>Keep the toolbar always visible</li></ul>';
  const v2 = '<h1>Design sync</h1><p><b>With:</b> Ana, Ravi, Mei</p><h3>Decisions</h3><ul><li>Ship the <b>new color palette</b> in 3.0</li><li>Keep the toolbar always visible</li><li>Custom fonts in 3.0</li></ul><p>Needs icon review</p>';
  const v3 = '<h1>Design sync</h1><p><b>With:</b> Ana, Ravi, Mei</p><h3>Decisions</h3><ul><li>Ship the <b>new color palette</b> in 3.0</li><li>The toolbar pops up <i>only</i> when you select text</li><li><s>Custom fonts</s> moved to the next release</li></ul><blockquote>Notes should never change size while you type.</blockquote><p>Needs icon review · blocker for Friday</p>';
  return { ndesignsync: [{ t: now - 2 * DAY - 3 * HOUR, html: v1 }, { t: now - 1 * DAY - 2 * HOUR, html: v2 }, { t: now - 3 * HOUR, html: v3 }] };
}

const BASE_SETTINGS = { welcomed: true, trayHintShown: true, apiEnabled: false, confirmDelete: false, theme: 'light' };

// Each scene: data to seed, steps to run once the windows are up, and how to lay out the
// captured windows in the final picture. Layout units are CSS pixels on the canvas.
const scenes = [
  {
    name: 'hero',
    canvas: { width: 1280, height: 720, backdrop: 'bloom', outputWidth: 2560 },
    notes: (L) => [
      at(L.sync, 40, 40, 300, 420),
      at(L.launch, 360, 40, 300, 350),
      at(L.hike, 680, 40, 320, 400),
      at(L.agent, 40, 480, 300, 400),
      at(L.habits, 360, 420, 260, 220),
      at(L.groceries, 680, 480, 280, 200, { rolled: true }),
      closed(L.reading), closed(L.ideas), closed(L.signups)
    ],
    shots: ['ndesignsync', 'nlaunchweek', 'nweekendhike', 'nopencodetask', 'ndailyhabits', 'ngroceries01'],
    layout: [
      { shot: 'ndesignsync', x: 70, y: 70 },
      { shot: 'ndailyhabits', x: 110, y: 470 },
      { shot: 'nlaunchweek', x: 410, y: 120 },
      { shot: 'ngroceries01', x: 430, y: 520 },
      { shot: 'nweekendhike', x: 750, y: 56 },
      { shot: 'nopencodetask', x: 900, y: 300 }
    ]
  },
  {
    name: 'formatting',
    canvas: { width: 960, height: 600, backdrop: 'lilac' },
    notes: (L) => [at(L.sync, 60, 60, 380, 520), at(L.friday, 500, 60, 340, 420)],
    shots: ['ndesignsync', 'nfridayplan'],
    async steps(ctx) {
      // Select a phrase so the formatting toolbar pops up over the bottom edge.
      const win = ctx.noteWindow('ndesignsync');
      await ctx.focus(win);
      await ctx.selectText(win, 'new color palette');
      await ctx.wait(700);
      // Type "/" on a fresh line of the other note to open the command menu.
      const other = ctx.noteWindow('nfridayplan');
      await ctx.focus(other);
      await ctx.js(other, `(() => {
        const ed = document.querySelector('.editor');
        const p = document.createElement('p'); p.innerHTML = '<br>'; ed.appendChild(p);
        const r = document.createRange(); r.setStart(p, 0); r.collapse(true);
        const s = getSelection(); s.removeAllRanges(); s.addRange(r);
      })()`);
      await ctx.type(other, '/');
      await ctx.wait(700);
    },
    layout: [
      { shot: 'ndesignsync', x: 96, y: 40 },
      { shot: 'nfridayplan', x: 540, y: 110 }
    ]
  },
  {
    name: 'checklists',
    canvas: { width: 960, height: 600, backdrop: 'sun' },
    notes: (L) => [at(L.launch, 60, 60, 380, 440), at(L.habits, 500, 60, 300, 250), at(L.standup, 500, 340, 320, 230)],
    shots: ['nlaunchweek', 'ndailyhabits', 'nstandup001'],
    layout: [
      { shot: 'nlaunchweek', x: 120, y: 60 },
      { shot: 'ndailyhabits', x: 560, y: 70 },
      { shot: 'nstandup001', x: 540, y: 340 }
    ]
  },
  {
    name: 'images',
    canvas: { width: 960, height: 600, backdrop: 'sea' },
    notes: (L) => [at(L.hike, 60, 60, 400, 470), at(L.signups, 520, 60, 360, 420)],
    shots: ['nweekendhike', 'nsignupsnip'],
    async steps(ctx) {
      // Click the chart so its resize handles and layout bar show.
      const win = ctx.noteWindow('nsignupsnip');
      await ctx.focus(win);
      await ctx.click(win, '.editor img');
      await ctx.wait(300);
      await ctx.js(win, 'getSelection().removeAllRanges()');
      await ctx.wait(300);
    },
    layout: [
      { shot: 'nweekendhike', x: 90, y: 60 },
      { shot: 'nsignupsnip', x: 530, y: 90 }
    ]
  },
  {
    name: 'notes-list',
    canvas: { width: 960, height: 600, backdrop: 'mint' },
    settings: { managerBounds: { x: 40, y: 40, width: 860, height: 540 } },
    notes: (L) => [
      at(L.launch, 900, 60, 300, 340),
      closed(L.sync), closed(L.hike), closed(L.signups), closed(L.habits), closed(L.groceries),
      closed(L.reading), closed(L.ideas), closed(L.quotes), closed(L.standup)
    ],
    shots: ['manager'],
    async steps(ctx) {
      const note = ctx.noteWindow('nlaunchweek');
      await ctx.js(note, 'window.stickies.showManager()');
      const mgr = await ctx.waitForWindow('manager');
      await ctx.wait(800);
      await ctx.js(mgr, `(() => {
        const box = document.getElementById('search');
        box.value = '#work';
        box.dispatchEvent(new Event('input', { bubbles: true }));
      })()`);
      await ctx.wait(600);
    },
    layout: [
      { shot: 'manager', x: 50, y: 30, chrome: 'caption' }
    ]
  },
  {
    name: 'tasks',
    canvas: { width: 960, height: 600, backdrop: 'peach' },
    settings: { managerBounds: { x: 40, y: 40, width: 860, height: 540 } },
    notes: (L) => [
      at(L.launch, 900, 60, 300, 340),
      closed(L.standup), closed(L.hike), closed(L.groceries), closed(L.habits), closed(L.sync), closed(L.deploy)
    ],
    shots: ['manager'],
    async steps(ctx) {
      const note = ctx.noteWindow('nlaunchweek');
      await ctx.js(note, "window.stickies.showManager('tasks')");
      const mgr = await ctx.waitForWindow('manager');
      await ctx.wait(800);
      await ctx.js(mgr, `document.querySelector('#task-group [data-v="due"]').click()`);
      await ctx.wait(600);
    },
    layout: [{ shot: 'manager', x: 50, y: 30, chrome: 'caption' }]
  },
  {
    name: 'history',
    canvas: { width: 960, height: 600, backdrop: 'lilac' },
    notes: (L) => [at(L.sync, 40, 60, 300, 420)],
    history: syncHistory,
    shots: ['history'],
    async steps(ctx) {
      const note = ctx.noteWindow('ndesignsync');
      await ctx.js(note, "window.stickies.openHistory('ndesignsync')");
      const hist = await ctx.waitForWindow('history');
      hist.setSize(840, 530);
      await ctx.wait(900);
      // The newest snapshot, shown as word-by-word changes against the one before it.
      await ctx.js(hist, `(() => {
        const items = document.querySelectorAll('#versions [data-t], #versions button, #versions .version');
        if (items[1]) items[1].click();
        document.querySelector('#mode [data-v="changes"]').click();
      })()`);
      await ctx.wait(600);
    },
    layout: [
      { shot: 'history', x: 60, y: 35, chrome: 'caption' }
    ]
  },
  {
    name: 'opencode',
    canvas: { width: 960, height: 600, backdrop: 'sky' },
    notes: (L) => [at(L.agent, 60, 60, 380, 400), at(L.deploy, 500, 60, 320, 290)],
    shots: ['nopencodetask', 'ndeploysteps'],
    layout: [
      { shot: 'nopencodetask', x: 110, y: 100 },
      { shot: 'ndeploysteps', x: 540, y: 180 }
    ]
  },
  {
    name: 'dark-mode',
    theme: 'dark',
    canvas: { width: 960, height: 600, backdrop: 'night' },
    notes: (L) => [
      at(L.sync, 40, 40, 300, 440),
      at(L.launch, 360, 40, 300, 350),
      at(L.quotes, 680, 40, 260, 220),
      at(L.reading, 680, 300, 260, 230)
    ],
    shots: ['ndesignsync', 'nlaunchweek', 'nquotes0001', 'nreadinglist'],
    layout: [
      { shot: 'ndesignsync', x: 60, y: 70 },
      { shot: 'nlaunchweek', x: 360, y: 40 },
      { shot: 'nquotes0001', x: 690, y: 70 },
      { shot: 'nreadinglist', x: 680, y: 320 }
    ]
  },
  {
    name: 'private',
    canvas: { width: 960, height: 600, backdrop: 'plum' },
    settings: { managerBounds: { x: 420, y: 40, width: 460, height: 440 } },
    notes: (L) => [at(L.privateNote, 40, 60, 320, 380)],
    shots: ['nprivatecodes', 'manager'],
    async steps(ctx) {
      const note = ctx.noteWindow('nprivatecodes');
      await ctx.js(note, `(async () => {
        await window.stickies.vaultSetup('correct horse battery', 'the staple one');
        await window.stickies.setPrivate(true, 'nprivatecodes');
        await window.stickies.vaultLock();
      })()`);
      await ctx.wait(900);
      await ctx.js(note, "window.stickies.showManager('settings')");
      const mgr = await ctx.waitForWindow('manager');
      await ctx.wait(800);
      await ctx.js(mgr, `(() => {
        const heads = [...document.querySelectorAll('#settings-scroll h2')];
        heads[heads.findIndex(h => h.id === 'privacy') - 1].scrollIntoView({ block: 'start' });
      })()`);
      await ctx.wait(400);
    },
    layout: [
      { shot: 'manager', x: 440, y: 80, chrome: 'caption' },
      { shot: 'nprivatecodes', x: 100, y: 110 }
    ]
  }
];

module.exports = { scenes, library, IMAGES, BASE_SETTINGS };
