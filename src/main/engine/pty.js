'use strict';
// Terminal sessions backed by node-pty, streamed to the renderer over a WebSocket.
const crypto = require('crypto');
const { id } = require('./util');

class Ptys {
  constructor() { this.map = new Map(); }
  create(body, directory, env) {
    const pty = require('@lydell/node-pty');
    const win = process.platform === 'win32';
    const shell = body.command || (win ? 'powershell.exe' : (process.env.SHELL || '/bin/bash'));
    const args = Array.isArray(body.args) ? body.args : (win ? [] : ['-l']);
    const cwd = body.cwd || directory || process.env.HOME;
    const proc = pty.spawn(shell, args, { name: 'xterm-256color', cols: 80, rows: 24, cwd, env: { ...env, TERM: 'xterm-256color' } });
    const info = { id: id('pty'), title: body.title || 'Terminal', command: shell, args, cwd, status: 'running', pid: proc.pid };
    const rec = { info, proc, buffer: '', sockets: new Set(), tickets: new Set() };
    proc.onData((d) => {
      rec.buffer = (rec.buffer + d).slice(-100000);
      for (const ws of rec.sockets) { try { ws.send(d); } catch (e) {} }
    });
    proc.onExit(() => { info.status = 'exited'; for (const ws of rec.sockets) { try { ws.close(); } catch (e) {} } });
    this.map.set(info.id, rec);
    return info;
  }
  get(ptyId) { return this.map.get(ptyId) || null; }
  list() { return [...this.map.values()].map(r => r.info); }
  resize(ptyId, size) {
    const r = this.get(ptyId);
    if (r && size && size.cols > 0 && size.rows > 0 && r.info.status === 'running') { try { r.proc.resize(Math.floor(size.cols), Math.floor(size.rows)); } catch (e) {} }
    return r ? r.info : null;
  }
  remove(ptyId) {
    const r = this.get(ptyId);
    if (!r) return false;
    try { r.proc.kill(); } catch (e) {}
    this.map.delete(ptyId);
    return true;
  }
  ticket(ptyId) { const r = this.get(ptyId); if (!r) return null; const t = crypto.randomBytes(16).toString('hex'); r.tickets.add(t); return t; }
  attach(ptyId, ws) {
    const r = this.get(ptyId);
    if (!r) { ws.close(); return; }
    r.sockets.add(ws);
    if (r.buffer) ws.send(r.buffer);
    ws.on('message', (data) => { try { r.proc.write(data.toString()); } catch (e) {} });
    ws.on('close', () => r.sockets.delete(ws));
  }
  closeAll() { for (const k of [...this.map.keys()]) this.remove(k); }
}
module.exports = { Ptys };
