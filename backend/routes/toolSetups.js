/*
 * Account-backed saved setup snapshots for tool pages.
 * Stores named JSON payloads by tool key so calculators can share one account feature.
 */

const crypto = require("crypto");
const express = require("express");
const cookieParser = require("cookie-parser");
const pool = require("../db/pool");
const siteAuth = require("../services/siteAuth");

const router = express.Router();
router.use(cookieParser());

let schemaReady = false;
let schemaPromise = null;

async function ensureToolSetupsSchema() {
  if (schemaReady) return;
  if (!schemaPromise) {
    schemaPromise = (async () => {
      await siteAuth.ensureAuthSchema();
      await pool.query(`
        CREATE TABLE IF NOT EXISTS tool_saved_setups (
          id UUID PRIMARY KEY,
          user_id BIGINT NOT NULL REFERENCES anoikis_command_users(id) ON DELETE CASCADE,
          tool_key TEXT NOT NULL,
          setup_name TEXT NOT NULL,
          setup_json JSONB NOT NULL,
          summary_json JSONB,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          last_opened_at TIMESTAMPTZ
        );

        CREATE INDEX IF NOT EXISTS tool_saved_setups_user_tool_idx
          ON tool_saved_setups(user_id, tool_key);

        CREATE INDEX IF NOT EXISTS tool_saved_setups_user_tool_updated_idx
          ON tool_saved_setups(user_id, tool_key, updated_at DESC);

        CREATE UNIQUE INDEX IF NOT EXISTS tool_saved_setups_user_tool_name_idx
          ON tool_saved_setups(user_id, tool_key, lower(setup_name));
      `);
      schemaReady = true;
    })().catch((err) => {
      schemaPromise = null;
      throw err;
    });
  }
  await schemaPromise;
}

function cleanToolKey(value) {
  const toolKey = String(value || "").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{1,63}$/.test(toolKey)) return null;
  return toolKey;
}

function cleanUuid(value) {
  const id = String(value || "").trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) return null;
  return id;
}

function objectOrNull(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value;
}

function validateSetupBody(body = {}) {
  const setupName = String(body.setupName || "").trim().slice(0, 160);
  const setupJson = objectOrNull(body.setupJson);
  const summaryJson = objectOrNull(body.summaryJson) || {};

  if (!setupName) return { error: "setup_name_required" };
  if (!setupJson) return { error: "setup_json_required" };

  return { setupName, setupJson, summaryJson };
}

