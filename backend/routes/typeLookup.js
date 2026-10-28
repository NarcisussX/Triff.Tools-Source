/*
 * Express router for type Lookup API endpoints.
 * Reads request params, query strings, or bodies and returns JSON or HTTP responses via local services.
 */

const express = require("express");
const router = express.Router();
const pool = require("../db/pool");

async function getFetch() {
  if (typeof global.fetch === "function") return global.fetch;
  try {
    const mod = await import("node-fetch");
    return mod.default || mod;
  } catch {
    try {

      const nf2 = require("node-fetch");
      return nf2.default || nf2;
    } catch {
      throw new Error("No fetch available. Install node-fetch or run Node 18+.");
    }
  }
}

async function hasInvTypes() {
  const { rows } = await pool.query(`select to_regclass('public.inv_types') as reg`);
  return !!rows[0]?.reg;
}
async function resolveFromInvTypes(namesLower) {
  const { rows } = await pool.query(
    `select type_id, type_name as name, coalesce(volume,0) as m3
     from inv_types
     where lower(type_name) = any($1)`,
    [namesLower]
  );
  return rows;
}
async function resolveFromCache(namesLower) {
  const { rows } = await pool.query(
    `select name_lower, type_id, canonical_name, m3 from type_cache where name_lower = any($1)`,
    [namesLower]
  );
  const map = new Map(rows.map(r => [r.name_lower, r]));
  return namesLower.map(nl => map.get(nl) || null);
}
async function upsertCache(entries) {
  if (!entries.length) return;
  const values = [];
  const params = [];
  let i = 1;
  for (const e of entries) {
    values.push(`($${i++}, $${i++}, $${i++}, $${i++})`);
    params.push(e.name_lower, e.type_id, e.canonical_name, e.m3);
  }
  await pool.query(
    `insert into type_cache (name_lower, type_id, canonical_name, m3)
     values ${values.join(",")}
     on conflict (name_lower) do update
     set type_id=excluded.type_id,
         canonical_name=excluded.canonical_name,
         m3=excluded.m3,
         updated_at=now()`,
    params
  );
}

async function fuzzworksTypeId(fetch, name) {
  const url = `https://www.fuzzwork.co.uk/api/typeid.php?typename=${encodeURIComponent(name)}`;
  const r = await fetch(url, { headers: { "User-Agent": "Triffnix/TypeResolver" } });
  if (!r.ok) return null;
  const j = await r.json();
  return j && j.typeID ? { type_id: Number(j.typeID), canonical_name: j.typeName || name } : null;
}
async function esiTypeVolume(fetch, typeId) {
  const url = `https://esi.evetech.net/latest/universe/types/${typeId}/`;
  const r = await fetch(url, { headers: { "User-Agent": "Triffnix/TypeResolver" } });
  if (!r.ok) return 0;
  const j = await r.json();
  return Number(j?.volume || 0);
}

async function mapWithLimit(items, limit, fn) {
  const results = new Array(items.length);
  let i = 0, active = 0;
  return new Promise((resolve) => {
    const next = () => {
      if (i >= items.length && active === 0) return resolve(results);
      while (active < limit && i < items.length) {
        const idx = i++, val = items[idx];
        active++;
        Promise.resolve(fn(val, idx))
          .then(res => { results[idx] = res; })
          .catch(() => { results[idx] = null; })
          .finally(() => { active--; next(); });
      }
    };
    next();
  });
}

router.post("/types/resolve", async (req, res) => {
  try {
    const { names } = req.body || {};
    if (!Array.isArray(names) || names.length === 0) {
      return res.status(400).json({ error: "names array required" });
    }

    const originals = names.map(n => String(n).trim()).filter(Boolean);
    const namesLower = originals.map(n => n.toLowerCase());

    const results = new Array(originals.length).fill(null);
    const missingIdx = [];

    if (await hasInvTypes()) {
      const rows = await resolveFromInvTypes(namesLower);
      const map = new Map(rows.map(r => [r.name.toLowerCase(), r]));
      originals.forEach((orig, i) => {
        const hit = map.get(orig.toLowerCase());
        if (hit) {
          results[i] = {
            name: orig,
            type_id: Number(hit.type_id),
            m3: Number(hit.m3),
            canonicalName: hit.name
          };
        } else {
          missingIdx.push(i);
        }
      });
    } else {

      const cached = await resolveFromCache(namesLower);
      cached.forEach((c, i) => {
        if (c) {
          results[i] = {
            name: originals[i],
            type_id: Number(c.type_id),
            m3: Number(c.m3),
            canonicalName: c.canonical_name
          };
        } else {
          missingIdx.push(i);
        }
      });
    }

    if (missingIdx.length) {
      const fetch = await getFetch();

      const toResolve = missingIdx.map(i => originals[i]);
      const resolved = await mapWithLimit(toResolve, 6, async (name) => {
        const fw = await fuzzworksTypeId(fetch, name);
        if (!fw) return { name, type_id: null, m3: null, canonical_name: null };
        const vol = await esiTypeVolume(fetch, fw.type_id);
        return { name, type_id: fw.type_id, m3: vol, canonical_name: fw.canonical_name || name };
      });

      const cacheUpserts = [];
      resolved.forEach((r, j) => {
        const i = missingIdx[j];
        if (r.type_id) {
          results[i] = {
            name: originals[i],
            type_id: r.type_id,
            m3: r.m3,
            canonicalName: r.canonical_name
          };
          cacheUpserts.push({
            name_lower: originals[i].toLowerCase(),
            type_id: r.type_id,
            canonical_name: r.canonical_name,
            m3: r.m3
          });
        } else {
          results[i] = {
            name: originals[i],
            type_id: null,
            m3: null,
            canonicalName: null,
            error: "not_found"
          };
        }
      });

      if (cacheUpserts.length) await upsertCache(cacheUpserts);
    }

    return res.json({ results });
  } catch (e) {
    console.error("[TYPE_LOOKUP]: POST /types/resolve failed", e);
    res.status(500).json({ error: "server_error" });
  }
});

module.exports = router;
