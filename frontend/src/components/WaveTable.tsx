/*
 * Shared React component for Wave Table.
 * Accepts props from pages and renders reusable UI without defining public routes.
 */

export const shipNameToClassMap: Record<
  string,
  "frigate" | "cruiser" | "battleship" | "sentry" | "tower"
> = {

  "Vigilant Sentry Tower": "tower",
  "Wakeful Sentry Tower": "tower",
  "Restless Sentry Tower": "tower",

  "Emergent Escort": "frigate",
  "Emergent Patroller": "frigate",
  "Emergent Watchman": "frigate",
  "Emergent Defender": "frigate",
  "Emergent Keeper": "frigate",
  "Emergent Preserver": "frigate",
  "Emergent Warden": "frigate",
  "Emergent Upholder": "frigate",

  "Awakened Patroller": "cruiser",
  "Awakened Watchman": "cruiser",
  "Awakened Escort": "cruiser",
  "Awakened Defender": "cruiser",
  "Awakened Keeper": "cruiser",
  "Awakened Preserver": "cruiser",
  "Awakened Warden": "cruiser",
  "Awakened Sentinel": "cruiser",
  "Awakened Upholder": "cruiser",

  "Sleepless Patroller": "battleship",
  "Sleepless Watchman": "battleship",
  "Sleepless Escort": "battleship",
  "Sleepless Defender": "battleship",
  "Sleepless Keeper": "battleship",
  "Sleepless Preserver": "battleship",
  "Sleepless Upholder": "battleship",
  "Sleepless Safeguard": "battleship",
  "Sleepless Sentinel": "battleship",
  "Sleepless Warden": "battleship",
  "Sleepless Guardian": "battleship",
  "Sleepless Outguard": "battleship",
  "Drifter Recon Battleship": "battleship",
  "Drifter Response Battleship": "battleship",
  "Upgraded Avenger": "battleship",

  "Emergent Sentinel": "frigate",
};

const specialEffectIconMap: Record<string, string> = {
  scram: "/icons/specials/scram.png",
  web: "/icons/specials/web.png",
  neut: "/icons/specials/neut.png",
  rr: "/icons/specials/rr.png",
};

const specialSortOrder: Record<string, number> = {
  rr: 1,
  web: 2,
  scram: 3,
  neut: 4,
};

const shipClassIconMap: Record<string, string> = {
  battleship: "/icons/ships/battleship.png",
  cruiser: "/icons/ships/cruiser.png",
  frigate: "/icons/ships/frigate.png",
  tower: "/icons/ships/sentry.png",
};

interface Ship {
  qty: number;
  name: string;
  dps: number;
  alpha: number;
  ehp: number;
  sig: number;
  orbit_velocity: number;
  distance: number;
  special: Record<string, number>;
  trigger?: boolean;
  triggerOnAttack?: boolean;
}

function summarizeSpecials(ships: Ship[]): Record<string, number> {
  const totalSpecials: Record<string, number> = {};

  ships.forEach((ship) => {
    if (!ship.special) return;

    for (const [effect, count] of Object.entries(ship.special)) {
      totalSpecials[effect] = (totalSpecials[effect] || 0) + count * ship.qty;
    }
  });

  return totalSpecials;
}

export function getWaveTotals(ships: Ship[]) {
  return {
    totalEHP: ships.reduce((sum, s) => sum + s.ehp * s.qty, 0),
    totalDPS: ships.reduce((sum, s) => sum + s.dps * s.qty, 0),
    totalAlpha: ships.reduce((sum, s) => sum + s.alpha * s.qty, 0),
    totalSpecials: summarizeSpecials(ships),
  };
}

