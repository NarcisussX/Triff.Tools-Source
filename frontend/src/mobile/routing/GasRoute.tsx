import { lazy, Suspense, useEffect, useState } from "react";

const DesktopGas = lazy(() => import("../../pages/GasCalc"));
const MobileGas = lazy(() => import("../tools/gas/GasMobile"));

function prefersMobileGas() {
  if (typeof window === "undefined") return false;
  const params = new URLSearchParams(window.location.search);
  if (params.get("mobile") === "1") return true;
  if (params.get("desktop") === "1") return false;
  return window.matchMedia("(max-width: 767px), (hover: none) and (pointer: coarse)").matches;
}

export default function GasRoute() {
  const [mobile, setMobile] = useState(prefersMobileGas);

  useEffect(() => {
    const query = window.matchMedia("(max-width: 767px), (hover: none) and (pointer: coarse)");
    const update = () => setMobile(prefersMobileGas());
    update();
    query.addEventListener("change", update);
    window.addEventListener("popstate", update);
    return () => {
      query.removeEventListener("change", update);
      window.removeEventListener("popstate", update);
    };
  }, []);

  return (
    <Suspense fallback={<div className="p-4 text-[11px] text-slate-500">Loading gas calculator...</div>}>
      {mobile ? <MobileGas /> : <DesktopGas />}
    </Suspense>
  );
}
