'use strict';

// Connects Claude Code and Codex to OpenStickies: copies the MCP server (and, for Claude Code,
// the hook) into ~/.stickies/agents/ and registers them in each client's config. The scripts
// live in the user folder rather than the app folder because the app moves on update (and an
// AppImage can be anywhere), while a client config points at one fixed path.

const fs = require('fs');
const os = require('os');
const path = require('path');

const SOURCES = {
  mcp: path.join(__dirname, '..', 'integrations', 'stickies-mcp.mjs'),
  hook: path.join(__dirname, '..', 'integrations', 'claude-hook.mjs')
};
const INSTALL_DIR = path.join(os.homedir(), '.stickies', 'agents');
const INSTALLED = { mcp: path.join(INSTALL_DIR, 'stickies-mcp.mjs'), hook: path.join(INSTALL_DIR, 'claude-hook.mjs') };

// Apps started from the Dock or a desktop launcher get a short PATH without the user's shell
// additions, so also look where the installers and Homebrew put binaries.
function extraDirs() {
  if (process.platform === 'win32') return [path.join(process.env.APPDATA || '', 'npm'), path.join(process.env.LOCALAPPDATA || '', 'Programs', 'nodejs')];
  return [path.join(os.homedir(), '.local', 'bin'), '/opt/homebrew/bin', '/usr/local/bin'];
}

function findOnPath(name) {
  const win = process.platform === 'win32';
  const exts = win ? ['.cmd', '.exe', ''] : [''];
  const dirs = String(process.env.PATH || '').split(path.delimiter).concat(extraDirs());
  for (const dir of dirs) {
    if (!dir) continue;
    for (const ext of exts) {
      const file = path.join(dir, name + ext);
      try { if (fs.statSync(file).isFile()) return file; } catch { /* not here */ }
    }
  }
  return null;
}

// The scripts need a Node runtime. The user's own node is preferred; failing that, the app's
// executable can run them as Node (Electron honours ELECTRON_RUN_AS_NODE).
function runtime() {
  const node = findOnPath('node');
  if (node && !node.endsWith('.cmd')) return { command: node, env: {} };
  return { command: process.execPath, env: { ELECTRON_RUN_AS_NODE: '1' } };
}

function q(s) { return `"${String(s).replace(/"/g, '\\"')}"`; }

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

// Other programs write these files too (Claude Code rewrites ~/.claude.json constantly), so never
// leave a half-written one behind.
function writeAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

function installScripts(names) {
  fs.mkdirSync(INSTALL_DIR, { recursive: true });
  for (const n of names) fs.writeFileSync(INSTALLED[n], fs.readFileSync(SOURCES[n], 'utf8'));
}

function outdated(names) {
  return names.some(n => {
    try { return fs.readFileSync(INSTALLED[n], 'utf8') !== fs.readFileSync(SOURCES[n], 'utf8'); } catch { return true; }
  });
}

function removeScriptsUnlessUsed() {
  // The MCP server is shared; the hook is Claude Code's alone.
  if (!claude.status().connected) fs.rmSync(INSTALLED.hook, { force: true });
  if (!claude.status().connected && !codex.status().connected) fs.rmSync(INSTALLED.mcp, { force: true });
}

// ---------- Claude Code ----------
// Hooks go in ~/.claude/settings.json; MCP servers for every project go in ~/.claude.json.

const HOOK_EVENTS = [['UserPromptSubmit', null], ['PostToolUse', 'TodoWrite'], ['Stop', null], ['SessionEnd', null]];

