/*
 * React page for /busa.
 * Uses local component state, browser APIs, and Triff.Tools backend endpoints to render the page workflow.
 */

import { useEffect, useMemo, useState } from 'react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';

type Slim = { id: number; value: number; url: string; ship?: { id: number; name: string } | null; };

type ApiData = {
  lastDeath: { iso: string | null; daysSince: number | null };
  last7d: {
    kills: number;
    losses: number;
    destroyedISK: number;
    lostISK: number;
    netISK: number;
    kd: number;
    status: 'POSITIVE' | 'NEGATIVE';
  };
  characters: number[];
  charactersDetailed?: { id: number; name: string; url: string }[];
  lists?: { kills: Slim[]; losses: Slim[] };
  meta: { fetchedAt: string };
};

const fmtISK = (n: number) => {
  const abs = Math.abs(n);
  if (abs >= 1e12) return `${(n / 1e12).toFixed(2)}t`;
  if (abs >= 1e9) return `${(n / 1e9).toFixed(2)}b`;
  if (abs >= 1e6) return `${(n / 1e6).toFixed(2)}m`;
  if (abs >= 1e3) return `${(n / 1e3).toFixed(2)}k`;
  return n.toFixed(0);
};

const PIE_COLORS = ['#10b981', '#ef4444'];

