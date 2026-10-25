'use strict';
// Platform layer. The macOS app injects window.__DAILY8_NATIVE__ (saved values and Keychain secrets) and a "daily8"
// message handler; browsers fall back to localStorage and downloads.

const nativeBridge = window.webkit?.messageHandlers?.daily8 && window.__DAILY8_NATIVE__
  ? { post: m => window.webkit.messageHandlers.daily8.postMessage(m), store: window.__DAILY8_NATIVE__.store || {}, secrets: window.__DAILY8_NATIVE__.secrets || {} }
  : null;

const appStore = {
  native: !!nativeBridge,
  get(key) {
    if (nativeBridge) return Object.prototype.hasOwnProperty.call(nativeBridge.store, key) ? nativeBridge.store[key] : null;
    return localStorage.getItem(key);
  },
  set(key, value) {
    value = String(value);
    if (nativeBridge) { nativeBridge.store[key] = value; nativeBridge.post({ type: 'set', key, value }); return; }
    localStorage.setItem(key, value);
  },
  remove(key) {
    if (nativeBridge) { delete nativeBridge.store[key]; nativeBridge.post({ type: 'remove', key }); return; }
    localStorage.removeItem(key);
  },
  keys() { return nativeBridge ? Object.keys(nativeBridge.store) : Object.keys(localStorage); },
};

/** Secrets (the API key): macOS Keychain in the app; this browser's localStorage on the web. */
const appSecrets = {
  get(key) {
    if (nativeBridge) return nativeBridge.secrets[key] || '';
    try { return localStorage.getItem('daily8.secret.' + key) || ''; } catch { return ''; }
  },
  set(key, value) {
    if (nativeBridge) {
      if (value) nativeBridge.secrets[key] = value; else delete nativeBridge.secrets[key];
      nativeBridge.post({ type: 'secret', key, value: value || '' });
      return;
    }
    if (value) localStorage.setItem('daily8.secret.' + key, value); else localStorage.removeItem('daily8.secret.' + key);
  },
};

const bytesToBase64 = bytes => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); };
const base64ToBytes = b64 => Uint8Array.from(atob(b64), c => c.charCodeAt(0));

/** Saves text or bytes as a file: a save dialog in the app, a download in browsers. */
function saveFile(name, data, type = 'application/octet-stream') {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  if (nativeBridge) { nativeBridge.post({ type: 'save', name, base64: bytesToBase64(bytes) }); return; }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([bytes], { type }));
  a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function uiConfirm(message, { ok = '继续', danger = false } = {}) {
  return new Promise(resolve => {
    const previous = document.activeElement, overlay = document.createElement('div');
    overlay.className = 'dialog-backdrop';
    overlay.innerHTML = '<div class="dialog" role="alertdialog" aria-modal="true" aria-labelledby="dialog-text"><p id="dialog-text"></p><div class="dialog-actions"><button type="button" data-dialog="cancel"></button><button type="button" data-dialog="ok"></button></div></div>';
    overlay.querySelector('p').textContent = t(message);
    overlay.querySelector('[data-dialog=cancel]').textContent = t('取消');
    const okButton = overlay.querySelector('[data-dialog=ok]');
    okButton.textContent = t(ok);
    okButton.className = danger ? 'danger' : 'primary';
    const buttons = [...overlay.querySelectorAll('button')];
    const key = e => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(false); }
      else if (e.key === 'Tab') { e.preventDefault(); buttons[(buttons.indexOf(document.activeElement) + 1) % buttons.length].focus(); }
      else if (!/Enter| /.test(e.key)) e.stopPropagation();
    };
    const done = value => { overlay.remove(); document.removeEventListener('keydown', key, true); previous?.focus?.(); resolve(value); };
    overlay.addEventListener('click', e => { const b = e.target.closest('[data-dialog]'); if (b) done(b.dataset.dialog === 'ok'); else if (e.target === overlay) done(false); });
    document.addEventListener('keydown', key, true);
    document.body.append(overlay);
    okButton.focus();
  });
}
