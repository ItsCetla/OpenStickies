# Changelog

All notable changes to OpenStickies are written down here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and OpenStickies uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

<!-- Add changes here as they land, under Added / Changed / Fixed / Removed / Security. They move into a version section when a release is made (see CONTRIBUTING.md). -->

### Fixed

- Reminder notifications no longer play the system sound: Reminder sound set to None is now really silent, and Chime or Soft no longer overlaps the system sound.
- When the custom notes folder can't be found at startup, a new "Always use the default folder" button switches back to the default folder for good, so the warning no longer returns on every start for a folder that is gone.
- A reminder with an unsupported repeat value (from a hand-edited notes.json, a restored backup or another version) no longer fires its notification again every 10 seconds; the repeat is reset to none when notes are loaded or restored.
- On Linux (X11), snapping to screen edges, other notes and the grid now also applies when a note is moved, not only when it is resized.
- Opening a search result whose match is in another tab of the note now switches to that tab and highlights the match, and the scroll to the match is no longer undone by the saved scroll position.
- A note no longer freezes for seconds after each edit when a YAML, Markdown or SQL code block holds one very long line; code blocks with a line over 10,000 characters are left uncolored, and unchanged blocks are not re-colored on every edit.
- Pressing Enter on an empty last line of a code block now leaves the block, including blocks made with ``` or the code block button, and no longer joins the block's lines together; Ctrl+Z restores the removed line.
- Copy as Markdown and Markdown export keep the line breaks of code blocks made from existing lines (with the code block button, ``` or a multi-line inline-code selection), instead of joining the code into one line.
- The image lightbox now closes when the note that opened it is closed, trashed or deleted, and when private notes lock, so a private image no longer stays on screen after the vault locks.
- Notes removed at startup (closed blank notes and trash beyond 300 notes) now also lose their version history and the images only that history used, and importing a backup no longer lets the Trash grow past 300 notes.
- Changing the data location no longer leaves the last edits behind: note windows stop taking input and the local API pauses while the folder is copied, pending moves and resizes are saved first, and notes and settings saved after the copy are carried over before the restart.
- Exporting a note with tabs, on its own or with Export all (Markdown, text, JSON, HTML, PDF and print), now includes every tab under its title instead of only the open one. JSON exports also list the tabs separately in a `tabs` field.
- On an AI agent note with tabs, agent updates, appends and checklist ticks now go to the agent's first tab instead of overwriting whichever tab is open, so tabs the user added keep their own text.
- Code block colors now follow how dark the note itself is, not the app theme, so code stays readable on Charcoal notes and dark custom backgrounds in the light theme, and on light custom backgrounds in the dark theme.
- If copying notes to a new data location fails partway (for example, the disk is full), choosing the same folder again now works instead of being refused because the folder "already has OpenStickies notes".
- Backups now include closed tabs from the Trash, and restoring a backup puts them back in the Trash, where they can still be reopened in their own note.
- Restoring a version from Version history on a note with tabs now puts it back into the tab it came from and switches to that tab, instead of replacing whichever tab was open. The history list shows which tab each version belongs to, and each tab now gets its own snapshot when you start editing it.
- On Linux desktops without a system tray (such as stock GNOME without the AppIndicator extension), starting at login now opens the notes list instead of running with no window and no tray icon. OpenStickies now asks the session bus for a tray host instead of relying on the tray failing to load.
- Dragging a selected passage that contains a file chip from one note into another now keeps the chip and its file, as copy and paste does, instead of turning it into plain text.
- Pressing Tab inside a code block that sits in a bulleted or numbered list item now inserts a tab in the code instead of indenting the list item, and Shift+Tab no longer outdents the item.

## [3.1.0] - 2026-10-12

### Changed

- Stickies is now called **OpenStickies**: the app, its window titles, tray menu, shortcuts, installer (`OpenStickies-Setup-<version>.exe`), portable app (`OpenStickies-Portable-<version>.exe`) and program file (`OpenStickies.exe`).
- Notes now live in `%APPDATA%\OpenStickies\data\`. On its first start, OpenStickies copies everything from `%APPDATA%\Stickies\data\` (notes, pictures, version history, backups, settings, templates and the private-notes key). The old folder is kept as a backup.
- The installer replaces an installed copy of Stickies instead of installing next to it. Your notes are kept.
- "Launch at login" carries over to OpenStickies, and the old Stickies login entry is removed.
- The OpenCode plugin also looks for OpenStickies' `api.json`. Settings → OpenCode offers an update for an already connected plugin.

## [3.0.0] - 2026-10-12

First public release of OpenStickies: sticky notes for the Windows desktop, where every note is its own small floating window.

### Writing

- Rich formatting: bold, italic, underline, strikethrough, superscript and subscript, titles and headings, quotes, code blocks, 9 text colors, 6 highlights, 5 sizes, alignment, links, tables and dividers.
- A formatting toolbar that pops up over the bottom edge of a note, so the note never changes size. It can also show while editing or all the time.
- A "/" command menu for headings, checklists, tables, images, screen snips, dates, links, reminders and templates.
- Markdown-style typing: `# ` headings, `- ` bullets, `1. ` numbered lists, `[] ` checklist items, `> ` quotes, ```` ``` ```` code blocks, `---` dividers, and `**bold**`, `*italic*`, `~~strike~~`, `` `code` `` and `==highlight==`.
- Edit a note's HTML source directly (Ctrl+Shift+H).

