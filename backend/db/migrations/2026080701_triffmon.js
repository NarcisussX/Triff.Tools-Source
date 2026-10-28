const crypto = require("crypto");

const MIGRATION_ID = "2026080701_triffmon";

function asObject(value) {
  if (!value) return {};
  if (typeof value === "object") return value;
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function cleanSkillId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function cleanLevel(value) {
  const level = Number(value);
  return Number.isFinite(level) ? Math.max(1, Math.min(5, Math.trunc(level))) : null;
}

function cleanText(value, limit) {
  return String(value || "").trim().slice(0, limit);
}

async function tableExists(client, tableName) {
  const { rows } = await client.query("SELECT to_regclass($1) AS table_name", [tableName]);
  return Boolean(rows[0]?.table_name);
}

async function ownedCharacterId(client, userId, characterId) {
  const id = cleanSkillId(characterId);
  if (!id) return null;
  const { rows } = await client.query(
    `SELECT character_id
     FROM fitting_esi_characters
     WHERE user_id = $1 AND character_id = $2 AND sso_app = 'skillnix' AND revoked_at IS NULL
     LIMIT 1`,
    [userId, id]
  );
  return rows[0] ? id : null;
}

async function migrateLegacyPlans(client) {
  if (!(await tableExists(client, "public.skillnix_plans"))) return;

  const { rows: legacyPlans } = await client.query(
    `SELECT id, user_id, character_id, plan_name, plan_json, created_at, updated_at, last_opened_at
     FROM skillnix_plans
     ORDER BY created_at ASC, id ASC`
  );

  for (const legacy of legacyPlans) {
    const existing = await client.query("SELECT 1 FROM triffmon_skill_plans WHERE id = $1", [legacy.id]);
    if (existing.rowCount) continue;

    const original = asObject(legacy.plan_json);
    const rawEntries = Array.isArray(original.entries) ? original.entries : [];
    const characterId = await ownedCharacterId(client, legacy.user_id, legacy.character_id);
    const warnings = [];
    if (legacy.character_id != null && characterId == null) {
      warnings.push("The legacy character link was missing or did not belong to this account; the plan was imported unassigned.");
    }

    await client.query(
      `INSERT INTO triffmon_skill_plans (
         id, user_id, character_id, name, notes, settings, source_type, source_metadata,
         created_at, updated_at, last_opened_at
       ) VALUES ($1, $2, $3, $4, '', $5::jsonb, 'legacy_skillnix', $6::jsonb, $7, $8, $9)`,
      [
        legacy.id,
        legacy.user_id,
        characterId,
        cleanText(legacy.plan_name, 160) || "Imported SkillNix plan",
        JSON.stringify({
          selectedImplantSetId: original.selectedImplantSetId || null,
          selectedImplantSetName: original.selectedImplantSetName || null,
          selectedImplantBonuses: original.selectedImplantBonuses || null,
        }),
        JSON.stringify({
          migration: MIGRATION_ID,
          originalCharacterId: legacy.character_id == null ? null : String(legacy.character_id),
          warnings,
          originalPlanJson: original,
        }),
        legacy.created_at,
        legacy.updated_at,
        legacy.last_opened_at,
      ]
    );

    let sectionPosition = 0;
    let entryPosition = 0;
    const seenSkillSections = new Map();
    const collapsedSkillWarnings = new Set();
    let sectionId = crypto.randomUUID();
    await client.query(
      `INSERT INTO triffmon_skill_plan_sections (id, plan_id, title, position, settings)
       VALUES ($1, $2, 'Training plan', $3, '{}'::jsonb)`,
      [sectionId, legacy.id, sectionPosition]
    );

    for (let index = 0; index < rawEntries.length; index += 1) {
      const entry = asObject(rawEntries[index]);
      const entryType = String(entry.type || entry.entryType || "").toLowerCase();
      const skillTypeId = cleanSkillId(entry.skillTypeId ?? entry.skill_type_id ?? entry.skillID ?? entry.skill_id);

      if (entryType === "remap" || (entry.remap === true && !skillTypeId)) {
        sectionPosition += 1;
        entryPosition = 0;
        sectionId = crypto.randomUUID();
        const baseAttributes = asObject(entry.baseAttributes || entry.base_attributes);
        await client.query(
          `INSERT INTO triffmon_skill_plan_sections (
             id, plan_id, title, position, notes, remap_attributes, settings
           ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb)`,
          [
            sectionId,
            legacy.id,
            cleanText(entry.label || entry.name, 120) || `Remap ${sectionPosition}`,
            sectionPosition,
            cleanText(entry.notes, 2000),
            JSON.stringify(Object.keys(baseAttributes).length ? baseAttributes : null),
            JSON.stringify({
              legacyId: entry.id || null,
              implantSetId: entry.implantSetId || entry.implant_set_id || null,
            }),
          ]
        );
        continue;
      }

      const targetLevel = cleanLevel(entry.targetLevel ?? entry.target_level ?? entry.level ?? entry.value);
      if (!skillTypeId || !targetLevel) {
        warnings.push(`Skipped malformed legacy entry ${index + 1}.`);
        continue;
      }

      if (seenSkillSections.has(skillTypeId) && !collapsedSkillWarnings.has(skillTypeId)) {
        const previousSection = seenSkillSections.get(skillTypeId);
        const detail = previousSection === sectionId
          ? "repeated level rows were collapsed to the highest desired target"
          : "interleaved level rows crossed a remap section and were collapsed into their first section";
        warnings.push(`Skill ${skillTypeId}: ${detail}. The original ordering remains in source metadata.`);
        collapsedSkillWarnings.add(skillTypeId);
      }
      if (!seenSkillSections.has(skillTypeId)) seenSkillSections.set(skillTypeId, sectionId);

      const sourceLabel = String(entry.entryType || entry.entry_type || "").toLowerCase();
      const isExplicit = !sourceLabel.includes("prerequisite");
      await client.query(
        `INSERT INTO triffmon_skill_plan_entries (
           id, plan_id, section_id, skill_type_id, target_level, position,
           is_explicit, source_type, source_metadata, notes
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)
         ON CONFLICT (plan_id, skill_type_id) DO UPDATE SET
           target_level = GREATEST(triffmon_skill_plan_entries.target_level, EXCLUDED.target_level),
           is_explicit = triffmon_skill_plan_entries.is_explicit OR EXCLUDED.is_explicit,
           source_metadata = triffmon_skill_plan_entries.source_metadata || EXCLUDED.source_metadata,
           notes = CASE
             WHEN triffmon_skill_plan_entries.notes = '' THEN EXCLUDED.notes
             ELSE triffmon_skill_plan_entries.notes
           END`,
        [
          crypto.randomUUID(),
          legacy.id,
          sectionId,
          skillTypeId,
          targetLevel,
          entryPosition,
          isExplicit,
          isExplicit ? "legacy_explicit" : "legacy_prerequisite",
          JSON.stringify({
            originalIndex: index,
            chainId: entry.chainId || entry.chain_id || null,
            priority: entry.priority ?? null,
            remapMarker: entry.remap === true || entry.remapMarker === true,
          }),
          cleanText(entry.notes, 2000),
        ]
      );
      entryPosition += 1;
    }

    if (warnings.length) {
      await client.query(
        `UPDATE triffmon_skill_plans
         SET source_metadata = jsonb_set(source_metadata, '{warnings}', $2::jsonb, true)
         WHERE id = $1`,
        [legacy.id, JSON.stringify(warnings)]
      );
    }
  }
}

async function up(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS triffmon_skill_plans (
      id UUID PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES anoikis_command_users(id) ON DELETE CASCADE,
      character_id BIGINT,
      name TEXT NOT NULL,
      notes TEXT NOT NULL DEFAULT '',
      settings JSONB NOT NULL DEFAULT '{}'::jsonb,
      source_type TEXT NOT NULL DEFAULT 'native',
      source_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      lock_version INTEGER NOT NULL DEFAULT 1,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_opened_at TIMESTAMPTZ
    );

    CREATE INDEX IF NOT EXISTS triffmon_skill_plans_user_updated_idx
      ON triffmon_skill_plans(user_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS triffmon_skill_plans_user_character_idx
      ON triffmon_skill_plans(user_id, character_id, updated_at DESC);

    CREATE TABLE IF NOT EXISTS triffmon_skill_plan_sections (
      id UUID PRIMARY KEY,
      plan_id UUID NOT NULL REFERENCES triffmon_skill_plans(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      position INTEGER NOT NULL,
      notes TEXT NOT NULL DEFAULT '',
      remap_attributes JSONB,
      settings JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS triffmon_skill_plan_sections_plan_position_idx
      ON triffmon_skill_plan_sections(plan_id, position, id);

    CREATE TABLE IF NOT EXISTS triffmon_skill_plan_entries (
      id UUID PRIMARY KEY,
      plan_id UUID NOT NULL REFERENCES triffmon_skill_plans(id) ON DELETE CASCADE,
      section_id UUID REFERENCES triffmon_skill_plan_sections(id) ON DELETE SET NULL,
      skill_type_id INTEGER NOT NULL,
      target_level SMALLINT NOT NULL CHECK (target_level BETWEEN 1 AND 5),
      position INTEGER NOT NULL,
      is_explicit BOOLEAN NOT NULL DEFAULT true,
      source_type TEXT NOT NULL DEFAULT 'explicit',
      source_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      notes TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE(plan_id, skill_type_id)
    );

    CREATE INDEX IF NOT EXISTS triffmon_skill_plan_entries_plan_position_idx
      ON triffmon_skill_plan_entries(plan_id, position, id);
    CREATE INDEX IF NOT EXISTS triffmon_skill_plan_entries_skill_idx
      ON triffmon_skill_plan_entries(skill_type_id, target_level);

    CREATE TABLE IF NOT EXISTS triffmon_character_preferences (
      user_id BIGINT NOT NULL,
      character_id BIGINT NOT NULL,
      sso_app TEXT NOT NULL DEFAULT 'skillnix' CHECK (sso_app = 'skillnix'),
      is_favorite BOOLEAN NOT NULL DEFAULT false,
      is_hidden BOOLEAN NOT NULL DEFAULT false,
      group_name TEXT NOT NULL DEFAULT '',
      display_order INTEGER,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, character_id),
      CONSTRAINT triffmon_preferences_user_fkey
        FOREIGN KEY (user_id) REFERENCES anoikis_command_users(id) ON DELETE CASCADE,
      CONSTRAINT triffmon_preferences_skillnix_character_fkey
        FOREIGN KEY (user_id, character_id, sso_app)
        REFERENCES fitting_esi_characters(user_id, character_id, sso_app) ON DELETE CASCADE
    );

    ALTER TABLE triffmon_character_preferences
      ADD COLUMN IF NOT EXISTS sso_app TEXT NOT NULL DEFAULT 'skillnix';

    ALTER TABLE triffmon_character_preferences
      DROP CONSTRAINT IF EXISTS triffmon_character_preferences_user_id_character_id_fkey;

    CREATE INDEX IF NOT EXISTS triffmon_character_preferences_user_order_idx
      ON triffmon_character_preferences(user_id, is_favorite DESC, display_order, character_id);
  `);

  await migrateLegacyPlans(client);
}

module.exports = {
  id: MIGRATION_ID,
  up,
  _test: {
    asObject,
    cleanLevel,
    cleanSkillId,
  },
};
