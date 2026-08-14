# Englizeka Platform Performance Engineering Results

Report date: 12 August 2026  
Repository revision at start: `94980d8` (`main`)  
Final runtime: Node.js 24.15.0, Next.js 16.3.0, React 19.2.8, PostgreSQL 16 Alpine

## 1. Executive Summary

This engagement profiled and optimized the Englizeka Next.js/PostgreSQL application, its database access patterns, readiness endpoint, authentication/session path, standalone packaging, and Node.js process topology. The measured baseline saturated after 400 concurrent virtual users: PostgreSQL pool waiting rose from 160 requests at 400 users to 941 at 1,200, p95 latency rose to 5,567 ms, and 2.216% of requests failed. The dominant causes were an uncached database readiness query included in the workload, a single Node.js process, redundant session/user/verification reads, and serial dashboard reads.

The final implementation coalesces readiness checks, reduces authenticated student identity/verification lookup from four SQL queries to one indexed join, performs dashboard read batches with bounded concurrency, starts four Node workers by default, packages the standalone client assets correctly, bounds per-worker public-course caches, and provides opt-in performance metrics. The existing performance indexes were verified as active; no speculative new index was added.

Using the same local mixed workload, successful throughput at 1,200 concurrency increased from **644.11 to 1,470.29 requests/second** (**+128.3%**), p95 fell from **5,567.00 ms to 1,592.45 ms** (**71.4% lower**), error rate fell from **2.216% to 0%**, and peak database pool waiting fell from **941 to 0**. The highest measured successful throughput was **1,767.67 RPS at 400 concurrency**. Under the explicit local SLO of error rate <=1% and p95 <=2,000 ms, maximum stable concurrency increased from **400 to 1,400**; the first final SLO violation was at 1,600 concurrency (2,478.05 ms p95). The recommended production operating limit is **1,000 concurrent active requests**, leaving a 28.6% concurrency margin below the measured 1,400-user boundary.

## 2. Original Baseline

The valid baseline used the unoptimized single-process application at the repository's starting revision plus measurement-only instrumentation. Each stage ran for 8 seconds after production build. The workload cycled through `/` (50%), `/api/courses` (33.3%), and `/api/ready` (16.7%) with keep-alive requested. Server and load generator ran on the same Windows host.

| Concurrency | Attempted RPS | Successful RPS | p95 | p99 | Error % | Peak pool waiting | Saturation observation |
|---:|---:|---:|---:|---:|---:|---:|---|
| 25 | 736.68 | 736.68 | 55.69 ms | 74.15 ms | 0.000 | 0 | Healthy |
| 50 | 714.32 | 714.32 | 113.70 ms | 134.35 ms | 0.000 | 0 | Healthy |
| 100 | 646.57 | 646.57 | 221.13 ms | 258.12 ms | 0.000 | 4 | Pool queue begins |
| 200 | 890.36 | 890.36 | 331.56 ms | 427.13 ms | 0.000 | 12 | Still inside SLO |
| 400 | 759.27 | 759.27 | 1,563.08 ms | 1,854.72 ms | 0.000 | 160 | Last baseline stage inside SLO |
| 600 | 635.95 | 635.95 | 3,211.83 ms | 3,632.55 ms | 0.000 | 362 | First SLO violation |
| 800 | 750.20 | 750.20 | 3,689.16 ms | 3,897.17 ms | 0.000 | 557 | Throughput below the 400-user trend and severe queueing |
| 1,000 | 764.14 | 761.73 | 4,748.63 ms | 5,307.45 ms | 0.316 | 760 | 21 HTTP 503 responses |
| 1,200 | 658.71 | 644.11 | 5,567.00 ms | 5,931.42 ms | 2.216 | 941 | 131 HTTP 503 responses |

An initial run that returned 49.98% errors at only 25 users was discarded: `npm start` had not loaded `.env.local`, so database routes lacked `DATABASE_URL`. It was a launch-configuration failure, not a capacity measurement. The start scripts now load `.env`/`.env.local` when present.