function setupRecord(row, includeSetupJson = false) {
  const record = {
    id: String(row.id),
    toolKey: row.tool_key,
    setupName: row.setup_name,
    summaryJson: row.summary_json || {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastOpenedAt: row.last_opened_at,
  };
  if (includeSetupJson) record.setupJson = row.setup_json;
  return record;
}

function conflictResponse(err, res) {
  if (err.code === "23505") {
    return res.status(409).json({ ok: false, error: "setup_name_exists" });
  }
  return null;
}

router.get("/:toolKey", siteAuth.requireAuth, async (req, res) => {
  try {
    const toolKey = cleanToolKey(req.params.toolKey);
    if (!toolKey) return res.status(400).json({ ok: false, error: "invalid_tool_key", setups: [] });
    await ensureToolSetupsSchema();
    const { rows } = await pool.query(
      `
      SELECT id, tool_key, setup_name, summary_json, created_at, updated_at, last_opened_at
      FROM tool_saved_setups
      WHERE user_id = $1 AND tool_key = $2
      ORDER BY lower(setup_name) ASC, updated_at DESC
      `,
      [req.siteUser.id, toolKey]
    );
    return res.json({ ok: true, setups: rows.map((row) => setupRecord(row, false)) });
  } catch (err) {
    console.error("[tool-setups] list error", err);
    return res.status(500).json({ ok: false, error: "tool_setups_failed", setups: [] });
  }
});

router.get("/:toolKey/:id", siteAuth.requireAuth, async (req, res) => {
  try {
    const toolKey = cleanToolKey(req.params.toolKey);
    const id = cleanUuid(req.params.id);
    if (!toolKey || !id) return res.status(400).json({ ok: false, error: "invalid_setup_id" });
    await ensureToolSetupsSchema();
    const { rows } = await pool.query(
      `
      UPDATE tool_saved_setups
      SET last_opened_at = now()
      WHERE id = $1 AND user_id = $2 AND tool_key = $3
      RETURNING *
      `,
      [id, req.siteUser.id, toolKey]
    );
    if (!rows[0]) return res.status(404).json({ ok: false, error: "setup_not_found" });
    return res.json({ ok: true, setup: setupRecord(rows[0], true) });
  } catch (err) {
    console.error("[tool-setups] read error", err);
    return res.status(500).json({ ok: false, error: "tool_setup_read_failed" });
  }
});

router.post("/:toolKey", siteAuth.requireAuth, async (req, res) => {
  try {
    const toolKey = cleanToolKey(req.params.toolKey);
    if (!toolKey) return res.status(400).json({ ok: false, error: "invalid_tool_key" });
    const validation = validateSetupBody(req.body || {});
    if (validation.error) return res.status(400).json({ ok: false, error: validation.error });
    await ensureToolSetupsSchema();
    const id = crypto.randomUUID();
    const { rows } = await pool.query(
      `
      INSERT INTO tool_saved_setups (id, user_id, tool_key, setup_name, setup_json, summary_json)
      VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb)
      RETURNING *
      `,
      [
        id,
        req.siteUser.id,
        toolKey,
        validation.setupName,
        JSON.stringify(validation.setupJson),
        JSON.stringify(validation.summaryJson),
      ]
    );
    return res.status(201).json({ ok: true, setup: setupRecord(rows[0], true) });
  } catch (err) {
    if (conflictResponse(err, res)) return;
    console.error("[tool-setups] create error", err);
    return res.status(500).json({ ok: false, error: "tool_setup_create_failed" });
  }
});

router.put("/:toolKey/:id", siteAuth.requireAuth, async (req, res) => {
  try {
    const toolKey = cleanToolKey(req.params.toolKey);
    const id = cleanUuid(req.params.id);
    if (!toolKey || !id) return res.status(400).json({ ok: false, error: "invalid_setup_id" });
    const validation = validateSetupBody(req.body || {});
    if (validation.error) return res.status(400).json({ ok: false, error: validation.error });
    await ensureToolSetupsSchema();
    const { rows } = await pool.query(
      `
      UPDATE tool_saved_setups
      SET
        setup_name = $4,
        setup_json = $5::jsonb,
        summary_json = $6::jsonb,
        updated_at = now()
      WHERE id = $1 AND user_id = $2 AND tool_key = $3
      RETURNING *
      `,
      [
        id,
        req.siteUser.id,
        toolKey,
        validation.setupName,
        JSON.stringify(validation.setupJson),
        JSON.stringify(validation.summaryJson),
      ]
    );
    if (!rows[0]) return res.status(404).json({ ok: false, error: "setup_not_found" });
    return res.json({ ok: true, setup: setupRecord(rows[0], true) });
  } catch (err) {
    if (conflictResponse(err, res)) return;
    console.error("[tool-setups] update error", err);
    return res.status(500).json({ ok: false, error: "tool_setup_update_failed" });
  }
});

router.patch("/:toolKey/:id", siteAuth.requireAuth, async (req, res) => {
  try {
    const toolKey = cleanToolKey(req.params.toolKey);
    const id = cleanUuid(req.params.id);
    if (!toolKey || !id) return res.status(400).json({ ok: false, error: "invalid_setup_id" });
    const setupName = String(req.body?.setupName || "").trim().slice(0, 160);
    if (!setupName) return res.status(400).json({ ok: false, error: "setup_name_required" });
    await ensureToolSetupsSchema();
    const { rows } = await pool.query(
      `
      UPDATE tool_saved_setups
      SET setup_name = $4, updated_at = now()
      WHERE id = $1 AND user_id = $2 AND tool_key = $3
      RETURNING id, tool_key, setup_name, summary_json, created_at, updated_at, last_opened_at
      `,
      [id, req.siteUser.id, toolKey, setupName]
    );
    if (!rows[0]) return res.status(404).json({ ok: false, error: "setup_not_found" });
    return res.json({ ok: true, setup: setupRecord(rows[0], false) });
  } catch (err) {
    if (conflictResponse(err, res)) return;
    console.error("[tool-setups] rename error", err);
    return res.status(500).json({ ok: false, error: "tool_setup_rename_failed" });
  }
});

router.delete("/:toolKey/:id", siteAuth.requireAuth, async (req, res) => {
  try {
    const toolKey = cleanToolKey(req.params.toolKey);
    const id = cleanUuid(req.params.id);
    if (!toolKey || !id) return res.status(400).json({ ok: false, error: "invalid_setup_id" });
    await ensureToolSetupsSchema();
    const result = await pool.query(
      "DELETE FROM tool_saved_setups WHERE id = $1 AND user_id = $2 AND tool_key = $3",
      [id, req.siteUser.id, toolKey]
    );
    if (result.rowCount === 0) return res.status(404).json({ ok: false, error: "setup_not_found" });
    return res.json({ ok: true });
  } catch (err) {
    console.error("[tool-setups] delete error", err);
    return res.status(500).json({ ok: false, error: "tool_setup_delete_failed" });
  }
});

module.exports = router;
module.exports._test = {
  cleanToolKey,
  cleanUuid,
  objectOrNull,
  validateSetupBody,
  setupRecord,
};
