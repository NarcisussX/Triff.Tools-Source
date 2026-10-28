const express = require("express");
const cookieParser = require("cookie-parser");
const pool = require("../db/pool");
const fittingClient = require("../services/fittingClient");
const inGameFittingEsi = require("../services/inGameFittingEsi");
const siteAuth = require("../services/siteAuth");

const router = express.Router();
router.use(cookieParser());

const SLOT_FLAG_MAP = [
  { re: /^HiSlot(\d+)$/i, slot: "high" },
  { re: /^MedSlot(\d+)$/i, slot: "mid" },
  { re: /^LoSlot(\d+)$/i, slot: "low" },
  { re: /^RigSlot(\d+)$/i, slot: "rig" },
  { re: /^SubSystemSlot(\d+)$/i, slot: "subsystem" },
];

function parseTypeId(value) {
  const id = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(id) && id > 0 ? id : null;
}

function serviceError(res, err) {
  console.error("[in-game-fitting] fitting-service error", err?.body || err?.message || err);
  const status = err?.status && err.status >= 400 ? 502 : 500;
  return res.status(status).json({
    ok: false,
    error: "fitting_service_error",
    details: err?.body || { message: err?.message || "fitting-service request failed" },
  });
}

function typeName(typeInfo, typeId) {
  return typeInfo.get(Number(typeId))?.typeName || `Type ${typeId}`;
}

function fittingItems(fitting) {
  return Array.isArray(fitting?.items) ? fitting.items : [];
}

function fittingId(value) {
  const id = Number(value?.fitting_id ?? value?.fittingId ?? value?.id);
  return Number.isFinite(id) && id > 0 ? id : null;
}

function fittingName(value) {
  return String(value?.name || "In-Game Fit").trim().slice(0, 160) || "In-Game Fit";
}

function shipTypeId(value) {
  return parseTypeId(value?.ship_type_id ?? value?.shipTypeId);
}

async function typeInfoById(typeIds) {
  const ids = Array.from(new Set(typeIds.map(Number).filter((id) => Number.isFinite(id) && id > 0)));
  if (!ids.length) return new Map();
  const { rows } = await pool.query(
    `
    SELECT
      t."typeID" AS "typeId",
      t."typeName" AS "typeName",
      g."groupName" AS "groupName",
      c."categoryName" AS "categoryName"
    FROM evesde."invTypes" t
    LEFT JOIN evesde."invGroups" g ON g."groupID" = t."groupID"
    LEFT JOIN evesde."invCategories" c ON c."categoryID" = g."categoryID"
    WHERE t."typeID" = ANY($1::int[])
    `,
    [ids]
  );
  return new Map(rows.map((row) => [Number(row.typeId), row]));
}

function fittingSummary(fitting, typeInfo) {
  const id = fittingId(fitting);
  const shipId = shipTypeId(fitting);
  const shipInfo = shipId ? typeInfo.get(Number(shipId)) : null;
  const items = fittingItems(fitting);
  let moduleCount = 0;
  let cargoCount = 0;
  let droneCount = 0;
  for (const item of items) {
    const flag = String(item.flag || "");
    if (SLOT_FLAG_MAP.some(({ re }) => re.test(flag))) moduleCount += Math.max(1, Number(item.quantity) || 1);
    else if (/^DroneBay$/i.test(flag)) droneCount += Math.max(0, Number(item.quantity) || 0);
    else if (/^Cargo$/i.test(flag)) cargoCount += Math.max(0, Number(item.quantity) || 0);
  }
  return {
    fittingId: id,
    name: fittingName(fitting),
    description: String(fitting.description || "").slice(0, 2000),
    shipTypeId: shipId,
    shipTypeName: shipInfo?.typeName || (shipId ? typeName(typeInfo, shipId) : "Unknown Ship"),
    shipGroupName: shipInfo?.groupName || "Other Ships",
    shipCategoryName: shipInfo?.categoryName || null,
    itemCount: items.length,
    moduleCount,
    droneCount,
    cargoCount,
  };
}

function slotFlag(flag) {
  for (const entry of SLOT_FLAG_MAP) {
    const match = String(flag || "").match(entry.re);
    if (match) return { slot: entry.slot, index: Number(match[1]) || 0 };
  }
  return null;
}

