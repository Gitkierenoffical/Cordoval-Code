'use strict';
// Bring-your-own-key providers. Keys never leave this module except as an HTTP header that is
// added inside fetch at request time, only for the provider's own host.
const PROVIDERS = {
  openrouter: { name: 'OpenRouter', kind: 'bearer', base: 'https://openrouter.ai/api/v1', models: 'https://openrouter.ai/api/v1/models' },
  openai: { name: 'OpenAI', kind: 'bearer', base: 'https://api.openai.com/v1', models: 'https://api.openai.com/v1/models' },
  anthropic: { name: 'Anthropic', kind: 'anthropic', base: 'https://api.anthropic.com/v1', models: 'https://api.anthropic.com/v1/models?limit=1000' },
  groq: { name: 'Groq', kind: 'bearer', base: 'https://api.groq.com/openai/v1', models: 'https://api.groq.com/openai/v1/models' },
  google: { name: 'Google Gemini', kind: 'google', base: 'https://generativelanguage.googleapis.com/v1beta', models: 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000' },
  xai: { name: 'xAI', kind: 'bearer', base: 'https://api.x.ai/v1', models: 'https://api.x.ai/v1/models' },
};

// Used when a provider's model list cannot be fetched.
const FALLBACK_MODELS = {
  openrouter: ['openai/gpt-5.4-mini', 'anthropic/claude-sonnet-4.6', 'google/gemini-2.5-flash', 'qwen/qwen3-coder'],
  openai: ['gpt-4.1', 'gpt-4.1-mini', 'gpt-4o-mini'],
  anthropic: ['claude-sonnet-4-5', 'claude-haiku-4-5'],
  groq: ['llama-3.3-70b-versatile', 'openai/gpt-oss-120b'],
  google: ['gemini-2.5-pro', 'gemini-2.5-flash'],
  xai: ['grok-4', 'grok-code-fast-1'],
};
const DEFAULT_MODEL = { providerID: 'openrouter', modelID: 'openai/gpt-5.4-mini' };

function makeFetch(kind, host, getKey) {
  return async (input, init) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url);
    if (url.host !== host) throw new Error('Refusing to send a provider request to ' + url.host + '.');
    const headers = new Headers((init && init.headers) || (input && input.headers) || {});
    for (const h of ['authorization', 'x-api-key', 'x-goog-api-key']) headers.delete(h);
    const key = getKey();
    if (key) {
      if (kind === 'anthropic') headers.set('x-api-key', key);
      else if (kind === 'google') headers.set('x-goog-api-key', key);
      else headers.set('authorization', 'Bearer ' + key);
    }
    if (kind === 'anthropic') headers.set('anthropic-version', headers.get('anthropic-version') || '2023-06-01');
    return fetch(url, { ...(init || {}), headers });
  };
}

class Providers {
  constructor(opts) {
    this.keys = { providers: {}, custom: [] };
    this.mock = !!(opts && opts.mock);
    this.cache = new Map();
    this.setKeys(opts && opts.keys);
  }
  setKeys(keys) {
    this.keys = { providers: { ...((keys && keys.providers) || {}) }, custom: ((keys && keys.custom) || []).map(c => ({ ...c })) };
    this.cache.clear();
  }
  secrets() { return [...Object.values(this.keys.providers), ...this.keys.custom.map(c => c.key)].filter(Boolean); }
  hasKey(id) { return !!this.keys.providers[id] || !!(this.keys.custom.find(c => c.id === id) || {}).key; }
  customEntry(id) { return this.keys.custom.find(c => c.id === id) || null; }

  languageModel(providerID, modelID) {
    if (providerID === 'mock' && this.mock) return require('./mock-model').create(modelID);
    const custom = this.customEntry(providerID);
    if (custom) {
      const { createOpenAICompatible } = require('@ai-sdk/openai-compatible');
      const host = new URL(custom.baseURL).host;
      return createOpenAICompatible({ name: providerID, baseURL: custom.baseURL.replace(/\/+$/, ''), apiKey: 'set-by-fetch', includeUsage: true, fetch: makeFetch('bearer', host, () => (this.customEntry(providerID) || {}).key) })(modelID);
    }
    const def = PROVIDERS[providerID];
    if (!def) throw new Error('Unknown provider "' + providerID + '". Add it under Settings, Providers.');
    if (!this.keys.providers[providerID]) throw new Error('No API key for ' + def.name + '. Add one in Settings, Providers.');
    const host = new URL(def.base).host;
    const fetchFn = makeFetch(def.kind, host, () => this.keys.providers[providerID]);
    const common = { apiKey: 'set-by-fetch', fetch: fetchFn, baseURL: def.base };
    switch (providerID) {
      case 'openai': return require('@ai-sdk/openai').createOpenAI(common)(modelID);
      case 'anthropic': return require('@ai-sdk/anthropic').createAnthropic(common)(modelID);
      case 'groq': return require('@ai-sdk/groq').createGroq(common)(modelID);
      case 'google': return require('@ai-sdk/google').createGoogleGenerativeAI(common)(modelID);
      default: return require('@ai-sdk/openai-compatible').createOpenAICompatible({ ...common, name: providerID, includeUsage: true, headers: providerID === 'openrouter' ? { 'X-Title': 'Cordoval Code' } : undefined })(modelID);
    }
  }

