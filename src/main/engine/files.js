'use strict';
// File tree, content, search and git status for one project folder.
const fs = require('fs');
const path = require('path');
const { git } = require('./git');
const { insideRoot, toPosix } = require('./util');

const SKIP = new Set(['.git', 'node_modules', '.DS_Store']);

function list(root, rel) {
  const dir = insideRoot(root, rel || '.');
  if (!dir) throw httpError(400, 'Path is outside the project.');
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { throw httpError(404, 'Folder not found.'); }
  return entries.filter(e => e.name !== '.git').map(e => {
    const abs = path.join(dir, e.name);
    let isDir = e.isDirectory();
    if (e.isSymbolicLink()) { try { isDir = fs.statSync(abs).isDirectory(); } catch (err) {} }
    return { name: e.name, path: toPosix(path.relative(root, abs)), absolute: abs, type: isDir ? 'directory' : 'file', ignored: SKIP.has(e.name) };
  });
}

function content(root, rel) {
  const file = insideRoot(root, rel);
  if (!file) throw httpError(400, 'Path is outside the project.');
  let buf;
  try { buf = fs.readFileSync(file); } catch (e) { throw httpError(404, 'File not found.'); }
  if (buf.length > 5 * 1024 * 1024) return { type: 'text', content: '[file too large to show]' };
  if (buf.subarray(0, 8000).includes(0)) return { type: 'binary', content: '' };
  return { type: 'text', content: buf.toString('utf8') };
}

// Project files, honouring .gitignore when the folder is a repository.
async function allFiles(root, limit) {
  limit = limit || 20000;
  const r = await git(['ls-files', '-co', '--exclude-standard', '-z'], { cwd: root });
  if (r.ok && r.stdout) return r.stdout.split('\0').filter(Boolean).slice(0, limit);
  const out = [];
  const walk = (d) => {
    if (out.length >= limit) return;
    let ents = [];
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return; }
    for (const e of ents) {
      if (SKIP.has(e.name)) continue;
      const abs = path.join(d, e.name);
      if (e.isDirectory()) walk(abs); else out.push(toPosix(path.relative(root, abs)));
      if (out.length >= limit) return;
    }
  };
  walk(root);
  return out;
}

async function findFiles(root, query, limit) {
  const q = String(query || '').toLowerCase();
  const files = await allFiles(root);
  const scored = [];
  for (const f of files) {
    const lf = f.toLowerCase();
    if (!q) { scored.push([0, f]); continue; }
    const base = lf.split('/').pop();
    let s = -1;
    if (base.startsWith(q)) s = 3; else if (base.includes(q)) s = 2; else if (lf.includes(q)) s = 1;
    if (s >= 0) scored.push([s, f]);
  }
  scored.sort((a, b) => b[0] - a[0] || a[1].length - b[1].length || a[1].localeCompare(b[1]));
  return scored.slice(0, limit || 50).map(x => x[1]);
}

async function grep(root, pattern, opts) {
  opts = opts || {};
  let re;
  try { re = new RegExp(pattern, opts.flags || ''); } catch (e) { re = new RegExp(String(pattern).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')); }
  const files = await allFiles(root);
  const out = [];
  for (const f of files) {
    if (opts.include && !require('./util').wildcard(opts.include.includes('/') ? opts.include : '*' + opts.include.replace(/^\*+/, ''), f)) continue;
    const abs = path.join(root, f);
    let text;
    try { const st = fs.statSync(abs); if (st.size > 2 * 1024 * 1024) continue; const buf = fs.readFileSync(abs); if (buf.subarray(0, 4000).includes(0)) continue; text = buf.toString('utf8'); } catch (e) { continue; }
    const lines = text.split('\n');
    let offset = 0;
    for (let i = 0; i < lines.length; i++) {
      if (re.test(lines[i])) {
        out.push({ path: { text: f }, lines: { text: lines[i] + '\n' }, line_number: i + 1, absolute_offset: offset, submatches: [] });
        if (out.length >= (opts.limit || 500)) return out;
      }
      offset += lines[i].length + 1;
    }
  }
  return out;
}

async function isRepo(root) {
  const r = await git(['rev-parse', '--is-inside-work-tree'], { cwd: root });
  return r.ok && r.stdout.trim() === 'true';
}

async function vcs(root) {
  if (!(await isRepo(root))) return {};
  let r = await git(['symbolic-ref', '--short', 'HEAD'], { cwd: root });
  if (!r.ok) r = await git(['rev-parse', '--short', 'HEAD'], { cwd: root });
  return { branch: r.stdout.trim() || 'HEAD', vcs: 'git' };
}

async function hasHead(root) { return (await git(['rev-parse', '--verify', '-q', 'HEAD'], { cwd: root })).ok; }

function countLines(text) { if (!text) return 0; const n = text.split('\n').length; return text.endsWith('\n') ? n - 1 : n; }

async function status(root) {
  if (!(await isRepo(root))) return [];
  const st = await git(['status', '--porcelain=v1', '-uall', '-z'], { cwd: root });
  const head = await hasHead(root);
  const num = head ? await git(['diff', '--numstat', '-z', 'HEAD'], { cwd: root }) : { stdout: '' };
  const stats = {};
  for (const rec of num.stdout.split('\0')) { const m = rec.match(/^(\S+)\t(\S+)\t(.*)$/); if (m) stats[m[3]] = [Number(m[1]) || 0, Number(m[2]) || 0]; }
  const out = [];
  const recs = st.stdout.split('\0');
  for (let i = 0; i < recs.length; i++) {
    const rec = recs[i];
    if (!rec || rec.length < 4) continue;
    const x = rec[0], y = rec[1], file = rec.slice(3);
    if (x === 'R' || x === 'C') i++;
    let s = 'modified';
    if (x === '?' || x === 'A') s = 'added';
    else if (x === 'D' || y === 'D') s = 'deleted';
    let [added, removed] = stats[file] || [0, 0];
    if (s === 'added' && !stats[file]) { try { added = countLines(fs.readFileSync(path.join(root, file), 'utf8')); } catch (e) {} }
    out.push({ path: file, added, removed, status: s });
  }
  return out;
}

// Working tree against HEAD, with full before/after text for the diff view.
async function vcsDiff(root) {
  const list = await status(root);
  const head = await hasHead(root);
  const out = [];
  for (const item of list.slice(0, 300)) {
    let before = '', after = '';
    if (head && item.status !== 'added') { const r = await git(['show', 'HEAD:' + item.path], { cwd: root }); before = r.ok ? r.stdout : ''; }
    if (item.status !== 'deleted') { try { const buf = fs.readFileSync(path.join(root, item.path)); after = buf.length < 2 * 1024 * 1024 && !buf.subarray(0, 4000).includes(0) ? buf.toString('utf8') : ''; } catch (e) {} }
    out.push({ file: item.path, before, after, additions: item.added, deletions: item.removed, status: item.status });
  }
  return out;
}

function httpError(status, message) { const e = new Error(message); e.status = status; return e; }

module.exports = { list, content, allFiles, findFiles, grep, vcs, status, vcsDiff, isRepo, httpError };
