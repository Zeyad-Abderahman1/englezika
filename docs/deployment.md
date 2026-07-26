# Deployment Guide — Englizeka Platform

> Written for a developer who has never seen this project. Follow every step in order.

---

## Prerequisites

| Tool               | Minimum Version | Notes                                   |
| ------------------ | --------------- | --------------------------------------- |
| Node.js            | 22.13.0         | Required by `engines` in `package.json` |
| npm                | 10+             | Bundled with Node.js                    |
| Wrangler CLI       | 4.x             | `npm install -g wrangler`               |
| Cloudflare account | —               | With D1 and R2 access                   |
| Git                | any             | For source control                      |

---

## Environment Variables

All variables go in `.env.local` for local development.
For production they are set as **Cloudflare Workers Secrets** (see CI/CD section).

| Variable                            | Required | Description                                                                         |
| ----------------------------------- | -------- | ----------------------------------------------------------------------------------- |
| `RESEND_API_KEY`                    | Yes      | API key from [resend.com](https://resend.com) for transactional email               |
| `EMAIL_FROM`                        | Yes      | Sender address, e.g. `Englizeka <verify@englizeka.com>`                             |
| `VERIFICATION_SECRET`               | Yes      | Long random string (≥ 32 chars) used to hash verification codes. **Never commit.**  |
| `INITIAL_STAFF_EMAIL`               | Yes      | Email address for the first teacher/admin account                                   |
| `INITIAL_STAFF_NAME`                | No       | Display name for the initial account (default: `مستر أحمد حسن`)                     |
| `INITIAL_STAFF_PASSWORD_HASH`       | Yes      | PBKDF2-SHA256 hash of the initial password                                          |
| `INITIAL_STAFF_PASSWORD_SALT`       | Yes      | Hex-encoded salt used to produce the hash                                           |
| `INITIAL_STAFF_PASSWORD_ITERATIONS` | No       | Default: `100000`                                                                   |
| `EMAIL_TEST_MODE`                   | No       | Set `true` in staging to skip real email delivery and return codes in API responses |
| `SERVERSMTP_CONSUMER_KEY`           | No       | Alternative SMTP provider key (ServerSMTP)                                          |
| `SERVERSMTP_CONSUMER_SECRET`        | No       | Alternative SMTP provider secret                                                    |

### Generating the Initial Staff Password Hash

Run this locally (once) to generate the credentials:

```bash
node -e "
const crypto = require('crypto');
const password = process.argv[1];
const salt = crypto.randomBytes(16).toString('hex');
crypto.pbkdf2(password, Buffer.from(salt, 'hex'), 100000, 32, 'sha256', (err, key) => {
  console.log('HASH:', key.toString('hex'));
  console.log('SALT:', salt);
});
" 'YourStrongPassword123!'
```

Copy the output into your `.env.local` and Cloudflare secrets.

---

## Local Development Setup

```bash
# 1. Clone the repository
git clone https://github.com/your-org/englizeka-platform.git
cd englizeka-platform

# 2. Install dependencies
npm install

# 3. Copy and fill in environment variables
cp .env.example .env.local
# Edit .env.local with your actual values

# 4. Authenticate Wrangler with your Cloudflare account
npx wrangler login

# 5. Start the dev server (uses Wrangler D1 local SQLite + R2 mock)
npm run dev
```

The app will be available at `http://localhost:3000`.

> [!NOTE]
> The first request to any route initialises the database schema automatically via `ensureDatabase()`.
> Seed courses and the initial staff account are created on first boot.

---

## Production Build

```bash
# Type-check and lint before building
npm run typecheck
npm run lint

# Build the Cloudflare Workers bundle
npm run build

# Deploy to Cloudflare (uses wrangler.jsonc config)
npm run start  # or: npx wrangler deploy
```

---

## Database Migration Steps

This project uses **Cloudflare D1** (SQLite). Schema changes are applied via `db/runtime.ts` at startup — there are no separate migration files for runtime schema changes.

For **Drizzle-managed schema** (used for type generation only):

```bash
# Generate SQL migration files from schema changes
npm run db:generate

# Apply migrations to D1 (production)
npx wrangler d1 execute DB --file=drizzle/<migration>.sql

# Apply migrations to D1 (staging environment)
npx wrangler d1 execute DB --env staging --file=drizzle/<migration>.sql

# Backup production database
npm run db:backup
```

> [!IMPORTANT]
> Always backup the production D1 database before running migrations:
> `npm run db:backup`

---

## R2 Bucket Setup

```bash
# Create the production videos bucket
npx wrangler r2 bucket create englizeka-prod-videos

# Create the staging videos bucket
npx wrangler r2 bucket create englizeka-staging-videos

# Verify buckets exist
npx wrangler r2 bucket list
```

The bucket bindings are already configured in `wrangler.jsonc`:

- Production binding: `VIDEOS` → `englizeka-prod-videos`
- Staging binding: `VIDEOS` → `englizeka-staging-videos`

> [!CAUTION]
> R2 videos are private. Never enable public access on the bucket — video URLs are served via signed Workers endpoints.

---

## D1 Database Setup

```bash
# Create production D1 database
npx wrangler d1 create englizeka-prod-db

# Copy the database_id from the output and paste it into wrangler.jsonc:
# d1_databases[0].database_id = "<your-id>"

# Create staging database
npx wrangler d1 create englizeka-staging-db
# Update wrangler.jsonc env.staging.d1_databases[0].database_id accordingly
```

---

## Setting Production Secrets

```bash
# Set each secret individually (Wrangler will prompt for the value)
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put EMAIL_FROM
npx wrangler secret put VERIFICATION_SECRET
npx wrangler secret put INITIAL_STAFF_EMAIL
npx wrangler secret put INITIAL_STAFF_PASSWORD_HASH
npx wrangler secret put INITIAL_STAFF_PASSWORD_SALT

# For staging environment
npx wrangler secret put RESEND_API_KEY --env staging
# ... etc.
```

---

## CI/CD Notes

This project is designed to deploy via **Cloudflare Pages** or **Workers CI**.

### Recommended GitHub Actions workflow:

```yaml
name: Deploy
on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
      - run: npm ci
      - run: npm run typecheck
      - run: npm run lint
      - run: npm run build
      - uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
```

Store these GitHub secrets:

- `CLOUDFLARE_API_TOKEN` — a Cloudflare API token with Workers and D1 write access

> [!TIP]
> Use Cloudflare's `wrangler.jsonc` environments to keep staging and production fully separated.
> Staging auto-deploys from the `develop` branch; production deploys from `main` only.

---

## Formatting & Code Quality

```bash
# Check formatting (CI-safe, exits non-zero on issues)
npm run format:check

# Auto-format all source files
npm run format

# Lint
npm run lint

# Type-check
npm run typecheck
```

---

## Maintenance Jobs

The following jobs can be triggered manually from a Cloudflare Cron Trigger or called directly:

```ts
// Clean abandoned exam sessions older than 24h
import { cleanExamSessions } from './app/jobs/cleanExamSessions';
await cleanExamSessions();

// Find and delete R2 orphan files (dry-run first!)
import { cleanOrphanR2Files } from './app/jobs/cleanOrphanR2Files';
await cleanOrphanR2Files(true); // dry-run
await cleanOrphanR2Files(false); // live delete
```
