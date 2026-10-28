const pool = require("../db/pool");
const siteAuth = require("./siteAuth");
const { ensureTriffLocalSchema } = require("./triffLocal");

const VALID_KINDS = new Set(["appraisal", "battle_report", "combat_log_report", "triff_local_report"]);

let schemaReady = false;
let schemaPromise = null;

async function ensureAccountLinksSchema() {
  if (schemaReady) return;
  if (!schemaPromise) {
    schemaPromise = (async () => {
      await siteAuth.ensureAuthSchema();
      await pool.query(`
        CREATE TABLE IF NOT EXISTS account_generated_links (
          user_id BIGINT NOT NULL REFERENCES anoikis_command_users(id) ON DELETE CASCADE,
          kind TEXT NOT NULL CHECK (kind IN ('appraisal', 'battle_report', 'combat_log_report', 'triff_local_report')),
          target_id TEXT NOT NULL,
          display_name TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          PRIMARY KEY (user_id, kind, target_id)
        );

        ALTER TABLE account_generated_links
          ADD COLUMN IF NOT EXISTS display_name TEXT;

        ALTER TABLE account_generated_links
          DROP CONSTRAINT IF EXISTS account_generated_links_kind_check;

        ALTER TABLE account_generated_links
          ADD CONSTRAINT account_generated_links_kind_check
          CHECK (kind IN ('appraisal', 'battle_report', 'combat_log_report', 'triff_local_report'));

        CREATE INDEX IF NOT EXISTS idx_account_generated_links_user_kind_created
          ON account_generated_links (user_id, kind, created_at DESC);
      `);
      schemaReady = true;
    })().catch((err) => {
      schemaPromise = null;
      throw err;
    });
  }
  await schemaPromise;
}

async function recordAccountGeneratedLink(userId, kind, targetId) {
  const id = String(targetId || "").trim();
  if (!userId || !VALID_KINDS.has(kind) || !id) return;
  await ensureAccountLinksSchema();
  await pool.query(
    `
    INSERT INTO account_generated_links (user_id, kind, target_id)
    VALUES ($1, $2, $3)
    ON CONFLICT (user_id, kind, target_id) DO NOTHING
    `,
    [userId, kind, id]
  );
}

