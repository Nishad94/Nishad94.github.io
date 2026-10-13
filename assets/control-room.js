function injectControlRoomStyles() {
  if (document.getElementById('control-room-styles')) return;
  const style = document.createElement('style');
  style.id = 'control-room-styles';
  style.textContent = `
    .control-room{position:relative;overflow:hidden;min-height:640px;padding:24px;border:1px solid #303657;border-radius:22px;background:radial-gradient(circle at 20% 15%,rgba(185,164,255,.1),transparent 28%),radial-gradient(circle at 78% 22%,rgba(159,255,210,.06),transparent 25%),linear-gradient(180deg,#0b0e1b,#080a13);box-shadow:0 30px 90px rgba(0,0,0,.42)}
    .control-room:before{content:"";position:absolute;inset:0;pointer-events:none;opacity:.16;background-image:linear-gradient(rgba(255,255,255,.04) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.035) 1px,transparent 1px);background-size:24px 24px;mask-image:linear-gradient(to bottom,#000,rgba(0,0,0,.45) 74%,transparent)}
    .cr-head{position:relative;z-index:2;display:flex;justify-content:space-between;gap:16px;align-items:flex-start;margin-bottom:18px}.cr-title{margin:3px 0 6px;font-size:clamp(24px,4vw,42px);letter-spacing:-.055em}.cr-sub{margin:0;color:#9da1bf;font-size:11px;line-height:1.6}.cr-live{display:flex;align-items:center;gap:7px;padding:7px 10px;border:1px solid #39405f;border-radius:999px;background:#101424;color:#9fffd2;font-size:9px;text-transform:uppercase;letter-spacing:.08em}.cr-live:before{content:"";width:7px;height:7px;border-radius:50%;background:#9fffd2;box-shadow:0 0 12px #9fffd2;animation:crPulse 1.8s ease-in-out infinite}
    .cr-grid{position:relative;z-index:2;display:grid;grid-template-columns:repeat(12,1fr);gap:12px}.cr-panel{position:relative;overflow:hidden;border:1px solid #2e3554;border-radius:16px;background:linear-gradient(180deg,rgba(19,23,42,.95),rgba(11,14,27,.98));box-shadow:0 16px 42px rgba(0,0,0,.25);padding:16px}.cr-panel h3{margin:0 0 12px;font-size:11px;color:#d7d3ed;text-transform:uppercase;letter-spacing:.08em}.cr-span-4{grid-column:span 4}.cr-span-6{grid-column:span 6}.cr-span-8{grid-column:span 8}.cr-row{display:flex;justify-content:space-between;gap:12px;padding:8px 0;border-bottom:1px dashed #2b314f;font-size:10px}.cr-row:last-child{border-bottom:0}.cr-row span:first-child{color:#8589a8}.cr-ok{color:#9fffd2}.cr-warn{color:#ffe9a6}.cr-pink{color:#ff9bd6}.cr-big{font-size:28px;font-weight:900;letter-spacing:-.05em;color:#fff}.cr-mini{font-size:9px;color:#7f839f;margin-top:5px}.cr-log{font-size:10px;line-height:1.7;color:#aeb3d0;white-space:pre-wrap}.cr-map{height:180px;position:relative;border:1px solid #29304c;border-radius:12px;background:radial-gradient(circle at 50% 45%,rgba(185,164,255,.11),transparent 34%),linear-gradient(180deg,#0d1120,#090b14);overflow:hidden}.cr-map:before{content:"";position:absolute;inset:0;background-image:linear-gradient(rgba(159,255,210,.07) 1px,transparent 1px),linear-gradient(90deg,rgba(185,164,255,.07) 1px,transparent 1px);background-size:22px 22px;transform:perspective(420px) rotateX(58deg) scale(1.3);transform-origin:center 80%}.cr-node{position:absolute;width:9px;height:9px;border-radius:50%;background:#9fffd2;box-shadow:0 0 14px #9fffd2}.cr-node.n2{left:66%;top:34%;background:#b9a4ff;box-shadow:0 0 14px #b9a4ff}.cr-node.n3{left:42%;top:68%;background:#ff9bd6;box-shadow:0 0 14px #ff9bd6}.cr-node.n4{left:81%;top:71%;background:#ffe9a6;box-shadow:0 0 14px #ffe9a6}.cr-node.n1{left:18%;top:53%}.cr-ghost{position:absolute;right:11%;bottom:8%;font-size:9px;color:#4e556f;opacity:.65}.cr-ghost:before{content:"▰";display:block;font-size:26px;line-height:1;color:#111522;text-shadow:0 0 15px rgba(0,0,0,.8);margin-bottom:3px}.cr-terminal{min-height:160px;border:1px solid #2b314d;border-radius:12px;background:#070912;padding:13px 14px;color:#a9ffd0;font-size:10px;line-height:1.7;white-space:pre-wrap;box-shadow:inset 0 0 28px rgba(0,0,0,.35)}
    @keyframes crPulse{0%,100%{opacity:.45}50%{opacity:1}}
    @media(max-width:900px){.cr-span-4,.cr-span-6,.cr-span-8{grid-column:span 12}.cr-head{flex-direction:column}.control-room{padding:16px;min-height:auto}}
    @media(prefers-reduced-motion:reduce){.cr-live:before{animation:none}}
  `;
  document.head.append(style);
}