The supplied historical statement mentions approximately 1,399 attempted RPS and 23% errors at 1,200 concurrency. No raw result, status-code distribution, duration, environment record, or server log for that run exists in the repository. Its successful throughput is arithmetically about **1,077.23 RPS** (`1399 * 0.77`), not 1,399 successful RPS. It is reported as historical/unverified and is not substituted for the reproducible measured baseline above.

## 3. Initial Performance Problems

### Application and authentication

- Every authenticated student request looked up the native session, loaded the user, queried the same session again, and then separately checked email verification. That was four database reads before dashboard data retrieval.
- `/api/dashboard` then executed 11 reads serially while reserving one pool connection.
- Public course data already had an in-memory promise cache, but it had no TTL. That becomes a correctness risk in a multi-worker process because invalidation affects only one worker.

### Node.js and Next.js

- The production path used one Node process on a 6-core/12-thread machine. Baseline process CPU averaged roughly 127-146% (Windows/Node convention: 100% is one logical core), while event-loop p95 delay reached 244 ms.
- The standalone output omitted `public` and `.next/static`. Server-rendered HTML loaded, but client JavaScript did not hydrate; browser interactions silently failed.
- The original `npm start` command did not load the local runtime environment.

### PostgreSQL and connection pool

- `DATABASE_POOL_MAX` was 20 for one process. This was reasonable in isolation, but the readiness request performed `SELECT 1` for every hit. Under the benchmark mix, readiness traffic alone exhausted the pool.
- Peak pool waiters climbed from 160 at 400 concurrency to 557 at 800 and 941 at 1,200.
- PostgreSQL itself did not exhibit CPU or connection exhaustion. The local container had `max_connections=100`, `shared_buffers=128MB`, and only a tiny test dataset. The queue was created in the application pool.
- Existing partial/composite indexes in migrations `001` and `002` were used during tests, including `enrollments_approved_user_course_idx`, `attempts_user_exam_submitted_idx`, `exams_published_course_created_idx`, and `announcements_status_created_idx`.

### CPU, memory, event loop, network, and generator

- Single-process Node event-loop delay, rather than total machine CPU, limited static/API dispatch.
- Baseline RSS grew from approximately 205 MB at 25 concurrency to 467 MB average/511 MB maximum at 1,200.
- The load generator shared the host, CPU scheduler, loopback network, and ephemeral TCP port range with four/six servers and Docker. After repeated sweeps Windows showed 3,816 sockets in `TIME_WAIT` out of a 16,384-port dynamic range.
- A later long sweep produced client `TypeError`/`ECONNREFUSED` events while every completed server response was HTTP 200, no worker exited, and pool waiting remained zero. A dedicated 800-user rerun immediately completed with 0% errors. Those transient failures are treated as generator/loopback artifacts, not hidden server HTTP failures.

## 4. Root Cause Analysis

Performance degraded after approximately 400 concurrent users because the 20-connection pool became a queue for repeated readiness database checks. At 400 users the pool had 160 waiters and p95 jumped to 1.56 seconds. By 800 users it had 557 waiters and p95 reached 3.69 seconds. Throughput decreased because requests spent increasing time waiting rather than doing useful work, while one Node event loop also handled all response parsing, rendering, compression, and socket callbacks.

At 1,200 measured baseline concurrency, 941 requests waited for a pool connection. Some readiness checks exceeded the 5-second connection timeout and returned 503; 131 of 5,911 attempts failed (2.216%). This is an exact explanation for the reproducible local baseline error rate.

There is not enough evidence to give an exact failure-code explanation for the separate historical 23% result. Claiming one would violate the no-fabrication requirement. The available arithmetic says about 322 of every 1,399 requests/second failed and about 1,077/second succeeded. The measured mechanism (pool queue plus timeouts) is consistent with such a failure mode, and load-generator saturation could contribute, but the exact split among HTTP 503, timeout, reset, database, and generator errors requires that run's missing raw logs.

