/*
 * Backend library module for everef Refresh.
 * Provides shared data loading, pricing, or planning helpers used by API routes and jobs.
 */

const { spawn } = require('child_process');
const path = require('path');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'refresh-everef.sh');

function runOnce() {
  return new Promise((resolve, reject) => {
    const p = spawn(SCRIPT, [], { stdio: 'inherit' });
    p.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`refresh-everef exited with code ${code}`));
    });
  });
}

function scheduleEverefRefresh() {
  runOnce().catch((e) => {
    console.error('[everefRefresh] initial run failed:', e.message);
  });

  const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;
  setInterval(() => {
    runOnce().catch((e) =>
      console.error('[everefRefresh] scheduled run failed:', e.message)
    );
  }, TWENTY_FOUR_HOURS);
}

module.exports = { scheduleEverefRefresh, runOnce };
