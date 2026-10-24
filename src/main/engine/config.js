'use strict';
// Merges the global engine config with a project's .cordoval/ folder (agents, commands)
// and reads .opencode/ as well so existing project files keep working.
const fs = require('fs');
const path = require('path');

const PROJECT_DIRS = ['.cordoval', '.opencode'];

// Minimal frontmatter parser: scalars, inline lists and one level of nested maps.
function parseFrontmatter(text) {
  const m = String(text).match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { data: {}, body: String(text).trim() };
  const data = {};
  let parent = null;
  for (const raw of m[1].split(/\r?\n/)) {
    if (!raw.trim() || raw.trim().startsWith('#')) continue;
    const nested = /^\s+/.test(raw);
    const kv = raw.trim().match(/^("?)([^":]+)\1\s*:\s*(.*)$/);
    if (!kv) continue;
    const key = kv[2].trim();
    const val = scalar(kv[3]);
    if (nested && parent) { data[parent] = typeof data[parent] === 'object' && data[parent] ? data[parent] : {}; data[parent][key] = val; continue; }
    if (kv[3].trim() === '') { parent = key; data[key] = {}; continue; }
    parent = null;
    data[key] = val;
  }
  return { data, body: m[2].trim() };
}
function scalar(v) {
  v = String(v).trim();
  if (/^".*"$|^'.*'$/.test(v)) return v.slice(1, -1);
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  if (/^\[.*\]$/.test(v)) return v.slice(1, -1).split(',').map(s => scalar(s)).filter(s => s !== '');
  return v;
}

function readMarkdownDir(projectDir, kind) {
  const out = {};
  if (!projectDir) return out;
  for (const base of PROJECT_DIRS.slice().reverse()) {
    for (const sub of [kind, kind + 's']) {
      const dir = path.join(projectDir, base, sub);
      let names = [];
      try { names = fs.readdirSync(dir); } catch (e) { continue; }
      for (const f of names) {
        if (!f.endsWith('.md')) continue;
        try {
          const { data, body } = parseFrontmatter(fs.readFileSync(path.join(dir, f), 'utf8'));
          out[f.slice(0, -3)] = { ...data, body };
        } catch (e) {}
      }
    }
  }
  return out;
}

const BUILT_IN_AGENTS = [
  { name: 'build', description: 'Default agent. Reads, writes and runs code.', mode: 'primary', builtIn: true },
  { name: 'plan', description: 'Read-only planning. Cannot edit files; shell commands ask first.', mode: 'primary', builtIn: true, permission: { edit: 'deny', bash: { '*': 'ask' }, webfetch: 'deny' } },
  { name: 'general', description: 'General-purpose helper for multi-step research.', mode: 'subagent', builtIn: true },
  { name: 'explore', description: 'Fast read-only exploration of the codebase.', mode: 'subagent', builtIn: true, permission: { edit: 'deny' } },
];

function agents(global, projectDir) {
  const map = new Map(BUILT_IN_AGENTS.map(a => [a.name, { ...a }]));
  const add = (name, cfg, source) => {
    if (!cfg || typeof cfg !== 'object') return;
    if (cfg.disable === true) { if (!map.get(name) || !map.get(name).builtIn) map.delete(name); return; }
    const prev = map.get(name) || { name, mode: 'all', builtIn: false };
    map.set(name, {
      ...prev,
      name,
      description: cfg.description != null ? String(cfg.description) : prev.description || '',
      mode: cfg.mode || prev.mode || 'all',
      model: cfg.model || prev.model,
      prompt: cfg.prompt != null ? String(cfg.prompt) : cfg.body != null ? String(cfg.body) : prev.prompt,
      temperature: cfg.temperature,
      permission: { ...(prev.permission || {}), ...(cfg.permission || {}) },
      tools: cfg.tools || prev.tools,
      hidden: !!cfg.hidden,
      source,
    });
  };
  for (const [n, c] of Object.entries((global && global.agent) || {})) add(n, c, 'global');
  for (const [n, c] of Object.entries(readMarkdownDir(projectDir, 'agent'))) add(n, c, 'project');
  return [...map.values()];
}

function commands(global, projectDir) {
  const map = new Map();
  for (const [n, c] of Object.entries((global && global.command) || {})) {
    if (c && typeof c === 'object') map.set(n, { name: n, description: c.description || '', template: String(c.template || ''), agent: c.agent, model: c.model, source: 'command' });
  }
  for (const [n, c] of Object.entries(readMarkdownDir(projectDir, 'command'))) {
    map.set(n, { name: n, description: c.description || '', template: String(c.body || c.template || ''), agent: c.agent, model: c.model, source: 'command' });
  }
  return [...map.values()];
}

function instructions(projectDir) {
  for (const n of ['AGENTS.md', 'CORDOVAL.md']) {
    try { const t = fs.readFileSync(path.join(projectDir, n), 'utf8'); if (t.trim()) return { file: n, text: t.slice(0, 40000) }; } catch (e) {}
  }
  return null;
}

module.exports = { parseFrontmatter, agents, commands, instructions, BUILT_IN_AGENTS };
