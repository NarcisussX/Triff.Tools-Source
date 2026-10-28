const pool = require("../db/pool");
const siteAuth = require("./siteAuth");

const ACCOUNT_DELETE_CONFIRMATION = "DELETE";

const ACCOUNT_DATA_GROUPS = [
  { key: "sessions", label: "active sessions", table: "anoikis_command_sessions", columns: ["user_id"] },
  { key: "accountLinks", label: "saved generated-page links", table: "account_generated_links", columns: ["user_id"] },
  { key: "savedFits", label: "saved TriffFits fits", table: "fitting_saved_fits", columns: ["user_id"] },
  { key: "savedFitGroups", label: "saved TriffFits fit groups", table: "fitting_saved_fit_groups", columns: ["user_id"] },
  { key: "esiCharacters", label: "linked ESI characters and tokens", table: "fitting_esi_characters", columns: ["user_id"] },
  { key: "esiLoginStates", label: "pending ESI login states", table: "fitting_esi_oauth_states", columns: ["user_id"] },
  { key: "skillnixPlans", label: "Skillnix skill plans", table: "triffmon_skill_plans", columns: ["user_id"] },
  { key: "skillnixPreferences", label: "Skillnix character preferences", table: "triffmon_character_preferences", columns: ["user_id"] },
  { key: "inGameFittingEsiCharacters", label: "in-game fitting ESI characters and tokens", table: "in_game_fitting_esi_characters", columns: ["user_id"] },
  { key: "inGameFittingEsiLoginStates", label: "pending in-game fitting ESI login states", table: "in_game_fitting_esi_oauth_states", columns: ["user_id"] },
  { key: "legacySkillPlannerPlans", label: "deprecated skill planner plans", table: "skillnix_plans", columns: ["user_id"] },
  { key: "legacySkillPlannerFarmSettings", label: "deprecated skill planner farm settings", table: "skillnix_farm_settings", columns: ["user_id"] },
  { key: "legacySkillPlannerImplantSets", label: "deprecated skill planner implant sets", table: "skillnix_implant_sets", columns: ["user_id"] },
  { key: "legacySkillPlannerFarmSnapshots", label: "deprecated skill planner farm snapshots", table: "skillnix_farm_snapshots", columns: ["user_id"] },
  { key: "toolSetups", label: "saved calculator setups", table: "tool_saved_setups", columns: ["user_id"] },
  { key: "toolState", label: "remembered tool state", table: "tool_user_state", columns: ["user_id"] },
  { key: "itemBookmarks", label: "item bookmarks", table: "item_bookmarks", columns: ["user_id"] },
  { key: "wormholeBookmarks", label: "wormhole bookmarks", table: "wormhole_bookmarks", columns: ["user_id"] },
  { key: "wormholeBookmarkTags", label: "wormhole bookmark tags", table: "wormhole_bookmark_tags", columns: ["user_id"] },
];

function accountDeletionError(error, status, message = error) {
  const err = new Error(message);
  err.error = error;
  err.status = status;
  return err;
}

function validateAccountDeletionBody(body) {
  const password = typeof body?.password === "string" ? body.password : "";
  const confirmation = String(body?.confirmation ?? body?.confirm ?? "").trim();
  if (!password) return { error: "password_required", message: "Enter your password to delete this account." };
  if (password.length > 512) return { error: "invalid_password", message: "Invalid password." };
  if (confirmation !== ACCOUNT_DELETE_CONFIRMATION) {
    return { error: "confirmation_required", message: `Type ${ACCOUNT_DELETE_CONFIRMATION} to confirm account deletion.` };
  }
  return { password };
}

function quoteIdentifier(value) {
  if (!/^[a-z_][a-z0-9_]*$/i.test(String(value || ""))) {
    throw new Error(`Unsafe SQL identifier: ${value}`);
  }
  return `"${value}"`;
}

function ownershipWhereClause(group) {
  return group.columns.map((column) => `${quoteIdentifier(column)} = $1`).join(" OR ");
}

async function tableExists(client, table) {
  const { rows } = await client.query("SELECT to_regclass($1) AS table_name", [table]);
  return Boolean(rows[0]?.table_name);
}

async function countGroupRows(client, group, userId) {
  if (!(await tableExists(client, group.table))) return 0;
  const { rows } = await client.query(
    `SELECT COUNT(*)::integer AS count
     FROM ${quoteIdentifier(group.table)}
     WHERE ${ownershipWhereClause(group)}`,
    [userId]
  );
  return Number(rows[0]?.count || 0);
}

async function deleteGroupRows(client, group, userId) {
  if (!(await tableExists(client, group.table))) return 0;
  const result = await client.query(
    `DELETE FROM ${quoteIdentifier(group.table)}
     WHERE ${ownershipWhereClause(group)}`,
    [userId]
  );
  return Number(result.rowCount || 0);
}

async function collectDeletionSummary(userId, client = pool) {
  await siteAuth.ensureAuthSchema();
  const sections = [];
  for (const group of ACCOUNT_DATA_GROUPS) {
    const count = await countGroupRows(client, group, userId);
    if (count > 0) sections.push({ key: group.key, label: group.label, count });
  }
  const totalRows = sections.reduce((sum, section) => sum + section.count, 0);
  return {
    totalRows,
    sections,
    generatedPagesRemain: true,
  };
}

async function deleteKnownAccountRows(client, userId) {
  let deletedRows = 0;
  for (const group of ACCOUNT_DATA_GROUPS) {
    deletedRows += await deleteGroupRows(client, group, userId);
  }
  return deletedRows;
}

async function deleteAccount({ userId, body }) {
  await siteAuth.ensureAuthSchema();
  const validation = validateAccountDeletionBody(body);
  if (validation.error) throw accountDeletionError(validation.error, 400, validation.message);

  const passwordOk = await siteAuth.verifyCurrentPassword(userId, validation.password);
  if (!passwordOk) throw accountDeletionError("invalid_password", 401, "Invalid password.");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const summary = await collectDeletionSummary(userId, client);
    await deleteKnownAccountRows(client, userId);
    const { rows } = await client.query(
      `DELETE FROM anoikis_command_users
       WHERE id = $1
       RETURNING id, username`,
      [userId]
    );
    if (!rows[0]) throw accountDeletionError("account_not_found", 404, "Account not found.");
    await client.query("COMMIT");
    return {
      user: { id: String(rows[0].id), username: rows[0].username },
      summary,
    };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  ACCOUNT_DELETE_CONFIRMATION,
  ACCOUNT_DATA_GROUPS,
  collectDeletionSummary,
  deleteAccount,
  validateAccountDeletionBody,
  _test: {
    accountDeletionError,
    quoteIdentifier,
    ownershipWhereClause,
  },
};
