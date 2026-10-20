// Command palette (Ctrl+K / Ctrl+Shift+P) and global keyboard shortcuts, following
// OpenCode desktop's default keybinds where they apply to Cordoval Code.
(function () {
  'use strict';
  const isMac = /Mac/.test(navigator.platform);
  const MOD = isMac ? 'Cmd' : 'Ctrl';
  const A = () => window.CordovalApp || {};
  const click = (id) => () => { const el = document.getElementById(id); if (el && !el.hidden && !el.disabled) el.click(); };
  const focusComposer = () => { const el = document.getElementById('composer-input'); if (el) el.focus(); };

  function cycleAgent() {
    const list = Array.from(document.querySelectorAll('.agent-toggle .agent-btn')).map((b) => b.dataset.agent);
    const i = list.indexOf(A().agent());
    A().setAgentMode(list[(i + 1) % list.length] || 'build');
  }
  function moveSession(delta) {
    const items = Array.from(document.querySelectorAll('.session-item'));
    if (!items.length) return;
    const idx = items.findIndex((el) => el.classList.contains('is-active'));
    const next = items[Math.max(0, Math.min(items.length - 1, (idx < 0 ? 0 : idx + delta)))];
    if (next) next.click();
  }
  function jumpMessage(delta) {
    const list = Array.from(document.querySelectorAll('.message-user'));
    if (!list.length) return;
    const host = list[0].closest('.messages, #messages') || document.scrollingElement;
    const top = host.getBoundingClientRect ? host.getBoundingClientRect().top : 0;
    let i = list.findIndex((el) => el.getBoundingClientRect().top - top > 8);
    if (i < 0) i = list.length;
    const target = list[Math.max(0, Math.min(list.length - 1, delta > 0 ? i : i - 2))];
    target.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  // keys: lowercase, 'mod' = Ctrl (Cmd on macOS).
  const COMMANDS = [
    { id: 'palette.open', title: 'Command palette', keys: ['mod+k', 'mod+shift+p'], group: 'General', run: () => open() },
    { id: 'help.shortcuts', title: 'Keyboard shortcuts', keys: ['mod+/'], group: 'General', run: () => openHelp() },
    { id: 'settings.open', title: 'Open settings', keys: ['mod+,'], group: 'General', run: () => A().openSettings() },
    { id: 'customise.open', title: 'MCP servers, agents, commands and permissions', keys: ['mod+;'], group: 'General', run: () => window.Customize && window.Customize.open('mcp') },
    { id: 'theme.toggle', title: 'Toggle light or dark mode', keys: [], group: 'General', run: () => A().toggleTheme() },
    { id: 'theme.pick', title: 'Choose colour theme', keys: [], group: 'General', run: () => pickTheme() },
    { id: 'project.open', title: 'Open project folder', keys: ['mod+o', 'mod+shift+o'], group: 'Project', run: click('btn-switch-project') },
    { id: 'project.template', title: 'New project from template', keys: [], group: 'Project', run: click('btn-welcome-template') },
    { id: 'session.new', title: 'New session', keys: ['mod+shift+s', 'mod+n'], group: 'Session', run: () => A().newSession() },
    { id: 'session.prev', title: 'Previous session', keys: ['alt+arrowup'], group: 'Session', run: () => moveSession(-1) },
    { id: 'session.next', title: 'Next session', keys: ['alt+arrowdown'], group: 'Session', run: () => moveSession(1) },
    { id: 'session.search', title: 'Search sessions', keys: ['mod+shift+f'], group: 'Session', run: () => window.SessionsUI && window.SessionsUI.focusSearch() },
    { id: 'session.export', title: 'Export session to Markdown', keys: [], group: 'Session', run: () => window.SessionsUI && window.SessionsUI.exportMarkdown() },
    { id: 'session.exportJson', title: 'Export session (JSON)', keys: [], group: 'Session', run: () => window.SessionsUI && window.SessionsUI.exportJson() },
    { id: 'session.import', title: 'Import session (JSON)', keys: [], group: 'Session', run: () => window.SessionsUI && window.SessionsUI.importJson() },
    { id: 'session.stop', title: 'Stop the agent', keys: ['escape escape'], group: 'Session', run: click('btn-stop') },
    { id: 'session.undo', title: 'Undo last message', keys: ['mod+z'], group: 'Session', run: () => A().undo(), notInInput: true },
    { id: 'session.redo', title: 'Redo', keys: ['mod+shift+z'], group: 'Session', run: () => A().redo(), notInInput: true },
    { id: 'session.compact', title: 'Compact session', keys: [], group: 'Session', run: () => A().compact() },
    { id: 'session.init', title: 'Create or update AGENTS.md', keys: [], group: 'Session', run: () => A().init() },
    { id: 'message.prev', title: 'Previous message', keys: ['mod+alt+['], group: 'Session', run: () => jumpMessage(-1) },
    { id: 'message.next', title: 'Next message', keys: ['mod+alt+]'], group: 'Session', run: () => jumpMessage(1) },
    { id: 'input.focus', title: 'Focus the message box', keys: ['ctrl+l'], group: 'Composer', run: focusComposer },
    { id: 'agent.cycle', title: 'Switch between Build and Plan', keys: ['mod+.', 'tab'], group: 'Composer', run: cycleAgent, tabOnlyInComposerEmpty: true },
    { id: 'model.choose', title: 'Choose model', keys: ["mod+'"], group: 'Composer', run: () => A().openModelPicker() },
    { id: 'model.variant.cycle', title: 'Cycle reasoning effort', keys: ['mod+shift+d'], group: 'Composer', run: () => { const s = document.getElementById('variant-picker'); if (!s || document.getElementById('variant-wrap').hidden) return; s.selectedIndex = (s.selectedIndex + 1) % s.options.length; s.dispatchEvent(new Event('change')); A().toast(s.options[s.selectedIndex].textContent); } },
    { id: 'file.attach', title: 'Attach file or image', keys: ['mod+u'], group: 'Composer', run: click('btn-attach') },
    { id: 'slash.help', title: 'List slash commands', keys: [], group: 'Composer', run: () => A().openSlashHelp() },
    { id: 'file.open', title: 'Go to file', keys: ['mod+p'], group: 'Files', run: () => openFilePicker() },
    { id: 'tree.toggle', title: 'Show files panel', keys: ['mod+\\'], group: 'Files', run: () => A().switchRightTab('files') },
    { id: 'review.toggle', title: 'Show changes (review)', keys: ['mod+shift+r'], group: 'Files', run: () => A().switchRightTab('changes') },
    { id: 'search.open', title: 'Search in project', keys: ['mod+shift+h'], group: 'Files', run: () => { A().switchRightTab('search'); const i = document.getElementById('search-input'); if (i) i.focus(); } },
    { id: 'diagnostics.open', title: 'Show diagnostics', keys: ['mod+shift+m'], group: 'Files', run: () => A().switchRightTab('diagnostics') },
    { id: 'terminal.toggle', title: 'Toggle terminal', keys: ['ctrl+`'], group: 'Files', run: () => A().toggleTerminal() },
  ];

  function fmt(k) {
    return k.split(' ').map((chord) => chord.split('+').map((p) => ({ mod: MOD, shift: 'Shift', alt: isMac ? 'Option' : 'Alt', ctrl: 'Ctrl', arrowup: 'Up', arrowdown: 'Down', escape: 'Esc', tab: 'Tab' }[p] || (p.length === 1 ? p.toUpperCase() : p))).join('+')).join(' then ');
  }

  function chordOf(e) {
    const parts = [];
    const mod = isMac ? e.metaKey : e.ctrlKey;
    if (mod) parts.push('mod');
    if (isMac && e.ctrlKey) parts.push('ctrl');
    if (e.altKey) parts.push('alt');
    if (e.shiftKey) parts.push('shift');
    let k = e.key.toLowerCase();
    if (e.code === 'Backquote') k = '`';
    if (e.code === 'Backslash') k = '\\';
    if (e.code === 'BracketLeft') k = '[';
    if (e.code === 'BracketRight') k = ']';
    if (e.code === 'Comma') k = ',';
    if (e.code === 'Period') k = '.';
    if (e.code === 'Slash') k = '/';
    if (e.code === 'Quote') k = "'";
    if (e.code === 'Semicolon') k = ';';
    if (/^Key[A-Z]$/.test(e.code)) k = e.code.slice(3).toLowerCase();
    if (['control', 'shift', 'alt', 'meta'].includes(k)) return null;
    parts.push(k);
    // On non-mac, "ctrl+l" is the same as "mod+l".
    return parts.join('+');
  }

  let lastEsc = 0;
  function onKey(e) {
    if (e.defaultPrevented) return;
    const chord = chordOf(e);
    if (!chord) return;
    const t = e.target;
    const inInput = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable || (t.closest && t.closest('.monaco-editor, .xterm')));
    const inEditor = t && t.closest && t.closest('.monaco-editor, .xterm');
    if (chord === 'escape') {
      const now = Date.now();
      const modal = document.querySelector('.modal-backdrop:not([hidden])');
      if (!modal && now - lastEsc < 600) { click('btn-stop')(); lastEsc = 0; } else lastEsc = now;
      return;
    }
    const alt = isMac ? chord : chord.replace(/^mod\+/, 'ctrl+');
    for (const c of COMMANDS) {
      for (const k of c.keys) {
        if (k.includes(' ')) continue;
        if (k !== chord && k !== alt && k.replace(/^mod\+/, 'ctrl+') !== alt) continue;
        if (k === 'tab') {
          const comp = document.getElementById('composer-input');
          if (!(t === comp && !comp.value)) continue;
        }
        if (c.notInInput && inInput) continue;
        if (inEditor && !k.startsWith('mod') && k !== 'ctrl+`') continue;
        if (inEditor && ['mod+z', 'mod+shift+z', 'mod+p', 'mod+/'].includes(k)) continue;
        e.preventDefault();
        e.stopPropagation();
        try { c.run(); } catch (err) { console.error(err); }
        return;
      }
    }
  }

  // ---------- generic list modal ----------
  let modal = null;
  function ensureModal() {
    if (modal) return modal;
    const back = document.createElement('div');
    back.className = 'modal-backdrop palette-backdrop';
    back.hidden = true;
    back.innerHTML = '<div class="palette" role="dialog" aria-label="Command palette"><input class="input palette-input" id="palette-input" autocomplete="off" spellcheck="false"><div class="palette-list" id="palette-list" role="listbox"></div></div>';
    document.body.appendChild(back);
    back.addEventListener('mousedown', (e) => { if (e.target === back) close(); });
    modal = { back, input: back.querySelector('input'), list: back.querySelector('.palette-list'), items: [], index: 0, source: null };
    modal.input.addEventListener('input', () => { if (modal.onQuery) modal.onQuery(modal.input.value.trim()); render(); });
    modal.input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { modal.index = Math.min(modal.items.length - 1, modal.index + 1); paint(); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { modal.index = Math.max(0, modal.index - 1); paint(); e.preventDefault(); }
      else if (e.key === 'Enter') { e.preventDefault(); choose(modal.items[modal.index]); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    });
    return modal;
  }
  function score(q, text) {
    if (!q) return 1;
    text = text.toLowerCase(); q = q.toLowerCase();
    if (text.includes(q)) return 100 - text.indexOf(q);
    let i = 0; for (const ch of text) if (ch === q[i]) i++;
    return i === q.length ? 10 : 0;
  }
  function render() {
    const q = modal.input.value.trim();
    modal.items = modal.source().map((it) => ({ it, s: score(q, it.title + ' ' + (it.group || '') + ' ' + (it.detail || '')) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).map((x) => x.it).slice(0, 200);
    modal.index = 0;
    paint();
  }
  function paint() {
    modal.list.textContent = '';
    if (!modal.items.length) { const d = document.createElement('div'); d.className = 'palette-empty'; d.textContent = 'No matches'; modal.list.appendChild(d); return; }
    modal.items.forEach((it, i) => {
      const row = document.createElement('div');
      row.className = 'palette-item' + (i === modal.index ? ' is-active' : '');
      row.setAttribute('role', 'option');
      const t = document.createElement('span'); t.className = 'palette-title'; t.textContent = it.title; row.appendChild(t);
      if (it.detail) { const d = document.createElement('span'); d.className = 'palette-detail'; d.textContent = it.detail; row.appendChild(d); }
      if (it.keys && it.keys.length) { const k = document.createElement('kbd'); k.textContent = fmt(it.keys[0]); row.appendChild(k); }
      row.addEventListener('mousemove', () => { if (modal.index !== i) { modal.index = i; paint(); } });
      row.addEventListener('click', () => choose(it));
      modal.list.appendChild(row);
      if (i === modal.index) row.scrollIntoView({ block: 'nearest' });
    });
  }
  function choose(it) { if (!it) return; close(); setTimeout(() => { try { it.run(); } catch (e) { console.error(e); } }, 0); }
  function close() { if (modal) { modal.back.hidden = true; } }
  function show(placeholder, source) {
    ensureModal();
    modal.source = source;
    modal.onQuery = null;
    modal.input.placeholder = placeholder;
    modal.input.value = '';
    modal.back.hidden = false;
    render();
    setTimeout(() => modal.input.focus(), 0);
  }

  function open() {
    show('Type a command', () => COMMANDS.filter((c) => c.id !== 'palette.open').map((c) => ({ title: c.title, detail: c.group, keys: c.keys, run: c.run })));
  }
  function pickTheme() {
    if (!window.Themes) return;
    show('Choose a colour theme', () => window.Themes.list().map((t) => ({ title: t.name, detail: t.id === window.Themes.current() ? 'Current' : '', run: () => window.Themes.set(t.id) })));
  }
  function openFilePicker() {
    const dir = A().directory && A().directory();
    if (!dir) return;
    let files = [];
    let seq = 0;
    const load = async (q) => {
      const mine = ++seq;
      try { const r = await window.Api.findFiles(q || ''); if (mine === seq) { files = Array.isArray(r) ? r : []; render(); } } catch (e) {}
    };
    show('Go to file', () => files.map((f) => ({ title: String(f), run: () => window.CodeEditor && window.CodeEditor.open(String(f)) })));
    modal.onQuery = (q) => load(q);
    load('');
  }

  function openHelp() {
    let back = document.getElementById('shortcuts-backdrop');
    if (!back) {
      back = document.createElement('div');
      back.className = 'modal-backdrop';
      back.id = 'shortcuts-backdrop';
      const m = document.createElement('div');
      m.className = 'modal shortcuts-modal';
      const h = document.createElement('header'); h.className = 'modal-header';
      const t = document.createElement('h2'); t.textContent = 'Keyboard shortcuts'; h.appendChild(t);
      const x = document.createElement('button'); x.className = 'icon-btn'; x.textContent = 'Close'; x.id = 'btn-shortcuts-close'; x.addEventListener('click', () => { back.hidden = true; }); h.appendChild(x);
      m.appendChild(h);
      const body = document.createElement('div'); body.className = 'modal-body shortcuts-body';
      const groups = {};
      for (const c of COMMANDS) if (c.keys.length) (groups[c.group] = groups[c.group] || []).push(c);
      for (const g of Object.keys(groups)) {
        const sec = document.createElement('section');
        const gh = document.createElement('h3'); gh.textContent = g; sec.appendChild(gh);
        for (const c of groups[g]) {
          const row = document.createElement('div'); row.className = 'shortcut-row';
          const n = document.createElement('span'); n.textContent = c.title; row.appendChild(n);
          const ks = document.createElement('span');
          c.keys.forEach((k, i) => { if (i) ks.appendChild(document.createTextNode(' or ')); const kb = document.createElement('kbd'); kb.textContent = fmt(k); ks.appendChild(kb); });
          row.appendChild(ks); sec.appendChild(row);
        }
        body.appendChild(sec);
      }
      m.appendChild(body); back.appendChild(m); document.body.appendChild(back);
      back.addEventListener('mousedown', (e) => { if (e.target === back) back.hidden = true; });
      back.addEventListener('keydown', (e) => { if (e.key === 'Escape') back.hidden = true; });
    }
    back.hidden = false;
  }

  document.addEventListener('keydown', onKey, true);
  window.Palette = { open, close, openHelp, pickTheme, openFilePicker, commands: COMMANDS, fmt };
})();
