/*
 * Express router for market Tree API endpoints.
 * Reads request params, query strings, or bodies and returns JSON or HTTP responses via local services.
 */

const express = require('express');
const router = express.Router();
const db = require('../lib/marketDb');

router.get('/tree', async (_req, res) => {
    try {
        const { rows: groups } = await db.query(`
      SELECT
        "marketGroupID"   AS id,
        "parentGroupID"   AS parent_id,
        "marketGroupName" AS name
      FROM evesde."invMarketGroups"
      ORDER BY "parentGroupID" NULLS FIRST, "marketGroupName"
    `);

        const { rows: types } = await db.query(`
  SELECT
    "typeID"        AS type_id,
    "typeName"      AS name,
    "marketGroupID" AS market_group_id
  FROM evesde."invTypes"
  WHERE "published" IS TRUE
    AND "marketGroupID" IS NOT NULL
`);

        const groupMap = new Map();
        groups.forEach(g => {
            groupMap.set(g.id, {
                id: g.id,
                parent_id: g.parent_id,
                name: g.name,
                children: [],
                types: [],
            });
        });

        const roots = [];
        groupMap.forEach(g => {
            if (g.parent_id && groupMap.has(g.parent_id)) {
                groupMap.get(g.parent_id).children.push(g);
            } else {
                roots.push(g);
            }
        });

        types.forEach(t => {
            const g = groupMap.get(t.market_group_id);
            if (g) {
                g.types.push({ type_id: t.type_id, name: t.name });
            }
        });

        res.json(roots);
    } catch (err) {
        console.error('[market/tree] error', err);
        res.status(500).json({ error: 'internal_error' });
    }
});

module.exports = router;
