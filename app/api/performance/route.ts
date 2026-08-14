import { monitorEventLoopDelay } from 'node:perf_hooks';
import { getDatabase } from '../../lib/platform';

const globalMetrics = globalThis as typeof globalThis & {
  __ENGLIZEKA_EVENT_LOOP_HISTOGRAM__?: ReturnType<typeof monitorEventLoopDelay>;
  __ENGLIZEKA_CPU_SAMPLE__?: NodeJS.CpuUsage;
  __ENGLIZEKA_TIME_SAMPLE__?: bigint;
};

function histogram() {
  if (!globalMetrics.__ENGLIZEKA_EVENT_LOOP_HISTOGRAM__) {
    const value = monitorEventLoopDelay({ resolution: 10 });
    value.enable();
    globalMetrics.__ENGLIZEKA_EVENT_LOOP_HISTOGRAM__ = value;
  }
  return globalMetrics.__ENGLIZEKA_EVENT_LOOP_HISTOGRAM__;
}

export async function GET(request: Request) {
  const expectedToken = process.env.PERFORMANCE_METRICS_TOKEN;
  const suppliedToken = request.headers.get('x-performance-token');
  if (!expectedToken || suppliedToken !== expectedToken) {
    return new Response(null, { status: 404 });
  }

  const now = process.hrtime.bigint();
  const cpu = process.cpuUsage(globalMetrics.__ENGLIZEKA_CPU_SAMPLE__);
  const elapsedMicros = globalMetrics.__ENGLIZEKA_TIME_SAMPLE__
    ? Number(now - globalMetrics.__ENGLIZEKA_TIME_SAMPLE__) / 1_000
    : 0;
  globalMetrics.__ENGLIZEKA_CPU_SAMPLE__ = process.cpuUsage();
  globalMetrics.__ENGLIZEKA_TIME_SAMPLE__ = now;

  const delay = histogram();
  const memory = process.memoryUsage();
  const pool = getDatabase().pool;
  const payload = {
    cpuPercent: elapsedMicros ? ((cpu.user + cpu.system) / elapsedMicros) * 100 : 0,
    memoryRssMb: memory.rss / 1024 / 1024,
    heapUsedMb: memory.heapUsed / 1024 / 1024,
    eventLoopDelayMs: {
      mean: Number.isFinite(delay.mean) ? delay.mean / 1e6 : 0,
      p95: delay.percentile(95) / 1e6,
      p99: delay.percentile(99) / 1e6,
      max: delay.max / 1e6,
    },
    databasePool: {
      total: pool.totalCount,
      idle: pool.idleCount,
      waiting: pool.waitingCount,
      max: pool.options.max,
    },
  };
  delay.reset();
  return Response.json(payload, { headers: { 'cache-control': 'no-store' } });
}
