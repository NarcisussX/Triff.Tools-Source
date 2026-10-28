import { useEffect } from "react";
import {
  preloadRoute,
  PRIMARY_PRELOAD_PATHS,
  SECONDARY_PRELOAD_PATHS,
} from "./routeLoaders";

type ConnectionInfo = {
  effectiveType?: string;
  saveData?: boolean;
};

type NavigatorWithConnection = Navigator & {
  connection?: ConnectionInfo;
  mozConnection?: ConnectionInfo;
  webkitConnection?: ConnectionInfo;
};

type IdleDeadlineLike = {
  didTimeout: boolean;
  timeRemaining: () => number;
};

type WindowWithIdleCallback = Window & {
  requestIdleCallback?: (
    callback: (deadline: IdleDeadlineLike) => void,
    options?: { timeout: number }
  ) => number;
  cancelIdleCallback?: (handle: number) => void;
};

function connectionInfo(): ConnectionInfo | undefined {
  const browserNavigator = navigator as NavigatorWithConnection;
  return (
    browserNavigator.connection ||
    browserNavigator.mozConnection ||
    browserNavigator.webkitConnection
  );
}

function isVerySlowConnection(connection: ConnectionInfo | undefined): boolean {
  return connection?.effectiveType === "slow-2g" || connection?.effectiveType === "2g";
}

function pathnameFromIntentTarget(target: EventTarget | null): string | null {
  if (!(target instanceof Element)) return null;
  const anchor = target.closest<HTMLAnchorElement>("a[href]");
  if (!anchor || anchor.hasAttribute("download")) return null;

  const url = new URL(anchor.href, window.location.href);
  if (url.origin !== window.location.origin || url.pathname.startsWith("/api/")) return null;
  return url.pathname;
}

function scheduleIdleQueue(paths: readonly string[], startDelay: number): () => void {
  const browserWindow = window as WindowWithIdleCallback;
  let idleHandle: number | undefined;
  let timeoutHandle: number | undefined;
  let cancelled = false;
  let index = 0;

  const run = (deadline: IdleDeadlineLike) => {
    if (cancelled) return;

    let count = 0;
    while (
      index < paths.length &&
      count < 2 &&
      (deadline.didTimeout || deadline.timeRemaining() > 5)
    ) {
      preloadRoute(paths[index]);
      index += 1;
      count += 1;
    }

    if (index < paths.length) scheduleNext();
  };

  const scheduleNext = () => {
    if (cancelled) return;
    if (browserWindow.requestIdleCallback) {
      idleHandle = browserWindow.requestIdleCallback(run, { timeout: 2_000 });
    } else {
      timeoutHandle = window.setTimeout(
        () => run({ didTimeout: true, timeRemaining: () => 0 }),
        300
      );
    }
  };

  timeoutHandle = window.setTimeout(scheduleNext, startDelay);

  return () => {
    cancelled = true;
    if (idleHandle !== undefined) browserWindow.cancelIdleCallback?.(idleHandle);
    if (timeoutHandle !== undefined) window.clearTimeout(timeoutHandle);
  };
}

export default function RoutePreloader({ drawerOpen }: { drawerOpen: boolean }) {
  useEffect(() => {
    const preloadFromEvent = (event: Event) => {
      const pathname = pathnameFromIntentTarget(event.target);
      if (pathname) preloadRoute(pathname);
    };

    document.addEventListener("pointerover", preloadFromEvent, { passive: true });
    document.addEventListener("focusin", preloadFromEvent);
    document.addEventListener("pointerdown", preloadFromEvent, { passive: true });

    return () => {
      document.removeEventListener("pointerover", preloadFromEvent);
      document.removeEventListener("focusin", preloadFromEvent);
      document.removeEventListener("pointerdown", preloadFromEvent);
    };
  }, []);

  useEffect(() => {
    const connection = connectionInfo();
    if (connection?.saveData) return;

    const verySlow = isVerySlowConnection(connection);
    const primaryPaths = verySlow ? PRIMARY_PRELOAD_PATHS.slice(0, 4) : PRIMARY_PRELOAD_PATHS;
    const cancelPrimary = scheduleIdleQueue(primaryPaths, 600);
    const cancelSecondary = verySlow
      ? () => undefined
      : scheduleIdleQueue(SECONDARY_PRELOAD_PATHS, 4_000);

    return () => {
      cancelPrimary();
      cancelSecondary();
    };
  }, []);

  useEffect(() => {
    if (!drawerOpen) return;
    const connection = connectionInfo();
    if (connection?.saveData || isVerySlowConnection(connection)) return;
    return scheduleIdleQueue(SECONDARY_PRELOAD_PATHS, 0);
  }, [drawerOpen]);

  return null;
}

