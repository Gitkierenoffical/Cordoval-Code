// Theme families: Cordoval (default, lavender) plus OpenCode's built-in desktop themes.
// The light/dark mode stays on html[data-theme]; a family overrides the colour variables.
(function () {
  'use strict';
  const KEY = 'cordoval.themeFamily';
  const DATA = window.CORDOVAL_THEME_DATA || {};
  const VARS = ['--bg', '--panel', '--panel-2', '--border', '--border-strong', '--text', '--muted', '--faint', '--accent', '--accent-soft', '--accent-text', '--danger', '--danger-soft', '--ok', '--ok-soft', '--warn', '--warn-soft', '--add-bg', '--add-text', '--del-bg', '--del-text', '--hunk-bg', '--hunk-text', '--scrollbar'];

  function hex(c) {
    c = String(c || '').replace('#', '');
    if (c.length === 3) c = c.split('').map((x) => x + x).join('');
    const n = parseInt(c.slice(0, 6), 16);
    return isNaN(n) ? [128, 128, 128] : [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function mix(a, b, t) {
    const x = hex(a), y = hex(b);
    return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('');
  }
  function lum(c) { const [r, g, b] = hex(c); return (0.299 * r + 0.587 * g + 0.114 * b) / 255; }

  function varsFor(p, dark) {
    const bg = p.neutral, ink = p.ink;
    const accent = p.primary || p.accent;
    return {
      '--bg': bg,
      '--panel': mix(bg, dark ? '#ffffff' : '#ffffff', dark ? 0.04 : 0.6),
      '--panel-2': mix(bg, ink, 0.04),
      '--border': mix(bg, ink, dark ? 0.16 : 0.12),
      '--border-strong': mix(bg, ink, dark ? 0.26 : 0.2),
      '--text': ink,
      '--muted': mix(ink, bg, 0.3),
      '--faint': mix(ink, bg, 0.5),
      '--accent': accent,
      '--accent-soft': mix(bg, accent, dark ? 0.2 : 0.14),
      '--accent-text': lum(accent) > 0.6 ? '#111111' : '#ffffff',
      '--danger': p.error,
      '--danger-soft': mix(bg, p.error, 0.15),
      '--ok': p.success,
      '--ok-soft': mix(bg, p.success, 0.15),
      '--warn': p.warning,
      '--warn-soft': mix(bg, p.warning, 0.15),
      '--add-bg': mix(bg, p.diffAdd || p.success, 0.18),
      '--add-text': mix(p.diffAdd || p.success, ink, 0.25),
      '--del-bg': mix(bg, p.diffDelete || p.error, 0.18),
      '--del-text': mix(p.diffDelete || p.error, ink, 0.25),
      '--hunk-bg': mix(bg, p.info || accent, 0.15),
      '--hunk-text': mix(p.info || accent, ink, 0.3),
      '--scrollbar': mix(bg, ink, 0.25),
    };
  }

  function current() { try { return localStorage.getItem(KEY) || 'cordoval'; } catch (e) { return 'cordoval'; } }

  function apply(id) {
    const root = document.documentElement;
    for (const v of VARS) root.style.removeProperty(v);
    const t = DATA[id];
    root.setAttribute('data-family', t ? id : 'cordoval');
    if (!t) return;
    const dark = root.getAttribute('data-theme') === 'dark';
    const vars = varsFor(dark ? t.dark : t.light, dark);
    for (const k of Object.keys(vars)) if (vars[k]) root.style.setProperty(k, vars[k]);
  }

  function set(id) {
    try { localStorage.setItem(KEY, id); } catch (e) {}
    apply(id);
    if (window.CodeEditor && window.CodeEditor.refreshTheme) window.CodeEditor.refreshTheme();
  }

  function list() {
    return [{ id: 'cordoval', name: 'Cordoval (default)' }].concat(Object.keys(DATA).map((id) => ({ id, name: DATA[id].name })).sort((a, b) => a.name.localeCompare(b.name)));
  }

  function swatch(id) {
    const t = DATA[id];
    const p = t ? (document.documentElement.getAttribute('data-theme') === 'dark' ? t.dark : t.light) : null;
    const wrap = document.createElement('span');
    wrap.className = 'theme-swatch';
    for (const c of p ? [p.neutral, p.primary, p.accent, p.success] : ['#F4F2FB', '#0A5CFF', '#8B7FD6', '#1F7A4D']) {
      const s = document.createElement('i'); s.style.background = c; wrap.appendChild(s);
    }
    return wrap;
  }

  function buildPicker(host) {
    host.textContent = '';
    const label = document.createElement('div');
    label.className = 'settings-label';
    label.textContent = 'Colour theme';
    host.appendChild(label);
    const grid = document.createElement('div');
    grid.className = 'theme-grid';
    grid.id = 'theme-grid';
    for (const t of list()) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'theme-option' + (t.id === current() ? ' is-active' : '');
      b.dataset.theme = t.id;
      b.appendChild(swatch(t.id));
      const n = document.createElement('span'); n.textContent = t.name; b.appendChild(n);
      b.addEventListener('click', () => { set(t.id); buildPicker(host); });
      grid.appendChild(b);
    }
    host.appendChild(grid);
  }

  function mountPicker() {
    const radio = document.querySelector('input[name="theme"]');
    if (!radio) return;
    let host = document.getElementById('theme-family-picker');
    if (!host) {
      host = document.createElement('div');
      host.id = 'theme-family-picker';
      const group = radio.closest('.settings-row, .radio-group, fieldset, div');
      (group && group.parentNode ? group.parentNode : document.body).insertBefore(host, group ? group.nextSibling : null);
    }
    buildPicker(host);
  }

  new MutationObserver(() => apply(current())).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  apply(current());
  document.addEventListener('DOMContentLoaded', mountPicker);
  window.Themes = { list, set, current, apply, mountPicker };
})();