The measured bottleneck was therefore a combination: application readiness behavior and redundant SQL created pool pressure; the single Node runtime limited CPU parallelism; and, beyond roughly 1,400-1,600 final concurrency, same-host load generation and loopback networking influenced results. PostgreSQL server capacity was not the final measured limit.

## 5. Changes Implemented

### `app/api/ready/route.ts`

- **What:** Added promise coalescing, a 1-second success TTL, and a 250-ms failure TTL around `SELECT 1`; retained `no-store` HTTP semantics.
- **Why:** A readiness storm must not consume every pool connection. A short TTL still detects failures quickly.
- **Measured effect:** In the first single-process optimization pass, peak pool waiting at 1,200 fell from 941 to 0, successful RPS rose from 644.11 to 879.61, p95 fell from 5,567.00 to 2,008.96 ms, and errors fell from 2.216% to 0.396%. This workload is primarily sensitive to the readiness change.

### `app/lib/api-auth.ts` and `app/api/dashboard/route.ts`

- **What:** Replaced session lookup + user lookup + repeated session lookup + verification lookup with one indexed join between `native_sessions` and `users`. `SessionUser` now carries current verification state, and the dashboard reuses it.
- **Why:** The old path performed four database queries before dashboard work and duplicated token validation.
- **Measured effect:** Together with cluster and bounded dashboard reads, `/api/dashboard` p95 at 100 mixed users fell from 1,299.59 to 309.52 ms (76.2%); at 50 it fell from 663.13 to 195.89 ms (70.5%).

### `app/lib/database.ts`

- **What:** Changed `readBatch` from 11 serial queries on one checked-out connection to an ordered, bounded worker pool. Default intra-request read concurrency is four and is configurable through `DATABASE_READ_BATCH_CONCURRENCY`.
- **Why:** It reduces sequential database round trips without allowing an unbounded `Promise.all` query burst.
- **Measured effect:** With the same four-process runtime, `/api/dashboard` p95 improved from 512.26 to 309.52 ms at 100 users, from 385.01 to 195.89 ms at 50, and from 189.10 to 178.89 ms at 25. The experiment was retained.

### `scripts/start-cluster.mjs` and `package.json`

- **What:** Added a native Node cluster launcher, graceful worker disconnect on `SIGINT`/`SIGTERM`, automatic replacement for unexpected exits, `WEB_CONCURRENCY`, `start:single`, and made `npm start`/`start:cluster` use four workers by default. Environment files are loaded explicitly.
- **Why:** Four workers use multiple CPU cores and keep the default theoretical database maximum at 80 connections (4 x 20), leaving room under PostgreSQL's 100-connection limit.
- **Measured effect:** Compared with the optimized single process at 1,200, four workers raised successful RPS from 879.61 to 1,599.98 in the isolated Next.js 16.2 comparison (+81.9%), reduced p95 from 2,008.96 to 1,476.25 ms (26.5%), and eliminated errors. On the final Next.js 16.3 build, the reproducible 1,200 result was 1,470.29 successful RPS, 1,592.45 ms p95, and 0% error.
- **Rejected experiment:** Six workers with 12 DB connections each delivered only 827.45 RPS/1,897.28 ms p95 at 400 and 1,296.25 RPS/1,574.75 ms p95 at 1,200. Four workers delivered 1,767.67 and 1,470.29 RPS respectively, so six workers were not adopted.

### `app/lib/public-course-cache.ts`

- **What:** Added a 60-second TTL while preserving promise coalescing and immediate same-worker invalidation.
- **Why:** Four workers have independent memory. Without a TTL, an admin mutation handled by one worker could leave other workers stale indefinitely.
- **Measured effect:** No measurable capacity regression; it adds at most one coalesced refresh per worker per minute. This is primarily a cluster-correctness change.

### `scripts/prepare-standalone.mjs` and `postbuild`

