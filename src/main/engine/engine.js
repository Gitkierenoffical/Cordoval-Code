'use strict';
// The Cordoval engine: sessions, the streaming agent loop, tools, permissions and snapshots.
const fs = require('fs');
const path = require('path');
const { Store } = require('./store');
const { Bus } = require('./bus');
const { Snapshots, git } = require('./git');
const { Permissions } = require('./permission');
const { Providers } = require('./providers');
const { Mcp } = require('./mcp');
const { Ptys } = require('./pty');
const config = require('./config');
const tools = require('./tools');
const { id, setSecrets, redact, redactDeep } = require('./util');
const { AGENT_SYSTEM, INIT_PROMPT, SUMMARY_PROMPT } = require('../../templates/system');

const VERSION = '0.8.0';

class Engine {
  constructor(opts) {
    this.root = path.join(opts.userData, 'engine');
    this.privateDir = path.resolve(opts.userData);
    this.readConfig = opts.readConfig || (() => ({}));
    this.store = new Store(this.root);
    this.bus = new Bus();
    this.snapshots = new Snapshots(this.root);
    this.permissions = new Permissions(this.bus);
    this.providers = new Providers({ keys: opts.keys, mock: opts.mock });
    this.mcp = new Mcp();
    this.ptys = new Ptys();
    this.running = new Map();
    setSecrets(this.providers.secrets());
    this.mcp.sync(this.config()).catch(() => {});
  }
  config() { try { return this.readConfig() || {}; } catch (e) { return {}; } }
  setKeys(keys) { this.providers.setKeys(keys); setSecrets(this.providers.secrets()); }
  async reload() { await this.mcp.sync(this.config()); }
  env() { const e = { ...process.env }; delete e.ELECTRON_RUN_AS_NODE; delete e.CORDOVAL_USER_DATA; return e; }

  // ---- sessions
  listSessions(directory) { return this.store.list(directory); }
  requireSession(sid) { const rec = this.store.get(sid); if (!rec) throw Object.assign(new Error('Session not found.'), { status: 404 }); return rec; }
  createSession(directory, body) {
    const now = Date.now();
    const info = { id: id('ses'), slug: '', projectID: 'local', directory: path.resolve(directory || process.cwd()), title: (body && body.title) || 'New session - ' + new Date(now).toISOString(), version: VERSION, time: { created: now, updated: now } };
    if (body && body.parentID) info.parentID = body.parentID;
    this.store.put({ info, messages: [], meta: {} });
    this.bus.publish(info.directory, 'session.created', { info });
    this.bus.publish(info.directory, 'session.updated', { info });
    return info;
  }
  updateSession(sid, patch) {
    const rec = this.requireSession(sid);
    if (patch && typeof patch.title === 'string') rec.info.title = patch.title.slice(0, 200);
    rec.info.time.updated = Date.now();
    this.store.save(sid, true);
    this.bus.publish(rec.info.directory, 'session.updated', { info: rec.info });
    return rec.info;
  }
  deleteSession(sid) {
    const rec = this.requireSession(sid);
    this.abort(sid);
    this.store.remove(sid);
    this.bus.publish(rec.info.directory, 'session.deleted', { info: rec.info });
    return true;
  }
  messages(sid) { return this.requireSession(sid).messages; }
  status(directory) {
    const out = {};
    for (const [sid] of this.running) { const rec = this.store.get(sid); if (rec && (!directory || path.resolve(directory) === path.resolve(rec.info.directory))) out[sid] = { type: 'busy' }; }
    return out;
  }
  exportSession(sid) { const rec = this.requireSession(sid); return redactDeep({ info: rec.info, messages: rec.messages }); }
  importSession(data, directory) {
    if (!data || !data.info || !data.info.id || !Array.isArray(data.messages)) throw new Error('That file is not an exported session.');
    if (!/^[A-Za-z0-9_-]+$/.test(String(data.info.id))) throw new Error('Invalid session id.');
    const info = { ...data.info, directory: path.resolve(directory || data.info.directory), time: { ...(data.info.time || {}), updated: Date.now() } };
    this.store.put({ info, messages: data.messages, meta: {} });
    this.bus.publish(info.directory, 'session.updated', { info });
    return info;
  }

