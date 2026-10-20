'use strict';
// Settings > Updates panel.
(function () {
  function $(id) { return document.getElementById(id); }
  function show(st) {
    if (!st) return;
    $('update-status').textContent = st.message || '';
    $('btn-update-download').hidden = st.state !== 'available';
    $('btn-update-install').hidden = st.state !== 'downloaded';
  }
  async function load() {
    const c = window.cordoval;
    if (!c || !c.getSettings) return;
    const s = await c.getSettings();
    $('updates-enabled').checked = !!s.updatesEnabled;
    $('update-feed').value = s.updateFeed || '';
    $('app-version').textContent = await c.appVersion();
  }
  async function save() {
    const feed = $('update-feed').value.trim();
    await window.cordoval.setSettings({ updatesEnabled: $('updates-enabled').checked, updateFeed: feed });
    $('update-status').textContent = 'Saved.';
  }
  document.addEventListener('DOMContentLoaded', function () {
    if (!$('settings-updates') || !window.cordoval) return;
    load().catch(function () {});
    $('btn-update-save').addEventListener('click', function () { save().catch(function (e) { $('update-status').textContent = e.message; }); });
    $('btn-update-check').addEventListener('click', async function () {
      await save();
      $('update-status').textContent = 'Checking...';
      show(await window.cordoval.checkForUpdates());
    });
    $('btn-update-download').addEventListener('click', async function () { show(await window.cordoval.downloadUpdate()); });
    $('btn-update-install').addEventListener('click', function () { window.cordoval.installUpdate(); });
    window.cordoval.onUpdateStatus(show);
  });
})();
