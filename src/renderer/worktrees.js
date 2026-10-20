'use strict';
// Git worktree workspaces, backed by the engine's /experimental/worktree API (same as OpenCode).
(function () {
  const ROOTS_KEY = 'cordoval:worktree-roots';
  let busy = false;

  function roots() {
    try { return JSON.parse(localStorage.getItem(ROOTS_KEY) || '{}'); } catch (e) { return {}; }
  }
  function saveRoots(map) { localStorage.setItem(ROOTS_KEY, JSON.stringify(map)); }
  function rootOf(dir) { return roots()[dir] || dir; }
  function base(dir) { return String(dir).split(/[\\/]/).filter(Boolean).pop() || dir; }

  async function call(method, root, body) {
    const url = window.Api.engineUrl() + '/experimental/worktree?directory=' + encodeURIComponent(root);
    const res = await fetch(url, {
      method: method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(function () { return null; });
    if (!res.ok) throw new Error((data && data.data && data.data.message) || ('Worktree request failed (' + res.status + ')'));
    return data;
  }

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  async function render() {
    const host = document.getElementById('worktree-list');
    if (!host || !window.CordovalApp) return;
    const current = window.CordovalApp.directory();
    host.innerHTML = '';
    if (!current) return;
    const root = rootOf(current);
    let list = [];
    try { list = await call('GET', root); } catch (e) { list = []; }
    const rows = [{ dir: root, label: base(root), main: true }].concat(
      (Array.isArray(list) ? list : []).filter(function (d) { return d !== root; }).map(function (d) { return { dir: d, label: base(d), main: false }; })
    );
    const map = roots();
    for (const row of rows) {
      if (!row.main) map[row.dir] = root;
      const item = el('div', 'worktree-item' + (row.dir === current ? ' is-active' : ''));
      item.dataset.dir = row.dir;
      item.title = row.dir;
      item.appendChild(el('span', 'worktree-name', row.main ? row.label + ' (main)' : row.label));
      if (!row.main) {
        const actions = el('span', 'worktree-actions');
        const reset = el('button', 'btn btn-ghost btn-xs', 'Reset');
        reset.type = 'button';
        reset.title = 'Reset this worktree to the main branch';
        reset.addEventListener('click', function (ev) { ev.stopPropagation(); act('reset', root, row.dir); });
        const remove = el('button', 'btn btn-ghost btn-xs worktree-remove', 'Remove');
        remove.type = 'button';
        remove.title = 'Remove this worktree and delete its branch';
        remove.addEventListener('click', function (ev) { ev.stopPropagation(); act('remove', root, row.dir); });
        actions.appendChild(reset);
        actions.appendChild(remove);
        item.appendChild(actions);
      }
      item.addEventListener('click', function () {
        if (row.dir !== window.CordovalApp.directory()) window.CordovalApp.openProject(row.dir);
      });
      host.appendChild(item);
    }
    saveRoots(map);
  }

  async function act(kind, root, dir) {
    if (busy) return;
    if (kind === 'remove' && !window.confirm('Remove worktree ' + base(dir) + ' and delete its branch?')) return;
    busy = true;
    try {
      if (kind === 'remove') {
        await call('DELETE', root, { directory: dir });
        if (window.CordovalApp.directory() === dir) await window.CordovalApp.openProject(root);
        window.CordovalApp.toast('Worktree removed.');
      } else {
        const url = window.Api.engineUrl() + '/experimental/worktree/reset?directory=' + encodeURIComponent(root);
        const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ directory: dir }) });
        if (!res.ok) throw new Error('Reset failed (' + res.status + ')');
        window.CordovalApp.toast('Worktree reset.');
      }
    } catch (e) {
      window.CordovalApp.toast(e.message || String(e), 'error');
    } finally {
      busy = false;
      render();
    }
  }

  async function create() {
    const current = window.CordovalApp && window.CordovalApp.directory();
    if (!current || busy) return;
    const root = rootOf(current);
    busy = true;
    try {
      const wt = await call('POST', root, {});
      const map = roots(); map[wt.directory] = root; saveRoots(map);
      window.CordovalApp.toast('Created worktree ' + (wt.branch || wt.name) + '.');
      await window.CordovalApp.openProject(wt.directory);
    } catch (e) {
      window.CordovalApp.toast(e.message || String(e), 'error');
    } finally {
      busy = false;
      render();
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    const btn = document.getElementById('btn-new-worktree');
    if (btn) btn.addEventListener('click', create);
  });
  document.addEventListener('cordoval:project-opened', function () { setTimeout(render, 300); });
  window.Worktrees = { render: render, create: create };
})();
