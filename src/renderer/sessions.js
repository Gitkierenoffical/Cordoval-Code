// Session history tools: search across sessions (titles and message text), export to
// Markdown, export and import as JSON (the engine's own export format). Public share stays off.
(function () {
  'use strict';
  const A = () => window.CordovalApp || {};
  const cache = {}; // sessionId -> { updated, text }
  let input, results, seq = 0, timer = null;

  function partText(p) {
    if (!p) return '';
    if (p.type === 'text' || p.type === 'reasoning') return p.text || '';
    if (p.type === 'tool') return (p.tool || '') + ' ' + JSON.stringify((p.state && p.state.input) || {});
    if (p.type === 'file') return p.filename || '';
    return '';
  }

  async function sessionText(s) {
    const updated = (s.time && s.time.updated) || 0;
    const c = cache[s.id];
    if (c && c.updated === updated) return c.text;
    let msgs = [];
    try { msgs = await window.Api.getMessages(s.id); } catch (e) { msgs = []; }
    const text = (Array.isArray(msgs) ? msgs : []).map((m) => (m.parts || []).map(partText).join('\n')).join('\n');
    cache[s.id] = { updated, text };
    return text;
  }

  async function sessions() {
    try { const l = await window.Api.listSessions(); return Array.isArray(l) ? l : []; } catch (e) { return []; }
  }

  function snippet(text, q) {
    const i = text.toLowerCase().indexOf(q);
    if (i < 0) return '';
    const a = Math.max(0, i - 40), b = Math.min(text.length, i + q.length + 60);
    return (a ? '...' : '') + text.slice(a, b).replace(/\s+/g, ' ') + (b < text.length ? '...' : '');
  }

  function filterTitles(q) {
    for (const item of document.querySelectorAll('#session-list .session-item')) {
      const t = (item.textContent || '').toLowerCase();
      item.classList.toggle('is-filtered', !!q && !t.includes(q));
    }
  }

  async function search() {
    const q = input.value.trim().toLowerCase();
    filterTitles(q);
    results.textContent = '';
    results.hidden = q.length < 2;
    if (q.length < 2) return;
    const mine = ++seq;
    const head = document.createElement('div'); head.className = 'session-results-head'; head.textContent = 'Searching messages...';
    results.appendChild(head);
    const list = await sessions();
    const hits = [];
    for (const s of list) {
      const title = String(s.title || '');
      const text = await sessionText(s);
      if (mine !== seq) return;
      const inTitle = title.toLowerCase().includes(q);
      const snip = snippet(text, q);
      if (inTitle || snip) hits.push({ s, snip: snip || title });
    }
    if (mine !== seq) return;
    head.textContent = hits.length ? hits.length + (hits.length === 1 ? ' session matches' : ' sessions match') : 'No sessions match';
    for (const h of hits.slice(0, 50)) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'session-result';
      const t = document.createElement('div'); t.className = 'session-result-title'; t.textContent = h.s.title || h.s.id; row.appendChild(t);
      const sn = document.createElement('div'); sn.className = 'session-result-snippet'; sn.textContent = h.snip; row.appendChild(sn);
      row.addEventListener('click', () => { A().selectSession(h.s.id); });
      results.appendChild(row);
    }
  }

  function mount() {
    const list = document.getElementById('session-list');
    if (!list || document.getElementById('session-search')) return;
    const wrap = document.createElement('div');
    wrap.className = 'session-tools';
    input = document.createElement('input');
    input.type = 'search';
    input.className = 'input session-search';
    input.id = 'session-search';
    input.placeholder = 'Search sessions';
    input.setAttribute('autocomplete', 'off');
    input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(search, 200); });
    input.addEventListener('keydown', (e) => { if (e.key === 'Escape') { input.value = ''; search(); } });
    const menu = document.createElement('div');
    menu.className = 'session-tool-buttons';
    for (const [label, fn, id] of [['Export .md', exportMarkdown, 'btn-session-export-md'], ['Export', exportJson, 'btn-session-export-json'], ['Import', importJson, 'btn-session-import']]) {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'btn btn-ghost btn-sm'; b.textContent = label; b.id = id; b.addEventListener('click', fn); menu.appendChild(b);
    }
    wrap.appendChild(input);
    wrap.appendChild(menu);
    results = document.createElement('div');
    results.className = 'session-results';
    results.id = 'session-results';
    results.hidden = true;
    list.parentNode.insertBefore(wrap, list);
    list.parentNode.insertBefore(results, list);
    new MutationObserver(() => { if (input.value) filterTitles(input.value.trim().toLowerCase()); }).observe(list, { childList: true });
  }

  // ---------- export ----------
  function fence(text) { const m = String(text).match(/`{3,}/g); const n = m ? Math.max(...m.map((x) => x.length)) + 1 : 3; return '`'.repeat(n); }
  function toMarkdown(session, msgs) {
    const out = ['# ' + (session.title || 'Session'), '', '- Session: ' + session.id, '- Project: ' + (session.directory || ''), '- Exported: ' + new Date().toISOString(), ''];
    for (const m of msgs) {
      const info = m.info || {};
      const who = info.role === 'user' ? 'User' : 'Assistant' + (info.modelID ? ' (' + (info.providerID ? info.providerID + '/' : '') + info.modelID + ')' : '');
      out.push('## ' + who, '');
      for (const p of m.parts || []) {
        if (p.type === 'text' && !p.synthetic && p.text) out.push(p.text, '');
        else if (p.type === 'reasoning' && p.text) out.push('> ' + p.text.split('\n').join('\n> '), '');
        else if (p.type === 'file') out.push('Attachment: ' + (p.filename || p.mime || 'file'), '');
        else if (p.type === 'tool') {
          const st = p.state || {};
          out.push('**Tool: ' + p.tool + '** (' + (st.status || '') + ')', '');
          const input = JSON.stringify(st.input || {}, null, 2);
          const f1 = fence(input); out.push(f1 + 'json', input, f1, '');
          if (st.output) { const o = String(st.output).slice(0, 4000); const f2 = fence(o); out.push(f2, o, f2, ''); }
        }
      }
    }
    return out.join('\n');
  }
  function slug(s) { return (String(s || 'session').replace(/[^A-Za-z0-9 _-]+/g, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'session'); }

  async function current() {
    const id = A().sessionId && A().sessionId();
    if (!id) { A().toast && A().toast('Open a session first.', 'error'); return null; }
    const list = await sessions();
    return list.find((s) => s.id === id) || { id, title: id };
  }
  async function exportMarkdown() {
    const s = await current(); if (!s) return;
    const msgs = await window.Api.getMessages(s.id);
    const path = await window.cordoval.saveFileAs(slug(s.title) + '.md', toMarkdown(s, msgs || []));
    if (path) A().toast('Exported to ' + path);
    return path;
  }
  async function exportJson() {
    const s = await current(); if (!s) return;
    try {
      const json = await window.cordoval.exportSessionJson(s.id, A().directory());
      const path = await window.cordoval.saveFileAs(slug(s.title) + '.json', json);
      if (path) A().toast('Exported to ' + path);
      return path;
    } catch (e) { A().toast('Export failed: ' + (e.message || e), 'error'); }
  }
  async function importJson() {
    if (!A().directory()) { A().toast('Open a project first.', 'error'); return; }
    try {
      const r = await window.cordoval.importSessionJson(A().directory());
      if (!r) return;
      await A().refreshSessions();
      await A().selectSession(r.id).catch(() => {});
      A().toast('Imported "' + (r.title || r.id) + '".');
      return r;
    } catch (e) { A().toast('Import failed: ' + (e.message || e), 'error'); }
  }

  document.addEventListener('DOMContentLoaded', mount);
  window.SessionsUI = { focusSearch: () => { mount(); input.focus(); input.select(); }, exportMarkdown, exportJson, importJson, toMarkdown, search };
})();
