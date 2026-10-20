'use strict';
// Reads and writes the engine's own global config file (opencode.json[c] in the engine's
// isolated config dir) and the project's .opencode/{agent,command} markdown files,
// exactly where OpenCode itself looks for them.
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

function configDir() { return path.join(app.getPath('userData'), 'engine', 'config', 'opencode'); }
function configFile() {
  const dir = configDir();
  for (const n of ['opencode.jsonc', 'opencode.json']) if (fs.existsSync(path.join(dir, n))) return path.join(dir, n);
  return path.join(dir, 'opencode.json');
}

function stripJsonc(text) {
  let out = '', i = 0, inStr = false;
  while (i < text.length) {
    const c = text[i], n = text[i + 1];
    if (inStr) { out += c; if (c === '\\') { out += n; i += 2; continue; } if (c === '"') inStr = false; i++; continue; }
    if (c === '"') { inStr = true; out += c; i++; continue; }
    if (c === '/' && n === '/') { while (i < text.length && text[i] !== '\n') i++; continue; }
    if (c === '/' && n === '*') { i += 2; while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++; i += 2; continue; }
    out += c; i++;
  }
  return out.replace(/,(\s*[}\]])/g, '$1');
}

function read() {
  try { return JSON.parse(stripJsonc(fs.readFileSync(configFile(), 'utf8'))); } catch (e) { return { $schema: 'https://opencode.ai/config.json' }; }
}

const ALLOWED_KEYS = ['$schema', 'mcp', 'agent', 'command', 'permission', 'tools', 'instructions', 'model', 'small_model', 'default_agent', 'lsp', 'formatter', 'watcher', 'compaction', 'username', 'theme', 'keybinds', 'share', 'autoupdate', 'provider', 'disabled_providers', 'enabled_providers', 'plugin', 'snapshot', 'experimental'];

function write(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('Invalid config.');
  const clean = { $schema: 'https://opencode.ai/config.json' };
  for (const k of Object.keys(obj)) if (ALLOWED_KEYS.includes(k)) clean[k] = obj[k];
  clean.share = 'disabled';
  clean.autoupdate = false;
  fs.mkdirSync(configDir(), { recursive: true });
  const file = configFile();
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(clean, null, 2));
  fs.renameSync(tmp, file);
  return clean;
}

// Project .opencode files (agents and commands as markdown with frontmatter).
function projectPath(projectDir, kind, name) {
  if (!['agent', 'command'].includes(kind)) throw new Error('Invalid kind.');
  name = path.basename(String(name || '')).replace(/\.md$/i, '');
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(String(name || ''))) throw new Error('Invalid name. Use letters, numbers, dot, dash or underscore.');
  const root = path.resolve(String(projectDir || ''));
  if (!fs.existsSync(root)) throw new Error('Project folder does not exist.');
  return path.join(root, '.opencode', kind, name + '.md');
}

function listProject(projectDir, kind) {
  const out = [];
  for (const sub of [kind, kind + 's']) {
    const dir = path.join(path.resolve(String(projectDir || '')), '.opencode', sub);
    try {
      for (const f of fs.readdirSync(dir)) if (f.endsWith('.md')) out.push({ name: f.slice(0, -3), content: fs.readFileSync(path.join(dir, f), 'utf8'), file: path.join(dir, f) });
    } catch (e) {}
  }
  return out;
}
function writeProject(projectDir, kind, name, content) {
  const file = projectPath(projectDir, kind, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, String(content));
  return file;
}
function deleteProject(projectDir, kind, name) {
  const file = projectPath(projectDir, kind, name);
  fs.rmSync(file, { force: true });
  const alt = path.join(path.dirname(path.dirname(file)), kind + 's', name + '.md');
  fs.rmSync(alt, { force: true });
  return true;
}

// First-run defaults: shell commands that touch the system or remotes ask first. Users can
// change these on the Permissions page; nothing is reseeded once the file exists.
const SEED = {
  $schema: 'https://opencode.ai/config.json',
  permission: { bash: { '*': 'allow', 'sudo *': 'ask', 'su *': 'ask', 'rm -rf *': 'ask', 'git push*': 'ask', 'npm publish*': 'ask', 'curl * | sh*': 'ask', 'curl * | bash*': 'ask' } },
};
function seedIfMissing() {
  const dir = configDir();
  if (['opencode.jsonc', 'opencode.json'].some((n) => fs.existsSync(path.join(dir, n)))) return false;
  write(SEED);
  return true;
}

module.exports = { seedIfMissing, read, write, configFile, listProject, writeProject, deleteProject };
