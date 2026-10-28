const { execFileSync } = require("child_process");

function docker(args) {
  return execFileSync("docker", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function dockerAvailable() {
  try {
    docker(["version", "--format", "{{.Server.Version}}"]);
    return true;
  } catch {
    return false;
  }
}

function parseDockerPort(output) {
  const line = String(output || "").split(/\r?\n/).find(Boolean);
  const match = line && line.match(/:(\d+)\s*$/);
  return match ? Number(match[1]) : null;
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function requirePg() {
  try {
    return require("pg");
  } catch (err) {
    if (err && err.code === "MODULE_NOT_FOUND") {
      throw new Error("pg dependency is not installed; run npm install before integration tests");
    }
    throw err;
  }
}

async function waitForPostgres(databaseUrl, timeoutMs = 30_000) {
  const { Pool } = requirePg();
  const started = Date.now();
  let lastError = null;

  while (Date.now() - started < timeoutMs) {
    const pool = new Pool({ connectionString: databaseUrl });
    try {
      await pool.query("SELECT 1");
      await pool.end();
      return;
    } catch (err) {
      lastError = err;
      await pool.end().catch(() => {});
      await sleep(500);
    }
  }

  throw lastError || new Error("timed out waiting for Postgres");
}

async function startDisposablePostgres() {
  if (!dockerAvailable()) {
    throw new Error("Docker is not available; disposable Postgres integration tests skipped");
  }

  requirePg();

  const name = `trifftools-test-postgres-${process.pid}-${Date.now()}`;
  docker([
    "run",
    "--rm",
    "-d",
    "--name",
    name,
    "-e",
    "POSTGRES_DB=trifftest",
    "-e",
    "POSTGRES_USER=user",
    "-e",
    "POSTGRES_PASSWORD=pass",
    "-p",
    "127.0.0.1::5432",
    "postgres:16",
  ]);

  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    try {
      docker(["rm", "-f", name]);
    } catch {
      // Best-effort cleanup for test teardown.
    }
  };

  try {
    const port = parseDockerPort(docker(["port", name, "5432/tcp"]));
    if (!port) throw new Error("could not determine mapped Postgres port");
    const databaseUrl = `postgres://user:pass@127.0.0.1:${port}/trifftest`;
    await waitForPostgres(databaseUrl);
    return { name, databaseUrl, stop };
  } catch (err) {
    stop();
    throw err;
  }
}

module.exports = { startDisposablePostgres };
