'use strict';
// Shared helpers for the Cordoval engine: sortable ids, secret redaction, small fs helpers.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

let lastTime = 0;
let counter = 0;
// Ids sort by creation time so messages and parts keep their order when sorted as strings.
function id(prefix) {
  const now = Date.now();
  if (now === lastTime) counter++; else { lastTime = now; counter = 0; }
  const t = now.toString(16).padStart(12, '0') + counter.toString(16).padStart(4, '0');
  return prefix + '_' + t + crypto.randomBytes(5).toString('hex');
}

// Secrets registered here are scrubbed from everything the engine stores, streams or returns.
const secrets = new Set();
function setSecrets(list) {
  secrets.clear();
  for (const s of list || []) if (typeof s === 'string' && s.length >= 6) secrets.add(s);
}
function redact(text) {
  let out = String(text);
  for (const s of secrets) {
    if (out.includes(s)) out = out.split(s).join('[redacted]');
    // also catch a masked echo such as "sk-or-v1-ab...wxyz" from provider errors
    const tail = s.slice(-6);
    if (s.length >= 16 && out.includes(tail)) out = out.split(tail).join('[redacted]');
  }
  return out;
}
function redactDeep(value) {
  if (!secrets.size) return value;
  return JSON.parse(redact(JSON.stringify(value)));
}

function writeJsonAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, redact(JSON.stringify(data)), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

function insideRoot(root, rel) {
  const base = path.resolve(root);
  const target = path.resolve(base, String(rel || '.'));
  const r = path.relative(base, target);
  if (r === '') return target;
  if (r === '..' || r.startsWith('..' + path.sep) || path.isAbsolute(r)) return null;
  return target;
}

function toPosix(p) { return String(p).split(path.sep).join('/'); }

function wildcard(pattern, value) {
  const re = '^' + String(pattern).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[\\s\\S]*').replace(/\?/g, '.') + '$';
  return new RegExp(re).test(String(value));
}

module.exports = { id, setSecrets, redact, redactDeep, writeJsonAtomic, insideRoot, toPosix, wildcard };