  // ---- events
  pubSession(rec) { rec.info.time.updated = Date.now(); this.store.save(rec.info.id); this.bus.publish(rec.info.directory, 'session.updated', { info: rec.info }); }
  pubMessage(rec, msg) { this.store.save(rec.info.id); this.bus.publish(rec.info.directory, 'message.updated', { info: msg.info }); }
  pubPart(rec, part) { this.store.save(rec.info.id); this.bus.publish(rec.info.directory, 'message.part.updated', { part }); }
  setBusy(rec, busy) {
    this.bus.publish(rec.info.directory, 'session.status', { sessionID: rec.info.id, status: { type: busy ? 'busy' : 'idle' } });
    if (!busy) this.bus.publish(rec.info.directory, 'session.idle', { sessionID: rec.info.id });
  }

  // ---- prompting
  agentByName(name, directory) {
    const list = config.agents(this.config(), directory);
    return list.find(a => a.name === name) || list.find(a => a.name === 'build');
  }
  parseModel(m) {
    if (!m) return null;
    if (typeof m === 'string') { const p = m.split('/'); return p.length > 1 ? { providerID: p[0], modelID: p.slice(1).join('/') } : null; }
    return m.providerID && m.modelID ? { providerID: String(m.providerID), modelID: String(m.modelID) } : null;
  }
  async defaultModel() { const l = await this.providers.list(this.config()); return { providerID: l.default.providerID, modelID: l.default.modelID }; }

  async prompt(sid, body, opts) {
    const rec = this.requireSession(sid);
    if (this.running.has(sid)) throw Object.assign(new Error('This session is already working. Stop it first.'), { status: 409 });
    opts = opts || {};
    const dir = rec.info.directory;
    // A new prompt after a revert drops the reverted messages for good.
    if (rec.info.revert) {
      const idx = rec.messages.findIndex(m => m.info.id === rec.info.revert.messageID);
      if (idx >= 0) rec.messages.splice(idx);
      delete rec.info.revert;
      this.pubSession(rec);
    }
    const agent = this.agentByName(body.agent || 'build', dir);
    const model = this.parseModel(body.model) || this.parseModel(agent.model) || this.parseModel(this.config().model) || await this.defaultModel();
    const now = Date.now();
    const user = { info: { id: body.messageID && /^msg_/.test(body.messageID) ? body.messageID : id('msg'), sessionID: sid, role: 'user', time: { created: now }, agent: agent.name, model }, parts: [] };
    if (body.system) user.info.system = String(body.system);
    for (const p of body.parts || []) {
      const part = { ...p, id: id('prt'), sessionID: sid, messageID: user.info.id };
      user.parts.push(part);
      if (p.type === 'file' && /^file:/.test(String(p.url || ''))) {
        const synthetic = this.fileContext(dir, p);
        if (synthetic) user.parts.push({ id: id('prt'), sessionID: sid, messageID: user.info.id, type: 'text', synthetic: true, text: synthetic });
      }
      if (p.type === 'agent' && p.name) user.parts.push({ id: id('prt'), sessionID: sid, messageID: user.info.id, type: 'text', synthetic: true, text: 'The user mentioned the @' + p.name + ' agent. Work in that style for this request.' });
    }
    if (!user.parts.length) throw Object.assign(new Error('Empty prompt.'), { status: 400 });
    if (rec.info.title.startsWith('New session - ')) {
      const t = user.parts.filter(p => p.type === 'text' && !p.synthetic).map(p => p.text).join(' ').replace(/\s+/g, ' ').trim();
      if (t) { rec.info.title = t.length > 60 ? t.slice(0, 57) + '...' : t; }
    }
    user.info.snapshot = await this.snapshots.track(dir);
    if (!rec.meta.start && user.info.snapshot) rec.meta.start = user.info.snapshot;
    rec.messages.push(user);
    this.pubMessage(rec, user);
    for (const p of user.parts) this.pubPart(rec, p);
    this.pubSession(rec);
    if (body.noReply) return user;
    const controller = new AbortController();
    this.running.set(sid, { controller });
    this.setBusy(rec, true);
    const run = this.loop(rec, user, agent, model, controller, opts).catch(() => {}).finally(() => {
      this.running.delete(sid);
      this.store.save(sid, true);
      this.setBusy(rec, false);
    });
    if (opts.wait) await run;
    return user;
  }

  fileContext(dir, p) {
    try {
      const abs = decodeURIComponent(new URL(p.url).pathname).replace(/^\/([A-Za-z]:)/, '$1');
      if (abs.startsWith(this.privateDir)) return null;
      const st = fs.statSync(abs);
      if (st.isDirectory()) return 'Listing of ' + (p.filename || abs) + ':\n' + fs.readdirSync(abs).slice(0, 200).join('\n');
      if (st.size > 256 * 1024) return 'File ' + (p.filename || abs) + ' is too large to include (' + st.size + ' bytes). Use the read tool.';
      return 'Contents of ' + (p.filename || abs) + ':\n```\n' + fs.readFileSync(abs, 'utf8') + '\n```';
    } catch (e) { return null; }
  }

