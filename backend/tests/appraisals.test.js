const test = require("node:test");
const assert = require("node:assert/strict");
const { installExternalModuleFallbacks } = require("./helpers/moduleStubs");

installExternalModuleFallbacks();
const appraisals = require("../routes/appraisals")._test;

test("parseJSONIfString unwraps nested serialized values defensively", () => {
  const nested = JSON.stringify(JSON.stringify({ ok: true, count: 2 }));
  assert.deepEqual(appraisals.parseJSONIfString(nested), { ok: true, count: 2 });
  assert.equal(appraisals.parseJSONIfString("{not json"), "{not json");
});

test("normalizeTotals coerces appraisal totals and clamps adjustment percent", () => {
  assert.deepEqual(appraisals.normalizeTotals({
    volume: "12.5",
    sell: "1000000.25",
    buy: "",
    split: "NaN",
    itemCount: "3",
    adjusted: "900000",
    adjustmentPct: "250",
  }), {
    volume: 12.5,
    sell: 1000000.25,
    buy: 0,
    split: 0,
    itemCount: 3,
    adjusted: 900000,
    adjustmentPct: 200,
  });

  assert.equal(appraisals.normalizeTotals(JSON.stringify({ adjustmentPct: "-10" })).adjustmentPct, 0);
});

test("normalizeRows keeps shareable appraisal rows JSON-safe", () => {
  const rows = appraisals.normalizeRows(JSON.stringify([
    JSON.stringify({
      type_id: "34",
      name: 12345,
      qty: "10",
      m3: "0.01",
      price: "5.5",
      lineISK: "55",
      source: "sell_min",
      status: "ok",
    }),
    "not an object",
  ]));

  assert.deepEqual(rows[0], {
    type_id: 34,
    name: "12345",
    qty: 10,
    m3: 0.01,
    price: 5.5,
    lineISK: 55,
    source: "sell_min",
    status: "ok",
  });

  assert.deepEqual(rows[1], {
    type_id: null,
    name: "",
    qty: 0,
    m3: null,
    price: null,
    lineISK: null,
    source: "n/a",
    status: undefined,
  });
});
