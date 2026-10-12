# Changelog

All notable changes to OpenStickies are written down here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and OpenStickies uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

<!-- Add changes here as they land, under Added / Changed / Fixed / Removed / Security. They move into a version section when a release is made (see CONTRIBUTING.md). -->

### Fixed

- Opening a search result whose match is in another tab of the note now switches to that tab and highlights the match, and the scroll to the match is no longer undone by the saved scroll position.

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
