# Screenshots

`npm run screenshots` regenerates every image in [`docs/screenshots/`](../../docs/screenshots) from the real app, so the README and the website never drift from what OpenStickies actually looks like.

```bash
npm run screenshots                         # everything (about a minute)
npm run screenshots -- --only=hero,tasks    # just some scenes (social-preview reuses hero)
npm run screenshots -- --keep-raw           # keep the per-window captures and seeded data
```

No extra dependencies: it drives the Electron that `npm install` already downloaded.

## How it works

| File | Job |
|---|---|
| `capture.js` | Orchestrator. Runs each scene in its own Electron process, then the compositor. |
| `scenes.js` | The demo notes, what each scene opens and clicks, and where each window goes in the final picture. |
| `runner.js` | Runs inside Electron. Seeds a throwaway data folder (`STICKIES_USER_DATA`), boots `src/main/main.js` against it, plays the scene and captures each window with `webContents.capturePage()` at 2.5× scale. |
| `compose.js` | Runs inside Electron. Lays the captures out on a soft backdrop with Windows 11 corners and shadows, draws back the caption buttons that Windows paints for the notes list and history windows, and writes the PNGs (2400×1500, hero 2560×1440, social preview 1280×640). |
| `art.js` | The pictures used inside the demo notes (SVG, drawn for this). |

Your own notes are never touched: every scene starts from an empty, temporary data folder.

## Where to run it

- **Windows:** works from a normal desktop session. The windows flash up briefly at 2.5× size; don't move the mouse over them while it runs, or hover effects end up in the shots.
- **Linux:** runs under `xvfb-run` automatically when there's no display (`sudo apt install xvfb`). Fonts fall back to whatever replaces Segoe UI (Inter looks closest).
- **macOS:** untested.

Dates in the notes (`@tomorrow`, "22 minutes ago", the version history timeline) are relative to when you run it, so they always look current.

## Adding a scene

Add an entry to `scenes` in `scenes.js`:
- `notes(L)` returns the notes to seed. `at(note, x, y, w, h)` opens one at those bounds; `closed(note)` adds it to the notes list only.
- `steps(ctx)` (optional) stages the UI. `ctx.noteWindow(id)`, `ctx.waitForWindow('manager' | 'history')`, `ctx.js(win, code)`, `ctx.click(win, selector)`, `ctx.type(win, text)`, `ctx.selectText(win, text)` and `ctx.focus(win)` cover what the existing scenes need. The renderer's `window.stickies` API (see `src/preload.js`) is the easiest way to open windows.
- `shots` lists what to capture: note ids, or `manager` / `history`.
- `layout` places each shot on the canvas in CSS pixels; `chrome: 'caption'` adds the window buttons.
