/*
 * Private bulk maintenance for recalculating stored structure ages.
 *
 * This deliberately updates only the derived age columns. It does not create
 * observation events and cannot advance last_observed_at or observation_count.
 */

const pool = require("../db/pool");
const ageRouter = require("../routes/age");
const { ensureStructureObservationSchema } = require("./structureObservations");

const AGE_REFRESH_LOCK_ID = "839116715297120931";
const DEFAULT_BATCH_SIZE = 250;
const MAX_BATCH_SIZE = 1000;

let activeRefresh = null;

class AgeRefreshInProgressError extends Error {
  constructor() {
    super("age_refresh_in_progress");
    this.name = "AgeRefreshInProgressError";
    this.code = "age_refresh_in_progress";
  }
}

function normalizeAgeUpdate(structureId, estimate) {
  const data = estimate?.data;
  if (estimate?.status !== 200 || !data) return null;

  const mid = Date.parse(data.midISO);
  const low = Date.parse(data.lowISO);
  const high = Date.parse(data.highISO);
  const daysWide = Number(data.daysWide);
  if (
    typeof data.method !== "string" || !data.method ||
    !Number.isFinite(mid) || !Number.isFinite(low) || !Number.isFinite(high) ||
    !Number.isFinite(daysWide) || daysWide < 0
  ) {
    throw new Error("invalid_age_estimate");
  }

  return {
    structureId: String(structureId),
    method: data.method,
    midISO: new Date(mid).toISOString(),
    lowISO: new Date(low).toISOString(),
    highISO: new Date(high).toISOString(),
    daysWide,
  };
}

async function updateAgeBatch(client, updates) {
  if (!updates.length) return 0;
  const result = await client.query(
    `UPDATE structure_observations AS observation
     SET age_method = refreshed.age_method,
         age_mid = refreshed.age_mid,
         age_low = refreshed.age_low,
         age_high = refreshed.age_high,
         age_window_days = refreshed.age_window_days
     FROM unnest(
       $1::bigint[],
       $2::text[],
       $3::timestamptz[],
       $4::timestamptz[],
       $5::timestamptz[],
       $6::double precision[]
     ) AS refreshed(
       structure_id,
       age_method,
       age_mid,
       age_low,
       age_high,
       age_window_days
     )
     WHERE observation.structure_id = refreshed.structure_id
       AND ROW(
         observation.age_method,
         observation.age_mid,
         observation.age_low,
         observation.age_high,
         observation.age_window_days
       ) IS DISTINCT FROM ROW(
         refreshed.age_method,
         refreshed.age_mid,
         refreshed.age_low,
         refreshed.age_high,
         refreshed.age_window_days
       )
     RETURNING observation.structure_id`,
    [
      updates.map((row) => row.structureId),
      updates.map((row) => row.method),
      updates.map((row) => row.midISO),
      updates.map((row) => row.lowISO),
      updates.map((row) => row.highISO),
      updates.map((row) => row.daysWide),
    ]
  );
  return Number.isInteger(result.rowCount) ? result.rowCount : result.rows.length;
}

async function runObservationAgeRefresh(options = {}) {
  const reloadAgeIndex = options.reloadAgeIndex || ageRouter.reloadAgeIndexExclusive;
  const estimateStructureAge = options.estimateStructureAge || ageRouter.estimateStructureAge;
  const ensureSchema = options.ensureSchema || ensureStructureObservationSchema;
  const connect = options.connect || (() => pool.connect());
  const requestedBatchSize = Number(options.batchSize) || DEFAULT_BATCH_SIZE;
  const batchSize = Math.max(1, Math.min(MAX_BATCH_SIZE, Math.floor(requestedBatchSize)));

  await ensureSchema();
  const client = await connect();
  let lockAcquired = false;
  let releaseError = null;
  try {
    const lockResult = await client.query(
      "SELECT pg_try_advisory_lock($1::bigint) AS acquired",
      [AGE_REFRESH_LOCK_ID]
    );
    lockAcquired = lockResult.rows[0]?.acquired === true;
    if (!lockAcquired) throw new AgeRefreshInProgressError();

    // Reload atomically before the first estimate. If the replacement file is
    // unreadable, the job fails without touching any database rows.
    await reloadAgeIndex();

    const snapshot = await client.query(
      "SELECT MAX(structure_id)::text AS max_structure_id FROM structure_observations"
    );
    const maxStructureId = snapshot.rows[0]?.max_structure_id || null;
    if (!maxStructureId) {
      return { scanned: 0, updated: 0, skipped: 0, failed: 0 };
    }

    let cursor = "0";
    let scanned = 0;
    let updated = 0;
    let skipped = 0;
    let failed = 0;

    while (true) {
      const page = await client.query(
        `SELECT structure_id::text AS structure_id
         FROM structure_observations
         WHERE structure_id > $1::bigint
           AND structure_id <= $2::bigint
         ORDER BY structure_id ASC
         LIMIT $3`,
        [cursor, maxStructureId, batchSize]
      );
      if (!page.rows.length) break;

      cursor = String(page.rows[page.rows.length - 1].structure_id);
      scanned += page.rows.length;
      const ageUpdates = [];
      for (const row of page.rows) {
        try {
          const estimate = estimateStructureAge(row.structure_id);
          if (estimate?.status !== 200 || !estimate?.data) {
            skipped += 1;
            continue;
          }
          ageUpdates.push(normalizeAgeUpdate(row.structure_id, estimate));
        } catch {
          failed += 1;
        }
      }

      try {
        const batchUpdated = await updateAgeBatch(client, ageUpdates);
        updated += batchUpdated;
        skipped += Math.max(0, ageUpdates.length - batchUpdated);
      } catch (error) {
        failed += ageUpdates.length;
        console.warn(
          `[structure-observations] age refresh batch failed (${ageUpdates.length} rows):`,
          error?.message || error
        );
      }

      if (page.rows.length < batchSize) break;
    }

    return { scanned, updated, skipped, failed };
  } finally {
    if (lockAcquired) {
      try {
        const unlockResult = await client.query(
          "SELECT pg_advisory_unlock($1::bigint) AS unlocked",
          [AGE_REFRESH_LOCK_ID]
        );
        if (unlockResult.rows[0]?.unlocked !== true) {
          throw new Error("age_refresh_lock_not_released");
        }
      } catch (error) {
        releaseError = error;
        console.warn("[structure-observations] age refresh lock release failed:", error?.message || error);
      }
    }
    // A failed unlock means this session must not go back into the pool while
    // it may still own the advisory lock. Passing the error makes pg destroy it.
    client.release(releaseError || undefined);
  }
}

function startRefresh(runRefresh) {
  if (activeRefresh) return null;
  const refresh = runRefresh();
  activeRefresh = refresh;
  void refresh.then(
    () => { if (activeRefresh === refresh) activeRefresh = null; },
    () => { if (activeRefresh === refresh) activeRefresh = null; }
  );
  return refresh;
}

function startObservationAgeRefresh() {
  return startRefresh(runObservationAgeRefresh);
}

function observationAgeRefreshInProgress() {
  return Boolean(activeRefresh);
}

module.exports = {
  AgeRefreshInProgressError,
  startObservationAgeRefresh,
  observationAgeRefreshInProgress,
  _test: {
    AGE_REFRESH_LOCK_ID,
    normalizeAgeUpdate,
    updateAgeBatch,
    runObservationAgeRefresh,
    startRefresh,
  },
};