- **What:** Copies `public` and `.next/static` into `.next/standalone` after every build.
- **Why:** Next.js standalone tracing does not copy these directories automatically. Their absence prevented client hydration.
- **Measured effect:** Browser course-filter interaction changed from no effect (`aria-selected=false`) to functional (`aria-selected=true`) with no console warnings/errors. This is a functional rather than RPS improvement.

### `app/api/performance/route.ts` and `tests/load-capacity.mjs`

- **What:** Added token-gated, opt-in CPU/RSS/heap/event-loop/pool telemetry; expanded the load tool with successful/failed RPS, p50/p90/p95/p99/max, status/cause counts, resource sampling, and all-stage execution.
- **Why:** Successful throughput and failure causes must be measured separately. The route returns 404 unless `PERFORMANCE_METRICS_TOKEN` is configured and supplied.
- **Measured effect:** Enabled attribution of the baseline to 941 pool waiters and final results to zero pool waiting. Measurement overhead was applied consistently.

### Dependencies and configuration

- Upgraded Next.js from 16.2.12 to 16.3.0 and applied non-breaking audit updates. `npm audit` improved from six high-severity findings initially (three after ordinary audit fix) to **zero vulnerabilities**.
- Added `DATABASE_READ_BATCH_CONCURRENCY=4` documentation to `.env.example`.
- No logging was added to hot request paths. Existing structured error logging remains unchanged.
- No payload fields or authentication guarantees were removed. Compression and existing immutable asset headers remain enabled.

### Database indexes and SQL

- No new index was added. The existing migrations already cover the measured joins and filters, and the test dataset is too small to justify speculative write-amplifying indexes.
- SQL query count on the authenticated pre-dashboard path was reduced from four to one (75% reduction).
- Dashboard reads remain logically the same and ordered in the response, but execute with bounded concurrency.

## 6. Codex Skills and Tools Used

| Skill/tool | Purpose |
|---|---|
| Computer Use skill | Started the pre-installed Docker Desktop application when its engine was not running. No software was installed. |
| Browser control skill | Verified the production standalone site, Arabic page content, course page, console state, hydration, and interactive tab selection; it exposed the missing standalone assets. |
| Node.js `monitorEventLoopDelay`, `process.cpuUsage`, `process.memoryUsage` | Server event-loop, CPU, heap, and RSS profiling. |
| `pg.Pool` counters | Measured total, idle, and waiting application-side DB connections. |
| `tests/load-capacity.mjs` | Closed-loop staged concurrency benchmark with successful/failed throughput and latency percentiles. |
| `tests/load-pages.mjs` | Authenticated student/staff and public all-pages comparison. |
| PostgreSQL `pg_stat_user_indexes`, `pg_stat_activity`, settings | Verified index use, active/idle connections, `max_connections`, and test database state. |
| Docker Compose/PostgreSQL 16 | Reproducible local database environment. |
| TypeScript, ESLint, Node test runner, live E2E runner, npm audit | Regression and security verification. |

No new Codex skill was installed or created. No third-party MCP database service, PM2, Redis, CDN, cloud load tester, or external APM was used. The browser and Windows-control MCP-backed workflows were used only for the purposes above.

## 7. Before vs After Performance Results

Positive p95 improvement means lower latency. CPU and memory are shown as **before single process -> after sampled cluster worker average**; cluster-wide totals were not fabricated. The 800-user after value is the dedicated clean confirmation rerun because the long sweep had 73 transient loopback `ECONNREFUSED` events; that rerun returned only HTTP 200.

