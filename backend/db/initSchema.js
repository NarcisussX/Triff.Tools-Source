/*
 * Database helper for init Schema.
 * Configures Postgres access or schema initialization used by backend routes and services.
 */

const pool = require("./pool");

const SQL = `

-- Local SDE slice for fast name->id lookups
create table if not exists inv_types (
  type_id       int primary key,
  type_name     text not null,
  volume        numeric not null default 0,
  published     boolean not null default false
);

-- Case-insensitive name lookups
create index if not exists inv_types_name_lower_idx
  on inv_types (lower(type_name));

-- Big 5 station-only aggregates
create table if not exists market_station_aggregates (
  station_id    bigint  not null,
  type_id       int     not null,
  sell_min      numeric,
  buy_max       numeric,
  sell_5pct     numeric,
  buy_5pct      numeric,
  last_updated  timestamptz not null default now(),
  primary key (station_id, type_id)
);

create table if not exists esi_page_state (
  region_id     int not null,
  page          int not null,
  etag          text,
  last_modified text,
  x_pages       int,
  last_checked  timestamptz not null default now(),
  primary key (region_id, page)
);

-- Saved appraisal snapshots
create table if not exists appraisals (
  id            text primary key,             -- short base62 id, e.g. "re057K"
  created_at    timestamptz not null default now(),
  station_id    bigint not null,              -- which hub the prices came from
  mode          text not null check (mode in ('buy','sell','split','buy5','sell5')),
  input_raw     text not null,                -- pasted input (raw, for audit/share)
  totals        jsonb not null,               -- { volume, buy, sell, split, itemCount }
  rows          jsonb not null,               -- [{type_id,name,qty,m3,price,lineISK,source}]
  version       int not null default 1
);

-- Lightweight cache for name -> type_id + m3 (used if SDE inv_types is not present)
create table if not exists type_cache (
  name_lower      text primary key,          -- lowercased exact name
  type_id         int not null,
  canonical_name  text not null,
  m3              numeric not null default 0,
  updated_at      timestamptz not null default now()
);

-- Live public orders
CREATE TABLE IF NOT EXISTS market_orders_current (
  order_id       BIGINT PRIMARY KEY,
  type_id        INT NOT NULL,
  region_id      INT NOT NULL,
  system_id      INT NOT NULL,
  location_id    BIGINT NOT NULL,
  is_buy_order   BOOLEAN NOT NULL,
  price          NUMERIC(18,2) NOT NULL,
  volume_total   BIGINT NOT NULL,
  volume_remain  BIGINT NOT NULL,
  min_volume     INT NOT NULL,
  issued         TIMESTAMPTZ NOT NULL,
  duration       INT NOT NULL,
  range          INT NOT NULL,
  reported_at    TIMESTAMPTZ NOT NULL,
  last_seen      TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_moc_type_isbuy
  ON market_orders_current(type_id, is_buy_order);
CREATE INDEX IF NOT EXISTS idx_moc_region_type
  ON market_orders_current(region_id, type_id);
CREATE INDEX IF NOT EXISTS idx_moc_location_type
  ON market_orders_current(location_id, type_id);
CREATE INDEX IF NOT EXISTS idx_moc_location_type_isbuy_price
  ON market_orders_current(location_id, type_id, is_buy_order, price);

-- Everef-style daily history (420 complete UTC days of raw storage)
CREATE TABLE IF NOT EXISTS market_history_daily (
  date        DATE NOT NULL,
  region_id   INT NOT NULL,
  type_id     INT NOT NULL,
  low_price   NUMERIC(18,2),
  high_price  NUMERIC(18,2),
  avg_price   NUMERIC(18,2),
  volume      BIGINT,
  orders      INT,
  PRIMARY KEY (date, region_id, type_id)
);

CREATE TABLE IF NOT EXISTS esi_etags (
  endpoint      text PRIMARY KEY,
  etag          text,
  last_modified timestamptz
);

CREATE INDEX IF NOT EXISTS idx_mhd_type_region_date
  ON market_history_daily(type_id, region_id, date DESC);

create index if not exists idx_appraisals_created_at on appraisals (created_at desc);
create index if not exists idx_market_station_last_updated on market_station_aggregates (last_updated desc);
CREATE INDEX IF NOT EXISTS idx_mh_date_region_type ON public.market_history_daily (date, region_id, type_id);
CREATE INDEX IF NOT EXISTS mh_forge_date_type ON public.market_history_daily (region_id, date, type_id);

CREATE TABLE IF NOT EXISTS fitting_shared_fits (
  id text PRIMARY KEY,
  content_hash text NOT NULL,
  eft_text text NOT NULL,
  fit_name text NOT NULL,
  ship_type_id integer NOT NULL,
  ship_name text NOT NULL,
  source text,
  source_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_opened_at timestamptz,
  access_count integer NOT NULL DEFAULT 0,
  version integer NOT NULL DEFAULT 1
);

CREATE UNIQUE INDEX IF NOT EXISTS fitting_shared_fits_content_hash_idx
  ON fitting_shared_fits(content_hash);

CREATE INDEX IF NOT EXISTS fitting_shared_fits_created_idx
  ON fitting_shared_fits(created_at DESC);

CREATE TABLE IF NOT EXISTS dscan_reports (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  scan_type text NOT NULL,
  input_raw text NOT NULL,
  report jsonb NOT NULL,
  version integer NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS dscan_reports_created_idx
  ON dscan_reports(created_at DESC);

CREATE TABLE IF NOT EXISTS triff_local_reports (
  id text PRIMARY KEY,
  title text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  input_raw text NOT NULL,
  parsed_names jsonb NOT NULL,
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  report jsonb NOT NULL,
  version integer NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS triff_local_reports_created_idx
  ON triff_local_reports(created_at DESC);

CREATE TABLE IF NOT EXISTS triff_local_cache (
  cache_key text PRIMARY KEY,
  kind text NOT NULL,
  payload jsonb NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS triff_local_cache_expires_idx
  ON triff_local_cache(expires_at);

CREATE TABLE IF NOT EXISTS worker_heartbeats (
  worker_name text PRIMARY KEY,
  last_started_at timestamptz,
  last_success_at timestamptz,
  last_failure_at timestamptz,
  last_error text,
  last_duration_ms integer,
  last_rows bigint,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS worker_heartbeats_success_idx
  ON worker_heartbeats(last_success_at DESC);

CREATE SCHEMA IF NOT EXISTS evesde;

-- Empty shells let app views compile on a fresh database while the SDE importer
-- is still loading the full YAML dataset.
CREATE TABLE IF NOT EXISTS evesde."invTypes" (
  "typeID"         integer PRIMARY KEY,
  "groupID"        integer,
  "typeName"       text,
  "description"    text,
  "mass"           double precision,
  "volume"         double precision,
  "capacity"       double precision,
  "portionSize"    integer,
  "published"      boolean,
  "marketGroupID"  integer,
  "metaGroupID"    integer,
  "metaLevel"      integer,
  "variationParentTypeID" integer,
  "iconID"         integer,
  "soundID"        integer,
  "graphicID"      integer,
  "packagedVolume" double precision,
  "radius"         double precision,
  "traits"         jsonb
);

ALTER TABLE evesde."invTypes"
  ADD COLUMN IF NOT EXISTS "metaGroupID" integer,
  ADD COLUMN IF NOT EXISTS "metaLevel" integer,
  ADD COLUMN IF NOT EXISTS "variationParentTypeID" integer,
  ADD COLUMN IF NOT EXISTS "packagedVolume" double precision,
  ADD COLUMN IF NOT EXISTS "radius" double precision,
  ADD COLUMN IF NOT EXISTS "traits" jsonb;

CREATE INDEX IF NOT EXISTS evesde_invTypes_marketGroup_idx
  ON evesde."invTypes" ("marketGroupID");

CREATE INDEX IF NOT EXISTS evesde_invTypes_variationParent_idx
  ON evesde."invTypes" ("variationParentTypeID");

CREATE TABLE IF NOT EXISTS evesde."invMarketGroups" (
  "marketGroupID"   integer PRIMARY KEY,
  "parentGroupID"   integer,
  "marketGroupName" text,
  "description"     text,
  "hasTypes"        boolean,
  "iconID"          integer
);

CREATE TABLE IF NOT EXISTS evesde."invMetaGroups" (
  "metaGroupID"   integer PRIMARY KEY,
  "metaGroupName" text,
  "description"   text,
  "iconID"        integer
);

ALTER TABLE evesde."invMetaGroups"
  ADD COLUMN IF NOT EXISTS "metaGroupName" text,
  ADD COLUMN IF NOT EXISTS "description" text,
  ADD COLUMN IF NOT EXISTS "iconID" integer;

CREATE TABLE IF NOT EXISTS evesde."invMetaTypes" (
  "typeID"       integer PRIMARY KEY,
  "parentTypeID" integer,
  "metaGroupID"  integer
);

ALTER TABLE evesde."invMetaTypes"
  ADD COLUMN IF NOT EXISTS "parentTypeID" integer,
  ADD COLUMN IF NOT EXISTS "metaGroupID" integer;

CREATE INDEX IF NOT EXISTS evesde_invMetaTypes_parent_idx
  ON evesde."invMetaTypes" ("parentTypeID");

CREATE INDEX IF NOT EXISTS evesde_invMetaTypes_metaGroup_idx
  ON evesde."invMetaTypes" ("metaGroupID");

CREATE TABLE IF NOT EXISTS evesde."invCategories" (
  "categoryID"   integer PRIMARY KEY,
  "categoryName" text
);

CREATE TABLE IF NOT EXISTS evesde."invGroups" (
  "groupID"      integer PRIMARY KEY,
  "categoryID"   integer,
  "groupName"    text
);

CREATE INDEX IF NOT EXISTS evesde_invGroups_category_idx
  ON evesde."invGroups" ("categoryID");

CREATE TABLE IF NOT EXISTS evesde.inv_categories (
  category_id   integer PRIMARY KEY,
  category_name text
);

CREATE TABLE IF NOT EXISTS evesde.inv_groups (
  group_id      integer PRIMARY KEY,
  category_id   integer,
  group_name    text
);

CREATE INDEX IF NOT EXISTS evesde_inv_groups_category_idx
  ON evesde.inv_groups (category_id);

CREATE TABLE IF NOT EXISTS evesde."typeDogmaAttributes" (
  "typeID"      integer NOT NULL,
  "attributeID" integer NOT NULL,
  "value"       double precision,
  PRIMARY KEY ("typeID","attributeID")
);

CREATE INDEX IF NOT EXISTS evesde_typeDogmaAttributes_attr_idx
  ON evesde."typeDogmaAttributes" ("attributeID");

CREATE OR REPLACE VIEW public.pos_towers AS
WITH RECURSIVE ct_root AS (
  SELECT mg."marketGroupID", mg."parentGroupID", mg."marketGroupName"
  FROM evesde."invMarketGroups" mg
  WHERE mg."marketGroupName" = 'Control Towers'
),
ct_ancestors AS (
  SELECT "marketGroupID", "parentGroupID", "marketGroupName"
  FROM ct_root
  UNION ALL
  SELECT p."marketGroupID", p."parentGroupID", p."marketGroupName"
  FROM evesde."invMarketGroups" p
  JOIN ct_ancestors a ON a."parentGroupID" = p."marketGroupID"
),
ct_desc AS (
  SELECT "marketGroupID" FROM ct_root
  UNION ALL
  SELECT c."marketGroupID"
  FROM evesde."invMarketGroups" c
  JOIN ct_desc d ON c."parentGroupID" = d."marketGroupID"
),
valid AS (
  SELECT 1 ok
  FROM ct_ancestors
  WHERE "marketGroupName" = 'Starbase Structures'
  LIMIT 1
)
SELECT
  t."typeID"        AS type_id,
  t."typeName"      AS name,
  t."marketGroupID" AS group_id,
  mg."marketGroupName" AS group_name,
  t."volume"        AS volume_m3,
  t."capacity"      AS capacity_m3
FROM evesde."invTypes" t
JOIN ct_desc d ON d."marketGroupID" = t."marketGroupID"
JOIN evesde."invMarketGroups" mg ON mg."marketGroupID" = t."marketGroupID"
JOIN valid v ON v.ok = 1
JOIN evesde."invGroups" g ON g."groupID" = t."groupID"
JOIN evesde."invCategories" c ON c."categoryID" = g."categoryID"
WHERE t."published" = true
  AND c."categoryName" <> 'Blueprint';

CREATE OR REPLACE VIEW public.pos_modules AS
WITH RECURSIVE sb_root AS (
  SELECT mg."marketGroupID"
  FROM evesde."invMarketGroups" mg
  WHERE mg."marketGroupName" = 'Starbase Structures'
),
sb_desc AS (
  SELECT "marketGroupID" FROM sb_root
  UNION ALL
  SELECT c."marketGroupID"
  FROM evesde."invMarketGroups" c
  JOIN sb_desc d ON c."parentGroupID" = d."marketGroupID"
),
ct_root AS (
  SELECT mg."marketGroupID"
  FROM evesde."invMarketGroups" mg
  WHERE mg."marketGroupName" = 'Control Towers'
),
ct_desc AS (
  SELECT "marketGroupID" FROM ct_root
  UNION ALL
  SELECT c."marketGroupID"
  FROM evesde."invMarketGroups" c
  JOIN ct_desc d ON c."parentGroupID" = d."marketGroupID"
)
SELECT
  t."typeID"        AS type_id,
  t."typeName"      AS name,
  t."marketGroupID" AS group_id,
  mg."marketGroupName" AS group_name,
  t."volume"        AS volume_m3
FROM evesde."invTypes" t
JOIN sb_desc s ON s."marketGroupID" = t."marketGroupID"
JOIN evesde."invMarketGroups" mg ON mg."marketGroupID" = t."marketGroupID"
LEFT JOIN ct_desc ct ON ct."marketGroupID" = t."marketGroupID"
JOIN evesde."invGroups" g ON g."groupID" = t."groupID"
JOIN evesde."invCategories" c ON c."categoryID" = g."categoryID"
WHERE t."published" = true
  AND ct."marketGroupID" IS NULL
  AND c."categoryName" <> 'Blueprint';

`;

async function initSchema() {
  await pool.query(SQL);
}

module.exports = { initSchema };
