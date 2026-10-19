'use strict';

(function () {
  let baseUrl = '';
  let directory = '';
  let eventSource = null;
  const listeners = {
    message: [],
    error: [],
  };

  function engineUrl() {
    return String(baseUrl || '').replace(/\/+$/, '');
  }

  function setBase(url) {
    baseUrl = String(url || '');
  }

  function setDirectory(dir) {
    directory = String(dir || '');
  }

  function getDirectory() {
    return directory;
  }

  function withQuery(path, extra) {
    const url = new URL(engineUrl() + path);
    if (directory) url.searchParams.set('directory', directory);
    if (extra) {
      for (const key of Object.keys(extra)) {
        const value = extra[key];
        if (value !== undefined && value !== null && value !== '') {
          url.searchParams.set(key, String(value));
        }
      }
    }
    return url.toString();
  }

  async function request(path, options) {
    const opts = options || {};
    const init = {
      method: opts.method || 'GET',
      headers: {},
    };
    if (opts.body !== undefined) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    if (opts.signal) init.signal = opts.signal;
    const res = await fetch(withQuery(path, opts.query), init);
    if (!res.ok) {
      let detail = '';
      try {
        const text = await res.text();
        detail = text ? String(text).slice(0, 300) : '';
      } catch (err) {
        detail = '';
      }
      throw new Error('Engine request failed (' + res.status + ')' + (detail ? ': ' + detail : ''));
    }
    if (res.status === 204) return null;
    const type = res.headers.get('content-type') || '';
    if (type.includes('application/json')) return res.json();
    return res.text();
  }

  const Api = {
    setBase,
    setDirectory,
    getDirectory,
    engineUrl,
    request,

    listSessions() {
      return request('/session');
    },

    createSession() {
      return request('/session', { method: 'POST', body: {} });
    },

    deleteSession(id) {
      return request('/session/' + encodeURIComponent(id), { method: 'DELETE' });
    },

    renameSession(id, title) {
      return request('/session/' + encodeURIComponent(id), {
        method: 'PATCH',
        body: { title },
      });
    },

    getMessages(id) {
      return request('/session/' + encodeURIComponent(id) + '/message');
    },

    promptAsync(id, payload) {
      return request('/session/' + encodeURIComponent(id) + '/prompt_async', {
        method: 'POST',
        body: payload,
      });
    },

    abort(id) {
      return request('/session/' + encodeURIComponent(id) + '/abort', { method: 'POST' });
    },

    revert(id, messageID) {
      return request('/session/' + encodeURIComponent(id) + '/revert', {
        method: 'POST',
        body: { messageID },
      });
    },

    unrevert(id) {
      return request('/session/' + encodeURIComponent(id) + '/unrevert', { method: 'POST' });
    },

    replyPermission(requestID, reply) {
      return request('/permission/' + encodeURIComponent(requestID) + '/reply', {
        method: 'POST',
        body: { reply },
      });
    },

    providers() {
      return request('/config/providers');
    },

    listFiles(path) {
      return request('/file', { query: { path: path || '.' } });
    },

    fileContent(path) {
      return request('/file/content', { query: { path } });
    },

    fileStatus() {
      return request('/file/status');
    },

    find(pattern) {
      return request('/find', { query: { pattern } });
    },

    findFiles(query) {
      return request('/find/file', { query: { query } });
    },

    lsp() {
      return request('/lsp');
    },

    createPty(payload) {
      return request('/pty', { method: 'POST', body: payload || {} });
    },

    resizePty(id, size) {
      return request('/pty/' + encodeURIComponent(id), {
        method: 'PUT',
        body: { size },
      });
    },

    deletePty(id) {
      return request('/pty/' + encodeURIComponent(id), { method: 'DELETE' });
    },

    async ptySocketUrl(id) {
      const base = engineUrl();
      let ticket = null;
      try {
        const t = await request('/pty/' + encodeURIComponent(id) + '/connect-token', { method: 'POST' });
        ticket = t && t.ticket;
      } catch (err) {}
      const url = new URL(base.replace(/^http/, 'ws') + '/pty/' + encodeURIComponent(id) + '/connect');
      if (directory) url.searchParams.set('directory', directory);
      if (ticket) url.searchParams.set('ticket', ticket);
      return url.toString();
    },

    on(type, fn) {
      if (!listeners[type]) listeners[type] = [];
      listeners[type].push(fn);
      return function off() {
        const list = listeners[type];
        const index = list.indexOf(fn);
        if (index >= 0) list.splice(index, 1);
      };
    },

    emit(type, payload) {
      const list = listeners[type] || [];
      for (const fn of list.slice()) {
        try {
          fn(payload);
        } catch (err) {
          // listener errors must not break the stream
        }
      }
    },

    connectEvents() {
      Api.disconnectEvents();
      if (!engineUrl()) return null;
      let source;
      try {
        source = new EventSource(withQuery('/event'));
      } catch (err) {
        Api.emit('error', err);
        return null;
      }
      eventSource = source;
      source.onmessage = function (event) {
        let data;
        try {
          data = JSON.parse(event.data);
        } catch (err) {
          return;
        }
        if (!data || typeof data !== 'object') return;
        Api.emit('message', data);
      };
      source.onerror = function () {
        if (eventSource === source && source.readyState === EventSource.CLOSED) {
          eventSource = null;
          Api.emit('error', new Error('Event stream closed.'));
        }
      };
      return source;
    },

    disconnectEvents() {
      if (eventSource) {
        try {
          eventSource.close();
        } catch (err) {
          // ignore
        }
        eventSource = null;
      }
    },
  };

  window.Api = Api;
})();
