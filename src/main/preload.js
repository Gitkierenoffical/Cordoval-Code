'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('cordoval', {
  engineUrl: () => ipcRenderer.invoke('engine:url'),
  pickFolder: () => ipcRenderer.invoke('dialog:pickFolder'),
  getKeys: () => ipcRenderer.invoke('keys:get'),
  setKey: (provider, value) => ipcRenderer.invoke('keys:set', provider, value),
  deleteKey: provider => ipcRenderer.invoke('keys:delete', provider),
  setCustom: list => ipcRenderer.invoke('keys:setCustom', list),
  getEngineConfig: () => ipcRenderer.invoke('econfig:get'),
  engineConfigPath: () => ipcRenderer.invoke('econfig:path'),
  setEngineConfig: (obj) => ipcRenderer.invoke('econfig:set', obj),
  listProjectFiles: (dir, kind) => ipcRenderer.invoke('eproject:list', dir, kind),
  writeProjectFile: (dir, kind, name, content) => ipcRenderer.invoke('eproject:write', dir, kind, name, content),
  deleteProjectFile: (dir, kind, name) => ipcRenderer.invoke('eproject:delete', dir, kind, name),
  checkForUpdates: () => ipcRenderer.invoke('update:check'),
  downloadUpdate: () => ipcRenderer.invoke('update:download'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  appVersion: () => ipcRenderer.invoke('app:version'),
  onUpdateStatus: (cb) => ipcRenderer.on('update:status', (e, st) => cb(st)),
  keyStorage: () => ipcRenderer.invoke('keys:storage'),
  getCustom: () => ipcRenderer.invoke('keys:getCustom'),
  restartEngine: () => ipcRenderer.invoke('engine:restart'),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: obj => ipcRenderer.invoke('settings:set', obj),
  templates: () => ipcRenderer.invoke('templates:list'),
  scaffold: (templateId, parentDir, name) => ipcRenderer.invoke('scaffold:create', templateId, parentDir, name),
  writeFile: (projectDir, relPath, content) => ipcRenderer.invoke('file:write', projectDir, relPath, content),
  initialProject: () => ipcRenderer.invoke('app:initialProject'),
  openrouterSignIn: () => ipcRenderer.invoke('oauth:openrouter'),
  onLspStatus: (cb) => ipcRenderer.on('lsp:status', (e, st) => cb(st)),
  lspOpen: (projectDir, relPath, text) => ipcRenderer.invoke('lsp:open', projectDir, relPath, text),
  lspChange: (projectDir, relPath, text) => ipcRenderer.invoke('lsp:change', projectDir, relPath, text),
  lspClose: (projectDir, relPath) => ipcRenderer.invoke('lsp:close', projectDir, relPath),
  onLspDiagnostics: cb => {
    if (typeof cb !== 'function') return () => {};
    const listener = (event, data) => {
      cb(data);
    };
    ipcRenderer.on('lsp:diagnostics', listener);
    return () => ipcRenderer.removeListener('lsp:diagnostics', listener);
  },
});
