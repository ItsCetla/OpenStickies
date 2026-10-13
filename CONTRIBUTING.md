# Contributing to OpenStickies

Thanks for helping out! Bug reports, ideas and pull requests are all welcome.

- **Bugs and ideas:** open an [issue](https://github.com/ItsCetla/OpenStickies/issues/new/choose).
- **Security problems:** please report them privately, as described in [SECURITY.md](SECURITY.md).
- **Bigger changes:** open an issue first so we can agree on the approach before you put time into it.

## Development setup

You need [Node.js](https://nodejs.org/) 20 or newer. OpenStickies runs on Windows, macOS and Linux, and you can develop on any of them. A few features depend on the system:

- **Windows:** text recognition uses Windows' built-in OCR, and private notes can unlock with Windows Hello.
- **macOS:** text recognition uses Apple's Vision, and private notes can unlock with Touch ID. Snipping needs the Screen Recording permission for the app you run it from.
- **Linux:** text recognition needs `tesseract` installed. Private notes unlock with the password only. On Wayland, snips go through the desktop's screen-sharing prompt, and on GNOME the tray icon needs the AppIndicator extension.

If your change touches one of these, try it on that system or say in the pull request that you couldn't.

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
| `npm run dist` | Builds the Windows installer and the portable app into `dist/` (run it on Windows) |
| `npm run dist:mac` | Builds the Mac disk images and `.zip` files into `dist/` (run it on a Mac) |
| `npm run dist:linux` | Builds the Linux AppImage and `.deb` into `dist/` (run it on Linux) |
| `npm run icons` | Redraws the app icons in `assets/` |
| `npm run screenshots` | Regenerates the screenshots in `docs/screenshots/` (see [below](#screenshots)) |
| `npm run check:locales` | Checks the translation files in `src/locales/` against `src/locales/en.json` and the keys used in code (see [below](#translations)) |

### Keep your real notes out of it

Point `STICKIES_USER_DATA` at a scratch folder and OpenStickies keeps all its data there (in a `data` subfolder) instead of in the usual folder:

| System | Usual folder |
|---|---|
| Windows | `%APPDATA%\OpenStickies` |
| macOS | `~/Library/Application Support/OpenStickies` |
| Linux | `~/.config/OpenStickies` |

It also skips the one-time copy of notes from the old `%APPDATA%\Stickies` folder on Windows (see `src/main/migrate.js`), and skips writing `~/.stickies/api.json`, so a test copy can't take over your everyday copy's OpenCode connection. While it's set, the **Where your notes live** setting can't move the data folder.

```powershell
# PowerShell
$env:STICKIES_USER_DATA = "$env:TEMP\stickies-test"
npm run dev
```

```bash
# macOS, Linux or Git Bash
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

There's no automated test suite yet, so try your change by hand in the running app, ideally with `STICKIES_USER_DATA` pointing at a scratch folder. Say in the pull request what you tried and on which system and version (for example Windows 11, macOS 15 or Ubuntu 24.04). If your change touches checklists, private notes, workspaces or saving, please also check that existing notes still load correctly.

## Screenshots

The screenshots on the README and the website are generated, not taken by hand. `npm run screenshots` starts OpenStickies with sample notes in a throwaway data folder, captures its windows, and writes the images to `docs/screenshots/`. It runs on Windows, or on Linux under Xvfb, and needs nothing beyond `npm install`. See [scripts/screenshots/README.md](scripts/screenshots/README.md) for how scenes work.

Rerun it when your change alters something visible, and include the updated images in your pull request.

## Translations

The interface strings live in `src/locales/`, one JSON file per language, with `en.json` as the reference. Code looks strings up by key, so to fix a translation edit the value in that language's file, and to add a string add it to `en.json` first and then to the other files (a missing key falls back to English). To add a language, copy `en.json` to `<code>.json`, translate the values and keep every `{placeholder}` as it is, then add the code to the `SUPPORTED` list in `src/main/i18n.js` and the language, named in itself, to the Language setting in `src/renderer/manager/manager.html`. `npm run check:locales` reports keys that are missing, unknown or have the wrong placeholders. The welcome note and the built-in templates stay in English.

## Pull requests

1. Fork the repository and create a branch from `main`.
2. Keep each pull request focused on one change.
3. Add a line under `## [Unreleased]` in [CHANGELOG.md](CHANGELOG.md) for anything users will notice.
4. Update the README if you add or change a feature, shortcut or setting.
5. Fill in the pull request template, with before and after screenshots for visible changes.

## Releasing

For maintainers. Releases are built by the [Release workflow](.github/workflows/release.yml) on GitHub Actions, which builds on Windows, macOS and Linux runners at the same time.

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

5. The workflow checks that the tag matches the version in `package.json`, builds every platform, writes `SHA256SUMS.txt`, and creates a **draft** release with all the files attached:
   - Windows: `OpenStickies-Setup-3.1.0.exe` and `OpenStickies-Portable-3.1.0.exe`
   - macOS: `OpenStickies-3.1.0-mac-arm64.dmg`, `OpenStickies-3.1.0-mac-x64.dmg`, and the matching `-mac-arm64.zip` and `-mac-x64.zip`
   - Linux: `OpenStickies-3.1.0-linux-x86_64.AppImage` and `openstickies_3.1.0_amd64.deb`

   It uses that version's CHANGELOG section as the release notes.
6. Open the draft on the [Releases page](https://github.com/ItsCetla/OpenStickies/releases), download and try the builds, edit the notes if needed, then click **Publish release**.

To rebuild an existing tag (for example after a failed run), open **Actions → Release → Run workflow** and enter the tag. The Windows builds aren't code-signed. If one platform fails, the others still build.

### Signing the Mac builds

Without any setup the workflow signs the Mac app ad hoc (the `"identity": "-"` in `package.json`), which is enough for Apple silicon to run it, but macOS asks before the first launch. To have the builds signed with a Developer ID and notarized by Apple, so they open without a warning, add these repository secrets (**Settings → Secrets and variables → Actions**):

| Secret | Value |
| --- | --- |
| `MAC_CERTIFICATE` | Your **Developer ID Application** certificate and private key, exported from Keychain Access as a `.p12` file and base64-encoded: `base64 -i certificate.p12 \| pbcopy` |
| `MAC_CERTIFICATE_PASSWORD` | The password you gave the `.p12` file when exporting it |
| `APPLE_ID` | The Apple ID of the developer account |
| `APPLE_APP_SPECIFIC_PASSWORD` | An [app-specific password](https://support.apple.com/en-us/102654) for that Apple ID |
| `APPLE_TEAM_ID` | The 10-character Team ID shown on the [Apple Developer membership page](https://developer.apple.com/account#MembershipDetailsCard) |

The workflow signs with the Developer ID when `MAC_CERTIFICATE` and `APPLE_TEAM_ID` are both set (the Team ID picks the certificate), and notarizes when the Apple ID secrets are set too. The release notes then drop the "macOS says OpenStickies can't be opened?" paragraph. The entitlements are in `build/entitlements.mac.plist`.

To sign a local build with a Developer ID certificate that's in your login keychain, pass the Team ID as the identity:

```bash
npx electron-builder --mac -c.mac.identity=ABCDE12345
```

Add `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID` to the environment to have it notarized as well.

> [!IMPORTANT]
> Keep `build.nsis.guid` in `package.json` as it is. It's the installer identity electron-builder derived from the app's old id (`com.stickies.desktop`), and it's how the installer finds an existing Stickies or OpenStickies install to upgrade. Changing it makes new installers install a second copy next to the old one.