| Concurrency | Before Successful RPS | After Successful RPS | RPS Improvement % | Before p95 | After p95 | p95 Improvement % | Before Error % | After Error % | CPU % | Memory |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 25 | 736.68 | 914.36 | +24.1% | 55.69 ms | 54.83 ms | 1.5% | 0.000 | 0.000 | 146.0 -> 92.7 | 205.4 -> 116.5 MB |
| 50 | 714.32 | 1,284.06 | +79.8% | 113.70 ms | 77.67 ms | 31.7% | 0.000 | 0.000 | 140.6 -> 93.2 | 307.5 -> 196.0 MB |
| 100 | 646.57 | 1,442.68 | +123.1% | 221.13 ms | 141.99 ms | 35.8% | 0.000 | 0.000 | 141.6 -> 98.2 | 329.5 -> 255.5 MB |
| 200 | 890.36 | 1,496.91 | +68.1% | 331.56 ms | 271.44 ms | 18.1% | 0.000 | 0.000 | 143.0 -> 116.5 | 358.4 -> 276.2 MB |
| 400 | 759.27 | 1,767.67 | +132.8% | 1,563.08 ms | 439.08 ms | 71.9% | 0.000 | 0.000 | 143.1 -> 116.2 | 374.2 -> 293.6 MB |
| 600 | 635.95 | 1,560.56 | +145.4% | 3,211.83 ms | 706.90 ms | 78.0% | 0.000 | 0.000 | 137.2 -> 98.5 | 378.4 -> 309.9 MB |
| 800 | 750.20 | 1,105.36 | +47.3% | 3,689.16 ms | 1,543.28 ms | 58.2% | 0.000 | 0.000 | 127.4 -> 107.7 | 402.9 -> 210.5 MB |
| 1,000 | 761.73 | 1,504.18 | +97.5% | 4,748.63 ms | 1,261.08 ms | 73.4% | 0.316 | 0.000 | 132.2 -> 96.5 | 416.4 -> 323.1 MB |
| 1,200 | 644.11 | 1,470.29 | +128.3% | 5,567.00 ms | 1,592.45 ms | 71.4% | 2.216 | 0.000 | 134.9 -> 90.6 | 467.1 -> 333.5 MB |

## 8. Final Load Test Results

The final primary sweep used the production standalone Next.js 16.3.0 build, four Node workers, PostgreSQL pool maximum 20 per worker, 6 seconds per level, and the same endpoint mix as baseline. Metrics are closed-loop and include response-body consumption. CPU/memory are sampled per responding worker, not aggregate cluster totals. Event-loop is the maximum observed worker p95 sample. Database waiting is the maximum sampled `pg.Pool.waitingCount`.

| Concurrency | Attempted RPS | Successful RPS | Failed RPS | Error % | p50 | p90 | p95 | p99 | Maximum latency | CPU % | Memory | Event-loop delay | DB pool waiting |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 25 | 914.36 | 914.36 | 0.00 | 0.000 | 24.01 ms | 48.70 ms | 54.83 ms | 81.15 ms | 416.30 ms | 92.7 | 116.5 MB | 16.61 ms | 0 |
| 50 | 1,284.06 | 1,284.06 | 0.00 | 0.000 | 35.27 ms | 71.51 ms | 77.67 ms | 91.34 ms | 139.21 ms | 93.2 | 196.0 MB | 17.56 ms | 0 |
| 100 | 1,442.68 | 1,442.68 | 0.00 | 0.000 | 63.84 ms | 127.40 ms | 141.99 ms | 174.49 ms | 269.62 ms | 98.2 | 255.5 MB | 37.36 ms | 0 |
| 200 | 1,496.91 | 1,496.91 | 0.00 | 0.000 | 123.71 ms | 238.52 ms | 271.44 ms | 335.02 ms | 557.90 ms | 116.5 | 276.2 MB | 72.55 ms | 0 |
| 400 | 1,767.67 | 1,767.67 | 0.00 | 0.000 | 217.13 ms | 399.24 ms | 439.08 ms | 553.30 ms | 851.77 ms | 116.2 | 293.6 MB | 131.86 ms | 0 |
| 600 | 1,560.56 | 1,560.56 | 0.00 | 0.000 | 351.10 ms | 666.14 ms | 706.90 ms | 1,193.17 ms | 1,312.42 ms | 98.5 | 309.9 MB | 96.86 ms | 0 |
| 800* | 1,105.36 | 1,105.36 | 0.00 | 0.000 | 603.12 ms | 1,375.93 ms | 1,543.28 ms | 2,015.91 ms | 2,028.58 ms | 107.7 | 210.5 MB | 283.64 ms | 0 |
| 1,000 | 1,504.18 | 1,504.18 | 0.00 | 0.000 | 595.42 ms | 1,155.94 ms | 1,261.08 ms | 1,634.78 ms | 1,763.85 ms | 96.5 | 323.1 MB | 112.79 ms | 0 |
| 1,200 | 1,470.29 | 1,470.29 | 0.00 | 0.000 | 668.98 ms | 1,498.74 ms | 1,592.45 ms | 2,020.12 ms | 2,193.50 ms | 90.6 | 333.5 MB | 225.71 ms | 0 |
| 1,400 | 1,331.41 | 1,331.41 | 0.00 | 0.000 | 1,114.09 ms | 1,712.71 ms | 1,861.38 ms | 3,069.72 ms | 3,079.54 ms | 93.9 | 338.8 MB | 99.09 ms | 0 |
| 1,600 | 1,317.27 | 1,317.27 | 0.00 | 0.000 | 1,327.52 ms | 1,844.02 ms | 2,478.05 ms | 3,600.10 ms | 3,735.20 ms | 89.0 | 358.3 MB | 136.71 ms | 0 |

