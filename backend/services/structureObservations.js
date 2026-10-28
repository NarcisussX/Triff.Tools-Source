/*
 * Private, account-independent structure observation store.
 *
 * Only normalized structure facts are retained. Original pasted text, account
 * identifiers, IP addresses, and user/session identifiers are intentionally
 * excluded from both the aggregate and its idempotency ledger.
 */

const crypto = require("crypto");
const pool = require("../db/pool");
const {
  resolveCorporationId,
  getCorporationActivity,
} = require("./corporationActivityCache");

const TOOL_KEY = "structure-age-checks";
const MAX_SIGNED_BIGINT = 9223372036854775807n;
const AGE_METHODS = new Set(["exact", "interpolate", "extrapolate-head", "extrapolate-tail"]);
// v2 supersedes the initial migration, which could mark itself complete after
// database insert failures. Keeping a new key makes affected deployments retry
// safely while deterministic event IDs prevent duplicates.
const BACKFILL_KEY = "structure_history_backfill_v2";

let schemaReady = false;
let schemaPromise = null;

async function ensureStructureObservationSchema() {
  if (schemaReady) return;
  if (!schemaPromise) {
    schemaPromise = pool.query(`
      CREATE TABLE IF NOT EXISTS structure_observations (
        structure_id BIGINT PRIMARY KEY,
        jcode TEXT,
        wormhole_class TEXT,
        type_id INTEGER,
        type_name TEXT,
        age_method TEXT,
        age_mid TIMESTAMPTZ,
        age_low TIMESTAMPTZ,
        age_high TIMESTAMPTZ,
        age_window_days DOUBLE PRECISION,
        corporation_name TEXT,
        defender_timezone TEXT,
        defender_peak_hour SMALLINT,
        defender_confidence SMALLINT,
        defender_observed_at TIMESTAMPTZ,
        first_observed_at TIMESTAMPTZ NOT NULL,
        last_observed_at TIMESTAMPTZ NOT NULL,
        observation_count BIGINT NOT NULL DEFAULT 1,
        CONSTRAINT structure_observations_jcode_check
          CHECK (jcode IS NULL OR jcode ~ '^J[0-9]{6}$'),
        CONSTRAINT structure_observations_peak_hour_check
          CHECK (defender_peak_hour IS NULL OR defender_peak_hour BETWEEN 0 AND 23),
        CONSTRAINT structure_observations_confidence_check
          CHECK (defender_confidence IS NULL OR defender_confidence BETWEEN 0 AND 100),
        CONSTRAINT structure_observations_count_check
          CHECK (observation_count > 0)
      );

      CREATE TABLE IF NOT EXISTS structure_observation_events (
        event_id UUID PRIMARY KEY,
        source_setup_id UUID UNIQUE,
        structure_id BIGINT NOT NULL,
        corporation_name TEXT,
        observed_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS structure_observation_migrations (
        migration_key TEXT PRIMARY KEY,
        cutoff_at TIMESTAMPTZ NOT NULL,
        completed_at TIMESTAMPTZ,
        last_run_at TIMESTAMPTZ,
        last_scanned INTEGER,
        last_recorded INTEGER,
        last_skipped INTEGER,
        last_failed INTEGER
      );

      CREATE TABLE IF NOT EXISTS structure_observation_replay_tokens (
        token_hash TEXT PRIMARY KEY,
        structure_id BIGINT NOT NULL REFERENCES structure_observations(structure_id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        expires_at TIMESTAMPTZ NOT NULL,
        used_at TIMESTAMPTZ
      );

      ALTER TABLE structure_observations
        ADD COLUMN IF NOT EXISTS defender_observed_at TIMESTAMPTZ;
      ALTER TABLE structure_observation_events
        ADD COLUMN IF NOT EXISTS corporation_name TEXT;
      ALTER TABLE structure_observation_migrations
        ADD COLUMN IF NOT EXISTS last_failed INTEGER;

      INSERT INTO structure_observation_migrations (migration_key, cutoff_at)
      VALUES ('structure_history_backfill_v2', now())
      ON CONFLICT (migration_key) DO NOTHING;

      CREATE INDEX IF NOT EXISTS structure_observations_jcode_idx
        ON structure_observations(jcode);
      CREATE INDEX IF NOT EXISTS structure_observations_class_idx
        ON structure_observations(wormhole_class);
      CREATE INDEX IF NOT EXISTS structure_observations_type_name_idx
        ON structure_observations(lower(type_name));
      CREATE INDEX IF NOT EXISTS structure_observations_age_mid_idx
        ON structure_observations(age_mid);
      CREATE INDEX IF NOT EXISTS structure_observations_corporation_idx
        ON structure_observations(lower(corporation_name));
      CREATE INDEX IF NOT EXISTS structure_observations_timezone_idx
        ON structure_observations(defender_timezone);
      CREATE INDEX IF NOT EXISTS structure_observations_last_seen_idx
        ON structure_observations(last_observed_at DESC);
      CREATE INDEX IF NOT EXISTS structure_observations_count_idx
        ON structure_observations(observation_count DESC);
      CREATE INDEX IF NOT EXISTS structure_observation_events_structure_idx
        ON structure_observation_events(structure_id, observed_at DESC);
      CREATE INDEX IF NOT EXISTS structure_observation_replay_expiry_idx
        ON structure_observation_replay_tokens(expires_at);
    `).then(() => {
      schemaReady = true;
    }).catch((err) => {
      schemaPromise = null;
      throw err;
    });
  }
  await schemaPromise;
}

