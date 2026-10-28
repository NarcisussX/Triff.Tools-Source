/*
 * Express router for intel API endpoints.
 * Reads request params, query strings, or bodies and returns JSON or HTTP responses via local services.
 */

const express = require('express');
const dayjs = require('dayjs');
const {
    resolveCorporationId,
    getCorporationActivity,
} = require('../services/corporationActivityCache');
const fetchFn = global.fetch;

if (typeof fetchFn !== 'function') {
    throw new Error(
        '[structure-intel] global fetch is not available. Use Node 18+ or add a fetch polyfill.'
    );
}

function fetchJSON(url, init = {}) {
    return fetchFn(url, {
        ...init,
        headers: {
            Accept: 'application/json',
            'User-Agent': 'TriffTools/structure-intel (+triff.tools)',
            ...(init.headers || {}),
        },
    }).then(async (r) => {
        if (!r.ok) {
            const txt = await r.text().catch(() => '');
            throw new Error(`${r.status} ${r.statusText}${txt ? ` — ${txt.slice(0, 200)}` : ''}`);
        }
        return r.json();
    });
}

const systemCache = new Map();

function createIntelRouter() {
    const r = express.Router();

    r.get('/corp-id', async (req, res) => {
        const name = String(req.query.name || '').trim();
        if (!name) return res.status(400).json({ error: 'missing name' });

        try {
            const corporation = await resolveCorporationId(name);
            if (!corporation) return res.status(404).json({ name, id: null });
            return res.json({
                name: corporation.name || name,
                id: Number(corporation.id),
                cached: corporation.cached,
            });
        } catch (e) {
            return res.status(502).json({ error: 'esi lookup failed', detail: String(e?.message || e) });
        }
    });

    r.get('/system-id/:jcode', async (req, res) => {
        const raw = String(req.params.jcode || '').toUpperCase();
        const m = raw.match(/J\d{6}/);
        if (!m) return res.status(400).json({ error: 'bad jcode' });
        const j = m[0];

        if (systemCache.has(j)) return res.json({ jcode: j, id: systemCache.get(j), cached: true });

        try {

            const idsResp = await fetchFn('https://esi.evetech.net/latest/universe/ids/?datasource=tranquility', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Accept: 'application/json',
                    'User-Agent': 'TriffTools/structure-intel (+triff.tools)',
                },
                body: JSON.stringify([j]),
            });

            if (idsResp.ok) {
                const d = await idsResp.json();

                const arr = d?.systems || d?.solar_systems || d?.system || [];
                const hit = Array.isArray(arr)
                    ? arr.find((s) => String(s.name || '').toUpperCase() === j)
                    : null;

                if (hit?.id) {
                    systemCache.set(j, hit.id);
                    return res.json({ jcode: j, id: hit.id, name: hit.name });
                }
            }

            const qs = new URLSearchParams({
                categories: 'solar_system',
                datasource: 'tranquility',
                search: j,
                strict: 'true',
            }).toString();

            const sResp = await fetchFn(`https://esi.evetech.net/latest/search/?${qs}`, {
                headers: { Accept: 'application/json', 'User-Agent': 'TriffTools/structure-intel (+triff.tools)' },
            });

            if (sResp.ok) {
                const sj = await sResp.json();
                const id = Array.isArray(sj?.solar_system) && sj.solar_system.length ? sj.solar_system[0] : null;
                if (id) {
                    systemCache.set(j, id);
                    return res.json({ jcode: j, id });
                }
            }

            return res.status(404).json({ jcode: j, id: null });
        } catch (e) {
            return res.status(502).json({ error: 'esi resolve failed', detail: String(e?.message || e) });
        }
    });

    r.get('/killboard-summary/:systemId', async (req, res) => {
        try {
            const systemId = String(req.params.systemId);
            const MAX_AGE_DAYS = 60;
            const BATCH_SIZE = 20;
            const now = dayjs();

            const killmails = await fetchJSON(`https://zkillboard.com/api/solarSystemID/${systemId}/`);

            const corpNameCache = new Map();
            const corpName = async (cid) => {
                const id = String(cid);
                if (corpNameCache.has(id)) return corpNameCache.get(id);
                try {
                    const j = await fetchJSON(`https://esi.evetech.net/latest/corporations/${id}/?datasource=tranquility`);
                    const nm = j?.name ? j.name : `Corporation ${id}`;
                    corpNameCache.set(id, nm);
                    return nm;
                } catch {
                    const nm = `Corporation ${id}`;
                    corpNameCache.set(id, nm);
                    return nm;
                }
            };

            const corpActivity = new Map();
            let totalKills = 0;
            let mostRecent = null;
            let oldest = null;

            for (let i = 0; i < killmails.length; i += BATCH_SIZE) {
                const batch = killmails.slice(i, i + BATCH_SIZE);

                const details = await Promise.allSettled(
                    batch.map((k) =>
                        fetchJSON(`https://esi.evetech.net/latest/killmails/${k.killmail_id}/${k.zkb.hash}/?datasource=tranquility`)
                    )
                );

                for (const rr of details) {
                    if (rr.status !== 'fulfilled') continue;
                    const kill = rr.value;
                    if (!kill?.killmail_time) continue;

                    const t = dayjs(kill.killmail_time);
                    mostRecent = !mostRecent || t.isAfter(mostRecent) ? t : mostRecent;
                    oldest = !oldest || t.isBefore(oldest) ? t : oldest;

                    const age = now.diff(t, 'day');
                    if (age > MAX_AGE_DAYS) {
                        i = killmails.length;
                        break;
                    }

                    totalKills++;

                    const involved = [kill.victim, ...(kill.attackers || [])];
                    for (const ent of involved) {
                        const cid = ent?.corporation_id;
                        if (!cid) continue;

                        const id = String(cid);
                        const prev = corpActivity.get(id);
                        const days = prev?.days || new Set();
                        days.add(t.format('YYYY-MM-DD'));
                        const lastSeen = Math.min(prev?.lastSeen ?? Infinity, age);
                        corpActivity.set(id, { lastSeen, days });
                    }
                }
            }

            const corps = await Promise.all(
                Array.from(corpActivity.entries()).map(async ([id, v]) => ({
                    id,
                    name: await corpName(id),
                    lastSeenDaysAgo: v.lastSeen,
                    activeDays: v.days.size,
                }))
            );

            return res.json({
                systemId,
                totalKills,
                daysCovered: oldest ? now.diff(oldest, 'day') : 0,
                mostRecentKillDaysAgo: mostRecent ? now.diff(mostRecent, 'day') : null,
                activeCorporations: corps,
            });
        } catch (e) {
            return res.status(502).json({ error: 'killboard summary failed', detail: String(e?.message || e) });
        }
    });

    r.get('/zkill-activity/:systemId', async (req, res) => {
        try {
            const systemId = String(req.params.systemId);
            const data = await fetchJSON(`https://zkillboard.com/api/stats/solarSystemID/${systemId}/`);
            return res.json(data.activity || null);
        } catch (e) {
            return res.status(502).json({ error: 'zkill stats failed', detail: String(e?.message || e) });
        }
    });

    r.get('/zkill-corp-activity/:corpId', async (req, res) => {
        try {
            const corpId = String(req.params.corpId);
            const result = await getCorporationActivity(corpId);
            return res.json(result.activity || null);
        } catch (e) {
            return res.status(502).json({ error: 'zkill corp stats failed', detail: String(e?.message || e) });
        }
    });

    return r;
}

module.exports = createIntelRouter;
