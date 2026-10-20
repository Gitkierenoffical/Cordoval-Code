'use strict';
// Optional auto-update via electron-updater using a user-configured "generic" feed URL.
// Off by default: nothing is contacted unless the user enables updates and sets a feed.
const { app } = require('electron');

let autoUpdater = null;
let lastStatus = { state: 'idle', message: 'Updates are off.' };
let sendStatus = () => {};

function load() {
  if (autoUpdater) return autoUpdater;
  autoUpdater = require('electron-updater').autoUpdater;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = null;
  const set = (s) => { lastStatus = s; sendStatus(s); };
  autoUpdater.on('checking-for-update', () => set({ state: 'checking', message: 'Checking for updates...' }));
  autoUpdater.on('update-available', (i) => set({ state: 'available', version: i.version, message: 'Version ' + i.version + ' is available.' }));
  autoUpdater.on('update-not-available', () => set({ state: 'none', message: 'You are on the latest version (' + app.getVersion() + ').' }));
  autoUpdater.on('download-progress', (p) => set({ state: 'downloading', percent: Math.round(p.percent), message: 'Downloading ' + Math.round(p.percent) + '%' }));
  autoUpdater.on('update-downloaded', (i) => set({ state: 'downloaded', version: i.version, message: 'Version ' + i.version + ' is ready. Restart to install.' }));
  autoUpdater.on('error', (e) => set({ state: 'error', message: 'Update error: ' + (e && e.message ? e.message.split('\n')[0] : 'unknown') }));
  return autoUpdater;
}

function validFeed(url) {
  try { const u = new URL(String(url)); return u.protocol === 'https:' || (u.protocol === 'http:' && /^(127\.0\.0\.1|localhost)$/.test(u.hostname)); } catch (e) { return false; }
}

async function check(settings) {
  if (!settings || !settings.updatesEnabled) return (lastStatus = { state: 'off', message: 'Updates are off. Turn them on in Settings.' });
  if (!validFeed(settings.updateFeed)) return (lastStatus = { state: 'error', message: 'Set an https update feed URL first.' });
  if (!app.isPackaged) return (lastStatus = { state: 'error', message: 'Updates only work in installed builds.' });
  const u = load();
  u.setFeedURL({ provider: 'generic', url: settings.updateFeed });
  await u.checkForUpdates().catch(() => {});
  return lastStatus;
}

async function download() { if (!autoUpdater) return lastStatus; await autoUpdater.downloadUpdate().catch(() => {}); return lastStatus; }
function install() { if (autoUpdater) autoUpdater.quitAndInstall(); }
function status() { return lastStatus; }
function onStatus(fn) { sendStatus = fn; }

module.exports = { check, download, install, status, onStatus, validFeed };
