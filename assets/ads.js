import { ADSENSE_CLIENT, ADSENSE_SLOT } from '../deployment.js';

const PROD_HOSTS = new Set(['nishad.ai', 'www.nishad.ai']);
const enabled = /^ca-pub-\d+$/.test(ADSENSE_CLIENT) && /^\d+$/.test(ADSENSE_SLOT);

function injectStyles() {
  if (document.getElementById('toffee-ad-styles')) return;
  const style = document.createElement('style');
  style.id = 'toffee-ad-styles';
  style.textContent = `
    .toffee-ad-shell{margin:18px 0 2px;padding:0;border:1px solid #303350;border-radius:18px;background:linear-gradient(180deg,rgba(23,25,45,.97),rgba(15,17,32,.97));box-shadow:0 18px 58px rgba(0,0,0,.28);overflow:hidden}
    .toffee-ad-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 14px;border-bottom:1px solid #2d304b;background:rgba(12,14,27,.78);font-size:10px;letter-spacing:.055em;text-transform:uppercase;color:#8f93b4}
    .toffee-ad-head strong{color:var(--mint,#9fffd2);font-weight:800}
    .toffee-ad-status{display:inline-flex;align-items:center;gap:6px;white-space:nowrap}
    .toffee-ad-status:before{content:"";width:6px;height:6px;border-radius:50%;background:var(--yellow,#ffe9a6);box-shadow:0 0 9px rgba(255,233,166,.55)}
    .toffee-ad-body{display:grid;grid-template-columns:minmax(116px,150px) minmax(0,1fr);align-items:stretch;min-height:124px}
    .toffee-ad-mascot{position:relative;display:flex;align-items:center;justify-content:center;border-right:1px dashed #343754;background:radial-gradient(circle at 50% 42%,rgba(185,164,255,.1),transparent 62%);pointer-events:none;user-select:none}
    .toffee-ad-cat{font-size:42px;filter:drop-shadow(0 8px 12px rgba(0,0,0,.3));transform:translateY(2px)}
    .toffee-ad-zzz{position:absolute;top:25px;right:26px;color:#8f93b4;font-size:10px;letter-spacing:2px;transform:rotate(-8deg)}
    .toffee-ad-stage{display:flex;align-items:center;justify-content:center;min-width:0;padding:12px 16px;position:relative}
    .toffee-ad-label{position:absolute;top:7px;left:12px;color:#777c9c;font-size:9px;text-transform:uppercase;letter-spacing:.08em;pointer-events:none}
    .toffee-ad-unit{display:block;width:100%;min-width:0;min-height:90px;text-align:center}
    .toffee-ad-placeholder{width:100%;min-height:90px;border:1px dashed #3a3d5a;border-radius:12px;display:flex;align-items:center;justify-content:center;gap:8px;padding:16px;color:#8589a8;font-size:10px;line-height:1.55;background:#111425}
    .toffee-ad-placeholder b{color:#c9c5e5;font-weight:700}
    @media(max-width:560px){.toffee-ad-body{grid-template-columns:78px minmax(0,1fr);min-height:112px}.toffee-ad-cat{font-size:32px}.toffee-ad-zzz{display:none}.toffee-ad-stage{padding:12px 10px}.toffee-ad-head{align-items:flex-start}.toffee-ad-head span:first-child{max-width:180px}}
  `;
  document.head.append(style);
}

function loadAdSenseScript() {
  if (!enabled || !PROD_HOSTS.has(location.hostname) || document.querySelector('script[data-nishad-adsense]')) return;
  const script = document.createElement('script');
  script.async = true;
  script.crossOrigin = 'anonymous';
  script.dataset.nishadAdsense = 'true';
  script.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(ADSENSE_CLIENT)}`;
  document.head.append(script);
}

function makeShell() {
  const shell = document.createElement('section');
  shell.className = 'toffee-ad-shell';
  shell.setAttribute('aria-label', 'Advertisement');

  const head = document.createElement('div');
  head.className = 'toffee-ad-head';
  const title = document.createElement('span');
  title.innerHTML = `<strong>Toffee's sponsored cache</strong> · external ad node`;
  const status = document.createElement('span');
  status.className = 'toffee-ad-status';
  status.textContent = enabled ? 'uplink ready' : 'warming up';
  head.append(title, status);

  const body = document.createElement('div');
  body.className = 'toffee-ad-body';
  const mascot = document.createElement('div');
  mascot.className = 'toffee-ad-mascot';
  mascot.setAttribute('aria-hidden', 'true');
  mascot.innerHTML = '<span class="toffee-ad-cat">🐈</span><span class="toffee-ad-zzz">zzz</span>';

  const stage = document.createElement('div');
  stage.className = 'toffee-ad-stage';
  const label = document.createElement('span');
  label.className = 'toffee-ad-label';
  label.textContent = 'Advertisement';
  stage.append(label);

  if (enabled) {
    const unit = document.createElement('ins');
    unit.className = 'adsbygoogle toffee-ad-unit';
    unit.style.display = 'block';
    unit.dataset.adClient = ADSENSE_CLIENT;
    unit.dataset.adSlot = ADSENSE_SLOT;
    unit.dataset.adFormat = 'auto';
    unit.dataset.fullWidthResponsive = 'true';
    stage.append(unit);
    queueMicrotask(() => {
      try { (window.adsbygoogle = window.adsbygoogle || []).push({}); }
      catch { /* Ad blockers or unavailable inventory should not break the site. */ }
    });
  } else {
    const placeholder = document.createElement('div');
    placeholder.className = 'toffee-ad-placeholder';
    placeholder.innerHTML = '<span>🐾</span><span><b>Sponsored cache warming up.</b><br>AdSense client + slot not configured yet.</span>';
    stage.append(placeholder);
  }

  body.append(mascot, stage);
  shell.append(head, body);
  return shell;
}

export function initializeAds() {
  if (location.pathname !== '/' || document.querySelector('.toffee-ad-shell')) return;
  const controls = document.getElementById('controls');
  if (!controls) return;
  injectStyles();
  loadAdSenseScript();
  controls.insertAdjacentElement('afterend', makeShell());
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initializeAds, { once: true });
  else initializeAds();
}
