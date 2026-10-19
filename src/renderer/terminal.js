'use strict';

(function () {
  let term = null;
  let fitAddon = null;
  let socket = null;
  let ptyId = null;
  let hostEl = null;
  let directory = '';
  let engineBase = '';
  let opened = false;
  let opening = false;
  let resizeTimer = null;
  let disposedFor = null;

  function themeOptions() {
    const dark = document.documentElement.getAttribute('data-theme') === 'dark';
    return {
      theme: dark
        ? {
            background: '#0F1020',
            foreground: '#E8E8F5',
            cursor: '#3D82FF',
            selectionBackground: '#2A2C4E',
          }
        : {
            background: '#F4F2FB',
            foreground: '#1B1830',
            cursor: '#0A5CFF',
            selectionBackground: '#E3DEF5',
          },
    };
  }

  function writeStatus(message) {
    if (!term) return;
    term.writeln('\r\n\x1b[90m' + message + '\x1b[0m\r\n');
  }

  function teardownSocket() {
    if (socket) {
      try {
        socket.onmessage = null;
        socket.onerror = null;
        socket.onclose = null;
        socket.close();
      } catch (err) {
        // ignore
      }
      socket = null;
    }
  }

  async function destroyPty() {
    const id = ptyId;
    ptyId = null;
    teardownSocket();
    if (id && window.Api) {
      try {
        await window.Api.deletePty(id);
      } catch (err) {
        // pty may already be gone
      }
    }
  }

  async function ensureTerminal() {
    if (!hostEl) hostEl = document.getElementById('terminal-host');
    if (!term) {
      const options = Object.assign(
        {
          cursorBlink: true,
          convertEol: false,
          fontSize: 13,
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
          scrollback: 5000,
          allowProposedApi: true,
        },
        themeOptions()
      );
      term = new Terminal(options);
      fitAddon = new FitAddon.FitAddon();
      term.loadAddon(fitAddon);
      term.open(hostEl);
      term.onData(function (data) {
        if (socket && socket.readyState === WebSocket.OPEN) {
          socket.send(data);
        }
      });
    }
    return term;
  }

  function fit() {
    if (!term || !fitAddon || !opened) return;
    try {
      fitAddon.fit();
    } catch (err) {
      // host may be hidden mid-layout
    }
  }

  function scheduleResize() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      if (!term || !opened || !ptyId || !window.Api) return;
      fit();
      const size = { rows: term.rows, cols: term.cols };
      window.Api.resizePty(ptyId, size).catch(function () {
        // best effort
      });
    }, 120);
  }

  async function connectSocket(id) {
    teardownSocket();
    if (!window.Api) return;
    const url = await window.Api.ptySocketUrl(id);
    let ws;
    try {
      ws = new WebSocket(url);
    } catch (err) {
      writeStatus('Could not open terminal socket: ' + (err && err.message ? err.message : 'error'));
      return;
    }
    ws.binaryType = 'arraybuffer';
    socket = ws;
    ws.onopen = function () {
      if (term && ptyId === id) {
        fit();
        window.Api.resizePty(id, { rows: term.rows, cols: term.cols }).catch(function () {});
      }
    };
    ws.onmessage = function (event) {
      if (!term) return;
      const data = event.data;
      if (typeof data === 'string') {
        term.write(data);
      } else if (data instanceof ArrayBuffer) {
        term.write(new Uint8Array(data));
      } else if (data instanceof Blob) {
        data.arrayBuffer().then(function (buf) {
          if (term) term.write(new Uint8Array(buf));
        });
      }
    };
    ws.onerror = function () {
      if (term && socket === ws) {
        writeStatus('Terminal socket error.');
      }
    };
    ws.onclose = function () {
      if (socket === ws) {
        socket = null;
        if (term && opened) writeStatus('Terminal disconnected.');
      }
    };
  }

  async function connect() {
    if (!window.Api || !directory) return;
    if (!window.Api.engineUrl()) return;
    await destroyPty();
    await ensureTerminal();
    try {
      const info = await window.Api.createPty({ cwd: directory });
      ptyId = info && info.id ? info.id : null;
      if (!ptyId) {
        writeStatus('Engine did not return a pty id.');
        return;
      }
      await connectSocket(ptyId);
    } catch (err) {
      writeStatus('Could not start terminal: ' + (err && err.message ? err.message : 'error'));
    }
  }

  async function open(opts) {
    const options = opts || {};
    opened = true;
    disposedFor = null;
    if (options.directory !== undefined) directory = String(options.directory || '');
    if (options.engineUrl !== undefined) engineBase = String(options.engineUrl || '');
    const dock = document.getElementById('terminal-dock');
    if (dock) dock.hidden = false;
    await ensureTerminal();
    requestAnimationFrame(function () {
      fit();
    });
    if (options.reconnect || !socket || !ptyId) {
      opening = true;
      try {
        await connect();
      } finally {
        opening = false;
      }
    }
  }

  async function close() {
    opened = false;
    const dock = document.getElementById('terminal-dock');
    if (dock) dock.hidden = true;
    await destroyPty();
  }

  function setDirectory(dir) {
    const next = String(dir || '');
    if (next === directory && opened && socket) return;
    directory = next;
    if (opened) {
      disposedFor = directory;
      connect().catch(function () {});
    }
  }

  function applyTheme() {
    if (!term) return;
    const opts = themeOptions();
    if (typeof term.options === 'object' && term.options) {
      try {
        term.options.theme = opts.theme;
      } catch (err) {
        // older xterm builds
      }
    }
    fit();
  }

  function isOpen() {
    return opened;
  }

  function isBusy() {
    return opening;
  }

  window.TerminalPanel = {
    open: open,
    close: close,
    fit: fit,
    scheduleResize: scheduleResize,
    setDirectory: setDirectory,
    applyTheme: applyTheme,
    isOpen: isOpen,
    isBusy: isBusy,
  };

  window.addEventListener('resize', function () {
    scheduleResize();
  });
})();