### Checklists

- Indent and outdent items with Tab and Shift+Tab, and move them with Alt+Shift+↑/↓ or by dragging.
- Parent items and their sub-items tick and untick together.
- Optionally move ticked items to the bottom, always or once; a progress count (e.g. 3/8) shows in the title bar.
- Checklists that untick themselves every day or every Monday, for routines and habits, and a "remove ticked items" command.
- Due dates such as `@today`, `@fri`, `@nextweek`, `@+3d` or `@10/20`; overdue items turn red.

### Pictures & snips

- Paste, drag in or insert pictures, or snip the screen from anywhere with Ctrl+Alt+X.
- Resize pictures from any corner and lay them out like Word: in line with text, wrapped left or right, top and bottom, behind text or in front of text.
- Text in pictures is read by Windows' built-in text recognition, so search finds it, and you can copy it from the right-click menu.

### Organizing

- `#tags` with suggestions, and `[[links]]` between notes with a "Linked from" list.
- A notes list (Ctrl+H) with views (All, On desktop, Kept on top, Reminders, Tasks, Trash), saved searches, tags and workspaces.
- Search filters such as `#work`, `has:unchecked`, `has:image`, `edited:week`, `due:overdue`, `is:pinned`, `color:blue` and `"exact phrases"`.
- A Tasks view of every unticked checklist item from every note, grouped by note or by due date, that you can tick right there.
- Workspaces that save which notes are open and where, switched from the sidebar, the tray or Ctrl+Alt+W, and automatically when you dock or change monitors.
- Six built-in templates, plus your own, with `{{date}}`, `{{time}}`, `{{weekday}}`, `{{week}}`, `{{tomorrow}}` and `{{cursor}}` placeholders.

### Safety & privacy

- Version history with a timeline, word-by-word changes and undoable restores.
- Private notes, encrypted on disk with AES-256-GCM and a password-protected key (scrypt). While locked they're hidden from search, previews and exports. They lock after a set idle time and when Windows locks or sleeps, and Windows Hello can unlock them.
- Trash keeps deleted notes for 30 days, daily backups cover the last 14 days, and saves are crash-safe.
- Backup & restore of every note, image and template in one file, with private notes still encrypted.
- Everything stays on your computer, in `%APPDATA%\Stickies\data\`.

### OpenCode integration

- While [OpenCode](https://opencode.ai) works on a multi-step task, a sticky shows its plan: finished steps ticked, the current step marked ▶, sub-agents' lists as sections, and a status line.
- Connect and disconnect from Settings → OpenCode, which adds or removes a small OpenCode plugin.
- Every request with two or more distinct subtasks gets a plan sticky, unless you turn off Settings → OpenCode → Always plan multi-part tasks.
- Agent tools `stickies_create`, `stickies_update`, `stickies_check` and `stickies_list`. The agent can only change stickies it created.
- A local API on `127.0.0.1` (random port, token in `api.json`) that scripts can use too.

### Windows integration

- Runs on Windows 10 and 11, as an installer (Start menu and desktop shortcuts) or a portable app.
- Stays in the system tray after you close every note.
- Shortcuts that work anywhere in Windows, changeable in Settings: new note (Ctrl+Alt+N), snip (Ctrl+Alt+X), bring all notes to the front (Ctrl+Alt+S), show or hide all notes (Ctrl+Alt+H) and next workspace (Ctrl+Alt+W).
- Notes can be kept on top, rolled up, zoomed and printed.
- `Stickies.exe --quit` closes a running copy cleanly, saving first.

[Unreleased]: https://github.com/ItsCetla/OpenStickies/compare/v3.1.0...HEAD
[3.1.0]: https://github.com/ItsCetla/OpenStickies/releases/tag/v3.1.0
[3.0.0]: https://github.com/ItsCetla/OpenStickies/releases/tag/Release