  systemPrompt(rec, agent, user) {
    const dir = rec.info.directory;
    const lines = [AGENT_SYSTEM, '', 'Environment:', '- Working directory: ' + dir, '- Platform: ' + process.platform, '- Date: ' + new Date().toDateString(), '- Agent: ' + agent.name];
    if (agent.name === 'plan') lines.push('', 'You are in Plan mode. You must not create, edit or delete files. Read the code and reply with a clear plan.');
    if (agent.prompt) lines.push('', agent.prompt);
    const ins = config.instructions(dir);
    if (ins) lines.push('', 'Project instructions from ' + ins.file + ':', ins.text);
    if (user && user.info.system) lines.push('', user.info.system);
    return lines.join('\n');
  }

  history(rec, uptoUser) {
    const msgs = [];
    let list = rec.messages;
    const end = list.indexOf(uptoUser);
    if (end >= 0) list = list.slice(0, end + 1);
    // After /compact, the summary replaces everything before it.
    let start = 0;
    for (let i = list.length - 1; i >= 0; i--) if (list[i].info.role === 'assistant' && list[i].info.summary && list[i].info.time.completed && !list[i].info.error) { start = i; break; }
    if (start > 0) {
      const summary = list[start].parts.filter(p => p.type === 'text').map(p => p.text).join('\n');
      msgs.push({ role: 'user', content: [{ type: 'text', text: 'What have we done so far?' }] });
      msgs.push({ role: 'assistant', content: [{ type: 'text', text: summary || '(no summary)' }] });
      list = list.slice(start + 1);
    }
    for (const m of list) {
      if (m.info.role === 'user') {
        const content = [];
        for (const p of m.parts) {
          if (p.type === 'text' && p.text) content.push({ type: 'text', text: p.text });
          else if (p.type === 'file' && /^data:image\//.test(String(p.url || ''))) {
            const mm = String(p.url).match(/^data:([^;]+);base64,(.*)$/);
            if (mm) content.push({ type: 'image', image: mm[2], mediaType: mm[1] });
          } else if (p.type === 'file' && /^data:/.test(String(p.url || ''))) {
            const mm = String(p.url).match(/^data:([^;]+);base64,(.*)$/);
            if (mm && /^text\/|json|xml|javascript/.test(mm[1])) content.push({ type: 'text', text: 'Attached ' + (p.filename || 'file') + ':\n' + Buffer.from(mm[2], 'base64').toString('utf8').slice(0, 200000) });
          }
        }
        if (content.length) msgs.push({ role: 'user', content });
        continue;
      }
      if (m.info.summary) continue;
      let assistant = [], results = [];
      const flush = () => {
        if (assistant.length) msgs.push({ role: 'assistant', content: assistant });
        if (results.length) msgs.push({ role: 'tool', content: results });
        assistant = []; results = [];
      };
      for (const p of m.parts) {
        if (p.type === 'step-start') flush();
        else if (p.type === 'text' && p.text) assistant.push({ type: 'text', text: p.text });
        else if (p.type === 'tool') {
          const st = p.state || {};
          assistant.push({ type: 'tool-call', toolCallId: p.callID, toolName: p.tool, input: st.input || {} });
          const ok = st.status === 'completed';
          results.push({ type: 'tool-result', toolCallId: p.callID, toolName: p.tool, output: ok ? { type: 'text', value: String(st.output == null ? '' : st.output) } : { type: 'error-text', value: String(st.error || 'The tool did not finish.') } });
        }
      }
      flush();
    }
    return msgs;
  }