function cleanText(value, maxLength) {
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return cleaned ? cleaned.slice(0, maxLength) : null;
}

function normalizeStructureId(value) {
  const raw = String(value ?? "").trim();
  if (!/^\d{10,19}$/.test(raw)) return null;
  try {
    const id = BigInt(raw);
    return id > 0n && id <= MAX_SIGNED_BIGINT ? id.toString() : null;
  } catch {
    return null;
  }
}

function normalizeJcode(value) {
  const raw = String(value ?? "").trim().toUpperCase();
  const match = raw.match(/^J\d{6}$/);
  return match ? match[0] : null;
}

function normalizeWormholeClass(value) {
  const cleaned = cleanText(value, 40);
  if (!cleaned) return null;
  return /^\d+$/.test(cleaned) ? `C${cleaned}` : cleaned;
}

function normalizeUuid(value) {
  const raw = String(value ?? "").trim().toLowerCase();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(raw)
    ? raw
    : null;
}

function normalizeInteger(value, min, max) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isInteger(number) && number >= min && number <= max ? number : null;
}

function normalizeNumber(value, min, max) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max ? number : null;
}

function normalizeDate(value, fallback = null) {
  if (value === null || value === undefined || value === "") return fallback;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : fallback;
}

function normalizeObservation(input = {}) {
  const structureId = normalizeStructureId(input.structureId ?? input.structure_id ?? input.id);
  if (!structureId) throw Object.assign(new Error("invalid_structure_id"), { code: "invalid_structure_id" });

  const methodRaw = cleanText(input.method ?? input.ageMethod, 40);
  const method = AGE_METHODS.has(methodRaw) ? methodRaw : null;
  const observedAt = normalizeDate(input.observedAt ?? input.checkedAt, new Date());

  return {
    structureId,
    jcode: normalizeJcode(input.jcode),
    wormholeClass: normalizeWormholeClass(input.wormholeClass ?? input.class),
    typeId: normalizeInteger(input.typeId ?? input.type_id, 1, 2147483647),
    typeName: cleanText(input.typeName ?? input.type_name, 160),
    method,
    midISO: normalizeDate(input.midISO ?? input.ageMid),
    lowISO: normalizeDate(input.lowISO ?? input.ageLow),
    highISO: normalizeDate(input.highISO ?? input.ageHigh),
    daysWide: normalizeNumber(input.daysWide ?? input.ageWindowDays, 0, 36500),
    corpName: cleanText(input.corpName ?? input.corporationName, 255),
    defenderTimezone: cleanText(input.defenderTimezone, 80),
    defenderPeakHour: normalizeInteger(input.defenderPeakHour, 0, 23),
    defenderConfidence: normalizeInteger(input.defenderConfidence, 0, 100),
    observedAt,
    observationId: normalizeUuid(input.observationId ?? input.eventId) || crypto.randomUUID(),
    sourceSetupId: normalizeUuid(input.sourceSetupId),
  };
}

