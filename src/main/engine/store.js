'use strict';
// Sessions and messages, one JSON file per session under <userData>/engine/sessions.
const fs = require('fs');
const path = require('path');
const { writeJsonAtomic } = require('./util');

class Store {
  constructor(root) {
    this.root = path.join(root, 'sessions');
    this.sessions = new Map();
    this.timers = new Map();
    fs.mkdirSync(this.root, { recursive: true });
    for (const f of fs.readdirSync(this.root)) {
      if (!f.endsWith('.json')) continue;
      try {
        const rec = JSON.parse(fs.readFileSync(path.join(this.root, f), 'utf8'));
        if (rec && rec.info && rec.info.id) this.sessions.set(rec.info.id, { info: rec.info, messages: rec.messages || [], meta: rec.meta || {} });
      } catch (e) {}
    }
  }
  file(id) { return path.join(this.root, id + '.json'); }
  list(directory) {
    const dir = directory ? path.resolve(directory) : '';
    return [...this.sessions.values()].filter(s => !dir || path.resolve(s.info.directory) === dir).map(s => s.info)
      .sort((a, b) => b.time.updated - a.time.updated);
  }
  get(id) { return this.sessions.get(id) || null; }
  put(rec) { this.sessions.set(rec.info.id, rec); this.save(rec.info.id, true); }
  remove(id) { this.sessions.delete(id); clearTimeout(this.timers.get(id)); fs.rmSync(this.file(id), { force: true }); }
  save(id, now) {
    clearTimeout(this.timers.get(id));
    const run = () => {
      this.timers.delete(id);
      const rec = this.sessions.get(id);
      if (rec) writeJsonAtomic(this.file(id), rec);
    };
    if (now) run(); else this.timers.set(id, setTimeout(run, 250));
  }
  flush() { for (const id of [...this.timers.keys()]) this.save(id, true); }
}
module.exports = { Store };
