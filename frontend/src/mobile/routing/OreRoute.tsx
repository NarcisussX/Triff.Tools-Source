import { lazy, Suspense, useEffect, useState } from "react";

const DesktopOre = lazy(() => import("../../pages/OreCalculator"));
const MobileOre = lazy(() => import("../tools/ore/OreMobile"));

function prefersMobileOre() {
  if (typeof window === "undefined") return false;
  const params = new URLSearchParams(window.location.search);
  if (params.get("mobile") === "1") return true;
  if (params.get("desktop") === "1") return false;
  return window.matchMedia("(max-width: 767px), (hover: none) and (pointer: coarse)").matches;
}

export default function OreRoute() {
  const [mobile, setMobile] = useState(prefersMobileOre);

  useEffect(() => {
    const query = window.matchMedia("(max-width: 767px), (hover: none) and (pointer: coarse)");
    const update = () => setMobile(prefersMobileOre());
    update();
    query.addEventListener("change", update);
    window.addEventListener("popstate", update);
    return () => {
      query.removeEventListener("change", update);
      window.removeEventListener("popstate", update);
    };
  }, []);

  return (
    <Suspense fallback={<div className="p-4 text-[11px] text-slate-500">Loading ore calculator...</div>}>
      {mobile ? <MobileOre /> : <DesktopOre />}
    </Suspense>
  );
}
