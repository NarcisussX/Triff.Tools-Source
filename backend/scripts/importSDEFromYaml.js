/*
 * Maintenance script for import SDEFrom Yaml.
 * Reads environment or downloaded EVE data and writes database/import artifacts when run manually.
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const { pipeline } = require("stream");
const { promisify } = require("util");
const { Pool } = require("pg");
const YAML = require("yaml");
const { spawn } = require("child_process");

const streamPipeline = promisify(pipeline);

const LATEST_META_URL =
  "https://developers.eveonline.com/static-data/tranquility/latest.jsonl";
const LATEST_YAML_ZIP =
  "https://developers.eveonline.com/static-data/eve-online-static-data-latest-yaml.zip";

if (!process.env.DATABASE_URL) {
  console.error("[SDE_IMPORT]: DATABASE_URL not set");
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const ACTIVITY_IDS = {
  manufacturing: 1,
  research_time_efficiency: 3,
  research_material_efficiency: 4,
  copying: 5,
  invention: 8,
  reaction: 11,
};

function localizedEnglish(value) {
  if (value == null) return null;
  if (typeof value === "string") return value;
  if (typeof value === "object") {
    return (
      value.en ??
      value["en-us"] ??
      value.en_US ??
      Object.values(value).find((entry) => typeof entry === "string") ??
      null
    );
  }
  return String(value);
}

function firstText(...values) {
  for (const value of values) {
    if (value == null || (typeof value !== "string" && typeof value !== "object")) continue;
    const text = localizedEnglish(value);
    if (text && text.trim()) return text.trim();
  }
  return null;
}

async function getFetch() {
  if (typeof global.fetch === "function") return global.fetch;

  const fetch = (await import("node-fetch")).default;
  return fetch;
}

async function tableExists(regclassName) {
  const { rows } = await pool.query(`SELECT to_regclass($1) IS NOT NULL AS exists`, [regclassName]);
  return !!rows[0]?.exists;
}

async function ensureEvesdeSchema() {
  await pool.query(`CREATE SCHEMA IF NOT EXISTS evesde;`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS evesde._meta (
      key   text PRIMARY KEY,
      value text NOT NULL
    );
  `);
}

async function getCurrentBuild() {
  const { rows } = await pool.query(
    `SELECT value FROM evesde._meta WHERE key = 'sde_build' LIMIT 1`
  );
  return rows[0]?.value || null;
}

async function setCurrentBuild(build) {
  await pool.query(
    `
    INSERT INTO evesde._meta (key, value)
    VALUES ('sde_build', $1)
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
    `,
    [String(build)]
  );
}

async function hasImportedTypeTraits() {
  try {
    const { rows } = await pool.query(`
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'evesde'
          AND table_name = 'invTypes'
          AND column_name = 'traits'
      ) AS has_column
    `);
    if (!rows[0]?.has_column) return false;

    const count = await pool.query(`
      SELECT COUNT(*)::integer AS count
      FROM evesde."invTypes"
      WHERE "traits" IS NOT NULL
    `);
    return Number(count.rows[0]?.count || 0) > 0;
  } catch {
    return false;
  }
}

async function hasIndustryPrimaryKeys() {
  try {
    const { rows } = await pool.query(`
      SELECT COUNT(*)::integer AS count
      FROM pg_constraint
      WHERE contype = 'p'
        AND conrelid IN (
          'evesde."industryBlueprints"'::regclass,
          'evesde."industryActivity"'::regclass,
          'evesde."industryActivityProducts"'::regclass,
          'evesde."industryActivityMaterials"'::regclass
        )
    `);
    return Number(rows[0]?.count || 0) === 4;
  } catch {
    return false;
  }
}

async function hasFittingMetaTables() {
  try {
    const { rows } = await pool.query(`
      SELECT
        to_regclass('evesde."invMetaGroups"') IS NOT NULL AS has_meta_groups,
        to_regclass('evesde."invMetaTypes"') IS NOT NULL AS has_meta_types
    `);
    if (!rows[0]?.has_meta_groups || !rows[0]?.has_meta_types) return false;

    const counts = await pool.query(`
      SELECT
        (SELECT COUNT(*)::integer FROM evesde."invMetaGroups") AS meta_groups,
        (SELECT COUNT(*)::integer FROM evesde."invMetaTypes") AS meta_types
    `);
    return Number(counts.rows[0]?.meta_groups || 0) > 0 && Number(counts.rows[0]?.meta_types || 0) > 0;
  } catch {
    return false;
  }
}

async function getLatestSDEBuildNumber() {
  const fetch = await getFetch();
  const res = await fetch(LATEST_META_URL);
  if (!res.ok) {
    throw new Error(
      `[SDE_IMPORT]: Failed to fetch latest.jsonl (${res.status})`
    );
  }
  const text = await res.text();
  const lines = text.split("\n").filter(Boolean);
  for (const line of lines) {
    const obj = JSON.parse(line);
    if (obj._key === "sde" && obj.buildNumber) {
      return String(obj.buildNumber);
    }
  }
  throw new Error(
    "[SDE_IMPORT]: Could not find 'sde' buildNumber in latest.jsonl"
  );
}

async function downloadFile(url, destPath) {
  const fetch = await getFetch();
  console.log(`[SDE_IMPORT]: Downloading SDE from ${url}…`);
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(
      `[SDE_IMPORT]: Failed to download SDE zip (${res.status})`
    );
  }
  await streamPipeline(res.body, fs.createWriteStream(destPath));
  console.log(`[SDE_IMPORT]: Downloaded to ${destPath}`);
}

async function extractZip(zipPath, outDir) {
  console.log(`[SDE_IMPORT]: Extracting ${zipPath} to ${outDir}…`);
  await fs.promises.mkdir(outDir, { recursive: true });

  await new Promise((resolve, reject) => {
    const proc = spawn("unzip", ["-q", zipPath, "-d", outDir]);

    proc.on("error", (err) => {
      reject(
        new Error(`[SDE_IMPORT]: unzip failed to start: ${err.message}`)
      );
    });

    proc.on("exit", (code) => {
      if (code === 0) {
        console.log("[SDE_IMPORT]: Extraction complete.");
        resolve();
      } else {
        reject(new Error(`[SDE_IMPORT]: unzip exited with code ${code}`));
      }
    });
  });
}

async function ensureInvTypesTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS evesde."invTypes" (
      "typeID"        integer PRIMARY KEY,
      "groupID"       integer,
      "typeName"      text,
      "description"   text,
      "mass"          double precision,
      "volume"        double precision,
      "capacity"      double precision,
      "portionSize"   integer,
      "published"     boolean,
      "marketGroupID" integer,
      "metaGroupID" integer,
      "metaLevel" integer,
      "variationParentTypeID" integer,
      "iconID"        integer,
      "soundID"       integer,
      "graphicID"     integer,
      "packagedVolume" double precision,
      "radius"        double precision,
      "traits"        jsonb
    );
  `);

  await pool.query(`
    ALTER TABLE evesde."invTypes"
      ADD COLUMN IF NOT EXISTS "metaGroupID" integer,
      ADD COLUMN IF NOT EXISTS "metaLevel" integer,
      ADD COLUMN IF NOT EXISTS "variationParentTypeID" integer,
      ADD COLUMN IF NOT EXISTS "packagedVolume" double precision,
      ADD COLUMN IF NOT EXISTS "radius" double precision,
      ADD COLUMN IF NOT EXISTS "traits" jsonb;
  `);

  await pool.query(`TRUNCATE evesde."invTypes";`);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS evesde_invTypes_typeName_lower_idx
      ON evesde."invTypes" (lower("typeName"));
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS evesde_invTypes_published_typeName_idx
      ON evesde."invTypes" ("published", lower("typeName"));
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS evesde_invTypes_group_idx
      ON evesde."invTypes" ("groupID");
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS evesde_invTypes_marketGroup_idx
      ON evesde."invTypes" ("marketGroupID");
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS evesde_invTypes_variationParent_idx
      ON evesde."invTypes" ("variationParentTypeID");
  `);
}

async function importTypeIDs(sdeRootDir) {
  const typeIdsPath = path.join(sdeRootDir, "types.yaml");
  console.log(`[SDE_IMPORT]: Loading ${typeIdsPath}…`);

  const yamlText = await fs.promises.readFile(typeIdsPath, "utf8");
  const doc = YAML.parse(yamlText);

  if (!doc || typeof doc !== "object") {
    throw new Error("[SDE_IMPORT]: types.yaml did not parse into an object");
  }

  await ensureInvTypesTable();

  const entries = Object.entries(doc);
  console.log(
    `[SDE_IMPORT]: Parsed ${entries.length.toLocaleString()} types; inserting…`
  );

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const batchSize = 2000;
    for (let i = 0; i < entries.length; i += batchSize) {
      const slice = entries.slice(i, i + batchSize);

      const values = [];
      const params = [];

      slice.forEach(([typeIdStr, rec]) => {
        const typeID = Number(typeIdStr);
        if (!Number.isFinite(typeID)) return;

        const groupID = rec.groupID ?? null;
        const typeName = rec.name?.en ?? null;
        const description = rec.description?.en ?? null;
        const mass = rec.mass ?? null;
        const volume = rec.volume ?? null;
        const capacity = rec.capacity ?? null;
        const portionSize = rec.portionSize ?? null;
        const published = rec.published ?? true;
        const marketGroupID = rec.marketGroupID ?? null;
        const metaGroupID = rec.metaGroupID ?? rec.metaGroupId ?? null;
        const metaLevel = rec.metaLevel ?? rec.meta_level ?? null;
        const variationParentTypeID =
          rec.variationParentTypeID ??
          rec.variationParentTypeId ??
          rec.variation_parent_type_id ??
          null;
        const iconID = rec.iconID ?? null;
        const soundID = rec.soundID ?? null;
        const graphicID = rec.graphicID ?? null;
        const packagedVolume = rec.packagedVolume ?? rec.packaged_volume ?? null;
        const radius = rec.radius ?? null;
        const traits = rec.traits ? JSON.stringify(rec.traits) : null;

        const baseIndex = params.length;
        params.push(
          typeID,
          groupID,
          typeName,
          description,
          mass,
          volume,
          capacity,
          portionSize,
          published,
          marketGroupID,
          metaGroupID,
          metaLevel,
          variationParentTypeID,
          iconID,
          soundID,
          graphicID,
          packagedVolume,
          radius,
          traits
        );
        values.push(
          `($${baseIndex + 1}, $${baseIndex + 2}, $${baseIndex + 3}, $${baseIndex + 4}, $${baseIndex + 5}, $${baseIndex + 6}, $${baseIndex + 7}, $${baseIndex + 8}, $${baseIndex + 9}, $${baseIndex + 10}, $${baseIndex + 11}, $${baseIndex + 12}, $${baseIndex + 13}, $${baseIndex + 14}, $${baseIndex + 15}, $${baseIndex + 16}, $${baseIndex + 17}, $${baseIndex + 18}, $${baseIndex + 19}::jsonb)`
        );
      });

      if (!values.length) continue;

      const sql = `
        INSERT INTO evesde."invTypes" (
          "typeID","groupID","typeName","description","mass","volume",
          "capacity","portionSize","published","marketGroupID","metaGroupID","metaLevel","variationParentTypeID","iconID","soundID","graphicID",
          "packagedVolume","radius","traits"
        ) VALUES ${values.join(",")}
        ON CONFLICT ("typeID") DO UPDATE SET
          "groupID"       = EXCLUDED."groupID",
          "typeName"      = EXCLUDED."typeName",
          "description"   = EXCLUDED."description",
          "mass"          = EXCLUDED."mass",
          "volume"        = EXCLUDED."volume",
          "capacity"      = EXCLUDED."capacity",
          "portionSize"   = EXCLUDED."portionSize",
          "published"     = EXCLUDED."published",
          "marketGroupID" = EXCLUDED."marketGroupID",
          "metaGroupID"   = EXCLUDED."metaGroupID",
          "metaLevel"     = EXCLUDED."metaLevel",
          "variationParentTypeID" = EXCLUDED."variationParentTypeID",
          "iconID"        = EXCLUDED."iconID",
          "soundID"       = EXCLUDED."soundID",
          "graphicID"     = EXCLUDED."graphicID",
          "packagedVolume" = EXCLUDED."packagedVolume",
          "radius"        = EXCLUDED."radius",
          "traits"        = EXCLUDED."traits";
      `;
      await client.query(sql, params);
      console.log(
        `[SDE_IMPORT]: invTypes inserted ${Math.min(
          i + batchSize,
          entries.length
        )}/${entries.length}`
      );
    }

    await client.query("COMMIT");
    console.log('[SDE_IMPORT]: evesde."invTypes" import complete.');
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function seedInvTypesHelper() {
  console.log(
    '[SDE_IMPORT]: Seeding public.inv_types from evesde."invTypes"…'
  );
  await pool.query(`
    CREATE TABLE IF NOT EXISTS inv_types (
      type_id   integer PRIMARY KEY,
      type_name text    NOT NULL,
      volume    numeric NOT NULL DEFAULT 0,
      published boolean NOT NULL DEFAULT false
    );
  `);

  await pool.query(`
    INSERT INTO inv_types (type_id, type_name, volume, published)
    SELECT
      "typeID"                              AS type_id,
      COALESCE("typeName", '')              AS type_name,
      COALESCE("volume", 0)::numeric        AS volume,
      COALESCE("published", true)::boolean  AS published
    FROM evesde."invTypes"
    WHERE "typeName" IS NOT NULL
    ON CONFLICT (type_id) DO UPDATE SET
      type_name = EXCLUDED.type_name,
      volume    = EXCLUDED.volume,
      published = EXCLUDED.published;
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS inv_types_name_lower_idx
      ON inv_types (lower(type_name));
  `);

  console.log("[SDE_IMPORT]: inv_types seed complete.");
}

async function importTypeBonuses(sdeRootDir) {
  const yamlPath = await findSdeYamlFile(sdeRootDir, ["typeBonus.yaml"]);
  if (!yamlPath) {
    console.log("[SDE_IMPORT]: typeBonus.yaml not found; item traits will be unavailable.");
    return;
  }

  console.log(`[SDE_IMPORT]: Loading ${yamlPath}…`);
  const yamlText = await fs.promises.readFile(yamlPath, "utf8");
  const doc = YAML.parse(yamlText);

  if (!doc || typeof doc !== "object") {
    throw new Error("[SDE_IMPORT]: typeBonus.yaml did not parse into an object");
  }

  await pool.query(`
    ALTER TABLE evesde."invTypes"
      ADD COLUMN IF NOT EXISTS "traits" jsonb;
  `);
  await pool.query(`UPDATE evesde."invTypes" SET "traits" = NULL;`);

  const entries = Object.entries(doc);
  console.log(
    `[SDE_IMPORT]: Parsed ${entries.length.toLocaleString()} type bonus records; inserting…`
  );

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const batchSize = 1000;
    for (let i = 0; i < entries.length; i += batchSize) {
      const slice = entries.slice(i, i + batchSize);
      const values = [];
      const params = [];

      slice.forEach(([typeIdStr, rec]) => {
        const typeID = Number(typeIdStr);
        if (!Number.isFinite(typeID) || !rec) return;

        const baseIndex = params.length;
        params.push(typeID, JSON.stringify(rec));
        values.push(`($${baseIndex + 1}::integer, $${baseIndex + 2}::jsonb)`);
      });

      if (!values.length) continue;

      await client.query(
        `
        UPDATE evesde."invTypes" t
        SET "traits" = v.traits
        FROM (VALUES ${values.join(",")}) AS v("typeID", traits)
        WHERE t."typeID" = v."typeID"
        `,
        params
      );
      console.log(
        `[SDE_IMPORT]: typeBonuses inserted ${Math.min(i + batchSize, entries.length)}/${entries.length}`
      );
    }

    await client.query("COMMIT");
    console.log('[SDE_IMPORT]: evesde."invTypes"."traits" import complete.');
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function findSdeYamlFile(sdeRootDir, candidates) {
  for (const relPath of candidates) {
    const candidate = path.join(sdeRootDir, relPath);
    try {
      await fs.promises.access(candidate, fs.constants.R_OK);
      return candidate;
    } catch {
      // Try the next known layout.
    }
  }
  return null;
}

async function ensureInvVolumesTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS evesde."invVolumes" (
      "typeID" integer PRIMARY KEY,
      "volume" double precision
    );
  `);
  await pool.query(`
    ALTER TABLE evesde."invVolumes"
      ALTER COLUMN "volume" TYPE double precision USING "volume"::double precision;
  `);
  await pool.query(`TRUNCATE evesde."invVolumes";`);
}

function normalizeInvVolumeRows(doc) {
  const rows = [];
  if (Array.isArray(doc)) {
    for (const rec of doc) {
      const typeID = Number(rec?.typeID ?? rec?.typeId ?? rec?.type_id);
      const volume = Number(rec?.volume);
      if (Number.isFinite(typeID) && Number.isFinite(volume)) {
        rows.push({ typeID, volume });
      }
    }
    return rows;
  }

  for (const [typeIdStr, rec] of Object.entries(doc || {})) {
    const typeID = Number(typeIdStr);
    const rawVolume =
      typeof rec === "number" ? rec : rec?.volume ?? rec?.packagedVolume;
    const volume = Number(rawVolume);
    if (Number.isFinite(typeID) && Number.isFinite(volume)) {
      rows.push({ typeID, volume });
    }
  }
  return rows;
}

async function importInvVolumes(sdeRootDir) {
  const yamlPath = await findSdeYamlFile(sdeRootDir, [
    "invVolumes.yaml",
    path.join("bsd", "invVolumes.yaml"),
  ]);

  if (!yamlPath) {
    console.log("[SDE_IMPORT]: invVolumes.yaml not found; packaged volumes will use types.yaml when present.");
    return;
  }

  console.log(`[SDE_IMPORT]: Loading ${yamlPath}â€¦`);
  const yamlText = await fs.promises.readFile(yamlPath, "utf8");
  const doc = YAML.parse(yamlText);
  if (!doc || typeof doc !== "object") {
    throw new Error("[SDE_IMPORT]: invVolumes.yaml did not parse into an object");
  }

  const rows = normalizeInvVolumeRows(doc);
  await ensureInvVolumesTable();

  console.log(
    `[SDE_IMPORT]: Parsed ${rows.length.toLocaleString()} packaged volume rows; insertingâ€¦`
  );

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const batchSize = 2000;
    for (let i = 0; i < rows.length; i += batchSize) {
      const slice = rows.slice(i, i + batchSize);
      const typeIDs = slice.map((row) => row.typeID);
      const volumes = slice.map((row) => row.volume);

      await client.query(
        `
        INSERT INTO evesde."invVolumes" ("typeID","volume")
        SELECT * FROM UNNEST($1::int[], $2::double precision[])
        ON CONFLICT ("typeID") DO UPDATE SET
          "volume" = EXCLUDED."volume";
        `,
        [typeIDs, volumes]
      );

      console.log(
        `[SDE_IMPORT]: invVolumes inserted ${Math.min(i + batchSize, rows.length)}/${rows.length}`
      );
    }

    await client.query("COMMIT");
    console.log('[SDE_IMPORT]: evesde."invVolumes" import complete.');
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function ensureIndustryTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS evesde."industryBlueprints" (
      "typeID"             integer PRIMARY KEY,
      "maxProductionLimit" integer
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS evesde."industryActivity" (
      "typeID"    integer NOT NULL,
      "activityID" integer NOT NULL,
      "time"       integer,
      PRIMARY KEY ("typeID","activityID")
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS evesde."industryActivityProducts" (
      "typeID"        integer NOT NULL,
      "activityID"    integer NOT NULL,
      "productTypeID" integer NOT NULL,
      "quantity"      integer,
      PRIMARY KEY ("typeID","activityID","productTypeID")
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS evesde."industryActivityMaterials" (
      "typeID"         integer NOT NULL,
      "activityID"     integer NOT NULL,
      "materialTypeID" integer NOT NULL,
      "quantity"       integer,
      PRIMARY KEY ("typeID","activityID","materialTypeID")
    );
  `);
  await pool.query(`TRUNCATE evesde."industryBlueprints";`);
  await pool.query(`TRUNCATE evesde."industryActivity";`);
  await pool.query(`TRUNCATE evesde."industryActivityProducts";`);
  await pool.query(`TRUNCATE evesde."industryActivityMaterials";`);

  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'evesde."industryBlueprints"'::regclass AND contype = 'p'
      ) THEN
        ALTER TABLE evesde."industryBlueprints" ADD PRIMARY KEY ("typeID");
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'evesde."industryActivity"'::regclass AND contype = 'p'
      ) THEN
        ALTER TABLE evesde."industryActivity" ADD PRIMARY KEY ("typeID","activityID");
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'evesde."industryActivityProducts"'::regclass AND contype = 'p'
      ) THEN
        ALTER TABLE evesde."industryActivityProducts" ADD PRIMARY KEY ("typeID","activityID","productTypeID");
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'evesde."industryActivityMaterials"'::regclass AND contype = 'p'
      ) THEN
        ALTER TABLE evesde."industryActivityMaterials" ADD PRIMARY KEY ("typeID","activityID","materialTypeID");
      END IF;
    END $$;
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS evesde_industryProducts_product_idx
      ON evesde."industryActivityProducts" ("productTypeID");
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS evesde_industryMaterials_material_idx
      ON evesde."industryActivityMaterials" ("materialTypeID");
  `);
}

async function importBlueprints(sdeRootDir) {
  const blueprintsPath = path.join(sdeRootDir, "blueprints.yaml");
  console.log(`[SDE_IMPORT]: Loading ${blueprintsPath}…`);

  const yamlText = await fs.promises.readFile(blueprintsPath, "utf8");
  const doc = YAML.parse(yamlText);

  if (!doc || typeof doc !== "object") {
    throw new Error("[SDE_IMPORT]: blueprints.yaml did not parse into an object");
  }

  await ensureIndustryTables();

  const entries = Object.entries(doc);
  console.log(
    `[SDE_IMPORT]: Parsed ${entries.length.toLocaleString()} blueprints; inserting…`
  );

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const batchSize = 1000;
    for (let i = 0; i < entries.length; i += batchSize) {
      const slice = entries.slice(i, i + batchSize);

      const bpValues = [];
      const bpParams = [];
      const actValues = [];
      const actParams = [];
      const productValues = [];
      const productParams = [];
      const materialValues = [];
      const materialParams = [];

      slice.forEach(([bpIdStr, rec]) => {
        const typeID = Number(bpIdStr);
        if (!Number.isFinite(typeID)) return;

        const maxProductionLimit = rec.maxProductionLimit ?? null;

        let baseIndex = bpParams.length;
        bpParams.push(typeID, maxProductionLimit);
        bpValues.push(`($${baseIndex + 1}, $${baseIndex + 2})`);

        const activities = rec.activities || {};
        Object.entries(activities).forEach(([activityName, activity]) => {
          const activityID = ACTIVITY_IDS[activityName];
          if (!activityID) return;
          const time = activity.time ?? null;

          baseIndex = actParams.length;
          actParams.push(typeID, activityID, time);
          actValues.push(
            `($${baseIndex + 1}, $${baseIndex + 2}, $${baseIndex + 3})`
          );

          const products = Array.isArray(activity.products) ? activity.products : [];
          products.forEach((product) => {
            const productTypeID = Number(product?.typeID);
            if (!Number.isFinite(productTypeID)) return;
            const quantity = product?.quantity ?? null;
            const productBase = productParams.length;
            productParams.push(typeID, activityID, productTypeID, quantity);
            productValues.push(
              `($${productBase + 1}, $${productBase + 2}, $${productBase + 3}, $${productBase + 4})`
            );
          });

          const materials = Array.isArray(activity.materials) ? activity.materials : [];
          materials.forEach((material) => {
            const materialTypeID = Number(material?.typeID);
            if (!Number.isFinite(materialTypeID)) return;
            const quantity = material?.quantity ?? null;
            const materialBase = materialParams.length;
            materialParams.push(typeID, activityID, materialTypeID, quantity);
            materialValues.push(
              `($${materialBase + 1}, $${materialBase + 2}, $${materialBase + 3}, $${materialBase + 4})`
            );
          });
        });
      });

      if (bpValues.length) {
        const bpSql = `
          INSERT INTO evesde."industryBlueprints" (
            "typeID","maxProductionLimit"
          ) VALUES ${bpValues.join(",")}
          ON CONFLICT ("typeID") DO UPDATE SET
            "maxProductionLimit" = EXCLUDED."maxProductionLimit";
        `;
        await client.query(bpSql, bpParams);
      }

      if (actValues.length) {
        const actSql = `
          INSERT INTO evesde."industryActivity" (
            "typeID","activityID","time"
          ) VALUES ${actValues.join(",")}
          ON CONFLICT ("typeID","activityID") DO UPDATE SET
            "time" = EXCLUDED."time";
        `;
        await client.query(actSql, actParams);
      }

      if (productValues.length) {
        const productSql = `
          INSERT INTO evesde."industryActivityProducts" (
            "typeID","activityID","productTypeID","quantity"
          ) VALUES ${productValues.join(",")}
          ON CONFLICT ("typeID","activityID","productTypeID") DO UPDATE SET
            "quantity" = EXCLUDED."quantity";
        `;
        await client.query(productSql, productParams);
      }

      if (materialValues.length) {
        const materialSql = `
          INSERT INTO evesde."industryActivityMaterials" (
            "typeID","activityID","materialTypeID","quantity"
          ) VALUES ${materialValues.join(",")}
          ON CONFLICT ("typeID","activityID","materialTypeID") DO UPDATE SET
            "quantity" = EXCLUDED."quantity";
        `;
        await client.query(materialSql, materialParams);
      }

      console.log(
        `[SDE_IMPORT]: blueprints inserted ${Math.min(
          i + batchSize,
          entries.length
        )}/${entries.length}`
      );
    }

    await client.query("COMMIT");
    console.log('[SDE_IMPORT]: industry tables import complete.');
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function ensureInvMarketGroupsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS evesde."invMarketGroups" (
      "marketGroupID"   integer PRIMARY KEY,
      "parentGroupID"   integer,
      "marketGroupName" text,
      "description"     text,
      "hasTypes"        boolean,
      "iconID"          integer
    );
  `);
  await pool.query(`TRUNCATE evesde."invMarketGroups";`);
}

async function importMarketGroups(sdeRootDir) {
  const pathYaml = path.join(sdeRootDir, "marketGroups.yaml");
  console.log(`[SDE_IMPORT]: Loading ${pathYaml}…`);

  const yamlText = await fs.promises.readFile(pathYaml, "utf8");
  const doc = YAML.parse(yamlText);

  if (!doc || typeof doc !== "object") {
    throw new Error("[SDE_IMPORT]: marketGroups.yaml did not parse into an object");
  }

  await ensureInvMarketGroupsTable();

  const entries = Object.entries(doc);
  console.log(
    `[SDE_IMPORT]: Parsed ${entries.length.toLocaleString()} market groups; inserting…`
  );

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const batchSize = 2000;
    for (let i = 0; i < entries.length; i += batchSize) {
      const slice = entries.slice(i, i + batchSize);

      const values = [];
      const params = [];

      slice.forEach(([idStr, rec]) => {
        const marketGroupID = Number(idStr);
        if (!Number.isFinite(marketGroupID)) return;

        const parentGroupID = rec.parentGroupID ?? null;
        const marketGroupName = rec.name?.en ?? rec.marketGroupName ?? null;
        const description = rec.description?.en ?? rec.description ?? null;
        const hasTypes = rec.hasTypes ?? null;
        const iconID = rec.iconID ?? null;

        const baseIndex = params.length;
        params.push(
          marketGroupID,
          parentGroupID,
          marketGroupName,
          description,
          hasTypes,
          iconID
        );
        values.push(
          `($${baseIndex + 1}, $${baseIndex + 2}, $${baseIndex + 3}, $${baseIndex + 4}, $${baseIndex + 5}, $${baseIndex + 6})`
        );
      });

      if (!values.length) continue;

      const sql = `
        INSERT INTO evesde."invMarketGroups" (
          "marketGroupID","parentGroupID","marketGroupName","description","hasTypes","iconID"
        ) VALUES ${values.join(",")}
        ON CONFLICT ("marketGroupID") DO UPDATE SET
          "parentGroupID"   = EXCLUDED."parentGroupID",
          "marketGroupName" = EXCLUDED."marketGroupName",
          "description"     = EXCLUDED."description",
          "hasTypes"        = EXCLUDED."hasTypes",
          "iconID"          = EXCLUDED."iconID";
      `;
      await client.query(sql, params);
      console.log(
        `[SDE_IMPORT]: invMarketGroups inserted ${Math.min(
          i + batchSize,
          entries.length
        )}/${entries.length}`
      );
    }

    await client.query("COMMIT");
    console.log('[SDE_IMPORT]: evesde."invMarketGroups" import complete.');
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function ensureInvMetaGroupsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS evesde."invMetaGroups" (
      "metaGroupID"   integer PRIMARY KEY,
      "metaGroupName" text,
      "description"   text,
      "iconID"        integer
    );
  `);
  await pool.query(`TRUNCATE evesde."invMetaGroups";`);
}

async function importMetaGroups(sdeRootDir) {
  const yamlPath = await findSdeYamlFile(sdeRootDir, [
    "metaGroups.yaml",
    path.join("fsd", "metaGroups.yaml"),
  ]);
  if (!yamlPath) {
    throw new Error("[SDE_IMPORT]: metaGroups.yaml not found");
  }

  console.log(`[SDE_IMPORT]: Loading ${yamlPath}...`);

  const yamlText = await fs.promises.readFile(yamlPath, "utf8");
  const doc = YAML.parse(yamlText);

  if (!doc || typeof doc !== "object") {
    throw new Error("[SDE_IMPORT]: metaGroups.yaml did not parse into an object");
  }

  await ensureInvMetaGroupsTable();

  const entries = Object.entries(doc);
  console.log(
    `[SDE_IMPORT]: Parsed ${entries.length.toLocaleString()} meta groups; inserting...`
  );

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const values = [];
    const params = [];

    entries.forEach(([idStr, rec]) => {
      const metaGroupID = Number(idStr);
      if (!Number.isFinite(metaGroupID)) return;

      const metaGroupName =
        rec.name?.en ??
        rec.nameID?.en ??
        rec.metaGroupName ??
        (typeof rec.name === "string" ? rec.name : null);
      const description =
        rec.description?.en ??
        rec.descriptionID?.en ??
        (typeof rec.description === "string" ? rec.description : null);
      const iconID = rec.iconID ?? null;

      const baseIndex = params.length;
      params.push(metaGroupID, metaGroupName, description, iconID);
      values.push(
        `($${baseIndex + 1}, $${baseIndex + 2}, $${baseIndex + 3}, $${baseIndex + 4})`
      );
    });

    if (values.length) {
      await client.query(
        `
          INSERT INTO evesde."invMetaGroups" (
            "metaGroupID","metaGroupName","description","iconID"
          ) VALUES ${values.join(",")}
          ON CONFLICT ("metaGroupID") DO UPDATE SET
            "metaGroupName" = EXCLUDED."metaGroupName",
            "description"   = EXCLUDED."description",
            "iconID"        = EXCLUDED."iconID";
        `,
        params
      );
    }

    await client.query("COMMIT");
    console.log('[SDE_IMPORT]: evesde."invMetaGroups" import complete.');
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function ensureInvMetaTypesTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS evesde."invMetaTypes" (
      "typeID"       integer PRIMARY KEY,
      "parentTypeID" integer,
      "metaGroupID"  integer
    );
  `);
  await pool.query(`TRUNCATE evesde."invMetaTypes";`);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS evesde_invMetaTypes_parent_idx
      ON evesde."invMetaTypes" ("parentTypeID");
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS evesde_invMetaTypes_metaGroup_idx
      ON evesde."invMetaTypes" ("metaGroupID");
  `);
}

async function importMetaTypesFromInvTypes() {
  await ensureInvMetaTypesTable();

  const result = await pool.query(`
    INSERT INTO evesde."invMetaTypes" ("typeID","parentTypeID","metaGroupID")
    SELECT "typeID", "variationParentTypeID", "metaGroupID"
    FROM evesde."invTypes"
    WHERE "variationParentTypeID" IS NOT NULL
       OR "metaGroupID" IS NOT NULL
    ON CONFLICT ("typeID") DO UPDATE SET
      "parentTypeID" = EXCLUDED."parentTypeID",
      "metaGroupID"  = EXCLUDED."metaGroupID";
  `);

  console.log(
    `[SDE_IMPORT]: evesde."invMetaTypes" import complete (${result.rowCount || 0} rows).`
  );
}

async function ensureMapRegionsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS evesde."mapRegions" (
      "regionID"   integer PRIMARY KEY,
      "regionName" text
    );
  `);
  await pool.query(`TRUNCATE evesde."mapRegions";`);
}

async function importMapRegions(sdeRootDir) {
  const yamlPath = path.join(sdeRootDir, "mapRegions.yaml");
  console.log(`[SDE_IMPORT]: Loading ${yamlPath}…`);

  const yamlText = await fs.promises.readFile(yamlPath, "utf8");
  const doc = YAML.parse(yamlText);

  if (!doc || typeof doc !== "object") {
    throw new Error("[SDE_IMPORT]: mapRegions.yaml did not parse into an object");
  }

  await ensureMapRegionsTable();

  const entries = Object.entries(doc);
  console.log(
    `[SDE_IMPORT]: Parsed ${entries.length.toLocaleString()} regions; inserting…`
  );

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const batchSize = 500;
    for (let i = 0; i < entries.length; i += batchSize) {
      const slice = entries.slice(i, i + batchSize);
      const values = [];
      const params = [];

      slice.forEach(([idStr, rec]) => {
        const regionID = Number(idStr);
        if (!Number.isFinite(regionID)) return;

        const regionName = rec.name?.en ?? rec.regionName ?? null;

        const baseIndex = params.length;
        params.push(regionID, regionName);
        values.push(`($${baseIndex + 1}, $${baseIndex + 2})`);
      });

      if (!values.length) continue;

      const sql = `
        INSERT INTO evesde."mapRegions" ("regionID","regionName")
        VALUES ${values.join(",")}
        ON CONFLICT ("regionID") DO UPDATE SET
          "regionName" = EXCLUDED."regionName";
      `;
      await client.query(sql, params);
      console.log(
        `[SDE_IMPORT]: mapRegions inserted ${Math.min(
          i + batchSize,
          entries.length
        )}/${entries.length}`
      );
    }

    await client.query("COMMIT");
    console.log('[SDE_IMPORT]: evesde."mapRegions" import complete.');
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function ensureMapSolarSystemsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS evesde."mapSolarSystems" (
      "solarSystemID"   integer PRIMARY KEY,
      "solarSystemName" text,
      "regionID"        integer,
      "constellationID" integer
    );
  `);
  await pool.query(`TRUNCATE evesde."mapSolarSystems";`);
}

async function importMapSolarSystems(sdeRootDir) {
  const yamlPath = path.join(sdeRootDir, "mapSolarSystems.yaml");
  console.log(`[SDE_IMPORT]: Loading ${yamlPath}…`);

  const yamlText = await fs.promises.readFile(yamlPath, "utf8");
  const doc = YAML.parse(yamlText);

  if (!doc || typeof doc !== "object") {
    throw new Error(
      "[SDE_IMPORT]: mapSolarSystems.yaml did not parse into an object"
    );
  }

  await ensureMapSolarSystemsTable();

  const entries = Object.entries(doc);
  console.log(
    `[SDE_IMPORT]: Parsed ${entries.length.toLocaleString()} solar systems; inserting…`
  );

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const batchSize = 2000;
    for (let i = 0; i < entries.length; i += batchSize) {
      const slice = entries.slice(i, i + batchSize);
      const values = [];
      const params = [];

      slice.forEach(([idStr, rec]) => {
        const solarSystemID = Number(idStr);
        if (!Number.isFinite(solarSystemID)) return;

        const solarSystemName =
          rec.name?.en ?? rec.solarSystemName ?? null;
        const regionID = rec.regionID ?? null;
        const constellationID = rec.constellationID ?? null;

        const baseIndex = params.length;
        params.push(
          solarSystemID,
          solarSystemName,
          regionID,
          constellationID
        );
        values.push(
          `($${baseIndex + 1}, $${baseIndex + 2}, $${baseIndex + 3}, $${baseIndex + 4})`
        );
      });

      if (!values.length) continue;

      const sql = `
        INSERT INTO evesde."mapSolarSystems" (
          "solarSystemID","solarSystemName","regionID","constellationID"
        ) VALUES ${values.join(",")}
        ON CONFLICT ("solarSystemID") DO UPDATE SET
          "solarSystemName" = EXCLUDED."solarSystemName",
          "regionID"        = EXCLUDED."regionID",
          "constellationID" = EXCLUDED."constellationID";
      `;
      await client.query(sql, params);
      console.log(
        `[SDE_IMPORT]: mapSolarSystems inserted ${Math.min(
          i + batchSize,
          entries.length
        )}/${entries.length}`
      );
    }

    await client.query("COMMIT");
    console.log('[SDE_IMPORT]: evesde."mapSolarSystems" import complete.');
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function ensureStaStationsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS evesde."staStations" (
      "stationID"      integer PRIMARY KEY,
      "stationName"    text,
      "solarSystemID"  integer,
      "regionID"       integer
    );
  `);
  await pool.query(`TRUNCATE evesde."staStations";`);
}

async function backfillNpcStationNamesFromLocalSde() {
  const candidates = [
    { regclass: 'evesde."invNames"', table: 'evesde."invNames"', alias: "sn" },
    { regclass: 'evesde."invUniqueNames"', table: 'evesde."invUniqueNames"', alias: "sun" },
    { regclass: 'evesde."mapDenormalize"', table: 'evesde."mapDenormalize"', alias: "md" },
  ];
  const existing = [];
  for (const candidate of candidates) {
    if (await tableExists(candidate.regclass)) existing.push(candidate);
  }
  if (!existing.length) {
    console.log("[SDE_IMPORT]: No legacy SDE name tables available for NPC station name backfill.");
    return 0;
  }

  const joins = existing
    .map((candidate) => `LEFT JOIN ${candidate.table} ${candidate.alias} ON ${candidate.alias}."itemID" = st."stationID"`)
    .join("\n");
  const names = existing
    .map((candidate) => `NULLIF(${candidate.alias}."itemName", '')`)
    .join(",\n            ");

  const result = await pool.query(`
    WITH resolved AS (
      SELECT
        st."stationID",
        COALESCE(${names}) AS station_name
      FROM evesde."staStations" st
      ${joins}
      WHERE st."stationName" IS NULL OR btrim(st."stationName") = ''
    )
    UPDATE evesde."staStations" st
    SET "stationName" = resolved.station_name
    FROM resolved
    WHERE st."stationID" = resolved."stationID"
      AND resolved.station_name IS NOT NULL
      AND (st."stationName" IS NULL OR btrim(st."stationName") = '')
  `);
  console.log(`[SDE_IMPORT]: NPC station names backfilled from local SDE tables: ${result.rowCount || 0}`);
  return result.rowCount || 0;
}

async function fetchNpcStationNameFromEsi(fetch, stationID) {
  const response = await fetch(`https://esi.evetech.net/latest/universe/stations/${stationID}/?datasource=tranquility`, {
    headers: {
      Accept: "application/json",
      "User-Agent": "TriffTools/SDEStationImport (+https://triff.tools)",
    },
  });
  if (!response.ok) {
    throw new Error(`esi_station_${stationID}_${response.status}`);
  }
  const data = await response.json();
  return {
    name: firstText(data.name),
    solarSystemID: Number.isFinite(Number(data.system_id)) ? Number(data.system_id) : null,
  };
}

async function backfillNpcStationNamesFromEsi() {
  if (String(process.env.SDE_IMPORT_DISABLE_ESI_STATION_NAMES || "").toLowerCase() === "true") {
    console.log("[SDE_IMPORT]: ESI NPC station name fallback disabled by SDE_IMPORT_DISABLE_ESI_STATION_NAMES=true.");
    return { resolved: 0, failed: 0 };
  }

  const { rows } = await pool.query(`
    SELECT "stationID"::bigint AS station_id
    FROM evesde."staStations"
    WHERE "stationName" IS NULL OR btrim("stationName") = ''
    ORDER BY "stationID"
  `);
  const stationIDs = rows.map((row) => Number(row.station_id)).filter((id) => Number.isFinite(id) && id > 0);
  if (!stationIDs.length) return { resolved: 0, failed: 0 };

  console.log(`[SDE_IMPORT]: Resolving ${stationIDs.length} missing NPC station names from public ESI...`);
  const fetch = await getFetch();
  const concurrency = Math.max(1, Math.min(16, Number(process.env.SDE_IMPORT_ESI_STATION_CONCURRENCY || 4) || 4));
  let index = 0;
  let resolved = 0;
  let failed = 0;

  async function worker() {
    while (index < stationIDs.length) {
      const stationID = stationIDs[index++];
      try {
        const data = await fetchNpcStationNameFromEsi(fetch, stationID);
        if (!data.name) {
          failed += 1;
          continue;
        }
        await pool.query(
          `
          UPDATE evesde."staStations"
          SET
            "stationName" = $2,
            "solarSystemID" = COALESCE("solarSystemID", $3)
          WHERE "stationID" = $1
          `,
          [stationID, data.name, data.solarSystemID]
        );
        resolved += 1;
      } catch (err) {
        failed += 1;
        console.warn(`[SDE_IMPORT]: NPC station ESI name lookup failed for ${stationID}:`, err.message);
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  console.log(`[SDE_IMPORT]: NPC station names resolved from ESI: ${resolved}; failed: ${failed}`);
  return { resolved, failed };
}

async function importNpcStations(sdeRootDir) {
  const yamlPath = path.join(sdeRootDir, "npcStations.yaml");
  console.log(`[SDE_IMPORT]: Loading ${yamlPath}…`);

  const yamlText = await fs.promises.readFile(yamlPath, "utf8");
  const doc = YAML.parse(yamlText);

  if (!doc || typeof doc !== "object") {
    throw new Error(
      "[SDE_IMPORT]: npcStations.yaml did not parse into an object"
    );
  }

  await ensureStaStationsTable();

  const entries = Object.entries(doc);
  console.log(
    `[SDE_IMPORT]: Parsed ${entries.length.toLocaleString()} NPC stations; inserting…`
  );

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const batchSize = 2000;
    for (let i = 0; i < entries.length; i += batchSize) {
      const slice = entries.slice(i, i + batchSize);
      const values = [];
      const params = [];

      slice.forEach(([idStr, rec]) => {
        const stationID = Number(idStr);
        if (!Number.isFinite(stationID)) return;

        const stationName = firstText(
          rec.name,
          rec.nameID,
          rec.stationName,
          rec.stationNameID,
          rec.itemName,
          rec.itemNameID
        );
        const solarSystemID = rec.solarSystemID ?? null;
        const regionID = rec.regionID ?? null;

        const baseIndex = params.length;
        params.push(stationID, stationName, solarSystemID, regionID);
        values.push(
          `($${baseIndex + 1}, $${baseIndex + 2}, $${baseIndex + 3}, $${baseIndex + 4})`
        );
      });

      if (!values.length) continue;

      const sql = `
        INSERT INTO evesde."staStations" (
          "stationID","stationName","solarSystemID","regionID"
        ) VALUES ${values.join(",")}
        ON CONFLICT ("stationID") DO UPDATE SET
          "stationName"   = EXCLUDED."stationName",
          "solarSystemID" = EXCLUDED."solarSystemID",
          "regionID"      = EXCLUDED."regionID";
      `;
      await client.query(sql, params);
      console.log(
        `[SDE_IMPORT]: staStations inserted ${Math.min(
          i + batchSize,
          entries.length
        )}/${entries.length}`
      );
    }

    await client.query("COMMIT");
    console.log('[SDE_IMPORT]: evesde."staStations" import complete.');
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  await backfillNpcStationNamesFromLocalSde();
  await backfillNpcStationNamesFromEsi();
}

async function ensureInvCategoriesTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS evesde."invCategories" (
      "categoryID"   integer PRIMARY KEY,
      "categoryName" text
    );
  `);
  await pool.query(`TRUNCATE evesde."invCategories";`);
}

async function importInvCategories(sdeRootDir) {
  const yamlPath = path.join(sdeRootDir, "categories.yaml");
  console.log(`[SDE_IMPORT]: Loading ${yamlPath}…`);

  const yamlText = await fs.promises.readFile(yamlPath, "utf8");
  const doc = YAML.parse(yamlText);
  if (!doc || typeof doc !== "object") {
    throw new Error("[SDE_IMPORT]: categories.yaml did not parse into an object");
  }

  await ensureInvCategoriesTable();

  const entries = Object.entries(doc);
  console.log(
    `[SDE_IMPORT]: Parsed ${entries.length.toLocaleString()} categories; inserting…`
  );

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const batchSize = 2000;
    for (let i = 0; i < entries.length; i += batchSize) {
      const slice = entries.slice(i, i + batchSize);
      const values = [];
      const params = [];

      slice.forEach(([idStr, rec]) => {
        const categoryID = Number(idStr);
        if (!Number.isFinite(categoryID)) return;

        const categoryName = rec?.name?.en ?? rec?.categoryName ?? null;

        const base = params.length;
        params.push(categoryID, categoryName);
        values.push(`($${base + 1}, $${base + 2})`);
      });

      if (!values.length) continue;

      const sql = `
        INSERT INTO evesde."invCategories" ("categoryID","categoryName")
        VALUES ${values.join(",")}
        ON CONFLICT ("categoryID") DO UPDATE SET
          "categoryName" = EXCLUDED."categoryName";
      `;
      await client.query(sql, params);

      console.log(
        `[SDE_IMPORT]: invCategories inserted ${Math.min(i + batchSize, entries.length)}/${entries.length}`
      );
    }

    await client.query("COMMIT");
    console.log('[SDE_IMPORT]: evesde."invCategories" import complete.');
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function ensureInvGroupsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS evesde."invGroups" (
      "groupID"      integer PRIMARY KEY,
      "categoryID"   integer,
      "groupName"    text
    );
  `);
  await pool.query(`TRUNCATE evesde."invGroups";`);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS evesde_invGroups_category_idx
      ON evesde."invGroups" ("categoryID");
  `);
}

async function ensureDogmaAttributesTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS evesde."dogmaAttributes" (
      "attributeID" integer PRIMARY KEY,
      "attributeName" text,
      "displayName" text,
      "description" text,
      "unitID" integer,
      "categoryID" integer,
      "published" boolean,
      "stackable" boolean,
      "highIsGood" boolean
    );
  `);
  await pool.query(`TRUNCATE evesde."dogmaAttributes";`);
}

async function importDogmaAttributes(sdeRootDir) {
  const yamlPath = path.join(sdeRootDir, "dogmaAttributes.yaml");
  console.log(`[SDE_IMPORT]: Loading ${yamlPath}â€¦`);

  const yamlText = await fs.promises.readFile(yamlPath, "utf8");
  const doc = YAML.parse(yamlText);
  if (!doc || typeof doc !== "object") {
    throw new Error("[SDE_IMPORT]: dogmaAttributes.yaml did not parse into an object");
  }

  await ensureDogmaAttributesTable();

  const entries = Object.entries(doc);
  console.log(
    `[SDE_IMPORT]: Parsed ${entries.length.toLocaleString()} dogma attributes; insertingâ€¦`
  );

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const batchSize = 2000;
    for (let i = 0; i < entries.length; i += batchSize) {
      const slice = entries.slice(i, i + batchSize);
      const values = [];
      const params = [];

      slice.forEach(([idStr, rec]) => {
        const attributeID = Number(idStr);
        if (!Number.isFinite(attributeID)) return;

        const base = params.length;
        params.push(
          attributeID,
          localizedEnglish(rec.attributeName),
          localizedEnglish(rec.displayName),
          localizedEnglish(rec.description),
          rec.unitID ?? null,
          rec.categoryID ?? null,
          rec.published ?? null,
          rec.stackable ?? null,
          rec.highIsGood ?? null
        );
        values.push(
          `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9})`
        );
      });

      if (!values.length) continue;

      const sql = `
        INSERT INTO evesde."dogmaAttributes" (
          "attributeID","attributeName","displayName","description","unitID",
          "categoryID","published","stackable","highIsGood"
        ) VALUES ${values.join(",")}
        ON CONFLICT ("attributeID") DO UPDATE SET
          "attributeName" = EXCLUDED."attributeName",
          "displayName"   = EXCLUDED."displayName",
          "description"   = EXCLUDED."description",
          "unitID"        = EXCLUDED."unitID",
          "categoryID"    = EXCLUDED."categoryID",
          "published"     = EXCLUDED."published",
          "stackable"     = EXCLUDED."stackable",
          "highIsGood"    = EXCLUDED."highIsGood";
      `;
      await client.query(sql, params);
      console.log(
        `[SDE_IMPORT]: dogmaAttributes inserted ${Math.min(i + batchSize, entries.length)}/${entries.length}`
      );
    }

    await client.query("COMMIT");
    console.log('[SDE_IMPORT]: evesde."dogmaAttributes" import complete.');
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function importInvGroups(sdeRootDir) {
  const yamlPath = path.join(sdeRootDir, "groups.yaml");
  console.log(`[SDE_IMPORT]: Loading ${yamlPath}…`);

  const yamlText = await fs.promises.readFile(yamlPath, "utf8");
  const doc = YAML.parse(yamlText);
  if (!doc || typeof doc !== "object") {
    throw new Error("[SDE_IMPORT]: groups.yaml did not parse into an object");
  }

  await ensureInvGroupsTable();

  const entries = Object.entries(doc);
  console.log(
    `[SDE_IMPORT]: Parsed ${entries.length.toLocaleString()} groups; inserting…`
  );

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const batchSize = 2000;
    for (let i = 0; i < entries.length; i += batchSize) {
      const slice = entries.slice(i, i + batchSize);
      const values = [];
      const params = [];

      slice.forEach(([idStr, rec]) => {
        const groupID = Number(idStr);
        if (!Number.isFinite(groupID)) return;

        const categoryID = rec?.categoryID ?? null;
        const groupName = rec?.name?.en ?? rec?.groupName ?? null;

        const base = params.length;
        params.push(groupID, categoryID, groupName);
        values.push(`($${base + 1}, $${base + 2}, $${base + 3})`);
      });

      if (!values.length) continue;

      const sql = `
        INSERT INTO evesde."invGroups" ("groupID","categoryID","groupName")
        VALUES ${values.join(",")}
        ON CONFLICT ("groupID") DO UPDATE SET
          "categoryID" = EXCLUDED."categoryID",
          "groupName"  = EXCLUDED."groupName";
      `;
      await client.query(sql, params);

      console.log(
        `[SDE_IMPORT]: invGroups inserted ${Math.min(i + batchSize, entries.length)}/${entries.length}`
      );
    }

    await client.query("COMMIT");
    console.log('[SDE_IMPORT]: evesde."invGroups" import complete.');
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function ensureTypeDogmaAttributesTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS evesde."typeDogmaAttributes" (
      "typeID"      integer NOT NULL,
      "attributeID" integer NOT NULL,
      "value"       double precision,
      PRIMARY KEY ("typeID","attributeID")
    );
  `);

  await pool.query(`TRUNCATE evesde."typeDogmaAttributes";`);
}

async function insertTypeDogmaRows(client, rows) {

  if (!rows.length) return;

  const typeIDs = new Array(rows.length);
  const attributeIDs = new Array(rows.length);
  const values = new Array(rows.length);

  for (let i = 0; i < rows.length; i++) {
    typeIDs[i] = rows[i].typeID;
    attributeIDs[i] = rows[i].attributeID;
    values[i] = rows[i].value ?? null;
  }

  await client.query(
    `
    INSERT INTO evesde."typeDogmaAttributes" ("typeID","attributeID","value")
    SELECT * FROM UNNEST($1::int[], $2::int[], $3::double precision[])
    ON CONFLICT ("typeID","attributeID") DO UPDATE SET
      "value" = EXCLUDED."value";
    `,
    [typeIDs, attributeIDs, values]
  );
}

async function importTypeDogma(sdeRootDir) {
  const yamlPath = path.join(sdeRootDir, "typeDogma.yaml");
  console.log(`[SDE_IMPORT]: Loading ${yamlPath}…`);

  const yamlText = await fs.promises.readFile(yamlPath, "utf8");
  const doc = YAML.parse(yamlText);
  if (!doc || typeof doc !== "object") {
    throw new Error("[SDE_IMPORT]: typeDogma.yaml did not parse into an object");
  }

  await ensureTypeDogmaAttributesTable();

  const entries = Object.entries(doc);
  console.log(
    `[SDE_IMPORT]: Parsed ${entries.length.toLocaleString()} typeDogma records; inserting…`
  );

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const ROW_BATCH = 20000;
    let rowBuffer = [];
    let processedTypes = 0;

    for (let i = 0; i < entries.length; i++) {
      const [typeIdStr, rec] = entries[i];
      const typeID = Number(typeIdStr);
      if (!Number.isFinite(typeID)) continue;

      const attrs = rec?.dogmaAttributes || [];
      for (const a of attrs) {
        const attributeID = Number(a?.attributeID);
        if (!Number.isFinite(attributeID)) continue;

        rowBuffer.push({
          typeID,
          attributeID,
          value: a?.value ?? null,
        });

        if (rowBuffer.length >= ROW_BATCH) {
          await insertTypeDogmaRows(client, rowBuffer);
          rowBuffer = [];
        }
      }

      processedTypes++;
      if (processedTypes % 500 === 0) {
        console.log(
          `[SDE_IMPORT]: typeDogmaAttributes processed ${processedTypes}/${entries.length} types`
        );
      }
    }

    if (rowBuffer.length) {
      await insertTypeDogmaRows(client, rowBuffer);
    }

    console.log(
      `[SDE_IMPORT]: typeDogmaAttributes inserted (rows) for ${entries.length}/${entries.length} types`
    );

    await client.query("COMMIT");
    console.log('[SDE_IMPORT]: evesde."typeDogmaAttributes" import complete.');
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function main() {
  try {
    await ensureEvesdeSchema();

    const latestBuild = await getLatestSDEBuildNumber();
    const currentBuild = await getCurrentBuild();
    const traitsImported = await hasImportedTypeTraits();
    const industryKeysReady = await hasIndustryPrimaryKeys();
    const fittingMetaReady = await hasFittingMetaTables();

    if (
      currentBuild &&
      currentBuild === latestBuild &&
      traitsImported &&
      industryKeysReady &&
      fittingMetaReady
    ) {
      console.log(
        `[SDE_IMPORT]: SDE already up to date (build ${currentBuild}), skipping.`
      );
      return;
    }

    console.log(
      `[SDE_IMPORT]: Updating SDE to build ${latestBuild} (was ${currentBuild || "none"
      })…`
    );

    const tmpDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), "eve-sde-")
    );
    const zipPath = path.join(tmpDir, "sde-latest-yaml.zip");
    const extractDir = path.join(tmpDir, "sde");

    await downloadFile(LATEST_YAML_ZIP, zipPath);
    await extractZip(zipPath, extractDir);

    const sdeRoot = extractDir;

    await importTypeIDs(sdeRoot);
    await importTypeBonuses(sdeRoot);
    await importInvVolumes(sdeRoot);
    await seedInvTypesHelper();
    await importInvCategories(sdeRoot);
    await importInvGroups(sdeRoot);
    await importMarketGroups(sdeRoot);
    await importMetaGroups(sdeRoot);
    await importMetaTypesFromInvTypes();
    await importDogmaAttributes(sdeRoot);
    await importTypeDogma(sdeRoot);
    await importBlueprints(sdeRoot);
    await importMapRegions(sdeRoot);
    await importMapSolarSystems(sdeRoot);
    await importNpcStations(sdeRoot);

    await setCurrentBuild(latestBuild);
    console.log("[SDE_IMPORT]: SDE import/update complete.");
  } catch (err) {
    console.error("[SDE_IMPORT]: FAILED:", err);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();
