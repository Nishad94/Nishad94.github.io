import { ADSENSE_CLIENT, ADSENSE_SLOT } from '../deployment.js';

const PROD_HOSTS = new Set(['nishad.ai', 'www.nishad.ai']);
const enabled = /^ca-pub-\d+$/.test(ADSENSE_CLIENT) && /^\d+$/.test(ADSENSE_SLOT);

function injectStyles() {
  if (document.getElementById('toffee-ad-styles')) return;
  const style = document.createElement('style');
  style.id = 'toffee-ad-styles';
  style.textContent = `
    .toffee-ad-shell{margin:22px 0 4px;padding:0;border:1px solid #35395d;border-radius:22px;background:linear-gradient(180deg,rgba(20,22,43,.98),rgba(10,12,24,.99));box-shadow:0 24px 74px rgba(0,0,0,.38),0 0 0 1px rgba(159,255,210,.025) inset;overflow:hidden;position:relative}
    .toffee-ad-shell:before{content:"";position:absolute;inset:0;pointer-events:none;background:radial-gradient(circle at 20% 35%,rgba(185,164,255,.13),transparent 28%),radial-gradient(circle at 78% 30%,rgba(255,155,214,.08),transparent 24%);mix-blend-mode:screen}
    .toffee-ad-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 14px;border-bottom:1px solid #303452;background:rgba(9,11,22,.86);font-size:10px;letter-spacing:.055em;text-transform:uppercase;color:#8f93b4;position:relative;z-index:5}
    .toffee-ad-head strong{color:var(--mint,#9fffd2);font-weight:800}
    .toffee-ad-status{display:inline-flex;align-items:center;gap:6px;white-space:nowrap}
    .toffee-ad-status:before{content:"";width:6px;height:6px;border-radius:50%;background:var(--yellow,#ffe9a6);box-shadow:0 0 9px rgba(255,233,166,.55)}
    .toffee-ad-scene{position:relative;min-height:210px;overflow:hidden;perspective:760px;background:linear-gradient(180deg,#11152a 0%,#0b0e1d 70%,#090b16 100%)}
    .toffee-ad-stars{position:absolute;inset:0 0 44% 0;opacity:.48;background-image:radial-gradient(circle,rgba(255,255,255,.65) 0 1px,transparent 1.2px);background-size:41px 37px;transform:translateZ(-100px) scale(1.15)}
    .toffee-ad-haze{position:absolute;left:-8%;right:-8%;bottom:40%;height:72px;background:linear-gradient(90deg,transparent,rgba(185,164,255,.08),rgba(159,255,210,.06),rgba(255,155,214,.07),transparent);filter:blur(14px);opacity:.8;animation:toffeeHaze 12s ease-in-out infinite alternate;pointer-events:none}
    .toffee-ad-skyline{position:absolute;left:0;right:0;bottom:37%;height:56px;opacity:.52;background:linear-gradient(90deg,transparent 0 4%,#1c2141 4% 9%,transparent 9% 12%,#161b36 12% 18%,transparent 18% 22%,#202646 22% 28%,transparent 28% 31%,#171c34 31% 38%,transparent 38% 43%,#1d2342 43% 52%,transparent 52% 57%,#151a33 57% 64%,transparent 64% 69%,#22294a 69% 76%,transparent 76% 82%,#181d38 82% 90%,transparent 90% 100%);filter:drop-shadow(0 0 14px rgba(137,116,255,.18));pointer-events:none}
    .toffee-ad-shadow-figure{position:absolute;left:12%;bottom:39%;width:12px;height:34px;border-radius:50% 50% 28% 28%;background:rgba(3,4,8,.82);box-shadow:0 0 11px rgba(0,0,0,.55);opacity:0;filter:blur(.8px);transform:translateY(2px) scale(.96);pointer-events:none;z-index:2}
    .toffee-ad-shadow-figure:before{content:"";position:absolute;left:2px;top:-9px;width:8px;height:10px;border-radius:50%;background:rgba(3,4,8,.9)}
    .toffee-ad-shadow-figure.show{animation:shadowBlink .72s ease-out both}
    .toffee-ad-grid{position:absolute;left:-10%;right:-10%;bottom:-34px;height:128px;transform-origin:50% 100%;transform:rotateX(64deg);background-image:linear-gradient(rgba(159,255,210,.16) 1px,transparent 1px),linear-gradient(90deg,rgba(185,164,255,.16) 1px,transparent 1px);background-size:26px 20px;mask-image:linear-gradient(to top,#000 30%,rgba(0,0,0,.65) 70%,transparent 100%);opacity:.64;pointer-events:none}
    .toffee-ad-lane{position:absolute;left:18px;right:18px;bottom:16px;height:40px;border-top:1px dashed rgba(159,255,210,.25);border-bottom:1px dashed rgba(185,164,255,.2);transform:skewX(-7deg);opacity:.9;pointer-events:none}
    .toffee-ad-mascot{position:absolute;left:22px;bottom:26px;z-index:4;display:flex;align-items:flex-end;gap:5px;pointer-events:none;user-select:none;filter:drop-shadow(0 10px 13px rgba(0,0,0,.42));animation:toffeePatrol 7.6s ease-in-out infinite alternate}
    .toffee-ad-cat{font-size:40px;line-height:1;transform:scaleX(1);transform-origin:center bottom}
    .toffee-ad-shadow{position:absolute;width:54px;height:11px;left:-5px;bottom:-5px;border-radius:50%;background:rgba(0,0,0,.42);filter:blur(3px);z-index:-1}
    .toffee-ad-badge{position:absolute;left:42px;bottom:30px;padding:3px 6px;border:1px solid rgba(159,255,210,.35);border-radius:7px;background:rgba(10,13,24,.86);color:#9fffd2;font-size:8px;letter-spacing:.06em;text-transform:uppercase;white-space:nowrap;box-shadow:0 0 18px rgba(159,255,210,.08)}
    .toffee-ad-kiosk{position:absolute;right:4.5%;top:50%;width:min(70%,720px);transform:translateY(-50%) rotateY(-5deg) rotateX(1deg);transform-style:preserve-3d;z-index:3}
    .toffee-ad-kiosk:before{content:"";position:absolute;inset:-9px -10px -10px -9px;border-radius:18px;border:1px solid rgba(185,164,255,.35);background:linear-gradient(145deg,rgba(185,164,255,.08),rgba(159,255,210,.035));transform:translateZ(-12px);box-shadow:0 0 34px rgba(137,116,255,.11)}
    .toffee-ad-stage{display:flex;align-items:center;justify-content:center;min-width:0;min-height:126px;padding:24px 18px 14px;position:relative;border:1px solid #3a3f66;border-radius:14px;background:linear-gradient(180deg,rgba(17,20,38,.96),rgba(10,13,25,.98));box-shadow:0 18px 44px rgba(0,0,0,.38),0 0 28px rgba(159,255,210,.05) inset;overflow:hidden}
    .toffee-ad-stage:after{content:"";position:absolute;inset:0;pointer-events:none;background:linear-gradient(110deg,transparent 0 35%,rgba(255,255,255,.025) 44%,transparent 52%)}
    .toffee-ad-label{position:absolute;top:7px;left:12px;color:#7f839f;font-size:9px;text-transform:uppercase;letter-spacing:.08em;pointer-events:none}
    .toffee-ad-kiosk-title{position:absolute;top:-22px;left:12px;color:#d8d4ef;font-size:9px;letter-spacing:.075em;text-transform:uppercase;text-shadow:0 0 12px rgba(185,164,255,.22);pointer-events:none}
    .toffee-ad-unit{display:block;width:100%;min-width:0;min-height:90px;text-align:center;position:relative;z-index:2}
    .toffee-ad-placeholder{width:100%;min-height:90px;border:1px dashed #454a72;border-radius:11px;display:flex;align-items:center;justify-content:center;gap:9px;padding:16px;color:#8589a8;font-size:10px;line-height:1.55;background:linear-gradient(180deg,#111528,#0d1020);position:relative;z-index:2}
    .toffee-ad-placeholder b{color:#d3cfee;font-weight:700}
    .toffee-ad-neon{position:absolute;width:5px;height:58%;right:-3px;top:21%;border-radius:999px;background:linear-gradient(180deg,var(--pink,#ff9bd6),var(--purple,#b9a4ff),var(--mint,#9fffd2));box-shadow:0 0 16px rgba(185,164,255,.46);opacity:.72}
    @keyframes toffeeHaze{from{transform:translateX(-2%) scaleX(.96)}to{transform:translateX(2%) scaleX(1.04)}}
    @keyframes toffeePatrol{0%{transform:translateX(0) translateY(0)}48%{transform:translateX(44px) translateY(-1px)}52%{transform:translateX(44px) translateY(-1px)}100%{transform:translateX(0) translateY(0)}}
    @keyframes shadowBlink{0%{opacity:0}18%{opacity:.58}48%{opacity:.18}70%{opacity:.5}100%{opacity:0;transform:translateY(-1px) scale(.985)}}
    @media(prefers-reduced-motion:reduce){.toffee-ad-haze,.toffee-ad-mascot,.toffee-ad-shadow-figure{animation:none!important;opacity:0!important}}
    @media(max-width:760px){.toffee-ad-scene{min-height:230px}.toffee-ad-kiosk{right:14px;left:82px;width:auto;transform:translateY(-50%) rotateY(-3deg)}.toffee-ad-mascot{left:14px}.toffee-ad-badge{display:none}.toffee-ad-cat{font-size:34px}.toffee-ad-stage{min-height:118px;padding:22px 10px 12px}}
    @media(max-width:520px){.toffee-ad-head{align-items:flex-start}.toffee-ad-head span:first-child{max-width:190px}.toffee-ad-scene{min-height:252px}.toffee-ad-kiosk{left:14px;right:14px;top:44%;width:auto;transform:translateY(-50%)}.toffee-ad-mascot{bottom:19px}.toffee-ad-lane{bottom:9px}.toffee-ad-kiosk-title{top:-20px}.toffee-ad-stage{min-height:126px}.toffee-ad-grid{height:104px}}
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

function scheduleShadowFigure(scene) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const figure = scene.querySelector('.toffee-ad-shadow-figure');
  if (!figure) return;
  const trigger = () => {
    if (document.hidden) return;
    figure.style.left = `${8 + Math.random() * 20}%`;
    figure.classList.remove('show');
    void figure.offsetWidth;
    figure.classList.add('show');
  };
  if (Math.random() < 0.28) setTimeout(trigger, 900 + Math.random() * 2200);
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

  const scene = document.createElement('div');
  scene.className = 'toffee-ad-scene';
  scene.innerHTML = '<div class="toffee-ad-stars" aria-hidden="true"></div><div class="toffee-ad-haze" aria-hidden="true"></div><div class="toffee-ad-skyline" aria-hidden="true"></div><div class="toffee-ad-shadow-figure" aria-hidden="true"></div><div class="toffee-ad-grid" aria-hidden="true"></div><div class="toffee-ad-lane" aria-hidden="true"></div>';

  const mascot = document.createElement('div');
  mascot.className = 'toffee-ad-mascot';
  mascot.setAttribute('aria-hidden', 'true');
  mascot.innerHTML = '<span class="toffee-ad-shadow"></span><span class="toffee-ad-cat">🐈</span><span class="toffee-ad-badge">SRE patrol</span>';

  const kiosk = document.createElement('div');
  kiosk.className = 'toffee-ad-kiosk';
  const kioskTitle = document.createElement('span');
  kioskTitle.className = 'toffee-ad-kiosk-title';
  kioskTitle.textContent = 'sponsored relay // node 01';

  const stage = document.createElement('div');
  stage.className = 'toffee-ad-stage';
  const label = document.createElement('span');
  label.className = 'toffee-ad-label';
  label.textContent = 'Advertisement';
  const neon = document.createElement('span');
  neon.className = 'toffee-ad-neon';
  neon.setAttribute('aria-hidden', 'true');
  stage.append(label, neon);

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

  kiosk.append(kioskTitle, stage);
  scene.append(mascot, kiosk);
  shell.append(head, scene);
  queueMicrotask(() => scheduleShadowFigure(scene));
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
