import { ANALYTICS_ENDPOINT, PRIVATE_DASHBOARD_ORIGIN } from './deployment.js';

const CONSENT = 'nishad_metrics_consent';
const VISITOR = 'nishad_metrics_daily';
const MAX_AGE = 24 * 60 * 60 * 1000;

export function referrerDomain(raw) {
  try {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return '';
    const host = url.hostname.toLowerCase();
    if (host === 'nishad.ai' || host.endsWith('.nishad.ai') || host.length > 200 ||
        !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(host)) return '';
    return host;
  } catch {
    return '';
  }
}

export function visitorId(storage, crypto, now = Date.now()) {
  try {
    const existing = storage.getItem(VISITOR);
    if (existing) {
      let parsed;
      try { parsed = JSON.parse(existing); } catch { storage.removeItem(VISITOR); }
      if (parsed && /^[a-f0-9]{64}$/.test(parsed.id) && Number.isFinite(parsed.created) &&
          now >= parsed.created && now - parsed.created < MAX_AGE &&
          new Date(now).toISOString().slice(0, 10) === new Date(parsed.created).toISOString().slice(0, 10)) return parsed.id;
    }
    const id = [...crypto.getRandomValues(new Uint8Array(32))].map(n => n.toString(16).padStart(2, '0')).join('');
    storage.setItem(VISITOR, JSON.stringify({ id, created: now }));
    return id;
  } catch {
    return null; // Collection reports reduced unique coverage, never fingerprints instead.
  }
}

export function pageEvent(path, catalog, referrer, id) {
  if (!Object.hasOwn(catalog, path) || !/^\/(?:blog\/(?:[a-z0-9]+(?:-[a-z0-9]+)*\/)?|)$/.test(path)) return null;
  return { page: path, referrer: referrerDomain(referrer), ...(id ? { visitor: id } : {}) };
}

export async function initializeAnalytics() {
  const footer = document.createElement('section');
  footer.className = 'analytics-preferences';
  footer.setAttribute('aria-label', 'Privacy and private dashboard');
  const notice = document.createElement('a');
  notice.href = '/analytics-privacy.html'; notice.textContent = 'Analytics privacy';
  footer.append(notice);
  if (PRIVATE_DASHBOARD_ORIGIN) {
    const metrics = document.createElement('a');
    metrics.href = '/dashboard_metrics'; metrics.textContent = 'Website metrics';
    footer.append(metrics);
  }
  document.body.append(footer);
  if (!ANALYTICS_ENDPOINT || !['nishad.ai', 'www.nishad.ai'].includes(location.hostname)) return;
  const status = document.createElement('span');
  status.setAttribute('role', 'status');
  const enable = document.createElement('button'), disable = document.createElement('button');
  enable.type = disable.type = 'button';
  enable.textContent = 'Allow minimal analytics'; disable.textContent = 'Decline / withdraw';
  footer.append(status, enable, disable);
  let consent = false, sent = false, controller = null, storageUnavailable = false;
  const blocked = () => navigator.doNotTrack === '1' || navigator.globalPrivacyControl === true;
  try { consent = localStorage.getItem(CONSENT) === 'yes'; }
  catch { storageUnavailable = true; }
  function update() {
    status.textContent = blocked() ? 'Analytics disabled by browser privacy preference.' :
      consent ? 'Minimal analytics allowed.' : 'Analytics off until you allow it.';
    if (storageUnavailable && !blocked()) status.textContent += ' Browser storage is unavailable; preferences apply only to this page.';
    enable.disabled = blocked() || consent;
  }
  async function send() {
    if (!consent || sent || blocked()) return;
    controller = new AbortController();
    try {
      const res = await fetch('/analytics-pages.json', { credentials: 'omit', referrerPolicy: 'no-referrer', signal: controller.signal });
      if (!res.ok) throw new Error('catalog');
      const catalog = await res.json();
      if (!consent || blocked()) return;
      let storage;
      try { storage = window.localStorage; } catch { storage = null; }
      const id = visitorId(storage, window.crypto);
      const payload = pageEvent(location.pathname, catalog, document.referrer, id);
      if (!payload) return;
      sent = true;
      const response = await fetch(ANALYTICS_ENDPOINT, {
        method: 'POST', credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
        signal: controller.signal
      });
      if (!response.ok) throw new Error('collector');
      if (!id) status.textContent = 'Pageview counted without a browser ID; unique coverage is reduced.';
    } catch (error) {
      if (error.name !== 'AbortError') status.textContent = 'Analytics unavailable or blocked. The site still works.';
    }
  }
  enable.addEventListener('click', async () => {
    consent = true;
    try { localStorage.setItem(CONSENT, 'yes'); }
    catch { storageUnavailable = true; }
    update(); await send();
  });
  disable.addEventListener('click', () => {
    consent = false; controller?.abort();
    try { localStorage.setItem(CONSENT, 'no'); localStorage.removeItem(VISITOR); }
    catch { storageUnavailable = true; }
    update();
  });
  window.addEventListener('storage', event => {
    if (event.key === CONSENT && event.newValue !== 'yes') {
      consent = false; controller?.abort(); update();
    }
  });
  if (blocked()) {
    consent = false;
    try { localStorage.removeItem(VISITOR); } catch { /* No fallback identifier. */ }
  }
  update(); await send();
}

if (typeof document !== 'undefined') initializeAnalytics().catch(() => {
  console.warn('Analytics initialization unavailable.');
});