`*` The primary sweep's 800 stage recorded 73 client-side `ECONNREFUSED` events (0.802%) even though adjacent 1,000/1,200 stages had none, no server worker exited, and completed responses were all 200. The table uses the dedicated 800-user confirmation rerun (0 errors). Both outcomes are disclosed.

Higher exploratory tests on the earlier four-worker build reached 2,400 concurrency with 0 HTTP errors, but p95 was 4,353.66 ms and throughput only 1,142.80 RPS. These levels were responsive but not SLO-stable and are not claimed as safe capacity.

## 9. Capacity Result

- **SLO used for capacity:** error rate <=1% and p95 <=2,000 ms.
- **Maximum tested concurrency:** 2,400 (exploratory); 1,600 on the exact final build.
- **Original maximum stable concurrency:** 400.
- **Final maximum stable concurrency:** 1,400.
- **First final SLO violation:** 1,600 due to 2,478.05 ms p95; error rate remained 0%.
- **Highest successful throughput:** 1,767.67 RPS at 400 concurrency.
- **Best p95 under meaningful load:** 439.08 ms at 400 concurrency (using 400 as meaningful high load).
- **Recommended production concurrency limit:** 1,000 concurrent active requests on comparable hardware and data size.
- **Safety margin:** 400 requests (28.6%) below measured stable concurrency; 600 (37.5%) below the first violation.

Concurrency here means simultaneous closed-loop HTTP clients, not merely logged-in students. Real students have think time and usually generate far fewer simultaneous requests, but production sizing must be validated with realistic sessions and a larger database.

## 10. Database Performance

- **Pool before:** one Node process, maximum 20 connections, 30-second idle timeout, 5-second connection timeout.
- **Pool after:** four Node workers, maximum 20 each (theoretical 80 total), same timeout controls. PostgreSQL allows 100 connections. The six-worker experiment reduced pool max to 12 each but was rejected for lower throughput.
- **Indexes added:** none in this engagement. Existing migrations already include partial/composite indexes for approved enrollments, submitted attempts, published exams/assignments/videos, session hashes, course status, and notification reads.
- **Queries optimized:** authentication/verification reduced from four queries to one join; readiness queries coalesced; dashboard read round trips bounded to four concurrent workers.
- **Slow queries discovered:** no individually slow SQL statement on the tiny local dataset. Waiting was application-pool queue time, not PostgreSQL execution time.
- **Query count reduction:** 75% on authenticated identity + verification (4 -> 1). Repeated readiness queries collapse to at most one DB query per worker per second during sustained success.
- **Waiting behavior:** peak `pg.Pool.waitingCount` fell from 941 at baseline 1,200 to 0 at every reported final stage.
- **Peak behavior:** after tests, PostgreSQL reported four idle application connections and one active monitoring connection. Frequently exercised indexes had thousands of scans.
- **Database limitation:** only 2-4 live rows existed in most content tables. Query-plan behavior at millions of attempts/enrollments was not measured and must not be inferred from this dataset.

