'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { app, BrowserWindow, dialog, ipcMain, shell, session } = require('electron');

const engine = require('./engine');
const keys = require('./keys');
const oauth = require('./oauth');
const updater = require('./updater');
const engineConfig = require('./engine-config');
const lsp = require('./lsp');

// Lets automated tests run against a throwaway profile.
if (process.env.CORDOVAL_USER_DATA) app.setPath('userData', process.env.CORDOVAL_USER_DATA);

let win = null;
let enginePromise = null;

const DEFAULT_SETTINGS = { theme: 'light', updatesEnabled: false, updateFeed: '' };

function userDataFile(name) {
  return path.join(app.getPath('userData'), name);
}

function startEngine() {
  if (enginePromise) return enginePromise;
  const run = engine
    .start((() => { try { engineConfig.seedIfMissing(); } catch (e) {} return { userData: app.getPath('userData'), keys: keys.readAll() }; })())
    .then(info => info.url)
    .catch(err => {
      if (enginePromise === run) enginePromise = null;
      throw err;
    });
  enginePromise = run;
  return run;
}

function readSettings() {
  try {
    const doc = JSON.parse(fs.readFileSync(userDataFile('settings.json'), 'utf8'));
    return doc && typeof doc === 'object' ? doc : {};
  } catch (err) {
    return {};
  }
}

function writeSettings(settings) {
  const target = userDataFile('settings.json');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = target + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(settings, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, target);
}

function listTemplates() {
  const target = path.join(__dirname, '..', 'templates', 'index.js');
  try {
    if (!fs.existsSync(target)) return [];
    delete require.cache[require.resolve(target)];
    const mod = require(target);
    const list = Array.isArray(mod)
      ? mod
      : Array.isArray(mod && mod.templates)
        ? mod.templates
        : Array.isArray(mod && mod.default)
          ? mod.default
          : [];
    const out = [];
    for (const item of list) {
      if (!item || typeof item !== 'object') continue;
      const id = String(item.id == null ? '' : item.id).trim();
      if (!id) continue;
      out.push({
        id,
        name: String(item.name == null ? '' : item.name),
        category: String(item.category == null ? '' : item.category),
        description: String(item.description == null ? '' : item.description),
        prompt: String(item.prompt == null ? '' : item.prompt),
        system: String(item.system == null ? '' : item.system),
      });
    }
    return out;
  } catch (err) {
    return [];
  }
}

function scaffoldProject(templateId, parentDir, name) {
  if (typeof templateId !== 'string' || typeof parentDir !== 'string' || typeof name !== 'string') {
    throw new Error('Invalid scaffold arguments.');
  }
  const folderName = name.trim();
  if (!folderName || folderName === '.' || folderName === '..' || /[\\/]/.test(folderName)) {
    throw new Error('Invalid project name.');
  }
  const templates = listTemplates();
  if (templates.length && !templates.some(t => t.id === templateId)) {
    throw new Error('Unknown template.');
  }
  const parent = path.resolve(parentDir);
  let stat;
  try {
    stat = fs.statSync(parent);
  } catch (err) {
    throw new Error('Parent folder does not exist.');
  }
  if (!stat.isDirectory()) throw new Error('Parent path is not a folder.');
  const target = path.join(parent, folderName);
  if (fs.existsSync(target)) throw new Error('A folder with that name already exists.');
  fs.mkdirSync(target);
  try {
    spawnSync('git', ['init'], { cwd: target, stdio: 'ignore', timeout: 15000 });
  } catch (err) {
    // git is optional: the app degrades without repository-backed diffs and undo
  }
  const template = templates.find(t => t.id === templateId) || null;
  return { path: target, template };
}

function windowSize() {
  const fallback = { width: 1440, height: 900 };
  const raw = String(process.env.CORDOVAL_WINDOW_SIZE || '').trim();
  const match = raw.match(/^(\d{2,5})\s*[xX]\s*(\d{2,5})$/);
  if (!match) return fallback;
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height)) return fallback;
  if (width < 320 || height < 240 || width > 10000 || height > 10000) return fallback;
  return { width, height };
}

