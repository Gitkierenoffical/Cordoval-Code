'use strict';

// Customise modal: MCP servers, agents, commands and permissions.
(function () {
  const TABS = ['mcp', 'agents', 'commands', 'permissions'];
  const TAB_LABELS = {
    mcp: 'MCP servers',
    agents: 'Agents',
    commands: 'Commands',
    permissions: 'Permissions',
  };
  const BUILTIN_AGENTS = ['build', 'plan', 'general', 'explore', 'compaction', 'summary', 'title'];
  const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
  const PERM_TOOLS = ['edit', 'bash', 'webfetch', 'websearch', 'read', 'glob', 'grep', 'list', 'task', 'external_directory', 'todowrite', 'skill', 'doom_loop'];
  const PERM_HINTS = {
    edit: 'Editing files',
    bash: 'Running shell commands',
    webfetch: 'Fetching web pages',
    websearch: 'Web search',
    read: 'Reading files',
    glob: 'File name search',
    grep: 'Content search',
    list: 'Listing directories',
    task: 'Running subagents',
    external_directory: 'Accessing other directories',
    todowrite: 'Maintaining the task list',
    skill: 'Using skills',
    doom_loop: 'Breaking out of repeated tool calls',
  };
  const STATUS_COLOURS = {
    connected: 'var(--ok, #16a34a)',
    failed: 'var(--danger, #dc2626)',
    needs_auth: '#b45309',
    needs_client_registration: '#b45309',
    disabled: 'var(--faint, #94a3b8)',
  };

  const CARD_CSS = 'border:1px solid var(--border, #e5e7eb); border-radius:12px; background:var(--panel-2, #fafafa); padding:12px 14px; margin-bottom:10px;';
  const FLEX_CSS = 'display:flex; align-items:center; gap:8px;';

  let built = false;
  let dom = null;
  let active = 'mcp';
  let config = {};
  let mcpLive = {};
  let toolIds = [];
  let agentsList = [];
  let commandsList = [];
  let projectAgents = [];
  let projectCommands = [];
  let authStarted = {};
  let loadedOnce = false;

  let mcpForm = null; // {name, entry, isNew}
  let agentForm = null; // {name, scope, mode, isNew, fields}
  let commandForm = null; // {name, scope, mode, isNew, fields}

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }

  function clear(node) {
    while (node && node.firstChild) node.removeChild(node.firstChild);
  }

  function errMsg(err) {
    return String((err && err.message) || err || 'Something went wrong.');
  }

  function toast(msg, kind) {
    if (window.CordovalApp && typeof window.CordovalApp.toast === 'function') {
      window.CordovalApp.toast(msg, kind);
    }
  }

  function deepCopy(value) {
    try {
      return JSON.parse(JSON.stringify(value === undefined || value === null ? {} : value));
    } catch (err) {
      return {};
    }
  }

  function projectDir() {
    const dir = window.CordovalApp && window.CordovalApp.directory();
    return dir ? String(dir) : '';
  }

  function api(path, opts) {
    if (!window.Api || typeof window.Api.request !== 'function') {
      return Promise.reject(new Error('The engine API is not available.'));
    }
    return window.Api.request(path, opts);
  }

  function validName(name) {
    return NAME_RE.test(String(name || ''));
  }

  function quoteToken(token) {
    return /\s/.test(token) ? '"' + String(token).replace(/"/g, '\\"') + '"' : token;
  }

  function splitCommandLine(line) {
    const out = [];
    let current = '';
    let quote = null;
    const text = String(line || '');
    for (const ch of text) {
      if (quote) {
        if (ch === quote) quote = null;
        else current += ch;
      } else if (ch === '"' || ch === "'") {
        quote = ch;
      } else if (ch === ' ' || ch === '\t') {
        if (current) { out.push(current); current = ''; }
      } else {
        current += ch;
      }
    }
    if (current) out.push(current);
    return out;
  }

  function mapToLines(map, sep) {
    const keys = Object.keys(map || {}).sort();
    const lines = [];
    for (const key of keys) lines.push(key + sep + ' ' + String(map[key]));
    return lines.join('\n');
  }

  function linesToMap(text, sep) {
    const map = {};
    for (const rawLine of String(text || '').split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line) continue;
      const idx = line.indexOf(sep);
      if (idx <= 0) continue;
      const key = line.slice(0, idx).trim();
      const value = line.slice(idx + sep.length).trim();
      if (!key) continue;
      map[key] = value;
    }
    return map;
  }

  function scalarValue(value) {
    const s = String(value === undefined || value === null ? '' : value).trim();
    if (!s) return '';
    if ((s[0] === '"' && s[s.length - 1] === '"') || (s[0] === "'" && s[s.length - 1] === "'")) {
      return s.slice(1, -1);
    }
    if (s === 'true') return true;
    if (s === 'false') return false;
    if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
    return s;
  }

  function stripQuotes(text) {
    const s = String(text || '').trim();
    if (s.length > 1 && (s[0] === '"' || s[0] === "'") && s[s.length - 1] === s[0]) {
      return s.slice(1, -1);
    }
    return s;
  }

  function parseFrontmatter(content) {
    const lines = String(content || '').split(/\r?\n/);
    if (!lines.length || lines[0].trim() !== '---') {
      return { meta: {}, body: String(content || '') };
    }
    let end = -1;
    for (let i = 1; i < lines.length; i++) {
      if (lines[i].trim() === '---') { end = i; break; }
    }
    if (end < 0) return { meta: {}, body: String(content || '') };
    const meta = {};
    const stack = [];
    for (let i = 1; i < end; i++) {
      const line = lines[i];
      if (!line.trim()) continue;
      const indentMatch = line.match(/^(\s*)/);
      const depth = Math.floor(indentMatch[1].length / 2);
      stack.length = Math.min(stack.length, depth);
      const seg = line.trim();
      const colon = seg.indexOf(':');
      if (colon < 1) continue;
      const key = stripQuotes(seg.slice(0, colon));
      const raw = seg.slice(colon + 1).trim();
      if (!key) continue;
      if (raw === '') {
        stack.push(key);
      } else {
        let node = meta;
        for (const part of stack) {
          if (!node[part] || typeof node[part] !== 'object' || Array.isArray(node[part])) node[part] = {};
          node = node[part];
        }
        node[key] = scalarValue(raw);
      }
    }
    const body = lines.slice(end + 1).join('\n');
    return { meta, body };
  }

  function yamlKey(key) {
    return /^[A-Za-z0-9_.-]+$/.test(key) ? key : '"' + stripQuotesSpecial(key) + '"';
  }

  function stripQuotesSpecial(key) {
    return String(key).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }

  function yamlScalar(value) {
    if (value === true) return 'true';
    if (value === false) return 'false';
    if (typeof value === 'number') return String(value);
    const s = String(value === undefined || value === null ? '' : value);
    if (/^[A-Za-z0-9_][A-Za-z0-9 ._\/-]*$/.test(s)) return s;
    return '"' + stripQuotesSpecial(s) + '"';
  }

  function yamlEntries(map, indent) {
    const pad = ' '.repeat(indent);
    const out = [];
    for (const key of Object.keys(map || {})) {
      const value = map[key];
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        const sub = Object.keys(value);
        if (!sub.length) continue;
        out.push(pad + yamlKey(key) + ':\n' + yamlEntries(value, indent + 2));
      } else {
        out.push(pad + yamlKey(key) + ': ' + yamlScalar(value) + '\n');
      }
    }
    return out.join('');
  }

  function frontmatterText(entries) {
    let out = '---\n';
    for (const entry of entries) out += yamlEntries(entry, 0);
    out += '---';
    return out;
  }

  function ensureMd(name) {
    return /\.md$/i.test(name) ? name : name + '.md';
  }

  function statusChip(status) {
    const span = el('span', null, status ? String(status) : 'unknown');
    span.style.cssText = 'font-size:11px; font-weight:650; padding:2px 8px; border-radius:999px; border:1px solid var(--border, #e5e7eb); color:' + (STATUS_COLOURS[status] || 'var(--muted, #6b7280)') + ';';
    return span;
  }

  function actionButton(text, cls, onClick, styles) {
    const btn = el('button', cls, text);
    btn.type = 'button';
    if (styles) btn.style.cssText = styles;
    btn.addEventListener('click', onClick);
    return btn;
  }

  async function loadConfig() {
    try {
      const raw = await window.cordoval.getEngineConfig();
      config = raw && typeof raw === 'object' ? deepCopy(raw) : {};
    } catch (err) {
      config = config || {};
      toast('Could not load the engine config: ' + errMsg(err), 'error');
    }
  }

  async function fetchMcpStatus() {
    mcpLive = {};
    try {
      const data = await api('/mcp');
      if (Array.isArray(data)) {
        const map = {};
        for (const item of data) {
          if (item && item.name) map[String(item.name)] = item;
        }
        mcpLive = map;
      } else if (data && typeof data === 'object') {
        mcpLive = deepCopy(data);
      }
    } catch (err) {
      mcpLive = {};
    }
  }

  async function fetchToolIds() {
    try {
      const data = await api('/experimental/tool/ids');
      toolIds = Array.isArray(data) ? data.map(String).sort() : [];
    } catch (err) {
      toolIds = [];
    }
  }

  async function fetchAgents() {
    try {
      const data = await api('/agent');
      agentsList = Array.isArray(data) ? data : [];
    } catch (err) {
      agentsList = [];
    }
  }

  async function fetchCommands() {
    try {
      const data = await api('/command');
      commandsList = Array.isArray(data) ? data : [];
    } catch (err) {
      commandsList = [];
    }
  }

  async function fetchProjectFiles() {
    const dir = projectDir();
    projectAgents = [];
    projectCommands = [];
    if (!dir) return;
    try {
      const files = await window.cordoval.listProjectFiles(dir, 'agent');
      projectAgents = Array.isArray(files) ? files : [];
    } catch (err) { /* keep empty */ }
    try {
      const files = await window.cordoval.listProjectFiles(dir, 'command');
      projectCommands = Array.isArray(files) ? files : [];
    } catch (err) { /* keep empty */ }
  }

  async function refreshAll() {
    await Promise.all([
      loadConfig(),
      fetchMcpStatus(),
      fetchToolIds(),
      fetchAgents(),
      fetchCommands(),
      fetchProjectFiles(),
    ]);
    loadedOnce = true;
  }

  async function saveConfig(next) {
    toast('Saving...');
    let ok = true;
    try {
      const saved = await window.CordovalApp.saveEngineConfig(next);
      if (saved === false) {
        ok = false;
        toast('Save cancelled.', 'error');
      } else {
        toast('Saved');
      }
    } catch (err) {
      ok = false;
      toast('Save failed: ' + errMsg(err), 'error');
    }
    try {
      const raw = await window.cordoval.getEngineConfig();
      config = raw && typeof raw === 'object' ? deepCopy(raw) : {};
    } catch (err) {
      if (ok) config = deepCopy(next);
    }
    return ok;
  }

  async function writeProjectFile(dir, kind, name, content) {
    await window.cordoval.writeProjectFile(dir, kind, name, content);
    toast('Saved');
  }

  // ---- modal DOM ----

  function buildModal() {
    if (built) return dom;
    built = true;

    const backdrop = el('div', 'modal-backdrop');
    backdrop.id = 'customize-backdrop';
    backdrop.hidden = true;

    const modal = el('div', 'modal');
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'customize-title');

    const header = el('header', 'modal-header');
    const title = el('h2', null, 'Customise');
    title.id = 'customize-title';
    header.appendChild(title);
    const closeBtn = el('button', 'icon-btn');
    closeBtn.type = 'button';
    closeBtn.setAttribute('aria-label', 'Close customisation');
    closeBtn.title = 'Close';
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.setAttribute('width', '14');
    svg.setAttribute('height', '14');
    svg.setAttribute('aria-hidden', 'true');
    const svgPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    svgPath.setAttribute('fill', 'currentColor');
    svgPath.setAttribute('d', 'M4.03 4.03a.75.75 0 0 1 1.06 0L8 6.94l2.91-2.91a.75.75 0 1 1 1.06 1.06L9.06 8l2.91 2.91a.75.75 0 1 1-1.06 1.06L8 9.06l-2.91 2.91a.75.75 0 0 1-1.06-1.06L6.94 8 4.03 5.09a.75.75 0 0 1 0-1.06Z');
    svg.appendChild(svgPath);
    closeBtn.appendChild(svg);
    header.appendChild(closeBtn);
    modal.appendChild(header);

    const tabsRow = el('div', 'modal-tabs');
    tabsRow.setAttribute('role', 'tablist');
    const tabBtns = {};
    for (const tab of TABS) {
      const tabBtn = el('button', 'modal-tab', TAB_LABELS[tab]);
      tabBtn.type = 'button';
      tabBtn.dataset.ctab = tab;
      tabBtn.addEventListener('click', function (event) {
        event.stopImmediatePropagation();
        setTab(tab);
      });
      tabsRow.appendChild(tabBtn);
      tabBtns[tab] = tabBtn;
    }
    modal.appendChild(tabsRow);

    const body = el('div', 'modal-body');
    const views = {};
    for (const tab of TABS) {
      const view = el('section', 'modal-view');
      view.dataset.ctab = tab;
      body.appendChild(view);
      views[tab] = view;
    }
    modal.appendChild(body);

    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);

    closeBtn.addEventListener('click', closeModal);
    backdrop.addEventListener('click', function (event) {
      if (event.target === backdrop) closeModal();
    });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && !backdrop.hidden) closeModal();
    });

    dom = { backdrop, modal, tabBtns, views };
    return dom;
  }

  function closeModal() {
    if (!dom) return;
    dom.backdrop.hidden = true;
    mcpForm = null;
    agentForm = null;
    commandForm = null;
  }

  function installButton() {
    if (document.getElementById('btn-customize')) return;
    const settingsBtn = document.getElementById('btn-settings');
    if (!settingsBtn || !settingsBtn.parentNode) return;
    const btn = el('button', 'icon-btn');
    btn.id = 'btn-customize';
    btn.type = 'button';
    btn.title = 'Customise MCP, agents, commands and permissions';
    btn.setAttribute('aria-label', 'Customise');
    btn.textContent = 'Customise';
    btn.addEventListener('click', function () {
      window.Customize.open();
    });
    settingsBtn.parentNode.insertBefore(btn, settingsBtn);
  }

  function setTab(tab) {
    if (!dom || TABS.indexOf(tab) < 0) return;
    active = tab;
    for (const name of TABS) {
      dom.tabBtns[name].classList.toggle('is-active', name === tab);
      dom.views[name].classList.toggle('is-active', name === tab);
    }
    renderActive();
  }

  function renderActive() {
    if (!dom) return;
    const view = dom.views[active];
    if (!loadedOnce) {
      clear(view);
      view.appendChild(el('p', null, 'Loading...'));
      return;
    }
    if (active === 'mcp') {
      if (mcpForm) renderMcpForm(view); else renderMcpList(view);
    } else if (active === 'agents') {
      if (agentForm) renderAgentForm(view); else renderAgentsList(view);
    } else if (active === 'commands') {
      if (commandForm) renderCommandForm(view); else renderCommandsList(view);
    } else {
      renderPermissionsList(view);
    }
  }

  function sectionHeader(title, subtitle) {
    const wrap = el('div');
    wrap.style.cssText = 'margin-bottom:14px;';
    const h = el('h3', null, title);
    h.style.cssText = 'margin:0 0 4px; font-size:14px;';
    wrap.appendChild(h);
    if (subtitle) {
      const p = el('p', null, subtitle);
      p.style.cssText = 'margin:0; font-size:12px; color:var(--muted, #6b7280);';
      wrap.appendChild(p);
    }
    return wrap;
  }

  function formField(labelText, control) {
    const wrap = el('div');
    wrap.style.cssText = 'margin-bottom:12px;';
    const lab = el('div', null, labelText);
    lab.style.cssText = 'font-size:12px; font-weight:650; color:var(--muted, #6b7280); margin-bottom:4px;';
    wrap.appendChild(lab);
    wrap.appendChild(control);
    return wrap;
  }

  function selectControl(options, value) {
    const sel = el('select', 'input');
    for (const opt of options) {
      const o = el('option', null, opt.label);
      o.value = opt.value;
      sel.appendChild(o);
    }
    sel.value = value !== undefined && value !== null ? String(value) : options[0].value;
    return sel;
  }

  function textArea(rows, placeholder, value) {
    const ta = el('textarea', 'input');
    ta.rows = rows;
    if (placeholder) ta.placeholder = placeholder;
    ta.value = value === undefined || value === null ? '' : String(value);
    ta.spellcheck = false;
    return ta;
  }

  function textInput(placeholder, value) {
    const input = el('input', 'input');
    input.type = 'text';
    if (placeholder) input.placeholder = placeholder;
    input.value = value === undefined || value === null ? '' : String(value);
    input.spellcheck = false;
    input.autocomplete = 'off';
    return input;
  }

  function checkboxRow(labelText, checked) {
    const lab = el('label');
    lab.style.cssText = 'display:inline-flex; align-items:center; gap:6px; font-size:12.5px; margin-right:12px;';
    const box = el('input');
    box.type = 'checkbox';
    box.checked = !!checked;
    lab.appendChild(box);
    lab.appendChild(el('span', null, labelText));
    return { label: lab, box: box };
  }

  function formActions(onSave, onCancel, saveLabel) {
    const row = el('div');
    row.style.cssText = 'display:flex; gap:8px; margin-top:4px;';
    row.appendChild(actionButton(saveLabel || 'Save', 'btn btn-primary btn-sm', onSave));
    row.appendChild(actionButton('Cancel', 'btn btn-ghost btn-sm', onCancel));
    return row;
  }

  // ---- Tab 1: MCP ----

  function serverNames() {
    const names = {};
    for (const name of Object.keys(config.mcp || {})) names[name] = true;
    for (const name of Object.keys(mcpLive || {})) names[name] = true;
    return Object.keys(names).sort();
  }

  function isMcpTool(id, servers) {
    const idx = String(id).indexOf('_');
    if (idx <= 0) return false;
    return servers.indexOf(String(id).slice(0, idx)) >= 0;
  }

  function renderMcpList(view) {
    clear(view);
    const head = sectionHeader('MCP servers', 'Servers from the engine global config, with live status from the engine.');
    const headRow = el('div');
    headRow.style.cssText = 'display:flex; align-items:center; justify-content:space-between; gap:10px;';
    headRow.appendChild(head);
    headRow.appendChild(actionButton('Add server', 'btn btn-secondary btn-sm', function () {
      mcpForm = { name: '', entry: null, isNew: true };
      renderActive();
    }));
    view.appendChild(headRow);

    view.appendChild(el('p', null, 'Connecting and signing in may require a project to be open.'));

    const servers = config.mcp && typeof config.mcp === 'object' ? config.mcp : {};
    const names = serverNames();
    if (!names.length) {
      view.appendChild(el('p', null, 'No MCP servers configured. Use "Add server" to create one.'));
    }
    for (const name of names) {
      view.appendChild(mcpRow(name, servers[name]));
    }
    view.appendChild(toolsSection());
  }

  function mcpRow(name, entry) {
    const card = el('div');
    card.style.cssText = CARD_CSS;

    const headRow = el('div');
    headRow.style.cssText = FLEX_CSS + ' flex-wrap:nowrap;';
    const nameEl = el('span', null, name);
    nameEl.style.cssText = 'font-weight:650; font-size:13px;';
    const typeText = entry && entry.type ? String(entry.type) : 'local';
    const typeEl = el('span', null, typeText);
    typeEl.style.cssText = 'font-size:11px; color:var(--muted, #6b7280);';
    const spacer = el('span');
    spacer.style.cssText = 'flex:1 1 auto;';
    const live = mcpLive[name];
    const status = live && live.status ? String(live.status) : '';
    const chip = statusChip(status && status !== 'connected' && entry && entry.enabled === false ? 'disabled' : status);
    if (live && live.error) chip.title = String(live.error);
    headRow.appendChild(nameEl);
    headRow.appendChild(typeEl);
    headRow.appendChild(spacer);
    headRow.appendChild(chip);
    card.appendChild(headRow);

    const detail = el('div');
    detail.style.cssText = 'margin-top:6px; font-size:12px; color:var(--muted, #6b7280); word-break:break-all;';
    if (typeText === 'remote' && entry && entry.url) {
      detail.appendChild(el('div', null, String(entry.url)));
    } else if (entry && Array.isArray(entry.command)) {
      detail.appendChild(el('div', null, entry.command.map(quoteToken).join(' ')));
    }
    if (live && live.error) {
      const errLine = el('div', null, String(live.error));
      errLine.style.cssText = 'color:var(--danger, #dc2626);';
      detail.appendChild(errLine);
    }
    if (detail.childNodes.length) card.appendChild(detail);

    const actions = el('div');
    actions.style.cssText = FLEX_CSS + ' margin-top:10px; flex-wrap:wrap;';
    const enabled = !entry || entry.enabled !== false;

    actions.appendChild(actionButton(enabled ? 'Disable' : 'Enable', 'btn btn-secondary btn-sm', function () {
      toggleMcp(name, entry);
    }));
    if (enabled) {
      if (status === 'connected') {
        actions.appendChild(actionButton('Disconnect', 'btn btn-secondary btn-sm', function () {
          disconnectMcp(name);
        }));
      } else if (status !== 'disabled') {
        actions.appendChild(actionButton('Connect', 'btn btn-secondary btn-sm', function () {
          connectMcp(name);
        }));
      }
      if (status === 'needs_auth' || status === 'needs_client_registration' || authStarted[name]) {
        if (authStarted[name]) {
          actions.appendChild(actionButton('Finish sign-in', 'btn btn-primary btn-sm', function () {
            finishAuth(name);
          }));
          actions.appendChild(actionButton('Cancel sign-in', 'btn btn-ghost btn-sm', function () {
            cancelAuth(name);
          }));
        } else {
          actions.appendChild(actionButton('Sign in', 'btn btn-primary btn-sm', function () {
            startAuth(name);
          }));
        }
      }
    }
    actions.appendChild(actionButton('Edit', 'btn btn-ghost btn-sm', function () {
      mcpForm = { name, entry: deepCopy(entry || {}), isNew: false };
      renderActive();
    }));
    actions.appendChild(actionButton('Remove', 'btn btn-ghost btn-sm', function () {
      removeMcp(name);
    }, 'color: var(--danger, #dc2626);'));
    card.appendChild(actions);
    return card;
  }

  function toggleMcp(name, entry) {
    const next = deepCopy(config);
    const servers = next.mcp && typeof next.mcp === 'object' ? next.mcp : (next.mcp = {});
    const target = servers[name] && typeof servers[name] === 'object' ? deepCopy(servers[name]) : { enabled: false };
    target.enabled = !!(entry && entry.enabled === false);
    servers[name] = target;
    saveConfig(next).then(function () {
      fetchMcpStatus();
      renderActive();
    });
  }

  function removeMcp(name) {
    if (!window.confirm('Remove MCP server "' + name + '" from the global config?')) return;
    const next = deepCopy(config);
    if (next.mcp) delete next.mcp[name];
    saveConfig(next).then(function () {
      fetchMcpStatus();
      renderActive();
    });
  }

  async function connectMcp(name) {
    toast('Connecting ' + name + '...');
    try {
      await api('/mcp/' + encodeURIComponent(name) + '/connect', { method: 'POST' });
      toast(name + ' connected.');
    } catch (err) {
      toast('Could not connect ' + name + ': ' + errMsg(err), 'error');
    }
    await fetchMcpStatus();
    renderActive();
  }

  async function disconnectMcp(name) {
    try {
      await api('/mcp/' + encodeURIComponent(name) + '/disconnect', { method: 'POST' });
      toast(name + ' disconnected.');
    } catch (err) {
      toast('Could not disconnect ' + name + ': ' + errMsg(err), 'error');
    }
    await fetchMcpStatus();
    renderActive();
  }

  async function startAuth(name) {
    try {
      const res = await api('/mcp/' + encodeURIComponent(name) + '/auth', { method: 'POST' });
      const url = res && res.authorizationUrl;
      if (url) {
        window.open(String(url), '_blank');
        authStarted[name] = true;
        renderActive();
        toast('Sign-in page opened. Complete it, then choose Finish sign-in.');
      } else {
        toast('The engine did not return a sign-in URL.', 'error');
      }
    } catch (err) {
      toast('Sign-in failed: ' + errMsg(err), 'error');
    }
  }

  async function finishAuth(name) {
    try {
      await api('/mcp/' + encodeURIComponent(name) + '/auth/authenticate', { method: 'POST' });
      authStarted[name] = false;
      toast('Signed in to ' + name + '.');
    } catch (err) {
      toast('Could not complete sign-in for ' + name + ': ' + errMsg(err), 'error');
    }
    await fetchMcpStatus();
    renderActive();
  }

  async function cancelAuth(name) {
    try {
      await api('/mcp/' + encodeURIComponent(name) + '/auth', { method: 'DELETE' });
      toast('Sign-in cancelled for ' + name + '.');
    } catch (err) {
      toast('Could not cancel sign-in for ' + name + ': ' + errMsg(err), 'error');
    }
    authStarted[name] = false;
    await fetchMcpStatus();
    renderActive();
  }

  function toolsSection() {
    const wrap = el('div');
    const headRow = el('div');
    headRow.style.cssText = 'display:flex; align-items:center; justify-content:space-between; gap:10px; margin-top:18px;';
    const head = sectionHeader('Tools', 'Tool ids from the engine. MCP tools are named server_tool.');
    headRow.appendChild(head);
    headRow.appendChild(actionButton('Refresh', 'btn btn-ghost btn-sm', async function () {
      await fetchToolIds();
      renderMcpList(dom.views.mcp);
    }));
    wrap.appendChild(headRow);

    const servers = serverNames();
    const mcpTools = [];
    const builtinTools = [];
    for (const id of toolIds) {
      if (isMcpTool(id, servers)) mcpTools.push(id);
      else builtinTools.push(id);
    }

    wrap.appendChild(listOfTools('Built-in tools', builtinTools));
    wrap.appendChild(listOfTools('MCP tools', mcpTools));
    return wrap;
  }

  function listOfTools(title, ids) {
    const block = el('div');
    block.style.cssText = CARD_CSS;
    const label = el('div', null, title + ' (' + ids.length + ')');
    label.style.cssText = 'font-size:12px; font-weight:650; color:var(--muted, #6b7280); margin-bottom:6px;';
    block.appendChild(label);
    if (!ids.length) {
      block.appendChild(el('div', null, 'None.'));
      return block;
    }
    const list = el('div');
    list.style.cssText = 'display:flex; flex-wrap:wrap; gap:6px;';
    for (const id of ids) {
      const chip = el('span', null, id);
      chip.style.cssText = 'font-size:11px; padding:2px 7px; border-radius:999px; border:1px solid var(--border, #e5e7eb);';
      list.appendChild(chip);
    }
    block.appendChild(list);
    return block;
  }

  function renderMcpForm(view) {
    clear(view);
    const isNew = mcpForm.isNew;
    const head = sectionHeader(isNew ? 'Add MCP server' : 'Edit MCP server "' + mcpForm.name + '"', null);
    view.appendChild(head);

    const entry = mcpForm.entry && typeof mcpForm.entry === 'object' ? mcpForm.entry : {};
    const type = entry.type === 'remote' ? 'remote' : 'local';

    const nameInput = textInput('e.g. my-server or my.server-2', isNew ? '' : mcpForm.name);
    view.appendChild(formField('Name', nameInput));

    const typeSel = selectControl([
      { value: 'local', label: 'local' },
      { value: 'remote', label: 'remote' },
    ], type);
    view.appendChild(formField('Type', typeSel));

    const localWrap = el('div');
    const cmdInput = textInput('e.g. npx -y some-server --flag', (entry.command || []).map(quoteToken).join(' '));
    localWrap.appendChild(formField('Command (one line, split on spaces; quotes keep a token together)', cmdInput));
    const envArea = textArea(4, 'KEY=VALUE (one per line)', mapToLines(entry.environment, '='));
    localWrap.appendChild(formField('Environment', envArea));

    const remoteWrap = el('div');
    remoteWrap.style.display = 'none';
    const urlInput = textInput('https://example.org/mcp', entry.url || '');
    remoteWrap.appendChild(formField('URL', urlInput));
    const headersArea = textArea(4, 'KEY: VALUE (one per line)', mapToLines(entry.headers, ':'));
    remoteWrap.appendChild(formField('Headers', headersArea));

    const oauth = checkboxRow('OAuth', entry.oauth !== false);
    const oauthRow = el('div');
    oauthRow.style.cssText = 'margin-bottom:12px;';
    oauthRow.appendChild(oauth.label);
    remoteWrap.appendChild(oauthRow);

    function syncType() {
      const isRemote = typeSel.value === 'remote';
      localWrap.style.display = isRemote ? 'none' : '';
      remoteWrap.style.display = isRemote ? '' : 'none';
    }
    typeSel.addEventListener('change', syncType);
    syncType();

    view.appendChild(localWrap);
    view.appendChild(remoteWrap);

    const timeoutInput = textInput('e.g. 120000', entry.timeout !== undefined && entry.timeout !== null ? String(entry.timeout) : '');
    view.appendChild(formField('Timeout in milliseconds (optional)', timeoutInput));

    const errLine = el('p');
    errLine.style.cssText = 'margin:0 0 10px; font-size:12px; color:var(--danger, #dc2626);';
    view.appendChild(errLine);
    view.appendChild(formActions(save));

    async function save() {
      const name = String(nameInput.value || '').trim();
      if (!validName(name)) {
        errLine.textContent = 'Invalid name. Use letters, digits, dots, underscores or hyphens, starting with a letter or digit.';
        return;
      }
      if (name !== mcpForm.name && !isNew && false) { /* name stays fixed when editing a known config entry */ }
      const next = deepCopy(config);
      const servers = next.mcp && typeof next.mcp === 'object' ? next.mcp : (next.mcp = {});
      if (isNew && servers[name]) {
        errLine.textContent = 'A server named "' + name + '" already exists.';
        return;
      }
      const built = current();
      if (!built) return;
      servers[name] = built;
      mcpForm = null;
      await saveConfig(next);
      await fetchMcpStatus();
      renderActive();

      function current() {
        const out = Object.assign({}, entry);
        out.enabled = true;
        const timeoutRaw = String(timeoutInput.value || '').trim();
        if (timeoutRaw) {
          const to = Number(timeoutRaw);
          if (!Number.isFinite(to) || to <= 0) {
            errLine.textContent = 'Timeout must be a positive number of milliseconds.';
            return null;
          }
          out.timeout = Math.round(to);
        } else {
          delete out.timeout;
        }
        if (typeSel.value === 'remote') {
          const url = String(urlInput.value || '').trim();
          if (!/^https?:\/\//.test(url)) {
            errLine.textContent = 'The URL must start with http:// or https://.';
            return null;
          }
          out.type = 'remote';
          out.url = url;
          out.headers = linesToMap(headersArea.value, ':');
          out.oauth = !!oauth.box.checked;
          delete out.command;
          delete out.environment;
        } else {
          const parts = splitCommandLine(cmdInput.value);
          if (!parts.length) {
            errLine.textContent = 'Enter a command to run the local server.';
            return null;
          }
          out.type = 'local';
          out.command = parts;
          out.environment = linesToMap(envArea.value, '=');
          delete out.url;
          delete out.headers;
          delete out.oauth;
        }
        return out;
      }
    }
    view.appendChild(formActions(save));
  }

  // ---- Tab 2: Agents ----

  function stripMd(name) {
    return String(name || '').replace(/\.md$/i, '');
  }

  function agentRoster() {
    const map = {};
    for (const rec of agentsList) {
      if (!rec || !rec.name) continue;
      const name = String(rec.name);
      map[name] = {
        name,
        description: rec.description || '',
        mode: rec.mode || 'all',
        model: rec.model || '',
        builtIn: !!(rec.builtIn || BUILTIN_AGENTS.indexOf(name) >= 0),
        hasGlobal: false,
        hasProject: false,
        file: null,
      };
    }
    const cfgAgents = config.agent && typeof config.agent === 'object' ? config.agent : {};
    for (const name of Object.keys(cfgAgents)) {
      if (!map[name]) {
        map[name] = { name, description: '', mode: 'all', model: '', builtIn: false, hasGlobal: false, hasProject: false, file: null };
      }
      map[name].hasGlobal = true;
    }
    for (const file of projectAgents) {
      const name = stripMd(file && file.name);
      if (!name) continue;
      if (!map[name]) {
        map[name] = { name, description: '', mode: 'all', model: '', builtIn: false, hasGlobal: false, hasProject: false, file: null };
      }
      if (file && (file.name || file.content != null)) {
        map[name].hasProject = true;
        map[name].file = String(file.name || ensureMd(name));
      }
    }
    return Object.keys(map).sort().map(function (key) { return map[key]; });
  }

  function renderAgentsList(view) {
    clear(view);
    const headRow = el('div');
    headRow.style.cssText = 'display:flex; align-items:center; justify-content:space-between; gap:10px; margin-bottom:14px;';
    headRow.appendChild(sectionHeader('Agents', 'Built-in agents are read-only. Global agents live in the engine config; project agents in .opencode/agent.'));
    headRow.appendChild(actionButton('New agent', 'btn btn-secondary btn-sm', function () {
      openAgentForm(null, 'create');
    }));
    view.appendChild(headRow);

    const roster = agentRoster();
    if (!roster.length) {
      view.appendChild(el('p', null, 'No agents available.'));
      return;
    }
    for (const rec of roster) {
      view.appendChild(agentRow(rec));
    }
  }

  function agentRow(rec) {
    const card = el('div');
    card.style.cssText = CARD_CSS;
    const head = el('div');
    head.style.cssText = FLEX_CSS + ' flex-wrap:nowrap;';
    const nameEl = el('span', null, rec.name);
    nameEl.style.cssText = 'font-weight:650; font-size:13px;';
    const spacer = el('span');
    spacer.style.cssText = 'flex:1 1 auto;';
    head.appendChild(nameEl);
    head.appendChild(spacer);
    const tag = rec.builtIn ? 'Built-in' : rec.hasProject ? 'Project .opencode/agent' : 'Global config';
    const tagEl = el('span', null, tag);
    tagEl.style.cssText = 'font-size:11px; color:var(--muted, #6b7280);';
    head.appendChild(tagEl);
    card.appendChild(head);

    const info = el('div');
    info.style.cssText = 'margin-top:4px; font-size:12px; color:var(--muted, #6b7280); word-break:break-word;';
    const bits = [];
    if (rec.description) bits.push(String(rec.description));
    if (rec.mode) bits.push('mode: ' + rec.mode);
    if (rec.model) bits.push('model: ' + rec.model);
    info.textContent = bits.join(' · ');
    if (bits.length) card.appendChild(info);

    const actions = el('div');
    actions.style.cssText = FLEX_CSS + ' margin-top:10px;';
    if (!rec.builtIn && (rec.hasProject || rec.hasGlobal || rec.file)) {
      actions.appendChild(actionButton('Edit', 'btn btn-ghost btn-sm', function () {
        openAgentForm(rec, 'edit');
      }));
      actions.appendChild(actionButton('Delete', 'btn btn-ghost btn-sm', function () {
        deleteAgent(rec);
      }, 'color: var(--danger, #dc2626);'));
    } else {
      actions.appendChild(el('span', null, 'Read-only'));
    }
    card.appendChild(actions);
    return card;
  }

  function readAgentSource(rec) {
    if (rec.hasProject && rec.name) {
      const file = projectAgents.find(function (f) { return stripMd(f && f.name) === rec.name || (f && f.name) === rec.file; });
      if (file && file.content != null) {
        const parsed = parseFrontmatter(file.content);
        const meta = parsed.meta || {};
        return {
          scope: 'project',
          isNew: false,
          name: rec.name,
          fileName: String(file.name || ensureMd(rec.name)),
          description: meta.description === undefined ? '' : String(meta.description),
          mode: typeof meta.mode === 'string' && meta.mode ? meta.mode : 'all',
          model: typeof meta.model === 'string' ? meta.model : '',
          temperature: typeof meta.temperature === 'number' ? meta.temperature : '',
          prompt: parsed.body.trim(),
          tools: meta.tools && typeof meta.tools === 'object' && !Array.isArray(meta.tools) ? meta.tools : {},
          permission: meta.permission && typeof meta.permission === 'object' && !Array.isArray(meta.permission) ? meta.permission : {},
          existingFile: rec.file || (file && file.name),
        };
      }
    }
    return null;
  }

  function openAgentForm(rec, mode) {
    let data = null;
    if (mode === 'edit') {
      data = readAgentSource(rec);
      if (!data) {
        // Global agent: build from the config entry.
        const cfgAgents = config.agent && typeof config.agent === 'object' ? config.agent : {};
        const entry = cfgAgents[rec.name] && typeof cfgAgents[rec.name] === 'object' ? deepCopy(cfgAgents[rec.name]) : {};
        data = {
          scope: 'global',
          isNew: false,
          name: rec.name,
          description: entry.description === undefined || entry.description === null ? '' : String(entry.description),
          mode: entry.mode && typeof entry.mode === 'string' ? entry.mode : 'all',
          model: entry.model && typeof entry.model === 'string' ? entry.model : '',
          temperature: typeof entry.temperature === 'number' ? entry.temperature : '',
          prompt: typeof entry.prompt === 'string' ? entry.prompt : '',
          tools: entry.tools && typeof entry.tools === 'object' && !Array.isArray(entry.tools) ? deepCopy(entry.tools) : {},
          permission: entry.permission && typeof entry.permission === 'object' && !Array.isArray(entry.permission) ? deepCopy(entry.permission) : {},
        };
      }
      agentForm = data;
    } else {
      agentForm = {
        scope: 'project',
        isNew: true,
        name: '',
        description: '',
        mode: 'all',
        model: '',
        temperature: '',
        prompt: '',
        tools: {},
        permission: {},
        existingFile: null,
      };
    }
    agentForm.fields = agentFormFields(agentForm);
    renderActive();
  }

  function agentFormFields(data) {
    const toolState = {};
    for (const id of toolIds) toolState[id] = !(data.tools && data.tools[id] === false);
    for (const key of Object.keys(data.tools || {})) {
      if (!(key in toolState)) toolState[key] = !(data.tools[key] === false);
    }
    const name = textInput('e.g. my-reviewer', data.name);
    const scope = selectControl([
      { value: 'global', label: 'Global config' },
      { value: 'project', label: 'This project .opencode/agent' },
    ], data.isNew ? 'project' : data.scope);
    const description = textInput('What this agent is for', data.description);
    const mode = selectControl([
      { value: 'primary', label: 'primary' },
      { value: 'subagent', label: 'subagent' },
      { value: 'all', label: 'all' },
    ], data.mode || 'all');
    const model = textInput('opencode/glm-5.3-flash-free', data.model);
    const temperature = textInput('e.g. 0.4', typeof data.temperature === 'number' ? String(data.temperature) : '');
    const prompt = textArea(8, 'System prompt for the agent', data.prompt);
    const toolBoxes = [];
    const toolWrap = el('div');
    toolWrap.style.cssText = 'display:flex; flex-wrap:wrap; gap:8px; border:1px solid var(--border, #e5e7eb); border-radius:8px; padding:10px; max-height:180px; overflow-y:auto;';
    if (!toolIds.length) toolWrap.appendChild(el('span', null, 'Tool list unavailable.'));
    for (const id of Object.keys(toolState).sort()) {
      const box = checkboxRow(id, toolState[id]);
      const chip = el('label');
      chip.style.cssText = 'display:inline-flex; align-items:center; gap:5px; font-size:12px; border:1px solid var(--border, #e5e7eb); border-radius:999px; padding:3px 10px;';
      box.box.id = '';
      chip.appendChild(box.box);
      chip.appendChild(el('span', null, id));
      toolWrap.appendChild(chip);
      toolBoxes.push({ id, box: box.box });
    }
    const permSelects = {};
    for (const permKey of ['edit', 'bash', 'webfetch']) {
      const current = data.permission && typeof data.permission[permKey] === 'string' ? data.permission[permKey] : 'inherit';
      permSelects[permKey] = selectControl([
        { value: 'ask', label: 'ask' },
        { value: 'allow', label: 'allow' },
        { value: 'deny', label: 'deny' },
        { value: 'inherit', label: 'inherit' },
      ], current);
    }
    return { name, scope, description, mode, model, temperature, prompt, toolBoxes, permSelects };
  }

  function renderAgentForm(view) {
    clear(view);
    const data = agentForm;
    const head = sectionHeader(data.isNew ? 'New agent' : 'Edit agent "' + data.name + '"', 'Global scope writes the engine config; project scope writes .opencode/agent/<name>.md.');
    view.appendChild(head);

    view.appendChild(formField('Name', data.fields.name));
    view.appendChild(formField('Scope', data.fields.scope));
    view.appendChild(formField('Description', data.fields.description));
    view.appendChild(formField('Mode', data.fields.mode));
    view.appendChild(formField('Model (optional)', data.fields.model));
    view.appendChild(formField('Temperature (optional)', data.fields.temperature));
    view.appendChild(formField('Prompt', data.fields.prompt));
    view.appendChild(formField('Tools (ticked means enabled)', data.fields.toolWrap));
    for (const key of ['edit', 'bash', 'webfetch']) {
      view.appendChild(formField('Permission for ' + key, data.fields.permSelects[key]));
    }

    const errLine = el('p');
    errLine.style.cssText = 'margin:0 0 10px; font-size:12px; color:var(--danger, #dc2626);';
    view.appendChild(errLine);
    view.appendChild(formActions(saveAgentForm, cancelAgentForm, data.isNew ? 'Create' : 'Save'));
  }

  function cancelAgentForm() {
    agentForm = null;
    renderActive();
  }

  async function saveAgentForm() {
    const data = agentForm;
    const fields = data.fields;
    const name = String(fields.name.value || '').trim();
    const errHolder = dom.views.agents.querySelector('p');
    if (!validName(name)) {
      if (errHolder) errHolder.textContent = 'Invalid name. Use letters, digits, dots, underscores or hyphens, starting with a letter or digit.';
      return;
    }
    if (!data.isNew && name !== data.name) {
      if (data.hasProject || data.isNew === false && data.scope !== 'global') {
        // Renaming a project agent: handled below.
      }
    }

    const tools = {};
    for (const item of fields.toolBoxes) {
      if (!item.box.checked) tools[item.id] = false;
    }
    const permission = {};
    for (const key of Object.keys(fields.permSelects)) {
      const value = String(fields.permSelects[key].value);
      if (value !== 'inherit') permission[key] = value;
    }
    const tempRaw = String(fields.temperature.value || '').trim();
    let temperature;
    if (tempRaw !== '') {
      temperature = Number(tempRaw);
      if (!Number.isFinite(temperature)) {
        if (errHolder) errHolder.textContent = 'Temperature must be a number.';
        return;
      }
    }
    const description = String(fields.description.value || '').trim();
    const mode = String(fields.mode.value);
    const model = String(fields.model.value || '').trim();
    const prompt = String(fields.prompt.value || '');

    const scope = String(fields.scope.value);

    if (scope === 'global') {
      const next = deepCopy(config);
      const cfgAgents = next.agent && typeof next.agent === 'object' ? next.agent : (next.agent = {});
      cfgAgents[name] = {
        description,
        mode,
        prompt,
      };
      if (model) cfgAgents[name].model = model;
      if (temperature !== undefined) cfgAgents[name].temperature = temperature;
      cfgAgents[name].tools = tools;
      cfgAgents[name].permission = permission;
      if (!data.isNew && data.scope === 'global' && data.name && data.name !== name && cfgAgents[data.name] && !cfgAgents[data.name].builtIn) {
        delete cfgAgents[data.name];
      }
      agentForm = null;
      await saveConfig(next);
      return;
    }

    // Project agent file.
    const dir = projectDir();
    if (!dir) {
      if (errHolder) errHolder.textContent = 'Open a project first to save agents in this project.';
      return;
    }
    const preservedTools = {};
    for (const key of Object.keys(data.tools || {})) {
      if (data.tools[key] && typeof data.tools[key] === 'object') continue;
      if (!Object.keys(tools).concat(Object.keys(toolIds)).some(function (k) { return k === key; })) {
        // Keep any tool that came from an existing file and is not offered as a checkbox.
      } else {
        continue;
      }
      preservedTools[key] = !!data.tools[key];
    }
    const permissionOut = Object.assign({}, permission);
    if (data.permission) {
      for (const key of Object.keys(data.permission)) {
        const value = data.permission[key];
        if (value && typeof value === 'object' && !(key in permissionOut)) permissionOut[key] = value;
      }
    }
    const front = [];
    front.push({ description, mode });
    if (model) front.push({ model });
    if (temperature !== undefined) front.push({ temperature });
    front.push({ tools });
    front.push({ permission: permissionOut });
    const nameChanged = !data.isNew && data.existingFile && stripMd(String(data.existingFile)) !== name;
    if (nameChanged) {
      try {
        await window.cordoval.deleteProjectFile(dir, 'agent', String(data.existingFile));
      } catch (err) { /* best effort */ }
    }
    const content = frontmatterText(front) + '\n\n' + prompt + '\n';
    await writeProjectFile(dir, 'agent', ensureMd(name), content);
    agentForm = null;
    await fetchProjectFiles();
    renderActive();
  }

  async function deleteAgent(rec) {
    if (!window.confirm('Delete agent "' + rec.name + '"?')) return;
    if (rec.hasProject && rec.file) {
      const dir = projectDir();
      if (dir) {
        try {
          await window.cordoval.deleteProjectFile(dir, 'agent', rec.file);
          toast('Deleted ' + rec.name + '.');
        } catch (err) {
          toast('Could not delete the agent file: ' + errMsg(err), 'error');
        }
      }
    }
    if (rec.hasGlobal) {
      const next = deepCopy(config);
      delete next.agent[rec.name];
      await saveConfig(next);
    }
    await fetchProjectFiles();
    renderActive();
  }

  // ---- Tab 3: Commands ----

  function commandRoster() {
    const map = {};
    const serverRecords = {};
    for (const rec of commandsList) {
      if (!rec || !rec.name) continue;
      const name = String(rec.name);
      serverRecords[name] = rec;
      map[name] = { name, description: rec.description || '', template: rec.template || '', hasGlobal: false, hasProject: false, file: null };
    }
    const cfgCommands = config.command && typeof config.command === 'object' ? config.command : {};
    for (const name of Object.keys(cfgCommands)) {
      if (!map[name]) {
        const entry = cfgCommands[name];
        map[name] = {
          name,
          description: entry && entry.description ? String(entry.description) : '',
          template: entry && entry.template ? String(entry.template) : '',
          hasGlobal: false,
          hasProject: false,
          file: null,
        };
      }
      map[name].hasGlobal = true;
    }
    for (const line of projectCommands) {
      const name = stripMd(line && line.name);
      if (!name) continue;
      if (!map[name]) {
        map[name] = { name, description: '', template: '', hasGlobal: false, hasProject: false, file: null };
      }
      map[name].hasProject = true;
      map[name].file = String(line.name || ensureMd(name));
      const expectedResult = commandSourceRecord(line);
      if (expectedResult) {
        map[name].description = map[name].description || expectedResult.description || '';
        map[name].template = map[name].template || expectedResult.template || '';
      }
    }
    return Object.keys(map).sort().map(function (key) { return map[key]; });
  }

  function commandSourceRecord(fileRef) {
    const parsed = parseFrontmatter(fileRef && fileRef.content);
    return {
      description: parsed.meta.description === undefined ? '' : String(parsed.meta.description),
      template: parsed.body.trim(),
    };
  }

  function renderCommandsList(view) {
    clear(view);
    const headRow = el('div');
    headRow.style.cssText = 'display:flex; align-items:center; justify-content:space-between; gap:10px; margin-bottom:14px;';
    headRow.appendChild(sectionHeader('Commands', 'Slash commands from the engine config and .opencode/command.'));
    headRow.appendChild(actionButton('New command', 'btn btn-secondary btn-sm', function () {
      openCommandForm(null, 'create');
    }));
    view.appendChild(headRow);

    const roster = commandRoster();
    if (!roster.length) {
      view.appendChild(el('p', null, 'No commands configured.'));
      return;
    }
    for (const rec of roster) {
      view.appendChild(commandRow(rec));
    }
  }

  function commandRow(rec) {
    const card = el('div');
    card.style.cssText = CARD_CSS;
    const head = el('div');
    head.style.cssText = FLEX_CSS + ' flex-wrap:nowrap;';
    const nameEl = el('span', null, rec.name);
    nameEl.style.cssText = 'font-weight:650; font-size:13px;';
    head.appendChild(nameEl);
    const spacer = el('span');
    spacer.style.cssText = 'flex:1 1 auto;';
    head.appendChild(spacer);
    const tag = rec.hasProject ? 'Project .opencode/command' : 'Global config';
    const tagEl = el('span', null, tag);
    tagEl.style.cssText = 'font-size:11px; color:var(--muted, #6b7280);';
    head.appendChild(tagEl);
    card.appendChild(head);

    if (rec.description) {
      const desc = el('div', null, rec.description);
      desc.style.cssText = 'margin-top:4px; font-size:12px; color:var(--muted, #6b7280); word-break:break-word;';
      card.appendChild(desc);
    }

    const actions = el('div');
    actions.style.cssText = FLEX_CSS + ' margin-top:10px;';
    if (rec.hasProject || rec.hasGlobal) {
      actions.appendChild(actionButton('Edit', 'btn btn-ghost btn-sm', function () {
        openCommandForm(rec, 'edit');
      }));
      actions.appendChild(actionButton('Delete', 'btn btn-ghost btn-sm', function () {
        deleteCommand(rec);
      }, 'color: var(--danger, #dc2626);'));
    } else {
      actions.appendChild(el('span', null, 'Available from the engine. Edit in the config to change it.'));
    }
    card.appendChild(actions);
    return card;
  }

  function readCommandSource(rec) {
    let scope = 'global';
    let isNew = false;
    let existingFile = null;
    let description = '';
    let agent = '';
    let model = '';
    let subtask = false;
    let template = '';
    if (rec.hasProject) {
      scope = 'project';
      existingFile = rec.file || ensureMd(rec.name);
      const file = projectCommands.find(function (f) { return stripMd(f && f.name) === rec.name; });
      if (file && file.content != null) {
        const parsed = parseFrontmatter(file.content);
        description = parsed.meta.description === undefined ? '' : String(parsed.meta.description);
        agent = typeof parsed.meta.agent === 'string' ? parsed.meta.agent : '';
        model = typeof parsed.meta.model === 'string' ? parsed.meta.model : '';
        subtask = parsed.meta.subtask === true;
        template = parsed.body.trim();
      }
    } else {
      const cfgCommands = config.command && typeof config.command === 'object' ? config.command : {};
      const entry = cfgCommands[rec.name] && typeof cfgCommands[rec.name] === 'object' ? cfgCommands[rec.name] : {};
      description = entry.description === undefined ? '' : String(entry.description);
      agent = typeof entry.agent === 'string' ? entry.agent : '';
      model = typeof entry.model === 'string' ? entry.model : '';
      subtask = entry.subtask === true;
      template = typeof entry.template === 'string' ? entry.template : '';
      if (serverAgentsNeeded()) { /* populated above */ }
    }
    return { scope, isNew, existingFile, description, agent, model, subtask, template };
  }

  function serverAgentsNeeded() {
    return agentsList.filter(function (a) { return a && a.name; });
  }

  function openCommandForm(rec, mode) {
    if (mode === 'edit') {
      commandForm = readCommandSource(rec);
      commandForm.name = rec.name;
      commandForm.hasGlobal = !!rec.hasGlobal;
      commandForm.hasProject = !!rec.hasProject;
    } else {
      commandForm = {
        scope: 'project', isNew: true, existingFile: null,
        name: '', description: '', agent: '', model: '', subtask: false, template: '',
      };
    }
    commandForm.fields = commandFormFields(commandForm);
    renderActive();
  }

  function commandFormFields(data) {
    const name = textInput('e.g. fix-issue', data.name);
    const scope = selectControl([
      { value: 'global', label: 'Global' },
      { value: 'project', label: 'Project .opencode/command' },
    ], data.isNew ? 'project' : data.scope);
    const description = textInput('What the command does', data.description);
    const agentOptions = [{ value: '', label: '(no agent)' }];
    for (const recOfServer of agentsList) {
      if (recOfServer && recOfServer.name) {
        agentOptions.push({ value: String(recOfServer.name), label: String(recOfServer.name) });
      }
    }
    const agent = selectControl(agentOptions, data.agent || '');
    const model = textInput('optional', data.model);
    const subtask = checkboxRow('Subtask (run as a background task)', data.subtask);
    const template = textArea(8, '$ARGUMENTS, $1, !`shell`, @file', data.template);
    const subtaskWrap = el('div');
    subtaskWrap.style.cssText = 'margin-bottom:12px;';
    subtaskWrap.appendChild(subtask.label);
    return { name, scope, description, agent, model, subtask, template, subtaskWrap };
  }

  function renderCommandForm(view) {
    clear(view);
    const data = commandForm;
    const head = sectionHeader(data.isNew ? 'New command' : 'Edit command "' + data.name + '"', 'Global scope writes the engine config; project scope writes .opencode/command/<name>.md. Template placeholders: $ARGUMENTS, $1, !`shell`, @file.');
    view.appendChild(head);

    view.appendChild(formField('Name', data.fields.name));
    view.appendChild(formField('Scope', data.fields.scope));
    view.appendChild(formField('Description', data.fields.description));
    view.appendChild(formField('Agent (optional)', data.fields.agent));
    view.appendChild(formField('Model (optional)', data.fields.model));
    view.appendChild(data.fields.subtaskWrap);
    view.appendChild(formField('Template', data.fields.template));

    const errLine = el('p');
    errLine.style.cssText = 'margin:0 0 10px; font-size:12px; color:var(--danger, #dc2626);';
    view.appendChild(errLine);
    view.appendChild(formActions(saveCommandForm, cancelCommandForm, data.isNew ? 'Create' : 'Save'));
  }

  function cancelCommandForm() {
    commandForm = null;
    renderActive();
  }

  async function saveCommandForm() {
    const data = commandForm;
    const fields = data.fields;
    const errHolder = dom.views.commands.querySelector('p');
    const name = String(fields.name.value || '').trim();
    if (!validName(name)) {
      if (errHolder) errHolder.textContent = 'Invalid name. Use letters, digits, dots, underscores or hyphens, starting with a letter or digit.';
      return;
    }
    const description = String(fields.description.value || '').trim();
    const agent = String(fields.agent.value || '').trim();
    const model = String(fields.model.value || '').trim();
    const subtask = !!fields.subtask.checked;
    const template = String(fields.template.value || '');
    const scope = String(fields.scope.value);

    if (scope === 'global') {
      const next = deepCopy(config);
      const cfgCommands = next.command && typeof next.command === 'object' ? next.command : (next.command = {});
      cfgCommands[name] = {
        template,
        description,
      };
      if (agent) cfgCommands[name].agent = agent;
      if (model) cfgCommands[name].model = model;
      if (subtask) cfgCommands[name].subtask = subtask;
      if (!data.isNew && data.scope === 'global' && data.name && data.name !== name && cfgCommands[data.name]) {
        delete cfgCommands[data.name];
      }
      commandForm = null;
      await saveConfig(next);
      return;
    }

    const dir = projectDir();
    if (!dir) {
      if (errHolder) errHolder.textContent = 'Open a project first to save commands in this project.';
      return;
    }
    const front = [];
    front.push({ description });
    if (agent) front.push({ agent });
    if (model) front.push({ model });
    if (subtask) front.push({ subtask: true });
    const content = frontmatterText(front) + '\n\n' + template + '\n';
    const nameChanged = !data.isNew && data.existingFile && stripMd(String(data.existingFile)) !== name;
    if (nameChanged) {
      try {
        await window.cordoval.deleteProjectFile(dir, 'command', String(data.existingFile));
      } catch (err) { /* best effort */ }
    }
    await writeProjectFile(dir, 'command', ensureMd(name), content);
    commandForm = null;
    await fetchProjectFiles();
    renderActive();
  }

  async function deleteCommand(rec) {
    if (!window.confirm('Delete command "' + rec.name + '"?')) return;
    if (rec.hasProject && rec.file) {
      const dir = projectDir();
      if (dir) {
        try {
          await window.cordoval.deleteProjectFile(dir, 'command', rec.file);
          toast('Deleted ' + rec.name + '.');
        } catch (err) {
          toast('Could not delete the command file: ' + errMsg(err), 'error');
        }
      }
    }
    if (rec.hasGlobal) {
      const next = deepCopy(config);
      delete next.command[rec.name];
      await saveConfig(next);
    }
    await fetchProjectFiles();
    renderActive();
  }

  // ---- Tab 4: Permissions ----

  function permissionDraft() {
    const perm = config.permission && typeof config.permission === 'object' && !Array.isArray(config.permission) ? config.permission : {};
    const rows = {};
    let bashDefault = perm.bash;
    if (bashDefault && typeof bashDefault === 'object' && !Array.isArray(bashDefault)) {
      bashDefault = bashDefault['*'] !== undefined ? bashDefault['*'] : '';
    }
    for (const tool of PERM_TOOLS) {
      const value = typeof perm[tool] === 'string' ? perm[tool] : 'default';
      rows[tool] = ['allow', 'ask', 'deny', 'default'].indexOf(value) >= 0 ? value : 'default';
    }
    rows.bash = typeof bashDefault === 'string' && ['allow', 'ask', 'deny'].indexOf(bashDefault) >= 0 ? bashDefault : 'default';
    // bash tools should also resolve to 'default' if unset, but keep explicit value for '*'.
    const bashRules = [];
    const bashConfig = perm.bash && typeof perm.bash === 'object' && !Array.isArray(perm.bash) ? perm.bash : null;
    if (bashConfig) {
      for (const pattern of Object.keys(bashConfig).sort()) {
        if (pattern === '*') continue;
        const action = bashConfig[pattern];
        if (!['allow', 'ask', 'deny'].includes(action)) continue;
        bashRules.push({ pattern: String(pattern), action });
      }
    }
    const preserved = deepCopy(perm);
    return { rows, bashRules, preserved, preservedKeyMap: Object.keys(preserved) };
  }

  function renderPermissionsList(view) {
    clear(view);
    const draft = permissionDraft();
    view.appendChild(sectionHeader('Permissions', 'Which tools may run freely. Entries left on Default are omitted from the config. Bash command rules use shell-like patterns, e.g. "git status" allow, "rm *" deny.'));

    const selects = {};
    const cards = [];
    for (const tool of PERM_TOOLS) {
      const card = el('div');
      card.style.cssText = FLEX_CSS + ' justify-content:space-between; border-bottom:1px solid var(--border, #e5e7eb); padding:8px 2px;';
      const left = el('div');
      const nameLabel = el('div', null, tool);
      nameLabel.style.cssText = 'font-weight:650; font-size:13px;';
      const hint = el('div', null, PERM_HINTS[tool] || '');
      hint.style.cssText = 'font-size:11px; color:var(--muted, #6b7280);';
      left.appendChild(nameLabel);
      left.appendChild(hint);
      const sel = selectControl([
        { value: 'allow', label: 'Allow' },
        { value: 'ask', label: 'Ask' },
        { value: 'deny', label: 'Deny' },
        { value: 'default', label: 'Default' },
      ], tool === 'bash' ? (draft.rows[tool] === 'default' ? 'default' : draft.rows[tool]) : draft.rows[tool]);
      sel.style.width = '140px';
      card.appendChild(left);
      card.appendChild(sel);
      selects[tool] = sel;
      cards.push(card);
    }
    for (const card of cards) view.appendChild(card);

    const bashCard = el('div');
    bashCard.style.cssText = CARD_CSS + ' margin-top:16px;';
    const bashHead = sectionHeader('Bash command rules', 'Pattern to action pairs, saved under permission.bash alongside the bash default above.');
    bashCard.appendChild(bashHead);
    const ruleRows = [];
    const rulesHost = el('div');
    bashCard.appendChild(rulesHost);

    function addRuleRow(patternText, action) {
      const row = el('div');
      row.style.cssText = FLEX_CSS + ' margin-bottom:8px;';
      const patternInput = textInput('e.g. git status', patternText || '');
      patternInput.style.flex = '1 1 auto';
      const actionSel = selectControl([
        { value: 'allow', label: 'Allow' },
        { value: 'ask', label: 'Ask' },
        { value: 'deny', label: 'Deny' },
      ], action || 'deny');
      actionSel.style.width = '110px';
      const remove = actionButton('Remove', 'btn btn-ghost btn-sm', function () {
        ruleRows.splice(ruleRows.indexOf(entry), 1);
        row.parentNode.removeChild(row);
      });
      rulesHost.appendChild(row);
      const entry = { patternInput, actionSel };
      row.appendChild(patternInput);
      row.appendChild(actionSel);
      row.appendChild(remove);
      ruleRows.push(entry);
    }
    for (const rule of draft.bashRules) addRuleRow(rule.pattern, rule.action);
    if (!draft.bashRules.length) {
      const emptyNote = el('div', null, 'No rules yet.');
      emptyNote.style.cssText = 'font-size:12px; color:var(--muted, #6b7280); margin-bottom:8px;';
      rulesHost.appendChild(emptyNote);
    }
    bashCard.appendChild(actionButton('Add rule', 'btn btn-secondary btn-sm', function () {
      addRuleRow('', 'deny');
    }));
    view.appendChild(bashCard);

    const errLine = el('p');
    errLine.style.cssText = 'margin:10px 0; font-size:12px; color:var(--danger, #dc2626);';
    view.appendChild(errLine);
    view.appendChild(actionButton('Save permissions', 'btn btn-primary btn-sm', async function () {
      const next = deepCopy(config);
      const out = next.permission && typeof next.permission === 'object' && !Array.isArray(next.permission) ? deepCopy(next.permission) : {};
      for (const tool of PERM_TOOLS) delete out[tool];
      for (const tool of PERM_TOOLS) {
        const value = String(selects[tool].value);
        if (value !== 'default') out[tool] = value;
      }
      delete out.bash;
      const rules = {};
      const bashValue = String(selects.bash.value);
      if (bashValue !== 'default') rules['*'] = bashValue;
      for (const rule of ruleRows) {
        const pattern = String(rule.patternInput.value).trim();
        if (!pattern) {
          errLine.textContent = 'One of the bash rules has an empty pattern.';
          return;
        }
        rules[pattern] = String(rule.actionSel.value);
      }
      if (Object.keys(rules).length) out.bash = rules;
      next.permission = out;
      await saveConfig(next);
      renderActive();
    }));
  }

  // ---- entry points ----

  async function openModal(tab) {
    buildModal();
    if (!dom.backdrop.hidden) {
      // already open
      if (tab && TABS.indexOf(tab) >= 0) setTab(tab);
      return;
    }
    dom.backdrop.hidden = false;
    const target = tab && TABS.indexOf(tab) >= 0 ? tab : active;
    active = target;
    for (const name of TABS) {
      dom.tabBtns[name].classList.toggle('is-active', name === target);
      dom.views[name].classList.toggle('is-active', name === target);
      clear(dom.views[name]);
      dom.views[name].appendChild(el('p', null, 'Loading...'));
    }
    mcpForm = null;
    agentForm = null;
    commandForm = null;
    authStarted = {};
    try {
      await refreshAll();
    } catch (err) {
      toast('Could not load customisation data: ' + errMsg(err), 'error');
    }
    renderActive();
    if (target !== active) setTab(target);
  }

  function init() {
    installButton();
    buildModal();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.Customize = {
    open: openModal,
  };
})();
