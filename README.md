# OpenStickies

Sticky notes for the Windows desktop, rebuilt with rich formatting, images, checklists, reminders, tags, links between notes, workspaces, version history, private notes, screen snips with searchable text, and an OpenCode integration. Every note is its own small floating window, like classic Stickies.

## Install & run

Stickies runs on Windows 10 and 11. Download it from the [Releases page](../../releases):
- **Installer** (`Stickies Setup <version>.exe`) adds Start menu and desktop shortcuts.
- **Portable** (`Stickies-Portable-<version>.exe`) runs without installing anything.

> The builds aren't code-signed, so Windows SmartScreen may say "Windows protected your PC". Click **More info → Run anyway**.

**From source** (needs Node.js 20 or newer):

```bash
npm install
npm start
```

`npm install` also downloads Electron itself, through the project's `postinstall` script (npm 11 no longer runs dependencies' install scripts on its own). `npm run dev` turns on DevTools (Ctrl+Shift+I in a note). `npm run dist` builds the installer and portable app into `dist/`. `Stickies.exe --quit` closes a running copy cleanly (it saves first).

Stickies keeps running in the **system tray** after you close every note. Windows hides new tray icons behind the **^** arrow at the right end of the taskbar; drag the yellow icon onto the taskbar to keep it in view. Click it to bring your notes back, or right-click it for more.

## Writing

- **Formatting:** bold, italic, underline, strikethrough, superscript/subscript, titles and headings, quotes, code blocks, 9 text colors, 6 highlights, 5 sizes, alignment, links, tables and dividers.
- **Formatting toolbar.** By default it pops up over the bottom edge when you select text or point at the bottom of a note, so a note never changes size. Settings has **While editing** and **Always** options.
- **"/" command menu.** Type `/` to insert a heading, checklist, table, image, screen snip, date, link, reminder, or one of your **templates**.
- **Markdown-style typing:**
  - `# ` / `## ` / `### ` for headings, `- ` for bullets, `1. ` for a numbered list, `[] ` for a checklist item, `> ` for a quote
  - ```` ``` ```` then Enter for a code block, `---` then Enter for a divider
  - `**bold**`, `*italic*`, `~~strike~~`, `` `code` `` and `==highlight==`
- **Edit HTML source** (Ctrl+Shift+H) to change a note's HTML directly.

### Checklists
- **Tab / Shift+Tab** indent and outdent items, and items keep their checkbox, ticked state and style. **Alt+Shift+↑/↓** moves an item up or down; you can also drag the grip on its left.
- **Parent and sub-items stay in sync.** Ticking a parent ticks everything under it, and once every sub-item is ticked the parent ticks itself (unticking works the same way in reverse).
- Ticked items **stay where they are**. To have them move below the unticked ones, turn on Settings → *Move ticked items to the bottom*, or right-click a checklist to do it once. A **3/8** progress count shows in the title bar.
- Right-click a checklist to make it **untick itself every day or every Monday**, which suits routines and habits, or to **remove ticked items**.
- **Due dates:** add `@today`, `@tomorrow`, `@fri`, `@nextweek`, `@+3d` or `@10/20` to an item. The date is fixed when you type it, and overdue items turn red.
- Title/Heading styles and every text effect work inside checklist items.

### Images
- Paste, drag in, insert, or **snip the screen** (Ctrl+Alt+X from anywhere, or `/snip` in a note).
- Resize from any corner. The layout bar or right-click menu sets the picture **in line with text**, **wrapped left/right**, **top and bottom**, **behind text** or **in front of text**, like Word. You can drag pictures around, and arrow keys nudge floating ones.
- **Text in pictures is searchable.** Windows' built-in text recognition reads snips, screenshots and photos, and the notes list finds them by those words. Right-click a picture to copy its text.

## Organizing

- **Tags:** type `#project` anywhere. `#` suggests tags you've already used, and Ctrl+Click a tag to list every note that has it.
- **Links between notes:** type `[[` to link to another note by title, or to create a new one. Ctrl+Click a link to open the note, and each note's ⋯ menu shows **Linked from**.
- **Notes list** (Ctrl+H) has a sidebar with:
  - views: All, On desktop, Kept on top, Reminders, **Tasks**, Trash
  - your saved searches
  - your tags
  - your workspaces
