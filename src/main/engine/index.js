'use strict';
// Runs the Cordoval engine inside the Electron main process and serves it on 127.0.0.1.
const { Engine, VERSION } = require('./engine');
const { createServer, newToken } = require('./server');

let current = null;
let starting = null;

function start(opts) {
  if (current) return Promise.resolve(current.info);
  if (starting) return starting;
  starting = new Promise((resolve, reject) => {
    try {
      const engine = new Engine({ userData: opts.userData, keys: opts.keys, readConfig: opts.readConfig, mock: process.env.CORDOVAL_MOCK_PROVIDER === '1' });
      const token = newToken();
      const server = createServer(engine, { token, version: VERSION });
      server.on('error', reject);
      server.listen(Number.isInteger(opts.port) ? opts.port : 0, '127.0.0.1', () => {
        const port = server.address().port;
        current = { engine, server, token, info: { url: 'http://127.0.0.1:' + port, port } };
        resolve(current.info);
      });
    } catch (e) { reject(e); }
  }).finally(() => { starting = null; });
  return starting;
}

function stop() {
  if (!current) return;
  const c = current;
  current = null;
  try { c.engine.close(); } catch (e) {}
  try { c.server.closeAllConnections && c.server.closeAllConnections(); c.server.close(); } catch (e) {}
}

// Keys and config are re-read live, so a "restart" only refreshes them.
async function restart(opts) {
  if (!current) return start(opts);
  if (opts && opts.keys) current.engine.setKeys(opts.keys);
  await current.engine.reload();
  return current.info;
}

function setKeys(keys) { if (current) current.engine.setKeys(keys); }
function token() { return current ? current.token : null; }
function port() { return current ? current.info.port : null; }
function instance() { return current ? current.engine : null; }

module.exports = { start, stop, restart, setKeys, token, port, instance };
