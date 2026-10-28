/* Local visual QA only: production React build + real routes/SQL, full SDE and real history.
 * Run after frontend build: node backend/scripts/previewHullActivity.js
 * Never mounted by the production server. No external database is modified.
 */
const express = require('express');
const path = require('node:path');

async function main() {
  const { createFullHullActivityDb, auditFullHullCoverage } = require('../tests/support/fullHullActivityDb');
  const { database, catalogue, history } = await createFullHullActivityDb();
  const report = await auditFullHullCoverage(database, catalogue, history);
  const fs = require('node:fs/promises');
  const artifacts = path.resolve(__dirname, '../../artifacts/hull-activity');
  await fs.mkdir(artifacts, { recursive: true });
  await fs.writeFile(path.join(artifacts, 'coverage-audit.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...report, hulls: undefined, availableDates: undefined }));
  return startPreview(database, () => new Date(), 4174);
}

function startPreview(database, now, port) {
  const hullActivity = require('../services/hullActivity');
  Object.assign(hullActivity, hullActivity.createHullActivityService(database, now));
  const app = express();
  app.use(require('../server/botEmbeds'));
  app.use('/api/hulls', require('../routes/hulls'));
  app.use('/api', (_req, res) => res.status(503).json({ error: 'Other services are not running in the Hull Activity QA preview.' }));
  const dist = path.resolve(__dirname, '../../frontend/dist');
  app.use(express.static(dist));
  app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  const server = app.listen(port, '127.0.0.1', () => console.log(`Hull Activity QA: http://127.0.0.1:${port}/hulls`));
  const stop = () => server.close(async () => { await database.close(); process.exit(0); });
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