  async fetchModels(id) {
    const hit = this.cache.get(id);
    if (hit && Date.now() - hit.at < 10 * 60 * 1000) return hit.models;
    let models = {};
    try {
      const custom = this.customEntry(id);
      if (custom) {
        for (const m of custom.models || []) models[m] = { id: m, name: m };
        if (!Object.keys(models).length) {
          const host = new URL(custom.baseURL).host;
          const r = await makeFetch('bearer', host, () => custom.key)(custom.baseURL.replace(/\/+$/, '') + '/models', { signal: AbortSignal.timeout(8000) });
          if (r.ok) for (const m of ((await r.json()).data || [])) models[m.id] = { id: m.id, name: m.id };
        }
      } else {
        const def = PROVIDERS[id];
        const r = await makeFetch(def.kind, new URL(def.models).host, () => this.keys.providers[id])(def.models, { signal: AbortSignal.timeout(8000) });
        if (!r.ok) throw new Error('models ' + r.status);
        models = parseModels(id, await r.json());
      }
    } catch (e) {
      models = {};
    }
    if (!Object.keys(models).length) for (const m of FALLBACK_MODELS[id] || []) models[m] = { id: m, name: m };
    for (const m of Object.values(models)) m.capabilities = m.capabilities || { toolcall: true, input: { text: true, image: guessVision(id, m.id) } };
    this.cache.set(id, { at: Date.now(), models });
    return models;
  }

  price(providerID, modelID) {
    const c = this.cache.get(providerID);
    const m = c && c.models && c.models[modelID];
    if (m && m.cost) return m.cost;
    if (providerID === 'mock' && !this.mock) return undefined;
    return tablePrice(providerID, modelID);
  }
  cost(providerID, modelID, usage) { return costOf(this.price(providerID, modelID), usage); }
  async ensurePrices(providerID) { if (PROVIDERS[providerID] && !this.cache.has(providerID)) await this.fetchModels(providerID); }

  async list(config) {
    const out = [];
    if (this.mock) {
      const m = (id, name) => ({ id, name, capabilities: { toolcall: true, input: { text: true, image: true } } });
      out.push({ id: 'mock', name: 'Test provider', source: 'custom', models: { scripted: m('scripted', 'Scripted test model'), 'scripted-alt': m('scripted-alt', 'Scripted test model (alt)') } });
    }
    const ids = Object.keys(PROVIDERS).filter(id => id === 'openrouter' || this.keys.providers[id]);
    const lists = await Promise.all(ids.map(id => this.fetchModels(id)));
    ids.forEach((id, i) => out.push({ id, name: PROVIDERS[id].name, source: this.keys.providers[id] ? 'api' : 'none', key: undefined, models: lists[i] }));
    for (const c of this.keys.custom) out.push({ id: c.id, name: c.name || c.id, source: 'custom', models: await this.fetchModels(c.id) });
    let def = DEFAULT_MODEL;
    if (this.mock) def = { providerID: 'mock', modelID: 'scripted' };
    const cfg = config && typeof config.model === 'string' ? config.model.split('/') : null;
    if (cfg && cfg.length > 1) def = { providerID: cfg[0], modelID: cfg.slice(1).join('/') };
    return { providers: out, default: { ...def, [def.providerID]: def.modelID } };
  }
}

// OpenRouter gives USD per token as strings; "-1" or missing means the price is not known.
function orPrice(p) {
  if (!p) return undefined;
  const i = Number(p.prompt), o = Number(p.completion);
  if (!Number.isFinite(i) || !Number.isFinite(o) || i < 0 || o < 0) return undefined;
  const c = { input: i * 1e6, output: o * 1e6 };
  const cr = Number(p.input_cache_read);
  if (Number.isFinite(cr) && cr >= 0) c.cache_read = cr * 1e6;
  return c;
}