function convertEsiFittingToPayload(fitting, typeInfo) {
  const warnings = [];
  const shipId = shipTypeId(fitting);
  const name = fittingName(fitting);
  const buckets = {
    high: [],
    mid: [],
    low: [],
    rig: [],
    subsystem: [],
  };
  const drones = [];
  const cargo = [];

  for (const rawItem of fittingItems(fitting)) {
    const typeId = parseTypeId(rawItem.type_id ?? rawItem.typeId);
    const quantity = Math.max(0, Math.floor(Number(rawItem.quantity) || 0));
    const flag = String(rawItem.flag || "");
    if (!typeId || quantity <= 0) {
      warnings.push({ code: "esi_item_skipped", message: `Skipped item with invalid type or quantity in ${name}.` });
      continue;
    }
    const slot = slotFlag(flag);
    if (slot) {
      buckets[slot.slot].push({
        slotIndex: slot.index,
        module: {
          id: `esi-${fittingId(fitting) || "fit"}-${slot.slot}-${slot.index}-${typeId}`,
          typeId,
          typeName: typeName(typeInfo, typeId),
          state: "active",
        },
      });
      if (quantity > 1) {
        warnings.push({
          code: "esi_slot_quantity_ignored",
          message: `${typeName(typeInfo, typeId)} had quantity ${quantity} in ${flag}; fitted one module for that slot.`,
        });
      }
      continue;
    }

    if (/^DroneBay$/i.test(flag)) {
      drones.push({
        typeId,
        typeName: typeName(typeInfo, typeId),
        quantity,
        active: quantity,
      });
      continue;
    }

    if (/^Cargo$/i.test(flag)) {
      cargo.push({
        typeId,
        typeName: typeName(typeInfo, typeId),
        quantity,
      });
      continue;
    }

    warnings.push({
      code: "esi_flag_unsupported",
      message: `${typeName(typeInfo, typeId)} uses unsupported fitting flag ${flag || "(none)"} and was skipped.`,
    });
  }

  const modules = {};
  for (const slot of Object.keys(buckets)) {
    modules[slot] = buckets[slot]
      .sort((a, b) => a.slotIndex - b.slotIndex)
      .map((entry) => entry.module);
  }

  return {
    payload: {
      shipTypeId: shipId,
      shipTypeName: shipId ? typeName(typeInfo, shipId) : undefined,
      fitName: name,
      characterMode: "all_v",
      skillProfile: { mode: "all_v" },
      shipMode: null,
      damageProfile: null,
      modules,
      drones,
      fighters: [],
      cargo,
      implants: [],
      boosters: [],
      projectedEffects: [],
      environment: {
        wormholeEffect: null,
        abyssalWeather: null,
      },
    },
    warnings,
  };
}

async function fittingTypeInfo(fittings) {
  const typeIds = [];
  for (const fitting of fittings) {
    const shipId = shipTypeId(fitting);
    if (shipId) typeIds.push(shipId);
    for (const item of fittingItems(fitting)) {
      const id = parseTypeId(item.type_id ?? item.typeId);
      if (id) typeIds.push(id);
    }
  }
  return typeInfoById(typeIds);
}

router.get("/esi/login", siteAuth.requireAuth, async (req, res) => {
  try {
    const url = await inGameFittingEsi.createLoginUrl(req.siteUser.id);
    return res.redirect(url);
  } catch (err) {
    console.error("[in-game-fitting/esi/login] error", err.message);
    return res.status(503).send(inGameFittingEsi.callbackHtml({
      ok: false,
      message: "In-game fitting import is not configured for this triff.tools instance.",
    }));
  }
});

router.get("/esi/login-url", siteAuth.requireAuth, async (req, res) => {
  try {
    const url = await inGameFittingEsi.createLoginUrl(req.siteUser.id);
    return res.json({ ok: true, url });
  } catch (err) {
    console.error("[in-game-fitting/esi/login-url] error", err.message);
    return res.status(503).json({
      ok: false,
      error: "esi_not_configured",
      message: "In-game fitting import is not configured for this triff.tools instance.",
      configMissing: err.missing || inGameFittingEsi.configStatus().missing,
    });
  }
});

router.get("/esi/callback", async (req, res) => {
  try {
    if (req.query.error) {
      return res.status(400).send(inGameFittingEsi.callbackHtml({
        ok: false,
        message: req.query.error_description || req.query.error || "EVE SSO authorization was cancelled.",
      }));
    }
    const linked = await inGameFittingEsi.linkCharacterFromCode(String(req.query.state || ""), String(req.query.code || ""));
    return res.send(inGameFittingEsi.callbackHtml({
      ok: true,
      message: `Authorized in-game fittings for ${linked.characterName}. You can close this tab.`,
      characterId: linked.characterId,
      characterName: linked.characterName,
    }));
  } catch (err) {
    console.error("[in-game-fitting/esi/callback] error", err.message);
    return res.status(400).send(inGameFittingEsi.callbackHtml({
      ok: false,
      message: "Could not authorize in-game fitting import. Return to /fitting and try again.",
    }));
  }
});

