/*
 * Wraps pages with the shared app background layers.
 * Accepts React children and renders static visual chrome around route content.
 */

import React from "react";

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative min-h-screen bg-[#1e1f29] text-gray-100 font-mono overflow-hidden tt-ui-root">
      { }
      <div className="absolute inset-0 z-0 pointer-events-none static-starfield" />

      { }
      <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-cyan-400/20 to-transparent z-10" />
      <div className="absolute bottom-0 right-0 w-full h-1 bg-gradient-to-l from-blue-400/20 to-transparent z-10" />

      { }
      <div className="relative z-10">{children}</div>
    </div>
  );
}
