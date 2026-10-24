'use strict';
// Server-sent events. Each client may be scoped to one project directory.
const path = require('path');
const { redact } = require('./util');

class Bus {
  constructor() { this.clients = new Set(); this.listeners = new Set(); }
  attach(req, res, directory) {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
    const client = { res, directory: directory ? path.resolve(directory) : '' };
    this.clients.add(client);
    res.write('data: ' + JSON.stringify({ type: 'server.connected', properties: {} }) + '\n\n');
    const beat = setInterval(() => { try { res.write(': ping\n\n'); } catch (e) {} }, 15000);
    req.on('close', () => { clearInterval(beat); this.clients.delete(client); });
  }
  publish(directory, type, properties) {
    const dir = directory ? path.resolve(directory) : '';
    const line = 'data: ' + redact(JSON.stringify({ type, properties })) + '\n\n';
    for (const c of this.clients) {
      if (c.directory && dir && c.directory !== dir) continue;
      try { c.res.write(line); } catch (e) {}
    }
    for (const fn of this.listeners) { try { fn(type, properties, dir); } catch (e) {} }
  }
  closeAll() { for (const c of this.clients) { try { c.res.end(); } catch (e) {} } this.clients.clear(); }
}
module.exports = { Bus };