async function enrichImmutableFields(observation) {
  const enriched = { ...observation };

  if (enriched.jcode) {
    try {
      const { rows } = await pool.query(
        "SELECT jcode, class FROM wormhole_systems WHERE jcode = $1 LIMIT 1",
        [enriched.jcode]
      );
      if (rows[0]) {
        enriched.jcode = normalizeJcode(rows[0].jcode);
        enriched.wormholeClass = normalizeWormholeClass(rows[0].class);
      } else {
        enriched.jcode = null;
        enriched.wormholeClass = null;
      }
    } catch (err) {
      console.warn("[structure-observations] wormhole class lookup failed:", err.message);
      enriched.jcode = null;
      enriched.wormholeClass = null;
    }
  } else {
    enriched.wormholeClass = null;
  }

  if (enriched.typeId) {
    try {
      const { rows } = await pool.query(
        `SELECT COALESCE(
           (SELECT "typeName" FROM evesde."invTypes" WHERE "typeID" = $1 LIMIT 1),
           (SELECT type_name FROM inv_types WHERE type_id = $1 LIMIT 1)
         ) AS type_name`,
        [enriched.typeId]
      );
      const canonicalName = cleanText(rows[0]?.type_name, 160);
      if (canonicalName) enriched.typeName = canonicalName;
      else {
        enriched.typeId = null;
        enriched.typeName = null;
      }
    } catch (err) {
      console.warn("[structure-observations] structure type lookup failed:", err.message);
      enriched.typeId = null;
      enriched.typeName = null;
    }
  } else {
    enriched.typeName = null;
  }

  return enriched;
}

function immutableConflicts(input, stored) {
  const conflicts = [];
  if (input.jcode && stored.jcode && input.jcode !== stored.jcode) conflicts.push("jcode");
  if (input.typeId && stored.type_id && Number(stored.type_id) !== input.typeId) conflicts.push("type_id");
  if (input.typeName && stored.type_name && input.typeName !== stored.type_name) conflicts.push("type_name");
  return conflicts;
}

