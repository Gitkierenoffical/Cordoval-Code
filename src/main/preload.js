'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('cordoval', {
  engineUrl: () => ipcRenderer.invoke('engine:url'),
  pickFolder: () => ipcRenderer.invoke('dialog:pickFolder'),
  getKeys: () => ipcRenderer.invoke('keys:get'),
  setKey: (provider, value) => ipcRenderer.invoke('keys:set', provider, value),
  deleteKey: provider => ipcRenderer.invoke('keys:delete', provider),
  setCustom: list => ipcRenderer.invoke('keys:setCustom', list),
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
