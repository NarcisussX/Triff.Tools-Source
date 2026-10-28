const test = require("node:test");
const assert = require("node:assert/strict");
const { installExternalModuleFallbacks } = require("./helpers/moduleStubs");

installExternalModuleFallbacks();

const triffLocal = require("../services/triffLocal");
const triffLocalRoute = require("../routes/triffLocal")._test;
const accountLinks = require("../services/accountLinks");

const {
  cleanCharacterName,
  extractShowInfoNames,
  extractTranscriptName,
  normalizeZkillStats,
  summarizeReport,
  makeTitle,
} = triffLocal._test;

test("TriffLocal parses EVE showinfo links before falling back to line parsing", () => {
  const source = [
    '<url=showinfo:1377//95036967>Jason Chorant</url>',
    '<url=showinfo:1378//123456789>Sample Pilot</url>',
    '<url=showinfo:1378//123456789>Sample Pilot</url>',
  ].join("\n");

  assert.deepEqual(extractShowInfoNames(source), ["Jason Chorant", "Sample Pilot", "Sample Pilot"]);
  assert.deepEqual(triffLocal.parseTriffLocalInput(source), ["Jason Chorant", "Sample Pilot"]);
});

test("TriffLocal extracts names from copied chat transcripts and member lists", () => {
  assert.equal(
    extractTranscriptName("[ 2026.06.18 05:00:00 ] Cooper Broderick > o/"),
    "Cooper Broderick"
  );
  assert.equal(extractTranscriptName("Another Pilot > check"), "Another Pilot");
  assert.equal(cleanCharacterName("  Bad\nName  "), "Bad Name");
  assert.equal(cleanCharacterName("ab"), null);

  const source = [
    "[ 2026.06.18 05:00:00 ] Cooper Broderick > o/",
    "Another Pilot",
    "Another Pilot",
    "This line is much too long to be a valid EVE character name and should not survive",
  ].join("\n");

  assert.deepEqual(triffLocal.parseTriffLocalInput(source), ["Cooper Broderick", "Another Pilot"]);
});

test("TriffLocal caps synchronous pasted names at 500 by default", () => {
  const source = Array.from({ length: 600 }, (_, index) => `Pilot ${index}`).join("\n");
  const names = triffLocal.parseTriffLocalInput(source);

  assert.equal(names.length, 500);
  assert.equal(names[0], "Pilot 0");
  assert.equal(names[499], "Pilot 499");
});

test("TriffLocal normalizes zKill stats into client-ready fields", () => {
  assert.deepEqual(
    normalizeZkillStats({
      shipsDestroyed: 123,
      shipsLost: 45,
      dangerRatio: 88,
      gangRatio: 12,
      topLists: [
        {
          type: "shipType",
          values: [
            { id: 22456, name: "Sabre" },
            { id: 17736, name: "Nightmare" },
          ],
        },
      ],
    }),
    {
      shipsDestroyed: 123,
      shipsLost: 45,
      dangerRatio: 0.88,
      dangerPercent: 88,
      gangRatio: 0.12,
      gangPercent: 12,
      topShips: [
        {
          typeId: 22456,
          name: "Sabre",
          zkillUrl: "https://zkillboard.com/ship/22456/",
          imageUrl: "https://images.evetech.net/types/22456/render?size=64",
        },
        {
          typeId: 17736,
          name: "Nightmare",
          zkillUrl: "https://zkillboard.com/ship/17736/",
          imageUrl: "https://images.evetech.net/types/17736/render?size=64",
        },
      ],
    }
  );
});

test("TriffLocal report summaries and titles are stable", () => {
  const characters = [
    {
      status: "ok",
      character: { name: "First Pilot" },
      zkill: { shipsDestroyed: 10, shipsLost: 3, dangerPercent: 80 },
    },
    {
      status: "partial",
      character: { name: "Second Pilot" },
      zkill: { shipsDestroyed: 2, shipsLost: 7, dangerPercent: 10 },
    },
    {
      status: "unresolved",
      character: { name: "Unknown Pilot" },
      zkill: {},
    },
  ];

  assert.equal(makeTitle(characters), "First Pilot, Second Pilot + 1 more");
  assert.deepEqual(summarizeReport(characters, 3), {
    parsedCount: 3,
    characterCount: 3,
    resolvedCount: 2,
    unresolvedCount: 1,
    partialCount: 1,
    totalShipsDestroyed: 12,
    totalShipsLost: 10,
    highDangerCount: 1,
  });
});

test("TriffLocal route and account link helpers expose expected API boundaries", () => {
  assert.equal(triffLocal.cleanReportId("abcDEF123_-"), "abcDEF123_-");
  assert.equal(triffLocal.cleanReportId("bad id"), null);

  assert.equal(triffLocalRoute.readInput({ body: "Raw paste" }), "Raw paste");
  assert.equal(triffLocalRoute.readInput({ body: { input: "Input paste" } }), "Input paste");
  assert.equal(triffLocalRoute.readInput({ body: { paste: "Paste text" } }), "Paste text");
  assert.equal(triffLocalRoute.readInput({ body: { source: "Source text" } }), "Source text");

  assert.equal(accountLinks._test.VALID_KINDS.has("triff_local_report"), true);
});

test("TriffLocal create rate limit charges larger reports more heavily", () => {
  const now = Date.UTC(2026, 5, 18, 12, 0, 0);
  const smallPrincipal = "test:small-rate";
  const largePrincipal = "test:large-rate";

  assert.equal(triffLocalRoute.createRateCost(100), 1);
  assert.equal(triffLocalRoute.createRateCost(101), 2.5);

  for (let i = 0; i < 20; i += 1) {
    assert.equal(triffLocalRoute.checkCreateRateLimit(smallPrincipal, 50, now).ok, true);
  }
  assert.deepEqual(triffLocalRoute.checkCreateRateLimit(smallPrincipal, 50, now), {
    ok: false,
    error: "rate_limited",
  });

  for (let i = 0; i < 8; i += 1) {
    assert.equal(triffLocalRoute.checkCreateRateLimit(largePrincipal, 500, now).ok, true);
  }
  assert.deepEqual(triffLocalRoute.checkCreateRateLimit(largePrincipal, 500, now), {
    ok: false,
    error: "rate_limited",
  });

  assert.equal(
    triffLocalRoute.checkCreateRateLimit(largePrincipal, 500, now + 60 * 1000).ok,
    true
  );
});