async function recordObservation(input = {}) {
  await ensureStructureObservationSchema();
  const observation = await enrichImmutableFields(normalizeObservation(input));
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const eventInsert = await client.query(
      `INSERT INTO structure_observation_events
         (event_id, source_setup_id, structure_id, corporation_name, observed_at)
       VALUES ($1::uuid, $2::uuid, $3::bigint, $4, $5::timestamptz)
       ON CONFLICT DO NOTHING
       RETURNING event_id`,
      [
        observation.observationId,
        observation.sourceSetupId,
        observation.structureId,
        observation.corpName,
        observation.observedAt,
      ]
    );

    if (!eventInsert.rows[0]) {
      // A live observation may be backfilled later after its account-history row
      // receives the same observation ID. Attach that setup ID without counting
      // the event twice.
      if (observation.sourceSetupId) {
        await client.query(
          `UPDATE structure_observation_events
           SET source_setup_id = COALESCE(source_setup_id, $2::uuid)
           WHERE event_id = $1::uuid
             AND (source_setup_id IS NULL OR source_setup_id = $2::uuid)`,
          [observation.observationId, observation.sourceSetupId]
        );
      }
      const existingEvent = await client.query(
        `SELECT event_id, structure_id
         FROM structure_observation_events
         WHERE event_id = $1::uuid OR source_setup_id = $2::uuid
         LIMIT 1`,
        [observation.observationId, observation.sourceSetupId]
      );
      await client.query("COMMIT");
      return {
        recorded: false,
        observationId: String(existingEvent.rows[0]?.event_id || observation.observationId),
        structureId: String(existingEvent.rows[0]?.structure_id || observation.structureId),
        conflicts: [],
      };
    }

    const { rows } = await client.query(
      `INSERT INTO structure_observations (
         structure_id,
         jcode,
         wormhole_class,
         type_id,
         type_name,
         age_method,
         age_mid,
         age_low,
         age_high,
         age_window_days,
         corporation_name,
         defender_timezone,
         defender_peak_hour,
         defender_confidence,
         defender_observed_at,
         first_observed_at,
         last_observed_at,
         observation_count
       ) VALUES (
         $1::bigint, $2::text, $3::text, $4::integer, $5::text, $6::text,
         $7::timestamptz, $8::timestamptz, $9::timestamptz,
         $10::double precision, $11::text, $12::text, $13::smallint, $14::smallint,
         CASE WHEN $12::text IS NOT NULL OR $13::smallint IS NOT NULL OR $14::smallint IS NOT NULL
           THEN $15::timestamptz ELSE NULL END,
         $15::timestamptz, $15::timestamptz, 1
       )
       ON CONFLICT (structure_id) DO UPDATE SET
         jcode = COALESCE(structure_observations.jcode, EXCLUDED.jcode),
         wormhole_class = CASE
           WHEN structure_observations.wormhole_class IS NULL
             AND (structure_observations.jcode IS NULL OR structure_observations.jcode = EXCLUDED.jcode)
           THEN EXCLUDED.wormhole_class
           ELSE structure_observations.wormhole_class
         END,
         type_name = CASE
           WHEN structure_observations.type_name IS NULL
             AND (structure_observations.type_id IS NULL OR structure_observations.type_id = EXCLUDED.type_id)
           THEN EXCLUDED.type_name
           ELSE structure_observations.type_name
         END,
         type_id = COALESCE(structure_observations.type_id, EXCLUDED.type_id),
         age_method = CASE WHEN EXCLUDED.last_observed_at >= structure_observations.last_observed_at
           THEN COALESCE(EXCLUDED.age_method, structure_observations.age_method)
           ELSE structure_observations.age_method END,
         age_mid = CASE WHEN EXCLUDED.last_observed_at >= structure_observations.last_observed_at
           THEN COALESCE(EXCLUDED.age_mid, structure_observations.age_mid)
           ELSE structure_observations.age_mid END,
         age_low = CASE WHEN EXCLUDED.last_observed_at >= structure_observations.last_observed_at
           THEN COALESCE(EXCLUDED.age_low, structure_observations.age_low)
           ELSE structure_observations.age_low END,
         age_high = CASE WHEN EXCLUDED.last_observed_at >= structure_observations.last_observed_at
           THEN COALESCE(EXCLUDED.age_high, structure_observations.age_high)
           ELSE structure_observations.age_high END,
         age_window_days = CASE WHEN EXCLUDED.last_observed_at >= structure_observations.last_observed_at
           THEN COALESCE(EXCLUDED.age_window_days, structure_observations.age_window_days)
           ELSE structure_observations.age_window_days END,
         corporation_name = CASE WHEN EXCLUDED.last_observed_at >= structure_observations.last_observed_at
           THEN COALESCE(EXCLUDED.corporation_name, structure_observations.corporation_name)
           ELSE structure_observations.corporation_name END,
         defender_timezone = CASE WHEN EXCLUDED.defender_observed_at IS NOT NULL
             AND EXCLUDED.defender_observed_at >= COALESCE(
               structure_observations.defender_observed_at,
               '-infinity'::timestamptz
             )
           THEN COALESCE(EXCLUDED.defender_timezone, structure_observations.defender_timezone)
           WHEN EXCLUDED.last_observed_at >= structure_observations.last_observed_at
             AND EXCLUDED.corporation_name IS NOT NULL
             AND structure_observations.corporation_name IS DISTINCT FROM EXCLUDED.corporation_name
           THEN NULL
           ELSE structure_observations.defender_timezone END,
         defender_peak_hour = CASE WHEN EXCLUDED.defender_observed_at IS NOT NULL
             AND EXCLUDED.defender_observed_at >= COALESCE(
               structure_observations.defender_observed_at,
               '-infinity'::timestamptz
             )
           THEN COALESCE(EXCLUDED.defender_peak_hour, structure_observations.defender_peak_hour)
           WHEN EXCLUDED.last_observed_at >= structure_observations.last_observed_at
             AND EXCLUDED.corporation_name IS NOT NULL
             AND structure_observations.corporation_name IS DISTINCT FROM EXCLUDED.corporation_name
           THEN NULL
           ELSE structure_observations.defender_peak_hour END,
         defender_confidence = CASE WHEN EXCLUDED.defender_observed_at IS NOT NULL
             AND EXCLUDED.defender_observed_at >= COALESCE(
               structure_observations.defender_observed_at,
               '-infinity'::timestamptz
             )
           THEN COALESCE(EXCLUDED.defender_confidence, structure_observations.defender_confidence)
           WHEN EXCLUDED.last_observed_at >= structure_observations.last_observed_at
             AND EXCLUDED.corporation_name IS NOT NULL
             AND structure_observations.corporation_name IS DISTINCT FROM EXCLUDED.corporation_name
           THEN NULL
           ELSE structure_observations.defender_confidence END,
         defender_observed_at = CASE WHEN EXCLUDED.defender_observed_at IS NOT NULL
             AND EXCLUDED.defender_observed_at >= COALESCE(
               structure_observations.defender_observed_at,
               '-infinity'::timestamptz
           )
           THEN EXCLUDED.defender_observed_at
           WHEN EXCLUDED.last_observed_at >= structure_observations.last_observed_at
             AND EXCLUDED.corporation_name IS NOT NULL
             AND structure_observations.corporation_name IS DISTINCT FROM EXCLUDED.corporation_name
           THEN NULL
           ELSE structure_observations.defender_observed_at END,
         first_observed_at = LEAST(structure_observations.first_observed_at, EXCLUDED.first_observed_at),
         last_observed_at = GREATEST(structure_observations.last_observed_at, EXCLUDED.last_observed_at),
         observation_count = structure_observations.observation_count + 1
       RETURNING *`,
      [
        observation.structureId,
        observation.jcode,
        observation.wormholeClass,
        observation.typeId,
        observation.typeName,
        observation.method,
        observation.midISO,
        observation.lowISO,
        observation.highISO,
        observation.daysWide,
        observation.corpName,
        observation.defenderTimezone,
        observation.defenderPeakHour,
        observation.defenderConfidence,
        observation.observedAt,
      ]
    );

    const conflicts = immutableConflicts(observation, rows[0]);
    await client.query("COMMIT");
    if (conflicts.length) {
      console.warn(
        `[structure-observations] ignored immutable conflict for ${observation.structureId}: ${conflicts.join(",")}`
      );
    }
    return {
      recorded: true,
      observationId: observation.observationId,
      structureId: observation.structureId,
      conflicts,
    };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

function defenderFromActivity(activity) {
  if (!activity || !Array.isArray(activity.days)) return null;
  const hourTotals = new Array(24).fill(0);
  for (let dayIndex = 0; dayIndex < activity.days.length; dayIndex += 1) {
    for (let hour = 0; hour < 24; hour += 1) {
      const value = Number(activity?.[dayIndex]?.[hour]) || 0;
      hourTotals[hour] += Math.max(0, value);
    }
  }
  const total = hourTotals.reduce((sum, value) => sum + value, 0);
  if (!total) return null;
  const peakHour = hourTotals.reduce(
    (best, value, hour) => (value > hourTotals[best] ? hour : best),
    0
  );
  const confidence = Math.round((hourTotals[peakHour] / total) * 100);
  const timezone = peakHour <= 7
    ? "Americas (US)"
    : peakHour <= 15
      ? "Europe/Africa"
      : "AU/Asia";
  return { timezone, peakHour, confidence };
}

async function updateDefenderFromActivity(observationId, activity) {
  const eventId = normalizeUuid(observationId);
  const defender = defenderFromActivity(activity);
  if (!eventId || !defender) return { updated: false };
  await ensureStructureObservationSchema();

  const { rows } = await pool.query(
    `UPDATE structure_observations observation
     SET defender_timezone = $2,
         defender_peak_hour = $3,
         defender_confidence = $4,
         defender_observed_at = event.observed_at
     FROM structure_observation_events event
     WHERE event.event_id = $1::uuid
       AND observation.structure_id = event.structure_id
       AND event.corporation_name IS NOT NULL
       AND observation.corporation_name IS NOT NULL
       AND lower(event.corporation_name) = lower(observation.corporation_name)
       AND event.observed_at >= observation.last_observed_at
       AND event.observed_at >= COALESCE(observation.defender_observed_at, '-infinity'::timestamptz)
     RETURNING observation.structure_id`,
    [eventId, defender.timezone, defender.peakHour, defender.confidence]
  );
  return {
    updated: Boolean(rows[0]),
    structureId: rows[0]?.structure_id ? String(rows[0].structure_id) : undefined,
    ...defender,
  };
}

async function enrichDefenderForObservation(observationId, corporationName) {
  const eventId = normalizeUuid(observationId);
  const corpName = cleanText(corporationName, 255);
  if (!eventId || !corpName) return { updated: false };
  await ensureStructureObservationSchema();

  // Verify the server-created event/corporation binding before doing any
  // external work. A caller cannot use an event for a different corporation.
  const binding = await pool.query(
    `SELECT event.event_id
     FROM structure_observation_events event
     JOIN structure_observations observation
       ON observation.structure_id = event.structure_id
     WHERE event.event_id = $1::uuid
       AND event.corporation_name IS NOT NULL
       AND lower(event.corporation_name) = lower($2)
       AND observation.corporation_name IS NOT NULL
       AND lower(observation.corporation_name) = lower($2)
       AND event.observed_at >= observation.last_observed_at
     LIMIT 1`,
    [eventId, corpName]
  );
  if (!binding.rows[0]) return { updated: false };

  const corporation = await resolveCorporationId(corpName);
  if (!corporation?.id) return { updated: false };
  const result = await getCorporationActivity(corporation.id);
  return updateDefenderFromActivity(eventId, result.activity);
}

async function enrichMissingDefenderTimezones(options = {}) {
  await ensureStructureObservationSchema();
  const limit = Math.max(1, Math.min(1000, Number(options.limit) || 250));
  const concurrency = Math.max(1, Math.min(4, Number(options.concurrency) || 2));
  const throttleMs = Math.max(0, Math.min(5000, Number(options.throttleMs) || 250));
  const { rows } = await pool.query(
    `SELECT latest.event_id, observation.corporation_name
     FROM structure_observations observation
     JOIN LATERAL (
       SELECT event.event_id, event.corporation_name, event.observed_at
       FROM structure_observation_events event
       WHERE event.structure_id = observation.structure_id
         AND event.observed_at = observation.last_observed_at
       ORDER BY event.created_at DESC
       LIMIT 1
     ) latest ON true
     WHERE observation.defender_timezone IS NULL
       AND observation.corporation_name IS NOT NULL
       AND latest.corporation_name IS NOT NULL
       AND lower(latest.corporation_name) = lower(observation.corporation_name)
     ORDER BY observation.last_observed_at DESC
     LIMIT $1`,
    [limit]
  );

  let nextIndex = 0;
  let updated = 0;
  let failed = 0;
  async function worker() {
    while (nextIndex < rows.length) {
      const row = rows[nextIndex];
      nextIndex += 1;
      try {
        const result = await enrichDefenderForObservation(row.event_id, row.corporation_name);
        if (result.updated) updated += 1;
      } catch {
        failed += 1;
      }
      if (throttleMs) await new Promise((resolve) => setTimeout(resolve, throttleMs));
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, rows.length) }, () => worker()));
  return { scanned: rows.length, updated, failed };
}

