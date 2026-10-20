// @-mentions in the composer: autocomplete files and agents, then turn them into parts
// the engine understands (file parts for files and folders, agent parts for subagents).
(function () {
  'use strict';
  const A = () => window.CordovalApp || {};
  let menu, input, items = [], index = 0, tokenStart = -1, seq = 0;
  const known = { files: new Set(), agents: new Set() };

  function tokenAtCaret() {
    const pos = input.selectionStart;
    const before = input.value.slice(0, pos);
    const m = before.match(/(^|\s)@([^\s@]*)$/);
    if (!m) return null;
    return { start: pos - m[2].length - 1, query: m[2] };
  }

  async function agents() {
    try {
      const l = await window.Api.request('/agent');
      return (Array.isArray(l) ? l : []).filter((a) => a && a.name && !a.hidden && a.mode !== 'primary' && !['compaction', 'summary', 'title'].includes(a.name));
    } catch (e) { return []; }
  }

  async function update() {
    const t = tokenAtCaret();
    if (!t) return close();
    tokenStart = t.start;
    const mine = ++seq;
    const q = t.query.toLowerCase();
    const [files, ags] = await Promise.all([window.Api.findFiles(t.query).catch(() => []), agents()]);
    if (mine !== seq) return;
    const agentItems = ags.filter((a) => a.name.toLowerCase().includes(q)).map((a) => ({ kind: 'agent', value: a.name, detail: a.description || 'Agent' }));
    const fileItems = (Array.isArray(files) ? files : []).slice(0, 30).map((f) => ({ kind: String(f).endsWith('/') ? 'folder' : 'file', value: String(f), detail: '' }));
    items = agentItems.concat(fileItems).slice(0, 40);
    index = 0;
    render();
  }

  function render() {
    if (!items.length) return close();
    menu.textContent = '';
    items.forEach((it, i) => {
      const row = document.createElement('div');
      row.className = 'mention-item' + (i === index ? ' is-active' : '');
      const k = document.createElement('span'); k.className = 'mention-kind mention-' + it.kind; k.textContent = it.kind === 'agent' ? 'Agent' : it.kind === 'folder' ? 'Folder' : 'File'; row.appendChild(k);
      const v = document.createElement('span'); v.className = 'mention-value'; v.textContent = it.value; row.appendChild(v);
      if (it.detail) { const d = document.createElement('span'); d.className = 'mention-detail'; d.textContent = it.detail; row.appendChild(d); }
      row.addEventListener('mousedown', (e) => { e.preventDefault(); pick(it); });
      menu.appendChild(row);
      if (i === index) row.scrollIntoView({ block: 'nearest' });
    });
    menu.hidden = false;
  }

  function close() { if (menu) menu.hidden = true; items = []; }
  function isOpen() { return menu && !menu.hidden && items.length > 0; }

  function pick(it) {
    const pos = input.selectionStart;
    const insert = '@' + it.value + ' ';
    input.value = input.value.slice(0, tokenStart) + insert + input.value.slice(pos);
    const caret = tokenStart + insert.length;
    input.setSelectionRange(caret, caret);
    (it.kind === 'agent' ? known.agents : known.files).add(it.value);
    close();
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.focus();
  }

  function extract(text, dir) {
    const parts = [];
    const seen = new Set();
    const re = /(^|\s)@([^\s@]+)/g;
    let m;
    while ((m = re.exec(text))) {
      const name = m[2].replace(/[.,;:!?)]+$/, '');
      if (seen.has(name)) continue;
      seen.add(name);
      const start = m.index + m[1].length;
      const source = { value: '@' + name, start, end: start + name.length + 1 };
      if (known.agents.has(name)) { parts.push({ type: 'agent', name, source }); continue; }
      if (known.files.has(name) && dir) {
        const abs = dir.replace(/\/+$/, '') + '/' + name.replace(/\/$/, '');
        const isDir = name.endsWith('/');
        parts.push({ type: 'file', mime: isDir ? 'application/x-directory' : 'text/plain', filename: name, url: 'file://' + abs, source: { type: 'file', path: abs, text: source } });
      }
    }
    return parts;
  }

  function mount() {
    input = document.getElementById('composer-input');
    if (!input) return;
    menu = document.createElement('div');
    menu.className = 'mention-menu';
    menu.id = 'mention-menu';
    menu.hidden = true;
    (input.closest('.composer') || input.parentNode).appendChild(menu);
    input.addEventListener('input', () => { update(); });
    input.addEventListener('click', () => { update(); });
    input.addEventListener('blur', () => setTimeout(close, 150));
    input.addEventListener('keydown', (e) => {
      if (!isOpen()) return;
      if (e.key === 'ArrowDown') { index = (index + 1) % items.length; render(); }
      else if (e.key === 'ArrowUp') { index = (index - 1 + items.length) % items.length; render(); }
      else if (e.key === 'Enter' || e.key === 'Tab') { pick(items[index]); }
      else if (e.key === 'Escape') { close(); }
      else return;
      e.preventDefault();
      e.stopImmediatePropagation();
    }, true);
  }

  document.addEventListener('DOMContentLoaded', mount);
  window.Mentions = { extract, isOpen, close, _known: known };
})();