router.get("/esi/characters", siteAuth.requireAuth, async (req, res) => {
  try {
    const characters = await inGameFittingEsi.listCharacters(req.siteUser.id);
    const status = inGameFittingEsi.configStatus();
    return res.json({
      ok: true,
      configured: status.ok,
      configMissing: status.missing,
      scope: inGameFittingEsi.REQUIRED_SCOPE,
      characters,
    });
  } catch (err) {
    console.error("[in-game-fitting/esi/characters] error", err);
    return res.status(500).json({ ok: false, error: "esi_characters_failed", characters: [] });
  }
});

router.delete("/esi/characters/:characterId", siteAuth.requireAuth, async (req, res) => {
  const characterId = Number(req.params.characterId);
  if (!Number.isFinite(characterId) || characterId <= 0) {
    return res.status(400).json({ ok: false, error: "invalid_character_id" });
  }
  try {
    const removed = await inGameFittingEsi.unlinkCharacter(req.siteUser.id, characterId);
    if (!removed) return res.status(404).json({ ok: false, error: "character_not_found" });
    return res.json({ ok: true });
  } catch (err) {
    console.error("[in-game-fitting/esi/unlink] error", err);
    return res.status(500).json({ ok: false, error: "esi_unlink_failed" });
  }
});

router.get("/esi/characters/:characterId/fittings", siteAuth.requireAuth, async (req, res) => {
  const characterId = Number(req.params.characterId);
  if (!Number.isFinite(characterId) || characterId <= 0) {
    return res.status(400).json({ ok: false, error: "invalid_character_id", fittings: [] });
  }
  try {
    const result = await inGameFittingEsi.fetchFittings(req.siteUser.id, characterId);
    const typeInfo = await typeInfoById(result.fittings.map((fitting) => shipTypeId(fitting)).filter(Boolean));
    return res.json({
      ok: true,
      character: result.character,
      fittings: result.fittings.map((fitting) => fittingSummary(fitting, typeInfo)).filter((fitting) => fitting.fittingId),
    });
  } catch (err) {
    console.error("[in-game-fitting/esi/fittings] error", err.message);
    const status = err.status === 404 ? 404 : 503;
    return res.status(status).json({ ok: false, error: err.message || "esi_fittings_failed", fittings: [] });
  }
});

router.post("/esi/characters/:characterId/fittings/:fittingId/import", siteAuth.requireAuth, async (req, res) => {
  const characterId = Number(req.params.characterId);
  const selectedFittingId = Number(req.params.fittingId);
  if (!Number.isFinite(characterId) || characterId <= 0 || !Number.isFinite(selectedFittingId) || selectedFittingId <= 0) {
    return res.status(400).json({ ok: false, error: "invalid_fitting_id" });
  }
  try {
    const result = await inGameFittingEsi.fetchFittings(req.siteUser.id, characterId);
    const fitting = result.fittings.find((entry) => fittingId(entry) === selectedFittingId);
    if (!fitting) return res.status(404).json({ ok: false, error: "fitting_not_found" });
    const typeInfo = await fittingTypeInfo([fitting]);
    const summary = fittingSummary(fitting, typeInfo);
    const converted = convertEsiFittingToPayload(fitting, typeInfo);
    if (!converted.payload.shipTypeId) {
      return res.status(422).json({
        ok: false,
        error: "missing_ship",
        warnings: converted.warnings,
        errors: [{ code: "missing_ship", message: "The selected in-game fitting did not include a valid ship type." }],
      });
    }

    const calculated = await fittingClient.calculate(converted.payload);
    const status = calculated?.ok ? 200 : 422;
    return res.status(status).json({
      ...(calculated || { ok: false, error: "calculate_failed", payload: converted.payload }),
      payload: calculated?.payload || converted.payload,
      warnings: [...converted.warnings, ...((calculated || {}).warnings || [])],
      errors: (calculated || {}).errors || [],
      inGameFitting: summary,
      character: result.character,
    });
  } catch (err) {
    if (err?.status || err?.message?.startsWith?.("esi_")) {
      console.error("[in-game-fitting/esi/import] error", err.message);
      const status = err.status === 404 ? 404 : 503;
      return res.status(status).json({ ok: false, error: err.message || "esi_import_failed" });
    }
    return serviceError(res, err);
  }
});

module.exports = router;
