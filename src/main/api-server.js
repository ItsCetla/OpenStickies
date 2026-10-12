'use strict';

// A tiny local API so other programs on this PC (the OpenCode plugin, scripts) can put
// notes on the desktop. It listens on 127.0.0.1 only, on a random port, and every call
// needs the token written to api.json — readable only from this Windows account.
//
// api.json goes to data/ and to any extra paths given. The extra copy matters on Windows: when
// OpenStickies is started by a packaged (MSIX) app such as Claude Desktop, Windows quietly redirects
// its AppData writes into that app's private folder, so other programs never see data/api.json.
//
//   GET  /v1/ping                      → { ok, app, version }            (no token needed)
//   PUT  /v1/agent/:key                → create/update an AI task note    (see agent-notes.js)
//   POST /v1/notes { title?, content?(markdown)|text?|html?, color?, tags?, source?, project? } → { id, items }
//   GET  /v1/notes?project=…           → notes created through the API (never the user's own)
//   PATCH /v1/notes/:id { title?, content?, append?, color?, tags? }     (API-created notes only)
//   POST /v1/notes/:id/check { item, done? }  → tick/untick a checklist item by text or number

const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { writeFileAtomic } = require('./store');

const MAX_BODY = 512 * 1024;

class ApiServer {
  constructor({ dataDir, extraFiles, version, handlers, options }) {
    this.files = [path.join(dataDir, 'api.json'), ...(extraFiles || [])];
    this.version = version;
    this.handlers = handlers;
    this.options = options || (() => ({})); // extra settings the plugin reads from api.json
    this.server = null;
    this.token = crypto.randomBytes(24).toString('hex');
  }

  get running() { return !!(this.server && this.server.listening); }

  start() {
    if (this.server) return;
    this.server = http.createServer((req, res) => this._handle(req, res));
    this.server.on('error', (err) => console.warn('[api] server error:', err.message));
    this.server.listen(0, '127.0.0.1', () => this.publish());
  }

  // (Re)write api.json; called again when an option the plugin reads changes.
  publish() {
    if (!this.running) return;
    const { port } = this.server.address();
    const json = JSON.stringify({ app: 'stickies', version: this.version, port, token: this.token, pid: process.pid, options: this.options() });
    for (const file of this.files) {
      try {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        writeFileAtomic(file, json);
      } catch (err) {
        console.warn(`[api] could not write ${file}:`, err.message);
      }
    }
  }

  stop() {
    if (this.server) { try { this.server.close(); } catch { /* ignore */ } }
    this.server = null;
    for (const file of this.files) {
      try {
        const current = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (current.pid === process.pid) fs.rmSync(file, { force: true });
      } catch { /* already gone */ }
    }
  }

  _send(res, code, obj) {
    res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify(obj));
  }

  _authorized(req) {
    const m = /^Bearer (\S+)$/.exec(req.headers.authorization || '');
    if (!m) return false;
    const given = Buffer.from(m[1]);
    const expected = Buffer.from(this.token);
    return given.length === expected.length && crypto.timingSafeEqual(given, expected);
  }

  _handle(req, res) {
    // Web pages send an Origin header; programs don't. Refuse anything a browser could send.
    if (req.headers.origin) return this._send(res, 403, { error: 'Not available to web pages' });
    const url = new URL(req.url, 'http://127.0.0.1');
    if (req.method === 'GET' && url.pathname === '/v1/ping') return this._send(res, 200, { ok: true, app: 'stickies', version: this.version });
    if (!this._authorized(req)) return this._send(res, 401, { error: 'Missing or wrong token (see api.json)' });

    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { this._send(res, 413, { error: 'Too large' }); req.destroy(); } else chunks.push(c);
    });
    req.on('end', async () => {
      if (size > MAX_BODY) return;
      let body = {};
      if (chunks.length) {
        try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return this._send(res, 400, { error: 'Body must be JSON' }); }
      }
      try {
        let m;
        if (req.method === 'PUT' && (m = /^\/v1\/agent\/([^/]{1,240})$/.exec(url.pathname))) {
          return this._send(res, 200, await this.handlers.upsertAgent(decodeURIComponent(m[1]), body || {}));
        }
        if (req.method === 'POST' && url.pathname === '/v1/notes') return this._send(res, 200, await this.handlers.createNote(body || {}));
        if (req.method === 'GET' && url.pathname === '/v1/notes') return this._send(res, 200, { notes: await this.handlers.listNotes(Object.fromEntries(url.searchParams)) });
        if (req.method === 'PATCH' && (m = /^\/v1\/notes\/([\w-]{1,60})$/.exec(url.pathname))) return this._send(res, 200, await this.handlers.updateNote(m[1], body || {}));
        if (req.method === 'POST' && (m = /^\/v1\/notes\/([\w-]{1,60})\/check$/.exec(url.pathname))) return this._send(res, 200, await this.handlers.checkItem(m[1], body || {}));
        return this._send(res, 404, { error: 'Not found' });
      } catch (err) {
        return this._send(res, 400, { error: err.message });
      }
    });
  }
}

module.exports = { ApiServer };
