/*
 * Provides animated-background state to the React app.
 * Reads and writes the starfield preference through localStorage.
 */

import React, { createContext, useContext, useState, useEffect } from "react";

type BgContextType = {
  animated: boolean;
  setAnimated: (val: boolean) => void;
};
const BgContext = createContext<BgContextType | undefined>(undefined);

export const useBg = () => {
  const ctx = useContext(BgContext);
  if (!ctx) throw new Error("useBg must be used inside BgProvider");
  return ctx;
};

export const BgProvider = ({ children }: { children: React.ReactNode }) => {
  const [animated, setAnimated] = useState(true);

  useEffect(() => {
    const saved = localStorage.getItem("starfield-animated");
    if (saved !== null) setAnimated(saved === "true");
  }, []);

  useEffect(() => {
    localStorage.setItem("starfield-animated", String(animated));
  }, [animated]);

  return (
    <BgContext.Provider value={{ animated, setAnimated }}>
      {children}
    </BgContext.Provider>
  );
};
