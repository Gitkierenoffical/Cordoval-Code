'use strict';
// Permission rules: allow, ask or deny per tool group, with wildcard patterns for shell commands.
// Global rules come from the engine config; an agent's own rules override them key by key.
const { id, wildcard } = require('./util');

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
  const base = decide(g[key], value, 'allow');
  return key in a ? decide(a[key], value, base) : base;
}
const RANK = { allow: 0, ask: 1, deny: 2 };
// Shell commands are checked as a whole and segment by segment (split on ; && || |),
// so "cd x && sudo y" still meets the sudo rule. The strictest answer wins.
function evaluate(globalPerm, agentPerm, key, value) {
  const g = globalPerm || {}, a = agentPerm || {};
  let result = evaluateOne(g, a, key, value);
  if (key === 'bash' && value) {
    for (const seg of String(value).split(/&&|\|\||;|\||\n/).map(s => s.trim()).filter(Boolean)) {
      const r = evaluateOne(g, a, key, seg.replace(/^\(+/, ''));
      if (RANK[r] > RANK[result]) result = r;
    }
  }
  return result;
}

class Permissions {
  constructor(bus) { this.bus = bus; this.pending = new Map(); this.always = new Map(); }
  async check({ session, directory, globalPerm, agentPerm, key, value, title, messageID, callID, signal }) {
    const action = evaluate(globalPerm, agentPerm, key, value);
    if (action === 'allow') return;
    if (action === 'deny') throw new Error('Blocked by your permission settings: ' + key + (value ? ' (' + value + ')' : '') + ' is denied. Do not retry it.');
    const approved = this.always.get(session) || [];
    if (approved.some(p => p.key === key && wildcard(p.pattern, value))) return;
    const reqId = id('per');
    const props = { id: reqId, sessionID: session, permission: key, patterns: [value || '*'], always: [alwaysPattern(key, value)], metadata: { title }, tool: { messageID, callID } };
    const reply = await new Promise((resolve) => {
      this.pending.set(reqId, { resolve, session, directory, key, value });
      this.bus.publish(directory, 'permission.asked', props);
      if (signal) signal.addEventListener('abort', () => this.reply(reqId, 'reject'), { once: true });
    });
    if (reply === 'always') {
      approved.push({ key, pattern: alwaysPattern(key, value) });
      this.always.set(session, approved);
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
  list() { return [...this.pending.entries()].map(([k, p]) => ({ id: k, sessionID: p.session, permission: p.key, patterns: [p.value] })); }
}
function alwaysPattern(key, value) {
  // "Always allow" for a shell command covers that exact command only.
  if (key !== 'bash' || !value) return '*';
  return String(value).replace(/[*?]/g, '?');
}

module.exports = { Permissions, evaluate };
