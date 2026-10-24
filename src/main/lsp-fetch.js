'use strict';
// Resolves native language servers: uses one on PATH, otherwise fetches it on first use
// into <userData>/lsp. Nothing is downloaded until a matching file is opened.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { spawnSync } = require('child_process');
const { app } = require('electron');

const IS_WIN = process.platform === 'win32';
const inflight = new Map();

function lspDir(...p) { return path.join(app.getPath('userData'), 'lsp', ...p); }

function which(cmd) {
  const exts = IS_WIN ? (process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';') : [''];
  for (const dir of String(process.env.PATH || '').split(path.delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      const full = path.join(dir, cmd + ext.toLowerCase());
      const full2 = path.join(dir, cmd + ext);
      for (const f of [full, full2]) {
        try { if (fs.statSync(f).isFile()) return f; } catch (e) {}
      }
    }
  }
  return null;
}

async function download(url, dest) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error('Download failed (' + res.status + ') for ' + url);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, buf);
  return dest;
}

function once(key, fn) {
  if (!inflight.has(key)) inflight.set(key, fn().catch((e) => { inflight.delete(key); throw e; }));
  return inflight.get(key);
}

function rustTarget() {
  const arch = process.arch === 'arm64' ? 'aarch64' : 'x86_64';
  if (IS_WIN) return arch + '-pc-windows-msvc';
  if (process.platform === 'darwin') return arch + '-apple-darwin';
  return arch + '-unknown-linux-gnu';
}

const RESOLVERS = {
  async rust() {
    const onPath = which('rust-analyzer');
    if (onPath && spawnSync(onPath, ['--version'], { timeout: 10000 }).status === 0) return { command: onPath, args: [] };
    const bin = lspDir('rust-analyzer', IS_WIN ? 'rust-analyzer.exe' : 'rust-analyzer');
    if (fs.existsSync(bin)) return { command: bin, args: [] };
    return once('rust', async () => {
      const base = 'https://github.com/rust-lang/rust-analyzer/releases/latest/download/rust-analyzer-' + rustTarget();
      if (IS_WIN) {
        const zip = await download(base + '.zip', lspDir('rust-analyzer', 'ra.zip'));
        await require('extract-zip')(zip, { dir: lspDir('rust-analyzer') });
        fs.rmSync(zip, { force: true });
      } else {
        const gz = await download(base + '.gz', lspDir('rust-analyzer', 'ra.gz'));
        fs.writeFileSync(bin, zlib.gunzipSync(fs.readFileSync(gz)));
        fs.chmodSync(bin, 0o755);
        fs.rmSync(gz, { force: true });
      }
      return { command: bin, args: [] };
    });
  },
  async go() {
    const onPath = which('gopls');
    if (onPath) return { command: onPath, args: [] };
    const bin = lspDir('gopls', IS_WIN ? 'gopls.exe' : 'gopls');
    if (fs.existsSync(bin)) return { command: bin, args: [] };
    const go = which('go');
    if (!go) throw new Error('Go is not installed, so gopls cannot be installed. Install Go from https://go.dev/dl/');
    return once('go', async () => {
      fs.mkdirSync(lspDir('gopls'), { recursive: true });
      const r = spawnSync(go, ['install', 'golang.org/x/tools/gopls@latest'], {
        env: Object.assign({}, process.env, { GOBIN: lspDir('gopls') }), timeout: 600000, windowsHide: true,
      });
      if (r.status !== 0 || !fs.existsSync(bin)) throw new Error('go install gopls failed');
      return { command: bin, args: [] };
    });
  },
  async kotlin() {
    for (const name of ['kotlin-lsp', 'kotlin-language-server']) {
      const p = which(name);
      if (p) return { command: p, args: name === 'kotlin-lsp' ? ['--stdio'] : [] };
    }
    if (!which('java')) throw new Error('Java 17+ is required for the Kotlin language server.');
    const bin = lspDir('kotlin', 'server', 'bin', IS_WIN ? 'kotlin-language-server.bat' : 'kotlin-language-server');
    if (fs.existsSync(bin)) return { command: bin, args: [] };
    return once('kotlin', async () => {
      const zip = await download('https://github.com/fwcd/kotlin-language-server/releases/latest/download/server.zip', lspDir('kotlin', 'server.zip'));
      await require('extract-zip')(zip, { dir: lspDir('kotlin') });
      fs.rmSync(zip, { force: true });
      if (!IS_WIN) fs.chmodSync(bin, 0o755);
      return { command: bin, args: [] };
    });
  },
  async dart() {
    // Dart's server ships with the Dart and Flutter SDKs (too large to fetch).
    const dart = which('dart') || (which('flutter') && path.join(path.dirname(which('flutter')), IS_WIN ? 'dart.bat' : 'dart'));
    if (!dart || !fs.existsSync(dart)) throw new Error('Install the Flutter or Dart SDK to get Dart diagnostics.');
    return { command: dart, args: ['language-server', '--protocol=lsp'] };
  },
};

module.exports = { RESOLVERS, which };
