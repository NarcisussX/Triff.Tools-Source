/*
 * React page for /statuses.
 * Uses local component state, browser APIs, and Triff.Tools backend endpoints to render the page workflow.
 */

import { useEffect, useState } from "react";

const CADENCE_MIN = 30;
const OK_WINDOW_MIN = 28;
const WARN_WINDOW_MIN = 35;

type StatusKind = "OK" | "DEGRADED" | "STALE" | "UNKNOWN" | "FAILED";
type Price = { station_id: string | number; age_seconds: number };
type Ping = {
  url: string;
  ok: boolean;
  ms: number;
  status?: number;
  error?: string;
};
type Pipeline = {
  status: StatusKind;
  detail: string;
};
type WorkerStatus = {
  worker_name: string;
  status: StatusKind;
  expected_interval_minutes: number;
  last_started_at: string | null;
  last_success_at: string | null;
  last_failure_at: string | null;
  last_success_age_seconds: number | null;
  last_failure_age_seconds: number | null;
  last_duration_ms: number | null;
  last_rows: number | null;
};
type WorkersPayload = {
  available: boolean;
  status: StatusKind;
  workers: WorkerStatus[];
};

type Payload = {
  ok?: boolean;
  now: string;
  uptime_seconds: number;
  overall_status?: StatusKind;
  build: { commit: string | null; env: string };
  db: { ok: boolean; ms: number; error?: string };
  prices: Price[];
  pipeline: Pipeline;
  workers?: WorkersPayload;
  deps: { esi: Ping; zkill: Ping };
  cadence_minutes?: number;
  next_expected_update?: string | null;
  error?: string;
};

const STATION_NAME: Record<string, string> = {
  "60003760": "Jita IV - Moon 4 - Caldari Navy Assembly Plant",
  "60008494": "Amarr VIII (Oris) - Emperor Family Academy",
  "60011866": "Dodixie IX - Moon 20 - Federation Navy Assembly Plant",
  "60004588": "Rens VI - Moon 8 - Brutor Tribe Treasury",
  "60005686": "Hek VIII - Moon 12 - Boundless Creation Factory",
};

