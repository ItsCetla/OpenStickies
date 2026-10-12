'use strict';

// Private notes.
//
// A random 256-bit key encrypts private note content (AES-256-GCM). That key is stored
// only in wrapped form: encrypted with a key derived from the user's password (scrypt),
// and optionally with the system's per-user data protection (safeStorage: DPAPI, or the macOS keychain) so Windows
// Hello or Touch ID can unlock it. While unlocked the key lives in memory; locking forgets it.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { t: tr } = require('./i18n');
const { execFile } = require('child_process');
const { EventEmitter } = require('events');
const { safeStorage, systemPreferences } = require('electron');
const { writeFileAtomic } = require('./store');

const SCRYPT = { N: 1 << 15, r: 8, p: 1, maxmem: 96 * 1024 * 1024 };

function seal(key, plain) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([c.update(plain), c.final()]);
  return { iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), data: data.toString('base64') };
}

function open(key, box) {
  const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(box.iv, 'base64'));
  d.setAuthTag(Buffer.from(box.tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(box.data, 'base64')), d.final()]);
}

const HELLO_SCRIPT = (action) => `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Security.Credentials.UI.UserConsentVerifier, Windows.Security.Credentials.UI, ContentType = WindowsRuntime]
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1' })[0]
function Await($op, $type) { $t = $asTask.MakeGenericMethod($type).Invoke($null, @($op)); $t.Wait(-1) | Out-Null; $t.Result }
${action === 'check'
    ? "Await ([Windows.Security.Credentials.UI.UserConsentVerifier]::CheckAvailabilityAsync()) ([Windows.Security.Credentials.UI.UserConsentVerifierAvailability])"
    : "Await ([Windows.Security.Credentials.UI.UserConsentVerifier]::RequestVerificationAsync('Unlock your private sticky notes')) ([Windows.Security.Credentials.UI.UserConsentVerificationResult])"}
`;

// macOS stand-in for Windows Hello: Touch ID. It answers with the same strings as the
// PowerShell script so the rest of the vault treats both the same way. safeStorage keeps the
// quick-unlock key in the login keychain there.
async function runTouchId(action) {
  try {
    if (!systemPreferences.canPromptTouchID()) return '';
    if (action === 'check') return 'Available';
    await systemPreferences.promptTouchID('unlock your private sticky notes');
    return 'Verified';
  } catch {
    return ''; // cancelled, failed, or no enrolled finger
  }
}

function runHello(action) {
  if (process.platform === 'darwin') return runTouchId(action);
  // Linux has no system-wide biometric prompt Electron can reach, so only the password unlocks.
  if (process.platform !== 'win32') return Promise.resolve('');
  const encoded = Buffer.from(HELLO_SCRIPT(action), 'utf16le').toString('base64');
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
      { windowsHide: true, timeout: action === 'check' ? 15000 : 120000 },
      (err, stdout) => resolve(err ? '' : String(stdout).trim()));
  });
}

