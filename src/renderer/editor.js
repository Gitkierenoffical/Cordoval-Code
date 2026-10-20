'use strict';

(function () {
  const VS_BASE = '../../node_modules/monaco-editor/min/vs';
  const LANG_BY_EXT = {
    js: 'javascript',
    mjs: 'javascript',
    cjs: 'javascript',
    jsx: 'javascript',
    ts: 'typescript',
    mts: 'typescript',
    cts: 'typescript',
    tsx: 'typescript',
    json: 'json',
    jsonc: 'json',
    json5: 'json',
    css: 'css',
    scss: 'scss',
    less: 'less',
    html: 'html',
    htm: 'html',
    vue: 'html',
    hbs: 'handlebars',
    handlebars: 'handlebars',
    xml: 'xml',
    svg: 'xml',
    xaml: 'xml',
    plist: 'xml',
    md: 'markdown',
    markdown: 'markdown',
    yml: 'yaml',
    yaml: 'yaml',
    py: 'python',
    pyw: 'python',
    pyi: 'python',
    go: 'go',
    rs: 'rust',
    java: 'java',
    kt: 'kotlin',
    kts: 'kotlin',
    c: 'c',
    h: 'c',
    cpp: 'cpp',
    cc: 'cpp',
    cxx: 'cpp',
    hpp: 'cpp',
    hh: 'cpp',
    cs: 'csharp',
    rb: 'ruby',
    php: 'php',
    swift: 'swift',
    scala: 'scala',
    sh: 'shell',
    bash: 'shell',
    zsh: 'shell',
    fish: 'shell',
    ps1: 'powershell',
    psm1: 'powershell',
    bat: 'bat',
    cmd: 'bat',
    sql: 'sql',
    ini: 'ini',
    toml: 'ini',
    conf: 'ini',
    cfg: 'ini',
    env: 'ini',
    dockerfile: 'dockerfile',
    graphql: 'graphql',
    gql: 'graphql',
    txt: 'plaintext',
    log: 'plaintext',
    csv: 'plaintext',
  };

  const els = {};
  const tabs = new Map();

  let loaderPromise = null;
  let monacoApi = null;
  let editor = null;
  let editorDir = null;
  let activeKey = null;
  let themeObserver = null;
  let initialized = false;

  function cacheEls() {
    els.pane = document.getElementById('editor-pane');
    els.chat = document.getElementById('chat');
    els.tabs = document.getElementById('editor-tabs');
    els.host = document.getElementById('editor-host');
    els.btnSave = document.getElementById('btn-editor-save');
    els.btnClose = document.getElementById('btn-editor-close');
    els.status = document.getElementById('editor-status');
  }

  function baseName(relPath) {
    const parts = String(relPath || '').split(/[\\/]/).filter(Boolean);
    return parts.length ? parts[parts.length - 1] : String(relPath || '');
  }

  function languageFor(relPath) {
    const name = baseName(relPath).toLowerCase();
    if (name === 'dockerfile' || name === 'makefile') return name === 'dockerfile' ? 'dockerfile' : 'plaintext';
    const dot = name.lastIndexOf('.');
    if (dot <= 0) return 'plaintext';
    return LANG_BY_EXT[name.slice(dot + 1)] || 'plaintext';
  }

  function currentTheme() {
    return document.documentElement.getAttribute('data-theme') === 'dark' ? 'vs-dark' : 'cordoval-light';
  }

  function paneVisible() {
    return !!(els.pane && !els.pane.hidden);
  }

  function activeTab() {
    return activeKey != null ? tabs.get(activeKey) || null : null;
  }

  function toast(message, kind) {
    const host = document.getElementById('toast-host');
    if (!host) return;
    const item = document.createElement('div');
    item.className = 'toast' + (kind === 'error' ? ' error' : '');
    item.textContent = String(message);
    host.appendChild(item);
    setTimeout(function () {
      if (item.parentNode) item.parentNode.removeChild(item);
    }, kind === 'error' ? 6000 : 3200);
  }

  function reportError(err) {
    toast(err && err.message ? err.message : String(err), 'error');
  }

  function setStatus(text) {
    if (!els.status) return;
    els.status.textContent = text || '';
    els.status.hidden = !text;
  }

  function absoluteUrl(rel) {
    return new URL(rel, window.location.href).href;
  }

  function workerUrl(modulePath) {
    const target = absoluteUrl(modulePath);
    const minBase = absoluteUrl(VS_BASE + '/');
    const baseUrl = minBase.replace(/vs\/$/, '');
    const source =
      'self.MonacoEnvironment = Object.assign({}, self.MonacoEnvironment, { baseUrl: ' +
      JSON.stringify(baseUrl) +
      ' });importScripts(' +
      JSON.stringify(target) +
      ');';
    return URL.createObjectURL(new Blob([source], { type: 'application/javascript' }));
  }

  window.MonacoEnvironment = {
    getWorkerUrl: function (moduleId, label) {
      return new URL(VS_BASE + '/base/worker/workerMain.js', window.location.href).href;
    },
  };

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      const script = document.createElement('script');
      script.src = src;
      script.onload = function () {
        resolve();
      };
      script.onerror = function () {
        reject(new Error('Failed to load ' + src));
      };
      document.head.appendChild(script);
    });
  }

  function defineThemes(monaco) {
    monaco.editor.defineTheme('cordoval-light', {
      base: 'vs',
      inherit: true,
      rules: [],
      colors: {
        'editor.background': '#FFFFFF',
        'editor.foreground': '#1B1830',
        'editorCursor.foreground': '#0A5CFF',
        'editorLineNumber.foreground': '#8B86A8',
        'editorLineNumber.activeForeground': '#0A5CFF',
        'editor.selectionBackground': '#0A5CFF33',
        'editor.inactiveSelectionBackground': '#0A5CFF1A',
        'editor.lineHighlightBackground': '#F4F2FB',
        'editorWhitespace.foreground': '#C9C2E4',
        'editorIndentGuide.background1': '#E3DEF5',
        'editorIndentGuide.activeBackground1': '#0A5CFF55',
        'editorWidget.background': '#FFFFFF',
        'editorWidget.border': '#E3DEF5',
        'editorSuggestWidget.background': '#FFFFFF',
        'editorSuggestWidget.border': '#E3DEF5',
        'editorError.foreground': '#C0392B',
        'editorWarning.foreground': '#9A6700',
      },
    });
  }

  function ensureMonaco() {
    if (loaderPromise) return loaderPromise;
    loaderPromise = loadScript(VS_BASE + '/loader.js')
      .then(function () {
        const req = window.require;
        if (!req || typeof req.config !== 'function') {
          throw new Error('Monaco AMD loader unavailable.');
        }
        req.config({ paths: { vs: VS_BASE } });
        return new Promise(function (resolve, reject) {
          req(
            ['vs/editor/editor.main'],
            function () {
              if (!window.monaco) {
                reject(new Error('Monaco did not initialise.'));
                return;
              }
              resolve(window.monaco);
            },
            function (err) {
              reject(err || new Error('Monaco failed to load.'));
            }
          );
        });
      })
      .then(function (monaco) {
        monacoApi = monaco;
        defineThemes(monaco);
        return monaco;
      });
    loaderPromise.catch(function () {
      loaderPromise = null;
    });
    return loaderPromise;
  }

  function modelUri(monaco, relPath) {
    const dir = String(editorDir || '').replace(/\\/g, '/');
    const rel = String(relPath || '').replace(/\\/g, '/').replace(/^\/+/, '');
    return monaco.Uri.from({ scheme: 'file', path: '/' + dir.replace(/^\/+/, '') + '/' + rel });
  }

  function observeTheme() {
    if (themeObserver) return;
    themeObserver = new MutationObserver(function () {
      if (monacoApi) monacoApi.editor.setTheme(currentTheme());
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
  }

  function renderTabs() {
    if (!els.tabs) return;
    while (els.tabs.firstChild) els.tabs.removeChild(els.tabs.firstChild);
    const chatTab = document.createElement('button');
    chatTab.type = 'button';
    chatTab.className = 'editor-tab editor-tab-chat' + (activeKey == null || !paneVisible() ? ' is-active' : '');
    chatTab.setAttribute('role', 'tab');
    chatTab.textContent = 'Chat';
    chatTab.addEventListener('click', function () {
      showChat();
    });
    els.tabs.appendChild(chatTab);
    tabs.forEach(function (tab, key) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'editor-tab' + (key === activeKey && paneVisible() ? ' is-active' : '');
      btn.setAttribute('role', 'tab');
      btn.title = tab.relPath;
      const name = document.createElement('span');
      name.className = 'editor-tab-name';
      name.textContent = baseName(tab.relPath);
      btn.appendChild(name);
      const dirty = document.createElement('span');
      dirty.className = 'editor-tab-dirty';
      dirty.textContent = '*';
      dirty.hidden = !tab.dirty;
      btn.appendChild(dirty);
      btn.addEventListener('click', function () {
        activate(key);
      });
      els.tabs.appendChild(btn);
    });
  }

  function showEditorPane() {
    if (!els.pane || !els.chat) return;
    els.chat.hidden = true;
    els.pane.hidden = false;
    if (editor) editor.layout();
    renderTabs();
  }

  function showChat() {
    if (!els.pane || !els.chat) return;
    els.pane.hidden = true;
    els.chat.hidden = false;
    renderTabs();
  }

  function ensureEditor(monaco) {
    if (editor) return editor;
    editor = monaco.editor.create(els.host, {
      theme: currentTheme(),
      automaticLayout: true,
      fontSize: 13,
      minimap: { enabled: true },
      scrollBeyondLastLine: false,
      renderWhitespace: 'selection',
      smoothScrolling: true,
    });
    observeTheme();
    return editor;
  }

  function activate(key) {
    const tab = tabs.get(key);
    if (!tab || !editor) return;
    activeKey = key;
    editor.setModel(tab.model);
    editor.focus();
    showEditorPane();
  }

  function disposeAll() {
    tabs.forEach(function (tab) {
      if (tab.listener) tab.listener.dispose();
      tab.model.dispose();
    });
    tabs.clear();
    activeKey = null;
    setStatus('');
    showChat();
  }

  function lspServerList(data) {
    if (Array.isArray(data)) return data;
    if (data && Array.isArray(data.servers)) return data.servers;
    if (data && typeof data === 'object') {
      return Object.keys(data)
        .map(function (key) {
          return data[key];
        })
        .filter(function (value) {
          return value && typeof value === 'object';
        });
    }
    return [];
  }

  function lspIsActive(item) {
    const status = String((item && (item.status || item.state)) || '').toLowerCase();
    if (!status) return true;
    return /ready|active|running|ok|started|healthy/.test(status) && !/error|crash|stopped|failed|down/.test(status);
  }

  async function checkLsp(relPath) {
    if (!window.Api || !window.Api.lsp) return;
    try {
      const data = await window.Api.lsp();
      const servers = lspServerList(data);
      const active = servers.filter(lspIsActive);
      const lang = languageFor(relPath);
      const names = active
        .map(function (item) {
          return String((item && (item.name || item.id || item.serverID)) || '').trim();
        })
        .filter(Boolean);
      let text;
      if (names.length) {
        text = 'LSP: ' + names.join(', ') + ' active';
      } else if (lang && lang !== 'plaintext') {
        text = 'LSP: no active server for ' + lang;
      } else {
        text = 'LSP: no active servers';
      }
      setStatus(text);
    } catch (err) {
      setStatus('LSP: unavailable');
    }
  }

  async function open(relPath) {
    if (!initialized) cacheEls();
    if (typeof relPath !== 'string' || !relPath.trim()) {
      throw new Error('Missing file path.');
    }
    if (!window.Api || !window.Api.fileContent) {
      throw new Error('Engine API unavailable.');
    }
    const dir = (window.Api.getDirectory && window.Api.getDirectory()) || '';
    if (editorDir !== dir) {
      editorDir = dir;
      disposeAll();
    }
    const monaco = await ensureMonaco();
    if (tabs.has(relPath)) {
      activate(relPath);
      return;
    }
    let content = '';
    try {
      const data = await window.Api.fileContent(relPath);
      content = data && data.content != null ? String(data.content) : '';
    } catch (err) {
      throw new Error('Could not open ' + relPath + ': ' + (err && err.message ? err.message : String(err)));
    }
    const model = monaco.editor.createModel(content, languageFor(relPath), modelUri(monaco, relPath));
    const tab = { relPath: relPath, model: model, saved: content, dirty: false, listener: null };
    tab.listener = model.onDidChangeContent(function () {
      const dirty = model.getValue() !== tab.saved;
      if (dirty !== tab.dirty) {
        tab.dirty = dirty;
        renderTabs();
      }
    });
    tabs.set(relPath, tab);
    ensureEditor(monaco);
    activate(relPath);
  }

  async function save() {
    const tab = activeTab();
    if (!tab) return false;
    if (!window.cordoval || !window.cordoval.writeFile) {
      throw new Error('Save is unavailable.');
    }
    const dir = (window.Api && window.Api.getDirectory && window.Api.getDirectory()) || '';
    if (!dir) {
      throw new Error('Open a project first.');
    }
    const content = tab.model.getValue();
    await window.cordoval.writeFile(dir, tab.relPath, content);
    tab.saved = content;
    if (tab.dirty) {
      tab.dirty = false;
      renderTabs();
    }
    toast('Saved ' + tab.relPath);
    try {
      document.dispatchEvent(new CustomEvent('cordoval:file-saved', { detail: { path: tab.relPath } }));
    } catch (err) {
      // CustomEvent is available in Electron; ignore otherwise
    }
    checkLsp(tab.relPath);
    return true;
  }

  function close() {
    const key = activeKey;
    if (key == null) {
      if (paneVisible()) showChat();
      return;
    }
    const tab = tabs.get(key);
    if (tab) {
      if (tab.listener) tab.listener.dispose();
      tab.model.dispose();
      tabs.delete(key);
    }
    activeKey = null;
    const next = tabs.keys().next();
    if (!next.done) {
      activate(next.value);
    } else {
      setStatus('');
      showChat();
    }
  }

  function bindGlobalKeys() {
    window.addEventListener(
      'keydown',
      function (event) {
        if (!paneVisible()) return;
        if (event.ctrlKey || event.metaKey) {
          if (event.altKey || event.shiftKey) return;
          if (event.key !== 's' && event.key !== 'S' && event.code !== 'KeyS') return;
          event.preventDefault();
          event.stopPropagation();
          save().catch(reportError);
        }
      },
      true
    );
  }

  function init() {
    if (initialized) return;
    initialized = true;
    cacheEls();
    if (els.btnSave) {
      els.btnSave.addEventListener('click', function () {
        save().catch(reportError);
      });
    }
    if (els.btnClose) {
      els.btnClose.addEventListener('click', function () {
        close();
      });
    }
    document.addEventListener('cordoval:project-changed', function () {
      editorDir = (window.Api && window.Api.getDirectory && window.Api.getDirectory()) || '';
      disposeAll();
    });
    bindGlobalKeys();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.CodeEditor = {
    open: open,
    save: save,
    close: close,
  };
})();
