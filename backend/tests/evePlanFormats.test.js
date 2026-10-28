"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { gzipSync } = require("node:zlib");

const formats = require("../domain/eveSkills/planFormats");

const SKILLS = [
  {
    skillTypeId: 3327,
    name: "Spaceship Command",
    rank: 1,
    primaryAttribute: "perception",
    secondaryAttribute: "willpower",
    prerequisites: [],
  },
  {
    skillTypeId: 3426,
    name: "CPU Management",
    rank: 1,
    primaryAttribute: "intelligence",
    secondaryAttribute: "memory",
    prerequisites: [],
  },
];

const SINGLE_PLAN_XML = `<?xml version="1.0" encoding="utf-8"?>
<plan revision="42" name="Clean &amp; Fast" owner="00000000-0000-0000-0000-000000000000" description="Test plan">
  <entry skillID="3426" skill="CPU Management" level="4" priority="2" type="Planned">
    <notes>Fit &amp; capacitor</notes>
    <group>Engineering</group>
    <group>Core</group>
    <remapping status="UpToDate" per="17" int="27" mem="21" wil="17" cha="17" description="INT/MEM" />
  </entry>
</plan>`;

test("plain EVEMon XML preserves plan and entry metadata", () => {
  const parsed = formats.parsePlanPayload(SINGLE_PLAN_XML, { skills: SKILLS });
  assert.equal(parsed.format, "evemon-xml");
  assert.equal(parsed.root, "plan");
  assert.equal(parsed.compressed, false);
  assert.equal(parsed.plans[0].name, "Clean & Fast");
  assert.equal(parsed.plans[0].revision, 42);
  assert.deepEqual(parsed.plans[0].rows[0], {
    skillTypeId: 3426,
    skillName: "CPU Management",
    targetLevel: 4,
    priority: 2,
    entryType: "Planned",
    notes: "Fit & capacitor",
    groups: ["Engineering", "Core"],
    remap: {
      status: "UpToDate",
      perception: 17,
      intelligence: 27,
      memory: 21,
      willpower: 17,
      charisma: 17,
      description: "INT/MEM",
      legacyBaseAttributes: undefined,
    },
    source: { format: "evemon-xml", planIndex: 0, entryIndex: 0 },
    resolvedBy: "id",
  });
});

test("gzip is sniffed from base64 bytes for EMP regardless of extension", () => {
  const base64 = gzipSync(Buffer.from(SINGLE_PLAN_XML)).toString("base64");
  const parsed = formats.parsePlanPayload({ base64, filename: "renamed.data" }, { skills: SKILLS });
  assert.equal(parsed.compressed, true);
  assert.equal(parsed.filename, "renamed.data");
  assert.equal(parsed.plans[0].rows[0].skillTypeId, 3426);

  const autoDetected = formats.parsePlanPayload(base64, { filename: "plan.emp" });
  assert.equal(autoDetected.compressed, true);
});

test("EPB plans root imports multiple plans and compatibility API flattens them", () => {
  const xml = `<?xml version="1.0"?><plans revision="9">
    <plan name="Ships"><entry skillID="3327" skill="Spaceship Command" level="3" /></plan>
    <plan name="Engineering"><entry skillID="3426" skill="CPU Management" level="5" /></plan>
  </plans>`;
  const parsed = formats.parsePlan(gzipSync(Buffer.from(xml)).toString("base64"), {
    encoding: "base64",
    filename: "backup.epb",
  });
  assert.equal(parsed.plans.length, 2);
  assert.equal(parsed.entries.length, 2);
  assert.equal(parsed.entries[0].group, "Ships");
  assert.equal(parsed.entries[1].group, "Engineering");
});

test("legacy revision-zero entry children are accepted as migration input", () => {
  const legacy = `<plan><Entries><entry>
    <SkillName>Spaceship Command</SkillName><Level>3</Level>
    <EntryType>Planned</EntryType><Notes>Legacy archive</Notes>
    <PlanGroups><anyType>Ships</anyType></PlanGroups>
  </entry></Entries></plan>`;
  const parsed = formats.parsePlanPayload(legacy, { skills: SKILLS });
  assert.equal(parsed.plans[0].rows[0].skillTypeId, 3327);
  assert.equal(parsed.plans[0].rows[0].targetLevel, 3);
  assert.deepEqual(parsed.plans[0].rows[0].groups, ["Ships"]);
  assert.equal(parsed.plans[0].rows[0].notes, "Legacy archive");
});