class Vault extends EventEmitter {
  constructor(dataDir) {
    super();
    this.file = path.join(dataDir, 'vault.json');
    this.cfg = null;
    this.key = null;
    this.lastActivity = Date.now();
    this.helloAvailable = false;
    try { this.cfg = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch { this.cfg = null; }
    runHello('check').then((r) => { this.helloAvailable = r === 'Available'; this.emit('status'); });
  }

  get configured() { return !!(this.cfg && this.cfg.wrapped); }
  get unlocked() { return !!this.key; }
  get id() { return this.cfg ? this.cfg.id : null; }

  status() {
    return {
      configured: this.configured,
      unlocked: this.unlocked,
      hint: (this.cfg && this.cfg.hint) || '',
      hello: !!(this.cfg && this.cfg.helloKey),
      helloAvailable: this.helloAvailable && safeStorage.isEncryptionAvailable()
    };
  }

  _save() { writeFileAtomic(this.file, JSON.stringify(this.cfg, null, 1)); }

  _kek(password, salt) {
    return crypto.scryptSync(String(password).normalize('NFC'), Buffer.from(salt, 'base64'), 32, SCRYPT);
  }

  setup(password, hint) {
    if (this.configured) throw new Error(tr('vault.alreadySetUp'));
    if (String(password).length < 4) throw new Error(tr('vault.tooShort'));
    const key = crypto.randomBytes(32);
    const salt = crypto.randomBytes(16).toString('base64');
    this.cfg = { v: 1, id: crypto.randomBytes(8).toString('hex'), salt, wrapped: seal(this._kek(password, salt), key), hint: String(hint || '').slice(0, 120) };
    this._save();
    this.key = key;
    this.touch();
    this.emit('unlocked');
    return this.status();
  }

  unlock(password) {
    if (!this.configured) return false;
    try {
      this.key = open(this._kek(password, this.cfg.salt), this.cfg.wrapped);
    } catch {
      return false; // wrong password: the GCM tag doesn't verify
    }
    this.touch();
    this.emit('unlocked');
    return true;
  }

  async unlockWithHello() {
    if (!this.cfg || !this.cfg.helloKey || !safeStorage.isEncryptionAvailable()) return false;
    if (await runHello('verify') !== 'Verified') return false;
    try {
      this.key = Buffer.from(safeStorage.decryptString(Buffer.from(this.cfg.helloKey, 'base64')), 'base64');
    } catch {
      return false;
    }
    this.touch();
    this.emit('unlocked');
    return true;
  }

  setHello(enabled) {
    if (!this.unlocked) throw new Error(tr('vault.unlockFirst'));
    if (enabled) {
      if (!safeStorage.isEncryptionAvailable()) throw new Error(tr('vault.noProtection'));
      this.cfg.helloKey = safeStorage.encryptString(this.key.toString('base64')).toString('base64');
    } else delete this.cfg.helloKey;
    this._save();
    return this.status();
  }

  changePassword(newPassword, hint) {
    if (!this.unlocked) throw new Error(tr('vault.unlockFirst'));
    if (String(newPassword).length < 4) throw new Error(tr('vault.tooShort'));
    const salt = crypto.randomBytes(16).toString('base64');
    this.cfg.salt = salt;
    this.cfg.wrapped = seal(this._kek(newPassword, salt), this.key);
    if (typeof hint === 'string') this.cfg.hint = hint.slice(0, 120);
    this._save();
    return this.status();
  }

  lock() {
    if (!this.key) return;
    this.key.fill(0);
    this.key = null;
    this.emit('locked');
  }

  touch() { this.lastActivity = Date.now(); }

  idleLock(minutes) {
    if (this.key && minutes > 0 && Date.now() - this.lastActivity > minutes * 60000) this.lock();
  }

  // ---------- content ----------
  encryptText(text) {
    if (!this.key) throw new Error(tr('vault.locked'));
    this.touch();
    return seal(this.key, Buffer.from(String(text), 'utf8'));
  }

  decryptText(box) {
    if (!this.key) throw new Error(tr('vault.locked'));
    return open(this.key, box).toString('utf8');
  }

  // Images: "<name>" (plain) <-> "<name>.enc" (12-byte IV | 16-byte tag | ciphertext).
  encryptFile(file) {
    if (!this.key || !fs.existsSync(file)) return false;
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv('aes-256-gcm', this.key, iv);
    const data = Buffer.concat([c.update(fs.readFileSync(file)), c.final()]);
    writeFileAtomic(file + '.enc', Buffer.concat([iv, c.getAuthTag(), data]));
    fs.rmSync(file, { force: true });
    fs.rmSync(file + '.txt', { force: true }); // recognized text would leak the image's content
    return true;
  }

  readEncryptedFile(file) {
    if (!this.key) return null;
    const raw = fs.readFileSync(file + '.enc');
    const d = crypto.createDecipheriv('aes-256-gcm', this.key, raw.subarray(0, 12));
    d.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([d.update(raw.subarray(28)), d.final()]);
  }

  decryptFile(file) {
    if (!this.key || !fs.existsSync(file + '.enc')) return false;
    if (!fs.existsSync(file)) fs.writeFileSync(file, this.readEncryptedFile(file));
    fs.rmSync(file + '.enc', { force: true });
    return true;
  }

  // For backups: the wrapped key (useless without the password) so private notes can be restored.
  exportConfig() {
    if (!this.cfg) return null;
    const { helloKey, ...rest } = this.cfg;
    return rest;
  }

  adoptConfig(cfg) {
    if (this.configured || !cfg || !cfg.wrapped || !cfg.salt) return false;
    this.cfg = { v: 1, id: cfg.id, salt: cfg.salt, wrapped: cfg.wrapped, hint: cfg.hint || '' };
    this._save();
    this.emit('status');
    return true;
  }
}

module.exports = { Vault };