  toolSet(rec, agent, assistant, run) {
    const { tool, jsonSchema } = require('ai');
    const cfg = this.config();
    const dir = rec.info.directory;
    const disabled = { ...(cfg.tools || {}), ...(agent.tools || {}) };
    const readOnly = agent.name === 'plan' || agent.name === 'explore' || (agent.permission && agent.permission.edit === 'deny' && agent.name !== 'build');
    const set = {};
    const self = this;
    const makeCtx = (name, callID, signal) => ({
      directory: dir, privateDir: this.privateDir, signal, env: this.env(),
      ask: (key, value, title) => self.permissions.check({ session: rec.info.id, directory: dir, globalPerm: cfg.permission, agentPerm: agent.permission, key, value, title, messageID: assistant.info.id, callID, signal })
        .catch((e) => { if (e.rejected) run.rejected = true; throw e; }),
      title: (t) => { const p = run.toolPart(callID, name); p.state.title = String(t || ''); self.pubPart(rec, p); },
      meta: (m) => { const p = run.toolPart(callID, name); p.state.metadata = { ...(p.state.metadata || {}), ...m }; },
    });
    for (const [name, def] of Object.entries(tools.defs)) {
      if (disabled[name] === false) continue;
      if (readOnly && def.mutates && name !== 'bash') continue;
      set[name] = tool({
        description: def.description,
        inputSchema: jsonSchema(def.schema),
        execute: async (input, o) => { run.toolPart(o.toolCallId, name, input); return redact(await def.run(input || {}, makeCtx(name, o.toolCallId, o.abortSignal || run.signal))); },
        toModelOutput: ({ output }) => ({ type: 'text', value: String(output) }),
      });
    }
    for (const t of this.mcp.tools()) {
      if (disabled[t.id] === false || disabled[t.server + '_*'] === false) continue;
      set[t.id] = tool({
        description: t.description,
        inputSchema: jsonSchema(t.schema),
        execute: async (input, o) => { run.toolPart(o.toolCallId, t.id, input); const ctx = makeCtx(t.id, o.toolCallId, o.abortSignal); await ctx.ask(t.id, '*', 'MCP tool ' + t.id); return redact(await t.run(input)); },
        toModelOutput: ({ output }) => ({ type: 'text', value: String(output) }),
      });
    }
    return set;
  }

