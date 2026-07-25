import vinext from "vinext";
import { defineConfig } from "vite";

const LOCAL_PLACEHOLDER_DATABASE_ID =
  "00000000-0000-4000-8000-000000000000";

const usePolling = process.env.CHOKIDAR_USEPOLLING === "true";

const localBindingConfig = {
  main: "./worker/index.ts",
  compatibility_flags: ["nodejs_compat"],
  d1_databases: [
    {
      binding: "DB",
      database_name: "englizeka-local",
      database_id: LOCAL_PLACEHOLDER_DATABASE_ID,
    },
  ],
  r2_buckets: [
    {
      binding: "VIDEOS",
      bucket_name: "englizeka-videos-local",
    },
  ],
  vars: {
    ...(process.env.RESEND_API_KEY ? { RESEND_API_KEY: process.env.RESEND_API_KEY } : {}),
    ...(process.env.EMAIL_FROM ? { EMAIL_FROM: process.env.EMAIL_FROM } : {}),
    ...(process.env.VERIFICATION_SECRET ? { VERIFICATION_SECRET: process.env.VERIFICATION_SECRET } : {}),
    ...(process.env.EMAIL_TEST_MODE ? { EMAIL_TEST_MODE: process.env.EMAIL_TEST_MODE } : {}),
    ...(process.env.INITIAL_STAFF_EMAIL ? { INITIAL_STAFF_EMAIL: process.env.INITIAL_STAFF_EMAIL } : {}),
    ...(process.env.INITIAL_STAFF_NAME ? { INITIAL_STAFF_NAME: process.env.INITIAL_STAFF_NAME } : {}),
    ...(process.env.INITIAL_STAFF_PASSWORD_HASH ? { INITIAL_STAFF_PASSWORD_HASH: process.env.INITIAL_STAFF_PASSWORD_HASH } : {}),
    ...(process.env.INITIAL_STAFF_PASSWORD_SALT ? { INITIAL_STAFF_PASSWORD_SALT: process.env.INITIAL_STAFF_PASSWORD_SALT } : {}),
    ...(process.env.INITIAL_STAFF_PASSWORD_ITERATIONS ? { INITIAL_STAFF_PASSWORD_ITERATIONS: process.env.INITIAL_STAFF_PASSWORD_ITERATIONS } : {}),
  },
};

export default defineConfig(async () => {
  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import("@cloudflare/vite-plugin");

  return {
    server: usePolling
      ? { watch: { useFsEvents: false, usePolling: true } }
      : undefined,
    plugins: [
      vinext(),
      cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        config: localBindingConfig,
      }),
    ],
  };
});
