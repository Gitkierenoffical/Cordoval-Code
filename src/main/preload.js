'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('cordoval', {
  engineUrl: () => ipcRenderer.invoke('engine:url'),
  pickFolder: () => ipcRenderer.invoke('dialog:pickFolder'),
  getKeys: () => ipcRenderer.invoke('keys:get'),
  setKey: (provider, value) => ipcRenderer.invoke('keys:set', provider, value),
  deleteKey: provider => ipcRenderer.invoke('keys:delete', provider),
  setCustom: list => ipcRenderer.invoke('keys:setCustom', list),
  getCustom: () => ipcRenderer.invoke('keys:getCustom'),
  restartEngine: () => ipcRenderer.invoke('engine:restart'),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: obj => ipcRenderer.invoke('settings:set', obj),
  templates: () => ipcRenderer.invoke('templates:list'),
  scaffold: (templateId, parentDir, name) => ipcRenderer.invoke('scaffold:create', templateId, parentDir, name),
  initialProject: () => ipcRenderer.invoke('app:initialProject'),
  openrouterSignIn: () => ipcRenderer.invoke('oauth:openrouter'),
});