  newAssistant(rec, user, agent, model, extra) {
    const msg = { info: { id: id('msg'), sessionID: rec.info.id, role: 'assistant', parentID: user.info.id, time: { created: Date.now() }, modelID: model.modelID, providerID: model.providerID, mode: agent.name, agent: agent.name, path: { cwd: rec.info.directory, root: rec.info.directory }, cost: 0, tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }, ...(extra || {}) }, parts: [] };
    rec.messages.push(msg);
    this.pubMessage(rec, msg);
    return msg;
  }

  async loop(rec, user, agent, model, controller, opts) {
    const { streamText, stepCountIs } = require('ai');
    const summary = !!(opts && opts.summary);
    const assistant = this.newAssistant(rec, user, agent, model, summary ? { summary: true, mode: 'compaction' } : null);
    const sid = rec.info.id;
    const addPart = (p) => { const part = { id: id('prt'), sessionID: sid, messageID: assistant.info.id, ...p }; assistant.parts.push(part); this.pubPart(rec, part); return part; };
    const byCall = new Map();
    const run = {
      signal: controller.signal, rejected: false,
      toolPart: (callID, name, input) => {
        let p = byCall.get(callID);
        if (!p) { p = addPart({ type: 'tool', callID, tool: name, state: { status: 'pending', input: {}, raw: '' } }); byCall.set(callID, p); }
        if (input !== undefined && p.state.status === 'pending') { p.state = { status: 'running', input, title: p.state.title || '', time: { start: Date.now() } }; this.pubPart(rec, p); }
        return p;
      },
    };
    const texts = new Map();
    let err = null;
    try {
      const lm = this.providers.languageModel(model.providerID, model.modelID);
      const messages = this.history(rec, user);
      if (summary) messages.push({ role: 'user', content: [{ type: 'text', text: SUMMARY_PROMPT }] });
      const result = streamText({
        model: lm,
        system: summary ? 'You summarize coding conversations. Summarize the conversation so far.' : this.systemPrompt(rec, agent, user),
        messages,
        tools: summary ? undefined : this.toolSet(rec, agent, assistant, run),
        abortSignal: controller.signal,
        stopWhen: [stepCountIs(Number(this.config().steps) || 60), () => run.rejected],
        temperature: agent.temperature,
        maxOutputTokens: Number(this.config().max_output_tokens) || 8192,
        maxRetries: 2,
      });
      for await (const ev of result.fullStream) {
        switch (ev.type) {
          case 'start-step': addPart({ type: 'step-start' }); break;
          case 'text-start': case 'reasoning-start': {
            const p = addPart({ type: ev.type === 'text-start' ? 'text' : 'reasoning', text: '', time: { start: Date.now() } });
            texts.set(ev.type[0] + ev.id, p); break;
          }
          case 'text-delta': case 'reasoning-delta': {
            const key = (ev.type === 'text-delta' ? 't' : 'r') + ev.id;
            let p = texts.get(key);
            if (!p) { p = addPart({ type: ev.type === 'text-delta' ? 'text' : 'reasoning', text: '', time: { start: Date.now() } }); texts.set(key, p); }
            const delta = ev.text != null ? ev.text : ev.delta || '';
            p.text += delta;
            this.store.save(sid);
            this.bus.publish(rec.info.directory, 'message.part.delta', { sessionID: sid, messageID: assistant.info.id, partID: p.id, field: 'text', delta });
            break;
          }
          case 'text-end': case 'reasoning-end': {
            const p = texts.get((ev.type === 'text-end' ? 't' : 'r') + ev.id);
            if (p) { p.time.end = Date.now(); this.pubPart(rec, p); }
            break;
          }
          case 'tool-input-start': run.toolPart(ev.id, ev.toolName); break;
          case 'tool-call': run.toolPart(ev.toolCallId, ev.toolName, ev.input || {}); break;
          case 'tool-result': {
            const p = run.toolPart(ev.toolCallId, ev.toolName);
            p.state = { status: 'completed', input: ev.input || p.state.input || {}, output: String(ev.output), title: p.state.title || '', metadata: p.state.metadata || {}, time: { start: (p.state.time && p.state.time.start) || Date.now(), end: Date.now() } };
            this.pubPart(rec, p); break;
          }
          case 'tool-error': {
            const p = run.toolPart(ev.toolCallId, ev.toolName);
            p.state = { status: 'error', input: ev.input || p.state.input || {}, error: redact(String((ev.error && ev.error.message) || ev.error)), title: p.state.title || '', time: { start: (p.state.time && p.state.time.start) || Date.now(), end: Date.now() } };
            this.pubPart(rec, p); break;
          }
          case 'finish-step': {
            const u = ev.usage || {};
            const t = assistant.info.tokens;
            t.input += u.inputTokens || 0; t.output += u.outputTokens || 0; t.reasoning += u.reasoningTokens || 0; t.cache.read += u.cachedInputTokens || 0;
            addPart({ type: 'step-finish', reason: ev.finishReason, tokens: { input: u.inputTokens || 0, output: u.outputTokens || 0 }, cost: 0 });
            break;
          }
          case 'error': err = ev.error; break;
          case 'abort': err = Object.assign(new Error('Aborted'), { name: 'AbortError' }); break;
          default: break;
        }
      }
    } catch (e) { err = e; }
    if (controller.signal.aborted) err = Object.assign(new Error('Aborted'), { name: 'AbortError' });
    for (const p of byCall.values()) if (p.state.status === 'pending' || p.state.status === 'running') { p.state = { ...p.state, status: 'error', error: err ? 'Stopped' : 'The tool did not finish.', time: { start: (p.state.time && p.state.time.start) || Date.now(), end: Date.now() } }; this.pubPart(rec, p); }
    for (const p of texts.values()) if (!p.time.end) { p.time.end = Date.now(); this.pubPart(rec, p); }
    assistant.info.time.completed = Date.now();
    if (err) {
      const aborted = err.name === 'AbortError' || controller.signal.aborted;
      const message = redact(aborted ? 'Stopped.' : errorText(err));
      assistant.info.error = { name: aborted ? 'MessageAbortedError' : 'APIError', data: { message } };
      if (!aborted) this.bus.publish(rec.info.directory, 'session.error', { sessionID: sid, messageID: assistant.info.id, error: assistant.info.error });
    }
    this.pubMessage(rec, assistant);
    // Record what this turn changed on disk.
    try {
      const after = await this.snapshots.track(rec.info.directory);
      if (after && user.info.snapshot && after !== user.info.snapshot) {
        const changed = await git([...this.snapshots.base(rec.info.directory), 'diff', '--name-only', '-z', user.info.snapshot, after], { cwd: rec.info.directory });
        const filesList = changed.stdout.split('\0').filter(Boolean).map(f => path.join(rec.info.directory, f));
        if (filesList.length) addPart({ type: 'patch', hash: after, files: filesList });
      }
      if (rec.meta.start) this.bus.publish(rec.info.directory, 'session.diff', { sessionID: sid, diff: await this.snapshots.diff(rec.info.directory, rec.meta.start, after) });
    } catch (e) {}
    this.pubSession(rec);
  }

  abort(sid) {
    const r = this.running.get(sid);
    this.permissions.rejectSession(sid);
    if (r) r.controller.abort();
    return true;
  }

  async command(sid, body) {
    const rec = this.requireSession(sid);
    const name = String(body.command || '').replace(/^\//, '');
    const cmd = config.commands(this.config(), rec.info.directory).find(c => c.name === name);
    if (!cmd) throw Object.assign(new Error('Unknown command /' + name), { status: 404 });
    const args = String(body.arguments || '');
    const argv = args.match(/"[^"]*"|\S+/g) || [];
    let text = cmd.template.replace(/\$ARGUMENTS/g, args).replace(/\$(\d+)/g, (m, n) => (argv[Number(n) - 1] || '').replace(/^"|"$/g, ''));
    if (!/\$ARGUMENTS/.test(cmd.template) && args && !/\$\d/.test(cmd.template)) text += '\n\n' + args;
    return this.prompt(sid, { parts: [{ type: 'text', text }], agent: cmd.agent || body.agent, model: this.parseModel(cmd.model) || this.parseModel(body.model) });
  }
  init(sid, body) { return this.prompt(sid, { parts: [{ type: 'text', text: INIT_PROMPT }], agent: 'build', model: this.parseModel(body) || this.parseModel(body && body.model) }); }
  async summarize(sid, body) {
    const rec = this.requireSession(sid);
    if (this.running.has(sid)) throw Object.assign(new Error('This session is busy.'), { status: 409 });
    const model = this.parseModel(body) || this.parseModel(body && body.model) || await this.defaultModel();
    const agent = { name: 'build' };
    const user = { info: { id: id('msg'), sessionID: sid, role: 'user', time: { created: Date.now() }, agent: 'build', model }, parts: [] };
    user.parts.push({ id: id('prt'), sessionID: sid, messageID: user.info.id, type: 'text', text: 'Compact the conversation into a summary.', synthetic: false });
    user.info.snapshot = await this.snapshots.track(rec.info.directory);
    rec.messages.push(user);
    this.pubMessage(rec, user);
    for (const p of user.parts) this.pubPart(rec, p);
    const controller = new AbortController();
    this.running.set(sid, { controller });
    this.setBusy(rec, true);
    this.loop(rec, user, agent, model, controller, { summary: true }).catch(() => {}).finally(() => { this.running.delete(sid); this.store.save(sid, true); this.setBusy(rec, false); });
    return true;
  }

  // ---- undo
  async revert(sid, body) {
    const rec = this.requireSession(sid);
    if (this.running.has(sid)) throw Object.assign(new Error('Stop the session before reverting.'), { status: 409 });
    const idx = rec.messages.findIndex(m => m.info.id === body.messageID);
    if (idx < 0) throw Object.assign(new Error('Message not found.'), { status: 404 });
    let target = null;
    for (let i = idx; i < rec.messages.length && !target; i++) if (rec.messages[i].info.role === 'user') target = rec.messages[i].info.snapshot;
    if (!target) throw Object.assign(new Error('No snapshot to revert to.'), { status: 400 });
    const current = rec.info.revert ? rec.info.revert.snapshot : await this.snapshots.track(rec.info.directory);
    await this.snapshots.restore(rec.info.directory, target);
    rec.info.revert = { messageID: rec.messages[idx].info.id, snapshot: current };
    this.pubSession(rec);
    return rec.info;
  }
  async unrevert(sid) {
    const rec = this.requireSession(sid);
    if (!rec.info.revert) return rec.info;
    await this.snapshots.restore(rec.info.directory, rec.info.revert.snapshot);
    delete rec.info.revert;
    this.pubSession(rec);
    return rec.info;
  }
  async sessionDiff(sid) {
    const rec = this.requireSession(sid);
    return rec.meta.start ? this.snapshots.diff(rec.info.directory, rec.meta.start) : [];
  }

  close() { this.store.flush(); this.bus.closeAll(); this.ptys.closeAll(); this.mcp.closeAll().catch(() => {}); for (const [sid] of this.running) this.abort(sid); }
}

function errorText(e) {
  if (!e) return 'Unknown error';
  let msg = e.message || String(e);
  if (e.statusCode) msg = 'Provider returned ' + e.statusCode + ': ' + msg;
  if (e.responseBody) { try { const b = JSON.parse(e.responseBody); const m = (b.error && (b.error.message || b.error)) || b.message; if (m) msg += ' (' + String(typeof m === 'string' ? m : JSON.stringify(m)).slice(0, 300) + ')'; } catch (x) {} }
  return msg.slice(0, 1000);
}

module.exports = { Engine, VERSION };
