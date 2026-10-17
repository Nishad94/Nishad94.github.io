const COUNTS = ['requests', 'queued', 'queue_full', 'queue_timeout', 'cancelled', 'rate_limited', 'completed', 'truncated', 'failed'];
const LATENCIES = ['duration_ms', 'queue_ms', 'first_token_ms', 'tokens_per_second'];
function number(value, nullable = false, max = Number.MAX_SAFE_INTEGER) {
  if (value === null && nullable) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > max) throw new Error('Invalid metrics number');
  return value;
}
function date(value, nullable = false) {
  if (value === null && nullable) return null;
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT[\d:.+-]+Z?$/.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new Error('Invalid metrics timestamp');
  }
  return new Date(value).toISOString();
}
function resource(row) {
  return Object.fromEntries(['cpu_pct', 'memory_pct', 'gpu_pct', 'disk_pct'].map(key => [key, number(row[key], true, 100)]));
}

// Reconstruct the public object field by field. Never proxy arbitrary gateway JSON.
export function publicMetrics(input) {
  if (input?.schema !== 'nishad.laptop-operations.v1' || !Array.isArray(input.history) || input.history.length > 288) {
    throw new Error('Invalid metrics schema');
  }
  const inference = input.inference;
  const queue = inference.queue;
  const services = Object.fromEntries(['Python gateway', 'Model API'].map(name => {
    const service = input.services[name];
    if (typeof service.up !== 'boolean') throw new Error('Invalid service state');
    return [name, { up: service.up, latency_ms: number(service.latency_ms, true) }];
  }));
  return {
    schema: input.schema, generated_at: date(input.generated_at), started_at: date(input.started_at),
    sampled_at: date(input.sampled_at, true),
    host: {
      ...resource(input.host), uptime_days: number(input.host.uptime_days, true),
      services_up: number(input.host.services_up, false, 2),
      services_total: number(input.host.services_total, false, 2),
      availability_pct: number(input.host.availability_pct, false, 100)
    },
    services, workflows: {},
    history: input.history.map(row => ({ ts: date(row.ts), ...resource(row) })),
    inference: {
      queue: {
        active: number(queue.active), waiting: number(queue.waiting, false, 10),
        capacity: number(queue.capacity, false, 10), wait_limit_seconds: number(queue.wait_limit_seconds, false, 60)
      },
      counts: Object.fromEntries(COUNTS.map(key => [key, number(inference.counts[key])])),
      latency: Object.fromEntries(LATENCIES.map(key => [key, {
        p50: number(inference.latency[key].p50, true), p95: number(inference.latency[key].p95, true)
      }])),
      samples: number(inference.samples, false, 512),
      tokens: {
        measured_generations: number(inference.tokens.measured_generations, false, 512),
        prompt: number(inference.tokens.prompt, true), output: number(inference.tokens.output, true)
      }
    }
  };
}
