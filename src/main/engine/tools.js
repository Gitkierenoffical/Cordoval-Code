'use strict';
// Built-in tools: read, write, edit, list, glob, grep and bash. Every tool checks permissions
// through ctx.ask() before it touches the disk or runs anything.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const files = require('./files');
const { wildcard, toPosix } = require('./util');

const MAX_OUTPUT = 30000;
function clip(s, n) { s = String(s); n = n || MAX_OUTPUT; return s.length > n ? s.slice(0, n) + '\n... (' + (s.length - n) + ' more characters cut)' : s; }

function resolvePath(ctx, p) {
  if (!p) throw new Error('A file path is required.');
  const abs = path.resolve(ctx.directory, String(p));
  if (ctx.privateDir && (abs === ctx.privateDir || abs.startsWith(ctx.privateDir + path.sep))) throw new Error('That path is private to the app and cannot be accessed.');
  return abs;
}
async function checkExternal(ctx, abs) {
  const rel = path.relative(ctx.directory, abs);
  if (rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) await ctx.ask('external_directory', abs, 'Access outside the project: ' + abs);
}
const rel = (ctx, abs) => toPosix(path.relative(ctx.directory, abs)) || '.';

const defs = {
  read: {
    description: 'Read a text file. Returns numbered lines. Use offset and limit (in lines) for large files.',
    schema: { type: 'object', properties: { filePath: { type: 'string', description: 'Path, absolute or relative to the project' }, offset: { type: 'number' }, limit: { type: 'number' } }, required: ['filePath'] },
    async run(input, ctx) {
      const abs = resolvePath(ctx, input.filePath);
      await checkExternal(ctx, abs);
      await ctx.ask('read', abs, 'Read ' + rel(ctx, abs));
      ctx.title(rel(ctx, abs));
      if (!fs.existsSync(abs)) throw new Error('File not found: ' + input.filePath);
      if (fs.statSync(abs).isDirectory()) throw new Error('That is a folder. Use the list tool.');
      const buf = fs.readFileSync(abs);
      if (buf.subarray(0, 8000).includes(0)) return 'Binary file, ' + buf.length + ' bytes.';
      const lines = buf.toString('utf8').split('\n');
      const start = Math.max(0, Number(input.offset) || 0);
      const count = Math.max(1, Math.min(Number(input.limit) || 2000, 5000));
      const out = lines.slice(start, start + count).map((l, i) => String(start + i + 1).padStart(5, '0') + '| ' + (l.length > 2000 ? l.slice(0, 2000) + '...' : l));
      if (start + count < lines.length) out.push('(file has ' + lines.length + ' lines; use offset to read more)');
      return clip(out.join('\n'), 60000);
    },
  },
  write: {
    description: 'Create or overwrite a file with the given content.',
    schema: { type: 'object', properties: { filePath: { type: 'string' }, content: { type: 'string' } }, required: ['filePath', 'content'] },
    mutates: true,
    async run(input, ctx) {
      const abs = resolvePath(ctx, input.filePath);
      await checkExternal(ctx, abs);
      await ctx.ask('edit', rel(ctx, abs), 'Write ' + rel(ctx, abs));
      ctx.title(rel(ctx, abs));
      const existed = fs.existsSync(abs);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, String(input.content == null ? '' : input.content));
      return (existed ? 'Updated ' : 'Created ') + rel(ctx, abs);
    },
  },
  edit: {
    description: 'Replace an exact string in a file. oldString must match exactly once unless replaceAll is true. Read the file first.',
    schema: { type: 'object', properties: { filePath: { type: 'string' }, oldString: { type: 'string' }, newString: { type: 'string' }, replaceAll: { type: 'boolean' } }, required: ['filePath', 'oldString', 'newString'] },
    mutates: true,
    async run(input, ctx) {
      const abs = resolvePath(ctx, input.filePath);
      await checkExternal(ctx, abs);
      await ctx.ask('edit', rel(ctx, abs), 'Edit ' + rel(ctx, abs));
      ctx.title(rel(ctx, abs));
      if (input.oldString === '') { fs.mkdirSync(path.dirname(abs), { recursive: true }); fs.writeFileSync(abs, String(input.newString)); return 'Wrote ' + rel(ctx, abs); }
      if (!fs.existsSync(abs)) throw new Error('File not found: ' + input.filePath);
      let text = fs.readFileSync(abs, 'utf8');
      const crlf = text.includes('\r\n');
      if (crlf) text = text.replace(/\r\n/g, '\n');
      const oldS = String(input.oldString).replace(/\r\n/g, '\n'), newS = String(input.newString).replace(/\r\n/g, '\n');
      const count = text.split(oldS).length - 1;
      if (count === 0) throw new Error('oldString was not found in ' + rel(ctx, abs) + '. Read the file and copy the text exactly.');
      if (count > 1 && !input.replaceAll) throw new Error('oldString matches ' + count + ' places. Add more surrounding context or set replaceAll.');
      text = input.replaceAll ? text.split(oldS).join(newS) : text.replace(oldS, () => newS);
      fs.writeFileSync(abs, crlf ? text.replace(/\n/g, '\r\n') : text);
      return 'Edited ' + rel(ctx, abs) + ' (' + (input.replaceAll ? count : 1) + ' replacement' + ((input.replaceAll ? count : 1) > 1 ? 's' : '') + ')';
    },
  },
  list: {
    description: 'List files and folders in a directory (default: the project root).',
    schema: { type: 'object', properties: { path: { type: 'string' } } },
    async run(input, ctx) {
      const abs = resolvePath(ctx, input.path || '.');
      await checkExternal(ctx, abs);
      ctx.title(rel(ctx, abs));
      const out = [];
      const walk = (d, depth) => {
        let ents = [];
        try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return; }
        ents.sort((a, b) => a.name.localeCompare(b.name));
        for (const e of ents) {
          if (['.git', 'node_modules', '.DS_Store'].includes(e.name)) continue;
          if (out.length >= 300) return;
          out.push('  '.repeat(depth) + e.name + (e.isDirectory() ? '/' : ''));
          if (e.isDirectory() && depth < 2) walk(path.join(d, e.name), depth + 1);
        }
      };
      walk(abs, 0);
      return out.length ? out.join('\n') : '(empty)';
    },
  },
  glob: {
    description: 'Find files by glob pattern, for example "**/*.js" or "src/*.ts".',
    schema: { type: 'object', properties: { pattern: { type: 'string' } }, required: ['pattern'] },
    async run(input, ctx) {
      ctx.title(input.pattern);
      const pat = String(input.pattern);
      const list = (await files.allFiles(ctx.directory)).filter(f => wildcard(pat, f) || (pat.startsWith('**/') && wildcard(pat.slice(3), f)) || (!pat.includes('/') && wildcard(pat, f.split('/').pop())));
      return list.length ? clip(list.slice(0, 500).join('\n')) : 'No files found.';
    },
  },
  grep: {
    description: 'Search file contents with a regular expression. Optional include filter such as "*.js".',
    schema: { type: 'object', properties: { pattern: { type: 'string' }, include: { type: 'string' } }, required: ['pattern'] },
    async run(input, ctx) {
      ctx.title(input.pattern);
      const hits = await files.grep(ctx.directory, input.pattern, { include: input.include, limit: 200 });
      if (!hits.length) return 'No matches.';
      return clip(hits.map(h => h.path.text + ':' + h.line_number + ': ' + h.lines.text.trimEnd().slice(0, 300)).join('\n'));
    },
  },
  bash: {
    description: 'Run a shell command in the project folder. Output is captured. Use timeout (ms) for long commands; default 120000.',
    schema: { type: 'object', properties: { command: { type: 'string' }, description: { type: 'string', description: 'Five to ten words on what the command does' }, timeout: { type: 'number' } }, required: ['command'] },
    mutates: true,
    async run(input, ctx) {
      const command = String(input.command || '').trim();
      if (!command) throw new Error('Empty command.');
      await ctx.ask('bash', command, input.description || command);
      ctx.title(input.description || command.slice(0, 80));
      const timeout = Math.min(Math.max(Number(input.timeout) || 120000, 1000), 600000);
      return await new Promise((resolve, reject) => {
        const win = process.platform === 'win32';
        const child = spawn(win ? (process.env.ComSpec || 'cmd.exe') : (process.env.SHELL && /bash|zsh/.test(process.env.SHELL) ? process.env.SHELL : '/bin/bash'), win ? ['/d', '/s', '/c', command] : ['-c', command], { cwd: ctx.directory, env: ctx.env, detached: !win, stdio: ['ignore', 'pipe', 'pipe'], windowsVerbatimArguments: win });
        let out = '';
        const add = (d) => { out += d; if (out.length > 200000) out = out.slice(-200000); };
        child.stdout.on('data', add); child.stderr.on('data', add);
        const kill = () => { try { if (win) spawn('taskkill', ['/pid', String(child.pid), '/T', '/F']); else process.kill(-child.pid, 'SIGKILL'); } catch (e) { try { child.kill('SIGKILL'); } catch (err) {} } };
        const timer = setTimeout(() => { add('\n(command timed out after ' + timeout + ' ms)'); kill(); }, timeout);
        const onAbort = () => { add('\n(command aborted)'); kill(); };
        if (ctx.signal) ctx.signal.addEventListener('abort', onAbort, { once: true });
        child.on('error', (e) => { clearTimeout(timer); reject(e); });
        child.on('close', (code) => {
          clearTimeout(timer);
          if (ctx.signal) ctx.signal.removeEventListener('abort', onAbort);
          ctx.meta({ exit: code });
          resolve(clip((out || '(no output)') + (code ? '\n(exit code ' + code + ')' : '')));
        });
      });
    },
  },
};

const READ_ONLY = ['read', 'list', 'glob', 'grep', 'bash'];
module.exports = { defs, READ_ONLY };
