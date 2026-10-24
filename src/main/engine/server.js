'use strict';
// Local HTTP + SSE + WebSocket API on 127.0.0.1 for the renderer. Every request must carry the
// per-run token that the main process adds to the window's requests, and a loopback origin.
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const files = require('./files');
const config = require('./config');
const { git } = require('./git');
const { redactDeep } = require('./util');
const toolsMod = require('./tools');

function send(res, status, body) {
  if (body === undefined || body === null) { res.writeHead(status === 200 && body === null ? 200 : status, { 'content-type': 'application/json' }); res.end(body === null ? 'null' : ''); return; }
  const text = JSON.stringify(redactDeep(body));
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text) });
  res.end(text);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > 50 * 1024 * 1024) { reject(Object.assign(new Error('Body too large'), { status: 413 })); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { const t = Buffer.concat(chunks).toString('utf8'); if (!t) return resolve({}); try { resolve(JSON.parse(t)); } catch (e) { reject(Object.assign(new Error('Invalid JSON'), { status: 400 })); } });
    req.on('error', reject);
  });
}

function createServer(engine, opts) {
  const token = opts.token;
  const routes = [];
  const route = (method, pattern, fn) => {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (m, k) => { keys.push(k); return '([^/]+)'; }) + '$');
    routes.push({ method, re, keys, fn });
  };
  const dirOf = (q) => path.resolve(q.get('directory') || process.cwd());

  // sessions
  route('GET', '/session', (q) => engine.listSessions(q.get('directory'), { children: !!q.get('children') }));
  route('POST', '/session', (q, b) => engine.createSession(dirOf(q), b));
  route('GET', '/session/status', (q) => engine.status(q.get('directory')));
  route('GET', '/session/:id', (q, b, p) => engine.requireSession(p.id).info);
  route('PATCH', '/session/:id', (q, b, p) => engine.updateSession(p.id, b));
  route('DELETE', '/session/:id', (q, b, p) => engine.deleteSession(p.id));
  route('GET', '/session/:id/message', (q, b, p) => engine.messages(p.id));
  route('POST', '/session/:id/message', async (q, b, p) => { await engine.prompt(p.id, b, { wait: true }); const m = engine.messages(p.id); return m[m.length - 1]; });
  route('POST', '/session/:id/prompt_async', async (q, b, p) => { await engine.prompt(p.id, b); return undefined; });
  route('POST', '/session/:id/abort', (q, b, p) => engine.abort(p.id));
  route('POST', '/session/:id/command', async (q, b, p) => { await engine.command(p.id, b); return true; });
  route('POST', '/session/:id/init', async (q, b, p) => { await engine.init(p.id, b); return true; });
  route('POST', '/session/:id/summarize', (q, b, p) => engine.summarize(p.id, b));
  route('POST', '/session/:id/revert', (q, b, p) => engine.revert(p.id, b));
  route('POST', '/session/:id/unrevert', (q, b, p) => engine.unrevert(p.id));
  route('GET', '/session/:id/diff', (q, b, p) => engine.sessionDiff(p.id));
  route('POST', '/permission/:id/reply', (q, b, p) => { if (!engine.permissions.reply(p.id, b.reply || b.response)) throw Object.assign(new Error('No such permission request.'), { status: 404 }); return true; });
  route('GET', '/permission', (q) => engine.permissions.list(q.get('directory')));
  route('GET', '/permission/rules', (q) => engine.permissions.listRules(q.get('all') ? '' : q.get('directory')));
  route('DELETE', '/permission/rules/:id', (q, b, p) => engine.permissions.revoke(p.id));

  // config, providers, agents, commands
  route('GET', '/global/health', () => ({ healthy: true, version: opts.version }));
  route('GET', '/global/config', () => engine.config());
  route('PATCH', '/global/config', async () => { await engine.reload(); return engine.config(); });
  route('GET', '/config', () => engine.config());
  route('POST', '/instance/dispose', async () => { await engine.reload(); return true; });
  route('GET', '/config/providers', () => engine.providers.list(engine.config()));
  route('GET', '/provider', async () => { const l = await engine.providers.list(engine.config()); return { all: l.providers, default: l.default, connected: l.providers.map(p => p.id) }; });
  route('GET', '/agent', (q) => config.agents(engine.config(), dirOf(q)).map(a => ({ ...a, prompt: a.prompt ? String(a.prompt).slice(0, 2000) : undefined })));
  route('GET', '/command', (q) => config.commands(engine.config(), dirOf(q)));
  route('GET', '/experimental/tool/ids', () => Object.keys(toolsMod.defs).concat(engine.mcp.tools().map(t => t.id)));
  route('GET', '/auth', () => ({}));

  // MCP
  route('GET', '/mcp', () => engine.mcp.status());
  route('POST', '/mcp', async (q, b) => { if (!b.name) throw Object.assign(new Error('Missing name.'), { status: 400 }); await engine.mcp.add(String(b.name), b.config); return engine.mcp.status(); });
  route('POST', '/mcp/:name/connect', async (q, b, p) => { const e = await engine.mcp.connect(decodeURIComponent(p.name)); if (e.status !== 'connected') throw Object.assign(new Error(e.error || 'Could not connect.'), { status: 502 }); return true; });
  route('POST', '/mcp/:name/disconnect', async (q, b, p) => { await engine.mcp.disconnect(decodeURIComponent(p.name)); return true; });
  route('POST', '/mcp/:name/auth', () => { throw Object.assign(new Error('MCP OAuth sign-in is not supported by the Cordoval engine yet. Add an Authorization header to the server instead.'), { status: 501 }); });
  route('POST', '/mcp/:name/auth/authenticate', () => { throw Object.assign(new Error('MCP OAuth sign-in is not supported yet.'), { status: 501 }); });
  route('DELETE', '/mcp/:name/auth', () => true);

  // files and git
  route('GET', '/file', (q) => files.list(dirOf(q), q.get('path') || '.'));
  route('GET', '/file/content', (q) => files.content(dirOf(q), q.get('path')));
  route('GET', '/file/status', (q) => files.status(dirOf(q)));
  route('GET', '/find', (q) => files.grep(dirOf(q), q.get('pattern') || '', { limit: 500 }));
  route('GET', '/find/file', (q) => files.findFiles(dirOf(q), q.get('query') || '', 50));
  route('GET', '/vcs', (q) => files.vcs(dirOf(q)));
  route('GET', '/vcs/diff', (q) => files.vcsDiff(dirOf(q)));
  route('POST', '/project/git/init', async (q) => { const r = await git(['init'], { cwd: dirOf(q) }); if (!r.ok) throw new Error(r.stderr || 'git init failed'); return true; });
  route('GET', '/lsp', () => []);
  route('GET', '/path', (q) => ({ directory: dirOf(q), worktree: dirOf(q) }));

  // terminals
  route('GET', '/pty', () => engine.ptys.list());
  route('POST', '/pty', (q, b) => engine.ptys.create(b || {}, dirOf(q), engine.env()));
  route('PUT', '/pty/:id', (q, b, p) => engine.ptys.resize(p.id, b.size) || (() => { throw Object.assign(new Error('Not found'), { status: 404 }); })());
  route('DELETE', '/pty/:id', (q, b, p) => engine.ptys.remove(p.id));
  route('POST', '/pty/:id/connect-token', (q, b, p) => ({ ticket: engine.ptys.ticket(p.id) }));

  function allowed(req, port) {
    const h = req.headers;
    if (h['x-cordoval-token'] !== token) return false;
    if (h.origin && h.origin !== 'http://127.0.0.1:' + port && h.origin !== 'null' && !/^file:/.test(h.origin)) return false;
    return true;
  }

  const server = http.createServer(async (req, res) => {
    const port = server.address().port;
    if (!allowed(req, port)) { res.writeHead(403); res.end('Forbidden'); return; }
    const url = new URL(req.url, 'http://127.0.0.1');
    if (req.method === 'GET' && url.pathname === '/event') return engine.bus.attach(req, res, url.searchParams.get('directory'));
    for (const r of routes) {
      if (r.method !== req.method) continue;
      const m = url.pathname.match(r.re);
      if (!m) continue;
      const params = {};
      r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
      try {
        const body = ['POST', 'PATCH', 'PUT'].includes(req.method) ? await readBody(req) : {};
        const out = await r.fn(url.searchParams, body || {}, params);
        if (out === undefined) { res.writeHead(204); res.end(); } else send(res, 200, out);
      } catch (e) {
        send(res, e.status || 500, { name: e.name || 'Error', message: String(e.message || e), data: { message: String(e.message || e) } });
      }
      return;
    }
    send(res, 404, { message: 'Not found: ' + req.method + ' ' + url.pathname });
  });

  const { WebSocketServer } = require('ws');
  const wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const m = url.pathname.match(/^\/pty\/([^/]+)\/connect$/);
    const rec = m && engine.ptys.get(m[1]);
    const ticket = url.searchParams.get('ticket');
    const ok = rec && (allowed(req, server.address().port) || (ticket && rec.tickets.has(ticket)));
    if (!ok) { socket.write('HTTP/1.1 403 Forbidden\r\n\r\n'); socket.destroy(); return; }
    if (ticket) rec.tickets.delete(ticket);
    wss.handleUpgrade(req, socket, head, (ws) => engine.ptys.attach(m[1], ws));
  });
  return server;
}

function newToken() { return crypto.randomBytes(24).toString('hex'); }
module.exports = { createServer, newToken };
