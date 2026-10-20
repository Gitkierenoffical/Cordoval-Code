'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { app } = require('electron');

const LANGUAGE_IDS = {
  '.ts': 'typescript',
  '.tsx': 'typescriptreact',
  '.js': 'javascript',
  '.jsx': 'javascriptreact',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.py': 'python',
  '.rs': 'rust',
  '.go': 'go',
  '.kt': 'kotlin',
  '.kts': 'kotlin',
  '.dart': 'dart',
};
const { RESOLVERS } = require('./lsp-fetch');

const SERVER_DEFS = {
  ts: {
    extensions: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'],
    module: 'typescript-language-server/lib/cli.mjs',
    args: ['--stdio'],
    initializationOptions() {
      const tsserverPath = resolveTsserverDir();
      return tsserverPath ? { tsserver: { path: tsserverPath } } : {};
    },
  },
  python: {
    extensions: ['.py'],
    module: 'pyright/langserver.index.js',
    args: ['--stdio'],
    initializationOptions() {
      return {};
    },
  },
};

SERVER_DEFS.rust = { extensions: ['.rs'], resolve: RESOLVERS.rust, rootMarkers: ['Cargo.toml'], initializationOptions() { return {}; } };
SERVER_DEFS.go = { extensions: ['.go'], resolve: RESOLVERS.go, rootMarkers: ['go.mod'], initializationOptions() { return {}; } };
SERVER_DEFS.kotlin = { extensions: ['.kt', '.kts'], resolve: RESOLVERS.kotlin, rootMarkers: ['settings.gradle.kts', 'settings.gradle', 'build.gradle.kts'], initializationOptions() { return {}; } };
SERVER_DEFS.dart = { extensions: ['.dart'], resolve: RESOLVERS.dart, rootMarkers: ['pubspec.yaml'], initializationOptions() { return {}; } };

const servers = new Map();
let notifyStatus = null;
function setStatusNotifier(fn) { notifyStatus = fn; }
function status(msg) { if (notifyStatus) try { notifyStatus(msg); } catch (e) {} }
let notifyRenderer = null;
let nextRequestId = 1;

function resolveUnpackedPath(moduleId) {
  const resolved = require.resolve(moduleId);
  if (!app.isPackaged) return resolved;
  return resolved.split('app.asar' + path.sep).join('app.asar.unpacked' + path.sep);
}

function resolveTsserverDir() {
  let dir = null;
  try {
    dir = path.dirname(resolveUnpackedPath('typescript/lib/tsserver.js'));
  } catch (err) {
    try {
      const pkg = resolveUnpackedPath('typescript/package.json');
      const candidate = path.join(path.dirname(pkg), 'lib', 'tsserver.js');
      if (fs.existsSync(candidate)) dir = path.dirname(candidate);
    } catch (err2) {
      dir = null;
    }
  }
  if (dir) {
    try {
      if (!fs.existsSync(path.join(dir, 'tsserver.js'))) dir = null;
    } catch (err) {
      dir = null;
    }
  }
  return dir;
}

function defForPath(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const keys = Object.keys(SERVER_DEFS);
  for (const key of keys) {
    if (SERVER_DEFS[key].extensions.indexOf(ext) !== -1) {
      return { serverKey: key, def: SERVER_DEFS[key], languageId: LANGUAGE_IDS[ext] || key };
    }
  }
  return null;
}

function resolveInside(projectDir, relPath) {
  const root = path.resolve(projectDir);
  const target = path.resolve(root, relPath);
  const rel = path.relative(root, target);
  if (!rel || rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) {
    throw new Error('Refusing to access a file outside the project directory.');
  }
  return { root: root, target: target };
}

function toFileUri(filePath) {
  let resolved = path.resolve(filePath).replace(/\\/g, '/');
  if (!resolved.startsWith('/')) resolved = '/' + resolved;
  return (
    'file://' +
    resolved
      .split('/')
      .map(function (part, index) {
        return index === 0 ? part : encodeURIComponent(part).replace(/%3A/gi, ':');
      })
      .join('/')
  );
}

