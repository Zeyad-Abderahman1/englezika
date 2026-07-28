import vinext from 'vinext';
import { defineConfig, loadEnv } from 'vite';

const LOCAL_PLACEHOLDER_DATABASE_ID = '00000000-0000-4000-8000-000000000000';

const usePolling = process.env.CHOKIDAR_USEPOLLING === 'true';

export default defineConfig(async ({ mode }) => {
  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= 'false';
  process.env.WRANGLER_LOG_PATH ??= '.wrangler/logs';
  process.env.MINIFLARE_REGISTRY_PATH ??= '.wrangler/registry';

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import('@cloudflare/vite-plugin');
  const fileEnv = loadEnv(mode, process.cwd(), '');
  const configuredEnv = { ...fileEnv, ...process.env };
  const forwardedVariables = [
    'VERIFICATION_SECRET',
    'VIDEO_RESOLVE_SECRET',
    'GMAIL_USER',
    'GMAIL_APP_PASSWORD',
    'SERVERSMTP_CONSUMER_KEY',
    'SERVERSMTP_CONSUMER_SECRET',
    'TURBO_SMTP_CONSUMER_KEY',
    'TURBO_SMTP_CONSUMER_SECRET',
    'RESEND_API_KEY',
    'EMAIL_FROM',
    'EMAIL_TEST_MODE',
    'INITIAL_STAFF_EMAIL',
    'INITIAL_STAFF_NAME',
    'INITIAL_STAFF_PASSWORD_HASH',
    'INITIAL_STAFF_PASSWORD_SALT',
    'INITIAL_STAFF_PASSWORD_ITERATIONS',
  ] as const;
  const vars = Object.fromEntries(
    forwardedVariables.flatMap((key) =>
      configuredEnv[key] ? [[key, configuredEnv[key] as string]] : []
    )
  );
  const localBindingConfig = {
    main: './worker/index.ts',
    d1_databases: [
      {
        binding: 'DB',
        database_name: 'englizeka-local',
        database_id: LOCAL_PLACEHOLDER_DATABASE_ID,
      },
    ],
    r2_buckets: [
      {
        binding: 'VIDEOS',
        bucket_name: 'englizeka-videos-local',
      },
    ],
    vars,
  };

  return {
    server: {
      host: '127.0.0.1',
      ...(usePolling ? { watch: { useFsEvents: false, usePolling: true } } : {}),
    },
    plugins: [
      vinext(),
      cloudflare({
        viteEnvironment: { name: 'rsc', childEnvironments: ['ssr'] },
        config: localBindingConfig,
        ...(configuredEnv.E2E_TEST_MODE === 'true' ? { persistState: false } : {}),
      }),
    ],
  };
});
