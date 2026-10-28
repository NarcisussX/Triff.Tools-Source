/*
 * Express router for market Items API endpoints.
 * Reads request params, query strings, or bodies and returns JSON or HTTP responses via local services.
 */

const express = require('express');
const router = express.Router();
const db = require('../lib/marketDb');

router.get('/items', async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    if (q.length < 2) {
      return res.json([]);
    }

    const { rows } = await db.query(
      `
      SELECT "typeID" AS type_id, "typeName" AS type_name
      FROM evesde."invTypes"
      WHERE "published" = TRUE
        AND LOWER("typeName") LIKE LOWER($1)
      ORDER BY "typeName"
      LIMIT 50
      `,
      [`%${q}%`]
    );

    res.json(rows);
  } catch (err) {
    console.error('[market/items] error', err);
    res.status(500).json({ error: 'internal_error' });
  }
});

module.exports = router;
