<div align="center">

<img src="assets/icon.png" alt="Stickies app icon: a yellow sticky note" width="112" height="112">

<h1>OpenStickies</h1>

<p><b>Sticky notes for the Windows desktop, rebuilt with rich text, checklists, images, version history and private notes.</b></p>

<p>
  <a href="https://github.com/ItsCetla/OpenStickies/releases/latest"><img src="https://img.shields.io/github/v/release/ItsCetla/OpenStickies?display_name=tag&sort=semver" alt="Latest release"></a>
  <a href="https://github.com/ItsCetla/OpenStickies/releases"><img src="https://img.shields.io/github/downloads/ItsCetla/OpenStickies/total" alt="Total downloads"></a>
  <a href="#download"><img src="https://img.shields.io/badge/platform-Windows%2010%20%7C%2011-0078D4" alt="Platform: Windows 10 and 11"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="License: MIT"></a>
  <a href="https://www.electronjs.org"><img src="https://img.shields.io/badge/built%20with-Electron-47848F?logo=electron&logoColor=white" alt="Built with Electron"></a>
</p>

<p>
  <a href="https://github.com/ItsCetla/OpenStickies/releases/latest"><b>Download</b></a>
  &nbsp;·&nbsp;
  <a href="https://itscetla.github.io/OpenStickies/">Website</a>
  &nbsp;·&nbsp;
  <a href="#highlights">Features</a>
  &nbsp;·&nbsp;
  <a href="#opencode-integration">OpenCode</a>
  &nbsp;·&nbsp;
  <a href="#keyboard-shortcuts">Shortcuts</a>
  &nbsp;·&nbsp;
  <a href="CHANGELOG.md">Changelog</a>
</p>

<img src="docs/screenshots/hero.png" alt="Several colorful Stickies notes floating on a Windows desktop" width="100%">

</div>

<br>

**Stickies** is sticky notes for the Windows desktop, rebuilt with rich formatting, images, checklists, reminders, tags, links between notes, workspaces, version history, private notes, screen snips with searchable text, and an OpenCode integration. Every note is its own small floating window, like classic Stickies.

OpenStickies is the open-source project behind it. The app itself installs and runs as **Stickies**.

## Download

