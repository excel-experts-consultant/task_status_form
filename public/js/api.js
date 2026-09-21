/* Shared API client for both the admin console and the employee app.
   Inside the Android build the page is served from the APK itself, so calls
   must go to the deployed Pages URL — set it once here. */

window.FIELDOPS_API = 'https://fieldops-bi0.pages.dev'; // <- change to your Pages domain

const BASE = (window.Capacitor || location.protocol === 'file:') ? window.FIELDOPS_API : '';

const store = {
  get token() { return localStorage.getItem('fo_token'); },
  set token(v) { v ? localStorage.setItem('fo_token', v) : localStorage.removeItem('fo_token'); },
  get user() { try { return JSON.parse(localStorage.getItem('fo_user')); } catch { return null; } },
  set user(v) { v ? localStorage.setItem('fo_user', JSON.stringify(v)) : localStorage.removeItem('fo_user'); },
  clear() { this.token = null; this.user = null; },
};

async function api(path, options = {}) {
  const res = await fetch(BASE + '/api' + path, {
    method: options.method || (options.body ? 'POST' : 'GET'),
    headers: {
      'content-type': 'application/json',
      ...(store.token ? { authorization: 'Bearer ' + store.token } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  let data;
  try { data = await res.json(); } catch { data = { ok: false, error: 'Server did not respond properly' }; }
  if (res.status === 401) {
    store.clear();
    if (!location.pathname.endsWith('index.html') && location.pathname !== '/') location.href = './index.html';
  }
  if (!res.ok || data.ok === false) throw new Error(data.error || 'Request failed');
  return data;
}

function requireRole(role) {
  const user = store.user;
  if (!store.token || !user || user.role !== role) { location.href = './index.html'; return null; }
  return user;
}

function signOut() { store.clear(); location.href = './index.html'; }

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
