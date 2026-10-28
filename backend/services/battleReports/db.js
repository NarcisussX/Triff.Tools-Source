/*
 * Backend service module for db.
 * Coordinates database records, external EVE data, or derived results for route handlers.
 */

const { pool } = require("../../db");

let ensured = false;

const LIVE_GRACE_MINUTES = Math.max(0, Number(process.env.BR_LIVE_GRACE_MINUTES || 30));

function jsonb(value, fallback) {
  return JSON.stringify(value ?? fallback);
}

function reportScopes(report = {}) {
  const discovered = report?.data?.discovery?.scopes;
  const rows = Array.isArray(discovered) ? discovered : [];
  const scopes = rows
    .map((scope, index) => ({
      scope_index: index,
      system_id: Number(scope.systemId || scope.system_id || scope.id),
      system_name: scope.systemName || scope.system_name || scope.name || null,
      start_time: scope.startTime || scope.start_time || scope.start || null,
      end_time: scope.endTime || scope.end_time || scope.end || null,
    }))
    .filter((scope) => Number.isFinite(scope.system_id) && scope.start_time && scope.end_time);

  if (Array.isArray(discovered)) return scopes;
  if (!Number.isFinite(Number(report.system_id)) || !report.start_time || !report.end_time) return [];
  return [{
    scope_index: 0,
    system_id: Number(report.system_id),
    system_name: report.system_name || null,
    start_time: report.start_time,
    end_time: report.end_time,
  }];
}

function liveStateForScopes(scopes, now = new Date()) {
  if (!scopes.length) return { status: "final", liveUntil: null };
  const starts = scopes.map((scope) => new Date(scope.start_time).getTime()).filter(Number.isFinite);
  const ends = scopes.map((scope) => new Date(scope.end_time).getTime()).filter(Number.isFinite);
  if (!starts.length || !ends.length) return { status: "final", liveUntil: null };

  const firstStart = Math.min(...starts);
  const liveUntilMs = Math.max(...ends) + LIVE_GRACE_MINUTES * 60 * 1000;
  const nowMs = now.getTime();
  return {
    status: nowMs < firstStart ? "scheduled" : (nowMs <= liveUntilMs ? "live" : "final"),
    liveUntil: new Date(liveUntilMs).toISOString(),
  };
}

async function replaceBattleReportScopes(client, report) {
  const scopes = reportScopes(report);
  await client.query(`DELETE FROM battle_report_scopes WHERE battle_report_id = $1`, [report.id]);
  for (const scope of scopes) {
    await client.query(
      `
      INSERT INTO battle_report_scopes (
        battle_report_id, scope_index, system_id, system_name, start_time, end_time, live_until
      ) VALUES ($1,$2,$3,$4,$5,$6,$6::timestamptz + ($7::double precision * interval '1 minute'))
      `,
      [
        report.id,
        scope.scope_index,
        scope.system_id,
        scope.system_name,
        scope.start_time,
        scope.end_time,
        LIVE_GRACE_MINUTES,
      ]
    );
  }
  return scopes;
}

