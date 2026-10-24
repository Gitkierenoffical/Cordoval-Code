'use strict';
// Small async git wrapper plus the snapshot store used for undo, revert and session diffs.
// Snapshots live in a private git dir per project, so the user's own repository is never touched.
const { execFile } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function git(args, opts) {
  opts = opts || {};
  return new Promise((resolve) => {
    execFile('git', args, { cwd: opts.cwd, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', ...(opts.env || {}) }, maxBuffer: 64 * 1024 * 1024, encoding: opts.encoding || 'utf8', timeout: opts.timeout || 60000 }, (err, stdout, stderr) => {
      resolve({ ok: !err, code: err ? (err.code || 1) : 0, stdout: stdout || '', stderr: String(stderr || '') });
    });
  });
}

class Snapshots {
  constructor(root) { this.root = path.join(root, 'snapshot'); this.queue = new Map(); }
  dir(project) { return path.join(this.root, crypto.createHash('sha1').update(path.resolve(project)).digest('hex').slice(0, 16)); }
  base(project) { return ['--git-dir', this.dir(project), '--work-tree', path.resolve(project)]; }
  async ensure(project) {
    const d = this.dir(project);
    if (fs.existsSync(path.join(d, 'HEAD'))) return true;
    fs.mkdirSync(d, { recursive: true });
    const r = await git([...this.base(project), 'init', '-q'], { cwd: project });
    if (!r.ok) return false;
    await git([...this.base(project), 'config', 'core.autocrlf', 'false'], { cwd: project });
    await git([...this.base(project), 'config', 'core.quotepath', 'false'], { cwd: project });
    fs.mkdirSync(path.join(d, 'info'), { recursive: true });
    fs.writeFileSync(path.join(d, 'info', 'exclude'), 'node_modules/\n.DS_Store\n');
    return true;
  }
  // Serialise operations per project so the shared index is never used concurrently.
  serial(project, fn) {
    const key = path.resolve(project);
    const prev = this.queue.get(key) || Promise.resolve();
    const next = prev.then(fn, fn);
    this.queue.set(key, next.catch(() => {}));
    return next;
  }
  track(project) {
    return this.serial(project, async () => {
      if (!(await this.ensure(project))) return null;
      await git([...this.base(project), 'add', '-A', '.'], { cwd: project, timeout: 120000 });
      const r = await git([...this.base(project), 'write-tree'], { cwd: project });
      return r.ok ? r.stdout.trim() : null;
    });
  }
  async restore(project, hash) {
    if (!hash) return false;
    const current = await this.track(project);
    return this.serial(project, async () => {
      if (current && current !== hash) {
        const r = await git([...this.base(project), 'diff', '--name-status', '--no-renames', '-z', hash, current], { cwd: project });
        const items = r.stdout.split('\0');
        for (let i = 0; i + 1 < items.length; i += 2) {
          if (items[i] === 'A') {
            const target = path.join(project, items[i + 1]);
            fs.rmSync(target, { force: true });
          }
        }
      }
      await git([...this.base(project), 'read-tree', hash], { cwd: project });
      const r = await git([...this.base(project), 'checkout-index', '-a', '-f'], { cwd: project });
      return r.ok;
    });
  }
  async diff(project, from, to) {
    if (!from) return [];
    if (!to) to = await this.track(project);
    if (!to || from === to) return [];
    const b = this.base(project);
    const ns = await git([...b, 'diff', '--name-status', '--no-renames', '-z', from, to], { cwd: project });
    const num = await git([...b, 'diff', '--numstat', '--no-renames', '-z', from, to], { cwd: project });
    const stats = {};
    for (const rec of num.stdout.split('\0')) {
      const m = rec.match(/^(\S+)\t(\S+)\t(.*)$/);
      if (m) stats[m[3]] = { additions: m[1] === '-' ? 0 : Number(m[1]), deletions: m[2] === '-' ? 0 : Number(m[2]), binary: m[1] === '-' };
    }
    const items = ns.stdout.split('\0');
    const out = [];
    for (let i = 0; i + 1 < items.length; i += 2) {
      const code = items[i], file = items[i + 1];
      const st = stats[file] || { additions: 0, deletions: 0 };
      const show = async (h) => { const r = await git([...b, 'show', h + ':' + file], { cwd: project }); return r.ok ? r.stdout : ''; };
      const big = st.binary || st.additions + st.deletions > 20000;
      out.push({
        file, status: code === 'A' ? 'added' : code === 'D' ? 'deleted' : 'modified',
        additions: st.additions, deletions: st.deletions,
        before: big || code === 'A' ? '' : await show(from),
        after: big || code === 'D' ? '' : await show(to),
      });
    }
    return out;
  }
}
module.exports = { git, Snapshots };
