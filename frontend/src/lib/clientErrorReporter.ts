import { triffApiUrl } from "../lib/webRuntime";

type ReportSource = "browser";

let installed = false;

function trim(value: unknown, max = 2000) {
  if (typeof value !== "string") return "";
  return value.length > max ? `${value.slice(0, max)}...[truncated]` : value;
}

function errorLike(value: unknown) {
  if (value instanceof Error) {
    return {
      message: trim(value.message || value.name || "Error"),
      stack: trim(value.stack || ""),
    };
  }
  if (typeof value === "string") {
    return { message: trim(value), stack: "" };
  }
  try {
    return { message: trim(JSON.stringify(value)), stack: "" };
  } catch {
    return { message: "Unknown frontend error", stack: "" };
  }
}

function send(payload: Record<string, unknown>) {
  try {
    const body = JSON.stringify(payload);
    const url = triffApiUrl("/api/client-errors");
    if (navigator.sendBeacon) {
      const blob = new Blob([body], { type: "application/json" });
      if (navigator.sendBeacon(url, blob)) return;
    }
    void fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    // Error reporting must never create a second user-visible failure.
  }
}

function basePayload(source: ReportSource, kind: string) {
  return {
    source,
    kind,
    url: trim(window.location.href, 500),
    userAgent: trim(navigator.userAgent, 300),
    release: trim(import.meta.env.VITE_BUILD_COMMIT || import.meta.env.VITE_APP_VERSION || "", 120),
    native: false,
  };
}

export function installClientErrorReporter(source: ReportSource = "browser") {
  if (installed || typeof window === "undefined") return;
  installed = true;

  window.addEventListener("error", (event) => {
    const details = errorLike(event.error || event.message);
    send({
      ...basePayload(source, "error"),
      message: details.message || trim(event.message) || "Frontend error",
      stack: details.stack,
      line: event.lineno || null,
      column: event.colno || null,
    });
  });

  window.addEventListener("unhandledrejection", (event) => {
    const details = errorLike(event.reason);
    send({
      ...basePayload(source, "unhandledrejection"),
      message: details.message || "Unhandled promise rejection",
      stack: details.stack,
    });
  });
}
