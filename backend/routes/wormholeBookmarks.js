/*
 * Account-scoped wormhole bookmarks, notes, and tags.
 */

const express = require("express");
const cookieParser = require("cookie-parser");
const pool = require("../db/pool");
const siteAuth = require("../services/siteAuth");

const router = express.Router();
router.use(cookieParser());

let schemaReady = false;
let schemaPromise = null;

async function ensureBookmarkSchema() {
  if (schemaReady) return;
  if (!schemaPromise) {
    schemaPromise = (async () => {
      await siteAuth.ensureAuthSchema();
      await pool.query(`
        CREATE TABLE IF NOT EXISTS wormhole_bookmarks (
          user_id BIGINT NOT NULL REFERENCES anoikis_command_users(id) ON DELETE CASCADE,
          jcode TEXT NOT NULL,
          nickname TEXT NOT NULL DEFAULT '',
          notes TEXT NOT NULL DEFAULT '',
          tags JSONB NOT NULL DEFAULT '[]'::jsonb,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          PRIMARY KEY (user_id, jcode)
        );

        ALTER TABLE wormhole_bookmarks
          ADD COLUMN IF NOT EXISTS nickname TEXT NOT NULL DEFAULT '';

        CREATE INDEX IF NOT EXISTS wormhole_bookmarks_user_updated_idx
          ON wormhole_bookmarks(user_id, updated_at DESC);

        CREATE TABLE IF NOT EXISTS wormhole_bookmark_tags (
          user_id BIGINT NOT NULL REFERENCES anoikis_command_users(id) ON DELETE CASCADE,
          tag_key TEXT NOT NULL,
          tag TEXT NOT NULL,
          color TEXT NOT NULL DEFAULT '#53b6ff',
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          PRIMARY KEY (user_id, tag_key)
        );

        ALTER TABLE wormhole_bookmark_tags
          ADD COLUMN IF NOT EXISTS color TEXT NOT NULL DEFAULT '#53b6ff';

        CREATE INDEX IF NOT EXISTS wormhole_bookmark_tags_user_updated_idx
          ON wormhole_bookmark_tags(user_id, updated_at DESC);
      `);
      schemaReady = true;
    })().catch((err) => {
      schemaPromise = null;
      throw err;
    });
  }
  await schemaPromise;
}

function cleanJcode(value) {
  const raw = String(value || "").trim().toUpperCase();
  const standard = raw.match(/^J\d{6}$/);
  if (standard) return standard[0];
  const nonStandard = raw.match(/^J[0-9-]+$/);
  return nonStandard ? nonStandard[0] : null;
}

function cleanNotes(value) {
  return String(value || "").slice(0, 12000);
}

function cleanNickname(value) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, 80);
}

