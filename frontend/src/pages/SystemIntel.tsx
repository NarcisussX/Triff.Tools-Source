/*
 * React page for an internal frontend view.
 * Uses local component state, browser APIs, and Triff.Tools backend endpoints to render the page workflow.
 */

import { useEffect, useMemo, useState } from "react";

type Activity = { days: string[]; max: number } & Record<number, any>;
type Summary = {
  systemId: string;
  totalKills: number;
  daysCovered: number;
  mostRecentKillDaysAgo: number | null;
  activeCorporations: { id: string; name: string; lastSeenDaysAgo: number; activeDays: number }[];
};

export default function SystemIntel({ jcode }: { jcode?: string }) {
  const [activity, setActivity] = useState<Activity | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let abort = false;

    (async () => {
      try {
        setErr(null);
        setActivity(null);
        setSummary(null);
        if (!jcode) return;

        const sys = await fetch(`/api/structure-intel/system-id/${encodeURIComponent(jcode)}`).then((r) => r.json());
        if (!sys?.id) {
          setErr("Could not resolve system ID");
          return;
        }
        if (abort) return;

        const [act, sum] = await Promise.all([
          fetch(`/api/structure-intel/zkill-activity/${sys.id}`).then((r) => r.json()),
          fetch(`/api/structure-intel/killboard-summary/${sys.id}`).then((r) => r.json()),
        ]);

        if (abort) return;
        setActivity(act);
        setSummary(sum);
      } catch (e: any) {
        if (!abort) setErr(e.message || "Failed to load system intel");
      }
    })();

    return () => {
      abort = true;
    };
  }, [jcode]);

  const topCorps = useMemo(() => {
    return (summary?.activeCorporations || [])
      .slice()
      .sort((a, b) => b.activeDays - a.activeDays || a.lastSeenDaysAgo - b.lastSeenDaysAgo)
      .slice(0, 10);
  }, [summary]);

  const Heatmap = () => {
    if (!activity?.days) return <div className="text-[12px] text-slate-500">Loading activity…</div>;
    const days = activity.days;

    return (
      <div className="overflow-auto border border-[#262933] bg-[#05070b]/70">
        <table className="w-full text-[12px] text-slate-200 border-collapse table-fixed">
          <thead>
            <tr className="bg-[#14161d] text-slate-200">
              <th className="border border-[#2b2d33] text-left px-2 py-1 font-medium w-[86px]">Day/Hour</th>
              {[...Array(24).keys()].map((h) => (
                <th key={h} className="border border-[#2b2d33] font-mono font-medium text-[10px] px-[1px] text-center">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {days.map((day: string, idx: number) => (
              <tr key={day} className={idx % 2 ? "bg-[#090b11]" : "bg-[#0c0f16]"}>
                <td className="border border-[#2b2d33] text-left px-2 py-[2px] text-slate-200 whitespace-nowrap w-[92px]">
                  {day}
                </td>
                {[...Array(24).keys()].map((h) => {
                  const count = activity[idx]?.[h] || 0;
                  const max = Math.max(1, activity.max || 1);
                  const t = count / max;
                  const bg = `rgba(59,191,90,${count ? 0.10 + t * 0.55 : 0.04})`;

                  return (
                    <td
                      key={h}
                      style={{ backgroundColor: bg, width: 12, height: 12 }}
                      className="p-0 border border-[#2b2d33]"
                      title={`${count} kills`}
                    />
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  if (!jcode) return null;

  return (
    <div className="space-y-3">
      {err ? (
        <div className="border border-[#bf3b3b] bg-[#19080a] px-3 py-2 text-[12px] text-[#ff6666]">{err}</div>
      ) : null}

      <div className="border border-[#303236] bg-[#05070b]/60 p-3">
        <div className="text-[10px] uppercase tracking-widest text-slate-300 mb-2">Killboard activity calendar</div>
        <Heatmap />
      </div>

      <div className="border border-[#303236] bg-[#05070b]/60 p-3">
        <div className="text-[10px] uppercase tracking-widest text-slate-300 mb-1">Kills / Recent Kill</div>
        <div className="text-[12px] text-slate-300">
          {summary
            ? `${summary.totalKills} kills in last ${summary.daysCovered} days, last one ${
                summary.mostRecentKillDaysAgo ?? "?"
              }d ago`
            : "Loading…"}
        </div>
      </div>

      <div className="border border-[#303236] bg-[#05070b]/60 p-3">
        <div className="text-[10px] uppercase tracking-widest text-slate-300 mb-2">Recent corps</div>
        <div className="text-[12px] text-slate-300 space-y-1">
          {summary ? (
            topCorps.map((c) => (
              <div key={c.id} className="leading-snug">
                <a
                  className="text-[#53b6ff] hover:text-[#7fc5ff] underline"
                  href={`https://zkillboard.com/corporation/${c.id}/`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {c.name}
                </a>{" "}
                <span className="text-slate-500">
                  (Active {c.activeDays}d, last seen {c.lastSeenDaysAgo}d ago)
                </span>
              </div>
            ))
          ) : (
            "Loading…"
          )}
        </div>
      </div>
    </div>
  );
}
