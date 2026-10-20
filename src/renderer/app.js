'use strict';

(function () {
  const DEFAULT_MODEL = { providerID: 'opencode', modelID: 'glm-5.3-flash-free' };
  const PROVIDER_LABELS = {
    openrouter: 'OpenRouter',
    openai: 'OpenAI',
    anthropic: 'Anthropic',
    google: 'Google Gemini',
    groq: 'Groq',
    xai: 'xAI',
  };
  const CUSTOM_PRESETS = [
    { id: 'ollama', name: 'Ollama', baseURL: 'http://127.0.0.1:11434/v1' },
    { id: 'lmstudio', name: 'LM Studio', baseURL: 'http://127.0.0.1:1234/v1' },
  ];
  const BUILDER_SYSTEM = [
    'You are Cordoval Code, an expert software engineering agent working inside a freshly created project folder.',
    'Plan first, create a complete project structure, run install/build/test commands, fix errors until green,',
    'and finish with a short summary. Never use emojis. Never write the word "company". Never hardcode secrets.',
  ].join('\n ');

  const MAX_FILE_BYTES = 20 * 1024 * 1024;
  const INIT_PROMPT = 'Analyse this project and create or update AGENTS.md with build, test and style instructions';

  const state = {
    ready: false,
    directory: null,
    engineUrl: null,
    sessions: [],
    sessionId: null,
    messages: [],
    busyBySession: {},
    agentBySession: {},
    permissions: {},
    diffs: {},
    providers: [],
    providerDefault: {},
    theme: 'light',
    keysMeta: [],
    customEndpoints: [],
    selectedTemplateId: null,
    templates: [],
    rightTab: 'files',
    fileTreeExpanded: {},
    renamingId: null,
    vcsMissing: false,
    attachments: [],
    serverCommands: [],
    commandsLoaded: false,
    customAgents: [],
  };

  const slash = { open: false, items: [], index: 0 };
  let attachmentSeq = 0;

  const els = {};

  function $(id) {
    return document.getElementById(id);
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function clear(node) {
    while (node && node.firstChild) node.removeChild(node.firstChild);
  }

  function toast(message, kind) {
    const host = els.toastHost;
    if (!host) return;
    const item = el('div', 'toast' + (kind === 'error' ? ' error' : ''), message);
    host.appendChild(item);
    setTimeout(function () {
      if (item.parentNode) item.parentNode.removeChild(item);
    }, kind === 'error' ? 6000 : 3200);
  }

  function errorMessage(err) {
    if (!err) return 'Unknown error';
    return String(err.message || err);
  }

  function projectName(dir) {
    if (!dir) return '';
    const parts = String(dir).split(/[\\/]/).filter(Boolean);
    return parts.length ? parts[parts.length - 1] : String(dir);
  }

  function baseName(path) {
    return projectName(path);
  }

  function normalizeTime(value) {
    const n = Number(value || 0);
    if (!n) return 0;
    return n < 1e12 ? n * 1000 : n;
  }

  function relativeTime(value) {
    const ts = normalizeTime(value);
    if (!ts) return '';
    const diff = Math.max(0, Date.now() - ts);
    const sec = Math.floor(diff / 1000);
    if (sec < 45) return 'just now';
    const min = Math.floor(sec / 60);
    if (min < 60) return min + 'm ago';
    const hr = Math.floor(min / 60);
    if (hr < 24) return hr + 'h ago';
    const days = Math.floor(hr / 24);
    if (days < 7) return days + 'd ago';
    return new Date(ts).toLocaleDateString();
  }

  function sessionTitle(session) {
    const title = session && session.title ? String(session.title).trim() : '';
    if (title) return title;
    const id = session && session.id ? String(session.id) : '';
    return id ? 'Session ' + id.slice(-6) : 'Untitled session';
  }

  function isBusy(id) {
    return !!(id && state.busyBySession[id]);
  }

  function readRecent() {
    try {
      const list = JSON.parse(localStorage.getItem('cordoval:recent') || '[]');
      return Array.isArray(list) ? list.filter(Boolean) : [];
    } catch (err) {
      return [];
    }
  }

  function pushRecent(dir) {
    if (!dir) return;
    const list = readRecent().filter(function (item) {
      return item !== dir;
    });
    list.unshift(dir);
    while (list.length > 8) list.pop();
    try {
      localStorage.setItem('cordoval:recent', JSON.stringify(list));
    } catch (err) {
      // ignore quota
    }
  }

  function modelKey(sessionId) {
    return 'cordoval:model:' + sessionId;
  }

  function agentKey(sessionId) {
    return 'cordoval:agent:' + sessionId;
  }

  function storedModel(sessionId) {
    try {
      const raw = localStorage.getItem(modelKey(sessionId));
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (parsed && parsed.providerID && parsed.modelID) return parsed;
    } catch (err) {
      // ignore
    }
    return null;
  }

  function saveModel(sessionId, model) {
    if (!sessionId || !model) return;
    try {
      localStorage.setItem(modelKey(sessionId), JSON.stringify(model));
    } catch (err) {
      // ignore
    }
  }

  function storedAgent(sessionId) {
    const value = localStorage.getItem(agentKey(sessionId));
    if (value === 'plan') return 'plan';
    if (value && (state.customAgents || []).some(function (a) { return a.name === value; })) return value;
    return 'build';
  }

  function saveAgent(sessionId, agent) {
    if (!sessionId) return;
    try {
      localStorage.setItem(agentKey(sessionId), agent);
    } catch (err) {
      // ignore
    }
  }

  function currentModel() {
    const stored = storedModel(state.sessionId);
    if (stored) return stored;
    const def = state.providerDefault;
    if (def && def.providerID && def.modelID) {
      return { providerID: def.providerID, modelID: def.modelID };
    }
    return { providerID: DEFAULT_MODEL.providerID, modelID: DEFAULT_MODEL.modelID };
  }

  function currentAgent() {
    return storedAgent(state.sessionId);
  }

  function applyTheme(theme) {
    const next = theme === 'dark' ? 'dark' : 'light';
    state.theme = next;
    document.documentElement.setAttribute('data-theme', next);
    if (window.TerminalPanel) window.TerminalPanel.applyTheme();
    const radios = document.querySelectorAll('input[name="theme"]');
    for (const radio of radios) {
      radio.checked = radio.value === next;
    }
  }

  async function loadSettings() {
    if (!window.cordoval || !window.cordoval.getSettings) return {};
    try {
      const settings = await window.cordoval.getSettings();
      applyTheme((settings && settings.theme) || 'light');
      return settings || {};
    } catch (err) {
      applyTheme('light');
      return {};
    }
  }

  async function persistTheme(theme) {
    applyTheme(theme);
    if (window.cordoval && window.cordoval.setSettings) {
      try {
        await window.cordoval.setSettings({ theme });
      } catch (err) {
        // non-fatal
      }
    }
  }

  function cacheElements() {
    els.app = $('app');
    els.welcome = $('welcome');
    els.recentList = $('recent-list');
    els.recentEmpty = $('recent-empty');
    els.titleProject = $('titlebar-project');
    els.sidebarProjectName = $('sidebar-project-name');
    els.sessionList = $('session-list');
    els.messages = $('messages');
    els.emptyChat = $('empty-chat');
    els.composer = $('composer');
    els.composerInput = $('composer-input');
    els.composerAttachments = $('composer-attachments');
    els.slashMenu = $('slash-menu');
    els.attachInput = $('attach-input');
    els.btnAttach = $('btn-attach');
    els.helpBackdrop = $('help-backdrop');
    els.helpList = $('help-list');
    els.modelPicker = $('model-picker');
    els.btnSend = $('btn-send');
    els.btnStop = $('btn-stop');
    els.agentBuild = $('btn-agent-build');
    els.agentPlan = $('btn-agent-plan');
    els.revertBanner = $('revert-banner');
    els.revertBannerText = $('revert-banner-text');
    els.permissionHost = $('permission-host');
    els.fileTree = $('file-tree');
    els.changesList = $('changes-list');
    els.searchInput = $('search-input');
    els.searchResults = $('search-results');
    els.diagnosticsList = $('diagnostics-list');
    els.statusEngine = $('status-engine');
    els.settingsBackdrop = $('settings-backdrop');
    els.settingsProviders = $('settings-providers');
    els.settingsCustom = $('settings-custom');
    els.templatesBackdrop = $('templates-backdrop');
    els.templatesGrid = $('templates-grid');
    els.templateName = $('template-name');
    els.templateParent = $('template-parent');
    els.templateError = $('template-error');
    els.toastHost = $('toast-host');
  }

  function showWelcome(show) {
    els.welcome.hidden = !show;
    els.app.hidden = show;
  }

  function renderRecent() {
    const list = readRecent();
    clear(els.recentList);
    els.recentEmpty.hidden = list.length > 0;
    for (const dir of list) {
      const btn = el('button', 'recent-item');
      btn.type = 'button';
      btn.title = dir;
      btn.textContent = dir;
      btn.addEventListener('click', function () {
        openProject(dir).catch(function (err) {
          toast(errorMessage(err), 'error');
        });
      });
      els.recentList.appendChild(btn);
    }
  }

  function updateProjectChrome() {
    const name = state.directory ? projectName(state.directory) : 'No project';
    els.titleProject.textContent = state.directory || 'No project open';
    els.titleProject.title = state.directory || '';
    els.sidebarProjectName.textContent = name;
  }

  async function refreshSessions() {
    if (!state.directory) return;
    try {
      const list = await window.Api.listSessions();
      state.sessions = Array.isArray(list) ? list.slice() : [];
    } catch (err) {
      state.sessions = [];
    }
    if (state.sessions.length && !state.sessions.some(function (s) { return s.id === state.sessionId; })) {
      await selectSession(state.sessions[0].id);
    }
    renderSessions();
  }

  function renderSessions() {
    clear(els.sessionList);
    if (!state.sessions.length) {
      const empty = el('div', 'empty-note', 'No sessions yet.');
      els.sessionList.appendChild(empty);
      return;
    }
    const sorted = state.sessions.slice().sort(function (a, b) {
      return normalizeTime((b.time && b.time.updated) || (b.time && b.time.created) || 0) -
        normalizeTime((a.time && a.time.updated) || (a.time && a.time.created) || 0);
    });
    for (const session of sorted) {
      const item = el('button', 'session-item');
      item.type = 'button';
      item.dataset.id = session.id;
      if (session.id === state.sessionId) item.classList.add('is-active');

      const titleRow = el('div', 'session-title');
      const dot = el('span', 'busy-dot' + (isBusy(session.id) ? '' : ' is-idle'));
      titleRow.appendChild(dot);

      if (state.renamingId === session.id) {
        const input = el('input', 'session-rename-input');
        input.value = sessionTitle(session);
        input.addEventListener('click', function (event) {
          event.stopPropagation();
        });
        input.addEventListener('keydown', function (event) {
          event.stopPropagation();
          if (event.key === 'Enter') {
            event.preventDefault();
            commitRename(session.id, input.value);
          } else if (event.key === 'Escape') {
            state.renamingId = null;
            renderSessions();
          }
        });
        titleRow.appendChild(input);
        item.appendChild(titleRow);
        els.sessionList.appendChild(item);
        requestAnimationFrame(function () {
          input.focus();
          input.select();
        });
        continue;
      }

      const text = el('span', 'session-title-text', sessionTitle(session));
      titleRow.appendChild(text);

      const actions = el('div', 'session-actions');
      const renameBtn = el('button', 'icon-btn');
      renameBtn.type = 'button';
      renameBtn.title = 'Rename session';
      renameBtn.innerHTML = '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path fill="currentColor" d="M11.85 2.15a1.5 1.5 0 0 1 0 2.12l-7.5 7.5-2.93.88a.75.75 0 0 1-.95-.95l.88-2.93 7.5-7.5a1.5 1.5 0 0 1 2.12 0l.88.88Zm-8.3 9.73.56-1.87 1.31 1.31-1.87.56Z"/></svg>';
      renameBtn.addEventListener('click', function (event) {
        event.stopPropagation();
        state.renamingId = session.id;
        renderSessions();
      });
      const deleteBtn = el('button', 'icon-btn');
      deleteBtn.type = 'button';
      deleteBtn.title = 'Delete session';
      deleteBtn.innerHTML = '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path fill="currentColor" d="M5.75 2h4.5A1.25 1.25 0 0 1 11.5 3.25V4h1.75a.75.75 0 0 1 0 1.5H2.75a.75.75 0 0 1 0-1.5H4.5v-.75C4.5 2.56 5.06 2 5.75 2ZM4.5 5.5h7l-.66 7.17A1.75 1.75 0 0 1 9.1 14.2H6.9a1.75 1.75 0 0 1-1.74-1.53L4.5 5.5Z"/></svg>';
      deleteBtn.addEventListener('click', function (event) {
        event.stopPropagation();
        deleteSession(session.id);
      });
      actions.appendChild(renameBtn);
      actions.appendChild(deleteBtn);

      item.appendChild(titleRow);
      item.appendChild(actions);
      const meta = el('div', 'session-meta', relativeTime((session.time && (session.time.updated || session.time.created)) || 0));
      item.appendChild(meta);
      item.addEventListener('click', function () {
        selectSession(session.id).catch(function (err) {
          toast(errorMessage(err), 'error');
        });
      });
      els.sessionList.appendChild(item);
    }
  }

  async function commitRename(id, value) {
    const title = String(value || '').trim();
    state.renamingId = null;
    if (!title) {
      renderSessions();
      return;
    }
    try {
      await window.Api.renameSession(id, title);
      const session = state.sessions.find(function (s) { return s.id === id; });
      if (session) session.title = title;
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
    renderSessions();
    if (id === state.sessionId) updateRevertBanner();
  }

  async function deleteSession(id, skipConfirm) {
    const target = state.sessions.find(function (s) { return s.id === id; });
    if (!skipConfirm && !window.confirm('Delete the session "' + ((target && target.title) || id) + '"? This cannot be undone.')) return;
    try {
      await window.Api.deleteSession(id);
      state.sessions = state.sessions.filter(function (s) { return s.id !== id; });
      delete state.busyBySession[id];
      delete state.diffs[id];
      delete state.permissions[id];
      if (state.sessionId === id) {
        state.sessionId = null;
        state.messages = [];
        renderMessages();
        if (state.sessions.length) {
          await selectSession(state.sessions[0].id);
        } else {
          const created = await window.Api.createSession();
          state.sessions.push(created);
          await selectSession(created.id);
        }
      }
      renderSessions();
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  }

  async function newSession() {
    if (!state.directory) return;
    try {
      const created = await window.Api.createSession();
      if (created && created.id) {
        state.sessions.unshift(created);
        await selectSession(created.id);
        renderSessions();
      }
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  }

  async function selectSession(id) {
    if (!id) return;
    state.sessionId = id;
    renderSessions();
    renderModelPicker();
    renderAgentToggle();
    updateStopButton();
    updateRevertBanner();
    renderPermissions();
    try {
      const list = await window.Api.getMessages(id);
      state.messages = Array.isArray(list) ? list.map(normalizeMessage) : [];
    } catch (err) {
      state.messages = [];
    }
    renderMessages();
    if (state.rightTab === 'changes') refreshChanges();
  }

  function normalizeMessage(entry) {
    const info = entry && entry.info ? entry.info : entry || {};
    const parts = entry && Array.isArray(entry.parts) ? entry.parts : [];
    return {
      info: info,
      parts: parts.slice(),
    };
  }

  function findMessage(messageId) {
    return state.messages.find(function (m) {
      return m.info && m.info.id === messageId;
    });
  }

  function upsertMessage(info) {
    if (!info || !info.id) return null;
    let message = findMessage(info.id);
    if (!message) {
      message = { info: info, parts: [] };
      state.messages.push(message);
      sortMessages();
    } else {
      message.info = Object.assign({}, message.info, info);
    }
    return message;
  }

  function sortMessages() {
    state.messages.sort(function (a, b) {
      const ta = normalizeTime(a.info && a.info.time && a.info.time.created);
      const tb = normalizeTime(b.info && b.info.time && b.info.time.created);
      return ta - tb;
    });
  }

  function upsertPart(message, part) {
    if (!message || !part || !part.id) return null;
    const index = message.parts.findIndex(function (p) { return p.id === part.id; });
    if (index >= 0) {
      message.parts[index] = Object.assign({}, message.parts[index], part);
      return message.parts[index];
    }
    message.parts.push(part);
    return part;
  }

  function renderMarkdown(target, text) {
    const value = String(text || '');
    if (window.marked && typeof window.marked.parse === 'function') {
      target.innerHTML = window.marked.parse(value, { async: false, breaks: true });
    } else {
      target.textContent = value;
    }
  }

  function formatToolValue(value) {
    if (value == null) return '';
    if (typeof value === 'string') return value;
    try {
      return JSON.stringify(value, null, 2);
    } catch (err) {
      return String(value);
    }
  }

  function renderToolCard(part) {
    const details = el('details', 'tool-card part');
    details.dataset.partId = part.id;
    const stateInfo = part.state || {};
    const status = String(stateInfo.status || 'pending');
    state.openTools = state.openTools || {};
    if (part.id in state.openTools) details.open = !!state.openTools[part.id];
    else if (status === 'error') details.open = true;
    details.addEventListener('toggle', function () { state.openTools[part.id] = details.open; });

    const summary = el('summary');
    summary.appendChild(el('span', 'tool-name', part.tool || 'tool'));
    summary.appendChild(el('span', 'tool-title', stateInfo.title || ''));
    summary.appendChild(el('span', 'tool-status ' + status, status));
    details.appendChild(summary);

    const body = el('div', 'tool-body');
    const inputText = formatToolValue(stateInfo.input);
    if (inputText) {
      const label = el('div', 'tool-section-label', 'Input');
      const pre = el('pre', 'tool-pre', inputText);
      body.appendChild(label);
      body.appendChild(pre);
    }
    const outputText = formatToolValue(stateInfo.output);
    if (outputText) {
      const label = el('div', 'tool-section-label', 'Output');
      const pre = el('pre', 'tool-pre', outputText);
      body.appendChild(label);
      body.appendChild(pre);
    }
    if (stateInfo.error) {
      body.appendChild(el('div', 'tool-error', String(stateInfo.error)));
    }
    if (body.childNodes.length) details.appendChild(body);
    return details;
  }

  function renderFilePart(part) {
    const chip = el('div', 'part file-part');
    chip.dataset.partId = part.id || '';
    const mime = String(part.mime || '');
    const url = part.url ? String(part.url) : '';
    const name = String(part.filename || 'attachment');
    if (url && /^image\//.test(mime)) {
      const img = document.createElement('img');
      img.className = 'file-thumb';
      img.src = url;
      img.alt = name;
      img.title = name;
      chip.appendChild(img);
    }
    chip.appendChild(el('span', 'file-part-name', name));
    chip.title = name + (mime ? ' (' + mime + ')' : '');
    return chip;
  }

  function renderPart(part, message) {
    if (!part) return null;
    const type = String(part.type || 'text');
    if (type === 'step-start' || type === 'step-finish') {
      return null;
    }
    if (type === 'reasoning') {
      const reasoningText = String(part.text == null ? '' : part.text);
      if (!reasoningText.trim()) return null;
      const wrap = el('details', 'part reasoning');
      wrap.dataset.partId = part.id;
      const summary = el('summary');
      wrap.appendChild(summary);
      const body = el('div', 'reasoning-body', reasoningText);
      body.dataset.field = 'text';
      wrap.appendChild(body);
      return wrap;
    }
    if (type === 'tool') {
      return renderToolCard(part);
    }
    if (type === 'patch') {
      const box = el('div', 'part patch-list');
      box.dataset.partId = part.id;
      const files = Array.isArray(part.files) ? part.files : [];
      if (!files.length) {
        box.textContent = 'Patch with no files.';
      } else {
        for (const file of files) {
          box.appendChild(el('div', null, String(file)));
        }
      }
      return box;
    }
    if (type === 'file') {
      return renderFilePart(part);
    }
    const text = el('div', 'part md');
    text.dataset.partId = part.id;
    text.dataset.field = 'text';
    if (message && message.info && message.info.role === 'user') {
      text.textContent = part.text || '';
    } else {
      renderMarkdown(text, part.text || '');
    }
    if (message && isStreamingMessage(message) && (part.text || '') && type === 'text') {
      text.classList.add('stream-caret');
    }
    return text;
  }

  function isStreamingMessage(message) {
    if (!message || !message.info) return false;
    if (!isBusy(state.sessionId)) return false;
    return message.info.role === 'assistant';
  }

  function renderMessages() {
    clear(els.messages);
    const has = state.messages.length > 0;
    els.emptyChat.hidden = has;
    for (const message of state.messages) {
      els.messages.appendChild(renderMessage(message));
    }
    els.messages.scrollTop = els.messages.scrollHeight;
  }

  function renderMessage(message) {
    const wrap = el('article', 'message message-' + (message.info.role === 'user' ? 'user' : 'assistant'));
    wrap.dataset.messageId = message.info.id || '';
    const role = el('div', 'message-role');
    role.appendChild(el('span', null, message.info.role === 'user' ? 'You' : 'Cordoval Code'));
    if (message.info.role === 'user') {
      const revert = el('button', 'btn btn-ghost btn-sm', 'Revert to here');
      revert.type = 'button';
      revert.title = 'Revert the session to this message';
      revert.addEventListener('click', function () {
        revertTo(message.info.id);
      });
      role.appendChild(revert);
    }
    wrap.appendChild(role);

    const bubble = el('div', 'bubble');
    if (!message.parts.length && message.info.role === 'assistant') {
      bubble.appendChild(el('div', 'md', ''));
    }
    for (const part of message.parts) {
      const node = renderPart(part, message);
      if (node) bubble.appendChild(node);
    }
    if (message.error) {
      bubble.appendChild(el('div', 'message-error', message.error));
    }
    wrap.appendChild(bubble);
    return wrap;
  }

  function refreshMessageNode(message) {
    const index = state.messages.indexOf(message);
    if (index < 0) {
      renderMessages();
      return;
    }
    const oldNode = els.messages.querySelector('[data-message-id="' + cssEscape(message.info.id) + '"]');
    const newNode = renderMessage(message);
    if (oldNode) els.messages.replaceChild(newNode, oldNode);
    else renderMessages();
    els.messages.scrollTop = els.messages.scrollHeight;
  }

  function cssEscape(value) {
    return String(value).replace(/["\\]/g, '\\$&');
  }

  function applyDelta(payload) {
    if (!payload || payload.sessionID !== state.sessionId) return;
    const message = upsertMessage({ id: payload.messageID, sessionID: payload.sessionID, role: 'assistant' });
    if (!message) return;
    let part = message.parts.find(function (p) { return p.id === payload.partID; });
    if (!part) {
      part = {
        id: payload.partID,
        type: payload.field === 'text' ? 'text' : payload.field || 'text',
      };
      message.parts.push(part);
    }
    const field = payload.field || 'text';
    part[field] = String(part[field] == null ? '' : part[field]) + String(payload.delta == null ? '' : payload.delta);
    throttledRenderMessage(message);
  }

  const pendingRenders = new Set();
  let renderFrame = null;

  function throttledRenderMessage(message) {
    pendingRenders.add(message);
    if (renderFrame) return;
    renderFrame = requestAnimationFrame(function () {
      renderFrame = null;
      const list = Array.from(pendingRenders);
      pendingRenders.clear();
      const stick = els.messages.scrollHeight - els.messages.scrollTop - els.messages.clientHeight < 80;
      for (const message of list) refreshMessageNode(message);
      if (stick) els.messages.scrollTop = els.messages.scrollHeight;
    });
  }

  function revertTo(messageId) {
    if (!state.sessionId) return;
    window.Api.revert(state.sessionId, messageId)
      .then(function () {
        toast('Reverted to the selected message.');
      })
      .catch(function (err) {
        toast(errorMessage(err), 'error');
      });
  }

  function unrevert() {
    if (!state.sessionId) return;
    window.Api.unrevert(state.sessionId)
      .then(function () {
        return selectSession(state.sessionId);
      })
      .catch(function (err) {
        toast(errorMessage(err), 'error');
      });
  }

  function currentSession() {
    return state.sessions.find(function (s) { return s.id === state.sessionId; }) || null;
  }

  function updateRevertBanner() {
    const session = currentSession();
    const revert = session && session.revert;
    const show = !!(state.sessionId && revert && revert.messageID);
    els.revertBanner.hidden = !show;
    if (show) {
      els.revertBannerText.textContent = 'Reverted to an earlier message. Files on disk match that point in the conversation.';
    }
  }

  function renderPermissions() {
    clear(els.permissionHost);
    const list = state.permissions[state.sessionId] || [];
    for (const item of list) {
      const card = el('div', 'permission-card');
      card.dataset.permissionId = item.id;
      card.appendChild(el('div', 'permission-title', permissionTitle(item)));
      card.appendChild(el('div', 'permission-detail', permissionDetail(item)));
      const actions = el('div', 'permission-actions');
      actions.appendChild(permissionButton(item.id, 'once', 'Allow once', 'btn-primary'));
      actions.appendChild(permissionButton(item.id, 'always', 'Always allow', 'btn-secondary'));
      actions.appendChild(permissionButton(item.id, 'reject', 'Deny', 'btn-danger'));
      card.appendChild(actions);
      els.permissionHost.appendChild(card);
    }
  }

  function permissionTitle(item) {
    const permission = item.permission ? String(item.permission) : 'Permission';
    return permission.replace(/[._-]+/g, ' ');
  }

  function permissionDetail(item) {
    const patterns = Array.isArray(item.patterns) && item.patterns.length
      ? item.patterns.join(', ')
      : (item.pattern || '*');
    const meta = item.metadata && item.metadata.title ? String(item.metadata.title) : '';
    return (meta ? meta + ' - ' : '') + patterns;
  }

  function permissionButton(id, reply, label, kind) {
    const btn = el('button', 'btn btn-sm ' + kind, label);
    btn.type = 'button';
    btn.addEventListener('click', function () {
      window.Api.replyPermission(id, reply)
        .catch(function (err) {
          toast(errorMessage(err), 'error');
        });
    });
    return btn;
  }

  function prettyModelName(provider, id, model) {
    const raw = (model && model.name && model.name !== id) ? String(model.name) : String(id);
    let name = raw.replace(/[-_ ]free$/i, '').replace(/:free$/i, '').replace(/\s*\(free\)$/i, '');
    if (name === raw.toLowerCase() || /^[a-z0-9.\-_/:]+$/.test(name)) {
      name = name.split('/').pop().split(/[-_]/).map(function (w) {
        if (/^v?\d/.test(w)) return w;
        if (w.length <= 3 && /^[a-z]+$/.test(w) && ['glm', 'gpt', 'vl', 'ai'].indexOf(w) >= 0) return w.toUpperCase();
        return w.charAt(0).toUpperCase() + w.slice(1);
      }).join(' ');
    }
    return name;
  }

  function isFreeModel(provider, id, model) {
    if (/(^|[-_:])free$/i.test(id)) return true;
    const cost = model && model.cost;
    return provider.id === 'opencode' && !!cost && Number(cost.input) === 0 && Number(cost.output) === 0;
  }

  function providerLabel(provider) {
    const known = {
      opencode: 'OpenCode Zen', openrouter: 'OpenRouter', openai: 'OpenAI', anthropic: 'Anthropic',
      google: 'Google Gemini', groq: 'Groq', xai: 'xAI', ollama: 'Ollama', lmstudio: 'LM Studio',
    };
    return known[provider.id] || PROVIDER_LABELS[provider.id] || provider.name || provider.id;
  }

  function renderModelPicker() {
    const select = els.modelPicker;
    clear(select);
    const current = currentModel();
    let matched = false;
    const providers = state.providers.slice().sort(function (a, b) {
      if (a.id === 'opencode') return -1;
      if (b.id === 'opencode') return 1;
      return providerLabel(a).localeCompare(providerLabel(b));
    });
    for (const provider of providers) {
      const models = provider.models || {};
      const list = Object.keys(models).map(function (key) {
        const model = models[key];
        const id = String((model && model.id) || key);
        return { id: id, name: prettyModelName(provider, id, model), free: isFreeModel(provider, id, model) };
      });
      if (!list.length) continue;
      list.sort(function (a, b) {
        if (a.free !== b.free) return a.free ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
      const optgroup = document.createElement('optgroup');
      optgroup.label = providerLabel(provider);
      for (const model of list) {
        const option = document.createElement('option');
        option.value = provider.id + '/' + model.id;
        option.textContent = model.name + (model.free ? '  (Free)' : '');
        option.title = provider.id + '/' + model.id;
        if (provider.id === current.providerID && model.id === current.modelID) {
          option.selected = true;
          matched = true;
        }
        optgroup.appendChild(option);
      }
      select.appendChild(optgroup);
    }
    if (!matched) {
      const option = document.createElement('option');
      option.value = current.providerID + '/' + current.modelID;
      option.textContent = prettyModelName({ id: current.providerID }, current.modelID) + (/free$/i.test(current.modelID) ? '  (Free)' : '');
      option.selected = true;
      select.insertBefore(option, select.firstChild);
    }
  }


  function renderAgentToggle() {
    const agent = currentAgent();
    els.agentBuild.classList.toggle('is-active', agent === 'build');
    els.agentPlan.classList.toggle('is-active', agent === 'plan');
    const group = els.agentBuild.parentNode;
    for (const old of Array.from(group.querySelectorAll('.agent-btn-custom'))) old.remove();
    for (const a of state.customAgents || []) {
      const b = el('button', 'agent-btn agent-btn-custom' + (agent === a.name ? ' is-active' : ''), a.name);
      b.type = 'button';
      b.dataset.agent = a.name;
      b.title = a.description || ('Custom agent ' + a.name);
      b.addEventListener('click', function () { saveAgent(state.sessionId, a.name); renderAgentToggle(); });
      group.appendChild(b);
    }
  }

  // Custom primary agents from the engine (config or .opencode/agent) show up next to Build and Plan.
  async function loadCustomAgents() {
    const BUILT_IN = ['build', 'plan', 'general', 'explore', 'compaction', 'summary', 'title'];
    try {
      const list = await window.Api.request('/agent');
      state.customAgents = (Array.isArray(list) ? list : []).filter(function (a) {
        return a && a.name && BUILT_IN.indexOf(a.name) < 0 && !a.hidden && a.mode !== 'subagent';
      }).map(function (a) { return { name: a.name, description: a.description || '' }; });
    } catch (err) {
      state.customAgents = [];
    }
    renderAgentToggle();
  }

  function updateStopButton() {
    const busy = isBusy(state.sessionId);
    els.btnStop.hidden = !busy;
    updateSendButton();
  }

  function updateSendButton() {
    const btn = els.btnSend;
    if (!btn) return;
    const busy = isBusy(state.sessionId);
    btn.hidden = busy;
    const empty = !String(els.composerInput.value || '').trim() && !state.attachments.length;
    btn.disabled = busy || empty;
  }

  function restoreAttachments(list) {
    state.attachments = Array.isArray(list) ? list : [];
    renderAttachments();
  }

  async function sendMessage() {
    const slashParsed = parseSlashText(els.composerInput.value.trim());
    if (slashParsed && slashParsed.name) {
      await ensureServerCommands();
      loadCustomAgents();
      const match = allSlashCommands().find(function (c) { return c.name === slashParsed.name; });
      if (match) {
        closeSlashMenu();
        els.composerInput.value = '';
        autosizeComposer();
        if (match.server) runServerCommand(match.command, slashParsed.args);
        else if (typeof match.run === 'function') match.run(slashParsed.args);
        return;
      }
    }
    const text = els.composerInput.value.trim();
    const attachments = state.attachments.slice();
    if ((!text && !attachments.length) || !state.sessionId) return;
    const model = currentModel();
    const agent = currentAgent();
    const parts = [];
    if (text) parts.push({ type: 'text', text });
    for (const item of attachments) {
      parts.push({ type: 'file', mime: item.mime, filename: item.filename, url: item.url });
    }
    const payload = {
      model: { providerID: model.providerID, modelID: model.modelID },
      agent: agent,
      parts: parts,
    };
    els.composerInput.value = '';
    state.attachments = [];
    renderAttachments();
    autosizeComposer();
    try {
      state.lastPrompt = state.lastPrompt || {};
      state.lastPrompt[state.sessionId] = { payload: payload, tried: [model.providerID + '/' + model.modelID] };
      await window.Api.promptAsync(state.sessionId, payload);
      state.busyBySession[state.sessionId] = true;
      updateStopButton();
      renderSessions();
      const stamp = Date.now();
      const optimistic = {
        info: {
          id: 'local-' + stamp,
          sessionID: state.sessionId,
          role: 'user',
          time: { created: stamp },
        },
        parts: parts.map(function (part, index) {
          return Object.assign({ id: 'local-part-' + stamp + '-' + index }, part);
        }),
      };
      state.messages.push(optimistic);
      sortMessages();
      renderMessages();
      setTimeout(function () {
        selectSession(state.sessionId).catch(function () {});
      }, 400);
    } catch (err) {
      toast(errorMessage(err), 'error');
      els.composerInput.value = text;
      restoreAttachments(attachments);
      autosizeComposer();
    }
  }

  function stopGeneration() {
    if (!state.sessionId) return;
    window.Api.abort(state.sessionId)
      .catch(function (err) {
        toast(errorMessage(err), 'error');
      });
  }

  function autosizeComposer() {
    const input = els.composerInput;
    input.style.height = 'auto';
    input.style.height = Math.min(220, Math.max(64, input.scrollHeight)) + 'px';
  }

  function readAsDataUrl(file) {
    return new Promise(function (resolve, reject) {
      const reader = new FileReader();
      reader.onload = function () {
        resolve(String(reader.result || ''));
      };
      reader.onerror = function () {
        reject(reader.error || new Error('Could not read the file.'));
      };
      reader.readAsDataURL(file);
    });
  }

  function isImageFile(file) {
    return !!(file && /^image\//.test(String(file.type || '')));
  }

  async function addAttachments(fileList) {
    const files = Array.prototype.slice.call(fileList || []);
    for (const file of files) {
      const name = file.name || 'file';
      if (file.size > MAX_FILE_BYTES) {
        toast('"' + name + '" is larger than the 20 MB limit and was not attached.', 'error');
        continue;
      }
      try {
        const url = await readAsDataUrl(file);
        attachmentSeq += 1;
        state.attachments.push({
          id: 'att-' + attachmentSeq + '-' + Date.now(),
          mime: String(file.type || 'application/octet-stream'),
          filename: name,
          url: url,
          size: file.size || 0,
        });
      } catch (err) {
        toast('Could not read "' + name + '": ' + errorMessage(err), 'error');
      }
    }
    renderAttachments();
  }

  function removeAttachment(id) {
    state.attachments = state.attachments.filter(function (item) {
      return item.id !== id;
    });
    renderAttachments();
  }

  // Models whose metadata claims image input but which ignored images in our tests.
  const VISION_UNRELIABLE = { 'opencode/mimo-v2.6-flash-free': true };
  const VISION_PREFERRED = ['opencode/nemotron-3.5-super-vl-free', 'opencode/deepseek-v4.1-flash-free', 'opencode/minimax-m3.1-flash-free'];

  function findModelInfo(providerID, modelID) {
    const provider = state.providers.find(function (p) { return p.id === providerID; });
    if (!provider || !provider.models) return null;
    return provider.models[modelID] || Object.values(provider.models).find(function (m) { return m && m.id === modelID; }) || null;
  }

  function modelSeesImages(providerID, modelID) {
    if (VISION_UNRELIABLE[providerID + '/' + modelID]) return false;
    const info = findModelInfo(providerID, modelID);
    if (!info || !info.capabilities) return null;
    const input = info.capabilities.input || {};
    return !!input.image;
  }

  function suggestVisionModel() {
    for (const key of VISION_PREFERRED) {
      const parts = key.split('/');
      if (findModelInfo(parts[0], parts[1]) && modelSeesImages(parts[0], parts[1])) return { providerID: parts[0], modelID: parts[1] };
    }
    for (const provider of state.providers) {
      for (const id of Object.keys(provider.models || {})) {
        const m = provider.models[id];
        const mid = (m && m.id) || id;
        if (modelSeesImages(provider.id, mid) && isFreeModel(provider, mid, m)) return { providerID: provider.id, modelID: mid };
      }
    }
    return null;
  }

  function updateVisionWarning() {
    let bar = document.getElementById('vision-warning');
    const hasImage = state.attachments.some(function (a) { return /^image\//.test(a.mime || ''); });
    const model = currentModel();
    const sees = modelSeesImages(model.providerID, model.modelID);
    if (!hasImage || sees === true) {
      if (bar) bar.hidden = true;
      return;
    }
    if (!bar) {
      bar = el('div', 'vision-warning');
      bar.id = 'vision-warning';
      const host = els.composerAttachments || document.getElementById('composer-attachments');
      host.parentNode.insertBefore(bar, host);
    }
    clear(bar);
    bar.hidden = false;
    const name = prettyModelName({ id: model.providerID }, model.modelID, findModelInfo(model.providerID, model.modelID));
    bar.appendChild(el('span', 'vision-warning-text', sees === false
      ? name + ' cannot read images, so the attached image will be ignored.'
      : 'This model may not be able to read images.'));
    const alt = suggestVisionModel();
    if (alt) {
      const altName = prettyModelName({ id: alt.providerID }, alt.modelID, findModelInfo(alt.providerID, alt.modelID));
      const btn = el('button', 'btn btn-sm btn-secondary', 'Switch to ' + altName);
      btn.type = 'button';
      btn.id = 'btn-vision-switch';
      btn.addEventListener('click', function () {
        saveModel(state.sessionId, alt);
        renderModelPicker();
        updateVisionWarning();
        toast('Switched to ' + altName + ' for this session.');
      });
      bar.appendChild(btn);
    }
  }

  // When a free model refuses (rate limit, network block, overload), switch to the next
  // free model and continue, at most three times per prompt.
  const FALLBACK_RE = /free models aren't available|rate.?limit|too many requests|\b429\b|overloaded|capacity|temporarily unavailable/i;
  function tryFreeModelFallback(sessionId, message) {
    const last = state.lastPrompt && state.lastPrompt[sessionId];
    if (!last || !FALLBACK_RE.test(message) || last.tried.length > 3) return false;
    const current = last.tried[last.tried.length - 1].split('/');
    const currentProvider = state.providers.find(function (p) { return p.id === current[0]; });
    if (!currentProvider || !isFreeModel(currentProvider, current[1], (currentProvider.models || {})[current[1]])) return false;
    const preferred = ['opencode/glm-5.3-flash-free', 'opencode/minimax-m3.1-flash-free', 'opencode/longcat-2.5-preview-free', 'opencode/nemotron-3.5-super-vl-free', 'opencode/nemotron-3.5-lightning-free', 'opencode/nemotron-3-ultra-free', 'opencode/mimo-v2.6-flash-free', 'opencode/deepseek-v4.1-flash-free'];
    const candidates = preferred.slice();
    for (const p of state.providers) for (const k of Object.keys(p.models || {})) {
      const id = p.id + '/' + ((p.models[k] && p.models[k].id) || k);
      if (candidates.indexOf(id) < 0 && isFreeModel(p, k, p.models[k])) candidates.push(id);
    }
    const next = candidates.find(function (c) {
      const parts = c.split('/');
      return last.tried.indexOf(c) < 0 && findModelInfo(parts[0], parts.slice(1).join('/'));
    });
    if (!next) return false;
    last.tried.push(next);
    const parts = next.split('/');
    const model = { providerID: parts[0], modelID: parts.slice(1).join('/') };
    saveModel(sessionId, model);
    if (sessionId === state.sessionId) renderModelPicker();
    const name = prettyModelName({ id: model.providerID }, model.modelID, findModelInfo(model.providerID, model.modelID));
    toast('The free model was unavailable. Continuing with ' + name + '.');
    const assistantDidWork = state.messages.some(function (m) {
      return m.info && m.info.role === 'assistant' && m.parts && m.parts.some(function (p) { return p.type === 'tool'; });
    });
    const payload = Object.assign({}, last.payload, { model: model });
    if (assistantDidWork) payload.parts = [{ type: 'text', text: 'The previous model was interrupted. Continue the task from where it stopped.' }];
    setTimeout(function () {
      window.Api.promptAsync(sessionId, payload).catch(function (err) { toast(errorMessage(err), 'error'); });
    }, 1500);
    return true;
  }

  function renderAttachments() {
    setTimeout(updateVisionWarning, 0);
    const host = els.composerAttachments;
    if (!host) return;
    clear(host);
    host.hidden = !state.attachments.length;
    for (const item of state.attachments) {
      const chip = el('div', 'attachment-chip');
      chip.dataset.attachmentId = item.id;
      if (item.url && /^image\//.test(item.mime)) {
        const img = document.createElement('img');
        img.className = 'attachment-thumb';
        img.src = item.url;
        img.alt = '';
        chip.appendChild(img);
      } else {
        chip.appendChild(el('span', 'attachment-badge', 'FILE'));
      }
      const label = el('span', 'attachment-name', item.filename);
      label.title = item.filename + ' (' + item.mime + ')';
      chip.appendChild(label);
      const remove = el('button', 'attachment-remove');
      remove.type = 'button';
      remove.title = 'Remove ' + item.filename;
      remove.setAttribute('aria-label', 'Remove ' + item.filename);
      remove.innerHTML = '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path fill="currentColor" d="M4.03 4.03a.75.75 0 0 1 1.06 0L8 6.94l2.91-2.91a.75.75 0 1 1 1.06 1.06L9.06 8l2.91 2.91a.75.75 0 1 1-1.06 1.06L8 9.06l-2.91 2.91a.75.75 0 0 1-1.06-1.06L6.94 8 4.03 5.09a.75.75 0 0 1 0-1.06Z"/></svg>';
      remove.addEventListener('click', function () {
        removeAttachment(item.id);
      });
      chip.appendChild(remove);
      host.appendChild(chip);
    }
    updateSendButton();
  }

  function anyBusy() {
    return Object.keys(state.busyBySession || {}).some(function (id) { return isBusy(id); });
  }

  const pendingApply = { config: false, project: false, timer: null };
  function queueApply(kind) {
    pendingApply[kind] = true;
    if (pendingApply.timer) return;
    pendingApply.timer = setInterval(async function () {
      if (anyBusy()) return;
      clearInterval(pendingApply.timer);
      pendingApply.timer = null;
      const cfg = pendingApply.config, proj = pendingApply.project;
      pendingApply.config = pendingApply.project = false;
      try {
        if (cfg) await applyEngineConfigNow(await window.cordoval.getEngineConfig());
        else if (proj) { await window.cordoval.applyProjectFiles(state.directory); await afterConfigApplied(); }
        toast('Customise changes applied.');
      } catch (err) { toast(errorMessage(err), 'error'); }
    }, 1000);
  }

  async function afterConfigApplied() {
    state.commandsLoaded = false;
    await ensureServerCommands().catch(function () {});
    await loadCustomAgents();
  }

  async function applyEngineConfigNow(obj) {
    const res = await window.cordoval.setEngineConfig(obj);
    if (res && res.restarted) await restartEngineAndReconnect(res.url);
    // Instances cache agents and commands; dispose the idle project instance so removals show too.
    else if (state.directory) await window.cordoval.applyProjectFiles(state.directory).catch(function () {});
    await afterConfigApplied();
    return res && res.restarted ? 'restarted' : 'live';
  }

  async function restartEngineAndReconnect(givenUrl) {
    if (!window.cordoval || !window.cordoval.restartEngine) return;
    const url = givenUrl || await window.cordoval.restartEngine();
    if (url) {
      state.engineUrl = url;
      window.Api.setBase(url);
      els.statusEngine.textContent = 'Engine ready';
    }
    if (window.TerminalPanel && window.TerminalPanel.isOpen()) {
      await window.TerminalPanel.open({
        directory: state.directory,
        engineUrl: state.engineUrl,
        reconnect: true,
      });
    }
    await refreshProviders();
    if (state.directory) await window.Api.connectEvents();
  }

  async function waitForEngine() {
    const t0 = Date.now();
    while (!state.engineUrl || !window.Api.engineUrl()) {
      if (Date.now() - t0 > 60000) throw new Error('The engine did not start.');
      await new Promise(function (r) { setTimeout(r, 200); });
    }
  }

  async function openProject(dir, options) {
    const opts = options || {};
    if (!dir) return;
    await waitForEngine();
    state.directory = dir;
    pushRecent(dir);
    if (window.Api) window.Api.setDirectory(dir);
    if (window.TerminalPanel) window.TerminalPanel.setDirectory(dir);
    if (window.CodeEditor && document.dispatchEvent) {
      try {
        document.dispatchEvent(new CustomEvent('cordoval:project-changed', { detail: { directory: dir } }));
      } catch (err) {
        // CustomEvent is available in Electron; ignore otherwise
      }
    }
    updateProjectChrome();
    showWelcome(false);
    document.dispatchEvent(new CustomEvent('cordoval:project-opened', { detail: { directory: dir } }));
    state.messages = [];
    state.sessionId = null;
    state.permissions = {};
    state.diffs = {};
    state.vcsMissing = false;
    state.commandsLoaded = false;
    setTimeout(function () { ensureServerCommands().catch(function () {}); }, 0);
    state.serverCommands = [];
    closeSlashMenu();
    restoreAttachments([]);
    renderMessages();
    renderPermissions();
    await window.Api.connectEvents();
    await refreshProviders();
    await checkVcs();
    await refreshSessions();
    if (!state.sessions.length && !opts.skipCreateSession) {
      try {
        const created = await window.Api.createSession();
        state.sessions.push(created);
        await selectSession(created.id);
        renderSessions();
      } catch (err) {
        toast(errorMessage(err), 'error');
      }
    }
    loadFilesTree('');
    if (state.rightTab === 'changes') refreshChanges();
    if (state.rightTab === 'diagnostics') refreshDiagnostics();
    if (window.TerminalPanel && window.TerminalPanel.isOpen()) {
      window.TerminalPanel.open({ directory: dir, engineUrl: state.engineUrl, reconnect: true });
    }
  }

  async function pickAndOpenProject() {
    if (!window.cordoval || !window.cordoval.pickFolder) return;
    const dir = await window.cordoval.pickFolder();
    if (!dir) return;
    await openProject(dir);
  }

  async function refreshProviders() {
    try {
      const data = await window.Api.providers();
      const providers = (data && data.providers) || [];
      state.providers = Array.isArray(providers) ? providers : [];
      state.providerDefault = (data && data.default) || {};
    } catch (err) {
      state.providers = [];
      state.providerDefault = {};
    }
    renderModelPicker();
  }

  async function handleEvent(data) {
    const type = data.type;
    const props = data.properties || data;
    switch (type) {
      case 'session.updated': {
        const info = props.info || props;
        if (!info || !info.id) return;
        const existing = state.sessions.find(function (s) { return s.id === info.id; });
        if (existing) {
          Object.assign(existing, info);
        } else {
          state.sessions.unshift(info);
        }
        if (info.id === state.sessionId) updateRevertBanner();
        renderSessions();
        return;
      }
      case 'session.status': {
        const id = props.sessionID;
        const status = props.status || {};
        // 'retry' means the engine is still working (waiting to retry the provider), so stay busy.
        const busy = status.type === 'busy' || status.type === 'retry';
        if (status.type === 'retry') {
          const msg = String(status.message || (status.action && status.action.message) || 'provider error');
          els.statusEngine.textContent = 'Retrying (attempt ' + (status.attempt || 1) + '): ' + msg.slice(0, 120);
          if (id && (status.attempt || 0) >= 3 && FALLBACK_RE.test(msg) && state.lastPrompt && state.lastPrompt[id] && !state.lastPrompt[id].aborting) {
            state.lastPrompt[id].aborting = true;
            window.Api.abort(id).catch(function () {}).then(function () {
              state.lastPrompt[id].aborting = false;
              tryFreeModelFallback(id, msg);
            });
          }
        } else if (els.statusEngine.textContent.indexOf('Retrying') === 0) {
          els.statusEngine.textContent = 'Engine ready';
        }
        if (id) {
          if (busy) state.busyBySession[id] = true;
          else delete state.busyBySession[id];
        }
        if (id === state.sessionId) updateStopButton();
        renderSessions();
        if (!busy && state.directory) {
          loadFilesTree('');
          refreshChanges();
        }
        return;
      }
      case 'session.diff': {
        if (props.sessionID) state.diffs[props.sessionID] = props.diff || [];
        if (state.rightTab === 'changes' && props.sessionID === state.sessionId) refreshChanges();
        return;
      }
      case 'session.error': {
        const id = props.sessionID || state.sessionId;
        const message = props.error && props.error.data && props.error.data.message
          ? props.error.data.message
          : (props.error && props.error.message) || props.message || 'Session error';
        if (id && tryFreeModelFallback(id, String(message))) return;
        const target = findMessage(props.messageID) || state.messages[state.messages.length - 1];
        if (target) {
          target.error = String(message);
          refreshMessageNode(target);
        } else {
          toast(String(message), 'error');
        }
        if (id) {
          delete state.busyBySession[id];
          if (id === state.sessionId) updateStopButton();
        }
        renderSessions();
        return;
      }
      case 'message.updated': {
        const info = props.info || props;
        if (!info || info.sessionID !== state.sessionId) return;
        if (!info.role) return;
        const message = upsertMessage(info);
        if (message) {
          sortMessages();
          refreshMessageNode(message);
          els.emptyChat.hidden = true;
        }
        return;
      }
      case 'message.part.updated': {
        const part = props.part || props;
        const messageId = part && (part.messageID || (part.info && part.info.messageID));
        const sessionID = part && (part.sessionID || (part.info && part.info.sessionID));
        if (sessionID && sessionID !== state.sessionId) return;
        if (!messageId) return;
        const message = upsertMessage({ id: messageId, sessionID: sessionID || state.sessionId, role: 'assistant' });
        if (!message || !part || !part.id) return;
        upsertPart(message, part);
        refreshMessageNode(message);
        els.emptyChat.hidden = true;
        if (part.type === 'tool' && part.state && part.state.status === 'completed' &&
            /^(write|edit|patch|multiedit|bash|apply_patch)$/.test(String(part.tool))) {
          clearTimeout(state.treeTimer);
          state.treeTimer = setTimeout(function () {
            loadFilesTree('');
            if (state.rightTab === 'changes') refreshChanges();
          }, 800);
        }
        return;
      }
      case 'message.part.delta': {
        applyDelta(props);
        return;
      }
      case 'permission.asked': {
        if (!props.sessionID) return;
        const list = state.permissions[props.sessionID] || [];
        const item = {
          id: props.id || props.requestID,
          sessionID: props.sessionID,
          permission: props.permission,
          patterns: props.patterns,
          metadata: props.metadata,
        };
        if (!item.id) return;
        const index = list.findIndex(function (p) { return p.id === item.id; });
        if (index >= 0) list[index] = item;
        else list.push(item);
        state.permissions[props.sessionID] = list;
        if (props.sessionID === state.sessionId) renderPermissions();
        return;
      }
      case 'permission.replied': {
        const id = props.id || props.requestID;
        const sessionID = props.sessionID || state.sessionId;
        const list = state.permissions[sessionID] || [];
        state.permissions[sessionID] = list.filter(function (p) { return p.id !== id; });
        if (sessionID === state.sessionId) renderPermissions();
        return;
      }
      default:
        return;
    }
  }

  let filesTreeRequest = 0;

  async function loadFilesTree(path) {
    if (!state.directory) return;
    const requestId = ++filesTreeRequest;
    clear(els.fileTree);
    try {
      const entries = await window.Api.listFiles(path || '');
      if (requestId !== filesTreeRequest) return;
      renderFileEntries(els.fileTree, Array.isArray(entries) ? entries : [], path || '');
    } catch (err) {
      if (requestId !== filesTreeRequest) return;
      els.fileTree.appendChild(el('div', 'empty-note', errorMessage(err)));
    }
  }

  function renderFileEntries(container, entries, parentPath) {
    const dirs = entries.filter(function (e) { return e.type === 'directory'; });
    const files = entries.filter(function (e) { return e.type !== 'directory'; });
    dirs.sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); });
    files.sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); });
    for (const entry of dirs.concat(files)) {
      const isDir = entry.type === 'directory';
      const path = entry.path || (parentPath ? parentPath + '/' + entry.name : entry.name);
      const btn = el('button', 'tree-item' + (isDir ? ' is-dir' : ''));
      btn.type = 'button';
      const icon = el('span', null, isDir ? 'DIR' : '   ');
      icon.style.width = '26px';
      icon.style.color = 'var(--faint)';
      icon.style.fontSize = '10px';
      icon.style.fontWeight = '700';
      btn.appendChild(icon);
      btn.appendChild(el('span', 'tree-name', entry.name));
      if (isDir) {
        const children = el('div', 'tree-children');
        const open = !!state.fileTreeExpanded[path];
        if (open) {
          btn.setAttribute('aria-expanded', 'true');
          container.appendChild(btn);
          container.appendChild(children);
          btn.addEventListener('click', function () {
            state.fileTreeExpanded[path] = false;
            loadFilesTree(parentPath);
          });
          (async function () {
            try {
              const list = await window.Api.listFiles(path);
              renderFileEntries(children, Array.isArray(list) ? list : [], path);
            } catch (err) {
              children.appendChild(el('div', 'empty-note', errorMessage(err)));
            }
          })();
        } else {
          btn.setAttribute('aria-expanded', 'false');
          btn.addEventListener('click', function () {
            state.fileTreeExpanded[path] = true;
            loadFilesTree(parentPath);
          });
          container.appendChild(btn);
        }
      } else {
        btn.addEventListener('click', function () {
          openFile(path);
        });
        container.appendChild(btn);
      }
    }
    if (!entries.length) {
      container.appendChild(el('div', 'empty-note', 'Empty folder.'));
    }
  }

  function openFile(path) {
    if (!state.directory) {
      toast('Open a project first.', 'error');
      return;
    }
    if (!window.CodeEditor) return;
    window.CodeEditor.open(path).catch(function (err) {
      toast(errorMessage(err), 'error');
    });
  }

  function hasVcsRepository(info) {
    if (!info) return false;
    if (Array.isArray(info)) return info.some(hasVcsRepository);
    if (typeof info !== 'object') return !!info;
    if (info.repository || info.repo || info.vcs) return true;
    return typeof info.branch === 'string' && !!info.branch;
  }

  async function checkVcs() {
    state.vcsMissing = false;
    if (!state.directory) return;
    try {
      const info = await window.Api.vcs();
      state.vcsMissing = !hasVcsRepository(info);
    } catch (err) {
      state.vcsMissing = false;
    }
  }

  function renderVcsNotice() {
    if (!state.vcsMissing) return;
    const note = el('div', 'vcs-notice');
    note.appendChild(el('div', 'vcs-notice-text', 'Not a git repository. Initialise git to enable diffs and undo.'));
    const btn = el('button', 'btn btn-secondary btn-sm', 'Initialise git');
    btn.type = 'button';
    btn.addEventListener('click', function () {
      btn.disabled = true;
      window.Api.gitInit()
        .then(function () {
          toast('Git repository initialised.');
          return checkVcs();
        })
        .catch(function (err) {
          toast(errorMessage(err), 'error');
        })
        .then(function () {
          btn.disabled = false;
          refreshChanges();
        });
    });
    note.appendChild(btn);
    els.changesList.appendChild(note);
  }

  let changesRequest = 0;

  async function refreshChanges() {
    const requestId = ++changesRequest;
    clear(els.changesList);
    if (!state.directory) return;
    const fromEvent = state.diffs[state.sessionId] || [];
    let fromSession = [];
    if (state.sessionId) {
      try {
        const data = await window.Api.sessionDiff(state.sessionId);
        fromSession = Array.isArray(data) ? data : [];
      } catch (err) {
        fromSession = [];
      }
    }
    let fromStatus = [];
    try {
      fromStatus = await window.Api.fileStatus();
    } catch (err) {
      fromStatus = [];
    }
    let fromVcs = [];
    try {
      const data = await window.Api.vcsDiff();
      fromVcs = Array.isArray(data) ? data : [];
    } catch (err) {
      fromVcs = [];
    }
    if (requestId !== changesRequest) return;
    const byFile = {};
    function mergeEntry(entry, file) {
      const key = file || (entry && entry.file);
      if (!key) return;
      let item = byFile[key];
      if (!item) {
        item = {
          file: key,
          additions: 0,
          deletions: 0,
          hasPatch: false,
        };
        byFile[key] = item;
      }
      if (!entry) return;
      if (entry.before != null) item.before = entry.before;
      if (entry.after != null) item.after = entry.after;
      if (entry.patch) item.patch = String(entry.patch);
      if (entry.status) item.status = entry.status;
      if (entry.additions != null) item.additions = Number(entry.additions) || 0;
      if (entry.deletions != null) item.deletions = Number(entry.deletions) || 0;
      item.hasPatch = item.before != null || item.after != null || !!item.patch;
    }
    for (const entry of fromEvent) mergeEntry(entry);
    for (const entry of fromSession) mergeEntry(entry);
    for (const entry of fromVcs) mergeEntry(entry);
    for (const entry of fromStatus) {
      if (!entry || !entry.path) continue;
      mergeEntry(entry, entry.path);
      const item = byFile[entry.path];
      if (item) {
        item.additions = Number(entry.added) || item.additions;
        item.deletions = Number(entry.removed) || item.deletions;
        item.status = entry.status || item.status;
      }
    }
    renderVcsNotice();
    const list = Object.keys(byFile).sort().map(function (key) { return byFile[key]; });
    if (!list.length) {
      els.changesList.appendChild(el('div', 'empty-note', 'Working tree is clean.'));
      return;
    }
    for (const item of list) {
      const card = el('div', 'change-file');
      const header = el('div', 'change-file-header');
      header.appendChild(el('span', 'change-path', item.file));
      const stat = el('span', 'change-stat');
      stat.innerHTML = '<span class="add">+' + item.additions + '</span> <span class="del">-' + item.deletions + '</span>';
      header.appendChild(stat);
      if (item.status) header.appendChild(el('span', 'change-status', item.status));
      card.appendChild(header);
      const body = el('div', 'change-file-body');
      body.hidden = !item.hasPatch;
      if (item.hasPatch) {
        DiffView.render(body, [item]);
      } else {
        body.appendChild(el('div', 'empty-note', 'Tracked as ' + (item.status || 'changed') + '. Open the session diff after the next assistant turn for a textual patch.'));
      }
      header.addEventListener('click', function () {
        body.hidden = !body.hidden;
      });
      card.appendChild(body);
      els.changesList.appendChild(card);
    }
  }

  async function runSearch() {
    const pattern = els.searchInput.value.trim();
    clear(els.searchResults);
    if (!pattern || !state.directory) {
      els.searchResults.appendChild(el('div', 'empty-note', 'Enter text to search the project.'));
      return;
    }
    try {
      const results = await window.Api.find(pattern);
      const list = Array.isArray(results) ? results : [];
      if (!list.length) {
        els.searchResults.appendChild(el('div', 'empty-note', 'No matches.'));
        return;
      }
      for (const item of list.slice(0, 300)) {
        const btn = el('button', 'search-result');
        btn.type = 'button';
        const txt = function (v) { return v && typeof v === 'object' ? (v.text != null ? v.text : '') : (v == null ? '' : v); };
        const path = String(txt(item.path) || item.file || '').replace(/^\.\//, '');
        const lineNo = item.line_number || item.line;
        btn.appendChild(el('div', 'search-result-path', path + (lineNo ? ':' + lineNo : '')));
        const lines = Array.isArray(item.lines) ? item.lines.map(txt).join('\n') : (txt(item.lines) || item.text || item.match || '');
        btn.appendChild(el('div', 'search-result-line', String(lines).slice(0, 400)));
        btn.addEventListener('click', function () {
          openFile(path);
        });
        els.searchResults.appendChild(btn);
      }
    } catch (err) {
      els.searchResults.appendChild(el('div', 'empty-note', errorMessage(err)));
    }
  }

  async function refreshDiagnostics() {
    clear(els.diagnosticsList);
    if (!state.directory) return;
    try {
      const data = await window.Api.lsp();
      const list = Array.isArray(data)
        ? data
        : (data && (data.servers || data.lsp || Object.values(data))) || [];
      if (!list.length) {
        els.diagnosticsList.appendChild(el('div', 'empty-note', 'No language servers reported.'));
        return;
      }
      for (const item of list) {
        const card = el('div', 'diag-item');
        const name = (item && (item.name || item.serverID || item.id)) || 'Server';
        card.appendChild(el('div', 'diag-name', String(name)));
        const status = item && (item.status || item.state);
        const languages = item && (item.languages || item.filetypes);
        const meta = [
          status ? 'Status: ' + status : '',
          Array.isArray(languages) && languages.length ? 'Languages: ' + languages.join(', ') : '',
        ].filter(Boolean).join(' - ');
        card.appendChild(el('div', 'diag-meta', meta || 'Reported.'));
        els.diagnosticsList.appendChild(card);
      }
    } catch (err) {
      els.diagnosticsList.appendChild(el('div', 'empty-note', errorMessage(err)));
    }
  }

  function switchRightTab(tab) {
    state.rightTab = tab;
    const tabs = document.querySelectorAll('.right-tab');
    for (const node of tabs) {
      node.classList.toggle('is-active', node.dataset.tab === tab);
    }
    const views = document.querySelectorAll('.right-view');
    for (const node of views) {
      node.classList.toggle('is-active', node.dataset.tab === tab);
    }
    if (tab === 'files') loadFilesTree('');
    if (tab === 'changes') refreshChanges();
    if (tab === 'diagnostics') refreshDiagnostics();
  }

  async function reloadKeyState() {
    if (window.cordoval && window.cordoval.getKeys) {
      try {
        state.keysMeta = (await window.cordoval.getKeys()) || [];
        try { state.keyStorage = await window.cordoval.keyStorage(); } catch (e) { state.keyStorage = null; }
      } catch (err) {
        state.keysMeta = [];
      }
    }
    if (window.cordoval && window.cordoval.getCustom) {
      try {
        state.customEndpoints = (await window.cordoval.getCustom()) || [];
      } catch (err) {
        state.customEndpoints = [];
      }
    }
    renderProviderSettings();
    renderCustomSettings();
  }

  function renderProviderSettings() {
    const host = els.settingsProviders;
    clear(host);
    const ks = state.keyStorage;
    if (ks && !ks.secure) {
      const warn = el('div', 'keychain-warning');
      warn.appendChild(el('div', 'keychain-warning-title', 'OS keychain not available'));
      warn.appendChild(el('div', 'keychain-warning-text',
        (ks.platform === 'linux'
          ? 'No Secret Service or KWallet keyring was found (backend: ' + ks.backend + '). '
          : 'Secure storage is not available on this system. ') +
        'Keys you save will be stored on this device without OS keychain protection. ' +
        'Install and unlock a keyring (for example GNOME Keyring or KWallet) and restart Cordoval Code to protect them.'));
      host.appendChild(warn);
    }
    const known = ['openrouter', 'openai', 'anthropic', 'google', 'groq', 'xai'];
    const metaById = {};
    for (const item of state.keysMeta) metaById[item.id] = item;
    const ids = known.slice();
    for (const id of Object.keys(metaById)) {
      if (!ids.includes(id)) ids.push(id);
    }
    for (const id of ids) {
      const meta = metaById[id] || { id: id, set: false };
      const card = el('div', 'provider-card');
      const head = el('div', 'provider-head');
      head.appendChild(el('div', 'provider-name', PROVIDER_LABELS[id] || id));
      head.appendChild(el('div', 'provider-state' + (meta.set ? ' is-set' : ''), meta.set ? (state.keyStorage && !state.keyStorage.secure ? 'Saved (not keychain protected)' : 'Stored in OS keychain') : 'Not set'));
      card.appendChild(head);

      if (id === 'openrouter') {
        const signIn = el('button', 'btn btn-secondary btn-sm', 'Sign in with OpenRouter');
        signIn.type = 'button';
        signIn.addEventListener('click', async function () {
          signIn.disabled = true;
          try {
            if (!window.cordoval || !window.cordoval.openrouterSignIn) {
              throw new Error('OpenRouter sign-in is unavailable.');
            }
            await window.cordoval.openrouterSignIn();
            toast('OpenRouter key stored in the OS keychain.');
            await reloadKeyState();
            await restartEngineAndReconnect();
          } catch (err) {
            toast(errorMessage(err), 'error');
          } finally {
            signIn.disabled = false;
          }
        });
        card.appendChild(signIn);
      }

      const label = el('label', 'field');
      label.style.marginTop = '10px';
      label.appendChild(el('span', 'field-label', 'API key'));
      const input = document.createElement('input');
      input.type = 'password';
      input.className = 'input';
      input.autocomplete = 'off';
      input.placeholder = meta.set ? 'Key stored - enter a new one to replace' : 'Paste API key';
      label.appendChild(input);
      card.appendChild(label);

      const actions = el('div', 'provider-actions');
      const save = el('button', 'btn btn-primary btn-sm', 'Save');
      save.type = 'button';
      save.addEventListener('click', async function () {
        const value = input.value.trim();
        if (!value) {
          toast('Enter an API key first.', 'error');
          return;
        }
        try {
          await window.cordoval.setKey(id, value);
          input.value = '';
          await reloadKeyState();
          await restartEngineAndReconnect();
          toast((PROVIDER_LABELS[id] || id) + ' key saved.');
        } catch (err) {
          toast(errorMessage(err), 'error');
        }
      });
      const remove = el('button', 'btn btn-danger btn-sm', 'Remove');
      remove.type = 'button';
      remove.addEventListener('click', async function () {
        try {
          await window.cordoval.deleteKey(id);
          await reloadKeyState();
          await restartEngineAndReconnect();
          toast((PROVIDER_LABELS[id] || id) + ' key removed.');
        } catch (err) {
          toast(errorMessage(err), 'error');
        }
      });
      actions.appendChild(save);
      actions.appendChild(remove);
      card.appendChild(actions);
      host.appendChild(card);
    }
  }

  function customDraftToItem(draft) {
    const models = String(draft.modelsText || '')
      .split(',')
      .map(function (m) { return m.trim(); })
      .filter(Boolean);
    return {
      id: draft.id || '',
      name: String(draft.name || '').trim(),
      baseURL: String(draft.baseURL || '').trim(),
      models: models,
      apiKey: draft.apiKey && String(draft.apiKey).trim() ? String(draft.apiKey).trim() : (draft.keepKey ? undefined : null),
    };
  }

  function renderCustomSettings() {
    const host = els.settingsCustom;
    clear(host);

    const presetRow = el('div', 'provider-actions');
    presetRow.style.marginBottom = '12px';
    for (const preset of CUSTOM_PRESETS) {
      const btn = el('button', 'btn btn-secondary btn-sm', 'Add ' + preset.name + ' preset');
      btn.type = 'button';
      btn.addEventListener('click', function () {
        host._drafts.push({
          id: '',
          name: preset.name,
          baseURL: preset.baseURL,
          modelsText: '',
          apiKey: '',
          keepKey: false,
        });
        renderCustomSettings();
      });
      presetRow.appendChild(btn);
    }
    host.appendChild(presetRow);

    if (!host._drafts) {
      host._drafts = state.customEndpoints.map(function (item) {
        return {
          id: item.id,
          name: item.name,
          baseURL: item.baseURL,
          modelsText: (item.models || []).join(', '),
          apiKey: '',
          keepKey: !!item.hasKey,
        };
      });
    }
    const drafts = host._drafts;

    const list = el('div', 'custom-list');
    drafts.forEach(function (draft, index) {
      const card = el('div', 'custom-card');
      const head = el('div', 'custom-card-head');
      head.appendChild(el('span', null, draft.name || 'Custom endpoint'));
      const remove = el('button', 'btn btn-danger btn-sm', 'Remove');
      remove.type = 'button';
      remove.addEventListener('click', function () {
        drafts.splice(index, 1);
        renderCustomSettings();
      });
      head.appendChild(remove);
      card.appendChild(head);

      card.appendChild(customField('Name', draft.name, function (value) {
        draft.name = value;
      }));
      card.appendChild(customField('Base URL', draft.baseURL, function (value) {
        draft.baseURL = value;
      }, 'http://127.0.0.1:11434/v1'));
      card.appendChild(customField('API key (optional)', draft.apiKey, function (value) {
        draft.apiKey = value;
      }, draft.keepKey ? 'Key stored - leave blank to keep' : 'Optional', 'password'));
      card.appendChild(customField('Model IDs (comma separated)', draft.modelsText, function (value) {
        draft.modelsText = value;
      }, 'model-a, model-b'));
      list.appendChild(card);
    });
    host.appendChild(list);

    const actions = el('div', 'provider-actions');
    actions.style.marginTop = '14px';
    const add = el('button', 'btn btn-secondary', 'Add endpoint');
    add.type = 'button';
    add.addEventListener('click', function () {
      drafts.push({ id: '', name: '', baseURL: '', modelsText: '', apiKey: '', keepKey: false });
      renderCustomSettings();
    });
    const save = el('button', 'btn btn-primary', 'Save endpoints');
    save.type = 'button';
    save.addEventListener('click', async function () {
      try {
        const payload = drafts.map(customDraftToItem).filter(function (item) {
          return item.name || item.baseURL;
        });
        await window.cordoval.setCustom(payload);
        host._drafts = null;
        await reloadKeyState();
        await restartEngineAndReconnect();
        toast('Custom endpoints saved and engine restarted.');
      } catch (err) {
        toast(errorMessage(err), 'error');
      }
    });
    actions.appendChild(add);
    actions.appendChild(save);
    host.appendChild(actions);
  }

  function customField(labelText, value, onChange, placeholder, type) {
    const label = el('label', 'field');
    label.appendChild(el('span', 'field-label', labelText));
    const input = document.createElement('input');
    input.type = type || 'text';
    input.className = 'input';
    input.value = value || '';
    if (placeholder) input.placeholder = placeholder;
    input.addEventListener('input', function () {
      onChange(input.value);
    });
    label.appendChild(input);
    return label;
  }

  function openSettings() {
    els.settingsBackdrop.hidden = false;
    reloadKeyState();
    const radios = document.querySelectorAll('input[name="theme"]');
    for (const radio of radios) {
      radio.checked = radio.value === state.theme;
    }
  }

  function closeSettings() {
    els.settingsBackdrop.hidden = true;
  }

  function switchSettingsTab(name) {
    const tabs = document.querySelectorAll('.modal-tab');
    for (const tab of tabs) {
      tab.classList.toggle('is-active', tab.dataset.stab === name);
    }
    const views = document.querySelectorAll('.modal-view');
    for (const view of views) {
      view.classList.toggle('is-active', view.dataset.stab === name);
    }
  }

  async function openTemplates() {
    els.templatesBackdrop.hidden = false;
    els.templateError.hidden = true;
    clear(els.templatesGrid);
    state.selectedTemplateId = null;
    try {
      state.templates = (await window.cordoval.templates()) || [];
    } catch (err) {
      state.templates = [];
    }
    if (!state.templates.length) {
      els.templatesGrid.appendChild(el('div', 'empty-note', 'No templates are available yet.'));
      return;
    }
    const byCategory = {};
    for (const template of state.templates) {
      const category = template.category || 'General';
      if (!byCategory[category]) byCategory[category] = [];
      byCategory[category].push(template);
    }
    for (const category of Object.keys(byCategory).sort()) {
      els.templatesGrid.appendChild(el('div', 'template-category', category));
      for (const template of byCategory[category]) {
        const btn = el('button', 'template-item');
        btn.type = 'button';
        btn.dataset.id = template.id;
        btn.appendChild(el('div', 'template-item-name', template.name || template.id));
        btn.appendChild(el('div', 'template-item-desc', template.description || ''));
        btn.addEventListener('click', function () {
          state.selectedTemplateId = template.id;
          if (!els.templateName.value) {
            els.templateName.value = slugify(template.name || template.id);
          }
          const items = els.templatesGrid.querySelectorAll('.template-item');
          for (const item of items) {
            item.classList.toggle('is-selected', item.dataset.id === template.id);
          }
        });
        els.templatesGrid.appendChild(btn);
      }
    }
  }

  function slugify(value) {
    return String(value || 'project')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'project';
  }

  function closeTemplates() {
    els.templatesBackdrop.hidden = true;
  }

  async function createFromTemplate() {
    const templateId = state.selectedTemplateId;
    const name = els.templateName.value.trim();
    const parentDir = els.templateParent.value.trim();
    els.templateError.hidden = true;
    function fail(message) {
      els.templateError.textContent = message;
      els.templateError.hidden = false;
    }
    if (!templateId) return fail('Choose a template.');
    if (!name) return fail('Enter a project name.');
    if (!parentDir) return fail('Choose a parent folder.');
    const template = state.templates.find(function (t) { return t.id === templateId; });
    try {
      const result = await window.cordoval.scaffold(templateId, parentDir, name);
      const path = result && result.path;
      const resolved = result && result.template ? result.template : template;
      closeTemplates();
      await openProject(path, { skipCreateSession: true });
      let sessionId = state.sessionId;
      if (!sessionId) {
        const created = await window.Api.createSession();
        if (created && created.id) {
          state.sessions.unshift(created);
          await selectSession(created.id);
          renderSessions();
          sessionId = created.id;
        }
      }
      if (!sessionId) throw new Error('Could not create a session for the new project.');
      const model = currentModel();
      const system = [resolved && resolved.system, BUILDER_SYSTEM]
        .filter(Boolean)
        .join('\n\n');
      const promptText = (resolved && resolved.prompt) ||
        'Create the full project described by the template, install dependencies, build, and test it.';
      const tplPayload = {
        model: { providerID: model.providerID, modelID: model.modelID },
        agent: 'build',
        system: system,
        parts: [{ type: 'text', text: promptText }],
      };
      state.lastPrompt = state.lastPrompt || {};
      state.lastPrompt[sessionId] = { payload: tplPayload, tried: [model.providerID + '/' + model.modelID] };
      await window.Api.promptAsync(sessionId, tplPayload);
      state.busyBySession[sessionId] = true;
      updateStopButton();
      renderSessions();
      setTimeout(function () {
        selectSession(state.sessionId).catch(function () {});
      }, 500);
    } catch (err) {
      fail(errorMessage(err));
    }
  }

  async function toggleTerminal() {
    if (!state.directory) {
      toast('Open a project first.', 'error');
      return;
    }
    if (window.TerminalPanel.isOpen()) {
      await window.TerminalPanel.close();
    } else {
      await window.TerminalPanel.open({
        directory: state.directory,
        engineUrl: state.engineUrl,
        reconnect: true,
      });
    }
  }

  function toggleTheme() {
    persistTheme(state.theme === 'dark' ? 'light' : 'dark');
  }

  function toggleTerminalSafe() {
    toggleTerminal().catch(function (err) {
      toast(errorMessage(err), 'error');
    });
  }

  function closeTerminalSafe() {
    window.TerminalPanel.close().catch(function () {});
  }

  function fitTerminalSafe() {
    window.TerminalPanel.fit();
  }

  function focusSessionsList() {
    const item = els.sessionList.querySelector('.session-item');
    if (item) {
      item.scrollIntoView({ block: 'nearest' });
      item.focus();
      return;
    }
    $('btn-new-session').focus();
  }

  function openModelPicker() {
    const select = els.modelPicker;
    if (!select) return;
    select.focus();
    if (typeof select.showPicker === 'function') {
      try {
        select.showPicker();
      } catch (err) {
        // showPicker needs a user gesture; focus alone is enough
      }
    }
  }

  function setAgentMode(agent) {
    if (!state.sessionId) {
      toast('Open a session first.', 'error');
      return;
    }
    saveAgent(state.sessionId, agent);
    renderAgentToggle();
    toast('Agent switched to ' + (agent === 'plan' ? 'Plan' : agent === 'build' ? 'Build' : agent) + '.');
  }

  function undoLastUserMessage() {
    if (!state.sessionId) {
      toast('Open a session first.', 'error');
      return;
    }
    const list = state.messages.filter(function (message) {
      return message.info && message.info.role === 'user' && message.info.id;
    });
    const last = list[list.length - 1];
    if (!last) {
      toast('There is no user message to undo.', 'error');
      return;
    }
    revertTo(last.info.id);
  }

  function redoLastRevert() {
    if (!state.sessionId) {
      toast('Open a session first.', 'error');
      return;
    }
    unrevert();
  }

  async function compactSession() {
    if (!state.sessionId) {
      toast('Open a session first.', 'error');
      return;
    }
    const model = currentModel();
    try {
      await window.Api.summarize(state.sessionId, {
        providerID: model.providerID,
        modelID: model.modelID,
      });
      toast('Compacting the conversation.');
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  }

  async function initProject() {
    if (!state.sessionId) {
      toast('Open a session first.', 'error');
      return;
    }
    const model = currentModel();
    try {
      await window.Api.initSession(state.sessionId, {
        providerID: model.providerID,
        modelID: model.modelID,
      });
      toast('Project instructions requested.');
      return;
    } catch (err) {
      // engine may require a messageID; fall back to a plain prompt
    }
    try {
      await window.Api.promptAsync(state.sessionId, {
        model: { providerID: model.providerID, modelID: model.modelID },
        agent: currentAgent(),
        parts: [{ type: 'text', text: INIT_PROMPT }],
      });
      state.busyBySession[state.sessionId] = true;
      updateStopButton();
      renderSessions();
      setTimeout(function () {
        selectSession(state.sessionId).catch(function () {});
      }, 400);
    } catch (err2) {
      toast(errorMessage(err2), 'error');
    }
  }

  function runServerCommand(command, args) {
    if (!state.sessionId) {
      toast('Open a session first.', 'error');
      return;
    }
    const model = currentModel();
    window.Api.runCommand(state.sessionId, {
      command: command.name,
      arguments: String(args || ''),
      model: model.providerID + '/' + model.modelID,
      agent: currentAgent(),
    })
      .then(function () {
        toast('Running /' + command.name + '.');
        state.busyBySession[state.sessionId] = true;
        updateStopButton();
        renderSessions();
        setTimeout(function () {
          selectSession(state.sessionId).catch(function () {});
        }, 400);
      })
      .catch(function (err) {
        toast(errorMessage(err), 'error');
      });
  }

  function builtinCommands() {
    return [
      { name: 'new', description: 'Start a new session', run: function () { newSession(); } },
      { name: 'sessions', description: 'Focus the sessions list', run: focusSessionsList },
      { name: 'plan', description: 'Switch the agent to Plan', run: function () { setAgentMode('plan'); } },
      { name: 'build', description: 'Switch the agent to Build', run: function () { setAgentMode('build'); } },
      { name: 'model', description: 'Focus and open the model picker', run: openModelPicker },
      { name: 'models', description: 'Focus and open the model picker', run: openModelPicker },
      { name: 'undo', description: 'Revert the last user message', run: undoLastUserMessage },
      { name: 'redo', description: 'Restore the last reverted message', run: redoLastRevert },
      { name: 'compact', description: 'Summarise the conversation', run: compactSession },
      { name: 'init', description: 'Create or update AGENTS.md', run: initProject },
      { name: 'clear', description: 'Start a new session', run: function () { newSession(); } },
      { name: 'theme', description: 'Toggle the light or dark theme', run: toggleTheme },
      { name: 'terminal', description: 'Toggle the terminal panel', run: toggleTerminalSafe },
      { name: 'settings', description: 'Open settings', run: openSettings },
      { name: 'help', description: 'List all slash commands', run: function () { openSlashHelp(); } },
    ];
  }

  async function ensureServerCommands() {
    if (!state.directory || state.commandsLoaded) return;
    try {
      const list = await window.Api.listCommands();
      state.serverCommands = Array.isArray(list) ? list.slice() : [];
    } catch (err) {
      state.serverCommands = [];
    }
    state.commandsLoaded = true;
  }

  function allSlashCommands() {
    const list = builtinCommands().map(function (command) {
      return { name: command.name, description: command.description || '', server: false, run: command.run };
    });
    const seen = {};
    for (const item of list) seen[item.name] = true;
    const server = state.serverCommands
      .slice()
      .sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); })
      .filter(function (command) { return command && command.name; })
      .filter(function (command) {
        if (seen[command.name]) return false;
        seen[command.name] = true;
        return true;
      })
      .map(function (command) {
        return {
          name: String(command.name),
          description: String(command.description || command.template || ''),
          server: true,
          command: command,
        };
      });
    return list.concat(server);
  }

  function parseSlashText(value) {
    const raw = String(value || '');
    if (raw.charAt(0) !== '/') return null;
    const match = raw.match(/^\/([^\s]*)/);
    if (!match) return null;
    return { name: match[1], args: raw.slice(match[0].length).trim() };
  }

  function closeSlashMenu() {
    slash.open = false;
    slash.items = [];
    slash.index = 0;
    if (els.slashMenu) {
      els.slashMenu.hidden = true;
      clear(els.slashMenu);
    }
  }

  function updateSlashMenu() {
    const parsed = parseSlashText(els.composerInput.value);
    if (!parsed) {
      closeSlashMenu();
      return;
    }
    const needle = parsed.name.toLowerCase();
    slash.items = allSlashCommands().filter(function (command) {
      return command.name.toLowerCase().indexOf(needle) === 0;
    });
    if (!slash.items.length) {
      closeSlashMenu();
      return;
    }
    slash.open = true;
    if (slash.index >= slash.items.length) slash.index = 0;
    renderSlashMenu();
    if (!state.commandsLoaded) {
      ensureServerCommands().then(function () {
        if (slash.open) updateSlashMenu();
      });
    }
  }

  function renderSlashMenu() {
    const menu = els.slashMenu;
    clear(menu);
    if (!slash.open) {
      menu.hidden = true;
      return;
    }
    slash.items.forEach(function (item, index) {
      const row = el('div', 'slash-item' + (index === slash.index ? ' is-active' : ''));
      row.setAttribute('role', 'option');
      row.dataset.index = String(index);
      if (index === slash.index) row.setAttribute('aria-selected', 'true');
      row.appendChild(el('span', 'slash-name', '/' + item.name));
      row.appendChild(el('span', 'slash-desc', item.description || ''));
      row.addEventListener('mousedown', function (event) {
        event.preventDefault();
        pickSlash(index);
      });
      row.addEventListener('mouseenter', function () {
        slash.index = index;
        const rows = menu.querySelectorAll('.slash-item');
        for (let i = 0; i < rows.length; i++) {
          rows[i].classList.toggle('is-active', i === index);
        }
      });
      menu.appendChild(row);
    });
    menu.hidden = false;
    const active = menu.querySelector('.slash-item.is-active');
    if (active && active.scrollIntoView) active.scrollIntoView({ block: 'nearest' });
  }

  function moveSlashSelection(delta) {
    if (!slash.open || !slash.items.length) return;
    slash.index = (slash.index + delta + slash.items.length) % slash.items.length;
    renderSlashMenu();
  }

  function pickSlash(index) {
    if (!slash.open || !slash.items.length) return;
    const parsed = parseSlashText(els.composerInput.value);
    let item = slash.items[typeof index === 'number' ? index : slash.index];
    if (typeof index !== 'number' && parsed) {
      const exact = slash.items.find(function (c) { return c.name === parsed.name; });
      if (exact) item = exact;
    }
    if (!item) return;
    const args = parsed ? parsed.args : '';
    closeSlashMenu();
    els.composerInput.value = '';
    autosizeComposer();
    if (item.server) {
      runServerCommand(item.command, args);
    } else if (typeof item.run === 'function') {
      item.run(args);
    }
  }

  function openSlashHelp() {
    ensureServerCommands().then(function () {
      const host = els.helpList;
      clear(host);
      const section = el('div', 'help-section');
      section.appendChild(el('div', 'help-section-title', 'Built-in commands'));
      for (const command of builtinCommands()) {
        const row = el('div', 'help-item');
        row.appendChild(el('span', 'help-name', '/' + command.name));
        row.appendChild(el('span', 'help-desc', command.description || ''));
        section.appendChild(row);
      }
      host.appendChild(section);
      const server = allSlashCommands().filter(function (command) { return command.server; });
      const serverSection = el('div', 'help-section');
      serverSection.appendChild(el('div', 'help-section-title', 'Project commands'));
      if (server.length) {
        for (const command of server) {
          const row = el('div', 'help-item');
          row.appendChild(el('span', 'help-name', '/' + command.name));
          row.appendChild(el('span', 'help-desc', command.description || ''));
          serverSection.appendChild(row);
        }
      } else {
        serverSection.appendChild(el('div', 'help-desc', 'No project commands are available.'));
      }
      host.appendChild(serverSection);
      els.helpBackdrop.hidden = false;
    });
  }

  function closeSlashHelp() {
    els.helpBackdrop.hidden = true;
  }

  function bindEvents() {
    $('btn-welcome-open').addEventListener('click', function () {
      pickAndOpenProject().catch(function (err) {
        toast(errorMessage(err), 'error');
      });
    });
    $('btn-welcome-settings').addEventListener('click', function () { openSettings(); });
    $('btn-welcome-template').addEventListener('click', function () {
      openTemplates().catch(function (err) {
        toast(errorMessage(err), 'error');
      });
    });
    $('btn-switch-project').addEventListener('click', function () {
      pickAndOpenProject().catch(function (err) {
        toast(errorMessage(err), 'error');
      });
    });
    $('btn-new-session').addEventListener('click', newSession);
    $('btn-settings').addEventListener('click', openSettings);
    $('btn-settings-close').addEventListener('click', closeSettings);
    $('btn-theme').addEventListener('click', toggleTheme);
    $('btn-unrevert').addEventListener('click', unrevert);
    $('btn-stop').addEventListener('click', stopGeneration);
    $('btn-send').addEventListener('click', function () {
      sendMessage();
    });
    $('btn-files-refresh').addEventListener('click', function () {
      loadFilesTree('');
    });
    $('btn-changes-refresh').addEventListener('click', refreshChanges);
    $('btn-search-run').addEventListener('click', runSearch);
    $('btn-lsp-refresh').addEventListener('click', refreshDiagnostics);
    $('btn-terminal-toggle').addEventListener('click', toggleTerminalSafe);
    $('btn-terminal-close').addEventListener('click', closeTerminalSafe);
    $('btn-terminal-fit').addEventListener('click', fitTerminalSafe);
    $('btn-help-close').addEventListener('click', closeSlashHelp);
    $('btn-templates-close').addEventListener('click', closeTemplates);
    $('btn-template-browse').addEventListener('click', async function () {
      try {
        const dir = await window.cordoval.pickFolder();
        if (dir) els.templateParent.value = dir;
      } catch (err) {
        toast(errorMessage(err), 'error');
      }
    });
    $('btn-template-create').addEventListener('click', createFromTemplate);

    els.composerInput.addEventListener('keydown', function (event) {
      if (slash.open) {
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          moveSlashSelection(1);
          return;
        }
        if (event.key === 'ArrowUp') {
          event.preventDefault();
          moveSlashSelection(-1);
          return;
        }
        if (event.key === 'Enter' || event.key === 'Tab') {
          event.preventDefault();
          pickSlash();
          return;
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          closeSlashMenu();
          return;
        }
      }
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        sendMessage();
      }
    });
    els.composerInput.addEventListener('input', function () {
      autosizeComposer();
      updateSlashMenu();
      updateSendButton();
    });
    els.composerInput.addEventListener('paste', function (event) {
      const clipboard = event.clipboardData;
      if (!clipboard || !clipboard.items) return;
      const files = [];
      for (const item of clipboard.items) {
        if (item.kind !== 'file') continue;
        const file = item.getAsFile();
        if (file && isImageFile(file)) files.push(file);
      }
      if (!files.length) return;
      event.preventDefault();
      addAttachments(files).catch(function (err) {
        toast(errorMessage(err), 'error');
      });
    });

    els.btnAttach.addEventListener('click', function () {
      els.attachInput.click();
    });
    els.attachInput.addEventListener('change', function () {
      addAttachments(els.attachInput.files).catch(function (err) {
        toast(errorMessage(err), 'error');
      });
      els.attachInput.value = '';
    });

    els.composer.addEventListener('dragover', function (event) {
      event.preventDefault();
      els.composer.classList.add('is-dragover');
    });
    els.composer.addEventListener('dragleave', function (event) {
      if (event.target === els.composer) els.composer.classList.remove('is-dragover');
    });
    els.composer.addEventListener('drop', function (event) {
      event.preventDefault();
      els.composer.classList.remove('is-dragover');
      const files = event.dataTransfer && event.dataTransfer.files;
      if (!files || !files.length) return;
      addAttachments(files).catch(function (err) {
        toast(errorMessage(err), 'error');
      });
    });

    els.agentBuild.addEventListener('click', function () {
      saveAgent(state.sessionId, 'build');
      renderAgentToggle();
    });
    els.agentPlan.addEventListener('click', function () {
      saveAgent(state.sessionId, 'plan');
      renderAgentToggle();
    });

    els.modelPicker.addEventListener('change', function () {
      const value = els.modelPicker.value || '';
      const parts = value.split('/');
      if (parts.length >= 2) {
        const providerID = parts[0];
        const modelID = parts.slice(1).join('/');
        saveModel(state.sessionId, { providerID: providerID, modelID: modelID });
        updateVisionWarning();
      }
    });

    els.searchInput.addEventListener('keydown', function (event) {
      if (event.key === 'Enter') {
        event.preventDefault();
        runSearch();
      }
    });

    const rightTabs = document.querySelectorAll('.right-tab');
    for (const tab of rightTabs) {
      tab.addEventListener('click', function () {
        switchRightTab(tab.dataset.tab);
      });
    }

    const settingsTabs = document.querySelectorAll('.modal-tab');
    for (const tab of settingsTabs) {
      tab.addEventListener('click', function () {
        switchSettingsTab(tab.dataset.stab);
      });
    }

    const themeRadios = document.querySelectorAll('input[name="theme"]');
    for (const radio of themeRadios) {
      radio.addEventListener('change', function () {
        if (radio.checked) persistTheme(radio.value);
      });
    }

    els.settingsBackdrop.addEventListener('click', function (event) {
      if (event.target === els.settingsBackdrop) closeSettings();
    });
    els.templatesBackdrop.addEventListener('click', function (event) {
      if (event.target === els.templatesBackdrop) closeTemplates();
    });

    els.helpBackdrop.addEventListener('click', function (event) {
      if (event.target === els.helpBackdrop) closeSlashHelp();
    });

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') {
        if (!els.helpBackdrop.hidden) closeSlashHelp();
        else if (!els.templatesBackdrop.hidden) closeTemplates();
        else if (!els.settingsBackdrop.hidden) closeSettings();
        else if (slash.open) closeSlashMenu();
      }
    });

    document.addEventListener('mousedown', function (event) {
      if (!slash.open) return;
      const wrap = els.composer && els.composer.closest('.composer-wrap');
      if (wrap && wrap.contains(event.target)) return;
      closeSlashMenu();
    });

    document.addEventListener('cordoval:file-saved', function () {
      if (!state.directory) return;
      if (state.rightTab === 'diagnostics') refreshDiagnostics();
    });
  }

  async function boot() {
    cacheElements();
    bindEvents();
    await loadSettings();
    renderRecent();
    updateProjectChrome();
    showWelcome(true);

    if (!window.cordoval) {
      els.statusEngine.textContent = 'Preload bridge unavailable.';
      return;
    }

    try {
      state.engineUrl = await window.cordoval.engineUrl();
    } catch (err) {
      els.statusEngine.textContent = 'Engine failed to start.';
      toast(errorMessage(err), 'error');
      state.ready = true;
      return;
    }

    window.Api.setBase(state.engineUrl);
    els.statusEngine.textContent = 'Engine ready';

    window.Api.on('message', function (data) {
      handleEvent(data).catch(function () {});
    });
    window.Api.on('error', function () {
      els.statusEngine.textContent = 'Event stream reconnecting...';
      setTimeout(function () {
        if (state.directory) {
          window.Api.connectEvents();
        }
      }, 1500);
    });

    await reloadKeyState();
    state.ready = true;
    try {
      const initial = await window.cordoval.initialProject();
      if (initial) await openProject(initial);
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  }

  window.CordovalApp = {
    openProject: function (dir) { return openProject(dir); },
    directory: function () { return state.directory; },
    toast: toast,
    _handleEvent: function (e) { return handleEvent(e); },
    // Saves the engine's global config, restarts the engine and reconnects the UI.
    // Saves the engine's global config and applies it live. If an agent is running, the
    // change is written now and applied as soon as every session is idle, so nothing is cut off.
    saveEngineConfig: async function (obj) {
      if (anyBusy()) {
        await window.cordoval.setEngineConfig(obj, { writeOnly: true });
        queueApply('config');
        toast('Saved. Changes apply when the running session finishes.');
        return 'deferred';
      }
      return applyEngineConfigNow(obj);
    },
    applyProjectFiles: async function () {
      if (anyBusy()) { queueApply('project'); toast('Saved. Changes apply when the running session finishes.'); return 'deferred'; }
      await window.cordoval.applyProjectFiles(state.directory);
      await afterConfigApplied();
      return true;
    },
    refreshSessions: function () { return refreshSessions(); },
    openModelPicker: function () { return openModelPicker(); },
    setAgentMode: function (a) { return setAgentMode(a); },
    agent: function () { return currentAgent(); },
    undo: function () { return undoLastUserMessage(); },
    redo: function () { return redoLastRevert(); },
    compact: function () { return compactSession(); },
    init: function () { return initProject(); },
    toggleTerminal: function () { return toggleTerminalSafe(); },
    switchRightTab: function (t) { return switchRightTab(t); },
    openSlashHelp: function () { return openSlashHelp(); },
    selectSession: function (id) { return selectSession(id); },
    newSession: function () { return newSession(); },
    openSettings: function () { return openSettings(); },
    toggleTheme: function () { return toggleTheme(); },
    applyTheme: function (t) { return applyTheme(t); },
    sessionId: function () { return state.sessionId; },
    sendText: function (t) { els.composerInput.value = t; return sendMessage(); },
  };

  boot().catch(function (err) {
    toast(errorMessage(err), 'error');
  });
})();
