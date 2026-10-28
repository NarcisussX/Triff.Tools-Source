/*
 * In-process reader/writer gate for the structure-age index.
 *
 * A public check holds a reader slot from estimate through observation write.
 * A reference reload takes the writer slot, waits for those writes to finish,
 * swaps the in-memory index, then allows new checks to start. This gate is
 * process-local; the current Compose deployment intentionally has one backend
 * replica. A multi-replica deployment must add a distributed request gate.
 */

let activeChecks = 0;
let pendingReloads = 0;
let reloadTail = Promise.resolve();
let checkWaiters = [];
let drainWaiters = [];

function wake(waiters) {
  const current = waiters;
  for (const resolve of current) resolve();
}

async function withStructureAgeCheck(action) {
  while (pendingReloads > 0) {
    await new Promise((resolve) => checkWaiters.push(resolve));
  }
  activeChecks += 1;
  try {
    return await action();
  } finally {
    activeChecks -= 1;
    if (activeChecks === 0 && drainWaiters.length) {
      const current = drainWaiters;
      drainWaiters = [];
      wake(current);
    }
  }
}

async function reloadStructureAgeIndexExclusive(reload) {
  pendingReloads += 1;
  const previousReload = reloadTail;
  let finishReload;
  reloadTail = new Promise((resolve) => { finishReload = resolve; });

  await previousReload;
  try {
    if (activeChecks > 0) {
      await new Promise((resolve) => drainWaiters.push(resolve));
    }
    return await reload();
  } finally {
    pendingReloads -= 1;
    finishReload();
    if (pendingReloads === 0 && checkWaiters.length) {
      const current = checkWaiters;
      checkWaiters = [];
      wake(current);
    }
  }
}

module.exports = {
  withStructureAgeCheck,
  reloadStructureAgeIndexExclusive,
  _test: {
    state: () => ({ activeChecks, pendingReloads }),
  },
};