function formatAge(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return "unknown";
  if (seconds < 90) return `${Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60);
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return h > 0 ? `${h}h ${mm}m` : `${m}m`;
}

function formatDurationMs(ms: number | null | undefined) {
  if (ms == null || !Number.isFinite(ms)) return "none recorded";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return formatAge(ms / 1000);
}

function formatTimestamp(value: string | null | undefined) {
  if (!value) return "none recorded";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "unknown";
  return date.toLocaleString();
}

function workerLabel(name: string) {
  return name
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function pillColorByMinutes(ageSec: number) {
  const ageMin = ageSec / 60;
  if (ageMin <= OK_WINDOW_MIN) return "border-emerald-500/45 bg-emerald-500/10 text-emerald-300";
  if (ageMin <= WARN_WINDOW_MIN) return "border-amber-500/45 bg-amber-500/10 text-amber-200";
  return "border-rose-500/45 bg-rose-500/10 text-rose-300";
}

function statusColor(s: StatusKind) {
  if (s === "OK") return "border-emerald-500/45 bg-emerald-500/10 text-emerald-300";
  if (s === "DEGRADED") return "border-amber-500/45 bg-amber-500/10 text-amber-200";
  if (s === "STALE" || s === "FAILED") return "border-rose-500/45 bg-rose-500/10 text-rose-300";
  return "border-slate-500/45 bg-slate-500/10 text-slate-300";
}

function EveWindow({
  env,
  children,
}: {
  env?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="tt-tool-v2 min-h-screen text-slate-100 leading-snug">
      <div className="tt2-frame tt2-frame--centered">
        <div className="tt2-window">
          { }
          <div className="tt2-titlebar">
            <div className="flex items-center gap-2">
              <span className="h-3 w-3 rounded-full bg-[#53b6ff] shadow-[0_0_8px_rgba(83,182,255,0.7)]" />
              <span className="uppercase tracking-widest text-[10px] text-slate-300">
                Triff.Tools ▸ Infrastructure Status
              </span>
            </div>
            <div className="flex items-center gap-2 text-[9px] text-slate-400">
              <span className="px-1 py-0.5 bg-[#0b0d11] border border-[#303236]">
                Env: {env ?? "—"}
              </span>
              <span className="text-[#53b6ff]">Triff.Tools</span>
              <span className="flex gap-1">
                <span className="h-2 w-2 bg-[#53b6ff]" />
                <span className="h-2 w-2 bg-[#3bbf5a]" />
                <span className="h-2 w-2 bg-[#bf3b3b]" />
              </span>
            </div>
          </div>

          { }
          <div className="tt2-contextbar text-[11px] text-slate-400">
            <div className="flex items-center gap-3">
              <span className="uppercase tracking-widest text-slate-300">
                Overview ▸ Infrastructure Status
              </span>
              <span className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-[#3bbf5a]" />
                <span>Monitoring service online</span>
              </span>
            </div>
            <div className="flex items-center gap-2" />
          </div>

          { }
          <div className="tt2-workspace space-y-4">{children}</div>
        </div>
      </div>
    </div>
  );
}

export default function Statuses() {
  const [data, setData] = useState<Payload | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/statuses")
      .then((r) => r.json())
      .then((j) => setData(j))
      .catch((e) => setErr(String(e)));
  }, []);

  if (err) {
    return (
      <EveWindow>
        <div className="tt2-notice tt2-notice--danger">
          Failed to load infrastructure status: {err}
        </div>
      </EveWindow>
    );
  }

  if (!data) {
    return (
      <EveWindow>
        <div className="tt2-notice flex items-center gap-2">
          Loading infrastructure status…
        </div>
      </EveWindow>
    );
  }

  const cadence = data.cadence_minutes ?? CADENCE_MIN;
  const uptimeHours = Math.floor(data.uptime_seconds / 3600);
  const uptimeMinutes = Math.floor((data.uptime_seconds % 3600) / 60);
  const overallStatus = data.overall_status ?? data.pipeline.status ?? "UNKNOWN";
  const workers = data.workers?.workers ?? [];
  const readyStatus = data.ok === false ? "WATCH" : "READY";

  return (
    <EveWindow env={data.build.env}>
      { }
      <div className="tt2-notice px-4 py-3">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-[12px] text-slate-100">
              Infrastructure Status
            </div>
            <div className="text-[11px] text-slate-400">
              Last updated: {new Date(data.now).toLocaleString()}
            </div>
          </div>
          {data.error && (
            <div className="text-[11px] text-red-400">
              Server error: {data.error}
            </div>
          )}
        </div>
        <p className="text-[11px] text-slate-400 mt-2">
          This panel tracks backend uptime, database latency, market aggregation
          cadence and the health of external dependencies like EVE ESI and
          zKillboard. Public worker timing is shown without raw error payloads.
        </p>
      </div>

      { }
      <div className="grid gap-3 lg:grid-cols-4">
        { }
        <fieldset className="tt2-panel">
          <legend className="tt2-panel-head tt2-panel-title w-full">
            <span>Overall</span>
          </legend>
          <div className="tt2-panel-body space-y-1">
            <div className="flex items-center justify-between">
              <div className="text-[13px] text-slate-100">
                {overallStatus}
              </div>
              <span
                className={`px-2 py-0.5 text-[10px] uppercase tracking-widest border border-[#303236] ${statusColor(
                  overallStatus
                )}`}
              >
                {readyStatus}
              </span>
            </div>
            <div className="text-[11px] text-slate-400">
              Combined DB, market pipeline, and worker state.
            </div>
          </div>
        </fieldset>

        { }
        <fieldset className="tt2-panel">
          <legend className="tt2-panel-head tt2-panel-title w-full">
            <span>Backend Uptime</span>
          </legend>
          <div className="tt2-panel-body space-y-1">
            <div className="text-[13px] text-slate-100">
              {uptimeHours}h {uptimeMinutes}m
            </div>
            <div className="text-[11px] text-slate-400">
              Time since last backend restart.
            </div>
          </div>
        </fieldset>

        { }
        <fieldset className="tt2-panel">
          <legend className="tt2-panel-head tt2-panel-title w-full">
            <span>Database</span>
          </legend>
          <div className="tt2-panel-body space-y-1">
            <div className="flex items-center justify-between">
              <div className="text-[13px] text-slate-100">
                {data.db.ok ? "OK" : "DOWN"}
                <span className="text-[11px] text-slate-400 ml-1">
                  ({data.db.ms} ms)
                </span>
              </div>
              <span
                className={`border px-2 py-0.5 text-[10px] uppercase tracking-widest ${
                  data.db.ok ? "border-emerald-500/45 bg-emerald-500/10 text-emerald-300" : "border-rose-500/45 bg-rose-500/10 text-rose-300"
                }`}
              >
                {data.db.ok ? "Online" : "Offline"}
              </span>
            </div>
            {!data.db.ok && data.db.error && (
              <div className="text-[11px] text-red-400">{data.db.error}</div>
            )}
            {data.db.ok && (
              <div className="text-[11px] text-slate-400">
                Primary Postgres instance reachable and responding.
              </div>
            )}
          </div>
        </fieldset>

        { }
        <fieldset className="tt2-panel">
          <legend className="tt2-panel-head tt2-panel-title w-full">
            <span>Build</span>
          </legend>
          <div className="tt2-panel-body space-y-1">
            <div className="text-[13px] text-slate-100">
              Env: {data.build.env}
            </div>
            <div className="text-[11px] text-slate-400">
              Active deploy environment.
            </div>
            {data.build.commit && (
              <div className="text-[11px] text-slate-500 truncate">
                Commit: {data.build.commit}
              </div>
            )}
          </div>
        </fieldset>
      </div>

      { }
      <div className="tt2-panel">
        <div className="tt2-panel-head">
          <span className="tt2-panel-title">
            Worker Freshness
          </span>
          <span
            className={`px-2 py-0.5 text-[10px] uppercase tracking-widest border border-[#303236] ${statusColor(
              data.workers?.status ?? "UNKNOWN"
            )}`}
          >
            {data.workers?.status ?? "UNKNOWN"}
          </span>
        </div>
        <div className="tt2-panel-body">
          {!data.workers?.available ? (
            <div className="text-[11px] text-slate-400">
              Worker heartbeat table has not reported yet.
            </div>
          ) : workers.length === 0 ? (
            <div className="text-[11px] text-slate-400">
              No worker heartbeats recorded yet.
            </div>
          ) : (
            <div className="grid gap-2 md:grid-cols-3">
              {workers.map((worker) => (
                <div
                  key={worker.worker_name}
                  className="border border-[#2c2f36] bg-[#070910] px-3 py-3 space-y-1"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="text-[11px] text-slate-100">
                        {workerLabel(worker.worker_name)}
                      </div>
                      <div className="text-[10px] text-slate-500">
                        Every ~{worker.expected_interval_minutes} min
                      </div>
                    </div>
                    <span
                      className={`px-2 py-0.5 text-[10px] uppercase tracking-widest border border-[#303236] ${statusColor(
                        worker.status
                      )}`}
                    >
                      {worker.status}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
                    <div className="text-slate-500">Last success</div>
                    <div className="text-right text-slate-300">
                      {worker.last_success_age_seconds == null
                        ? "none recorded"
                        : `${formatAge(worker.last_success_age_seconds)} ago`}
                    </div>
                    <div className="text-slate-500">Started</div>
                    <div className="text-right text-slate-300">
                      {formatTimestamp(worker.last_started_at)}
                    </div>
                    <div className="text-slate-500">Duration</div>
                    <div className="text-right text-slate-300">
                      {formatDurationMs(worker.last_duration_ms)}
                    </div>
                    <div className="text-slate-500">Units</div>
                    <div className="text-right text-slate-300">
                      {worker.last_rows == null ? "none recorded" : worker.last_rows.toLocaleString()}
                    </div>
                    <div className="text-slate-500">Last failure</div>
                    <div className="text-right text-slate-300">
                      {worker.last_failure_age_seconds == null
                        ? "none recorded"
                        : `${formatAge(worker.last_failure_age_seconds)} ago`}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      { }
      <fieldset className="tt2-panel">
        <legend className="tt2-panel-head tt2-panel-title w-full">
          <span>Market Pipeline</span>
        </legend>
        <div className="tt2-panel-body space-y-1">
          <div className="flex items-center justify-between">
            <div className="text-[11px] text-slate-300">
              Derived from{" "}
              <span className="text-slate-100">market_aggregates</span>{" "}
              freshness.
            </div>
            <span
              className={`px-2 py-0.5 text-[10px] uppercase tracking-widest border border-[#303236] ${statusColor(
                data.pipeline.status
              )}`}
              title={data.pipeline.detail}
            >
              {data.pipeline.status}
            </span>
          </div>
          <div className="text-[11px] text-slate-400">
            Cadence: ~{cadence} min
            {data.next_expected_update && (
              <>
                {" "}
                · Next expected:{" "}
                {new Date(
                  data.next_expected_update
                ).toLocaleTimeString()}
              </>
            )}
          </div>
          <div className="text-[11px] text-slate-500">
            {data.pipeline.detail}
          </div>
        </div>
      </fieldset>

      { }
      <div className="tt2-panel">
        <div className="tt2-panel-head">
          <span className="tt2-panel-title">
            Market Price Freshness
          </span>
        </div>
        <div className="tt2-panel-body">
          {data.prices.length === 0 ? (
            <div className="text-[11px] text-slate-400">
              No aggregate data yet.
            </div>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {data.prices.map((p) => (
                <div
                  key={String(p.station_id)}
                  className="border border-[#2c2f36] bg-[#070910] px-2.5 py-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-[11px] text-slate-100">
                      {STATION_NAME[String(p.station_id)] ??
                        String(p.station_id)}
                    </div>
                    <span
                      className={`border px-2 py-0.5 text-[10px] ${pillColorByMinutes(
                        p.age_seconds
                      )}`}
                    >
                      {formatAge(p.age_seconds)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      { }
      <div className="tt2-panel">
        <div className="tt2-panel-head">
          <span className="tt2-panel-title">
            External Dependencies
          </span>
        </div>
        <div className="tt2-panel-body grid gap-3 md:grid-cols-2">
          {[
            { title: "EVE ESI", ping: data.deps.esi },
            { title: "zKillboard API", ping: data.deps.zkill },
          ].map((x) => (
            <div
              key={x.title}
              className="border border-[#2c2f36] bg-[#070910] px-2.5 py-2 space-y-1"
            >
              <div className="flex items-center justify-between">
                <div className="text-[11px] text-slate-100">{x.title}</div>
                <span
                  className={`border px-2 py-0.5 text-[10px] uppercase tracking-widest ${
                    x.ping.ok ? "border-emerald-500/45 bg-emerald-500/10 text-emerald-300" : "border-rose-500/45 bg-rose-500/10 text-rose-300"
                  }`}
                >
                  {x.ping.ok ? "OK" : "DOWN"}
                </span>
              </div>
              <div className="text-[11px] text-slate-400">
                Latency: {x.ping.ms} ms
              </div>
              {x.ping.status && (
                <div className="text-[11px] text-slate-400">
                  HTTP: {x.ping.status}
                </div>
              )}
              {x.ping.error && (
                <div className="text-[11px] text-red-400">
                  Err: {x.ping.error}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </EveWindow>
  );
}
