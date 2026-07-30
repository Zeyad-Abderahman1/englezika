import { execFile, spawn } from 'node:child_process';
import { pbkdf2Sync, randomBytes, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';

if (process.env.TEST_BASE_URL) {
  await import('./live-platform-e2e.mjs');
  process.exit(0);
}

const port = 4300 + Math.floor(Math.random() * 500);
const baseUrl = `http://127.0.0.1:${port}`;
const teacherEmail = `e2e-bootstrap-${randomUUID().slice(0, 8)}@example.test`;
const teacherPassword = 'TestTeacher!2026';
const salt = randomBytes(16).toString('hex');
const passwordHash = pbkdf2Sync(
  teacherPassword,
  Buffer.from(salt, 'hex'),
  100_000,
  32,
  'sha256'
).toString('hex');
const serverEnvironment = {
  ...process.env,
  NODE_ENV: 'development',
  E2E_TEST_MODE: 'true',
  EMAIL_TEST_MODE: 'true',
  VERIFICATION_SECRET: randomBytes(32).toString('hex'),
  VIDEO_RESOLVE_SECRET: randomBytes(32).toString('hex'),
  INITIAL_STAFF_EMAIL: teacherEmail,
  INITIAL_STAFF_NAME: 'E2E Bootstrap Teacher',
  INITIAL_STAFF_PASSWORD_HASH: passwordHash,
  INITIAL_STAFF_PASSWORD_SALT: salt,
  INITIAL_STAFF_PASSWORD_ITERATIONS: '100000',
};
if (!serverEnvironment.DATABASE_URL) {
  throw new Error('DATABASE_URL is required for the PostgreSQL E2E test');
}
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error('npm_execpath is unavailable; run this test through npm run test:e2e');
const projectDir = fileURLToPath(new URL('..', import.meta.url));

await new Promise((resolve, reject) => {
  execFile(process.execPath, [npmCli, 'run', 'db:migrate:local'], {
    cwd: projectDir,
    env: serverEnvironment,
    windowsHide: true,
  }, (error, stdout, stderr) => {
    if (error) reject(new Error(`Failed to prepare the E2E database.\n${stdout}\n${stderr}`));
    else resolve();
  });
});

const database = new Client({ connectionString: serverEnvironment.DATABASE_URL });
await database.connect();
const now = Date.now();
await database.query(
  `INSERT INTO staff_users
   (email, name, role, permissions, password_hash, password_salt, password_iterations,
    active, failed_attempts, locked_until, created_by, created_at, updated_at)
   VALUES ($1, 'E2E Bootstrap Teacher', 'teacher', '[]', $2, $3, 100000, 1, 0,
    NULL, 'e2e-test', $4, $4)
   ON CONFLICT (email) DO UPDATE SET
    password_hash = EXCLUDED.password_hash,
    password_salt = EXCLUDED.password_salt,
    password_iterations = EXCLUDED.password_iterations,
    active = 1,
    updated_at = EXCLUDED.updated_at`,
  [teacherEmail, passwordHash, salt, now]
);
await database.end();
const server = spawn(
  process.execPath,
  [npmCli, 'run', 'dev', '--', '--port', String(port)],
  {
    cwd: projectDir,
    env: serverEnvironment,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
    windowsHide: true,
  }
);
let serverOutput = '';
const collectOutput = (chunk) => {
  serverOutput = `${serverOutput}${chunk}`.slice(-20_000);
};
server.stdout.on('data', collectOutput);
server.stderr.on('data', collectOutput);

function waitForServerExit(timeoutMs) {
  if (server.exitCode !== null) return Promise.resolve(true);

  return new Promise((resolve) => {
    const onExit = () => {
      clearTimeout(timeout);
      resolve(true);
    };
    const timeout = setTimeout(() => {
      server.off('exit', onExit);
      resolve(server.exitCode !== null);
    }, timeoutMs);

    server.once('exit', onExit);
  });
}

async function stopServer() {
  if (server.exitCode !== null) return;
  if (process.platform === 'win32') {
    await new Promise((resolve) => {
      execFile('taskkill', ['/pid', String(server.pid), '/t', '/f'], () => resolve());
    });
    return;
  }

  const serverPid = server.pid;
  if (!serverPid) return;

  try {
    process.kill(-serverPid, 'SIGTERM');
  } catch {
    server.kill('SIGTERM');
  }
  if (await waitForServerExit(5_000)) return;

  try {
    process.kill(-serverPid, 'SIGKILL');
  } catch {
    server.kill('SIGKILL');
  }
  await waitForServerExit(5_000);
}

try {
  const deadline = Date.now() + 60_000;
  let ready = false;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error(`E2E server exited before startup.\n${serverOutput}`);
    }
    try {
      const response = await fetch(`${baseUrl}/api/ready`);
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {
      // Server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!ready) throw new Error(`E2E server did not become ready.\n${serverOutput}`);

  process.env.TEST_BASE_URL = baseUrl;
  process.env.TEST_TEACHER_EMAIL = teacherEmail;
  process.env.TEST_TEACHER_PASSWORD = teacherPassword;
  await import(`./live-platform-e2e.mjs?run=${Date.now()}`);
} finally {
  await stopServer();
}
