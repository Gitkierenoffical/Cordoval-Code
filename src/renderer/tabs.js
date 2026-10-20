// Multi-project tab strip in the title bar. Each tab is an open project folder; switching
// tabs re-points the UI at that folder (the engine keeps every project's sessions running).
(function () {
  'use strict';
  const KEY = 'cordoval.projectTabs';
  const A = () => window.CordovalApp || {};
  let tabs = [];
  let active = null;
  let strip;
  const busy = {}; // dir -> true while any session there is busy or retrying

  // Poll every open project's session status so background tabs show a running dot.
  async function pollBusy() {
    if (!window.Api || !window.Api.engineUrl || !window.Api.engineUrl()) return;
    let changed = false;
    for (const dir of tabs) {
      let on = false;
      try {
        const st = await window.Api.request('/session/status', { query: { directory: dir } });
        on = Object.values(st || {}).some((v) => v && (v.type === 'busy' || v.type === 'retry'));
      } catch (e) { on = !!busy[dir]; }
      if (!!busy[dir] !== on) { busy[dir] = on; changed = true; }
    }
    if (changed) render();
  }
  setInterval(pollBusy, 2500);

  function load() { try { tabs = JSON.parse(localStorage.getItem(KEY) || '[]').filter((t) => typeof t === 'string'); } catch (e) { tabs = []; } }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(tabs)); } catch (e) {} }
  function name(dir) { const p = String(dir).replace(/[\\/]+$/, '').split(/[\\/]/); return p[p.length - 1] || dir; }

  function render() {
    if (!strip) return;
    strip.textContent = '';
    tabs.forEach((dir, i) => {
      const tab = document.createElement('div');
      tab.className = 'project-tab' + (dir === active ? ' is-active' : '');
      tab.title = dir;
      tab.setAttribute('role', 'tab');
      tab.dataset.dir = dir;
      const dot = document.createElement('span'); dot.className = 'project-tab-dot' + (busy[dir] ? ' is-busy' : ''); dot.title = busy[dir] ? 'An agent is working in this project' : ''; tab.appendChild(dot);
      if (busy[dir]) tab.classList.add('is-busy');
      const label = document.createElement('span'); label.className = 'project-tab-name'; label.textContent = name(dir); tab.appendChild(label);
      const x = document.createElement('button'); x.type = 'button'; x.className = 'project-tab-close'; x.title = 'Close tab'; x.setAttribute('aria-label', 'Close ' + name(dir)); x.textContent = '\u00d7';
      x.addEventListener('click', (e) => { e.stopPropagation(); close(dir); });
      tab.appendChild(x);
      tab.addEventListener('click', () => switchTo(dir));
      tab.addEventListener('auxclick', (e) => { if (e.button === 1) close(dir); });
      strip.appendChild(tab);
    });
    const add = document.createElement('button');
    add.type = 'button'; add.className = 'project-tab-add'; add.id = 'btn-tab-new'; add.title = 'Open another project'; add.textContent = '+';
    add.addEventListener('click', newTab);
    strip.appendChild(add);
  }

  function switchTo(dir) {
    if (!dir || dir === active) return;
    A().openProject(dir).catch((e) => A().toast && A().toast(String(e.message || e), 'error'));
  }

  async function newTab() {
    const dir = await window.cordoval.pickFolder();
    if (dir) A().openProject(dir);
  }

  function close(dir) {
    const i = tabs.indexOf(dir);
    if (i < 0) return;
    tabs.splice(i, 1);
    save();
    if (dir === active) {
      const next = tabs[Math.min(i, tabs.length - 1)];
      if (next) switchTo(next);
      else render();
    } else render();
  }

  function cycle(delta) {
    if (tabs.length < 2) return;
    const i = tabs.indexOf(active);
    switchTo(tabs[(i + delta + tabs.length) % tabs.length]);
  }

  document.addEventListener('cordoval:project-changed', (e) => {
    const dir = e.detail && e.detail.directory;
    if (!dir) return;
    active = dir;
    if (!tabs.includes(dir)) { tabs.push(dir); save(); }
    render();
  });

  document.addEventListener('DOMContentLoaded', () => {
    load();
    const host = document.getElementById('titlebar-project');
    if (!host) return;
    host.textContent = '';
    strip = document.createElement('div');
    strip.className = 'project-tabs';
    strip.id = 'project-tabs';
    strip.setAttribute('role', 'tablist');
    host.after(strip);
    host.hidden = true;
    render();
  });

  window.ProjectTabs = { busy: () => Object.assign({}, busy), pollBusy, list: () => tabs.slice(), active: () => active, switchTo, close, newTab, cycle, closeActive: () => active && close(active) };
})();