// USD per million tokens for direct providers (list prices; check the provider for changes).
// Matched by model ID prefix, longest first. Anything not here shows as "unknown".
const PRICES = {
  openai: { 'gpt-5.4-mini': [0.25, 2], 'gpt-5.4': [1.25, 10], 'gpt-5-mini': [0.25, 2], 'gpt-5-nano': [0.05, 0.4], 'gpt-5': [1.25, 10], 'gpt-4.1-mini': [0.4, 1.6], 'gpt-4.1-nano': [0.1, 0.4], 'gpt-4.1': [2, 8], 'gpt-4o-mini': [0.15, 0.6], 'gpt-4o': [2.5, 10], 'o4-mini': [1.1, 4.4], 'o3': [2, 8] },
  anthropic: { 'claude-opus-4': [15, 75], 'claude-sonnet-4': [3, 15], 'claude-haiku-4': [1, 5], 'claude-3-7-sonnet': [3, 15], 'claude-3-5-haiku': [0.8, 4] },
  google: { 'gemini-2.5-pro': [1.25, 10], 'gemini-2.5-flash-lite': [0.1, 0.4], 'gemini-2.5-flash': [0.3, 2.5], 'gemini-2.0-flash': [0.1, 0.4] },
  groq: { 'llama-3.3-70b-versatile': [0.59, 0.79], 'llama-3.1-8b-instant': [0.05, 0.08], 'openai/gpt-oss-120b': [0.15, 0.75], 'openai/gpt-oss-20b': [0.1, 0.5], 'moonshotai/kimi-k2': [1, 3], 'qwen/qwen3-32b': [0.29, 0.59] },
  xai: { 'grok-4-fast': [0.2, 0.5], 'grok-4': [3, 15], 'grok-3-mini': [0.3, 0.5], 'grok-3': [3, 15] },
  mock: { scripted: [1, 2] },
};
function tablePrice(providerID, modelID) {
  const t = PRICES[providerID];
  if (!t) return undefined;
  const key = Object.keys(t).sort((a, b) => b.length - a.length).find(k => modelID === k || (providerID !== 'mock' && (modelID.startsWith(k + '-') || modelID.startsWith(k + ':'))));
  return key ? { input: t[key][0], output: t[key][1] } : undefined;
}
// USD for one step's usage, or null when the price is not known.
function costOf(price, usage) {
  if (!price) return null;
  const u = usage || {};
  const cached = Math.min(u.cachedInputTokens || 0, u.inputTokens || 0);
  const fresh = (u.inputTokens || 0) - cached;
  const cacheRate = price.cache_read != null ? price.cache_read : price.input;
  return (fresh * price.input + cached * cacheRate + (u.outputTokens || 0) * price.output) / 1e6;
}

function parseModels(id, body) {
  const models = {};
  const data = body.data || body.models || [];
  for (const m of data) {
    if (id === 'openrouter') {
      const params = m.supported_parameters || [];
      if ((params.length && !params.includes('tools')) || /:batch$/.test(m.id)) continue;
      const mods = (m.architecture && m.architecture.input_modalities) || [];
      models[m.id] = { id: m.id, name: m.name || m.id, limit: { context: m.context_length }, cost: orPrice(m.pricing), capabilities: { toolcall: true, input: { text: true, image: mods.includes('image') } } };
    } else if (id === 'google') {
      if (!(m.supportedGenerationMethods || []).includes('generateContent')) continue;
      const mid = String(m.name || '').replace(/^models\//, '');
      if (!/^gemini/.test(mid)) continue;
      models[mid] = { id: mid, name: m.displayName || mid, limit: { context: m.inputTokenLimit } };
    } else if (id === 'openai') {
      if (!/^(gpt-|o\d|chatgpt)/.test(m.id) || /audio|realtime|image|tts|transcribe|search|embedding|instruct/.test(m.id)) continue;
      models[m.id] = { id: m.id, name: m.id };
    } else if (id === 'groq') {
      if (/whisper|tts|guard|playai/.test(m.id) || m.active === false) continue;
      models[m.id] = { id: m.id, name: m.id, limit: { context: m.context_window } };
    } else {
      models[m.id] = { id: m.id, name: m.display_name || m.name || m.id };
    }
  }
  return models;
}
function guessVision(provider, id) { return /gpt-4o|gpt-4\.1|gpt-5|claude|gemini|vision|vl|grok-4|llama-4/i.test(id) || provider === 'google' || provider === 'anthropic'; }

module.exports = { costOf, tablePrice, orPrice, Providers, PROVIDERS, DEFAULT_MODEL };
