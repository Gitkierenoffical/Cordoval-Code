'use strict';

const fs = require('fs');
const path = require('path');
const { app, safeStorage } = require('electron');

const PROVIDER_IDS = ['openrouter', 'openai', 'anthropic', 'google', 'groq', 'xai'];

function file() {
  return path.join(app.getPath('userData'), 'keys.json');
}

function validId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value);
}

function slug(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

function encodeSecret(value) {
  const text = String(value);
  try {
    if (safeStorage && safeStorage.isEncryptionAvailable()) {
      return { t: 'enc', d: safeStorage.encryptString(text).toString('base64') };
    }
  } catch (err) {
    // fall through to plain storage, never log the value
  }
  return { t: 'plain', d: Buffer.from(text, 'utf8').toString('base64') };
}

function decodeSecret(entry) {
  if (!entry || typeof entry !== 'object' || typeof entry.d !== 'string') return '';
  try {
    const buf = Buffer.from(entry.d, 'base64');
    if (entry.t === 'enc') return safeStorage.decryptString(buf);
    return buf.toString('utf8');
  } catch (err) {
    return '';
  }
}

function load() {
  try {
    const doc = JSON.parse(fs.readFileSync(file(), 'utf8'));
    if (!doc || typeof doc !== 'object') return { v: 1, providers: {}, custom: [] };
    return {
      v: 1,
      providers: doc.providers && typeof doc.providers === 'object' ? doc.providers : {},
      custom: Array.isArray(doc.custom) ? doc.custom.filter(c => c && typeof c === 'object') : [],
    };
  } catch (err) {
    return { v: 1, providers: {}, custom: [] };
  }
}

function save(doc) {
  const target = file();
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = target + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(doc, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, target);
}

function normalizeModels(value) {
  const raw = Array.isArray(value) ? value : String(value == null ? '' : value).split(',');
  const out = [];
  for (const item of raw) {
    const model = String(item == null ? '' : item).trim();
    if (model && !out.includes(model)) out.push(model);
  }
  return out;
}

function getMeta() {
  const doc = load();
  const ids = PROVIDER_IDS.slice();
  for (const id of Object.keys(doc.providers)) {
    if (!ids.includes(id) && validId(id)) ids.push(id);
  }
  return ids.map(id => ({ id, set: !!(doc.providers[id] && decodeSecret(doc.providers[id])) }));
}

function setKey(provider, value) {
  const id = String(provider == null ? '' : provider);
  if (!validId(id)) throw new Error('Invalid provider.');
  const doc = load();
  if (value === null || value === undefined || String(value) === '') {
    delete doc.providers[id];
  } else {
    doc.providers[id] = encodeSecret(value);
  }
  save(doc);
  return true;
}

function deleteKey(provider) {
  const id = String(provider == null ? '' : provider);
  if (!validId(id)) throw new Error('Invalid provider.');
  const doc = load();
  delete doc.providers[id];
  save(doc);
  return true;
}

function getCustom() {
  return load().custom.map(c => ({
    id: String(c.id || ''),
    name: String(c.name || ''),
    baseURL: String(c.baseURL || ''),
    models: Array.isArray(c.models) ? c.models.map(m => String(m)) : [],
    hasKey: !!c.key,
    apiKey: '',
  }));
}

function setCustom(list) {
  if (!Array.isArray(list)) throw new Error('Invalid custom endpoints.');
  const doc = load();
  const previous = new Map(doc.custom.map(c => [String(c.id || ''), c]));
  const used = new Set();
  const next = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const name = String(item.name == null ? '' : item.name).trim();
    const baseURL = String(item.baseURL == null ? '' : item.baseURL).trim();
    if (!name && !baseURL) continue;
    let id = validId(item.id) ? item.id : slug(item.id || name || baseURL);
    if (!id) id = 'endpoint';
    let unique = id;
    let n = 2;
    while (used.has(unique)) unique = id + '-' + n++;
    used.add(unique);
    const previousEntry = previous.get(unique);
    const rawKey = item.apiKey !== undefined ? item.apiKey : item.key;
    let key;
    if (rawKey === null) key = undefined;
    else if (typeof rawKey === 'string' && rawKey.trim() !== '') key = encodeSecret(rawKey.trim());
    else key = previousEntry ? previousEntry.key : undefined;
    const entry = { id: unique, name, baseURL, models: normalizeModels(item.models) };
    if (key) entry.key = key;
    next.push(entry);
  }
  doc.custom = next;
  save(doc);
  return true;
}

function readAll() {
  const doc = load();
  const providers = {};
  for (const id of Object.keys(doc.providers)) {
    const value = decodeSecret(doc.providers[id]);
    if (value) providers[id] = value;
  }
  const custom = [];
  for (const c of doc.custom) {
    const baseURL = String(c.baseURL || '');
    const id = String(c.id || '');
    if (!id || !baseURL) continue;
    custom.push({
      id,
      name: String(c.name || ''),
      baseURL,
      models: Array.isArray(c.models) ? c.models.map(m => String(m)) : [],
      key: decodeSecret(c.key),
    });
  }
  return { providers, custom };
}

module.exports = {
  PROVIDER_IDS,
  getMeta,
  setKey,
  deleteKey,
  getCustom,
  setCustom,
  readAll,
};