## 11. Server and Runtime Performance

- **Final Node configuration:** native cluster, default four workers, overridable with `WEB_CONCURRENCY`; `start:single` remains for diagnostics.
- **PM2:** not installed or required. A native launcher avoids an additional runtime dependency. A service manager/systemd should still supervise the primary process in production.
- **CPU:** baseline single-process average was approximately 127-146%. Final telemetry sampled roughly 89-116% average for whichever worker answered the metrics request. Values above 100% reflect short multi-thread/native work; aggregate cluster CPU was not directly measured.
- **Memory:** final sampled worker average ranged from 116.5 to 358.3 MB across stages. Cluster-wide total was not measured and is intentionally not estimated.
- **Event loop:** baseline sampled p95 delay peaked at 244.45 ms. Final reported stages ranged from 16.61 to 283.64 ms. Multiple workers prevent one delayed loop from blocking all traffic.
- **Garbage collection:** no stop-the-world GC trace was captured. RSS stabilized below roughly 378 MB per sampled worker in the main final sweep; no worker exited or showed an application exception.
- **Single vs cluster:** at 1,200, optimized single process achieved 879.61 successful RPS, 2,008.96 ms p95, 0.396% errors; four workers achieved up to 1,599.98 RPS, 1,476.25 ms p95, 0% in the isolated topology comparison. Six workers regressed and were rejected.

## 12. Reliability and Error Analysis

- **HTTP 503:** baseline readiness requests timed out waiting for a DB pool connection (21 at 1,000; 131 at 1,200). Readiness coalescing eliminated these in the final tests.
- **HTTP 500/503 invalid run:** occurred only when the server was launched without `DATABASE_URL`; the run was discarded and the start script was fixed.
- **Timeouts:** baseline p95/p99 approached the 10-second client timeout but measured maximum was 8.39 seconds. Final maximum at 1,600 was 3.74 seconds.
- **Connection errors:** one repeated long sweep recorded client `TypeError`; after error-cause instrumentation, an 800 stage recorded 73 `ECONNREFUSED`. No worker exit or server exception accompanied it, later higher stages and the dedicated rerun had zero failures, and thousands of loopback sockets were in `TIME_WAIT`. It is treated as same-host load-generator/network noise.
- **Database errors:** none in valid final stages. Pool waiting remained zero.
- **Application exceptions:** none during final load, E2E, or browser verification.
- **Hydration failure:** missing standalone static assets caused client controls not to work. The post-build copy fixed it and browser console verification was clean.
- **Historical 23%:** exact error causes remain unknown because raw evidence is absent; the report does not relabel attempted throughput as successful throughput.

## 13. Regression Testing

| Check | Final result |
|---|---|
| Build | PASS — Next.js 16.3.0 production build, 40 routes/pages, standalone asset postbuild completed |
| Lint | PASS — ESLint exit 0 |
| Typecheck | PASS — `tsc --noEmit` exit 0 |
| Unit tests | PASS — 9/9 |
| Security tests | PASS — 14/14 |
| Integration/E2E | PASS — auth, password reset, course/exam editing, assignments, notifications, payment, quiz timing/gates, completion proof, storage deletion, staff permissions |
| Dependency security | PASS — `npm audit --audit-level=high`, 0 vulnerabilities |
| Browser functional verification | PASS after packaging fix — home and courses render in Arabic, correct titles/headings, course filter hydrates and selects, no console warnings/errors |

