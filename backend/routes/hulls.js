const express = require('express');
const hullActivity = require('../services/hullActivity');

function createHullRouter(service = hullActivity) {
  const router = express.Router();
  router.get('/regions', async (_req, res) => {
    try {
      res.json({ regions: await service.getRegions() });
    } catch (error) {
      console.error('[hulls] regions:', error);
      res.status(503).json({ error: 'Hull Activity regions are temporarily unavailable.' });
    }
  });
  router.get('/activity', async (req, res) => {
    try {
      res.json(await service.getActivity(req.query));
    } catch (error) {
      if (error instanceof hullActivity.HullActivityError) {
        return res.status(error.status).json({ error: error.message });
      }
      console.error('[hulls] activity:', error);
      res.status(503).json({ error: 'Hull Activity is temporarily unavailable.' });
    }
  });
  return router;
}

module.exports = createHullRouter();
module.exports.createHullRouter = createHullRouter;