function cleanTags(value) {
  const input = Array.isArray(value) ? value : [];
  const out = [];
  const seen = new Set();
  for (const raw of input) {
    const value = raw && typeof raw === "object" ? raw.tag : raw;
    const tag = String(value || "").trim().replace(/\s+/g, " ").slice(0, 32);
    const key = tag.toLowerCase();
    if (!tag || seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
    if (out.length >= 20) break;
  }
  return out;
}

function cleanTag(value) {
  const tag = String(value || "").trim().replace(/\s+/g, " ").slice(0, 32);
  return tag || null;
}

function tagKey(value) {
  return String(value || "").trim().toLowerCase();
}

function cleanTagColor(value) {
  const color = String(value || "").trim();
  return /^#[0-9a-fA-F]{6}$/.test(color) ? color.toLowerCase() : "#53b6ff";
}

function bookmarkRecord(row) {
  return {
    jcode: row.jcode,
    nickname: row.nickname || "",
    notes: row.notes || "",
    tags: Array.isArray(row.tags) ? row.tags : [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function tagRecord(row) {
  return {
    tag: row.tag,
    color: cleanTagColor(row.color),
  };
}

async function ensureUserTags(userId, tags) {
  const clean = cleanTags(tags);
  if (!clean.length) return;
  await pool.query(
    `
    INSERT INTO wormhole_bookmark_tags (user_id, tag_key, tag)
    SELECT $1, tag_key, tag
    FROM jsonb_to_recordset($2::jsonb) AS x(tag_key text, tag text)
    ON CONFLICT (user_id, tag_key)
    DO UPDATE SET tag = EXCLUDED.tag, updated_at = now()
    `,
    [userId, JSON.stringify(clean.map((tag) => ({ tag_key: tagKey(tag), tag })))]
  );
}

async function upsertUserTag(userId, tag, color) {
  await pool.query(
    `
    INSERT INTO wormhole_bookmark_tags (user_id, tag_key, tag, color)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (user_id, tag_key)
    DO UPDATE SET tag = EXCLUDED.tag, color = EXCLUDED.color, updated_at = now()
    `,
    [userId, tagKey(tag), tag, cleanTagColor(color)]
  );
}

router.get("/", siteAuth.requireAuth, async (req, res) => {
  try {
    await ensureBookmarkSchema();
    const { rows } = await pool.query(
      `
      SELECT jcode, nickname, notes, tags, created_at, updated_at
      FROM wormhole_bookmarks
      WHERE user_id = $1
      ORDER BY updated_at DESC, jcode ASC
      `,
      [req.siteUser.id]
    );
    return res.json({ ok: true, bookmarks: rows.map(bookmarkRecord) });
  } catch (err) {
    console.error("[wormhole-bookmarks] list error", err);
    return res.status(500).json({ ok: false, error: "wormhole_bookmarks_failed", bookmarks: [] });
  }
});

router.get("/tags", siteAuth.requireAuth, async (req, res) => {
  try {
    await ensureBookmarkSchema();
    const { rows } = await pool.query(
      `
      WITH explicit_tags AS (
        SELECT tag_key, tag, color, updated_at, 1 AS priority
        FROM wormhole_bookmark_tags
        WHERE user_id = $1
      ),
      bookmark_tags AS (
        SELECT lower(tag) AS tag_key, tag, NULL::text AS color, MAX(updated_at) AS updated_at, 0 AS priority
        FROM wormhole_bookmarks b
        CROSS JOIN LATERAL jsonb_array_elements_text(b.tags) AS tag
        WHERE b.user_id = $1
        GROUP BY tag
      ),
      combined AS (
        SELECT tag_key, tag, color, updated_at, priority FROM explicit_tags
        UNION ALL
        SELECT tag_key, tag, color, updated_at, priority FROM bookmark_tags
      )
      SELECT DISTINCT ON (tag_key) tag, COALESCE(color, '#53b6ff') AS color, updated_at
      FROM combined
      WHERE NULLIF(trim(tag), '') IS NOT NULL
      ORDER BY tag_key, priority DESC, updated_at DESC
      `,
      [req.siteUser.id]
    );
    return res.json({
      ok: true,
      tags: rows.map(tagRecord).sort((a, b) => a.tag.localeCompare(b.tag)),
    });
  } catch (err) {
    console.error("[wormhole-bookmarks] tags list error", err);
    return res.status(500).json({ ok: false, error: "wormhole_bookmark_tags_failed", tags: [] });
  }
});

router.post("/tags", siteAuth.requireAuth, async (req, res) => {
  try {
    const tag = cleanTag(req.body?.tag);
    if (!tag) return res.status(400).json({ ok: false, error: "invalid_tag" });
    const color = cleanTagColor(req.body?.color);
    await ensureBookmarkSchema();
    await upsertUserTag(req.siteUser.id, tag, color);
    return res.json({ ok: true, tag: { tag, color } });
  } catch (err) {
    console.error("[wormhole-bookmarks] tag create error", err);
    return res.status(500).json({ ok: false, error: "wormhole_bookmark_tag_create_failed" });
  }
});

router.delete("/tags/:tag", siteAuth.requireAuth, async (req, res) => {
  const client = await pool.connect();
  try {
    const tag = cleanTag(req.params.tag);
    if (!tag) return res.status(400).json({ ok: false, error: "invalid_tag" });
    const key = tagKey(tag);
    await ensureBookmarkSchema();
    await client.query("BEGIN");
    await client.query(
      "DELETE FROM wormhole_bookmark_tags WHERE user_id = $1 AND tag_key = $2",
      [req.siteUser.id, key]
    );
    await client.query(
      `
      UPDATE wormhole_bookmarks b
      SET tags = COALESCE(
          (
            SELECT jsonb_agg(item.tag ORDER BY item.ordinality)
            FROM jsonb_array_elements_text(b.tags) WITH ORDINALITY AS item(tag, ordinality)
            WHERE lower(item.tag) <> $2
          ),
          '[]'::jsonb
        ),
        updated_at = now()
      WHERE b.user_id = $1
        AND EXISTS (
          SELECT 1
          FROM jsonb_array_elements_text(b.tags) AS item(tag)
          WHERE lower(item.tag) = $2
        )
      `,
      [req.siteUser.id, key]
    );
    await client.query("COMMIT");
    return res.json({ ok: true });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("[wormhole-bookmarks] tag delete error", err);
    return res.status(500).json({ ok: false, error: "wormhole_bookmark_tag_delete_failed" });
  } finally {
    client.release();
  }
});

router.get("/:jcode", siteAuth.requireAuth, async (req, res) => {
  try {
    const jcode = cleanJcode(req.params.jcode);
    if (!jcode) return res.status(400).json({ ok: false, error: "invalid_jcode" });
    await ensureBookmarkSchema();
    const { rows } = await pool.query(
      `
      SELECT jcode, nickname, notes, tags, created_at, updated_at
      FROM wormhole_bookmarks
      WHERE user_id = $1 AND jcode = $2
      `,
      [req.siteUser.id, jcode]
    );
    return res.json({ ok: true, bookmark: rows[0] ? bookmarkRecord(rows[0]) : null });
  } catch (err) {
    console.error("[wormhole-bookmarks] read error", err);
    return res.status(500).json({ ok: false, error: "wormhole_bookmark_read_failed" });
  }
});

router.put("/:jcode", siteAuth.requireAuth, async (req, res) => {
  try {
    const jcode = cleanJcode(req.params.jcode);
    if (!jcode) return res.status(400).json({ ok: false, error: "invalid_jcode" });
    const nickname = cleanNickname(req.body?.nickname);
    const notes = cleanNotes(req.body?.notes);
    const tags = cleanTags(req.body?.tags);
    await ensureBookmarkSchema();
    await ensureUserTags(req.siteUser.id, tags);
    const { rows } = await pool.query(
      `
      INSERT INTO wormhole_bookmarks (user_id, jcode, nickname, notes, tags)
      VALUES ($1, $2, $3, $4, $5::jsonb)
      ON CONFLICT (user_id, jcode)
      DO UPDATE SET nickname = EXCLUDED.nickname, notes = EXCLUDED.notes, tags = EXCLUDED.tags, updated_at = now()
      RETURNING jcode, nickname, notes, tags, created_at, updated_at
      `,
      [req.siteUser.id, jcode, nickname, notes, JSON.stringify(tags)]
    );
    return res.json({ ok: true, bookmark: bookmarkRecord(rows[0]) });
  } catch (err) {
    console.error("[wormhole-bookmarks] upsert error", err);
    return res.status(500).json({ ok: false, error: "wormhole_bookmark_update_failed" });
  }
});

router.delete("/:jcode", siteAuth.requireAuth, async (req, res) => {
  try {
    const jcode = cleanJcode(req.params.jcode);
    if (!jcode) return res.status(400).json({ ok: false, error: "invalid_jcode" });
    await ensureBookmarkSchema();
    await pool.query(
      "DELETE FROM wormhole_bookmarks WHERE user_id = $1 AND jcode = $2",
      [req.siteUser.id, jcode]
    );
    return res.json({ ok: true });
  } catch (err) {
    console.error("[wormhole-bookmarks] delete error", err);
    return res.status(500).json({ ok: false, error: "wormhole_bookmark_delete_failed" });
  }
});

module.exports = router;
