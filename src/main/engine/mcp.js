'use strict';
// MCP servers from the engine config: local (stdio) and remote (streamable HTTP, then SSE).
// Their tools are offered to the model as <server>_<tool>.

function sanitize(s) { return String(s).replace(/[^A-Za-z0-9_-]/g, '_'); }

class Mcp {
  constructor() { this.servers = new Map(); }
  status() {
    const out = {};
    for (const [name, s] of this.servers) out[name] = s.error ? { status: s.status, error: s.error } : { status: s.status };
    return out;
  }
  async sync(config) {
    const want = (config && config.mcp) || {};
    for (const name of [...this.servers.keys()]) if (!(name in want)) await this.remove(name);
    await Promise.all(Object.entries(want).map(([name, cfg]) => {
      const cur = this.servers.get(name);
      if (cur && JSON.stringify(cur.config) === JSON.stringify(cfg)) return null;
      return this.add(name, cfg);
    }));
  }
  async remove(name) {
    const s = this.servers.get(name);
    this.servers.delete(name);
    if (s && s.client) { try { await s.client.close(); } catch (e) {} }
  }
  async add(name, cfg) {
    await this.remove(name);
    const entry = { config: cfg, status: 'disabled', tools: [], client: null };
    this.servers.set(name, entry);
    if (!cfg || cfg.enabled === false) return entry;
    return this.connect(name);
  }
  async connect(name) {
    const entry = this.servers.get(name);
    if (!entry) throw Object.assign(new Error('Unknown MCP server.'), { status: 404 });
    if (entry.client) { try { await entry.client.close(); } catch (e) {} entry.client = null; }
    const cfg = entry.config || {};
    entry.status = 'connecting'; entry.error = undefined;
    try {
      const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
      const client = new Client({ name: 'cordoval-code', version: '0.8.0' });
      const timeout = (p) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('Timed out connecting.')), Number(cfg.timeout) || 20000))]);
      if (cfg.type === 'remote') {
        const url = new URL(cfg.url);
        const headers = cfg.headers || {};
        try {
          const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
          await timeout(client.connect(new StreamableHTTPClientTransport(url, { requestInit: { headers } })));
        } catch (first) {
          if (/401|unauthori/i.test(String(first && first.message))) { entry.status = 'needs_auth'; entry.error = 'The server needs sign-in, which is not supported yet. Add an Authorization header instead.'; return entry; }
          const { SSEClientTransport } = require('@modelcontextprotocol/sdk/client/sse.js');
          await timeout(client.connect(new SSEClientTransport(url, { requestInit: { headers } })));
        }
      } else {
        const cmd = Array.isArray(cfg.command) ? cfg.command : String(cfg.command || '').split(' ').filter(Boolean);
        if (!cmd.length) throw new Error('No command set.');
        const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
        await timeout(client.connect(new StdioClientTransport({ command: cmd[0], args: cmd.slice(1), env: { ...process.env, ...(cfg.environment || {}) }, stderr: 'ignore' })));
      }
      const list = await timeout(client.listTools());
      entry.client = client;
      entry.tools = list.tools || [];
      entry.status = 'connected';
    } catch (e) {
      entry.status = 'failed';
      entry.error = String((e && e.message) || e).slice(0, 300);
    }
    return entry;
  }
  async disconnect(name) {
    const entry = this.servers.get(name);
    if (!entry) return;
    if (entry.client) { try { await entry.client.close(); } catch (e) {} }
    entry.client = null; entry.status = 'disabled'; entry.tools = [];
  }
  // Tool descriptors for the agent loop.
  tools() {
    const out = [];
    for (const [name, s] of this.servers) {
      if (s.status !== 'connected' || !s.client) continue;
      for (const t of s.tools) {
        out.push({
          id: sanitize(name) + '_' + sanitize(t.name), server: name, description: t.description || t.name,
          schema: t.inputSchema || { type: 'object', properties: {} },
          run: async (input) => {
            const r = await s.client.callTool({ name: t.name, arguments: input || {} });
            const text = (r.content || []).map(c => c.type === 'text' ? c.text : c.type === 'resource' ? JSON.stringify(c.resource) : '[' + c.type + ']').join('\n');
            if (r.isError) throw new Error(text || 'MCP tool failed.');
            return text || '(no output)';
          },
        });
      }
    }
    return out;
  }
  async closeAll() { for (const n of [...this.servers.keys()]) await this.remove(n); }
}
module.exports = { Mcp };