function uriToFsPath(uri) {
  if (typeof uri !== 'string' || uri.slice(0, 7) !== 'file://') return '';
  let decoded;
  try {
    decoded = decodeURIComponent(uri.slice(7));
  } catch (err) {
    return '';
  }
  if (/^\/[a-zA-Z]:\//.test(decoded)) decoded = decoded.slice(1);
  return decoded;
}

function serverKeyFor(serverKey, root) {
  return serverKey + '\n' + root;
}

function write(server, message) {
  if (!server.alive) return;
  let json;
  try {
    json = JSON.stringify(message);
  } catch (err) {
    return;
  }
  const stdin = server.proc && server.proc.stdin;
  if (!stdin || stdin.destroyed || !stdin.writable) return;
  try {
    stdin.write('Content-Length: ' + Buffer.byteLength(json, 'utf8') + '\r\n\r\n' + json);
  } catch (err) {
    // the process may have exited; the exit handler retires the server
  }
}

function request(server, method, params) {
  return new Promise(function (resolve, reject) {
    if (!server.alive) {
      reject(new Error('Language server is not running.'));
      return;
    }
    const id = nextRequestId++;
    server.pending.set(id, { resolve: resolve, reject: reject });
    write(server, { jsonrpc: '2.0', id: id, method: method, params: params });
  });
}

function respond(server, id, result) {
  write(server, { jsonrpc: '2.0', id: id, result: result });
}

function failPending(server, err) {
  const pending = Array.from(server.pending.values());
  server.pending.clear();
  for (const item of pending) item.reject(err);
}

function retire(server) {
  server.alive = false;
  const key = serverKeyFor(server.serverKey, server.root);
  if (servers.get(key) === server) servers.delete(key);
  failPending(server, new Error('Language server exited.'));
}

function handleRequest(server, msg) {
  if (msg.method === 'workspace/configuration') {
    const items = msg.params && Array.isArray(msg.params.items) ? msg.params.items : [];
    respond(
      server,
      msg.id,
      items.map(function () {
        return null;
      })
    );
    return;
  }
  // window/workDoneProgress/create, client/registerCapability, and anything else
  respond(server, msg.id, null);
}

function handleNotification(server, msg) {
  if (msg.method !== 'textDocument/publishDiagnostics') return;
  const params = msg.params || {};
  if (typeof notifyRenderer !== 'function') return;
  const uri = typeof params.uri === 'string' ? params.uri : '';
  notifyRenderer('lsp:diagnostics', {
    uri: uri,
    path: uriToFsPath(uri),
    diagnostics: Array.isArray(params.diagnostics) ? params.diagnostics : [],
  });
}

function handleMessage(server, text) {
  let msg;
  try {
    msg = JSON.parse(text);
  } catch (err) {
    return;
  }
  if (!msg || typeof msg !== 'object') return;
  const hasId = msg.id !== undefined && msg.id !== null;
  if (msg.method && hasId) {
    handleRequest(server, msg);
    return;
  }
  if (msg.method) {
    handleNotification(server, msg);
    return;
  }
  if (!hasId) return;
  const pending = server.pending.get(msg.id);
  if (!pending) return;
  server.pending.delete(msg.id);
  if (msg.error) pending.reject(new Error(msg.error.message || 'Language server request failed.'));
  else pending.resolve(msg.result);
}

function onStdout(server, chunk) {
  server.buffer = Buffer.concat([server.buffer, chunk]);
  for (;;) {
    const headerEnd = server.buffer.indexOf('\r\n\r\n');
    if (headerEnd === -1) return;
    const header = server.buffer.slice(0, headerEnd).toString('ascii');
    const match = header.match(/Content-Length:\s*(\d+)/i);
    const bodyStart = headerEnd + 4;
    if (!match) {
      server.buffer = server.buffer.slice(bodyStart);
      continue;
    }
    const length = parseInt(match[1], 10);
    if (!Number.isFinite(length) || length < 0) {
      server.buffer = server.buffer.slice(bodyStart);
      continue;
    }
    if (server.buffer.length < bodyStart + length) return;
    const body = server.buffer.slice(bodyStart, bodyStart + length).toString('utf8');
    server.buffer = server.buffer.slice(bodyStart + length);
    handleMessage(server, body);
  }
}

function initializeServer(server, def) {
  const rootUri = toFileUri(server.root);
  const initializationOptions = typeof def.initializationOptions === 'function' ? def.initializationOptions() : {};
  return request(server, 'initialize', {
    processId: process.pid,
    rootPath: server.root,
    rootUri: rootUri,
    workspaceFolders: [{ uri: rootUri, name: path.basename(server.root) || server.root }],
    capabilities: {
      workspace: { configuration: true, workspaceFolders: true },
      textDocument: {
        synchronization: { dynamicRegistration: false, willSave: false, didSave: true },
        publishDiagnostics: { relatedInformation: true, versionSupport: true },
      },
    },
    initializationOptions: initializationOptions,
  }).then(function () {
    write(server, { jsonrpc: '2.0', method: 'initialized', params: {} });
  });
}

function startServer(serverKey, def, root) {
  const server = {
    serverKey: serverKey,
    root: root,
    proc: null,
    docs: new Map(),
    pending: new Map(),
    buffer: Buffer.alloc(0),
    alive: true,
  };
  if (def.resolve) {
    status({ server: serverKey, state: 'starting', message: 'Starting ' + serverKey + ' language server (downloading on first use)...' });
    server.ready = def.resolve().then(function (cmd) {
      const shell = process.platform === 'win32' && /\.(bat|cmd)$/i.test(cmd.command);
      const proc = spawn(cmd.command, cmd.args, { cwd: root, env: process.env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, shell: shell });
      attachProcess(server, proc);
      return initializeServer(server, def);
    }).then(function (r) {
      status({ server: serverKey, state: 'ready', message: serverKey + ' language server ready.' });
      return r;
    }).catch(function (err) {
      status({ server: serverKey, state: 'error', message: String(err && err.message || err) });
      retire(server);
      throw err;
    });
    return server;
  }
  const cli = resolveUnpackedPath(def.module);
  const env = Object.assign({}, process.env, { ELECTRON_RUN_AS_NODE: '1' });
  const proc = spawn(process.execPath, [cli].concat(def.args), {
    cwd: root,
    env: env,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  attachProcess(server, proc);
  server.ready = initializeServer(server, def).catch(function (err) {
    retire(server);
    throw err;
  });
  return server;
}

function attachProcess(server, proc) {
  server.proc = proc;
  proc.stdout.on('data', function (chunk) {
    onStdout(server, chunk);
  });
  proc.stderr.on('data', function () {
    // discard; server output can contain file contents
  });
  proc.on('error', function () {
    retire(server);
  });
  proc.on('exit', function () {
    retire(server);
  });
}

function getServer(match, root) {
  const key = serverKeyFor(match.serverKey, root);
  let server = servers.get(key);
  if (server) return server;
  server = startServer(match.serverKey, match.def, root);
  servers.set(key, server);
  return server;
}

function sendOpen(server, uri, languageId, text) {
  server.docs.set(uri, { languageId: languageId, version: 1 });
  write(server, {
    jsonrpc: '2.0',
    method: 'textDocument/didOpen',
    params: {
      textDocument: { uri: uri, languageId: languageId, version: 1, text: String(text) },
    },
  });
}

function sendChange(server, uri, text, version) {
  write(server, {
    jsonrpc: '2.0',
    method: 'textDocument/didChange',
    params: {
      textDocument: { uri: uri, version: version },
      contentChanges: [{ text: String(text) }],
    },
  });
}

function open(projectDir, relPath, text) {
  const resolved = resolveInside(projectDir, relPath);
  const match = defForPath(resolved.target);
  if (!match) return false;
  const server = getServer(match, resolved.root);
  const uri = toFileUri(resolved.target);
  server.ready
    .then(function () {
      const doc = server.docs.get(uri);
      if (doc) {
        doc.version += 1;
        sendChange(server, uri, text, doc.version);
        return;
      }
      sendOpen(server, uri, match.languageId, text);
    })
    .catch(function () {
      // startup failures stay silent; diagnostics simply never arrive
    });
  return true;
}

function change(projectDir, relPath, text) {
  const resolved = resolveInside(projectDir, relPath);
  const match = defForPath(resolved.target);
  if (!match) return false;
  const server = servers.get(serverKeyFor(match.serverKey, resolved.root));
  if (!server) return open(projectDir, relPath, text);
  const uri = toFileUri(resolved.target);
  server.ready
    .then(function () {
      const doc = server.docs.get(uri);
      if (!doc) {
        sendOpen(server, uri, match.languageId, text);
        return;
      }
      doc.version += 1;
      sendChange(server, uri, text, doc.version);
    })
    .catch(function () {});
  return true;
}

function save(projectDir, relPath, text) {
  const resolved = resolveInside(projectDir, relPath);
  const match = defForPath(resolved.target);
  if (!match) return false;
  const server = servers.get(serverKeyFor(match.serverKey, resolved.root));
  if (!server) return false;
  const uri = toFileUri(resolved.target);
  server.ready
    .then(function () {
      if (!server.docs.has(uri)) return;
      const params = { textDocument: { uri: uri } };
      if (typeof text === 'string') params.text = text;
      write(server, { jsonrpc: '2.0', method: 'textDocument/didSave', params: params });
    })
    .catch(function () {});
  return true;
}

function close(projectDir, relPath) {
  const resolved = resolveInside(projectDir, relPath);
  const match = defForPath(resolved.target);
  if (!match) return false;
  const server = servers.get(serverKeyFor(match.serverKey, resolved.root));
  if (!server) return false;
  const uri = toFileUri(resolved.target);
  server.ready
    .then(function () {
      if (!server.docs.has(uri)) return;
      server.docs.delete(uri);
      write(server, {
        jsonrpc: '2.0',
        method: 'textDocument/didClose',
        params: { textDocument: { uri: uri } },
      });
    })
    .catch(function () {});
  return true;
}

function shutdown(server) {
  const id = nextRequestId++;
  write(server, { jsonrpc: '2.0', id: id, method: 'shutdown', params: null });
  write(server, { jsonrpc: '2.0', method: 'exit', params: null });
  server.alive = false;
  failPending(server, new Error('Language server stopped.'));
  const proc = server.proc;
  if (!proc) return;
  const timer = setTimeout(function () {
    try {
      if (!proc.killed) proc.kill();
    } catch (err) {
      // already gone
    }
  }, 1000);
  if (timer.unref) timer.unref();
}

function stopAll() {
  const list = Array.from(servers.values());
  servers.clear();
  for (const server of list) shutdown(server);
}

function setSender(fn) {
  notifyRenderer = typeof fn === 'function' ? fn : null;
}

module.exports = {
  setStatusNotifier,
  setSender: setSender,
  open: open,
  change: change,
  save: save,
  close: close,
  stopAll: stopAll,
};
