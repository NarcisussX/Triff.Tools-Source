/*
 * React page for /timestamp.
 * Uses local component state, browser APIs, and Triff.Tools backend endpoints to render the page workflow.
 */

import { useEffect, useState } from "react";
import {
  Calendar,
  Clock,
  AlarmClock,
  Hourglass,
  CheckCircle2,
} from "lucide-react";

export default function TimestampTool() {
  const [unix, setUnix] = useState<number>(() =>
    Math.floor(Date.now() / 1000)
  );
  const [eveNow, setEveNow] = useState<string>("");
  const [eveFuture, setEveFuture] = useState<string>("");
  const [copiedText, setCopiedText] = useState<string | null>(null);
  const timestampInputClass =
    "w-full bg-[#030509] border border-[#3a4655] px-3 py-2 text-[13px] text-slate-100 outline-none focus:border-[#53b6ff] focus:ring-0";
  const nativeDateTimeInputClass = `${timestampInputClass} tt-native-date-time-input`;

  const getLocalDateString = (timestamp: number) => {
    const d = new Date(timestamp * 1000);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };

  const getLocalTimeString = (timestamp: number) => {
    const d = new Date(timestamp * 1000);
    const hours = String(d.getHours()).padStart(2, "0");
    const minutes = String(d.getMinutes()).padStart(2, "0");
    const seconds = String(d.getSeconds()).padStart(2, "0");
    return `${hours}:${minutes}:${seconds}`;
  };

  const getUTCDateString = (timestamp: number) => {
    const d = new Date(timestamp * 1000);
    const year = d.getUTCFullYear();
    const month = String(d.getUTCMonth() + 1).padStart(2, "0");
    const day = String(d.getUTCDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };

  const getUTCTimeString = (timestamp: number) => {
    const d = new Date(timestamp * 1000);
    const hours = String(d.getUTCHours()).padStart(2, "0");
    const minutes = String(d.getUTCMinutes()).padStart(2, "0");
    const seconds = String(d.getUTCSeconds()).padStart(2, "0");
    return `${hours}:${minutes}:${seconds}`;
  };

  const localDate = getLocalDateString(unix);
  const localTime = getLocalTimeString(unix);
  const eveDate = getUTCDateString(unix);
  const eveTime = getUTCTimeString(unix);

  useEffect(() => {
    const updateEveTime = () => {
      const nowUTC = new Date().toISOString().slice(0, 19).replace("T", " ");
      setEveNow(nowUTC);
    };
    updateEveTime();
    const interval = setInterval(updateEveTime, 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const futureUTC = new Date(unix * 1000)
      .toISOString()
      .slice(0, 19)
      .replace("T", " ");
    setEveFuture(futureUTC);
  }, [unix]);

  const parseDateString = (dateStr: string) => {
    const [year, month, day] = dateStr.split("-").map((v) => parseInt(v, 10));
    return { year, month, day };
  };

  const parseTimeString = (timeStr: string) => {
    const raw = timeStr.trim();

    if (raw && !raw.includes(":")) {
      const digits = raw.replace(/\D/g, "");
      let hours = 0;
      let minutes = 0;
      let seconds = 0;

      if (digits.length === 4) {

        hours = parseInt(digits.slice(0, 2), 10) || 0;
        minutes = parseInt(digits.slice(2, 4), 10) || 0;
      } else if (digits.length === 6) {

        hours = parseInt(digits.slice(0, 2), 10) || 0;
        minutes = parseInt(digits.slice(2, 4), 10) || 0;
        seconds = parseInt(digits.slice(4, 6), 10) || 0;
      } else {
        hours = parseInt(digits, 10) || 0;
      }

      return { hours, minutes, seconds };
    }

    const [h = "0", m = "0", s = "0"] = raw.split(":");
    const hours = parseInt(h, 10) || 0;
    const minutes = parseInt(m, 10) || 0;
    const seconds = parseInt(s, 10) || 0;
    return { hours, minutes, seconds };
  };

  const updateUnixFromLocal = (dateStr: string, timeStr: string) => {
    if (!dateStr || !timeStr) return;
    const { year, month, day } = parseDateString(dateStr);
    const { hours, minutes, seconds } = parseTimeString(timeStr);
    const d = new Date(year, month - 1, day, hours, minutes, seconds);
    setUnix(Math.floor(d.getTime() / 1000));
  };

  const updateUnixFromUTC = (dateStr: string, timeStr: string) => {
    if (!dateStr || !timeStr) return;
    const { year, month, day } = parseDateString(dateStr);
    const { hours, minutes, seconds } = parseTimeString(timeStr);
    const d = new Date(
      Date.UTC(year, month - 1, day, hours, minutes, seconds)
    );
    setUnix(Math.floor(d.getTime() / 1000));
  };

  const formats = [
    { label: "d", desc: "Short Date" },
    { label: "D", desc: "Long Date" },
    { label: "t", desc: "Short Time" },
    { label: "T", desc: "Long Time" },
    { label: "f", desc: "Short Date+Time" },
    { label: "F", desc: "Full Date+Time" },
    { label: "R", desc: "Relative Time" },
  ];

  const renderFormat = (label: string): string => {
    const d = new Date(unix * 1000);
    switch (label) {
      case "d":
        return d.toLocaleDateString();
      case "D":
        return d.toLocaleDateString(undefined, {
          year: "numeric",
          month: "long",
          day: "numeric",
        });
      case "t":
        return d.toLocaleTimeString(undefined, {
          hour: "2-digit",
          minute: "2-digit",
        });
      case "T":
        return d.toLocaleTimeString();
      case "f":
        return d.toLocaleString(undefined, {
          year: "numeric",
          month: "long",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        });
      case "F":
        return d.toLocaleString(undefined, {
          weekday: "long",
          year: "numeric",
          month: "long",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        });
      case "R":
        return getRelativeTimeString(unix);
      default:
        return "";
    }
  };

  const getRelativeTimeString = (timestamp: number) => {
    const diff = Math.floor(timestamp - Date.now() / 1000);
    const abs = Math.abs(diff);
    const suffix = diff < 0 ? "ago" : "from now";
    if (abs < 60) return `${abs} seconds ${suffix}`;
    if (abs < 3600) return `${Math.floor(abs / 60)} minutes ${suffix}`;
    if (abs < 86400) return `${Math.floor(abs / 3600)} hours ${suffix}`;
    return `${Math.floor(abs / 86400)} days ${suffix}`;
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedText(text);
      setTimeout(() => setCopiedText(null), 2000);
    });
  };

  return (
    <div className="tt-tool-v2 min-h-screen text-slate-100 leading-snug">
      <main
        id="grid"
        className="tt2-frame tt2-frame--centered relative z-10 text-slate-100"
      >
        { }
        <div className="tt2-window">
          { }
          <div className="tt2-titlebar">
            <div className="flex items-center gap-2">
              <span className="h-3 w-3 rounded-full bg-[#53b6ff] shadow-[0_0_8px_rgba(83,182,255,0.7)]" />
              <span className="uppercase tracking-widest text-[10px] text-slate-300">
                Utilities ▸ Discord Timestamp Generator
              </span>
            </div>
            <div className="flex items-center gap-2 text-[9px] text-slate-400">
              <span className="px-1 py-0.5 bg-[#0b0d11] border border-[#303236]">
                EVE Time (UTC)
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
                Overview ▸ Timestamp Formats
              </span>
              <span className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-[#3bbf5a]" />
                <span>EVE time synchronized</span>
              </span>
            </div>
            <div className="flex items-center gap-2" />
          </div>

          { }
          <div className="tt2-workspace space-y-4">
            { }
            <div className="tt2-notice">
              <p className="text-[12px] text-slate-300 mb-1">
                This window generates{" "}
                <span className="text-slate-100">Discord timestamp</span> tags
                based on a local date and time or an EVE time (UTC).
              </p>
              <p className="text-[12px] text-slate-400 mb-1">
                Set your local time on the left or type the{" "}
                <span className="text-slate-100">EVE time</span> on the right.
                The tool converts between them and shows the matching{" "}
                <span className="text-slate-100">&lt;t:unix:format&gt;</span>{" "}
                syntaxes below.
              </p>
              <p className="text-[12px] text-slate-400">
                Click any syntax row&apos;s{" "}
                <span className="text-slate-100">Copy</span> button to place it
                on your clipboard.
              </p>
            </div>

            { }
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              { }
              <fieldset className="tt2-panel">
                <legend className="tt2-panel-head tt2-panel-title w-full">
                  <span>Local Time</span>
                </legend>
                <div className="tt2-panel-body space-y-3">
                  <div className="flex flex-col gap-0.5">
                    <label
                      htmlFor="date-input-local"
                    className="tt2-field-label flex items-center gap-1"
                    >
                      <Calendar className="h-3 w-3" />
                      Date
                    </label>
                    <input
                      id="date-input-local"
                      type="date"
                      value={localDate}
                      onChange={(e) =>
                        updateUnixFromLocal(e.target.value, localTime)
                      }
                      className={nativeDateTimeInputClass}
                    />
                  </div>

                  <div className="flex flex-col gap-0.5">
                    <label
                      htmlFor="time-input-local"
                    className="tt2-field-label flex items-center gap-1"
                    >
                      <Clock className="h-3 w-3" />
                      Time
                    </label>
                    <input
                      id="time-input-local"
                      type="time"
                      value={localTime}
                      onChange={(e) =>
                        updateUnixFromLocal(localDate, e.target.value)
                      }
                      step="1"
                      className={nativeDateTimeInputClass}
                    />
                  </div>
                </div>
              </fieldset>

              { }
              <fieldset className="tt2-panel">
                <legend className="tt2-panel-head tt2-panel-title w-full">
                  <span>EVE Time (UTC)</span>
                </legend>
                <div className="tt2-panel-body space-y-3">
                  <div className="flex flex-col gap-0.5">
                    <label
                      htmlFor="date-input-eve"
                    className="tt2-field-label flex items-center gap-1"
                    >
                      <Calendar className="h-3 w-3" />
                      Date
                    </label>
                    <input
                      id="date-input-eve"
                      type="date"
                      value={eveDate}
                      onChange={(e) =>
                        updateUnixFromUTC(e.target.value, eveTime)
                      }
                      className={nativeDateTimeInputClass}
                    />
                  </div>

                  <div className="flex flex-col gap-0.5">
                    <label
                      htmlFor="time-input-eve"
                    className="tt2-field-label flex items-center gap-1"
                    >
                      <Clock className="h-3 w-3" />
                      Time
                    </label>
                    <input
                      id="time-input-eve"
                      type="text"
                      inputMode="numeric"
                      value={eveTime}
                      onChange={(e) =>
                        updateUnixFromUTC(eveDate, e.target.value)
                      }
                      placeholder="HHMM (e.g. 2100)"
                      className={timestampInputClass}
                    />
                  </div>
                  <p className="text-[11px] text-slate-500 mt-1">
                  </p>
                </div>
              </fieldset>
            </div>

            { }
            <div className="tt2-panel flex flex-col items-start justify-between gap-2 px-3 py-3 sm:flex-row sm:items-center">
              <div className="flex items-center gap-2 text-[12px]">
                <AlarmClock className="h-4 w-4 text-[#53b6ff]" />
                <span className="font-semibold text-slate-200">
                  Current EVE Time (UTC):
                </span>
              </div>
              <span className="font-mono text-[12px] text-[#53b6ff]">
                {eveNow}
              </span>
            </div>

            { }
            <div className="tt2-panel overflow-x-auto">
              <table className="table-auto w-full min-w-[680px] text-[12px]">
                <thead>
                  <tr className="bg-[#14161d] text-slate-100">
                    <th className="border border-[#2b2d33] px-2.5 py-1.5 text-left">
                      Chat Syntax
                    </th>
                    <th className="border border-[#2b2d33] px-2.5 py-1.5 text-left">
                      Example Result
                    </th>
                    <th className="border border-[#2b2d33] px-2.5 py-1.5 text-left">
                      Description
                    </th>
                    <th className="border border-[#2b2d33] px-2.5 py-1.5 text-left">
                      Copy
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {formats.map((f, idx) => (
                    <tr
                      key={f.label}
                      className={`${
                        idx % 2 === 0 ? "bg-[#090b11]" : "bg-[#0c0f16]"
                      } hover:bg-[#141821]`}
                    >
                      <td className="border border-[#2b2d33] px-2.5 py-1.5 text-[#53b6ff] font-mono">
                        {`<t:${unix}:${f.label}>`}
                      </td>
                      <td className="border border-[#2b2d33] px-2.5 py-1.5">
                        {renderFormat(f.label)}
                      </td>
                      <td className="border border-[#2b2d33] px-2.5 py-1.5 text-slate-300">
                        {f.desc}
                      </td>
                      <td className="border border-[#2b2d33] px-2.5 py-1.5">
                        <button
                          type="button"
                          onClick={() =>
                            copyToClipboard(`<t:${unix}:${f.label}>`)
                          }
                          className="tt2-button tt2-button--secondary tt2-button--sm"
                        >
                          Copy
                        </button>
                      </td>
                    </tr>
                  ))}
                  <tr className="bg-[#101219]">
                    <td className="border border-[#2b2d33] px-2.5 py-1.5 text-emerald-300 font-mono">
                      {unix}
                    </td>
                    <td
                      className="border border-[#2b2d33] px-2.5 py-1.5 text-slate-200"
                      colSpan={3}
                    >
                      Raw Unix timestamp
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {copiedText && (
          <div className="tt2-notice tt2-notice--success fixed bottom-6 left-1/2 z-50 flex max-w-[calc(100vw-24px)] -translate-x-1/2 items-center gap-2 shadow-lg">
            <CheckCircle2 className="h-4 w-4 text-emerald-300" />
            <span>
              Copied{" "}
              <span className="font-mono text-emerald-300">{copiedText}</span>{" "}
              to clipboard
            </span>
          </div>
        )}
      </main>
    </div>
  );
}
