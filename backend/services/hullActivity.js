/* Regional daily ship volume. Both the API and social embeds use this service. */
const db = require('../lib/marketDb');

const DEFAULT_REGION_ID = 10000002;
const REGIONS_SQL = `
  SELECT "regionID" AS region_id, "regionName" AS region_name
  FROM evesde."mapRegions"
  ORDER BY CASE WHEN "regionID" = 10000002 THEN 0 ELSE 1 END, "regionName"
`;
const DATES_SQL = `
  SELECT to_char(date, 'YYYY-MM-DD') AS date FROM (
    SELECT DISTINCT date FROM public.market_history_daily
    WHERE region_id = $1 AND date < $2::date
    ORDER BY date DESC LIMIT 30
  ) days ORDER BY date DESC
`;
// Fixed calendar denominators are intentional: absent rows are zero-volume days.
// The existing (region_id, date, type_id) and (type_id, region_id, date) indexes
// cover this bounded aggregate; no additional history index is needed.
const ACTIVITY_SQL = `
  WITH hulls AS (
    SELECT t."typeID" AS type_id, t."typeName" AS type_name,
           g."groupName" AS group_name, mg."marketGroupName" AS market_group_name
    FROM evesde."invTypes" t
    JOIN evesde."invGroups" g ON g."groupID" = t."groupID"
    JOIN evesde."invCategories" c ON c."categoryID" = g."categoryID"
    LEFT JOIN evesde."invMarketGroups" mg ON mg."marketGroupID" = t."marketGroupID"
    WHERE t.published = TRUE AND c."categoryName" = 'Ship'
  ), averages AS (
    SELECT s.type_id, s.type_name, s.group_name, s.market_group_name,
      COALESCE(SUM(h.volume) FILTER (WHERE h.date = $2::date), 0)::double precision AS volume,
      (COALESCE(SUM(h.volume) FILTER (WHERE h.date >= $2::date - 7 AND h.date < $2::date), 0) / 7.0)::double precision AS avg_7d,
      (COALESCE(SUM(h.volume) FILTER (WHERE h.date >= $2::date - 30 AND h.date < $2::date), 0) / 30.0)::double precision AS avg_30d,
      (COALESCE(SUM(h.volume) FILTER (WHERE h.date >= $2::date - 365 AND h.date < $2::date), 0) / 365.0)::double precision AS avg_365d,
      (COALESCE(SUM(h.volume) FILTER (WHERE h.date BETWEEN $2::date - 6 AND $2::date), 0) / 7.0)::double precision AS avg_last_7d,
      (COALESCE(SUM(h.volume) FILTER (WHERE h.date BETWEEN $2::date - 36 AND $2::date - 7), 0) / 30.0)::double precision AS avg_prev_30d
    FROM hulls s
    LEFT JOIN public.market_history_daily h
      ON h.type_id = s.type_id AND h.region_id = $1
      AND h.date BETWEEN $2::date - 365 AND $2::date
    GROUP BY s.type_id, s.type_name, s.group_name, s.market_group_name
  )
  SELECT *,
    volume - avg_7d AS delta_7d,
    volume - avg_30d AS delta_30d,
    volume - avg_365d AS delta_365d,
    (volume - avg_7d) / NULLIF(avg_7d, 0) * 100 AS vs_7d_pct,
    (volume - avg_30d) / NULLIF(avg_30d, 0) * 100 AS vs_30d_pct,
    (volume - avg_365d) / NULLIF(avg_365d, 0) * 100 AS vs_365d_pct,
    avg_last_7d - avg_prev_30d AS delta_prev_30d,
    (avg_last_7d - avg_prev_30d) / NULLIF(avg_prev_30d, 0) * 100 AS vs_prev_30d_pct
  FROM averages
  ORDER BY vs_30d_pct DESC NULLS LAST, type_name, type_id
`;

class HullActivityError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function parseRegion(value) {
  if (value === undefined) return DEFAULT_REGION_ID;
  if (!/^\d+$/.test(String(value)) || !Number.isSafeInteger(Number(value)) || Number(value) <= 0 || Number(value) > 2147483647 || Array.isArray(value)) {
    throw new HullActivityError('Invalid region_id.');
  }
  return Number(value);
}

function parseDate(value, today) {
  if (value === undefined) return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new HullActivityError('Invalid date. Use YYYY-MM-DD.');
  }
  const date = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new HullActivityError('Invalid calendar date.');
  }
  if (value >= today) throw new HullActivityError('Date must be before the current UTC day.');
  return value;
}

function createHullActivityService(database = db, now = () => new Date()) {
  async function getRegions() {
    return (await database.query(REGIONS_SQL)).rows;
  }

  async function getActivity(params = {}) {
    const regionId = parseRegion(params.region_id);
    const today = now().toISOString().slice(0, 10);
    const requestedDate = parseDate(params.date, today);
    const regions = await getRegions();
    const region = regions.find((r) => Number(r.region_id) === regionId);
    if (!region) throw new HullActivityError('Unknown market region.');
    const availableDates = (await database.query(DATES_SQL, [regionId, today])).rows.map((r) => r.date);
    if (requestedDate && !availableDates.includes(requestedDate)) {
      throw new HullActivityError('Date is not among the last 30 complete available history dates.', 404);
    }
    const date = requestedDate || availableDates[0] || null;
    const hulls = date ? (await database.query(ACTIVITY_SQL, [regionId, date])).rows : [];
    return { region_id: regionId, region_name: region.region_name, date, available_dates: availableDates, hulls };
  }
  return { getActivity, getRegions };
}

module.exports = { ...createHullActivityService(), createHullActivityService, HullActivityError, ACTIVITY_SQL, DATES_SQL, DEFAULT_REGION_ID };
