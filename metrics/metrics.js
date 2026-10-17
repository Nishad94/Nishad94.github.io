import { INFERENCE_METRICS_ENDPOINT } from '../deployment.js';
import { publicMetrics } from '../assets/inference-metrics-contract.js';

const d3 = window.d3;
const select = id => document.getElementById(id);
const display = value => value === null ? 'Unavailable' : String(value);
const milliseconds = value => value === null ? 'Unavailable' : `${Math.round(value)} ms`;
const percent = value => value === null ? 'Unavailable' : `${value}%`;
let latest = null;
let pending = false;

function card(label, value, detail) {
  const node = document.createElement('div');
  node.className = 'card';
  for (const [className, text] of [['label', label], ['value', value], ['sub', detail]]) {
    const element = document.createElement('div');
    element.className = className;
    element.textContent = text;
    node.append(element);
  }
  return node;
}
function chart(id) {
  const node = select(id);
  const width = node.clientWidth || 600, height = node.clientHeight || 260;
  const svg = d3.select(node).attr('viewBox', `0 0 ${width} ${height}`);
  svg.selectAll('*').remove();
  return { svg, width, height };
}
function resources(snapshot) {
  const { svg, width, height } = chart('resourceChart');
  const rows = snapshot.history;
  select('resource-empty').textContent = rows.length ? '' : 'No resource samples collected yet.';
  if (!rows.length) return;
  const extent = d3.extent(rows, row => new Date(row.ts));
  if (+extent[0] === +extent[1]) extent[1] = new Date(+extent[0] + 15000);
  const x = d3.scaleTime().domain(extent).range([48, width - 16]);
  const y = d3.scaleLinear().domain([0, 100]).range([height - 30, 12]);
  svg.append('g').attr('class', 'axis').attr('transform', `translate(0,${height - 30})`).call(d3.axisBottom(x).ticks(4).tickFormat(d3.timeFormat('%H:%M')));
  svg.append('g').attr('class', 'axis').attr('transform', 'translate(48,0)').call(d3.axisLeft(y).ticks(5).tickFormat(value => `${value}%`));
  for (const [key, color] of [['cpu_pct', '#55a9ff'], ['memory_pct', '#b690ff'], ['disk_pct', '#f1c75b']]) {
    svg.append('path').datum(rows).attr('fill', 'none').attr('stroke', color).attr('stroke-width', 2)
      .attr('d', d3.line().defined(row => Number.isFinite(row[key])).x(row => x(new Date(row.ts))).y(row => y(row[key])));
    svg.selectAll(`circle.${key}`).data(rows.filter(row => Number.isFinite(row[key]))).join('circle')
      .attr('class', key).attr('cx', row => x(new Date(row.ts))).attr('cy', row => y(row[key])).attr('r', 2).attr('fill', color);
  }
}
function latency(snapshot) {
  const { svg, width, height } = chart('latencyChart');
  const values = snapshot.inference.latency;
  const rows = [['Generation', 'duration_ms'], ['Queue wait', 'queue_ms'], ['First token', 'first_token_ms']]
    .map(([label, key]) => ({ label, ...values[key] })).filter(row => row.p50 !== null);
  select('latency-empty').textContent = rows.length ? 'Blue: p50 · Purple: p95. First-token time includes queue wait.' : 'No measured generations yet.';
  if (!rows.length) return;
  const x = d3.scaleLinear().domain([0, d3.max(rows, row => row.p95) || 1]).nice().range([90, width - 20]);
  const y = d3.scaleBand().domain(rows.map(row => row.label)).range([16, height - 30]).padding(.3);
  svg.append('g').attr('class', 'axis').attr('transform', `translate(0,${height - 30})`).call(d3.axisBottom(x).ticks(4).tickFormat(value => `${Math.round(value / 1000)}s`));
  svg.append('g').attr('class', 'axis').attr('transform', 'translate(90,0)').call(d3.axisLeft(y));
  for (const [key, color, offset] of [['p50', '#55a9ff', 0], ['p95', '#b690ff', .5]]) {
    svg.selectAll(`rect.${key}`).data(rows).join('rect').attr('class', key).attr('x', 90)
      .attr('y', row => y(row.label) + y.bandwidth() * offset).attr('height', y.bandwidth() * .45)
      .attr('width', row => Math.max(1, x(row[key]) - 90)).attr('fill', color);
  }
}
function render(snapshot) {
  latest = snapshot;
  const host = snapshot.host, inference = snapshot.inference, counts = inference.counts;
  select('clock').textContent = `Updated ${new Date(snapshot.generated_at).toLocaleString()}`;
  select('cards').replaceChildren(
    card('Service availability', `${host.services_up}/${host.services_total}`, 'Gateway and model readiness, not historical uptime'),
    card('CPU', percent(host.cpu_pct), 'Laptop aggregate utilization'),
    card('Memory', percent(host.memory_pct), 'Laptop aggregate utilization'),
    card('GPU', percent(host.gpu_pct), 'No GPU utilization collector configured'),
    card('Disk', percent(host.disk_pct), 'Aggregate runtime-volume utilization'),
    card('Host uptime', host.uptime_days === null ? 'Unavailable' : `${host.uptime_days}d`, 'Windows system uptime')
  );
  select('resource-mix').replaceChildren(...[['CPU', host.cpu_pct], ['Memory', host.memory_pct], ['GPU', host.gpu_pct], ['Disk', host.disk_pct]].map(([label, value]) => {
    const element = document.createElement('div');
    element.className = 'resource';
    const text = document.createElement('label');
    text.textContent = `${label}: ${percent(value)}`;
    element.append(text);
    if (value !== null) {
      const meter = document.createElement('meter');
      meter.min = 0; meter.max = 100; meter.value = value;
      meter.setAttribute('aria-label', `${label} utilization`);
      element.append(meter);
    }
    return element;
  }));
  select('inference-cards').replaceChildren(
    card('Requests', display(counts.requests), 'Valid authenticated generation requests since gateway start'),
    card('Active / waiting', `${inference.queue.active} / ${inference.queue.waiting}`, `Queue capacity ${inference.queue.capacity} · maximum wait ${inference.queue.wait_limit_seconds}s`),
    card('Completed / truncated', `${counts.completed} / ${counts.truncated}`, 'Truncated answers reached the output limit'),
    card('Full queue rejections', display(counts.queue_full), 'HTTP 429 · no generation started'),
    card('Queue expirations', display(counts.queue_timeout), 'No generation started'),
    card('Failed / cancelled', `${counts.failed} / ${counts.cancelled}`, `${counts.rate_limited} daily quota rejections`)
  );
  select('inference-detail').textContent = `Gateway started ${new Date(snapshot.started_at).toLocaleString()}. Latency window: ${inference.samples} generations. Generation p95: ${milliseconds(inference.latency.duration_ms.p95)}.`;
  select('token-metrics').replaceChildren(
    card('Decode speed p50', inference.latency.tokens_per_second.p50 === null ? 'Unavailable' : `${inference.latency.tokens_per_second.p50} tokens/s`, 'Measured llama.cpp decode throughput, not estimated from characters'),
    card('Prompt / output tokens', `${display(inference.tokens.prompt)} / ${display(inference.tokens.output)}`, `${inference.tokens.measured_generations} measured generations in the recent window`)
  );
  select('services').replaceChildren(...Object.entries(snapshot.services).map(([label, service]) => {
    const element = card(label, service.up ? 'UP' : 'DOWN', `Local readiness probe: ${milliseconds(service.latency_ms)}`);
    element.classList.add(service.up ? 'up' : 'down');
    return element;
  }));
  resources(snapshot);
  latency(snapshot);
}
async function refresh() {
  if (pending || document.hidden) return;
  const status = select('status');
  if (!INFERENCE_METRICS_ENDPOINT) {
    status.dataset.state = 'unconfigured';
    status.textContent = 'Laptop metrics are not configured. No Mac endpoint is contacted.';
    return;
  }
  pending = true;
  try {
    const response = await fetch(INFERENCE_METRICS_ENDPOINT, {
      signal: AbortSignal.timeout(10000), credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store', redirect: 'error'
    });
    if (!response.ok) throw new Error('Metrics unavailable');
    const snapshot = publicMetrics(await response.json());
    if (Date.now() - Date.parse(snapshot.generated_at) > 90000 || Date.parse(snapshot.generated_at) - Date.now() > 30000) {
      throw new Error('Metrics stale');
    }
    render(snapshot);
    status.dataset.state = 'live';
    status.textContent = snapshot.services['Model API'].up ? 'Live laptop metrics · model ready · no Mac polling.' : 'Live laptop metrics · model unavailable · no Mac polling.';
  } catch {
    status.dataset.state = 'unavailable';
    status.textContent = latest ? 'Laptop metrics unavailable. Charts show the last received sample, not live values.' : 'Laptop metrics unavailable. No Mac snapshot or invented values are substituted.';
  } finally {
    pending = false;
  }
}
window.addEventListener('resize', () => { if (latest) { resources(latest); latency(latest); } });
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
setInterval(refresh, 30000);
refresh();