export default function Busa() {
  const [data, setData] = useState<ApiData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch('/api/busa');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
    } catch (e: any) {
      setErr(e?.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const pieData = useMemo(() => (data ? [
    { name: 'Kills', value: data.last7d.kills },
    { name: 'Losses', value: data.last7d.losses },
  ] : []), [data]);

  const statusColor = data?.last7d.status === 'POSITIVE' ? 'bg-emerald-700 text-emerald-100' : 'bg-rose-700 text-rose-100';

  const characters = data?.charactersDetailed && data.charactersDetailed.length
    ? data.charactersDetailed
    : (data?.characters || []).map((id) => ({ id, name: String(id), url: `https://zkillboard.com/character/${id}/` }));

  return (
    <div className="min-h-screen w-full text-gray-100">
      <div className="mx-auto max-w-5xl px-4 py-10">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-3xl md:text-4xl font-bold tracking-tight">
            DuperBusa Kill Tracker
          </h1>
          <button
            onClick={load}
            className="rounded-2xl px-4 py-2 bg-gray-800 hover:bg-gray-700 transition text-sm"
          >
            Refresh
          </button>
        </div>

        <p className="mt-2 text-gray-400 text-sm">
          Sources: zKillboard (last 7 days). Characters:&nbsp;
          {characters.map((c, i) => (
            <a
              key={c.id}
              className="underline hover:text-blue-300"
              href={c.url}
              target="_blank" rel="noreferrer"
            >
              {c.name}{i < (characters.length - 1) ? ', ' : ''}
            </a>
          ))}
        </p>

        {loading && (<div className="mt-12 text-gray-400">Loading…</div>)}
        {err && (
          <div className="mt-12 rounded-xl border border-rose-700 bg-rose-950/40 p-4 text-rose-200">
            {err}
          </div>
        )}

        {data && !loading && !err && (
          <>
            <div className="mt-8 rounded-3xl bg-gray-900/70 p-6 md:p-8 border border-gray-800">
              <div className="text-center">
                {typeof data.lastDeath.daysSince === 'number' ? (
                  <div className="text-2xl md:text-3xl font-semibold">
                    It’s been <span className="font-extrabold text-amber-300">{data.lastDeath.daysSince}</span> day{data.lastDeath.daysSince === 1 ? '' : 's'} since Busa last died.
                  </div>
                ) : (
                  <div className="text-2xl md:text-3xl font-semibold">No recorded deaths (yet?)</div>
                )}
                {data.lastDeath.iso && (
                  <div className="mt-2 text-gray-400 text-sm">
                    Last RIP: {new Date(data.lastDeath.iso).toLocaleString()} UTC
                  </div>
                )}
              </div>

              <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-6 items-center">
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-2xl bg-gray-950/60 p-4 border border-gray-800">
                    <div className="text-xs uppercase text-gray-400">Destroyed (7d)</div>
                    <div className="text-xl font-bold">{fmtISK(data.last7d.destroyedISK)} ISK</div>
                  </div>

                  <div className="rounded-2xl bg-gray-950/60 p-4 border border-gray-800">
                    <div className="text-xs uppercase text-gray-400">Lost (7d)</div>
                    <div className="text-xl font-bold">{fmtISK(data.last7d.lostISK)} ISK</div>
                  </div>

                  <div className={`rounded-2xl p-4 border border-gray-800 ${statusColor}`}>
                    <div className="text-xs uppercase opacity-80">Net (7d)</div>
                    <div className="text-xl font-bold">
                      {fmtISK(data.last7d.netISK)} ISK {data.last7d.status === 'POSITIVE' ? '↑' : '↓'}
                    </div>
                  </div>

                  <div className="rounded-2xl bg-gray-950/60 p-4 border border-gray-800">
                    <div className="text-xs uppercase text-gray-400">K/D (7d)</div>
                    <div className="text-xl font-bold">
                      {Number.isFinite(data.last7d.kd) ? data.last7d.kd.toFixed(2) : '∞'}
                    </div>
                  </div>
                </div>

                <div className="h-64 w-full flex items-center justify-center">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={pieData}
                        dataKey="value"
                        nameKey="name"
                        innerRadius={60}
                        outerRadius={90}
                        paddingAngle={2}
                      >
                        {pieData.map((_e, i) => (
                          <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip
                        formatter={(v: any, n: any) => [v, n]}
                        contentStyle={{
                          backgroundColor: '#0b0f1a',
                          border: '1px solid #1f2937',
                          borderRadius: 12,
                          color: '#e5e7eb',
                        }}
                        itemStyle={{ color: '#e5e7eb' }}
                        labelStyle={{ color: '#e5e7eb' }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>

            <div className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="rounded-3xl bg-gray-900/70 p-5 border border-gray-800">
                <div className="text-lg font-semibold mb-4">Kills (7d)</div>
                <ul className="space-y-2">
                  {(data.lists?.kills || []).map(k => (
                    <li key={k.id} className="flex items-center justify-between rounded-xl bg-gray-950/60 border border-gray-800 px-4 py-3">
                      <div className="flex items-center gap-3">
                        {k.ship?.id ? (
                          <img
                            src={`https://image.eveonline.com/Type/${k.ship.id}_32.png`}
                            alt=""
                            className="w-5 h-5 rounded-sm"
                          />
                        ) : <div className="w-5 h-5" />}
                        <div className="text-sm text-gray-200 font-medium">
                          {k.ship?.name || 'Unknown'}
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="text-sm font-semibold text-emerald-300">
                          {fmtISK(k.value)} ISK
                        </div>
                        <a href={k.url} target="_blank" rel="noreferrer" className="text-xs underline text-blue-300 hover:text-blue-200">zKill</a>
                      </div>
                    </li>
                  ))}
                  {(!data.lists?.kills || data.lists.kills.length === 0) && (
                    <li className="text-sm text-gray-400">No kills in the last 7 days.</li>
                  )}
                </ul>
              </div>

              <div className="rounded-3xl bg-gray-900/70 p-5 border border-gray-800">
                <div className="text-lg font-semibold mb-4">Losses (7d)</div>
                <ul className="space-y-2">
                  {(data.lists?.losses || []).map(k => (
                    <li key={k.id} className="flex items-center justify-between rounded-xl bg-gray-950/60 border border-gray-800 px-4 py-3">
                      <div className="flex items-center gap-3">
                        {k.ship?.id ? (
                          <img
                            src={`https://image.eveonline.com/Type/${k.ship.id}_32.png`}
                            alt=""
                            className="w-5 h-5 rounded-sm"
                          />
                        ) : <div className="w-5 h-5" />}
                        <div className="text-sm text-gray-200 font-medium">
                          {k.ship?.name || 'Unknown'}
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="text-sm font-semibold text-rose-300">
                          {fmtISK(k.value)} ISK
                        </div>
                        <a href={k.url} target="_blank" rel="noreferrer" className="text-xs underline text-blue-300 hover:text-blue-200">zKill</a>
                      </div>
                    </li>
                  ))}
                  {(!data.lists?.losses || data.lists.losses.length === 0) && (
                    <li className="text-sm text-gray-400">No losses in the last 7 days.</li>
                  )}
                </ul>
              </div>
            </div>

            <div className="mt-6 text-xs text-gray-500">
              Cached for ~2 minutes. Updated: {new Date(data.meta.fetchedAt).toLocaleTimeString()} UTC
            </div>
          </>
        )}
      </div>
    </div>
  );
}