export default function WaveTable({ ships }: { ships: Ship[] }) {
  return (
    <div className="overflow-x-auto border border-[#303236] bg-[#05070b]/95">
      <table className="table-auto w-full text-[11px] border-collapse">
        <thead>
          <tr className="bg-[#14161d] text-slate-100">
            <th className="border border-[#2b2d33] px-2.5 py-1.5 text-left w-12">
              Qty
            </th>
            <th className="border border-[#2b2d33] px-2.5 py-1.5 text-left w-60">
              Name
            </th>
            <th className="border border-[#2b2d33] px-2.5 py-1.5 text-left w-24">
              EHP
            </th>
            <th className="border border-[#2b2d33] px-2.5 py-1.5 text-left w-20">
              DPS
            </th>
            <th className="border border-[#2b2d33] px-2.5 py-1.5 text-left w-20">
              Alpha
            </th>
            <th className="border border-[#2b2d33] px-2.5 py-1.5 text-left w-20">
              Sig
            </th>
            <th className="border border-[#2b2d33] px-2.5 py-1.5 text-left w-20">
              Orbit
            </th>
            <th className="border border-[#2b2d33] px-2.5 py-1.5 text-left w-20">
              Dist
            </th>
            <th className="border border-[#2b2d33] px-2.5 py-1.5 text-left w-44">
              Special
            </th>
          </tr>
        </thead>

        <tbody>
          {ships.map((ship: any, i) => (
            <tr
              key={i}
              className={`border-t border-[#2b2d33] ${
                i % 2 === 0 ? "bg-[#090b11]" : "bg-[#0c0f16]"
              } hover:bg-[#141821]`}
            >
              <td className="px-2.5 py-1.5 align-middle">{ship.qty}</td>
              <td className="px-2.5 py-1.5 align-middle">
                <div className="flex items-center gap-2">
                  {(() => {
                    const classType = shipNameToClassMap[ship.name];
                    return (
                      <>
                        {classType && shipClassIconMap[classType] && (
                          <img
                            src={shipClassIconMap[classType]}
                            alt={classType}
                            className="w-4 h-4"
                            title={classType}
                          />
                        )}
                        <span className="text-slate-100">{ship.name}</span>
                        {ship.trigger && (
                          <span className="ml-1 text-[10px] bg-[#a53737] text-white px-1 rounded-sm">
                            Trigger
                          </span>
                        )}
                        {ship.triggerOnAttack && (
                          <span className="ml-1 shrink-0 whitespace-nowrap text-[10px] bg-[#9a5b20] text-[#fff1d0] px-1 rounded-sm">
                            Trigger on Attack
                          </span>
                        )}
                        {ship.optional && (
                          <span className="ml-1 text-[10px] bg-[#2f6b39] text-white px-1 rounded-sm">
                            Optional
                          </span>
                        )}
                        {ship.dta && (
                          <span className="ml-1 text-[10px] bg-[#5c3c8a] text-white px-1 rounded-sm">
                            DTR
                          </span>
                        )}
                      </>
                    );
                  })()}
                </div>
              </td>

              <td className="px-2.5 py-1.5 align-middle">
                {ship.ehp.toLocaleString()}
              </td>
              <td className="px-2.5 py-1.5 align-middle">
                {ship.dps.toLocaleString()}
              </td>
              <td className="px-2.5 py-1.5 align-middle">
                {ship.alpha.toLocaleString()}
              </td>
              <td className="px-2.5 py-1.5 align-middle">{ship.sig}</td>
              <td className="px-2.5 py-1.5 align-middle">
                {ship.orbit_velocity}
              </td>
              <td className="px-2.5 py-1.5 align-middle">{ship.distance}</td>
              <td className="px-2.5 py-1.5 align-middle">
                <div className="flex gap-2 items-center flex-wrap">
                  {ship.special &&
                    Object.entries(ship.special)
                      .sort(
                        ([a], [b]) =>
                          (specialSortOrder[a.toLowerCase()] || 99) -
                          (specialSortOrder[b.toLowerCase()] || 99)
                      )
                      .map(([effect, count], idx) => {
                        const key = effect.toLowerCase();
                        const icon = specialEffectIconMap[key];
                        const label =
                          key === "neut" ? `-${count}` : `x${count}`;
                        return (
                          <div
                            key={idx}
                            className="flex items-center gap-1 text-slate-200"
                          >
                            {icon && (
                              <img
                                src={icon}
                                alt={effect}
                                className="w-4 h-4"
                              />
                            )}
                            <span className="text-[11px]">{label}</span>
                          </div>
                        );
                      })}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
