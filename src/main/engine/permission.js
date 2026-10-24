'use strict';
// Permission rules: allow, ask or deny per tool group, with wildcard patterns for shell commands.
// Global rules come from the engine config; an agent's own rules override them key by key.
// "Always allow" answers are saved per project folder and can be revoked in Settings.
const fs = require('fs');
const path = require('path');
const { id, wildcard, writeJsonAtomic } = require('./util');

// Used when the config says nothing about a key.
const DEFAULTS = { webfetch: 'ask', external_directory: 'ask' };

function decide(rule, value, fallback) {
  if (rule == null) return fallback;
  if (typeof rule === 'string') return normal(rule, fallback);
  if (typeof rule !== 'object') return fallback;
  let result = null;
  // Later and more specific entries win over the catch-all.
  for (const [pattern, action] of Object.entries(rule)) {
    if (wildcard(pattern, value) || (pattern.endsWith(' *') && value === pattern.slice(0, -2))) result = normal(action, fallback);
  }
  return result || fallback;
}
function normal(v, fallback) { return ['allow', 'ask', 'deny'].includes(v) ? v : fallback; }

function evaluateOne(g, a, key, value) {
  const base = decide(g[key], value, DEFAULTS[key] || 'allow');
  return key in a ? decide(a[key], value, base) : base;
}
const RANK = { allow: 0, ask: 1, deny: 2 };
// Shell commands are checked as a whole and segment by segment (split on ; && || |),
// so "cd x && sudo y" still meets the sudo rule. The strictest answer wins.
function evaluate(globalPerm, agentPerm, key, value) {
  const g = globalPerm || {}, a = agentPerm || {};
  let result = evaluateOne(g, a, key, value);
  if (key === 'bash' && value) {
    for (const seg of segments(value)) {
      const r = evaluateOne(g, a, key, seg);
      if (RANK[r] > RANK[result]) result = r;
    }
  }
  return result;
}
function segments(cmd) { return String(cmd).split(/&&|\|\||;|\||\n/).map(s => s.trim().replace(/^\(+/, '')).filter(Boolean); }

// Short plain-English notes for the risky categories, shown on the approval card.
function riskNote(key, value) {
  const v = String(value || '');
  const notes = [];
  if (key === 'bash') {
    const segs = segments(v);
    if (segs.some(s => /^(sudo|su|doas)\b/.test(s))) notes.push('Runs with administrator rights and can change anything on this computer.');
    if (/\brm\s+(-[a-zA-Z]*[rf][a-zA-Z]*\s+)+/.test(v)) notes.push('Deletes files and folders permanently, without the bin.');
    if (/\bgit\s+push\b/.test(v)) notes.push('Sends commits to a remote repository that other people may see.');
    if (/\b(npm|pnpm|yarn|cargo|twine|gem)\s+publish\b|\bpoetry\s+publish\b/.test(v)) notes.push('Publishes a package publicly. This is hard to undo.');
    if (/\b(curl|wget)\b[^|]*\|\s*(sudo\s+)?(ba|z|da)?sh\b/.test(v)) notes.push('Downloads a script from the internet and runs it straight away.');
  } else if (key === 'external_directory') {
    notes.push('This is outside the project folder, so it can affect other files on this computer.');
  } else if (key === 'webfetch') {
    notes.push('Contacts a website. Only the URL is sent; no keys or project files.');
  } else if (key === 'edit') {
    notes.push('Changes a file in the project. You can undo it with Revert.');
  }
  return notes.join(' ');
}

class Permissions {
  constructor(bus, root) {
    this.bus = bus; this.pending = new Map();
    this.file = root ? path.join(root, 'approvals.json') : null;
    this.rules = [];
    try { if (this.file) this.rules = JSON.parse(fs.readFileSync(this.file, 'utf8')).rules || []; } catch (e) { this.rules = []; }
  }
  saveRules() { if (this.file) writeJsonAtomic(this.file, { rules: this.rules }); }
  listRules(directory) { const d = directory ? path.resolve(directory) : ''; return this.rules.filter(r => !d || r.directory === d); }
  revoke(ruleId) { const n = this.rules.length; this.rules = this.rules.filter(r => r.id !== ruleId); this.saveRules(); return this.rules.length !== n; }
  async check({ session, directory, globalPerm, agentPerm, key, value, title, messageID, callID, signal }) {
    const action = evaluate(globalPerm, agentPerm, key, value);
    if (action === 'allow') return;
    if (action === 'deny') throw new Error('Blocked by your permission settings: ' + key + (value ? ' (' + value + ')' : '') + ' is denied. Do not retry it.');
    const dir = path.resolve(directory);
    if (this.rules.some(r => r.directory === dir && r.key === key && wildcard(r.pattern, value))) return;
    const reqId = id('per');
    const risk = riskNote(key, value);
    const props = { id: reqId, sessionID: session, permission: key, patterns: [value || '*'], always: [alwaysPattern(key, value)], metadata: { title, value, risk, risky: !!risk && key !== 'edit' && key !== 'webfetch' }, tool: { messageID, callID }, time: Date.now() };
    const reply = await new Promise((resolve) => {
      this.pending.set(reqId, { resolve, session, directory: dir, key, value, props });
      this.bus.publish(directory, 'permission.asked', props);
      if (signal) signal.addEventListener('abort', () => this.reply(reqId, 'reject'), { once: true });
    });
    if (reply === 'always') {
      this.rules.push({ id: id('rule'), directory: dir, key, pattern: alwaysPattern(key, value), created: Date.now() });
      this.saveRules();
    }
    if (reply === 'reject') { const e = new Error('The user denied this action.'); e.rejected = true; throw e; }
  }
  reply(reqId, reply) {
    const p = this.pending.get(reqId);
    if (!p) return false;
    this.pending.delete(reqId);
    this.bus.publish(p.directory, 'permission.replied', { sessionID: p.session, requestID: reqId, id: reqId, reply });
    p.resolve(['once', 'always', 'reject'].includes(reply) ? reply : 'reject');
    return true;
  }
  rejectSession(session) { for (const [k, p] of this.pending) if (p.session === session) this.reply(k, 'reject'); }
  list(directory) { const d = directory ? path.resolve(directory) : ''; return [...this.pending.values()].filter(p => !d || p.directory === d).map(p => p.props); }
}
// "Always allow" covers that exact command, path or website, or all edits for edit.
function alwaysPattern(key, value) {
  if (!value || key === 'edit') return '*';
  return String(value).replace(/[*?]/g, '?');
}

module.exports = { Permissions, evaluate, riskNote, DEFAULTS };
