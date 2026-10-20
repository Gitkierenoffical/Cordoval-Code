'use strict';
// Lists the tools an MCP server offers, for the Customise panel. The engine does not expose
// MCP tool lists over HTTP, so we ask the server directly (stdio or streamable HTTP).
const { spawn } = require('child_process');

const INIT = { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'cordoval-code', version: '1' } };
const TIMEOUT = 20000;

function local(entry) {
  return new Promise((resolve, reject) => {
    const cmd = Array.isArray(entry.command) ? entry.command : [];
    if (!cmd.length) return reject(new Error('No command set.'));
    let child;
    try {
      child = spawn(cmd[0], cmd.slice(1), { env: { ...process.env, ...(entry.environment || {}) }, stdio: ['pipe', 'pipe', 'pipe'], shell: process.platform === 'win32' });
    } catch (e) { return reject(e); }
    let buf = '', done = false, stderr = '';
    const finish = (err, val) => { if (done) return; done = true; clearTimeout(timer); try { child.kill(); } catch (e) {} err ? reject(err) : resolve(val); };
    const timer = setTimeout(() => finish(new Error('Timed out waiting for the server.' + (stderr ? ' ' + stderr.slice(-200) : ''))), TIMEOUT);
    const send = (m) => { try { child.stdin.write(JSON.stringify(m) + '\n'); } catch (e) {} };
    child.on('error', (e) => finish(e));
    child.on('exit', (code) => finish(new Error('Server exited (' + code + ').' + (stderr ? ' ' + stderr.slice(-200) : ''))));
    child.stderr.on('data', (d) => { stderr += d; if (stderr.length > 4000) stderr = stderr.slice(-2000); });
    child.stdout.on('data', (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!line) continue;
        let m; try { m = JSON.parse(line); } catch (e) { continue; }
        if (m.id === 1) {
          if (m.error) return finish(new Error(m.error.message || 'initialize failed'));
          send({ jsonrpc: '2.0', method: 'notifications/initialized' });
          send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
        } else if (m.id === 2) {
          if (m.error) return finish(new Error(m.error.message || 'tools/list failed'));
          finish(null, (m.result && m.result.tools) || []);
        }
      }
    });
    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: INIT });
  });
}

async function remote(entry) {
  const url = String(entry.url || '');
  if (!/^https?:\/\//i.test(url)) throw new Error('Invalid URL.');
  let session = null;
  const post = async (body) => {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), TIMEOUT);
    try {
      const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...(entry.headers || {}) };
      if (session) headers['mcp-session-id'] = session;
      const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: ctl.signal });
      if (res.status === 401 || res.status === 403) { const e = new Error('The server needs you to sign in first.'); e.auth = true; throw e; }
      if (!res.ok && res.status !== 202) throw new Error('HTTP ' + res.status);
      session = res.headers.get('mcp-session-id') || session;
      const text = await res.text();
      if (!text) return null;
      if ((res.headers.get('content-type') || '').includes('text/event-stream')) {
        for (const line of text.split('\n')) if (line.startsWith('data:')) { try { const m = JSON.parse(line.slice(5)); if (m.id === body.id) return m; } catch (e) {} }
        return null;
      }
      return JSON.parse(text);
    } finally { clearTimeout(t); }
  };
  const init = await post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: INIT });
  if (init && init.error) throw new Error(init.error.message);
  await post({ jsonrpc: '2.0', method: 'notifications/initialized' }).catch(() => {});
  const list = await post({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
  if (!list || list.error) throw new Error((list && list.error && list.error.message) || 'No tool list returned.');
  return (list.result && list.result.tools) || [];
}

async function listTools(entry) {
  if (!entry || typeof entry !== 'object') throw new Error('Unknown server.');
  const tools = entry.type === 'remote' ? await remote(entry) : await local(entry);
  return tools.map((t) => ({ name: String(t.name || ''), description: String(t.description || '').slice(0, 300) }));
}

module.exports = { listTools };
