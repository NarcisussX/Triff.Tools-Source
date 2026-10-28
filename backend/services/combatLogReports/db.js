const { pool } = require("../../db");

let ensured = false;

function jsonb(value, fallback) {
  return JSON.stringify(value ?? fallback);
}

async function ensureCombatLogReportSchema() {
  if (ensured) return;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS combat_log_reports (
      id TEXT PRIMARY KEY,
      title TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      file_name TEXT,
      listener TEXT,
      session_started_at TIMESTAMPTZ,
      start_time TIMESTAMPTZ,
      end_time TIMESTAMPTZ,
      summary JSONB NOT NULL DEFAULT '{}',
      data JSONB NOT NULL DEFAULT '{}'
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_combat_log_reports_created_at
      ON combat_log_reports (created_at DESC);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_combat_log_reports_time
      ON combat_log_reports (start_time DESC, end_time DESC);
  `);

  ensured = true;
}

function rowToReport(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    created_at: row.created_at,
    updated_at: row.updated_at,
    file_name: row.file_name,
    listener: row.listener,
    session_started_at: row.session_started_at,
    start_time: row.start_time,
    end_time: row.end_time,
    summary: row.summary || {},
    data: row.data || {},
  };
}

async function saveCombatLogReport(report) {
  await ensureCombatLogReportSchema();
  const { rows } = await pool.query(
    `
    INSERT INTO combat_log_reports (
      id,
      title,
      file_name,
      listener,
      session_started_at,
      start_time,
      end_time,
      summary,
      data
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb)
    ON CONFLICT (id) DO UPDATE SET
      title = EXCLUDED.title,
      file_name = EXCLUDED.file_name,
      listener = EXCLUDED.listener,
      session_started_at = EXCLUDED.session_started_at,
      start_time = EXCLUDED.start_time,
      end_time = EXCLUDED.end_time,
      summary = EXCLUDED.summary,
      data = EXCLUDED.data,
      updated_at = now()
    RETURNING *
    `,
    [
      report.id,
      report.title || null,
      report.fileName || null,
      report.listener || null,
      report.sessionStartedAt || null,
      report.startTime || null,
      report.endTime || null,
      jsonb(report.summary, {}),
      jsonb(report.data, {}),
    ]
  );
  return rowToReport(rows[0]);
}

async function getCombatLogReport(id) {
  await ensureCombatLogReportSchema();
  const { rows } = await pool.query(
    `SELECT * FROM combat_log_reports WHERE id = $1`,
    [id]
  );
  return rowToReport(rows[0]);
}

module.exports = {
  ensureCombatLogReportSchema,
  saveCombatLogReport,
  getCombatLogReport,
};