function makePanel(title, cls='cr-span-4') {
  const panel = document.createElement('section');
  panel.className = `cr-panel ${cls}`;
  const h = document.createElement('h3');
  h.textContent = title;
  panel.append(h);
  return panel;
}

function renderThreadsHealth(panel, health) {
  const status = health?.status === 'ok' ? 'operational' : health?.status === 'down' ? 'degraded' : 'unknown';
  const statusClass = health?.status === 'ok' ? 'cr-ok' : health?.status === 'down' ? 'cr-pink' : 'cr-warn';
  const latency = Number.isFinite(health?.latency_ms) ? `${Math.round(health.latency_ms)} ms` : '—';
  const checked = health?.checked_at ? new Date(health.checked_at).toLocaleString() : 'awaiting first check';
  panel.innerHTML = `<h3>Threads publishing</h3><div class="cr-row"><span>pipeline</span><b class="${statusClass}">${status}</b></div><div class="cr-row"><span>API latency</span><b>${latency}</b></div><div class="cr-row"><span>last check</span><b>${checked}</b></div><div class="cr-mini">automated probe every three hours · no test post created</div>`;
}

function initializeControlRoom() {
  if (document.querySelector('[data-view="control"]')) return;
  injectControlRoomStyles();
  const tabs = document.querySelector('.tabs');
  const main = document.querySelector('main');
  if (!tabs || !main) return;

  const tab = document.createElement('a');
  tab.className = 'tab';
  tab.dataset.view = 'control';
  tab.href = '#control';
  tab.setAttribute('aria-label', 'Control');
  tab.innerHTML = '<i aria-hidden="true">🎛️</i><span>Control</span>';
  tabs.append(tab);

  const view = document.createElement('div');
  view.className = 'view';
  view.dataset.view = 'control';
  view.id = 'control';

  const room = document.createElement('section');
  room.className = 'control-room section';
  room.innerHTML = '<div class="cr-head"><div><div class="tiny">restricted operations deck</div><h2 class="cr-title">control room</h2><p class="cr-sub">The mansion’s systems look normal from here. Mostly.</p></div><div class="cr-live">systems nominal</div></div>';

  const grid = document.createElement('div');
  grid.className = 'cr-grid';

  const infra = makePanel('inference + infra');
  infra.innerHTML += '<div class="cr-row"><span>AI route</span><b class="cr-ok">Gemma uplink</b></div><div class="cr-row"><span>fallback</span><b>WebLLM</b></div><div class="cr-row"><span>gateway</span><b class="cr-ok">reachable</b></div><div class="cr-row"><span>prompt logging</span><b class="cr-ok">off</b></div>';

  const deploy = makePanel('site + deploy');
  deploy.innerHTML += '<div class="cr-row"><span>branch</span><b>master</b></div><div class="cr-row"><span>hosting</span><b>GitHub Pages</b></div><div class="cr-row"><span>build mode</span><b class="cr-ok">static</b></div><div class="cr-row"><span>last anomaly</span><b class="cr-pink">unknown_parent</b></div>';

  const ads = makePanel('ad uplink');
  ads.innerHTML += '<div class="cr-big">OFFLINE</div><div class="cr-mini">waiting for AdSense client + slot</div><div class="cr-row"><span>placement</span><b>Toffee cache</b></div><div class="cr-row"><span>policy mode</span><b class="cr-ok">stationary</b></div>';

  const threads = makePanel('Threads publishing');
  renderThreadsHealth(threads, null);
  fetch('/metrics/threads-status.json', { cache: 'no-store' })
    .then(response => {
      if (!response.ok) throw new Error('Threads health snapshot unavailable');
      return response.json();
    })
    .then(health => renderThreadsHealth(threads, health))
    .catch(() => renderThreadsHealth(threads, { status: 'unknown' }));

  const map = makePanel('mansion systems map','cr-span-8');
  map.innerHTML += '<div class="cr-map"><span class="cr-node n1"></span><span class="cr-node n2"></span><span class="cr-node n3"></span><span class="cr-node n4"></span><div class="cr-ghost">unindexed corridor</div></div>';

  const toffee = makePanel('Toffee SRE','cr-span-4');
  toffee.innerHTML += '<div class="cr-big">🐈</div><div class="cr-row"><span>patrol</span><b class="cr-ok">active</b></div><div class="cr-row"><span>incidents closed</span><b>0</b></div><div class="cr-row"><span>treat budget</span><b class="cr-warn">unbounded</b></div>';

  const terminal = makePanel('operator console','cr-span-6');
  const term = document.createElement('div');
  term.className = 'cr-terminal';
  term.textContent = '> status\nall public systems nominal\n\n> ps aux | grep ghost\n?        404   0.0   unknown_parent\n\n> echo $MANSION\ncontrol-room';
  terminal.append(term);

  const log = makePanel('anomaly log','cr-span-6');
  const logBody = document.createElement('div');
  logBody.className = 'cr-log';
  logBody.textContent = '[16:02] patrol resumed\n[16:04] sponsored relay warming up\n[16:07] corridor count mismatch: expected 7, observed 8\n[16:08] auto-corrected by unknown process\n[16:09] no action required';
  log.append(logBody);

  grid.append(infra, deploy, ads, threads, map, toffee, terminal, log);
  room.append(grid);
  view.append(room);
  main.append(view);
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initializeControlRoom, { once:true });
  else initializeControlRoom();
}
