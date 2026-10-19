'use strict';

(function () {
  const DEFAULT_MODEL = { providerID: 'opencode', modelID: 'mimo-v2.6-flash-free' };
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
  };

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
    return value === 'plan' ? 'plan' : 'build';
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
    els.composerInput = $('composer-input');
    els.modelPicker = $('model-picker');
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
    els.fileBackdrop = $('file-backdrop');
    els.fileTitle = $('file-title');
    els.fileContent = $('file-content');
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

  async function deleteSession(id) {
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
    if (status === 'completed' || status === 'error') details.open = true;

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

  function renderModelPicker() {
    const select = els.modelPicker;
    clear(select);
    const groups = {};
    for (const provider of state.providers) {
      groups[provider.id] = {
        id: provider.id,
        name: provider.name || PROVIDER_LABELS[provider.id] || provider.id,
        models: [],
      };
    }
    for (const provider of state.providers) {
      const models = provider.models || {};
      for (const key of Object.keys(models)) {
        const model = models[key];
        const id = (model && (model.id || model.name)) || key;
        groups[provider.id].models.push({ id: String(id), name: String((model && model.name) || id) });
      }
    }
    const current = currentModel();
    const ids = Object.keys(groups);
    if (!ids.length) {
      const option = document.createElement('option');
      option.value = DEFAULT_MODEL.providerID + '/' + DEFAULT_MODEL.modelID;
      option.textContent = DEFAULT_MODEL.providerID + ' / ' + DEFAULT_MODEL.modelID;
      select.appendChild(option);
      return;
    }
    for (const id of ids) {
      const group = groups[id];
      if (!group.models.length) {
        group.models.push({ id: current.modelID, name: current.modelID });
      }
      const optgroup = document.createElement('optgroup');
      optgroup.label = group.name;
      const sorted = group.models.slice().sort(function (a, b) {
        return a.name.localeCompare(b.name);
      });
      for (const model of sorted) {
        const option = document.createElement('option');
        option.value = group.id + '/' + model.id;
        option.textContent = model.name;
        if (group.id === current.providerID && model.id === current.modelID) {
          option.selected = true;
        }
        optgroup.appendChild(option);
      }
      select.appendChild(optgroup);
    }
  }

  function renderAgentToggle() {
    const agent = currentAgent();
    els.agentBuild.classList.toggle('is-active', agent === 'build');
    els.agentPlan.classList.toggle('is-active', agent === 'plan');
  }

  function updateStopButton() {
    els.btnStop.hidden = !isBusy(state.sessionId);
  }

  async function sendMessage() {
    const text = els.composerInput.value.trim();
    if (!text || !state.sessionId) return;
    const model = currentModel();
    const agent = currentAgent();
    const payload = {
      model: { providerID: model.providerID, modelID: model.modelID },
      agent: agent,
      parts: [{ type: 'text', text }],
    };
    els.composerInput.value = '';
    autosizeComposer();
    try {
      await window.Api.promptAsync(state.sessionId, payload);
      state.busyBySession[state.sessionId] = true;
      updateStopButton();
      renderSessions();
      const optimistic = {
        info: {
          id: 'local-' + Date.now(),
          sessionID: state.sessionId,
          role: 'user',
          time: { created: Date.now() },
        },
        parts: [{ id: 'local-part-' + Date.now(), type: 'text', text }],
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

  async function restartEngineAndReconnect() {
    if (!window.cordoval || !window.cordoval.restartEngine) return;
    const url = await window.cordoval.restartEngine();
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

  async function openProject(dir, options) {
    const opts = options || {};
    if (!dir) return;
    state.directory = dir;
    pushRecent(dir);
    if (window.Api) window.Api.setDirectory(dir);
    if (window.TerminalPanel) window.TerminalPanel.setDirectory(dir);
    updateProjectChrome();
    showWelcome(false);
    state.messages = [];
    state.sessionId = null;
    state.permissions = {};
    state.diffs = {};
    state.vcsMissing = false;
    renderMessages();
    renderPermissions();
    await window.Api.connectEvents();
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
        const busy = status.type === 'busy';
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

  async function openFile(path) {
    try {
      const data = await window.Api.fileContent(path);
      const content = data && data.content != null ? String(data.content) : '';
      els.fileTitle.textContent = path;
      els.fileContent.textContent = content;
      els.fileBackdrop.hidden = false;
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
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
        const path = item.file || item.path || '';
        btn.appendChild(el('div', 'search-result-path', path + (item.line ? ':' + item.line : '')));
        const lines = Array.isArray(item.lines) ? item.lines.join('\n') : (item.text || item.match || '');
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
      head.appendChild(el('div', 'provider-state' + (meta.set ? ' is-set' : ''), meta.set ? 'Stored in OS keychain' : 'Not set'));
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
      await window.Api.promptAsync(sessionId, {
        model: { providerID: model.providerID, modelID: model.modelID },
        agent: 'build',
        system: system,
        parts: [{ type: 'text', text: promptText }],
      });
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

  function closeFile() {
    els.fileBackdrop.hidden = true;
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

  function bindEvents() {
    $('btn-welcome-open').addEventListener('click', function () {
      pickAndOpenProject().catch(function (err) {
        toast(errorMessage(err), 'error');
      });
    });
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
    $('btn-theme').addEventListener('click', function () {
      persistTheme(state.theme === 'dark' ? 'light' : 'dark');
    });
    $('btn-unrevert').addEventListener('click', unrevert);
    $('btn-stop').addEventListener('click', stopGeneration);
    $('btn-files-refresh').addEventListener('click', function () {
      loadFilesTree('');
    });
    $('btn-changes-refresh').addEventListener('click', refreshChanges);
    $('btn-search-run').addEventListener('click', runSearch);
    $('btn-lsp-refresh').addEventListener('click', refreshDiagnostics);
    $('btn-terminal-toggle').addEventListener('click', function () {
      toggleTerminal().catch(function (err) {
        toast(errorMessage(err), 'error');
      });
    });
    $('btn-terminal-close').addEventListener('click', function () {
      window.TerminalPanel.close().catch(function () {});
    });
    $('btn-terminal-fit').addEventListener('click', function () {
      window.TerminalPanel.fit();
    });
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
    $('btn-file-close').addEventListener('click', closeFile);

    els.composerInput.addEventListener('keydown', function (event) {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        sendMessage();
      }
    });
    els.composerInput.addEventListener('input', autosizeComposer);

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
    els.fileBackdrop.addEventListener('click', function (event) {
      if (event.target === els.fileBackdrop) closeFile();
    });

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') {
        if (!els.fileBackdrop.hidden) closeFile();
        else if (!els.templatesBackdrop.hidden) closeTemplates();
        else if (!els.settingsBackdrop.hidden) closeSettings();
      }
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

  boot().catch(function (err) {
    toast(errorMessage(err), 'error');
  });
})();