Stickies runs on **Windows 10 and 11**. Get the latest version from the **[Releases page](https://github.com/ItsCetla/OpenStickies/releases/latest)**.

| Build | File | What it does |
|---|---|---|
| **Installer** | `Stickies-Setup-<version>.exe` | Installs Stickies and adds Start menu and desktop shortcuts. |
| **Portable** | `Stickies-Portable-<version>.exe` | Runs without installing anything. |

> [!NOTE]
> The builds aren't code-signed, so Windows SmartScreen may say "Windows protected your PC". Click **More info → Run anyway**.

To verify a download, compare `Get-FileHash .\Stickies-Setup-<version>.exe` (PowerShell) with the matching line in `SHA256SUMS.txt` from the same release.

> [!TIP]
> Stickies keeps running in the **system tray** after you close every note. Windows hides new tray icons behind the **^** arrow at the right end of the taskbar; drag the yellow icon onto the taskbar to keep it in view. Click it to bring your notes back, or right-click it for more.

Prefer to build it yourself? See [Build from source](#build-from-source).

## Highlights

<table>
  <tr>
    <td width="50%" valign="top">
      <img src="docs/screenshots/formatting.png" alt="A note with rich text formatting and the slash command menu open" width="100%">
      <p align="center"><b>Rich text, Markdown shortcuts and a "/" menu for everything else.</b></p>
    </td>
    <td width="50%" valign="top">
      <img src="docs/screenshots/checklists.png" alt="A nested checklist with due dates and a progress count in the title bar" width="100%">
      <p align="center"><b>Nested checklists with due dates and a progress count.</b></p>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <img src="docs/screenshots/images.png" alt="A picture wrapped in text inside a note" width="100%">
      <p align="center"><b>Pictures wrap around text, like in Word.</b></p>
    </td>
    <td width="50%" valign="top">
      <img src="docs/screenshots/notes-list.png" alt="The Notes list window with its sidebar and search box" width="100%">
      <p align="center"><b>Find any note by its words, tags or filters.</b></p>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <img src="docs/screenshots/tasks.png" alt="The Tasks view with checklist items grouped by due date" width="100%">
      <p align="center"><b>Every open to-do from every note, grouped by due date.</b></p>
    </td>
    <td width="50%" valign="top">
      <img src="docs/screenshots/history.png" alt="The version history window highlighting word-level changes" width="100%">
      <p align="center"><b>Version history highlights word-by-word changes.</b></p>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <img src="docs/screenshots/opencode.png" alt="A blue OpenCode task note showing the agent's plan with ticked and pending steps" width="100%">
      <p align="center"><b>Follow OpenCode's plan on a live sticky as it works.</b></p>
    </td>
    <td width="50%" valign="top">
      <img src="docs/screenshots/private.png" alt="A locked private note asking for the password" width="100%">
      <p align="center"><b>Private notes are encrypted and locked with your password.</b></p>
    </td>
  </tr>
  <tr>
    <td colspan="2" valign="top">
      <img src="docs/screenshots/dark-mode.png" alt="Several notes in the dark theme" width="100%">
      <p align="center"><b>Light and dark themes, or follow Windows.</b></p>
    </td>
  </tr>
</table>

## Writing

- **Formatting:** bold, italic, underline, strikethrough, superscript/subscript, titles and headings, quotes, code blocks, 9 text colors, 6 highlights, 5 sizes, alignment, links, tables and dividers.
- **Formatting toolbar:** by default it pops up over the bottom edge when you select text or point at the bottom of a note, so a note never changes size. Settings has **While editing** and **Always** options.
- **"/" command menu:** type `/` to insert a heading, checklist, table, image, screen snip, date, link, reminder, or one of your **templates**.
- **Edit HTML source** (Ctrl+Shift+H) to change a note's HTML directly.

**Markdown-style typing** converts as you go:

| Type | To get |
|---|---|
| `# ` / `## ` / `### ` | Headings |
| `- ` | Bulleted list |
| `1. ` | Numbered list |
| `[] ` | Checklist item |
| `> ` | Quote |
| ```` ``` ```` then Enter | Code block |
| `---` then Enter | Divider |
| `**bold**`, `*italic*`, `~~strike~~`, `` `code` ``, `==highlight==` | Inline formatting |

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
- **Workspaces:** save the current arrangement of notes (which are open, where they are, their size, whether they're on top or rolled up) as "Work", "Home" and so on, and switch from the sidebar, the tray or **Ctrl+Alt+W**. Each workspace remembers changes when you switch away. When you plug into a dock or change monitors, Stickies switches to the workspace you last used with that setup.
- **Templates:** six built-in templates (meeting notes, daily plan, daily habits, weekly review, packing list, shopping list). Turn any note into one from its ⋯ menu with **Save as template…**. Templates fill in `{{date}}`, `{{time}}`, `{{weekday}}`, `{{week}}` and `{{tomorrow}}`, and `{{cursor}}` marks where typing starts.

### Notes list, search and tasks

The **notes list** (Ctrl+H) has a sidebar with:

- views: All, On desktop, Kept on top, Reminders, **Tasks**, Trash
- your saved searches
- your tags
- your workspaces

Its search understands these filters:

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

**Tasks** shows every unticked checklist item from every note, grouped by note or by due date. Tick items right there and the note updates, even if it's closed. Click an item to jump to it.

## Safety

- **Version history:** Stickies keeps a snapshot whenever you come back to a note after a few minutes away. ⋯ → **Version history…** shows a timeline, previews old versions, highlights word-by-word **changes**, and restores any version. The current text stays in the history, so a restore can be undone.
- **Trash** keeps deleted notes for 30 days. Daily backups cover the last 14 days, and saves are crash-safe.
- **Backup & restore** puts every note, image and template in one file (private notes stay encrypted).

### Private notes

Set a password in Settings, then use ⋯ → **Make private…** on any note.

- Its words and pictures are encrypted on disk (AES-256-GCM, with the key protected by your password via scrypt).
- While locked, private notes are hidden from search, previews and exports.
- They lock automatically after a set idle time, and when Windows locks or sleeps.
- Windows Hello can unlock them if it's set up on the PC.

> [!WARNING]
> If you forget the password, private notes can't be recovered.

## OpenCode integration

While [OpenCode](https://opencode.ai) works on a multi-step task, a sticky on your desktop shows its plan:

- the steps it has finished are ticked, and the step it's on is marked ▶
- the steps still to do stay open, so you can see where it's going
- sub-agents' lists appear as sections of the same note
- a status line says *Working on step 3 of 7*, *Waiting for you*, *All 7 steps done* or *Stopped with an error*

### Connect OpenCode

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

### Local API

Under the hood, Stickies runs a small local API on `127.0.0.1` with a random port and a token stored in `%USERPROFILE%\.stickies\api.json` (and a copy in `%APPDATA%\Stickies\data\api.json`). Requests from web pages are refused. Scripts can use it too.

<details>
<summary><b>Example request and endpoints</b></summary>

<br>

```bash
curl -X POST http://127.0.0.1:PORT/v1/notes -H "Authorization: Bearer TOKEN" -H "Content-Type: application/json" -d "{\"title\":\"From a script\",\"content\":\"- [ ] one\\n- [x] two\"}"
```

| Endpoint | Purpose |
|---|---|
| `POST /v1/notes` | Create a note (title, Markdown content, optional color and tags) |
| `GET /v1/notes` | List notes created through the API (never your own) |
| `PATCH /v1/notes/:id` | Replace, append to, rename or recolor a note created through the API |
| `POST /v1/notes/:id/check` | Tick or untick a checklist item by its text or number |
| `PUT /v1/agent/:key` | Create or update an AI task note |
| `GET /v1/ping` | Check that Stickies is running (no token needed) |

</details>

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

Everything stays on your computer, in `%APPDATA%\Stickies\data\`.

<details>
<summary><b>What's in that folder</b></summary>

<br>

- `notes.json`: your notes
- `settings.json`: your preferences
- `templates.json`: your templates
- `vault.json`: the private-notes key, wrapped by your password
- `attachments\`: images; private ones end in `.enc`, and cached recognized text ends in `.txt`
- `history\`: version history
- `backups\`: daily copies of `notes.json`
- `api.json`: the local API port and token, written while Stickies runs (also to `%USERPROFILE%\.stickies\api.json`, which Windows never redirects; see below)

**Started from a packaged Windows app?** If Stickies is started by a packaged Windows app (for example from a terminal inside Claude Desktop), Windows redirects everything it writes to AppData into that app's private folder (`%LOCALAPPDATA%\Packages\<app>\LocalCache\Roaming\Stickies\`). That copy of Stickies then has its own notes, separate from the ones you see when you start it from the Start menu.

</details>

## Build from source

You need [Node.js](https://nodejs.org) 20 or newer.

```bash
git clone https://github.com/ItsCetla/OpenStickies.git
cd OpenStickies
npm install
npm start
```

| Command | What it does |
|---|---|
| `npm install` | Installs dependencies and also downloads Electron itself, through the project's `postinstall` script (npm 11 no longer runs dependencies' install scripts on its own) |
| `npm start` | Runs Stickies |
| `npm run dev` | Runs with DevTools turned on (Ctrl+Shift+I in a note) |
| `npm run dist` | Builds the installer and portable app into `dist/` |

`Stickies.exe --quit` closes a running copy cleanly (it saves first).

### Project layout

<details>
<summary><b>Show the source tree</b></summary>

<br>

```
src/
  main/                  Electron main process
    main.js              lifecycle, protocols, IPC, hotkeys, private-note encryption, checklist resets
    windows.js           note windows, workspace layouts, notes list and history windows
    store.js             saving (atomic + fsync, backups, recovery), templates, image attachments
    store-text.js        plain-text helpers shared by the store and the HTML scanners
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

</details>

## Contributing

Bug reports, ideas and pull requests are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) before you start, and see [CHANGELOG.md](CHANGELOG.md) for what changed in each release.

## Security

Every window is sandboxed with context isolation, a strict Content-Security-Policy blocks scripts in note content, and everything pasted, dropped, imported or typed into the HTML source editor goes through an allowlist sanitizer.

To report a vulnerability, see [SECURITY.md](SECURITY.md).

## License

Stickies is released under the MIT License. See [LICENSE](LICENSE).
