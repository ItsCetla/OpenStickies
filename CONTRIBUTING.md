# Contributing to OpenStickies

Thanks for helping out! Bug reports, ideas and pull requests are all welcome.

- **Bugs and ideas:** open an [issue](https://github.com/ItsCetla/OpenStickies/issues/new/choose).
- **Security problems:** please report them privately, as described in [SECURITY.md](SECURITY.md).
- **Bigger changes:** open an issue first so we can agree on the approach before you put time into it.

## Development setup

You need [Node.js](https://nodejs.org/) 20 or newer. OpenStickies is a Windows app, so develop on Windows 10 or 11 if you can: text recognition and Windows Hello only work there.

```bash
git clone https://github.com/ItsCetla/OpenStickies.git
cd OpenStickies
npm install
npm start
```

`npm install` also downloads Electron, through the project's `postinstall` script.

| Command | What it does |
|---|---|
| `npm start` | Runs OpenStickies from source |
| `npm run dev` | Runs with DevTools turned on: press Ctrl+Shift+I in a note. Errors from the main process print in the terminal. |
| `npm run dist` | Builds the installer and the portable app into `dist/` (run it on Windows) |
| `npm run icons` | Redraws the app icons in `assets/` |
| `npm run screenshots` | Regenerates the screenshots in `docs/screenshots/` (see [below](#screenshots)) |

### Keep your real notes out of it

Point `STICKIES_USER_DATA` at a scratch folder and OpenStickies keeps all its data there (in a `data` subfolder) instead of in `%APPDATA%\OpenStickies`. It also skips the one-time copy of notes from the old `%APPDATA%\Stickies` folder (see `src/main/migrate.js`). It also skips writing `%USERPROFILE%\.stickies\api.json`, so a test copy can't take over your everyday copy's OpenCode connection.

```powershell
# PowerShell
$env:STICKIES_USER_DATA = "$env:TEMP\stickies-test"
npm run dev
```

```bash
# Git Bash or Linux
STICKIES_USER_DATA=/tmp/stickies-test npm run dev
```

In PowerShell the variable stays set until you close that window. Delete the folder to start over with a clean slate.

## Where things live

The [Project layout](README.md#project-layout) section of the README maps out `src/`: the Electron main process in `src/main/`, the code for each window in `src/renderer/`, the bridge between them in `src/preload.js`, and the OpenCode plugin in `src/integrations/`.

The website at https://openstickies.cetla.dev/ is served by GitHub Pages from the `docs/` folder on `main`. The custom domain is set by `docs/CNAME`.

## Code style

Match the code around you. In particular:

- **Main process and preload:** CommonJS (`require` / `module.exports`) with `'use strict';` at the top of each file.
- **Renderer:** plain JavaScript as native ES modules (`<script type="module">`). No framework, no bundler, no build step.
- 2-space indentation, semicolons, single quotes.
- OpenStickies has no runtime npm dependencies. Please talk it over in an issue before adding one.
- Comments explain *why* something is done, not what the next line does.
- Write data files with `writeFileAtomic` from `src/main/store.js`, so a crash can't leave a half-written file.

Security rules every change has to keep:

- Every window is created with `sandbox: true`, `contextIsolation: true` and `nodeIntegration: false`. Windows reach the main process only through the API in `src/preload.js`.
- Every page keeps its strict Content-Security-Policy. No inline scripts, no `eval`.
- All note HTML goes through `sanitizeHtml` from `src/renderer/shared/sanitize.js` before it reaches a page: when a note loads, in previews and version history, and for anything pasted, dropped, imported or typed into the HTML source editor. If you need a new tag or attribute, add it to the allowlist rather than going around the sanitizer.

## Testing your change

There's no automated test suite yet, so try your change by hand in the running app, ideally with `STICKIES_USER_DATA` pointing at a scratch folder. Say in the pull request what you tried and on which Windows version. If your change touches checklists, private notes, workspaces or saving, please also check that existing notes still load correctly.

## Screenshots

The screenshots on the README and the website are generated, not taken by hand. `npm run screenshots` starts OpenStickies with sample notes in a throwaway data folder, captures its windows, and writes the images to `docs/screenshots/`. It runs on Windows, or on Linux under Xvfb, and needs nothing beyond `npm install`. See [scripts/screenshots/README.md](scripts/screenshots/README.md) for how scenes work.

Rerun it when your change alters something visible, and include the updated images in your pull request.

## Pull requests

1. Fork the repository and create a branch from `main`.
2. Keep each pull request focused on one change.
3. Add a line under `## [Unreleased]` in [CHANGELOG.md](CHANGELOG.md) for anything users will notice.
4. Update the README if you add or change a feature, shortcut or setting.
5. Fill in the pull request template, with before and after screenshots for visible changes.

## Releasing

For maintainers. Releases are built by the [Release workflow](.github/workflows/release.yml) on GitHub Actions.

1. Bump the version in `package.json` (and `package-lock.json`) without creating a tag:

   ```bash
   npm version 3.1.0 --no-git-tag-version
   ```

2. In `CHANGELOG.md`, move the notes under `## [Unreleased]` into a new `## [3.1.0] - YYYY-MM-DD` section, and update the version links at the bottom of the file.
3. Commit and push to `main`:

   ```bash
   git commit -am "Release v3.1.0"
   git push
   ```

4. Tag the release and push the tag:

   ```bash
   git tag v3.1.0 && git push origin v3.1.0
   ```

5. The workflow checks that the tag matches the version in `package.json`, builds `OpenStickies-Setup-3.1.0.exe` and `OpenStickies-Portable-3.1.0.exe`, writes `SHA256SUMS.txt`, and creates a **draft** release using that version's CHANGELOG section as the release notes.
6. Open the draft on the [Releases page](https://github.com/ItsCetla/OpenStickies/releases), download and try the builds, edit the notes if needed, then click **Publish release**.

To rebuild an existing tag (for example after a failed run), open **Actions → Release → Run workflow** and enter the tag. The builds aren't code-signed.

> [!IMPORTANT]
> Keep `build.nsis.guid` in `package.json` as it is. It's the installer identity electron-builder derived from the app's old id (`com.stickies.desktop`), and it's how the installer finds an existing Stickies or OpenStickies install to upgrade. Changing it makes new installers install a second copy next to the old one.
