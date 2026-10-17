import { INFERENCE_METRICS_ENDPOINT } from '../deployment.js';
import { publicMetrics } from '../assets/inference-metrics-contract.js';

const d3 = window.d3;
const select = id => document.getElementById(id);
const display = value => value === null ? 'Unavailable' : String(value);
const milliseconds = value => value === null ? 'Unavailable' : `${Math.round(value)} ms`;
const percent = value => value === null ? 'Unavailable' : `${value}%`;
const rate = (numerator, denominator) => denominator ? `${(100 * numerator / denominator).toFixed(1)}%` : 'Unavailable';
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
  const rows = snapshot.history.filter(row => ['cpu_pct', 'memory_pct', 'gpu_pct', 'disk_pct'].some(key => Number.isFinite(row[key])));
  select('resource-empty').textContent = rows.length ? '' : 'No resource samples collected yet.';
  if (!rows.length) return;
  const extent = d3.extent(rows, row => new Date(row.ts));
  if (+extent[0] === +extent[1]) extent[1] = new Date(+extent[0] + 15000);
  const x = d3.scaleTime().domain(extent).range([48, width - 16]);
  const y = d3.scaleLinear().domain([0, 100]).range([height - 30, 12]);
  svg.append('g').attr('class', 'axis').attr('transform', `translate(0,${height - 30})`).call(d3.axisBottom(x).ticks(4).tickFormat(d3.timeFormat('%H:%M')));
  svg.append('g').attr('class', 'axis').attr('transform', 'translate(48,0)').call(d3.axisLeft(y).ticks(5).tickFormat(value => `${value}%`));
  for (const [key, color] of [['cpu_pct', '#55a9ff'], ['memory_pct', '#b690ff'], ['gpu_pct', '#4ee38c'], ['disk_pct', '#f1c75b']]) {
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
  const settled = counts.completed + counts.truncated + counts.failed + counts.cancelled;
  const averageOutput = inference.tokens.measured_generations && inference.tokens.output !== null
    ? Math.round(inference.tokens.output / inference.tokens.measured_generations) : null;
  select('clock').textContent = `Updated ${new Date(snapshot.generated_at).toLocaleString()}`;
  select('cards').replaceChildren(
    card('Service availability', `${host.services_up}/${host.services_total}`, 'Gateway and model readiness, not historical uptime'),
    card('CPU', percent(host.cpu_pct), 'Host aggregate utilization'),
    card('Memory', percent(host.memory_pct), 'Host aggregate utilization'),
    card('GPU', percent(host.gpu_pct), 'Apple GPU device utilization when available'),
    card('Disk', percent(host.disk_pct), 'Aggregate runtime-volume utilization'),
    card('Host uptime', host.uptime_days === null ? 'Unavailable' : `${host.uptime_days}d`, 'Host uptime when the platform collector supports it')
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
    card('Completion rate', rate(counts.completed, settled), `${counts.completed} completed of ${settled} settled generations`),
    card('Failure rate', rate(counts.failed, settled), 'Explicit model or upstream failures; excludes queue rejection'),
    card('Active / waiting', `${inference.queue.active} / ${inference.queue.waiting}`, `Queue capacity ${inference.queue.capacity} · maximum wait ${inference.queue.wait_limit_seconds}s`),
    card('Rejected before generation', `${counts.queue_full + counts.queue_timeout + counts.rate_limited}`, `${counts.queue_full} queue full · ${counts.queue_timeout} queue timeout · ${counts.rate_limited} quota`),
    card('Truncated / cancelled', `${counts.truncated} / ${counts.cancelled}`, 'Truncated responses reached the output limit')
  );
  select('inference-detail').textContent = `Gateway started ${new Date(snapshot.started_at).toLocaleString()}. Rolling window: ${inference.samples} generations. End-to-end p50/p95: ${milliseconds(inference.latency.duration_ms.p50)} / ${milliseconds(inference.latency.duration_ms.p95)}. First-token p50/p95: ${milliseconds(inference.latency.first_token_ms.p50)} / ${milliseconds(inference.latency.first_token_ms.p95)}.`;
  select('token-metrics').replaceChildren(
    card('Decode speed p50 / p95', inference.latency.tokens_per_second.p50 === null ? 'Unavailable' : `${inference.latency.tokens_per_second.p50} / ${inference.latency.tokens_per_second.p95} tok/s`, 'Measured model decode throughput'),
    card('Prompt / output tokens', `${display(inference.tokens.prompt)} / ${display(inference.tokens.output)}`, `${inference.tokens.measured_generations} measured generations in the rolling window`),
    card('Average output', averageOutput === null ? 'Unavailable' : `${averageOutput} tokens`, 'Average across generations with measured token usage')
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
    status.textContent = 'Inference metrics are not configured.';
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
    status.textContent = snapshot.services['Model API'].up ? 'Live inference metrics · model ready.' : 'Live inference metrics · model unavailable.';
  } catch {
    status.dataset.state = 'unavailable';
    status.textContent = latest ? 'Inference metrics unavailable. Charts show the last received sample, not live values.' : 'Inference metrics unavailable. No stale snapshot or invented values are substituted.';
  } finally {
    pending = false;
  }
}
window.addEventListener('resize', () => { if (latest) { resources(latest); latency(latest); } });
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
setInterval(refresh, 30000);
refresh();