async function ensureBattleReportSchema() {
  if (ensured) return;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS br_killmail_cache (
      killmail_id BIGINT PRIMARY KEY,
      killmail_hash TEXT,
      killmail_time TIMESTAMPTZ,
      solar_system_id BIGINT,
      victim_character_id BIGINT,
      victim_corporation_id BIGINT,
      victim_alliance_id BIGINT,
      victim_ship_type_id BIGINT,
      total_value NUMERIC,
      sequence_id BIGINT,
      raw_esi JSONB NOT NULL,
      raw_zkb JSONB NOT NULL DEFAULT '{}',
      fetched_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_br_killmail_cache_system_time
      ON br_killmail_cache (solar_system_id, killmail_time DESC);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_br_killmail_cache_fetched_at
      ON br_killmail_cache (fetched_at);
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS battle_reports (
      id TEXT PRIMARY KEY,
      title TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      system_id BIGINT,
      system_name TEXT,
      start_time TIMESTAMPTZ,
      end_time TIMESTAMPTZ,
      value_mode TEXT NOT NULL DEFAULT 'zkill',
      source_mode TEXT,
      summary JSONB NOT NULL DEFAULT '{}',
      sides JSONB NOT NULL DEFAULT '[]',
      entities JSONB NOT NULL DEFAULT '[]',
      side_overrides JSONB NOT NULL DEFAULT '{}',
      side_names JSONB NOT NULL DEFAULT '{}',
      data JSONB NOT NULL DEFAULT '{}'
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_battle_reports_created_at
      ON battle_reports (created_at DESC);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_battle_reports_system_time
      ON battle_reports (system_id, start_time DESC);
  `);

  await pool.query(`
    ALTER TABLE battle_reports ADD COLUMN IF NOT EXISTS revision BIGINT NOT NULL DEFAULT 1;
    ALTER TABLE battle_reports ADD COLUMN IF NOT EXISTS live_status TEXT NOT NULL DEFAULT 'final';
    ALTER TABLE battle_reports ADD COLUMN IF NOT EXISTS live_until TIMESTAMPTZ;
    ALTER TABLE battle_reports ADD COLUMN IF NOT EXISTS live_last_update_at TIMESTAMPTZ;
    ALTER TABLE battle_reports ADD COLUMN IF NOT EXISTS live_latest_sequence BIGINT NOT NULL DEFAULT 0;
    ALTER TABLE battle_reports ADD COLUMN IF NOT EXISTS live_processed_sequence BIGINT NOT NULL DEFAULT 0;
    ALTER TABLE battle_reports ADD COLUMN IF NOT EXISTS live_change_token BIGINT NOT NULL DEFAULT 0;
    ALTER TABLE battle_reports ADD COLUMN IF NOT EXISTS live_processed_token BIGINT NOT NULL DEFAULT 0;
    ALTER TABLE battle_reports ADD COLUMN IF NOT EXISTS live_dirty_since TIMESTAMPTZ;
    ALTER TABLE battle_reports ADD COLUMN IF NOT EXISTS live_last_event_at TIMESTAMPTZ;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS battle_report_scopes (
      battle_report_id TEXT NOT NULL REFERENCES battle_reports(id) ON DELETE CASCADE,
      scope_index INTEGER NOT NULL,
      system_id BIGINT NOT NULL,
      system_name TEXT,
      start_time TIMESTAMPTZ NOT NULL,
      end_time TIMESTAMPTZ NOT NULL,
      live_until TIMESTAMPTZ NOT NULL,
      last_reconcile_attempt_at TIMESTAMPTZ,
      last_reconciled_at TIMESTAMPTZ,
      final_reconciled BOOLEAN NOT NULL DEFAULT false,
      reconciliation_error TEXT,
      PRIMARY KEY (battle_report_id, scope_index)
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_battle_report_scopes_live_match
      ON battle_report_scopes (system_id, start_time, end_time, live_until);
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS battle_report_killmails (
      battle_report_id TEXT NOT NULL REFERENCES battle_reports(id) ON DELETE CASCADE,
      killmail_id BIGINT NOT NULL,
      killmail_time TIMESTAMPTZ,
      solar_system_id BIGINT,
      total_value NUMERIC,
      raw_esi JSONB NOT NULL,
      raw_zkb JSONB NOT NULL DEFAULT '{}',
      PRIMARY KEY (battle_report_id, killmail_id)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS br_ingest_state (
      source TEXT PRIMARY KEY,
      cursor_value BIGINT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  const { rows: missingScopeRows } = await pool.query(`
    SELECT b.*
    FROM battle_reports b
    WHERE NOT EXISTS (
      SELECT 1 FROM battle_report_scopes s WHERE s.battle_report_id = b.id
    )
  `);
  for (const report of missingScopeRows) {
    const scopes = reportScopes(report);
    if (!scopes.length) continue;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await replaceBattleReportScopes(client, report);
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  await pool.query(`
    UPDATE battle_reports b
    SET
      live_until = scoped.live_until,
      live_status = CASE
        WHEN now() < scoped.first_start THEN 'scheduled'
        WHEN now() <= scoped.live_until THEN 'live'
        WHEN b.live_status IN ('scheduled', 'live') AND EXISTS (
          SELECT 1 FROM battle_report_scopes pending
          WHERE pending.battle_report_id = b.id AND pending.final_reconciled = false
        ) THEN 'live'
        ELSE 'final'
      END
    FROM (
      SELECT battle_report_id, MIN(start_time) AS first_start, MAX(live_until) AS live_until
      FROM battle_report_scopes
      GROUP BY battle_report_id
    ) scoped
    WHERE b.id = scoped.battle_report_id
  `);

  ensured = true;
}

async function getR2Z2Cursor(source = "default") {
  await ensureBattleReportSchema();

  const { rows } = await pool.query(
    `
    SELECT cursor_value
    FROM br_ingest_state
    WHERE source = $1
    LIMIT 1
    `,
    [source]
  );

  const value = Number(rows[0]?.cursor_value);
  return Number.isFinite(value) && value > 0 ? value : null;
}

async function setR2Z2Cursor(source = "default", cursorValue) {
  await ensureBattleReportSchema();

  const value = Number(cursorValue);
  if (!Number.isFinite(value) || value <= 0) return;

  await pool.query(
    `
    INSERT INTO br_ingest_state (source, cursor_value, updated_at)
    VALUES ($1, $2, now())
    ON CONFLICT (source) DO UPDATE SET
      cursor_value = EXCLUDED.cursor_value,
      updated_at = now()
    `,
    [source, Math.floor(value)]
  );
}

function readZkbTotal(rawZkb = {}) {
  const candidates = [
    rawZkb?.zkb?.totalValue,
    rawZkb?.zkb?.total_value,
    rawZkb?.totalValue,
    rawZkb?.total_value,
    rawZkb?.zkb_total_value,
    rawZkb?.value,
    rawZkb?.totalValueDestroyed,
  ];
  for (const val of candidates) {
    const n = Number(val);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return 0;
}

async function upsertKillmailCache({ esi, zkb = {}, hash = null, sequenceId = null }) {
  if (!esi || !esi.killmail_id) return;
  await ensureBattleReportSchema();

  const victim = esi.victim || {};
  const totalValue = readZkbTotal(zkb);

  const { rows } = await pool.query(
    `
    INSERT INTO br_killmail_cache (
      killmail_id,
      killmail_hash,
      killmail_time,
      solar_system_id,
      victim_character_id,
      victim_corporation_id,
      victim_alliance_id,
      victim_ship_type_id,
      total_value,
      sequence_id,
      raw_esi,
      raw_zkb,
      fetched_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb,now())
    ON CONFLICT (killmail_id) DO UPDATE SET
      killmail_hash = COALESCE(EXCLUDED.killmail_hash, br_killmail_cache.killmail_hash),
      killmail_time = EXCLUDED.killmail_time,
      solar_system_id = EXCLUDED.solar_system_id,
      victim_character_id = EXCLUDED.victim_character_id,
      victim_corporation_id = EXCLUDED.victim_corporation_id,
      victim_alliance_id = EXCLUDED.victim_alliance_id,
      victim_ship_type_id = EXCLUDED.victim_ship_type_id,
      total_value = CASE
        WHEN EXCLUDED.raw_zkb->>'_triff_value_source' = 'zkill' AND COALESCE(EXCLUDED.total_value, 0) > 0
          THEN EXCLUDED.total_value
        WHEN br_killmail_cache.raw_zkb->>'_triff_value_source' = 'zkill' AND COALESCE(br_killmail_cache.total_value, 0) > 0
          THEN br_killmail_cache.total_value
        WHEN COALESCE(EXCLUDED.total_value, 0) > 0
          THEN EXCLUDED.total_value
        ELSE br_killmail_cache.total_value
      END,
      sequence_id = COALESCE(EXCLUDED.sequence_id, br_killmail_cache.sequence_id),
      raw_esi = CASE
        WHEN br_killmail_cache.raw_zkb->>'_triff_ingest_source' = 'zkill-r2z2'
          AND EXCLUDED.raw_zkb->>'_triff_ingest_source' IS DISTINCT FROM 'zkill-r2z2'
          THEN br_killmail_cache.raw_esi
        ELSE EXCLUDED.raw_esi
      END,
      raw_zkb = CASE
        WHEN EXCLUDED.raw_zkb = '{}'::jsonb THEN br_killmail_cache.raw_zkb
        WHEN br_killmail_cache.raw_zkb->>'_triff_ingest_source' = 'zkill-r2z2'
          AND EXCLUDED.raw_zkb->>'_triff_ingest_source' IS DISTINCT FROM 'zkill-r2z2'
          THEN br_killmail_cache.raw_zkb
        ELSE EXCLUDED.raw_zkb
      END,
      fetched_at = now()
    RETURNING *
    `,
    [
      esi.killmail_id,
      hash,
      esi.killmail_time,
      esi.solar_system_id,
      victim.character_id || null,
      victim.corporation_id || null,
      victim.alliance_id || null,
      victim.ship_type_id || null,
      totalValue,
      sequenceId,
      jsonb(esi, {}),
      jsonb(zkb, {}),
    ]
  );
  return rows[0] || null;
}

async function getCachedKillmail(killmailId) {
  await ensureBattleReportSchema();
  const { rows } = await pool.query(
    `SELECT * FROM br_killmail_cache WHERE killmail_id = $1`,
    [killmailId]
  );
  return rows[0] || null;
}

async function getCachedBySystemWindow(systemId, startTime, endTime) {
  await ensureBattleReportSchema();
  const { rows } = await pool.query(
    `
    SELECT *
    FROM br_killmail_cache
    WHERE solar_system_id = $1
      AND killmail_time >= $2
      AND killmail_time <= $3
    ORDER BY killmail_time ASC
    `,
    [systemId, startTime, endTime]
  );
  return rows;
}

async function upsertReportKillmails(client, reportId, kills) {
  let changed = 0;
  let added = 0;
  for (const kill of kills || []) {
    const esi = kill?.esi || kill?.raw_esi;
    if (!esi?.killmail_id) continue;
    const zkb = kill?.zkb || kill?.raw_zkb || {};
    const totalValue = Number(kill?.totalValue ?? kill?.total_value ?? readZkbTotal(zkb)) || 0;
    const { rows } = await client.query(
      `
      INSERT INTO battle_report_killmails (
        battle_report_id, killmail_id, killmail_time, solar_system_id, total_value, raw_esi, raw_zkb
      ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb)
      ON CONFLICT (battle_report_id, killmail_id) DO UPDATE SET
        killmail_time = EXCLUDED.killmail_time,
        solar_system_id = EXCLUDED.solar_system_id,
        total_value = CASE
          WHEN EXCLUDED.raw_zkb->>'_triff_value_source' = 'zkill' AND EXCLUDED.total_value > 0 THEN EXCLUDED.total_value
          WHEN battle_report_killmails.raw_zkb->>'_triff_value_source' = 'zkill' AND battle_report_killmails.total_value > 0 THEN battle_report_killmails.total_value
          WHEN EXCLUDED.total_value > 0 THEN EXCLUDED.total_value
          ELSE battle_report_killmails.total_value
        END,
        raw_esi = CASE
          WHEN battle_report_killmails.raw_zkb->>'_triff_ingest_source' = 'zkill-r2z2'
            AND EXCLUDED.raw_zkb->>'_triff_ingest_source' IS DISTINCT FROM 'zkill-r2z2'
            THEN battle_report_killmails.raw_esi
          ELSE EXCLUDED.raw_esi
        END,
        raw_zkb = CASE
          WHEN EXCLUDED.raw_zkb = '{}'::jsonb THEN battle_report_killmails.raw_zkb
          WHEN battle_report_killmails.raw_zkb->>'_triff_ingest_source' = 'zkill-r2z2'
            AND EXCLUDED.raw_zkb->>'_triff_ingest_source' IS DISTINCT FROM 'zkill-r2z2'
            THEN battle_report_killmails.raw_zkb
          ELSE EXCLUDED.raw_zkb
        END
      WHERE
        battle_report_killmails.killmail_time IS DISTINCT FROM EXCLUDED.killmail_time
        OR battle_report_killmails.solar_system_id IS DISTINCT FROM EXCLUDED.solar_system_id
        OR battle_report_killmails.total_value IS DISTINCT FROM CASE
          WHEN EXCLUDED.raw_zkb->>'_triff_value_source' = 'zkill' AND EXCLUDED.total_value > 0 THEN EXCLUDED.total_value
          WHEN battle_report_killmails.raw_zkb->>'_triff_value_source' = 'zkill' AND battle_report_killmails.total_value > 0 THEN battle_report_killmails.total_value
          WHEN EXCLUDED.total_value > 0 THEN EXCLUDED.total_value
          ELSE battle_report_killmails.total_value
        END
        OR battle_report_killmails.raw_esi IS DISTINCT FROM CASE
          WHEN battle_report_killmails.raw_zkb->>'_triff_ingest_source' = 'zkill-r2z2'
            AND EXCLUDED.raw_zkb->>'_triff_ingest_source' IS DISTINCT FROM 'zkill-r2z2'
            THEN battle_report_killmails.raw_esi
          ELSE EXCLUDED.raw_esi
        END
        OR battle_report_killmails.raw_zkb IS DISTINCT FROM CASE
          WHEN EXCLUDED.raw_zkb = '{}'::jsonb THEN battle_report_killmails.raw_zkb
          WHEN battle_report_killmails.raw_zkb->>'_triff_ingest_source' = 'zkill-r2z2'
            AND EXCLUDED.raw_zkb->>'_triff_ingest_source' IS DISTINCT FROM 'zkill-r2z2'
            THEN battle_report_killmails.raw_zkb
          ELSE EXCLUDED.raw_zkb
        END
      RETURNING (xmax = 0) AS inserted
      `,
      [
        reportId,
        esi.killmail_id,
        esi.killmail_time,
        esi.solar_system_id,
        totalValue,
        jsonb(esi, {}),
        jsonb(zkb, {}),
      ]
    );
    if (rows.length) {
      changed += 1;
      if (rows[0].inserted === true || rows[0].inserted === "t") added += 1;
    }
  }
  return { changed, added };
}

async function attachKillmailToLiveReports({ esi, zkb = {}, totalValue = null, sequenceId = null }) {
  if (!esi?.killmail_id || !esi?.solar_system_id || !esi?.killmail_time) return [];
  await ensureBattleReportSchema();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: matches } = await client.query(
      `
      SELECT DISTINCT b.id
      FROM battle_report_scopes s
      JOIN battle_reports b ON b.id = s.battle_report_id
      WHERE s.system_id = $1
        AND $2::timestamptz >= s.start_time
        AND $2::timestamptz <= s.end_time
        AND now() <= s.live_until
        AND b.live_status IN ('scheduled', 'live')
      `,
      [esi.solar_system_id, esi.killmail_time]
    );

    const affected = [];
    for (const match of matches) {
      const result = await upsertReportKillmails(client, match.id, [{ esi, zkb, totalValue }]);
      if (!result.changed) continue;
      const seq = Number(sequenceId || 0);
      const { rows } = await client.query(
        `
        UPDATE battle_reports SET
          live_status = CASE WHEN now() >= start_time THEN 'live' ELSE live_status END,
          live_latest_sequence = GREATEST(live_latest_sequence, $2),
          live_change_token = live_change_token + 1,
          live_dirty_since = COALESCE(live_dirty_since, now()),
          live_last_event_at = now()
        WHERE id = $1
        RETURNING id, revision, live_change_token, live_latest_sequence
        `,
        [match.id, Number.isFinite(seq) ? seq : 0]
      );
      if (rows[0]) affected.push({ ...rows[0], added: result.added, changed: result.changed });
    }

    await client.query("COMMIT");
    return affected;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function addKillsToReport(reportId, kills, { sequenceId = 0 } = {}) {
  await ensureBattleReportSchema();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await upsertReportKillmails(client, reportId, kills);
    let report = null;
    if (result.changed) {
      const { rows } = await client.query(
        `
        UPDATE battle_reports SET
          live_latest_sequence = GREATEST(live_latest_sequence, $2),
          live_change_token = live_change_token + 1,
          live_dirty_since = COALESCE(live_dirty_since, now()),
          live_last_event_at = now()
        WHERE id = $1
        RETURNING *
        `,
        [reportId, Number(sequenceId || 0)]
      );
      report = rows[0] || null;
    }
    await client.query("COMMIT");
    return { ...result, report };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function listPendingLiveReports({ debounceMs = 3000, maxBatchMs = 5000, limit = 10 } = {}) {
  await ensureBattleReportSchema();
  const { rows } = await pool.query(
    `
    SELECT *
    FROM battle_reports
    WHERE live_status IN ('scheduled', 'live')
      AND live_change_token > live_processed_token
      AND (
        live_last_event_at <= now() - ($1::double precision * interval '1 millisecond')
        OR live_dirty_since <= now() - ($2::double precision * interval '1 millisecond')
      )
    ORDER BY live_dirty_since ASC
    LIMIT $3
    `,
    [Math.max(0, Number(debounceMs)), Math.max(0, Number(maxBatchMs)), Math.max(1, Number(limit))]
  );
  return rows;
}

async function commitLiveReportRebuild(reportId, expectedRevision, targetToken, targetSequence, rebuilt) {
  await ensureBattleReportSchema();
  const { rows } = await pool.query(
    `
    UPDATE battle_reports SET
      title = $4,
      system_id = $5,
      system_name = $6,
      start_time = $7,
      end_time = $8,
      value_mode = $9,
      source_mode = $10,
      summary = $11::jsonb,
      sides = $12::jsonb,
      entities = $13::jsonb,
      side_overrides = $14::jsonb,
      side_names = $15::jsonb,
      data = $16::jsonb,
      revision = revision + 1,
      live_processed_token = GREATEST(live_processed_token, $3),
      live_processed_sequence = GREATEST(live_processed_sequence, $17),
      live_dirty_since = CASE WHEN live_change_token <= $3 THEN NULL ELSE live_dirty_since END,
      live_last_update_at = now(),
      updated_at = now()
    WHERE id = $1 AND revision = $2
    RETURNING *
    `,
    [
      reportId,
      Number(expectedRevision),
      Number(targetToken),
      rebuilt.title,
      rebuilt.system_id || null,
      rebuilt.system_name || null,
      rebuilt.start_time || null,
      rebuilt.end_time || null,
      rebuilt.value_mode || "zkill",
      rebuilt.source_mode || null,
      jsonb(rebuilt.summary, {}),
      jsonb(rebuilt.sides, []),
      jsonb(rebuilt.entities, []),
      jsonb(rebuilt.side_overrides, {}),
      jsonb(rebuilt.side_names, {}),
      jsonb(rebuilt.data, {}),
      Number(targetSequence || 0),
    ]
  );
  return rows[0] || null;
}

async function getBattleReportScopes(id) {
  await ensureBattleReportSchema();
  const { rows } = await pool.query(
    `SELECT * FROM battle_report_scopes WHERE battle_report_id = $1 ORDER BY scope_index`,
    [id]
  );
  return rows;
}

async function listDueReconciliationScopes({ intervalMinutes = 5, limit = 8 } = {}) {
  await ensureBattleReportSchema();
  const { rows } = await pool.query(
    `
    SELECT s.*, b.live_status
    FROM battle_report_scopes s
    JOIN battle_reports b ON b.id = s.battle_report_id
    WHERE b.live_status IN ('scheduled', 'live')
      AND now() >= s.start_time
      AND s.final_reconciled = false
      AND (
        s.last_reconcile_attempt_at IS NULL
        OR (now() >= s.live_until AND s.last_reconcile_attempt_at < s.live_until)
        OR s.last_reconcile_attempt_at <= now() - ($1::double precision * interval '1 minute')
      )
    ORDER BY (now() > s.live_until) DESC, s.last_reconcile_attempt_at NULLS FIRST
    LIMIT $2
    `,
    [Math.max(1, Number(intervalMinutes)), Math.max(1, Number(limit))]
  );
  return rows;
}

async function markScopeReconcileAttempt(reportId, scopeIndex) {
  await ensureBattleReportSchema();
  await pool.query(
    `
    UPDATE battle_report_scopes SET last_reconcile_attempt_at = now(), reconciliation_error = NULL
    WHERE battle_report_id = $1 AND scope_index = $2
    `,
    [reportId, scopeIndex]
  );
}

async function finishScopeReconcile(reportId, scopeIndex, { error = null } = {}) {
  await ensureBattleReportSchema();
  await pool.query(
    `
    UPDATE battle_report_scopes SET
      last_reconciled_at = CASE WHEN $3::text IS NULL THEN now() ELSE last_reconciled_at END,
      final_reconciled = CASE WHEN $3::text IS NULL AND now() >= live_until THEN true ELSE final_reconciled END,
      reconciliation_error = $3
    WHERE battle_report_id = $1 AND scope_index = $2
    `,
    [reportId, scopeIndex, error ? String(error).slice(0, 1000) : null]
  );
}

async function activateScheduledReports() {
  await ensureBattleReportSchema();
  const { rows } = await pool.query(`
    UPDATE battle_reports SET
      live_status = 'live',
      revision = revision + 1,
      live_last_update_at = now(),
      updated_at = now()
    WHERE live_status = 'scheduled' AND now() >= start_time AND now() <= live_until
    RETURNING *
  `);
  return rows;
}

async function finalizeReadyReports() {
  await ensureBattleReportSchema();
  const { rows } = await pool.query(`
    UPDATE battle_reports b SET
      live_status = 'final',
      revision = revision + 1,
      live_last_update_at = now(),
      updated_at = now()
    WHERE b.live_status IN ('scheduled', 'live')
      AND b.live_until < now()
      AND b.live_change_token <= b.live_processed_token
      AND NOT EXISTS (
        SELECT 1 FROM battle_report_scopes s
        WHERE s.battle_report_id = b.id AND s.final_reconciled = false
      )
    RETURNING *
  `);
  return rows;
}

async function getLiveReportStatus(id) {
  await ensureBattleReportSchema();
  const { rows } = await pool.query(
    `SELECT id, revision, live_status, live_until, live_last_update_at, updated_at, summary FROM battle_reports WHERE id = $1`,
    [id]
  );
  return rows[0] || null;
}

async function countActiveLiveReports() {
  await ensureBattleReportSchema();
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS count FROM battle_reports WHERE live_status IN ('scheduled', 'live')`
  );
  return Number(rows[0]?.count || 0);
}

async function pruneKillmailCache({ retentionDays = 7, limit = 25000 } = {}) {
  await ensureBattleReportSchema();
  const { rowCount } = await pool.query(
    `
    WITH doomed AS (
      SELECT killmail_id
      FROM br_killmail_cache
      WHERE fetched_at < now() - ($1::double precision * interval '1 day')
      ORDER BY fetched_at ASC
      LIMIT $2
    )
    DELETE FROM br_killmail_cache cache
    USING doomed
    WHERE cache.killmail_id = doomed.killmail_id
    `,
    [Math.max(1, Number(retentionDays)), Math.max(1, Number(limit))]
  );
  return rowCount || 0;
}

async function saveBattleReport(report) {
  await ensureBattleReportSchema();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const scopes = reportScopes(report);
    const live = liveStateForScopes(scopes);

    const { rows: savedRows } = await client.query(
      `
      INSERT INTO battle_reports (
        id, title, system_id, system_name, start_time, end_time, value_mode,
        source_mode, summary, sides, entities, side_overrides, side_names, data,
        revision, live_status, live_until, live_last_update_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11::jsonb,$12::jsonb,$13::jsonb,$14::jsonb,$15,$16,$17,now(),now())
      ON CONFLICT (id) DO UPDATE SET
        title = EXCLUDED.title,
        system_id = EXCLUDED.system_id,
        system_name = EXCLUDED.system_name,
        start_time = EXCLUDED.start_time,
        end_time = EXCLUDED.end_time,
        value_mode = EXCLUDED.value_mode,
        source_mode = EXCLUDED.source_mode,
        summary = EXCLUDED.summary,
        sides = EXCLUDED.sides,
        entities = EXCLUDED.entities,
        side_overrides = EXCLUDED.side_overrides,
        side_names = EXCLUDED.side_names,
        data = EXCLUDED.data,
        revision = battle_reports.revision + 1,
        live_status = EXCLUDED.live_status,
        live_until = EXCLUDED.live_until,
        live_last_update_at = now(),
        updated_at = now()
      RETURNING *
      `,
      [
        report.id,
        report.title,
        report.system_id || null,
        report.system_name || null,
        report.start_time || null,
        report.end_time || null,
        report.value_mode || "zkill",
        report.source_mode || null,
        jsonb(report.summary, {}),
        jsonb(report.sides, []),
        jsonb(report.entities, []),
        jsonb(report.side_overrides, {}),
        jsonb(report.side_names, {}),
        jsonb(report.data, {}),
        Math.max(1, Number(report.revision || 1)),
        live.status,
        live.liveUntil,
      ]
    );

    await replaceBattleReportScopes(client, report);

    await client.query(
      `DELETE FROM battle_report_killmails WHERE battle_report_id = $1`,
      [report.id]
    );

    for (const km of report.killmails || []) {
      await client.query(
        `
        INSERT INTO battle_report_killmails (
          battle_report_id, killmail_id, killmail_time, solar_system_id, total_value, raw_esi, raw_zkb
        ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb)
        ON CONFLICT (battle_report_id, killmail_id) DO UPDATE SET
          killmail_time = EXCLUDED.killmail_time,
          solar_system_id = EXCLUDED.solar_system_id,
          total_value = EXCLUDED.total_value,
          raw_esi = EXCLUDED.raw_esi,
          raw_zkb = EXCLUDED.raw_zkb
        `,
        [
          report.id,
          km.esi.killmail_id,
          km.esi.killmail_time,
          km.esi.solar_system_id,
          km.totalValue || readZkbTotal(km.zkb),
          jsonb(km.esi, {}),
          jsonb(km.zkb, {}),
        ]
      );
    }

    await client.query("COMMIT");
    return savedRows[0] || null;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function getBattleReport(id) {
  await ensureBattleReportSchema();
  const { rows } = await pool.query(
    `SELECT * FROM battle_reports WHERE id = $1`,
    [id]
  );
  return rows[0] || null;
}

async function getBattleReportKillmails(id) {
  await ensureBattleReportSchema();
  const { rows } = await pool.query(
    `
    SELECT *
    FROM battle_report_killmails
    WHERE battle_report_id = $1
    ORDER BY killmail_time ASC, killmail_id ASC
    `,
    [id]
  );
  return rows;
}

async function listRecentBattleReports(limit = 25) {
  await ensureBattleReportSchema();
  const { rows } = await pool.query(
    `
    SELECT id, title, created_at, updated_at, system_id, system_name, start_time, end_time, summary
    FROM battle_reports
    ORDER BY created_at DESC
    LIMIT $1
    `,
    [Math.min(Math.max(Number(limit) || 25, 1), 100)]
  );
  return rows;
}

async function patchBattleReportSides(id, { side_overrides, side_names, summary, sides, entities, data, expected_revision = null }) {
  await ensureBattleReportSchema();
  const { rows } = await pool.query(
    `
    UPDATE battle_reports SET
      side_overrides = $2::jsonb,
      side_names = $3::jsonb,
      summary = $4::jsonb,
      sides = $5::jsonb,
      entities = $6::jsonb,
      data = $7::jsonb,
      revision = revision + 1,
      live_last_update_at = now(),
      updated_at = now()
    WHERE id = $1 AND ($8::bigint IS NULL OR revision = $8)
    RETURNING *
    `,
    [
      id,
      jsonb(side_overrides, {}),
      jsonb(side_names, {}),
      jsonb(summary, {}),
      jsonb(sides, []),
      jsonb(entities, []),
      jsonb(data, {}),
      expected_revision == null ? null : Number(expected_revision),
    ]
  );
  return rows[0] || null;
}

module.exports = {
  ensureBattleReportSchema,
  upsertKillmailCache,
  getCachedKillmail,
  getCachedBySystemWindow,
  attachKillmailToLiveReports,
  addKillsToReport,
  listPendingLiveReports,
  commitLiveReportRebuild,
  getBattleReportScopes,
  listDueReconciliationScopes,
  markScopeReconcileAttempt,
  finishScopeReconcile,
  activateScheduledReports,
  finalizeReadyReports,
  getLiveReportStatus,
  countActiveLiveReports,
  pruneKillmailCache,
  saveBattleReport,
  getBattleReport,
  getBattleReportKillmails,
  listRecentBattleReports,
  patchBattleReportSides,
  readZkbTotal,
  getR2Z2Cursor,
  setR2Z2Cursor,
  reportScopes,
  liveStateForScopes,
  LIVE_GRACE_MINUTES,
};
