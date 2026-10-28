export type HullClassification = { group_name: string; market_group_name?: string | null };

// SDE classes define hull families; no list of individual hull IDs is maintained.
const sizeGroups: Record<string, string[]> = {
    frigate: ['Frigate', 'Assault Frigate', 'Covert Ops', 'Interceptor', 'Stealth Bomber', 'Electronic Attack Ship', 'Expedition Frigate', 'Logistics Frigate', 'Prototype Exploration Ship'],
    destroyer: ['Destroyer', 'Interdictor', 'Tactical Destroyer', 'Command Destroyer'],
    cruiser: ['Cruiser', 'Heavy Assault Cruiser', 'Logistics', 'Force Recon Ship', 'Combat Recon Ship', 'Heavy Interdiction Cruiser', 'Strategic Cruiser', 'Flag Cruiser', 'Special Edition Yachts'],
    battlecruiser: ['Combat Battlecruiser', 'Attack Battlecruiser', 'Command Ship', 'Expedition Command Ship'],
    battleship: ['Battleship', 'Black Ops', 'Marauder'],
    capital: ['Dreadnought', 'Lancer Dreadnought', 'Carrier', 'Command Carrier', 'Supercarrier', 'Force Auxiliary', 'Titan', 'Capital Industrial Ship', 'Freighter', 'Jump Freighter'],
    industrial: ['Hauler', 'Deep Space Transport', 'Blockade Runner', 'Mining Barge', 'Exhumer', 'Industrial Command Ship'],
    other: ['Capsule', 'Corvette', 'Shuttle'],
};
export const sizeOptions = [
    ['frigate', 'Frigate'], ['destroyer', 'Destroyer'], ['cruiser', 'Cruiser'],
    ['battlecruiser', 'Battlecruiser'], ['battleship', 'Battleship'], ['capital', 'Capital'],
    ['industrial', 'Industrial / barge'], ['other', 'Other'],
] as const;
export const roleOptions = [
    { id: 'industrial', label: 'Industrials', title: 'Haulers, mining ships and industrial support ships' },
    { id: 'hauler', label: 'Haulers', title: 'Haulers, transports, blockade runners, freighters and jump freighters' },
    { id: 'miner', label: 'Miners', title: 'Mining frigates, mining destroyers, barges, exhumers and mining support ships' },
    { id: 'capital', label: 'Capitals', title: 'Combat capitals, freighters and capital industrial ships' },
] as const;

export function hullSize(hull: HullClassification): string {
    return Object.keys(sizeGroups).find((size) => sizeGroups[size].includes(hull.group_name)) ?? 'other';
}

export function hullRoles(hull: HullClassification): string[] {
    const group = hull.group_name;
    const hauler = ['Hauler', 'Deep Space Transport', 'Blockade Runner', 'Freighter', 'Jump Freighter'].includes(group);
    // The SDE puts Venture and Pioneer in the general Frigate/Destroyer classes.
    // Their ORE market branch identifies them without hard-coded hull IDs.
    const miner = ['Mining Barge', 'Exhumer', 'Expedition Frigate', 'Industrial Command Ship', 'Capital Industrial Ship'].includes(group)
        || (['Frigate', 'Destroyer', 'Command Destroyer'].includes(group) && hull.market_group_name === 'ORE');
    return [hauler || miner ? 'industrial' : '', hauler ? 'hauler' : '', miner ? 'miner' : '', hullSize(hull) === 'capital' ? 'capital' : ''].filter(Boolean);
}

export function classLabel(group: string): string {
    return group === 'Logistics' ? 'Logistics Cruiser' : group;
}

export function parseSelection(value: string | null): string[] {
    return [...new Set((value ?? '').split(',').filter(Boolean))];
}

export const liquidityOptions = [
    ['0', 'All hulls'], ['traded', 'Any 1y volume'], ['0.1', '≥ 0.1 / day'],
    ['1', '≥ 1 / day'], ['5', '≥ 5 / day'], ['10', '≥ 10 / day'], ['25', '≥ 25 / day'],
] as const;

export function liquidityThreshold(value: string | null): string {
    return liquidityOptions.some(([id]) => id === value) ? value! : '1';
}

export function meetsLiquidity(average: number, threshold: string): boolean {
    return Number.isFinite(average) && (threshold === 'traded' ? average > 0 : average >= Number(threshold));
}

export function matchesHullFilters(hull: HullClassification, sizes: string[], classes: string[], roles: string[]): boolean {
    return (!sizes.length || sizes.includes(hullSize(hull)))
        && (!classes.length || classes.includes(hull.group_name))
        && (!roles.length || hullRoles(hull).some((role) => roles.includes(role)));
}
