'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const net = require('net');
const path = require('path');
const { app } = require('electron');

const HOST = '127.0.0.1';
const HEALTH_TIMEOUT = 60000;
const HEALTH_INTERVAL = 250;
const MAX_LOG = 16 * 1024;

const PROVIDER_ENV = {
  openrouter: 'OPENROUTER_API_KEY',
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  google: 'GOOGLE_GENERATIVE_AI_API_KEY',
  groq: 'GROQ_API_KEY',
  xai: 'XAI_API_KEY',
};

const PLATFORM_DIR = { linux: 'linux', win32: 'win', darwin: 'mac' };

let child = null;
let current = null;
let starting = null;
let generation = 0;
let log = '';

function appendLog(chunk) {
  log = (log + String(chunk)).slice(-MAX_LOG);
}

function tailLog() {
  const lines = log.trim().split('\n').filter(Boolean).slice(-8);
  return lines.join('\n');
}

function binaryPath() {
  const exe = process.platform === 'win32' ? 'opencode.exe' : 'opencode';
  if (app.isPackaged) return path.join(process.resourcesPath, 'engine', exe);
  const dir = PLATFORM_DIR[process.platform] || 'linux';
  return path.join(__dirname, '..', '..', 'vendor', dir, exe);
}

function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, HOST, () => {
      const port = server.address().port;
      server.close(err => (err ? reject(err) : resolve(port)));
    });
  });
}

function buildConfig(keys) {
  const config = {
    $schema: 'https://opencode.ai/config.json',
    share: 'disabled',
    autoupdate: false,
    provider: {},
  };
  const custom = (keys && keys.custom) || [];
  for (const item of custom) {
    if (!item || !item.id || !item.baseURL) continue;
    const models = {};
    for (const model of item.models || []) {
      const id = String(model).trim();
      if (id) models[id] = { name: id };
    }
    config.provider[item.id] = {
      npm: '@ai-sdk/openai-compatible',
      name: String(item.name || item.id),
      options: {
        baseURL: String(item.baseURL),
        apiKey: String(item.key || ''),
      },
      models,
    };
  }
  return config;
}

function buildEnv(userData, keys) {
  const engineDir = path.join(userData, 'engine');
  const dirs = {
    XDG_DATA_HOME: path.join(engineDir, 'data'),
    XDG_CONFIG_HOME: path.join(engineDir, 'config'),
    XDG_CACHE_HOME: path.join(engineDir, 'cache'),
    XDG_STATE_HOME: path.join(engineDir, 'state'),
  };
  for (const dir of Object.values(dirs)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const env = {
    ...process.env,
    ...dirs,
    OPENCODE_DISABLE_AUTOUPDATE: '1',
    OPENCODE_DISABLE_SHARE: '1',
    OPENCODE_CONFIG_CONTENT: JSON.stringify(buildConfig(keys)),
  };
  const providers = (keys && keys.providers) || {};
  for (const id of Object.keys(PROVIDER_ENV)) {
    const value = providers[id];
    if (typeof value === 'string' && value) env[PROVIDER_ENV[id]] = value;
  }
  return env;
}

function waitForHealth(port, proc, getSpawnError, timeoutMs) {
  const endpoint = `http://${HOST}:${port}/global/health`;
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    let settled = false;
    let probing = false;
    let timer = null;

    const finish = (err, value) => {
      if (settled) return;
      settled = true;
      clearInterval(timer);
      proc.removeListener('exit', onExit);
      if (err) reject(err);
      else resolve(value);
    };

    const onExit = (code, signal) => {
      const detail = tailLog();
      finish(new Error(`Engine exited before it was ready (code ${code == null ? signal : code}).${detail ? '\n' + detail : ''}`));
    };

    proc.on('exit', onExit);

    const probe = async () => {
      if (settled || probing) return;
      const spawnError = getSpawnError();
      if (spawnError) return finish(spawnError);
      if (Date.now() - startedAt > timeoutMs) {
        const detail = tailLog();
        return finish(new Error(`Engine did not become healthy in time.${detail ? '\n' + detail : ''}`));
      }
      probing = true;
      try {
        const res = await fetch(endpoint, { signal: AbortSignal.timeout(2000) });
        if (res.ok) {
          const body = await res.json().catch(() => null);
          if (!body || body.healthy !== false) return finish(null, true);
        }
      } catch (err) {
        // not listening yet, keep polling
      } finally {
        probing = false;
      }
    };

    timer = setInterval(probe, HEALTH_INTERVAL);
    probe();
  });
}

function kill(proc) {
  if (!proc || proc.exitCode !== null || proc.signalCode !== null) return;
  try {
    proc.kill();
  } catch (err) {
    return;
  }
  const timer = setTimeout(() => {
    try {
      if (proc.exitCode === null) proc.kill('SIGKILL');
    } catch (err) {
      // already gone
    }
  }, 3000);
  if (timer.unref) timer.unref();
}

async function attempt(port, env, bin) {
  log = '';
  const proc = spawn(bin, ['serve', '--hostname', HOST, '--port', String(port)], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child = proc;
  let spawnError = null;
  proc.on('error', err => {
    spawnError = err;
  });
  proc.stdout.on('data', appendLog);
  proc.stderr.on('data', appendLog);
  try {
    await waitForHealth(port, proc, () => spawnError, HEALTH_TIMEOUT);
  } catch (err) {
    kill(proc);
    if (child === proc) child = null;
    throw spawnError || err;
  }
  return proc;
}

async function doStart(opts) {
  const gen = generation;
  const userData = opts.userData;
  const env = buildEnv(userData, opts.keys);
  const bin = binaryPath();
  const fixedPort = Number.isInteger(opts.port) ? opts.port : 0;
  let lastError = null;
  for (let i = 0; i < 3; i++) {
    if (gen !== generation) throw new Error('Engine start was cancelled.');
    const port = fixedPort || (await findFreePort());
    try {
      const proc = await attempt(port, env, bin);
      if (gen !== generation) {
        kill(proc);
        if (child === proc) child = null;
        throw new Error('Engine start was cancelled.');
      }
      child = proc;
      current = { url: `http://${HOST}:${port}`, port };
      proc.on('exit', () => {
        if (child === proc) {
          child = null;
          current = null;
        }
      });
      return current;
    } catch (err) {
      if (gen !== generation) throw err;
      lastError = err;
      if (fixedPort) break;
    }
  }
  throw lastError || new Error('Engine failed to start.');
}

function start(opts) {
  if (current) return Promise.resolve(current);
  if (starting) return starting;
  const run = doStart(opts || {}).finally(() => {
    if (starting === run) starting = null;
  });
  starting = run;
  return run;
}

function stop() {
  generation += 1;
  const proc = child;
  child = null;
  current = null;
  starting = null;
  if (proc) kill(proc);
}

async function restart(opts) {
  if (starting) {
    try {
      await starting;
    } catch (err) {
      // previous start failed, continue with a fresh one
    }
  }
  stop();
  return start(opts || {});
}

module.exports = {
  start,
  stop,
  restart,
  buildConfig,
  buildEnv,
  binaryPath,
  findFreePort,
};