function claudeDir() { return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'); }
function claudeSettingsFile() { return path.join(claudeDir(), 'settings.json'); }
function claudeMcpFile() { return path.join(os.homedir(), '.claude.json'); }

const isOurHook = (h) => h && typeof h.command === 'string' && h.command.includes(INSTALLED.hook);

function withoutOurHooks(hooks) {
  const out = {};
  for (const [event, entries] of Object.entries(hooks || {})) {
    if (!Array.isArray(entries)) { out[event] = entries; continue; }
    const kept = entries.filter(e => !(e && Array.isArray(e.hooks) && e.hooks.some(isOurHook)));
    if (kept.length) out[event] = kept;
  }
  return out;
}

const claude = {
  status() {
    const settings = readJson(claudeSettingsFile(), {});
    const hooked = HOOK_EVENTS.every(([event]) => Array.isArray(settings.hooks && settings.hooks[event]) && settings.hooks[event].some(e => e && Array.isArray(e.hooks) && e.hooks.some(isOurHook)));
    const mcp = readJson(claudeMcpFile(), {});
    const served = !!(mcp.mcpServers && mcp.mcpServers.stickies);
    const connected = hooked && served;
    return {
      found: !!findOnPath('claude') || fs.existsSync(claudeDir()),
      connected,
      partial: !connected && (hooked || served),
      outdated: connected && outdated(['mcp', 'hook']),
      path: claudeSettingsFile()
    };
  },
  connect() {
    installScripts(['mcp', 'hook']);
    const rt = runtime();
    const settings = readJson(claudeSettingsFile(), {});
    const hooks = withoutOurHooks(settings.hooks);
    const envPrefix = Object.entries(rt.env).map(([k, v]) => process.platform === 'win32' ? `set ${k}=${v}&& ` : `${k}=${v} `).join('');
    for (const [event, matcher] of HOOK_EVENTS) {
      const entry = { hooks: [{ type: 'command', command: `${envPrefix}${q(rt.command)} ${q(INSTALLED.hook)}`, timeout: 10 }] };
      if (matcher) entry.matcher = matcher;
      hooks[event] = [...(hooks[event] || []), entry];
    }
    settings.hooks = hooks;
    writeAtomic(claudeSettingsFile(), JSON.stringify(settings, null, 2) + '\n');

    const mcp = readJson(claudeMcpFile(), {});
    mcp.mcpServers = { ...(mcp.mcpServers || {}), stickies: { type: 'stdio', command: rt.command, args: [INSTALLED.mcp, '--client', 'claude'], env: rt.env } };
    writeAtomic(claudeMcpFile(), JSON.stringify(mcp, null, 2) + '\n');
    return claude.status();
  },
  disconnect() {
    const settings = readJson(claudeSettingsFile(), null);
    if (settings) {
      settings.hooks = withoutOurHooks(settings.hooks);
      if (!Object.keys(settings.hooks).length) delete settings.hooks;
      writeAtomic(claudeSettingsFile(), JSON.stringify(settings, null, 2) + '\n');
    }
    const mcp = readJson(claudeMcpFile(), null);
    if (mcp && mcp.mcpServers && mcp.mcpServers.stickies) {
      delete mcp.mcpServers.stickies;
      writeAtomic(claudeMcpFile(), JSON.stringify(mcp, null, 2) + '\n');
    }
    removeScriptsUnlessUsed();
    return claude.status();
  }
};

// ---------- Codex ----------
// One managed block appended to ~/.codex/config.toml, so the rest of the file is never touched.

const BLOCK_BEGIN = '# BEGIN OpenStickies';
const BLOCK_END = '# END OpenStickies';
const BLOCK_RE = /\n*# BEGIN OpenStickies\n[\s\S]*?# END OpenStickies\n?/g;

function codexDir() { return process.env.CODEX_HOME || path.join(os.homedir(), '.codex'); }
function codexConfigFile() { return path.join(codexDir(), 'config.toml'); }

// TOML basic strings take the same escapes JSON uses for paths.
const toml = (s) => JSON.stringify(String(s));

function codexBlock(rt) {
  const lines = [
    BLOCK_BEGIN,
    '# Written by OpenStickies (Settings → Codex). Disconnect there to remove it.',
    '[mcp_servers.stickies]',
    `command = ${toml(rt.command)}`,
    `args = [${toml(INSTALLED.mcp)}, "--client", "codex"]`
  ];
  if (Object.keys(rt.env).length) lines.push(`env = { ${Object.entries(rt.env).map(([k, v]) => `${k} = ${toml(v)}`).join(', ')} }`);
  lines.push(BLOCK_END);
  return lines.join('\n') + '\n';
}

const codex = {
  status() {
    let text = '';
    try { text = fs.readFileSync(codexConfigFile(), 'utf8'); } catch { /* no config yet */ }
    const connected = text.includes(BLOCK_BEGIN) && text.includes('[mcp_servers.stickies]');
    return {
      found: !!findOnPath('codex') || fs.existsSync(codexDir()),
      connected,
      outdated: connected && outdated(['mcp']),
      path: codexConfigFile()
    };
  },
  connect() {
    installScripts(['mcp']);
    let text = '';
    try { text = fs.readFileSync(codexConfigFile(), 'utf8'); } catch { /* no config yet */ }
    text = text.replace(BLOCK_RE, '\n');
    if (text && !text.endsWith('\n')) text += '\n';
    if (text) text += '\n';
    writeAtomic(codexConfigFile(), text + codexBlock(runtime()));
    return codex.status();
  },
  disconnect() {
    let text = null;
    try { text = fs.readFileSync(codexConfigFile(), 'utf8'); } catch { /* nothing to remove */ }
    if (text !== null && text.includes(BLOCK_BEGIN)) writeAtomic(codexConfigFile(), text.replace(BLOCK_RE, '\n').replace(/\n+$/, '\n'));
    removeScriptsUnlessUsed();
    return codex.status();
  }
};

module.exports = { claude, codex, runtime, INSTALL_DIR, INSTALLED };