function deterministicBackfillUuid(setupId) {
  const digest = crypto.createHash("sha256")
    .update(`triff-tools:structure-observation-backfill:${String(setupId).toLowerCase()}`)
    .digest();
  const bytes = Buffer.from(digest.subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function typeIdFromSavedSetup(setupJson = {}, expectedStructureId = null) {
  const direct = normalizeInteger(setupJson.typeId ?? setupJson.type_id, 1, 2147483647);
  if (direct) return direct;
  const input = typeof setupJson.input === "string" ? setupJson.input : "";
  const structureId = normalizeStructureId(expectedStructureId ?? setupJson.structureId);
  const match = structureId
    ? input.match(new RegExp(`showinfo:(\\d+)\\/\\/${structureId}(?!\\d)`, "i"))
    : input.match(/showinfo:(\d+)\/\/(\d{10,19})(?!\d)/i);
  return match ? normalizeInteger(match[1], 1, 2147483647) : null;
}

function approximateHistoricalRange(summaryJson = {}) {
  const mid = normalizeDate(summaryJson.midISO);
  if (!mid) return { lowISO: null, highISO: null, daysWide: null };
  const method = AGE_METHODS.has(summaryJson.method) ? summaryJson.method : null;
  const halfDays = method === "exact" ? 3 : method?.startsWith("extrapolate") ? 7 : null;
  if (halfDays === null) return { lowISO: null, highISO: null, daysWide: null };
  return {
    lowISO: new Date(mid.getTime() - halfDays * 86400000),
    highISO: new Date(mid.getTime() + halfDays * 86400000),
    daysWide: halfDays * 2,
  };
}

function currentAgeEstimate(structureId) {
  try {
    // Lazy to avoid a service/router cycle during initial module loading.
    const ageRouter = require("../routes/age");
    const result = ageRouter?._test?.estimateResponse?.(structureId);
    return result?.data || null;
  } catch {
    return null;
  }
}

function observationFromSavedSetup(row) {
  const setup = row?.setup_json && typeof row.setup_json === "object" ? row.setup_json : {};
  const summary = row?.summary_json && typeof row.summary_json === "object" ? row.summary_json : {};
  const structureId = normalizeStructureId(setup.structureId ?? summary.structureId);
  const sourceSetupId = normalizeUuid(row?.id);
  if (!structureId || !sourceSetupId) return null;

  const range = approximateHistoricalRange(summary);
  const currentAge = currentAgeEstimate(structureId);
  return {
    // Never trust a user-writable setup payload to choose a ledger event ID.
    observationId: deterministicBackfillUuid(sourceSetupId),
    // The setup UUID is used only to derive the deterministic event UUID. It
    // is never persisted, so the admin corpus cannot be joined back to an
    // account's saved-history rows.
    sourceSetupId: null,
    structureId,
    jcode: setup.jcode ?? summary.jcode,
    typeId: typeIdFromSavedSetup(setup, structureId),
    typeName: setup.typeName ?? summary.typeName,
    corpName: setup.corpName ?? summary.corpName,
    method: currentAge?.method ?? summary.method,
    midISO: currentAge?.midISO ?? summary.midISO,
    lowISO: currentAge?.lowISO ?? summary.lowISO ?? range.lowISO,
    highISO: currentAge?.highISO ?? summary.highISO ?? range.highISO,
    daysWide: currentAge?.daysWide ?? summary.daysWide ?? range.daysWide,
    defenderTimezone: summary.defenderTimezone,
    defenderPeakHour: summary.defenderPeakHour,
    defenderConfidence: summary.defenderConfidence,
    // Database-created time is trusted; summary JSON is user-controlled.
    observedAt: row.created_at,
  };
}

async function backfillSavedStructureChecks() {
  await ensureStructureObservationSchema();
  const cutoffResult = await pool.query(
    `SELECT cutoff_at, completed_at, last_scanned, last_recorded, last_skipped, last_failed
     FROM structure_observation_migrations
     WHERE migration_key = $1
     LIMIT 1`,
    [BACKFILL_KEY]
  );
  const migration = cutoffResult.rows[0];
  const cutoffAt = migration?.cutoff_at;
  if (!cutoffAt) throw new Error("structure_observation_backfill_cutoff_missing");
  if (migration.completed_at) {
    return {
      ran: false,
      completed: true,
      alreadyCompleted: true,
      scanned: Number(migration.last_scanned) || 0,
      recorded: Number(migration.last_recorded) || 0,
      skipped: Number(migration.last_skipped) || 0,
      failed: Number(migration.last_failed) || 0,
    };
  }

  const exists = await pool.query("SELECT to_regclass('public.tool_saved_setups') AS table_name");
  if (!exists.rows[0]?.table_name) {
    await pool.query(
      `UPDATE structure_observation_migrations
       SET completed_at = now(), last_run_at = now(),
           last_scanned = 0, last_recorded = 0, last_skipped = 0, last_failed = 0
       WHERE migration_key = $1`,
      [BACKFILL_KEY]
    );
    return {
      ran: true,
      completed: true,
      alreadyCompleted: false,
      scanned: 0,
      recorded: 0,
      skipped: 0,
      failed: 0,
    };
  }

  const { rows } = await pool.query(
    `SELECT id, setup_json, summary_json, created_at
     FROM tool_saved_setups
     WHERE tool_key = $1
       AND created_at <= $2::timestamptz
     ORDER BY created_at ASC, id ASC`,
    [TOOL_KEY, cutoffAt]
  );

  let recorded = 0;
  let skipped = 0;
  let failed = 0;
  for (const row of rows) {
    const observation = observationFromSavedSetup(row);
    if (!observation) {
      skipped += 1;
      continue;
    }
    try {
      const result = await recordObservation(observation);
      if (result.recorded) recorded += 1;
    } catch (err) {
      skipped += 1;
      failed += 1;
      console.warn(`[structure-observations] backfill skipped setup ${row.id}:`, err.message);
    }
  }
  await pool.query(
    `UPDATE structure_observation_migrations
     SET completed_at = CASE
           WHEN $5::integer = 0 THEN COALESCE(completed_at, now())
           ELSE NULL
         END,
         last_run_at = now(),
         last_scanned = $2,
         last_recorded = $3,
         last_skipped = $4,
         last_failed = $5
     WHERE migration_key = $1`,
    [BACKFILL_KEY, rows.length, recorded, skipped, failed]
  );
  return {
    ran: true,
    completed: failed === 0,
    alreadyCompleted: false,
    scanned: rows.length,
    recorded,
    skipped,
    failed,
  };
}

function canonicalReplayInput(row = {}) {
  const structureId = normalizeStructureId(row.structure_id ?? row.structureId);
  if (!structureId) return null;
  const jcode = normalizeJcode(row.jcode);
  const typeId = normalizeInteger(row.type_id ?? row.typeId, 1, 2147483647);
  const corpName = cleanText(row.corporation_name ?? row.corpName, 255);
  const label = `${jcode ? `${jcode} - ` : ""}Structure${corpName ? ` (${corpName})` : ""}`;
  if (!typeId) return `${jcode ? `${jcode} ` : ""}${structureId}${corpName ? ` (${corpName})` : ""}`;
  return `<url=showinfo:${typeId}//${structureId}>${label}</url>`;
}

function replayTokenHash(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

async function createReplayToken(structureId, ttlMs = 2 * 60 * 1000) {
  const normalizedId = normalizeStructureId(structureId);
  if (!normalizedId) return null;
  await ensureStructureObservationSchema();
  const safeTtlMs = Math.max(30 * 1000, Math.min(Number(ttlMs) || 0, 5 * 60 * 1000));
  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + safeTtlMs);

  await pool.query(
    `DELETE FROM structure_observation_replay_tokens
     WHERE expires_at < now() OR used_at < now() - interval '1 hour'`
  );
  const { rows } = await pool.query(
    `INSERT INTO structure_observation_replay_tokens (token_hash, structure_id, expires_at)
     SELECT $1, observation.structure_id, $3::timestamptz
     FROM structure_observations observation
     WHERE observation.structure_id = $2::bigint
     RETURNING expires_at`,
    [replayTokenHash(token), normalizedId, expiresAt]
  );
  if (!rows[0]) return null;
  return { token, expiresAt: rows[0].expires_at };
}

async function consumeReplayToken(token) {
  const normalizedToken = typeof token === "string" && /^[A-Za-z0-9_-]{32,128}$/.test(token)
    ? token
    : null;
  if (!normalizedToken) return null;
  await ensureStructureObservationSchema();
  const { rows } = await pool.query(
    `WITH consumed AS (
       UPDATE structure_observation_replay_tokens
       SET used_at = now()
       WHERE token_hash = $1
         AND used_at IS NULL
         AND expires_at > now()
       RETURNING structure_id
     )
     SELECT observation.*
     FROM structure_observations observation
     JOIN consumed ON consumed.structure_id = observation.structure_id
     LIMIT 1`,
    [replayTokenHash(normalizedToken)]
  );
  if (!rows[0]) return null;
  return canonicalReplayInput(rows[0]);
}

module.exports = {
  ensureStructureObservationSchema,
  recordObservation,
  updateDefenderFromActivity,
  enrichDefenderForObservation,
  enrichMissingDefenderTimezones,
  backfillSavedStructureChecks,
  canonicalReplayInput,
  createReplayToken,
  consumeReplayToken,
  _test: {
    normalizeStructureId,
    normalizeJcode,
    normalizeUuid,
    normalizeObservation,
    immutableConflicts,
    defenderFromActivity,
    deterministicBackfillUuid,
    typeIdFromSavedSetup,
    approximateHistoricalRange,
    observationFromSavedSetup,
    canonicalReplayInput,
    replayTokenHash,
  },
};