function registerIpc() {
  ipcMain.handle('engine:url', () => startEngine());

  ipcMain.handle('engine:restart', async () => {
    if (enginePromise) await enginePromise.catch(() => {});
    const info = await engine.restart({
      userData: app.getPath('userData'),
      keys: keys.readAll(),
    });
    enginePromise = Promise.resolve(info.url);
    return info.url;
  });

  ipcMain.handle('dialog:pickFolder', async () => {
    const options = {
      title: 'Open project folder',
      properties: ['openDirectory', 'createDirectory'],
    };
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
    if (result.canceled || !result.filePaths.length) return null;
    return result.filePaths[0];
  });

  ipcMain.handle('keys:get', () => keys.getMeta());

  ipcMain.handle('keys:set', (event, provider, value) => {
    if (typeof provider !== 'string') throw new Error('Invalid provider.');
    if (value !== null && value !== undefined && typeof value !== 'string') throw new Error('Invalid key value.');
    return keys.setKey(provider, value);
  });

  ipcMain.handle('keys:delete', (event, provider) => {
    if (typeof provider !== 'string') throw new Error('Invalid provider.');
    return keys.deleteKey(provider);
  });

  // Session import/export runs the engine's own CLI against the same isolated data dir.
  function runEngineCli(args, cwd) {
    const { execFile } = require('child_process');
    return new Promise((resolve, reject) => {
      const cp = execFile(engine.binaryPath(), args, { cwd, env: engine.buildEnv(app.getPath('userData'), keys.readAll()), maxBuffer: 256 * 1024 * 1024, timeout: 120000 }, (err, stdout, stderr) => {
        if (err) reject(new Error((stderr || err.message || '').toString().split('\n').filter(Boolean).slice(-3).join(' ')));
        else resolve(String(stdout));
      });
      if (cp.stdin) cp.stdin.end();
    });
  }
  ipcMain.handle('session:exportJson', async (event, id, dir) => {
    if (!/^[A-Za-z0-9_-]+$/.test(String(id))) throw new Error('Invalid session id.');
    const out = await runEngineCli(['export', String(id)], dir && fs.existsSync(dir) ? dir : app.getPath('home'));
    const start = out.indexOf('{');
    const data = JSON.parse(out.slice(start));
    return JSON.stringify(data, null, 2);
  });
  ipcMain.handle('session:importJson', async (event, dir) => {
    const res = await dialog.showOpenDialog(win, { title: 'Import session', properties: ['openFile'], filters: [{ name: 'Session JSON', extensions: ['json'] }] });
    if (res.canceled || !res.filePaths[0]) return null;
    const file = res.filePaths[0];
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!data || !data.info || !data.info.id || !Array.isArray(data.messages)) throw new Error('That file is not an exported session.');
    // Re-home the session in the current project so it shows up in the list.
    const tmp = path.join(app.getPath('temp'), 'cordoval-import-' + Date.now() + '.json');
    if (dir) data.info.directory = dir;
    fs.writeFileSync(tmp, JSON.stringify(data));
    try { await runEngineCli(['import', tmp], dir && fs.existsSync(dir) ? dir : app.getPath('home')); } finally { fs.rmSync(tmp, { force: true }); }
    return { id: data.info.id, title: data.info.title || '' };
  });
  ipcMain.handle('file:saveAs', async (event, defaultName, content) => {
    const res = await dialog.showSaveDialog(win, { title: 'Save', defaultPath: path.join(app.getPath('documents'), String(defaultName || 'export.txt').replace(/[\\/:*?"<>|]/g, '-')) });
    if (res.canceled || !res.filePath) return null;
    fs.writeFileSync(res.filePath, String(content));
    return res.filePath;
  });
  ipcMain.handle('econfig:get', () => engineConfig.read());
  ipcMain.handle('mcp:tools', async (event, name) => {
    const entry = ((engineConfig.read().mcp) || {})[String(name)];
    return require('./mcp-probe').listTools(entry);
  });
  ipcMain.handle('econfig:path', () => engineConfig.configFile());
  // Applies config changes live: the engine re-reads its global config file on any
  // PATCH /global/config, so write the file (deletions included) and send a no-op patch.
  // Falls back to a restart only if the live reload fails.
  async function engineRequest(method, p, body) {
    const url = enginePromise ? await enginePromise : null;
    if (!url) throw new Error('Engine not running.');
    const res = await fetch(url + p, { method, headers: { 'content-type': 'application/json', 'x-opencode-ticket': '1' }, body: body ? JSON.stringify(body) : undefined });
    if (!res.ok) throw new Error('Engine returned ' + res.status);
    return res;
  }
  // What the running engine (1.19.0) can take without a restart, checked by hand:
  //  - agent additions/changes: PATCH /global/config re-merges them live. Permission changes
  //    showed up in a bare engine but not with Cordoval's provider config, so they restart.
  //  - MCP servers: POST /mcp adds or replaces one in a project instance, and
  //    /mcp/:name/connect|disconnect switch it on or off, so all MCP edits are live.
  //  - command changes and removed agent/permission entries stay in memory until a restart.
  // Restarts only happen while every session is idle (the renderer queues them).
  let pendingBefore = null;
  function diffSection(a, b) {
    a = a && typeof a === 'object' ? a : {}; b = b && typeof b === 'object' ? b : {};
    const names = new Set(Object.keys(a).concat(Object.keys(b)));
    const out = { added: [], changed: [], removed: [] };
    for (const n of names) {
      if (!(n in a)) out.added.push(n); else if (!(n in b)) out.removed.push(n);
      else if (JSON.stringify(a[n]) !== JSON.stringify(b[n])) out.changed.push(n);
    }
    return out;
  }
  async function applyMcpLive(before, after, dirs) {
    const d = diffSection(before.mcp, after.mcp);
    for (const dir of dirs) {
      const q = '?directory=' + encodeURIComponent(dir);
      for (const n of d.added.concat(d.changed)) {
        const cfg = after.mcp[n];
        if (cfg.enabled === false) { await engineRequest('POST', '/mcp/' + encodeURIComponent(n) + '/disconnect' + q).catch(() => {}); continue; }
        await engineRequest('POST', '/mcp' + q, { name: n, config: cfg });
      }
      for (const n of d.removed) await engineRequest('POST', '/mcp/' + encodeURIComponent(n) + '/disconnect' + q).catch(() => {});
    }
  }
  ipcMain.handle('econfig:set', async (event, obj, opts) => {
    opts = opts || {};
    const current = engineConfig.read();
    const clean = engineConfig.write(obj);
    if (opts.writeOnly) {
      if (!pendingBefore) pendingBefore = current;
      return { url: enginePromise ? await enginePromise : null, restarted: false, applied: false };
    }
    const before = pendingBefore || current;
    pendingBefore = null;
    const keysChanged = Object.keys(Object.assign({}, before, clean)).filter((k) => k !== '$schema' && JSON.stringify(before[k]) !== JSON.stringify(clean[k]));
    const agentD = diffSection(before.agent, clean.agent);
    const permD = diffSection(before.permission, clean.permission);
    const needsRestart = opts.forceRestart
      || keysChanged.some((k) => !['agent', 'mcp', 'share', 'autoupdate'].includes(k))
      || agentD.removed.length > 0 || permD.removed.length > 0;
    if (!needsRestart) {
      try {
        const patch = Object.assign({}, clean); delete patch.$schema;
        await engineRequest('PATCH', '/global/config', patch);
        if (keysChanged.includes('mcp')) await applyMcpLive(before, clean, (opts.directories || []).filter(Boolean));
        return { url: await enginePromise, restarted: false, applied: true };
      } catch (err) { /* fall through to a restart */ }
    }
    if (enginePromise) await enginePromise.catch(() => {});
    const info = await engine.restart({ userData: app.getPath('userData'), keys: keys.readAll() });
    enginePromise = Promise.resolve(info.url);
    return { url: info.url, restarted: true, applied: true };
  });
  ipcMain.handle('eproject:apply', async (event, dir) => {
    await engineRequest('POST', '/instance/dispose?directory=' + encodeURIComponent(String(dir || '')));
    return true;
  });
  ipcMain.handle('eproject:list', (event, dir, kind) => engineConfig.listProject(dir, kind));
  ipcMain.handle('eproject:write', (event, dir, kind, name, content) => engineConfig.writeProject(dir, kind, name, content));
  ipcMain.handle('eproject:delete', (event, dir, kind, name) => engineConfig.deleteProject(dir, kind, name));
  ipcMain.handle('update:check', () => updater.check({ ...DEFAULT_SETTINGS, ...readSettings() }));
  ipcMain.handle('update:download', () => updater.download());
  ipcMain.handle('update:install', () => updater.install());
  ipcMain.handle('update:status', () => updater.status());
  ipcMain.handle('app:version', () => app.getVersion());
  updater.onStatus((st) => { if (win && !win.isDestroyed()) win.webContents.send('update:status', st); });
  ipcMain.handle('keys:storage', () => keys.storageStatus());
  ipcMain.handle('keys:getCustom', () => keys.getCustom());

  ipcMain.handle('keys:setCustom', (event, list) => keys.setCustom(list));

  ipcMain.handle('settings:get', () => ({ ...DEFAULT_SETTINGS, ...readSettings() }));

  ipcMain.handle('settings:set', (event, obj) => {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('Invalid settings.');
    const merged = { ...DEFAULT_SETTINGS, ...readSettings(), ...obj };
    writeSettings(merged);
    return merged;
  });

  ipcMain.handle('app:initialProject', () => {
    const arg = process.argv.find(a => a.startsWith('--project='));
    return arg ? path.resolve(arg.slice('--project='.length)) : null;
  });

  ipcMain.handle('templates:list', () => listTemplates());

  ipcMain.handle('scaffold:create', (event, templateId, parentDir, name) => scaffoldProject(templateId, parentDir, name));

  ipcMain.handle('file:write', (event, projectDir, relPath, content) => {
    if (typeof projectDir !== 'string' || !projectDir.trim()) throw new Error('Missing project directory.');
    if (typeof relPath !== 'string' || !relPath.trim()) throw new Error('Missing file path.');
    if (typeof content !== 'string') throw new Error('Invalid file content.');
    const root = path.resolve(projectDir);
    const target = path.resolve(root, relPath);
    const rel = path.relative(root, target);
    if (!rel || rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) {
      throw new Error('Refusing to write outside the project directory.');
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content, 'utf8');
    try {
      lsp.save(root, relPath, content);
    } catch (err) {
      // a save notification must never break writing the file
    }
    return true;
  });

  ipcMain.handle('oauth:openrouter', () =>
    oauth.openrouterSignIn({
      storeKey: (provider, value) => keys.setKey(provider, value),
    })
  );

  ipcMain.handle('lsp:open', (event, projectDir, relPath, text) => {
    if (typeof projectDir !== 'string' || !projectDir.trim()) throw new Error('Missing project directory.');
    if (typeof relPath !== 'string' || !relPath.trim()) throw new Error('Missing file path.');
    if (typeof text !== 'string') throw new Error('Invalid file content.');
    return lsp.open(projectDir, relPath, text);
  });

  ipcMain.handle('lsp:change', (event, projectDir, relPath, text) => {
    if (typeof projectDir !== 'string' || !projectDir.trim()) throw new Error('Missing project directory.');
    if (typeof relPath !== 'string' || !relPath.trim()) throw new Error('Missing file path.');
    if (typeof text !== 'string') throw new Error('Invalid file content.');
    return lsp.change(projectDir, relPath, text);
  });

  ipcMain.handle('lsp:close', (event, projectDir, relPath) => {
    if (typeof projectDir !== 'string' || !projectDir.trim()) throw new Error('Missing project directory.');
    if (typeof relPath !== 'string' || !relPath.trim()) throw new Error('Missing file path.');
    return lsp.close(projectDir, relPath);
  });
}

function createWindow() {
  const size = windowSize();
  win = new BrowserWindow({
    width: size.width,
    height: size.height,
    minWidth: Math.min(960, size.width),
    minHeight: Math.min(600, size.height),
    show: false,
    title: 'Cordoval Code',
    backgroundColor: '#F4F2FB',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  win.once('ready-to-show', () => {
    if (win && !win.isDestroyed()) win.show();
  });

  win.on('closed', () => {
    win = null;
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://')) event.preventDefault();
  });

  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
}

app.whenReady().then(() => {
  setTimeout(() => {
    const st = { ...DEFAULT_SETTINGS, ...readSettings() };
    if (st.updatesEnabled && st.updateFeed) updater.check(st).catch(() => {});
  }, 15000);
  // The local engine only trusts same-origin callers; the UI is loaded from file://,
  // so present the engine's own origin on requests to the loopback engine.
  session.defaultSession.webRequest.onBeforeSendHeaders(
    { urls: ['http://127.0.0.1/*', 'ws://127.0.0.1/*', 'http://127.0.0.1:*/*', 'ws://127.0.0.1:*/*'] },
    (details, callback) => {
      try {
        const u = new URL(details.url);
        details.requestHeaders.Origin = 'http://' + u.host;
      } catch (err) {}
      callback({ requestHeaders: details.requestHeaders });
    }
  );
  registerIpc();
  lsp.setSender((channel, payload) => {
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
  });
  lsp.setStatusNotifier((st) => {
    if (win && !win.isDestroyed()) win.webContents.send('lsp:status', st);
  });
  createWindow();
  startEngine().catch(() => {
    // surfaced to the renderer through the engine:url channel
  });
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  engine.stop();
  lsp.stopAll();
});