test("DTD, entity declarations, and unresolved XML entities are rejected", () => {
  assert.throws(
    () => formats.parsePlanPayload(`<!DOCTYPE plan [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><plan name="&xxe;"></plan>`),
    (error) => error.code === "XML_DTD_FORBIDDEN",
  );
  assert.throws(
    () => formats.parsePlanPayload(`<plan name="&custom;"></plan>`),
    (error) => error.code === "UNSUPPORTED_XML_ENTITY",
  );
});

test("compressed and decompressed byte ceilings stop oversized payloads", () => {
  assert.throws(
    () => formats.decodePlanPayload("x".repeat(101), { maxCompressedBytes: 100 }),
    (error) => error.code === "COMPRESSED_SIZE_LIMIT",
  );
  const compressed = gzipSync(Buffer.from("x".repeat(20_000)));
  assert.throws(
    () => formats.decodePlanPayload(compressed, { maxDecompressedBytes: 1_000 }),
    (error) => error.code === "DECOMPRESSED_SIZE_LIMIT",
  );
});

test("CSV uses skill ID first and falls back to a unique current name", () => {
  const csv = `skillTypeId,skillName,targetLevel,notes,groups
3426,Old CPU Name,4,Core fitting,Engineering|Core
999999,Spaceship Command,3,Ships,Command`;
  const parsed = formats.parsePlanPayload(csv, { skills: SKILLS });
  assert.equal(parsed.plans[0].rows[0].skillTypeId, 3426);
  assert.equal(parsed.plans[0].rows[0].skillName, "CPU Management");
  assert.equal(parsed.plans[0].rows[0].resolvedBy, "id");
  assert.equal(parsed.plans[0].rows[1].skillTypeId, 3327);
  assert.equal(parsed.plans[0].rows[1].resolvedBy, "name");
  assert.ok(parsed.warnings.some((warning) => warning.code === "SKILL_ID_NAME_MISMATCH"));
  assert.ok(parsed.warnings.some((warning) => warning.code === "UNKNOWN_ID_NAME_FALLBACK"));
});

test("strict human text accepts Roman and numeric levels and warns on junk", () => {
  const parsed = formats.parsePlanPayload(`CPU Management IV
Spaceship Command level 3
this is not a skill row`, { skills: SKILLS });
  assert.deepEqual(parsed.plans[0].rows.map((row) => row.targetLevel), [4, 3]);
  assert.equal(parsed.warnings[0].code, "UNPARSED_TEXT_LINE");
});

test("native JSON, CSV, text, and EVEMon XML exports round-trip", () => {
  const plan = {
    name: "Round trip",
    description: "Metadata",
    entries: [
      {
        skillTypeId: 3426,
        skillName: "CPU Management",
        targetLevel: 4,
        notes: "quoted, note",
        group: "Engineering",
        groups: ["Engineering"],
        remap: { intelligence: 27, memory: 21, perception: 17, willpower: 17, charisma: 17 },
      },
    ],
  };

  const json = formats.exportPlanJson(plan);
  assert.equal(formats.parsePlanPayload(json).plans[0].rows[0].targetLevel, 4);

  const csv = formats.exportPlanCsv(plan);
  assert.equal(formats.parsePlanPayload(csv).plans[0].rows[0].notes, "quoted, note");

  const text = formats.exportPlanText(plan);
  assert.match(text, /CPU Management IV/);
  assert.equal(formats.parsePlanPayload(text).plans[0].rows[0].targetLevel, 4);

  const xml = formats.exportEvemonXml(plan);
  const parsedXml = formats.parsePlanPayload(xml);
  assert.equal(parsedXml.plans[0].name, "Round trip");
  assert.equal(parsedXml.plans[0].rows[0].remap.intelligence, 27);

  const serviceExport = formats.exportPlan(plan, "xml");
  assert.equal(serviceExport.extension, "xml");
  assert.match(serviceExport.mimeType, /application\/xml/);

  const aliasExport = formats.exportPlan(plan, "evemon");
  assert.equal(aliasExport.extension, "xml");
  assert.equal(formats.parsePlanPayload(aliasExport.content).plans[0].name, "Round trip");

  const empExport = formats.exportPlan(plan, "emp");
  assert.equal(empExport.extension, "emp");
  assert.equal(empExport.encoding, "base64");
  const parsedEmp = formats.parsePlanPayload(empExport.content, { filename: "round-trip.emp" });
  assert.equal(parsedEmp.compressed, true);
  assert.equal(parsedEmp.plans[0].rows[0].skillTypeId, 3426);

  const epbExport = formats.exportPlan(plan, "epb");
  assert.equal(epbExport.extension, "epb");
  assert.equal(epbExport.encoding, "base64");
  const parsedEpb = formats.parsePlanPayload(epbExport.content, { filename: "round-trip.epb" });
  assert.equal(parsedEpb.compressed, true);
  assert.equal(parsedEpb.root, "plans");
});
