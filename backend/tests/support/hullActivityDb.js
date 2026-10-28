const { PGlite } = require('@electric-sql/pglite');

async function createHullTestDb() {
  const database = new PGlite();
  await database.exec(`
    CREATE SCHEMA evesde;
    CREATE TABLE evesde."mapRegions" ("regionID" integer PRIMARY KEY, "regionName" text);
    CREATE TABLE evesde."invCategories" ("categoryID" integer PRIMARY KEY, "categoryName" text);
    CREATE TABLE evesde."invGroups" ("groupID" integer PRIMARY KEY, "groupName" text, "categoryID" integer);
    CREATE TABLE evesde."invTypes" ("typeID" integer PRIMARY KEY, "typeName" text, "groupID" integer, published boolean);
    ALTER TABLE evesde."invTypes" ADD COLUMN "marketGroupID" integer;
    CREATE TABLE evesde."invMarketGroups" ("marketGroupID" integer PRIMARY KEY, "marketGroupName" text);
    CREATE TABLE market_history_daily (date date, region_id integer, type_id integer, volume bigint, PRIMARY KEY (date, region_id, type_id));
    CREATE INDEX mh_forge_date_type ON market_history_daily (region_id, date, type_id);
    CREATE INDEX idx_mh_type_region_date ON market_history_daily (type_id, region_id, date DESC);
    INSERT INTO evesde."mapRegions" VALUES (10000002, 'The Forge'), (10000043, 'Domain'), (10000030, 'Heimatar');
    INSERT INTO evesde."invCategories" VALUES (6, 'Ship'), (7, 'Module'), (99, 'Ship Equipment');
    INSERT INTO evesde."invGroups" VALUES (1, 'Cruiser', 6), (2, 'Module', 7), (3, 'Equipment', 99);
    INSERT INTO evesde."invTypes" VALUES
      (1, 'Boundary hull', 1, true), (2, 'No trades today', 1, true), (3, 'Never traded', 1, true),
      (4, 'Unpublished ship', 1, false), (5, 'Module', 2, true), (6, 'Equipment', 3, true),
      (7, 'New hull', 1, true), (8, 'Unknown publication', 1, null);
    INSERT INTO market_history_daily
      SELECT '2026-09-15'::date - d, 10000002, 5, 1 FROM generate_series(-1, 40) d;
    INSERT INTO market_history_daily VALUES
      ('2026-09-15', 10000002, 1, 7000),
      ('2026-09-14', 10000002, 1, 7),
      ('2026-09-08', 10000002, 1, 14),
      ('2026-09-07', 10000002, 1, 30),
      ('2026-08-16', 10000002, 1, 60),
      ('2026-08-15', 10000002, 1, 365),
      ('2025-09-15', 10000002, 1, 730),
      ('2025-09-14', 10000002, 1, 999999),
      ('2026-09-16', 10000002, 1, 999999),
      ('2026-09-14', 10000002, 2, 70),
      ('2026-09-15', 10000002, 4, 999999),
      ('2026-09-15', 10000002, 7, 20),
      ('2026-09-14', 10000043, 1, 10),
      ('2026-09-13', 10000043, 1, 30);
  `);
  return database;
}

module.exports = { createHullTestDb };