async function listAccountGeneratedLinks(userId, limit = 50) {
  await ensureAccountLinksSchema();
  await ensureTriffLocalSchema();
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 100);

  const [appraisals, battleReports, combatLogReports, triffLocalReports] = await Promise.all([
    pool.query(
      `
      SELECT
        a.id,
        a.created_at,
        a.station_id,
        a.mode,
        a.totals,
        jsonb_array_length(COALESCE(a.rows, '[]'::jsonb)) AS row_count,
        l.display_name,
        l.created_at AS linked_at
      FROM account_generated_links l
      JOIN appraisals a ON a.id = l.target_id
      WHERE l.user_id = $1
        AND l.kind = 'appraisal'
      ORDER BY COALESCE(l.created_at, a.created_at) DESC
      LIMIT $2
      `,
      [userId, safeLimit]
    ),
    pool.query(
      `
      SELECT
        b.id,
        b.title,
        b.created_at,
        b.updated_at,
        b.system_id,
        b.system_name,
        b.start_time,
        b.end_time,
        b.summary,
        l.display_name,
        l.created_at AS linked_at
      FROM account_generated_links l
      JOIN battle_reports b ON b.id = l.target_id
      WHERE l.user_id = $1
        AND l.kind = 'battle_report'
      ORDER BY COALESCE(l.created_at, b.created_at) DESC
      LIMIT $2
      `,
      [userId, safeLimit]
    ),
    pool.query(
      `
      SELECT
        c.id,
        c.title,
        c.created_at,
        c.updated_at,
        c.file_name,
        c.listener,
        c.session_started_at,
        c.start_time,
        c.end_time,
        c.summary,
        l.display_name,
        l.created_at AS linked_at
      FROM account_generated_links l
      JOIN combat_log_reports c ON c.id = l.target_id
      WHERE l.user_id = $1
        AND l.kind = 'combat_log_report'
      ORDER BY COALESCE(l.created_at, c.created_at) DESC
      LIMIT $2
      `,
      [userId, safeLimit]
    ),
    pool.query(
      `
      SELECT
        t.id,
        t.title,
        t.created_at,
        t.summary,
        jsonb_array_length(COALESCE(t.report->'characters', '[]'::jsonb)) AS character_count,
        l.display_name,
        l.created_at AS linked_at
      FROM account_generated_links l
      JOIN triff_local_reports t ON t.id = l.target_id
      WHERE l.user_id = $1
        AND l.kind = 'triff_local_report'
      ORDER BY COALESCE(l.created_at, t.created_at) DESC
      LIMIT $2
      `,
      [userId, safeLimit]
    ),
  ]);

  return {
    appraisals: appraisals.rows.map((row) => ({
      id: row.id,
      url: `/appraisals/${row.id}`,
      display_name: row.display_name || null,
      created_at: row.created_at,
      linked_at: row.linked_at,
      station_id: row.station_id,
      mode: row.mode,
      totals: row.totals || {},
      row_count: Number(row.row_count || 0),
    })),
    battle_reports: battleReports.rows.map((row) => ({
      id: row.id,
      url: `/br/${row.id}`,
      display_name: row.display_name || null,
      title: row.title,
      created_at: row.created_at,
      updated_at: row.updated_at,
      linked_at: row.linked_at,
      system_id: row.system_id,
      system_name: row.system_name,
      start_time: row.start_time,
      end_time: row.end_time,
      summary: row.summary || {},
    })),
    combat_log_reports: combatLogReports.rows.map((row) => ({
      id: row.id,
      url: `/combat-logs/${row.id}`,
      display_name: row.display_name || null,
      title: row.title,
      created_at: row.created_at,
      updated_at: row.updated_at,
      linked_at: row.linked_at,
      file_name: row.file_name,
      listener: row.listener,
      session_started_at: row.session_started_at,
      start_time: row.start_time,
      end_time: row.end_time,
      summary: row.summary || {},
    })),
    triff_local_reports: triffLocalReports.rows.map((row) => ({
      id: row.id,
      url: `/triff-local/${row.id}`,
      display_name: row.display_name || null,
      title: row.title,
      created_at: row.created_at,
      linked_at: row.linked_at,
      summary: row.summary || {},
      character_count: Number(row.character_count || row.summary?.characterCount || 0),
    })),
  };
}

async function removeAccountGeneratedLink(userId, kind, targetId) {
  const id = String(targetId || "").trim();
  if (!userId || !VALID_KINDS.has(kind) || !id) return false;
  await ensureAccountLinksSchema();
  const result = await pool.query(
    `
    DELETE FROM account_generated_links
    WHERE user_id = $1
      AND kind = $2
      AND target_id = $3
    `,
    [userId, kind, id]
  );
  return result.rowCount > 0;
}

async function renameAccountGeneratedLink(userId, kind, targetId, displayName) {
  const id = String(targetId || "").trim();
  const name = String(displayName || "").trim().slice(0, 180);
  if (!userId || !VALID_KINDS.has(kind) || !id || !name) return null;
  await ensureAccountLinksSchema();
  const { rows } = await pool.query(
    `
    UPDATE account_generated_links
    SET display_name = $4
    WHERE user_id = $1
      AND kind = $2
      AND target_id = $3
    RETURNING user_id, kind, target_id, display_name, created_at
    `,
    [userId, kind, id, name]
  );
  return rows[0] || null;
}

module.exports = {
  ensureAccountLinksSchema,
  recordAccountGeneratedLink,
  listAccountGeneratedLinks,
  removeAccountGeneratedLink,
  renameAccountGeneratedLink,
  _test: {
    VALID_KINDS,
  },
};
