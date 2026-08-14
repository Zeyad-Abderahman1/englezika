import cluster from 'node:cluster';
import { availableParallelism } from 'node:os';

const requestedWorkers = Number(process.env.WEB_CONCURRENCY || 4);
const workerCount = Number.isFinite(requestedWorkers)
  ? Math.min(Math.max(Math.round(requestedWorkers), 1), availableParallelism())
  : Math.min(4, availableParallelism());

if (cluster.isPrimary) {
  process.stdout.write(`Starting ${workerCount} Englizeka web workers\n`);
  for (let index = 0; index < workerCount; index += 1) cluster.fork();

  cluster.on('exit', (worker, code, signal) => {
    if (!worker.exitedAfterDisconnect) {
      process.stderr.write(
        `Worker ${worker.process.pid} exited (${code ?? signal}); starting replacement\n`
      );
      cluster.fork();
    }
  });

  const shutdown = () => {
    for (const worker of Object.values(cluster.workers)) worker?.disconnect();
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
} else {
  await import('../.next/standalone/server.js');
}