The first final `npm test` attempt failed only because a running Windows server held `.next/standalone` open (`EBUSY`). After stopping the server, the same command passed. This is documented as test orchestration, not an application regression.

## 14. Remaining Bottlenecks

- The final limit is primarily Node/render/socket scheduling and the same-host load generator, not PostgreSQL pool waiting. At 1,600 p95 exceeded 2 seconds while DB waiting stayed zero.
- The benchmark duration (6-8 seconds per stage) is suitable for comparative iteration but not a soak test. Memory leaks, cache churn, and database bloat need 30-60 minute production-like tests.
- The database is tiny. Large enrollment/attempt/announcement cardinalities may expose query-plan and pagination costs not visible here.
- Admin bootstrap still launches many parallel queries. It is paginated but should be retested with production-scale tables.
- Four workers hold independent application and Next.js in-memory caches. The public-course cache is bounded to 60 seconds, but immediate cross-worker invalidation is not distributed.
- No reverse proxy, TLS, CDN, WAN latency, external email, payment provider, or YouTube latency was included.
- The load generator shared the server host and showed loopback/ephemeral-port artifacts. A separate generator is required to prove server-only capacity above the measured boundary.
- PostgreSQL runs in Docker Desktop with 128 MB shared buffers, not on production VPS storage. Disk durability/IO latency was not stressed.
- CPU and RSS telemetry is per sampled worker in cluster mode. Aggregate host telemetry needs OS/APM collection in deployment.

## 15. Recommended Next Improvements

1. **Highest priority:** run a 30-minute distributed load test from a separate host using realistic authenticated student journeys and production-scale seeded data. Capture host-wide CPU/RSS, PostgreSQL latency, pool wait histograms, and network errors.
2. Put nginx, Caddy, or the hosting provider's reverse proxy in front of Node for TLS, static asset delivery, malformed/slow request protection, compression policy, and connection management.
3. Serve immutable `.next/static` and public WebP assets through a CDN. Cache public course JSON at the reverse proxy/CDN while honoring mutation invalidation/short TTL.
4. Add PostgreSQL `pg_stat_statements` and slow-query logging in staging, then tune indexes from real plans and cardinalities rather than guesses.
5. Keep total application pool capacity below PostgreSQL's connection budget. If horizontally scaling containers, divide the pool budget or add PgBouncer.
6. Add deployment-wide metrics/APM for aggregate CPU, RSS, GC pauses, event-loop delay, status codes, and pool waiting.
7. Redis is **not currently justified for throughput**: database waiting is zero after optimization and caches are small. Consider it only when immediate multi-instance invalidation, distributed rate limiting, or shared Next cache is required.
8. Horizontal scaling beyond one machine is justified only after a separate-host test shows the four-worker node is the server-side limit. If adopted, use a shared cache/invalidation strategy, consistent Next server-action encryption key, deployment ID, sticky-independent sessions, and a load balancer.

## 16. Final Engineering Verdict

The platform is **conditionally production ready for a controlled initial launch** on hardware comparable to the test host, provided it is run with the final four-worker `npm start`, placed behind a reverse proxy, configured with real secrets/storage/backups, and monitored. Functional, security, build, lint, type, E2E, browser, and dependency-audit gates pass.

On this small local dataset and mixed closed-loop workload, the platform safely supported **1,400 concurrent active HTTP clients** under the defined <=1% error and <=2-second p95 SLO. The recommended operating concurrency is **1,000**, not 1,400, to preserve a 28.6% safety margin. Current deployments should not plan to exceed **1,400 simultaneous active requests** without environment-specific validation; 1,600 violated the latency SLO even with 0% errors.

Supporting significantly more students requires a separate load-generator proof, production-scale data testing, reverse-proxy/CDN offload, host-wide telemetry, and likely horizontal application scaling. Database replicas or Redis should be introduced only when measured database read pressure or cross-instance cache coordination justifies them. The remaining measured ceiling is external/runtime infrastructure and workload realism, not a known unoptimized PostgreSQL query in the tested dataset.
