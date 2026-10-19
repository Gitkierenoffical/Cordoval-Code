'use strict';

(function () {
  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, function (ch) {
      return {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      }[ch];
    });
  }

  function lineClass(line) {
    if (!line) return 'meta';
    const ch = line.charAt(0);
    if (ch === '+') return 'add';
    if (ch === '-') return 'del';
    if (ch === '@') return 'hunk';
    if (line.indexOf('diff ') === 0 || line.indexOf('index ') === 0) return 'meta';
    if (line.indexOf('--- ') === 0 || line.indexOf('+++ ') === 0) return 'meta';
    return '';
  }

  function buildPatch(entry) {
    const file = String(entry.file || 'file');
    const hasBefore = entry.before != null;
    const hasAfter = entry.after != null;
    if (hasBefore || hasAfter) {
      const before = hasBefore ? String(entry.before) : '';
      const after = hasAfter ? String(entry.after) : '';
      if (typeof Diff !== 'undefined' && typeof Diff.createTwoFilesPatch === 'function') {
        return Diff.createTwoFilesPatch(file, file, before, after, '', '', { context: 3 });
      }
    }
    if (entry.patch) return String(entry.patch);
    return '';
  }

  function renderInto(container, files) {
    if (!container) return;
    container.innerHTML = '';
    container.classList.add('diff-view');
    const list = Array.isArray(files) ? files.filter(Boolean) : [];
    if (!list.length) {
      const empty = document.createElement('div');
      empty.className = 'diff-empty';
      empty.textContent = 'No changes yet.';
      container.appendChild(empty);
      return;
    }
    for (const entry of list) {
      const wrap = document.createElement('div');
      wrap.className = 'diff-file';
      const header = document.createElement('div');
      header.className = 'diff-file-header';
      const path = document.createElement('span');
      path.className = 'change-path';
      path.textContent = String(entry.file || 'file');
      const stat = document.createElement('span');
      stat.className = 'change-stat';
      const additions = Number(entry.additions || 0);
      const deletions = Number(entry.deletions || 0);
      stat.innerHTML =
        '<span class="add">+' + additions + '</span> <span class="del">-' + deletions + '</span>';
      header.appendChild(path);
      header.appendChild(stat);
      wrap.appendChild(header);

      const body = document.createElement('div');
      body.className = 'diff-body';
      const patch = buildPatch(entry);
      if (!patch) {
        const note = document.createElement('div');
        note.className = 'diff-empty';
        note.textContent = 'No textual diff available for this file.';
        body.appendChild(note);
      } else {
        const lines = String(patch).split('\n');
        if (lines.length && lines[lines.length - 1] === '') lines.pop();
        for (const line of lines) {
          const row = document.createElement('span');
          const cls = lineClass(line);
          row.className = 'diff-line' + (cls ? ' ' + cls : '');
          row.textContent = line;
          body.appendChild(row);
        }
      }
      wrap.appendChild(body);
      container.appendChild(wrap);
    }
  }

  window.DiffView = {
    render: renderInto,
    escapeHtml: escapeHtml,
  };
})();
