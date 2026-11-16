import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const action = process.argv[2];
if (!new Set(["start", "stop"]).has(action)) {
  console.error("Usage: npm run db:start | npm run db:stop");
  process.exit(1);
}

const run = (file, args) => {
  execFileSync(file, args, { stdio: "inherit", windowsHide: true });
};

if (process.platform === "win32") {
  const serviceName = process.env.POSTGRES_SERVICE_NAME || "postgresql-x64-16";
  const query = (() => {
    try {
      return execFileSync("sc.exe", ["query", serviceName], {
        encoding: "utf8",
        windowsHide: true,
      });
    } catch {
      return null;
    }
  })();
  if (query) {
    const isRunning = /STATE\s+:\s+\d+\s+RUNNING/i.test(query);

    if (action === "start" && !isRunning) run("sc.exe", ["start", serviceName]);
    if (action === "stop" && isRunning) run("sc.exe", ["stop", serviceName]);
    process.exit(0);
  }

  const installDir = process.env.POSTGRES_INSTALL_DIR || "C:\\Program Files\\PostgreSQL\\16";
  const pgCtl = join(installDir, "bin", "pg_ctl.exe");
  const dataDir = process.env.POSTGRES_DATA_DIR || join(installDir, "data");
  if (!existsSync(pgCtl) || !existsSync(dataDir)) {
    console.error(`PostgreSQL Windows service not found: ${serviceName}`);
    console.error("Install PostgreSQL 16 natively, then retry.");
    process.exit(1);
  }

  let isRunning = false;
  try {
    execFileSync(pgCtl, ["status", "-D", dataDir], {
      stdio: "ignore",
      windowsHide: true,
    });
    isRunning = true;
  } catch {
    isRunning = false;
  }

  if (action === "start" && !isRunning) {
    run(pgCtl, ["start", "-D", dataDir, "-l", join(dataDir, "native-start.log"), "-w", "-t", "60"]);
  }
  if (action === "stop" && isRunning) run(pgCtl, ["stop", "-D", dataDir, "-m", "fast", "-w"]);
  process.exit(0);
}

const serviceName = process.env.POSTGRES_SERVICE_NAME || "postgresql";
const isRunning = (() => {
  try {
    execFileSync("systemctl", ["is-active", "--quiet", serviceName], {
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
})();

if (action === "start" && !isRunning) run("systemctl", ["start", serviceName]);
if (action === "stop" && isRunning) run("systemctl", ["stop", serviceName]);
