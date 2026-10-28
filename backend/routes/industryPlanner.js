/*
 * Express router for industry Planner API endpoints.
 * Reads request params, query strings, or bodies and returns JSON or HTTP responses via local services.
 */

const express = require('express');
const router = express.Router();

const { computeIndustryPlan } = require('../lib/industryGraph');
const { searchTypesByName } = require('../lib/everefData');

router.post('/industry/plan', async (req, res) => {
  try {
    const { items, options } = req.body || {};
    const plan = await computeIndustryPlan(items || [], options || {});
    res.json(plan);
  } catch (e) {
    console.error('[industry/plan] error', e);
    res.status(500).json({
      error: 'Failed to compute industry plan',
      details: e.message,
    });
  }
});

router.get('/types/search', (req, res) => {
  try {
    const q = (req.query.q || '').toString();
    const results = searchTypesByName(q, 30);
    res.json(results);
  } catch (e) {
    console.error('[types/search] error', e);
    res.status(500).json({ error: 'Search failed', details: e.message });
  }
});

module.exports = router;
