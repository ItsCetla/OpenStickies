# Security policy

## Supported versions

Security fixes go into the latest release only. If you're on an older version, please update from the [Releases page](https://github.com/ItsCetla/OpenStickies/releases) first and check whether the problem is still there.

| Version | Supported |
|---|---|
| Latest release | Yes |
| Anything older | No |

## Reporting a vulnerability

Please **don't** open a public issue for a security problem. Report it privately through GitHub instead:

1. Go to the repository's **Security** tab.
2. Click **Report a vulnerability** (or go straight to [the report form](https://github.com/ItsCetla/OpenStickies/security/advisories/new)).
3. Describe the problem and submit. Only you and the maintainers can see the report.

If there's no **Report a vulnerability** button, private reporting hasn't been switched on yet. (Maintainers: turn it on in **Settings → Code security → Private vulnerability reporting**.) Until then, open an issue that asks for a private way to get in touch, without any details of the problem.

### What to include

- The OpenStickies version, your Windows version, and whether you use the installer, the portable app or a source checkout.
- What an attacker could do, and what they need first: for example a note or backup file you import, text you paste, a web page you visit, or a program already running on your PC.
- Steps to reproduce, or a proof of concept. Use made-up notes, never your real ones.
- Any idea you have for a fix.

### What to expect

OpenStickies is a volunteer project, so responses are best effort. The aim is to acknowledge your report within a week, keep you posted while it's looked into, and credit you in the release notes when a fix ships, unless you'd rather stay anonymous. Please give a reasonable amount of time for a fix before you share details publicly.

## Security model

This section explains what OpenStickies protects against, so you can tell whether something is a vulnerability.

**Windows and note content**

- Every window runs sandboxed, with context isolation and without Node.js. Pages can only use the small API in `src/preload.js`.
- Every page has a strict Content-Security-Policy that only allows the app's own scripts, so scripts in note content can't run.
- Everything pasted, dropped, imported or typed into the HTML source editor goes through an allowlist sanitizer (`src/renderer/shared/sanitize.js`). Links are limited to `http`, `https`, `mailto` and links to other notes, and only `http`, `https` and `mailto` links open outside the app.

**Local API** (for the OpenCode plugin and scripts; see `src/main/api-server.js`)

- It listens only on `127.0.0.1`, on a random port, while OpenStickies is running.
- Every request except `GET /v1/ping` (which returns only the app name and version) needs a random token, sent as `Authorization: Bearer <token>`.
- The port and token are written to `api.json` in the data folder and to `%USERPROFILE%\.stickies\api.json`, and removed when OpenStickies quits.
- Requests from web pages (anything with an `Origin` header) are refused.
- Through the API, a program can only list and change notes that were created through the API. It can't read or change your own notes.

Any program running under your Windows account can read `api.json`, and your notes, so OpenStickies treats such programs as trusted. Reports that need an attacker to already run code as you are generally out of scope, unless they get around private-note encryption while Windows Hello unlock is off.

**Private notes** (see `src/main/vault.js`)

- A private note's content and its pictures are encrypted on disk with AES-256-GCM, using a random 256-bit key.
- That key is stored only wrapped (encrypted) with a key derived from your password with scrypt. OpenStickies can't recover a forgotten password. Choose a strong one: scrypt slows down guessing, but it can't make a short password safe.
- Locking wipes the key from memory and puts private notes back behind their lock screen. Making a note private deletes its old version history, and private notes don't keep any.
- A note's color, position and timestamps aren't encrypted.
- If you turn on **Windows Hello** unlock, OpenStickies also keeps a copy of the key protected by Windows' per-user data protection (DPAPI). With Hello on, private notes are as safe as your Windows account rather than your OpenStickies password. Backups contain only the password-wrapped key.

**Downloads**

Release builds aren't code-signed, so Windows SmartScreen may warn you about them. Each release includes a `SHA256SUMS.txt` file. To check a download, compare the output of `Get-FileHash .\OpenStickies-Setup-<version>.exe` in PowerShell (or `OpenStickies-Portable-<version>.exe`) with the matching line in that file. Only download OpenStickies from this repository's [Releases page](https://github.com/ItsCetla/OpenStickies/releases).
