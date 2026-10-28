/*
 * Account-backed last-state snapshots for tool pages.
 * Stores one JSON payload per user and tool key.
 */

const express = require("express");
const cookieParser = require("cookie-parser");
const pool = require("../db/pool");
const siteAuth = require("../services/siteAuth");

const router = express.Router();
router.use(cookieParser());

let schemaReady = false;
let schemaPromise = null;

async function ensureToolStateSchema() {
  if (schemaReady) return;
  if (!schemaPromise) {
    schemaPromise = (async () => {
      await siteAuth.ensureAuthSchema();
      await pool.query(`
        CREATE TABLE IF NOT EXISTS tool_user_state (
          user_id BIGINT NOT NULL REFERENCES anoikis_command_users(id) ON DELETE CASCADE,
          tool_key TEXT NOT NULL,
          state_json JSONB NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          PRIMARY KEY (user_id, tool_key)
        );

        CREATE INDEX IF NOT EXISTS tool_user_state_updated_idx
          ON tool_user_state(user_id, updated_at DESC);
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

function objectOrNull(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value;
}

function stateRecord(row) {
  return {
    toolKey: row.tool_key,
    stateJson: row.state_json || {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

router.get("/:toolKey", siteAuth.requireAuth, async (req, res) => {
  try {
    const toolKey = cleanToolKey(req.params.toolKey);
    if (!toolKey) return res.status(400).json({ ok: false, error: "invalid_tool_key" });
    await ensureToolStateSchema();
    const { rows } = await pool.query(
      `
      SELECT tool_key, state_json, created_at, updated_at
      FROM tool_user_state
      WHERE user_id = $1 AND tool_key = $2
      `,
      [req.siteUser.id, toolKey]
    );
    return res.json({ ok: true, state: rows[0] ? stateRecord(rows[0]) : null });
  } catch (err) {
    console.error("[tool-state] read error", err);
    return res.status(500).json({ ok: false, error: "tool_state_read_failed" });
  }
});

router.put("/:toolKey", siteAuth.requireAuth, async (req, res) => {
  try {
    const toolKey = cleanToolKey(req.params.toolKey);
    if (!toolKey) return res.status(400).json({ ok: false, error: "invalid_tool_key" });
    const stateJson = objectOrNull(req.body?.stateJson);
    if (!stateJson) return res.status(400).json({ ok: false, error: "state_json_required" });
    await ensureToolStateSchema();
    const { rows } = await pool.query(
      `
      INSERT INTO tool_user_state (user_id, tool_key, state_json)
      VALUES ($1, $2, $3::jsonb)
      ON CONFLICT (user_id, tool_key)
      DO UPDATE SET state_json = EXCLUDED.state_json, updated_at = now()
      RETURNING tool_key, state_json, created_at, updated_at
      `,
      [req.siteUser.id, toolKey, JSON.stringify(stateJson)]
    );
    return res.json({ ok: true, state: stateRecord(rows[0]) });
  } catch (err) {
    console.error("[tool-state] update error", err);
    return res.status(500).json({ ok: false, error: "tool_state_update_failed" });
  }
});

router.delete("/:toolKey", siteAuth.requireAuth, async (req, res) => {
  try {
    const toolKey = cleanToolKey(req.params.toolKey);
    if (!toolKey) return res.status(400).json({ ok: false, error: "invalid_tool_key" });
    await ensureToolStateSchema();
    await pool.query(
      "DELETE FROM tool_user_state WHERE user_id = $1 AND tool_key = $2",
      [req.siteUser.id, toolKey]
    );
    return res.json({ ok: true });
  } catch (err) {
    console.error("[tool-state] delete error", err);
    return res.status(500).json({ ok: false, error: "tool_state_delete_failed" });
  }
});

module.exports = router;
module.exports._test = {
  cleanToolKey,
  objectOrNull,
  stateRecord,
};
