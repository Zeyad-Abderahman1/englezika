import { performance } from 'node:perf_hooks';

const baseUrl = process.argv[2] || 'http://127.0.0.1:4400';
const stages = (process.argv[3] || '50,100,200,400,800,1200')
  .split(',')
  .map(Number)
  .filter((value) => Number.isInteger(value) && value > 0);
const durationMs = Number(process.argv[4] || 5000);
const paths = (process.argv[5] || '/,/,/,/api/courses,/api/courses,/api/ready').split(',');
const cookie = process.env.LOAD_COOKIE?.trim();
const metricsToken = process.env.PERFORMANCE_METRICS_TOKEN?.trim();

function percentile(sorted, value) {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * value) - 1)];
}

async function runStage(concurrency) {
  const endsAt = performance.now() + durationMs;
  const latencies = [];
  let requests = 0;
  let errors = 0;
  let bytes = 0;
  const statuses = {};
  const resourceSamples = [];
  let sampling = true;

  async function sampleResources() {
    if (!metricsToken) return;
    while (sampling) {
      try {
        const response = await fetch(`${baseUrl}/api/performance`, {
          headers: { 'x-performance-token': metricsToken },
        });
        if (response.ok) resourceSamples.push(await response.json());
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }

  async function virtualUser(id) {
    let requestNumber = 0;
    while (performance.now() < endsAt) {
      const startedAt = performance.now();
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);
      try {
        const path = paths[(id + requestNumber) % paths.length];
        const response = await fetch(`${baseUrl}${path}`, {
          cache: 'no-store',
          signal: controller.signal,
          headers: {
            connection: 'keep-alive',
            'user-agent': 'englizeka-local-load-test',
            ...(cookie ? { cookie } : {}),
          },
        });
        const body = await response.arrayBuffer();
        bytes += body.byteLength;
        statuses[response.status] = (statuses[response.status] || 0) + 1;
        if (!response.ok) errors += 1;
      } catch (error) {
        errors += 1;
        const causeCode = error?.cause?.code;
        const errorKey = causeCode || (error instanceof Error ? error.name : 'NetworkError');
        statuses[errorKey] = (statuses[errorKey] || 0) + 1;
      } finally {
        clearTimeout(timeout);
        latencies.push(performance.now() - startedAt);
        requests += 1;
        requestNumber += 1;
      }
    }
  }

  const startedAt = performance.now();
  const sampler = sampleResources();
  await Promise.all(Array.from({ length: concurrency }, (_, id) => virtualUser(id)));
  sampling = false;
  await sampler;
  const elapsedMs = performance.now() - startedAt;
  latencies.sort((a, b) => a - b);

  const successfulRequests = requests - errors;
  const cpuSamples = resourceSamples.map((sample) => sample.cpuPercent);
  const memorySamples = resourceSamples.map((sample) => sample.memoryRssMb);
  const eventLoopSamples = resourceSamples.map((sample) => sample.eventLoopDelayMs?.p95 || 0);
  const poolWaitingSamples = resourceSamples.map((sample) => sample.databasePool?.waiting || 0);
  return {
    concurrency,
    requests,
    errors,
    errorRate: requests ? (errors / requests) * 100 : 100,
    requestsPerSecond: requests / (elapsedMs / 1000),
    successfulRequestsPerSecond: successfulRequests / (elapsedMs / 1000),
    failedRequestsPerSecond: errors / (elapsedMs / 1000),
    p50Ms: percentile(latencies, 0.5),
    p90Ms: percentile(latencies, 0.9),
    p95Ms: percentile(latencies, 0.95),
    p99Ms: percentile(latencies, 0.99),
    maxMs: latencies.at(-1) || 0,
    statuses,
    cpuPercentAvg: cpuSamples.length ? cpuSamples.reduce((sum, value) => sum + value, 0) / cpuSamples.length : null,
    cpuPercentMax: cpuSamples.length ? Math.max(...cpuSamples) : null,
    memoryRssMbAvg: memorySamples.length ? memorySamples.reduce((sum, value) => sum + value, 0) / memorySamples.length : null,
    memoryRssMbMax: memorySamples.length ? Math.max(...memorySamples) : null,
    eventLoopDelayP95MsMax: eventLoopSamples.length ? Math.max(...eventLoopSamples) : null,
    databasePoolWaitingMax: poolWaitingSamples.length ? Math.max(...poolWaitingSamples) : null,
    transferredMb: bytes / 1024 / 1024,
    elapsedSeconds: elapsedMs / 1000,
  };
}

const results = [];
for (const concurrency of stages) {
  const result = await runStage(concurrency);
  results.push(result);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

process.stdout.write(`SUMMARY ${JSON.stringify(results)}\n`);
