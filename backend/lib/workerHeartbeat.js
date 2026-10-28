/*
 * Best-effort worker heartbeat writes.
 * These helpers must never be allowed to break a worker loop.
 */

const MAX_ERROR_LENGTH = 2000;

function truncate(value, max = MAX_ERROR_LENGTH) {
  const text = String(value || "");
  return text.length > max ? `${text.slice(0, max)}...[truncated]` : text;
}

function errorMessage(error) {
  if (!error) return null;
  if (error.stack) return truncate(error.stack);
  if (error.message) return truncate(error.message);
  return truncate(error);
}

async function ensureWorkerHeartbeatTable(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS worker_heartbeats (
      worker_name text PRIMARY KEY,
      last_started_at timestamptz,
      last_success_at timestamptz,
      last_failure_at timestamptz,
      last_error text,
      last_duration_ms integer,
      last_rows bigint,
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);
}

async function writeWorkerHeartbeat(pool, workerName, fields) {
  if (!pool || !workerName) return false;
  try {
    await ensureWorkerHeartbeatTable(pool);
    await pool.query(
      `
        INSERT INTO worker_heartbeats (
          worker_name,
          last_started_at,
          last_success_at,
          last_failure_at,
          last_error,
          last_duration_ms,
          last_rows,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, now())
        ON CONFLICT (worker_name) DO UPDATE SET
          last_started_at = COALESCE(EXCLUDED.last_started_at, worker_heartbeats.last_started_at),
          last_success_at = COALESCE(EXCLUDED.last_success_at, worker_heartbeats.last_success_at),
          last_failure_at = COALESCE(EXCLUDED.last_failure_at, worker_heartbeats.last_failure_at),
          last_error = COALESCE(EXCLUDED.last_error, worker_heartbeats.last_error),
          last_duration_ms = COALESCE(EXCLUDED.last_duration_ms, worker_heartbeats.last_duration_ms),
          last_rows = COALESCE(EXCLUDED.last_rows, worker_heartbeats.last_rows),
          updated_at = now()
      `,
      [
        workerName,
        fields.last_started_at || null,
        fields.last_success_at || null,
        fields.last_failure_at || null,
        fields.last_error ?? null,
        Number.isFinite(fields.last_duration_ms) ? Math.round(fields.last_duration_ms) : null,
        Number.isFinite(fields.last_rows) ? Math.round(fields.last_rows) : null,
      ]
    );
    return true;
  } catch (err) {
    console.warn(`[observability] worker heartbeat skipped for ${workerName}:`, err.message);
    return false;
  }
}

function markWorkerStarted(pool, workerName) {
  return writeWorkerHeartbeat(pool, workerName, {
    last_started_at: new Date(),
  });
}

function markWorkerSuccess(pool, workerName, details = {}) {
  return writeWorkerHeartbeat(pool, workerName, {
    last_success_at: new Date(),
    last_duration_ms: Number(details.durationMs),
    last_rows: Number(details.rows),
    last_error: "",
  });
}

function markWorkerFailure(pool, workerName, error, details = {}) {
  return writeWorkerHeartbeat(pool, workerName, {
    last_failure_at: new Date(),
    last_duration_ms: Number(details.durationMs),
    last_error: errorMessage(error) || "Unknown worker failure",
  });
}

module.exports = {
  ensureWorkerHeartbeatTable,
  errorMessage,
  markWorkerFailure,
  markWorkerStarted,
  markWorkerSuccess,
  writeWorkerHeartbeat,
};