- **Search language:**

  | Filter | Example |
  |---|---|
  | A tag | `#work` |
  | Notes with unfinished checklists | `has:unchecked` |
  | Notes with pictures | `has:image` |
  | Recent edits | `edited:today`, `edited:week`, `edited:3d` |
  | Due dates | `due:today`, `due:week`, `due:overdue` |
  | On the desktop / kept on top | `is:open`, `is:pinned` |
  | By color | `color:blue` |
  | An exact phrase | `"call back"` |

  Click **Save this search** to keep a search in the sidebar.
- **Tasks:** every unticked checklist item from every note, grouped by note or by due date. Tick items right there and the note updates, even if it's closed. Click an item to jump to it.
- **Workspaces:** save the current arrangement of notes (which are open, where they are, their size, whether they're on top or rolled up) as "Work", "Home" and so on, and switch from the sidebar, the tray or **Ctrl+Alt+W**. Each workspace remembers changes when you switch away. When you plug into a dock or change monitors, Stickies switches to the workspace you last used with that setup.
- **Templates:** six built-in templates (meeting notes, daily plan, daily habits, weekly review, packing list, shopping list). Turn any note into one from its ⋯ menu with **Save as template…**. Templates fill in `{{date}}`, `{{time}}`, `{{weekday}}`, `{{week}}` and `{{tomorrow}}`, and `{{cursor}}` marks where typing starts.

## Safety

- **Version history:** Stickies keeps a snapshot whenever you come back to a note after a few minutes away. ⋯ → **Version history…** shows a timeline, previews old versions, highlights word-by-word **changes**, and restores any version. The current text stays in the history, so a restore can be undone.
- **Private notes:** set a password in Settings, then use ⋯ → **Make private…** on any note.
  - Its words and pictures are encrypted on disk (AES-256-GCM, with the key protected by your password via scrypt).
  - While locked, private notes are hidden from search, previews and exports.
  - They lock automatically after a set idle time, and when Windows locks or sleeps.
  - Windows Hello can unlock them if it's set up on the PC.
  - **If you forget the password, private notes can't be recovered.**
- **Trash** keeps deleted notes for 30 days. Daily backups cover the last 14 days, and saves are crash-safe.
- **Backup & restore** puts every note, image and template in one file (private notes stay encrypted).

## OpenCode integration

While [OpenCode](https://opencode.ai) works on a multi-step task, a sticky on your desktop shows its plan:
- the steps it has finished are ticked, and the step it's on is marked ▶
- the steps still to do stay open, so you can see where it's going
- sub-agents' lists appear as sections of the same note
- a status line says *Working on step 3 of 7*, *Waiting for you*, *All 7 steps done* or *Stopped with an error*

1. In Stickies: **Settings → OpenCode → Connect**. This adds a small plugin to `~/.config/opencode/plugins/`.
2. Restart OpenCode.

Task notes are blue (you can change the color), locked so typing can't clash with the agent, and tagged `#opencode` plus the project name. Quick questions without a plan don't create a note, and a task note you delete stays deleted. **Disconnect** removes the plugin.

**Every multi-part task gets a sticky.** While Stickies is running, the plugin adds a standing instruction for the agent: any request with two or more distinct subtasks gets a to-do list first, which then appears as a sticky. One-item lists don't create a note. Turn this off with **Settings → OpenCode → Always plan multi-part tasks**; the change applies right away.

### Notes on request: the agent's Stickies tools
The plugin also gives the agent four tools, so you can just ask, e.g. *"put the deploy steps on a sticky"* or *"make me a checklist sticky for this refactor and tick items off as you go"*:

| Tool | What it does |
|---|---|
| `stickies_create` | New sticky with a title and Markdown content (`- [ ]` makes a checkbox), optional color and tags |
| `stickies_update` | Replace the content, append to it, rename it or change its color |
| `stickies_check` | Tick or untick a checklist item by its text or number |
| `stickies_list` | List the stickies the agent has made (with ids), e.g. to continue one from an earlier session |

The agent can only change stickies **it** created. It can't read, change or tick your own notes, and a sticky you delete can't be edited back. If Stickies isn't running, the tools tell the agent to ask you to start it.

Under the hood, Stickies runs a small local API on `127.0.0.1` with a random port and a token stored in `%USERPROFILE%\.stickies\api.json` (and a copy in `%APPDATA%\Stickies\data\api.json`). Requests from web pages are refused. Scripts can use it too:

```bash
curl -X POST http://127.0.0.1:PORT/v1/notes -H "Authorization: Bearer TOKEN" -H "Content-Type: application/json" -d "{\"title\":\"From a script\",\"content\":\"- [ ] one\\n- [x] two\"}"
```

Endpoints: `POST /v1/notes`, `GET /v1/notes`, `PATCH /v1/notes/:id`, `POST /v1/notes/:id/check`, `PUT /v1/agent/:key` (task notes), `GET /v1/ping`.

## Keyboard shortcuts

**Anywhere in Windows** (you can change these in Settings)

| Shortcut | Action |
|---|---|
| Ctrl+Alt+N | New note |
| Ctrl+Alt+X | Snip the screen into a note |
| Ctrl+Alt+S | Bring all notes to the front |
| Ctrl+Alt+H | Show / hide all notes |
| Ctrl+Alt+W | Next workspace |

**In a note**

| Shortcut | Action |
|---|---|
| Ctrl+N / Ctrl+W / Ctrl+D | New / close / delete note |
| Ctrl+H | Notes list |
| Ctrl+B / I / U / T / E | Bold / italic / underline / strikethrough / inline code |
| Ctrl+Shift+L / O / C | Bulleted / numbered list / checklist |
| Ctrl+Alt+1 / 2 / 3 / 0 | Title / heading / subheading / normal text |
| Tab / Shift+Tab | Indent / outdent (list items, table cells) |
| Alt+Shift+↑ / ↓ | Move a list item |
| Ctrl+K | Link |
| Ctrl+F | Find in note |
| Ctrl+Shift+H | Edit HTML source |
| Ctrl+Shift+V | Paste as plain text |
| Ctrl+Shift+P | Keep on top |
| Ctrl+Shift+R | Roll up / unroll (or double-click the title bar) |
| Ctrl+= / Ctrl+- / Ctrl+0 | Zoom in / out / reset |
| Ctrl+P | Print |
| Ctrl+Click | Open a link, linked note or #tag |

## Where your notes live

Everything stays on your computer, in `%APPDATA%\Stickies\data\`:
- `notes.json`: your notes
- `settings.json`: your preferences
- `templates.json`: your templates
- `vault.json`: the private-notes key, wrapped by your password
- `attachments\`: images; private ones end in `.enc`, and cached recognized text ends in `.txt`
- `history\`: version history
- `backups\`: daily copies of `notes.json`
- `api.json`: the local API port and token, written while Stickies runs (also to `%USERPROFILE%\.stickies\api.json`, which Windows never redirects; see below)

If Stickies is started by a packaged Windows app (for example from a terminal inside Claude Desktop), Windows redirects everything it writes to AppData into that app's private folder (`%LOCALAPPDATA%\Packages\<app>\LocalCache\Roaming\Stickies\`). That copy of Stickies then has its own notes, separate from the ones you see when you start it from the Start menu.

## Project layout

```
src/
  main/                  Electron main process
    main.js              lifecycle, protocols, IPC, hotkeys, private-note encryption, checklist resets
    windows.js           note windows, workspace layouts, notes list and history windows
    store.js             saving (atomic + fsync, backups, recovery), templates, image attachments
    html-scan.js         tags, links, task counts and checklist resets from HTML, without a DOM
    history.js           version history snapshots
    vault.js             private notes: key wrapping, AES-GCM, Windows Hello
    workspaces.js        saved layouts and monitor-setup switching
    snip.js / ocr.js     screen snips and Windows text recognition
    api-server.js        local API for OpenCode and scripts
    agent-notes.js       AI task notes (OpenCode)
    opencode.js          installs/removes the OpenCode plugin
    reminders.js, exporter.js, markdown.js, context-menu.js, tray.js
  integrations/opencode-plugin.js   the plugin that runs inside OpenCode
  preload.js             the safe API the windows are allowed to use
  renderer/
    note/                editor engine, "/" "#" "[[" suggestions, smart checklists, lock screen
    manager/             notes list, sidebar, tasks, settings
    history/             version history window
    snip/                screen snip overlay
    shared/              palette, icons, HTML sanitizer, HTML → Markdown
```

Security: every window is sandboxed with context isolation, a strict Content-Security-Policy blocks scripts in note content, and everything pasted, dropped, imported or typed into the HTML source editor goes through an allowlist sanitizer.

## License

MIT. See [LICENSE](LICENSE).
