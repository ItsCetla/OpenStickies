'use strict';

// Installs/removes the OpenStickies plugin in OpenCode's global plugin folder.

const fs = require('fs');
const os = require('os');
const path = require('path');

const PLUGIN_SOURCE = path.join(__dirname, '..', 'integrations', 'opencode-plugin.js');

function configDir() {
  return process.env.OPENCODE_CONFIG_DIR || path.join(os.homedir(), '.config', 'opencode');
}

function pluginPath() {
  return path.join(configDir(), 'plugins', 'stickies.js');
}

function onPath() {
  const exts = ['.cmd', '.exe', ''];
  return String(process.env.PATH || '').split(path.delimiter).some(dir => dir && exts.some(ext => {
    try { return fs.existsSync(path.join(dir, 'opencode' + ext)); } catch { return false; }
  }));
}

function status() {
  const file = pluginPath();
  const connected = fs.existsSync(file);
  let outdated = false;
  if (connected) {
    try { outdated = fs.readFileSync(file, 'utf8') !== fs.readFileSync(PLUGIN_SOURCE, 'utf8'); } catch { outdated = false; }
  }
  return { found: fs.existsSync(configDir()) || onPath(), connected, outdated, path: file };
}

function connect() {
  const file = pluginPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, fs.readFileSync(PLUGIN_SOURCE, 'utf8'));
  return status();
}

function disconnect() {
  fs.rmSync(pluginPath(), { force: true });
  return status();
}

module.exports = { status, connect, disconnect, pluginPath, PLUGIN_SOURCE };
