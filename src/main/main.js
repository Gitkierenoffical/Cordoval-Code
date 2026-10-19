'use strict';

const fs = require('fs');
const path = require('path');
const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');

const engine = require('./engine');
const keys = require('./keys');
const oauth = require('./oauth');

let win = null;
let enginePromise = null;

const DEFAULT_SETTINGS = { theme: 'light' };

function userDataFile(name) {
  return path.join(app.getPath('userData'), name);
}

function startEngine() {
  if (enginePromise) return enginePromise;
  const run = engine
    .start({ userData: app.getPath('userData'), keys: keys.readAll() })
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
  const template = templates.find(t => t.id === templateId) || null;
  return { path: target, template };
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

  ipcMain.handle('oauth:openrouter', () =>
    oauth.openrouterSignIn({
      storeKey: (provider, value) => keys.setKey(provider, value),
    })
  );
}

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
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
  registerIpc();
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
});
