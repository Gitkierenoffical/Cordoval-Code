// Per-line review comments on the diff. Comments are kept per session and sent to the agent
// as one message that quotes each line, like a code review.
(function () {
  'use strict';
  const A = () => window.CordovalApp || {};
  // Kept in localStorage per session so comments survive restarts.
  const KEY = 'cordoval.review.';
  const store = {}; // sessionId -> [{ id, file, line, side, code, text }]
  let seq = Date.now();

  function persist(id) {
    try {
      const l = store[id] || [];
      if (l.length) localStorage.setItem(KEY + id, JSON.stringify(l)); else localStorage.removeItem(KEY + id);
    } catch (e) {}
  }
  function list() {
    const id = A().sessionId && A().sessionId();
    if (!id) return [];
    if (!store[id]) {
      let saved = [];
      try { saved = JSON.parse(localStorage.getItem(KEY + id) || '[]'); } catch (e) { saved = []; }
      const arr = Array.isArray(saved) ? saved : [];
      // Any change to the array (push, splice, length = 0) is written straight back.
      store[id] = new Proxy(arr, { set(t, k, v) { t[k] = v; persist(id); return true; }, deleteProperty(t, k) { delete t[k]; persist(id); return true; } });
    }
    return store[id];
  }
  function keyOf(file, line, side) { return file + ':' + side + ':' + line; }

  function decorate(row, file, line, side, code) {
    row.dataset.file = file; row.dataset.line = String(line); row.dataset.side = side;
    row.dataset.code = code.slice(1);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'diff-comment-btn';
    btn.title = 'Comment on line ' + line;
    btn.textContent = '+';
    btn.addEventListener('click', (e) => { e.stopPropagation(); openEditor(row); });
    row.prepend(btn);
  }

  function threadFor(row) {
    const n = row.nextElementSibling;
    return n && n.classList.contains('diff-thread') ? n : null;
  }

  function renderThread(body, file, row) {
    if (!row.dataset || !row.dataset.line) return;
    const k = keyOf(file, row.dataset.line, row.dataset.side);
    const items = list().filter((c) => keyOf(c.file, c.line, c.side) === k);
    if (!items.length) return;
    const t = document.createElement('div');
    t.className = 'diff-thread';
    for (const c of items) {
      const card = document.createElement('div');
      card.className = 'diff-comment';
      const txt = document.createElement('div'); txt.className = 'diff-comment-text'; txt.textContent = c.text; card.appendChild(txt);
      const del = document.createElement('button'); del.type = 'button'; del.className = 'btn btn-ghost btn-sm'; del.textContent = 'Delete';
      del.addEventListener('click', () => { const l = list(); l.splice(l.indexOf(c), 1); t.remove(); renderBar(); });
      card.appendChild(del);
      t.appendChild(card);
    }
    body.appendChild(t);
  }

  function openEditor(row) {
    const existing = row.parentNode.querySelector('.diff-comment-editor');
    if (existing) existing.remove();
    const box = document.createElement('div');
    box.className = 'diff-comment-editor';
    const ta = document.createElement('textarea');
    ta.className = 'input'; ta.rows = 3; ta.placeholder = 'Comment on ' + row.dataset.file + ' line ' + row.dataset.line;
    const actions = document.createElement('div'); actions.className = 'diff-comment-actions';
    const save = document.createElement('button'); save.type = 'button'; save.className = 'btn btn-primary btn-sm'; save.textContent = 'Add comment';
    const cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'btn btn-ghost btn-sm'; cancel.textContent = 'Cancel';
    actions.appendChild(save); actions.appendChild(cancel);
    box.appendChild(ta); box.appendChild(actions);
    const anchor = threadFor(row) || row;
    anchor.after(box);
    ta.focus();
    const commit = () => {
      const text = ta.value.trim();
      if (!text) return box.remove();
      list().push({ id: ++seq, file: row.dataset.file, line: Number(row.dataset.line), side: row.dataset.side, code: row.dataset.code, text });
      box.remove();
      if (A().refreshChanges) A().refreshChanges(); else renderBar();
    };
    save.addEventListener('click', commit);
    cancel.addEventListener('click', () => box.remove());
    ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); commit(); } if (e.key === 'Escape') box.remove(); });
  }

  function message() {
    const items = list().slice().sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
    const out = ['Please address these review comments on your changes:', ''];
    for (const c of items) {
      out.push('- ' + c.file + ' line ' + c.line + (c.side === 'old' ? ' (removed line)' : '') + ': `' + c.code.trim().slice(0, 160).replace(/`/g, "'") + '`');
      out.push('  ' + c.text.replace(/\n/g, '\n  '));
    }
    return out.join('\n');
  }

  function renderBar() {
    const view = document.getElementById('view-changes');
    if (!view) return;
    let bar = document.getElementById('review-bar');
    if (!bar) {
      bar = document.createElement('div'); bar.id = 'review-bar'; bar.className = 'review-bar';
      const label = document.createElement('span'); label.id = 'review-count'; bar.appendChild(label);
      const clear = document.createElement('button'); clear.type = 'button'; clear.className = 'btn btn-ghost btn-sm'; clear.textContent = 'Clear';
      clear.addEventListener('click', () => { list().length = 0; if (A().refreshChanges) A().refreshChanges(); renderBar(); });
      const send = document.createElement('button'); send.type = 'button'; send.className = 'btn btn-primary btn-sm'; send.id = 'btn-review-send'; send.textContent = 'Send to agent';
      send.addEventListener('click', sendAll);
      bar.appendChild(clear); bar.appendChild(send);
      view.prepend(bar);
    }
    const n = list().length;
    bar.hidden = n === 0;
    document.getElementById('review-count').textContent = n + (n === 1 ? ' review comment' : ' review comments');
  }

  async function sendAll() {
    if (!list().length) return;
    const text = message();
    list().length = 0;
    renderBar();
    await A().sendText(text);
    if (A().refreshChanges) A().refreshChanges();
  }

  document.addEventListener('cordoval:changes-rendered', renderBar);
  window.ReviewComments = { decorate, renderThread, list, message, sendAll, renderBar };
})();
