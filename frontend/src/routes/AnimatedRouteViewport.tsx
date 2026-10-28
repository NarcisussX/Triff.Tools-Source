import {
  Component,
  Suspense,
  useEffect,
  useLayoutEffect,
  useRef,
  type ErrorInfo,
  type ReactNode,
} from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useNavigationType, type Location } from "react-router-dom";

const scrollPositions = new Map<string, number>();

function RouteFallback() {
  return (
    <div
      className="flex min-h-[calc(100vh-3rem)] items-start justify-center px-4 pt-12 text-[11px] text-slate-400"
      role="status"
      aria-live="polite"
    >
      <span
        className="mr-2 mt-0.5 h-3 w-3 animate-spin rounded-full border border-slate-600 border-t-[#53b6ff]"
        aria-hidden="true"
      />
      <span>Loading tool…</span>
    </div>
  );
}

class RouteErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Route rendering failed", error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div
        className="flex min-h-[calc(100vh-3rem)] items-start justify-center px-4 pt-12 text-center"
        role="alert"
      >
        <div className="border border-[#3a3c40] bg-[#05070b]/80 px-4 py-3 text-[11px] text-slate-300 shadow-lg">
          <p className="text-slate-100">This tool could not be loaded.</p>
          <button
            type="button"
            className="mt-3 border border-[#53b6ff]/60 bg-[#0b2233] px-3 py-1 text-[10px] uppercase tracking-[0.14em] text-[#dff5ff] hover:bg-[#12364f]"
            onClick={() => window.location.reload()}
          >
            Reload tool
          </button>
        </div>
      </div>
    );
  }
}

function RouteScrollPosition({
  location,
  isPop,
}: {
  location: Location;
  isPop: boolean;
}) {
  const latestKey = useRef(location.key);
  latestKey.current = location.key;

  useLayoutEffect(() => {
    const hashTarget = location.hash
      ? document.getElementById(decodeURIComponent(location.hash.slice(1)))
      : null;

    if (hashTarget) {
      hashTarget.scrollIntoView();
    } else {
      window.scrollTo({ top: isPop ? scrollPositions.get(location.key) || 0 : 0 });
    }

    return () => {
      scrollPositions.set(latestKey.current, window.scrollY);
      if (scrollPositions.size > 50) {
        const oldestKey = scrollPositions.keys().next().value;
        if (oldestKey) scrollPositions.delete(oldestKey);
      }
    };
  }, [location.pathname]);

  return null;
}

export default function AnimatedRouteViewport({
  location,
  children,
}: {
  location: Location;
  children: ReactNode;
}) {
  const reduceMotion = useReducedMotion();
  const navigationType = useNavigationType();

  useEffect(() => {
    const previous = window.history.scrollRestoration;
    window.history.scrollRestoration = "manual";
    return () => {
      window.history.scrollRestoration = previous;
    };
  }, []);

  return (
    <AnimatePresence initial={false} mode="wait">
      <motion.div
        key={location.pathname}
        initial={reduceMotion ? false : { opacity: 0 }}
        animate={{
          opacity: 1,
          transition: { duration: reduceMotion ? 0 : 0.16, ease: "easeOut" },
        }}
        exit={{
          opacity: reduceMotion ? 1 : 0,
          transition: { duration: reduceMotion ? 0 : 0.11, ease: "easeOut" },
        }}
      >
        <RouteErrorBoundary>
          <Suspense fallback={<RouteFallback />}>
            <RouteScrollPosition location={location} isPop={navigationType === "POP"} />
            {children}
          </Suspense>
        </RouteErrorBoundary>
      </motion.div>
    </AnimatePresence>
  );
}
