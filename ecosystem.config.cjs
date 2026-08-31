/**
 * PM2 Process Manager Configuration — Englizeka Production
 *
 * Architecture:
 * - PM2 runs in single-instance fork mode under service user 'englizeka'.
 * - scripts/start-cluster.mjs manages Node cluster workers based on WEB_CONCURRENCY.
 * - Production loads exclusively from /var/www/englizeka/.env via --env-file=.env.
 */

module.exports = {
  apps: [
    {
      name: 'englizeka',
      script: 'scripts/start-cluster.mjs',
      cwd: '/var/www/englizeka',
      instances: 1,
      exec_mode: 'fork',
      node_args: '--env-file=.env',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
        HOSTNAME: '127.0.0.1',
        WEB_CONCURRENCY: 4,
      },
      max_memory_restart: '1500M',
      autorestart: true,
      watch: false,
      max_restarts: 10,
      restart_delay: 2000,
      error_file: '/var/log/englizeka/error.log',
      out_file: '/var/log/englizeka/out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
    },
  ],
};
