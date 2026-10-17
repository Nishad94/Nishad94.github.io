export function metricsFixture() {
  const now = new Date().toISOString();
  return {
    schema: 'nishad.inference-operations.v1', generated_at: now, started_at: now, sampled_at: now,
    host: { cpu_pct: 12, memory_pct: 30, gpu_pct: null, disk_pct: 25, uptime_days: 1, services_up: 2, services_total: 2, availability_pct: 100 },
    history: [{ ts: now, cpu_pct: 12, memory_pct: 30, gpu_pct: null, disk_pct: 25 }],
    services: { 'Python gateway': { up: true, latency_ms: null }, 'Model API': { up: true, latency_ms: 1 } },
    workflows: {},
    inference: {
      queue: { active: 0, waiting: 0, capacity: 10, wait_limit_seconds: 60 },
      counts: { requests: 4, queued: 1, queue_full: 0, queue_timeout: 0, cancelled: 0, rate_limited: 0, completed: 4, truncated: 0, failed: 0 },
      latency: {
        duration_ms: { p50: 100, p95: 200 }, queue_ms: { p50: 0, p95: 10 },
        first_token_ms: { p50: 50, p95: 100 }, tokens_per_second: { p50: 20, p95: 30 }
      },
      samples: 4, tokens: { measured_generations: 4, prompt: 100, output: 40 }
    }
  };
}
