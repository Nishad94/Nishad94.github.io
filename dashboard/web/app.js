const $ = id => document.getElementById(id);
let csrf = '', revision = 0;
let pending = new Set();
const messages = {
  sign_in_required: 'Session expired. Sign in again.',
  metrics_not_configured: 'Metrics storage is not configured.',
  metrics_unavailable: 'Metrics are unavailable. No results were substituted.'
};
function clearPrivate() {
  revision++;
  for (const c of pending) c.abort();
  pending.clear();
  $('report').replaceChildren();
  $('metrics').hidden = true;
  csrf = '';
}
async function api(url, body) {
  const controller = new AbortController();
  pending.add(controller);
  try {
    const response = await fetch(url, {
      method: body ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store',
      referrerPolicy: 'no-referrer', signal: controller.signal,
      headers: body ? { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf } : {},
      body: body ? JSON.stringify(body) : undefined
    });
    const data = await response.json();
    if (!response.ok) {
      if (response.status === 401) clearPrivate();
      throw new Error(messages[data.error] || 'Request failed. Retry or sign in again.');
    }
    return data;
  } finally {
    pending.delete(controller);
  }
}
async function action(work) {
  $('status').textContent = 'Loading...';
  try {
    await work();
    $('status').textContent = 'Ready · owner-only aggregate insights';
  } catch (error) {
    if (error.name !== 'AbortError') $('status').textContent = error.message || 'Request failed.';
  }
}
function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}
const number = value => new Intl.NumberFormat('en').format(value);
const percent = (part, total) => total > 0 ? `${(100 * part / total).toFixed(1)}%` : '—';
function svgNode(tag, attributes = {}, text) {
  const element = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
  if (text !== undefined) element.textContent = text;
  return element;
}
function panel(title, description, badge) {
  const section = node('section', 'panel');
  const heading = node('div', 'panel-heading'), titles = node('div');
  titles.append(node('h2', '', title), node('p', 'panel-description', description));
  heading.append(titles);
  if (badge) heading.append(node('span', 'pill', badge));
  section.append(heading);
  return section;
}
function table(parent, headings, rows) {
  const table = document.createElement('table');
  const tr = document.createElement('tr');
  for (const name of headings) { const th = node('th', '', name); th.scope = 'col'; tr.append(th); }
  table.append(tr);
  for (const row of rows) {
    const tr = document.createElement('tr');
    for (const value of row) { const td = document.createElement('td'); td.textContent = String(value); tr.append(td); }
    table.append(tr);
  }
  const scroll = node('div', 'data-scroll'); scroll.append(table); parent.append(scroll);
}
function stat(label, value, note, color, icon) {
  const card = node('div', `stat-card ${color}`), top = node('div', 'stat-top');
  top.append(node('span', '', label), node('span', 'stat-icon', icon));
  card.append(top, node('strong', 'stat-value', value), node('span', 'stat-note', note));
  return card;
}
function traffic(report) {
  const section = panel('Traffic over time', 'Daily pageviews and estimated unique browsers · UTC');
  section.classList.add('traffic-panel');
  const legend = node('div', 'legend');
  legend.append(node('span', 'legend-item', 'Pageviews'), node('span', 'legend-item purple', 'Daily uniques'));
  section.querySelector('.panel-heading').append(legend);
  if (!report.daily.length) section.append(node('p', 'chart-empty', 'No traffic yet. Your first consented visits will appear here.'));
  else {
    const chart = svgNode('svg', { viewBox: '0 0 1000 230', class: 'traffic-chart', role: 'img', 'aria-label': 'Daily pageviews and unique browsers. Exact values are in the data table below.' });
    const defs = svgNode('defs'), gradient = svgNode('linearGradient', { id: 'traffic-fill', x1: 0, y1: 0, x2: 0, y2: 1 });
    gradient.append(svgNode('stop', { offset: '0%', 'stop-color': '#6de5b5', 'stop-opacity': .22 }), svgNode('stop', { offset: '100%', 'stop-color': '#6de5b5', 'stop-opacity': 0 }));
    defs.append(gradient); chart.append(defs);
    const maximum = Math.max(1, ...report.daily.flatMap(d => [d.views, d.uniques]));
    const ceiling = Math.max(4, Math.ceil(maximum / 4) * 4);
    const x = i => report.daily.length === 1 ? 515 : 50 + i / (report.daily.length - 1) * 925;
    const y = value => 192 - value / ceiling * 165;
    for (let i = 0; i <= 4; i++) {
      const value = ceiling * i / 4;
      chart.append(svgNode('line', { x1: 50, y1: y(value), x2: 975, y2: y(value), class: 'chart-grid' }),
        svgNode('text', { x: 38, y: y(value) + 4, 'text-anchor': 'end', class: 'chart-label' }, number(value)));
    }
    const views = report.daily.map((d, i) => `${x(i)},${y(d.views)}`);
    chart.append(svgNode('path', { d: `M${x(0)},192 L${views.join(' L')} L${x(report.daily.length - 1)},192 Z`, class: 'chart-area' }));
    for (const [field, className] of [['views', ''], ['uniques', 'unique']]) {
      chart.append(svgNode('polyline', { points: report.daily.map((d, i) => `${x(i)},${y(d[field])}`).join(' '), class: `chart-line ${className}` }));
      report.daily.forEach((d, i) => {
        const point = svgNode('circle', { cx: x(i), cy: y(d[field]), r: report.daily.length > 15 ? 3.5 : 5, class: `chart-dot ${className}` });
        point.append(svgNode('title', {}, `${d.day}: ${number(d[field])} ${field === 'views' ? 'pageviews' : 'unique browsers'}`));
        chart.append(point);
      });
    }
    const step = Math.max(1, Math.ceil(report.daily.length / 7));
    report.daily.forEach((d, i) => {
      if (i % step === 0 || i === report.daily.length - 1) chart.append(svgNode('text', { x: x(i), y: 220, 'text-anchor': 'middle', class: 'chart-label' }, d.day.slice(5)));
    });
    section.append(chart);
  }
  const details = node('details'); details.append(node('summary', '', 'View accessible daily data'));
  table(details, ['Date (UTC)', 'Pageviews', 'Unique browsers'], report.daily.map(r => [r.day, number(r.views), number(r.uniques)]));
  section.append(details);
  return section;
}
function ranking(parent, rows, total, label = row => row.label, country = false) {
  if (!rows.length) { parent.append(node('p', 'empty-state', 'No reportable data in this range.')); return; }
  for (const row of [...rows].sort((a, b) => b.views - a.views)) {
    const line = node('div', 'rank-row'), name = node('div', 'rank-label');
    if (country) name.append(node('span', 'row-icon', /^[A-Z]{2}$/.test(row.label) ? row.label : '—'));
    name.append(document.createTextNode(label(row)));
    const count = node('div', 'rank-count', number(row.views));
    count.append(node('span', 'rank-share', percent(row.views, total)));
    const meter = node('progress', 'rank-meter');
    meter.max = Math.max(total, 1); meter.value = row.views;
    meter.setAttribute('aria-label', `${label(row)}: ${number(row.views)} views, ${percent(row.views, total)}`);
    line.append(name, count, meter); parent.append(line);
  }
}
let geography;
async function worldMap(section, report, current) {
  const detail = node('p', 'location-focus', 'Hover or focus a highlighted country to explore.');
  section.append(detail);
  try {
    geography ??= await api('/world.json');
    if (current !== revision) return;
    const map = svgNode('svg', { viewBox: '0 0 720 310', class: 'world-map', role: 'group', 'aria-label': 'World map of reported country pageviews. Countries without reportable data are gray.' });
    for (const lat of [-30, 0, 30, 60]) map.append(svgNode('line', { x1: 0, y1: (90 - lat) * 2, x2: 720, y2: (90 - lat) * 2, class: 'map-grid' }));
    const counts = new Map(report.countries.map(row => [row.label, row.views]));
    const max = Math.max(1, ...report.countries.filter(row => row.label !== 'Unknown').map(row => row.views));
    const names = new Map();
    for (const country of geography) {
      names.set(country.code, country.name);
      const count = counts.get(country.code) || 0;
      const shape = svgNode('path', { d: country.path, class: count ? 'country has-views' : 'country', 'fill-rule': 'evenodd' });
      const description = count ? `${country.name} · ${number(count)} views · ${percent(count, report.views)} of all views` : `${country.name}: no reportable data`;
      shape.append(svgNode('title', {}, description));
      if (count) {
        const intensity = Math.sqrt(count / max);
        shape.setAttribute('data-level', String(Math.max(1, Math.ceil(intensity * 5))));
        shape.setAttribute('tabindex', '0'); shape.setAttribute('role', 'img'); shape.setAttribute('aria-label', description);
        shape.addEventListener('mouseenter', () => { detail.textContent = description; });
        shape.addEventListener('focus', () => { detail.textContent = description; });
        shape.addEventListener('mouseleave', () => { detail.textContent = 'Hover or focus a highlighted country to explore.'; });
        shape.addEventListener('blur', () => { detail.textContent = 'Hover or focus a highlighted country to explore.'; });
      }
      map.append(shape);
    }
    section.insertBefore(map, detail);
    const key = node('div', 'map-key');
    key.append(node('span', '', 'Fewer views'), node('span', 'map-scale'), node('span', '', 'More views'), node('span', 'map-credit', 'Natural Earth · public-domain map'));
    section.append(key);
    const unmapped = report.countries.filter(row => row.label !== 'Unknown' && !names.has(row.label)).reduce((sum, row) => sum + row.views, 0);
    if (unmapped) section.append(node('p', 'location-footnote', `${number(unmapped)} reported views belong to countries/territories not drawn at this map scale. They remain in the country list.`));
  } catch (error) {
    if (current !== revision) return;
    detail.textContent = 'Map unavailable. Country statistics remain available in the list.';
    detail.classList.add('error-note');
  }
}
function countryName(code) {
  if (code === 'Unknown') return 'Unknown location';
  try { return new Intl.DisplayNames(['en'], { type: 'region' }).of(code) || code; } catch { return code; }
}
function performancePanel(performance) {
  const section = panel('Response time', 'Dashboard API · server-side processing, not browser page-load speed', 'OPERATIONAL');
  section.classList.add('performance-panel');
  if (!performance) { section.append(node('p', 'error-note', 'Performance statistics unavailable. No latency values have been substituted.')); return section; }
  const description = performance.synthetic ? 'Synthetic demo measurements' : `Rolling ${performance.windowMinutes}-minute window · up to ${number(performance.capacity)} recent requests · resets on restart`;
  section.append(node('p', 'panel-description', description));
  const grid = node('div', 'latency-grid');
  const ms = value => performance.samples ? `${number(Math.round(value * 10) / 10)} ms` : '—';
  for (const [label, value, explanation, color] of [
    ['Average', ms(performance.avgMs), 'Mean response duration', 'mint'],
    ['p95', ms(performance.p95Ms), '95% of requests at or below', 'blue'],
    ['p99', ms(performance.p99Ms), '99% of requests at or below', 'purple'],
    ['Error rate', performance.samples ? percent(performance.errors, performance.samples) : '—', `${number(performance.errors)} failed / ${number(performance.samples)} sampled`, 'yellow']
  ]) {
    const cell = node('div', `latency-cell ${color}`);
    cell.append(node('span', 'stat-note', label), node('strong', 'latency-value', value), node('span', 'stat-note', explanation)); grid.append(cell);
  }
  section.append(grid);
  if (performance.samples < 100) section.append(node('p', 'location-footnote', 'Small sample: tail percentiles may be unstable. No data is shown as a dash, not zero latency.'));
  return section;
}
async function metrics() {
  const current = ++revision;
  const days = Number($('days').value);
  $('report').replaceChildren();
  const [report, performance] = await Promise.all([
    api('/api/metrics', { days }),
    api('/api/performance').catch(() => null)
  ]);
  if (current !== revision) return;
  const summary = node('div', 'summary-grid');
  const reportedCountries = report.countries.filter(row => row.label !== 'Unknown').length;
  summary.append(
    stat('Pageviews', number(report.views), `${days === 1 ? 'Today' : `Last ${days} days`} · consented visits`, 'mint', '↗'),
    stat('Daily unique browsers', number(report.uniques), days === 1 ? 'Estimated browsers, not people' : 'Sum of daily unique estimates', 'purple', '◎'),
    stat('Reported countries', number(reportedCountries), 'Only countries with reportable counts', 'blue', '◉'),
    stat('Identified view coverage', percent(report.views - report.unidentified, report.views), `${number(report.unidentified)} views without browser IDs`, 'yellow', '◌')
  );
  $('report').append(summary, traffic(report), performancePanel(performance));
  const geographyGrid = node('div', 'geography-grid');
  const map = panel('Around the world', 'Country-level view distribution · approximate geography', 'GLOBAL REACH');
  const countries = panel('Top locations', 'Shares of all pageviews · reportable countries only');
  const totals = node('div', 'country-summary');
  for (const [value, text] of [[percent(report.views - report.unknownCountry, report.views), 'Country lookup coverage'], [number(report.unknownCountry), 'Unknown location views']]) {
    const group = node('div'); group.append(node('strong', '', value), node('span', '', text)); totals.append(group);
  }
  countries.append(totals);
  ranking(countries, report.countries, report.views, row => countryName(row.label), true);
  countries.append(node('p', 'location-footnote', 'Low-count rows are suppressed. Gray on the map means no reportable data, not necessarily zero visits. Unknown views are not placed on the map.'));
  geographyGrid.append(map, countries); $('report').append(geographyGrid);
  const breakdown = node('div', 'breakdown-grid');
  const pages = panel('Pages people read', 'Top pages and popular blog posts', `${report.pages.length} PAGES`);
  ranking(pages, report.pages, report.views, row => row.label === '/' ? 'Home /' : row.label);
  const referrers = panel('Where they found you', 'Referrer domains · low-count rows suppressed');
  ranking(referrers, report.referrers, report.views);
  breakdown.append(pages, referrers); $('report').append(breakdown);
  await worldMap(map, report, current);
}
$('refresh').addEventListener('click', () => action(metrics));
$('days').addEventListener('change', () => action(metrics));
$('logout').addEventListener('click', () => action(async () => {
  await api('/auth/logout', {}); clearPrivate(); location.replace('/auth/login');
}));
window.addEventListener('pagehide', clearPrivate);
window.addEventListener('pageshow', event => { if (event.persisted) location.reload(); });
await action(async () => {
  csrf = (await api('/api/session')).csrf;
  $('metrics').hidden = false;
  await metrics();
});
setInterval(async () => {
  if (!csrf) return;
  try { await api('/api/session'); } catch { clearPrivate(); $('status').textContent = 'Session unavailable. Sign in again.'; }
}, 60000);
