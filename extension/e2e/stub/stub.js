/* global window, document, chrome, location */
// A fake Sieve home base for the extension e2e tests (50 section 14.2). It speaks the page end of the protocol
// (01 section 6) and records every ExtensionToPage message. The extension id comes from ?ext=.
(() => {
  const PORT_NAME = 'sieve-home-base';
  const VERSION = 1;
  const ext = new URLSearchParams(location.search).get('ext') ?? '';
  const state = { status: 'idle', received: [], port: null };

  function setStatus(s) {
    state.status = s;
    const el = document.getElementById('status');
    if (el) el.textContent = s;
  }

  function hasRuntime() {
    return typeof chrome !== 'undefined' && !!chrome.runtime && typeof chrome.runtime.connect === 'function';
  }

  function raw(message) {
    if (!state.port) return false;
    try {
      state.port.postMessage(message);
      return true;
    } catch {
      return false;
    }
  }

  function connect(opts = {}) {
    const homeBase = opts.homeBase ?? true;
    const appVersion = opts.appVersion ?? '0.1.0-stub';
    if (!hasRuntime()) {
      setStatus('unsupported');
      return state.status;
    }
    let port;
    try {
      port = chrome.runtime.connect(ext, { name: opts.name ?? PORT_NAME });
    } catch {
      setStatus('not-installed');
      return state.status;
    }
    state.port = port;
    setStatus('connecting');
    port.onMessage.addListener((m) => {
      state.received.push(m);
      if (m && m.type === 'sieve/hello-ack') setStatus('connected');
    });
    port.onDisconnect.addListener(() => {
      void chrome.runtime.lastError;
      if (state.port === port) state.port = null;
      setStatus('disconnected');
    });
    if (opts.hello !== false) raw({ type: 'sieve/hello', version: VERSION, homeBase, appVersion });
    return state.status;
  }

  window.__stub = {
    connect,
    raw,
    hasRuntime,
    pending: (proposals) => raw({ type: 'sieve/pending', version: VERSION, proposals }),
    resolved: (requestId, outcome) => raw({ type: 'sieve/resolved', version: VERSION, requestId, outcome }),
    disconnect() {
      if (state.port) state.port.disconnect();
      state.port = null;
      setStatus('disconnected');
    },
    get received() {
      return state.received;
    },
    get status() {
      return state.status;
    },
  };
})();
