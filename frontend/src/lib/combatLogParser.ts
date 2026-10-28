export type CombatDirection = "in" | "out" | "neutral";
export type CombatEventKind = "damage" | "miss" | "capacitor" | "repair" | "ewar" | "other";

export type CombatActor = {
  name: string;
  corporation?: string | null;
  alliance?: string | null;
  ship?: string | null;
};

export type CombatLogEvent = {
  id: string;
  time: string;
  kind: CombatEventKind;
  direction: CombatDirection;
  amount: number;
  unit?: "hp" | "gj" | "event";
  actor?: CombatActor | null;
  target?: CombatActor | null;
  module?: string | null;
  quality?: string | null;
  text: string;
};

export type CombatMetricRow = {
  key: string;
  name: string;
  corporation?: string | null;
  alliance?: string | null;
  ship?: string | null;
  amount: number;
  events: number;
  hits?: number;
  misses?: number;
  minHit?: number;
  maxHit?: number;
  avgHit?: number;
  firstSeen?: string | null;
  lastSeen?: string | null;
};

export type CombatModuleRow = {
  key: string;
  name: string;
  amount: number;
  events: number;
  maxHit?: number;
};

export type CombatTimelineRow = {
  time: string;
  label: string;
  bucketSeconds?: number;
  damageOut: number;
  damageIn: number;
  repairsOut: number;
  repairsIn: number;
  capacitorOut: number;
  capacitorIn: number;
  ewar: number;
};

export type CombatEngagement = {
  id: string;
  startTime: string;
  endTime: string;
  durationSeconds: number;
  events: number;
  damageOut: number;
  damageIn: number;
  capacitorOut: number;
  capacitorIn: number;
};

export type CombatLogReportData = {
  version: number;
  generatedAt: string;
  topDamageOutTargets: CombatMetricRow[];
  topDamageInSources: CombatMetricRow[];
  outgoingWeapons: CombatModuleRow[];
  incomingWeapons: CombatModuleRow[];
  capacitorTargets: CombatMetricRow[];
  capacitorSources: CombatMetricRow[];
  repairTargets: CombatMetricRow[];
  repairSources: CombatMetricRow[];
  ewar: CombatMetricRow[];
  ewarTargets: CombatMetricRow[];
  ewarSources: CombatMetricRow[];
  ewarModules: CombatModuleRow[];
  hitQuality: { quality: string; outgoing: number; incoming: number }[];
  timeline: CombatTimelineRow[];
  engagements: CombatEngagement[];
  events: CombatLogEvent[];
  diagnostics: {
    unparsedCombatLines: number;
    notifyLines: number;
    capBoosterReloads?: number;
    droneEventsIgnored?: number;
    channels: Record<string, number>;
  };
};

export type CombatLogSummary = {
  totalLines: number;
  parsedLines: number;
  combatEvents: number;
  damageOut: number;
  damageIn: number;
  repairsOut: number;
  repairsIn: number;
  capacitorOut: number;
  capacitorIn: number;
  ewarEvents: number;
  missedShots: number;
  targets: number;
  attackers: number;
  weapons: number;
  durationSeconds: number;
  activeDamageOutSeconds?: number;
  activeDamageInSeconds?: number;
  activeDpsOut?: number;
  activeDpsIn?: number;
  windowDpsOut?: number;
  windowDpsIn?: number;
  dpsOut: number;
  dpsIn: number;
  parseRatio: number;
};

export type CombatLogReport = {
  id?: string;
  title: string;
  fileName: string;
  listener: string | null;
  sessionStartedAt: string | null;
  startTime: string | null;
  endTime: string | null;
  summary: CombatLogSummary;
  data: CombatLogReportData;
};

export type CombatLogParseOptions = {
  ignoreDrones?: boolean;
};

const EWAR_KEYWORDS = [
  "warp scrambler",
  "warp disruptor",
  "warp scramble",
  "warp disruption",
  "warp disrupted",
  "warp scrambled",
  "stasis web",
  "webifier",
  "webified",
  "target painter",
  "target painted",
  "painted",
  "tracking disrupt",
  "tracking disrupted",
  "guidance disrupt",
  "guidance disrupted",
  "sensor damp",
  "sensor dampened",
  "ecm",
  "jammed",
  "jammer",
  "burst jammer",
];

const DRONE_FAMILIES = [
  "acolyte",
  "hornet",
  "hobgoblin",
  "warrior",
  "hammerhead",
  "infiltrator",
  "vespa",
  "valkyrie",
  "ogre",
  "praetor",
  "wasp",
  "berserker",
  "garde",
  "curator",
  "warden",
  "bouncer",
  "gecko",
  "firbolg",
  "templar",
  "dragonfly",
  "einherji",
  "mantis",
  "tyrfing",
  "cyclops",
  "malleus",
  "siren",
  "dromi",
  "scarab",
  "cicada",
  "locust",
  "gram",
  "satyr",
  "metis",
  "antaeus",
  "termite",
];

function cleanNumber(value: string) {
  const n = Number(String(value || "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function normalizeSpaces(value: string) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function stripMarkup(value: string) {
  return normalizeSpaces(
    String(value || "")
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<\/?(?:color|font|b)\b[^>]*>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&amp;/gi, "&")
  );
}

function parseEveTime(value: string) {
  const match = String(value || "").match(/^(\d{4})\.(\d{2})\.(\d{2})\s+(\d{2}):(\d{2}):(\d{2})$/);
  if (!match) return null;
  const iso = `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}Z`;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function parseActor(value: string): CombatActor {
  const text = normalizeSpaces(value).replace(/^<|>$/g, "");
  const compact = text.match(/^(.+?)(?:\[([^\]]+)\])?\(([^()]*)\)$/);
  if (compact) {
    return {
      name: normalizeSpaces(compact[1]),
      corporation: compact[2] || null,
      ship: compact[3] || null,
    };
  }

  const bracketMatches = Array.from(text.matchAll(/\[([^\]]+)\]/g));
  if (bracketMatches.length) {
    const firstBracket = text.indexOf("[");
    const last = bracketMatches[bracketMatches.length - 1];
    const lastEnd = (last.index || 0) + last[0].length;
    const trailing = normalizeSpaces(text.slice(lastEnd));
    if (bracketMatches.length >= 2 && /^-*$/.test(trailing)) {
      return {
        name: last[1] || "Unknown",
        alliance: bracketMatches.length >= 3 ? bracketMatches[0][1] : null,
        corporation: bracketMatches.length >= 3 ? bracketMatches[1][1] : bracketMatches[0][1] || null,
        ship: normalizeSpaces(text.slice(0, firstBracket)) || null,
      };
    }
    return {
      name: normalizeSpaces(text.slice(0, firstBracket)),
      alliance: bracketMatches.length > 1 ? bracketMatches[0][1] : null,
      corporation: last[1] || null,
      ship: trailing || null,
    };
  }

  return { name: text || "Unknown" };
}

function parseRichActors(value: string) {
  const fields = Array.from(String(value || "").matchAll(/<fontsize=(\d+)>([^<]*)/gi))
    .map((match) => ({ size: Number(match[1]), value: normalizeSpaces(match[2]) }))
    .filter((field) => field.value);
  const actors: CombatActor[] = [];

  for (let index = 0; index < fields.length; index += 1) {
    if (fields[index].size !== 16) continue;
    const corporation = index > 0 && fields[index - 1].size === 21 ? fields[index - 1].value : null;
    const ship = index + 1 < fields.length && fields[index + 1].size === 18 ? fields[index + 1].value : null;
    actors.push({ name: fields[index].value, corporation, ship });
  }

  return actors;
}

function actorKey(actor?: CombatActor | null) {
  if (!actor) return "unknown";
  return [actor.name, actor.corporation || "", actor.ship || ""].join("|").toLowerCase();
}

function actorName(actor?: CombatActor | null) {
  return actor?.name || "Unknown";
}

function hasEwarKeyword(value: string) {
  const lower = value.toLowerCase();
  return EWAR_KEYWORDS.some((keyword) => lower.includes(keyword));
}

function cleanModuleName(value: string) {
  return normalizeSpaces(value).replace(/^(?:-\s*)+/, "");
}

function inferEffectDirection(body: string, fallback: CombatDirection = "in"): CombatDirection {
  const lower = String(body || "").toLowerCase();
  if (lower.includes("0xff00ffff") || lower.includes("0xff7fffff")) return "out";
  if (lower.includes("0xffe57f7f") || lower.includes("0xffcc0000")) return "in";
  return fallback;
}

function moduleKey(value?: string | null) {
  return normalizeSpaces(value || "Unknown module").toLowerCase();
}

function looksLikeDroneName(value?: string | null) {
  const raw = normalizeSpaces(value || "").toLowerCase();
  if (!raw) return false;
  if (/\b(?:light|medium|heavy|sentry|support|electronic warfare)\s+drone\b/.test(raw)) return true;
  if (/\bfighter\b/.test(raw)) return true;

  const stripped = raw
    .replace(/^'(integrated|augmented)'\s+/, "")
    .replace(/^(integrated|augmented|federation navy|imperial navy|republic fleet|caldari navy|civilian)\s+/, "")
    .replace(/\s+drone$/i, "")
    .trim();

  return DRONE_FAMILIES.some((family) => {
    if (stripped === family) return true;
    if (!stripped.startsWith(`${family} `)) return false;
    const suffix = stripped.slice(family.length).trim();
    return /^(?:i|ii|iii|iv|v|ec-\d{3}|sd-\d{3}|sw-\d{3}|tp-\d{3}|ev-\d{3}|td-\d{3}|gd-\d{3}|compact|scoped|navy|elite)?$/i.test(suffix);
  });
}

export function isDroneCombatEvent(event: CombatLogEvent) {
  return (
    looksLikeDroneName(event.module) ||
    looksLikeDroneName(event.actor?.ship) ||
    looksLikeDroneName(event.actor?.name) ||
    looksLikeDroneName(event.target?.ship) ||
    looksLikeDroneName(event.target?.name)
  );
}

function eventFromBody(
  body: string,
  clean: string,
  time: string,
  index: number,
  listenerActor: CombatActor | null
): CombatLogEvent | null {
  const base = {
    id: `${time}-${index}`,
    time,
    amount: 0,
    text: clean.slice(0, 320),
  };

  const damage = clean.match(/^([\d,.]+)\s+(to|from)\s+(.+)$/i);
  if (damage) {
    const fields = damage[3].split(/\s+-\s+/).map(normalizeSpaces).filter(Boolean);
    if (fields.length < 2) return null;

    // Structure targets include a location prefix separated by " - ", so read
    // weapon and hit quality from the right side of the combat message.
    const hasQuality = fields.length >= 3;
    const otherName = fields.slice(0, hasQuality ? -2 : -1).join(" - ");
    const moduleName = fields[hasQuality ? fields.length - 2 : fields.length - 1];
    const quality = hasQuality ? fields[fields.length - 1] : null;
    const amount = cleanNumber(damage[1]);
    const other = parseActor(otherName);
    const direction = damage[2].toLowerCase() === "to" ? "out" : "in";
    return {
      ...base,
      kind: hasEwarKeyword(moduleName) ? "ewar" : "damage",
      direction,
      amount,
      unit: "hp",
      actor: direction === "out" ? listenerActor : other,
      target: direction === "out" ? other : listenerActor,
      module: moduleName,
      quality,
    };
  }

  const capNeutralized = clean.match(/^(-?[\d,.]+)\s+GJ\s+energy neutralized\s+(.+?)\s+-\s+(.+)$/i);
  if (capNeutralized) {
    const other = parseActor(capNeutralized[2]);
    const direction = inferEffectDirection(body, "in");
    return {
      ...base,
      kind: "capacitor",
      direction,
      amount: Math.abs(cleanNumber(capNeutralized[1])),
      unit: "gj",
      actor: direction === "out" ? listenerActor : other,
      target: direction === "out" ? other : listenerActor,
      module: normalizeSpaces(capNeutralized[3]),
      quality: "Neutralized",
    };
  }

  const capDrainedFrom = clean.match(/^([+-]?[\d,.]+)\s+GJ\s+energy drained from\s+(.+?)\s+-\s+(.+)$/i);
  if (capDrainedFrom) {
    const other = parseActor(capDrainedFrom[2]);
    const direction = inferEffectDirection(body, "out");
    return {
      ...base,
      kind: "capacitor",
      direction,
      amount: Math.abs(cleanNumber(capDrainedFrom[1])),
      unit: "gj",
      actor: direction === "out" ? listenerActor : other,
      target: direction === "out" ? other : listenerActor,
      module: normalizeSpaces(capDrainedFrom[3]),
      quality: "Drained",
    };
  }

  const capDrainedTo = clean.match(/^([+-]?[\d,.]+)\s+GJ\s+energy drained to\s+(.+?)\s+-\s+(.+)$/i);
  if (capDrainedTo) {
    const other = parseActor(capDrainedTo[2]);
    const direction = inferEffectDirection(body, "in");
    return {
      ...base,
      kind: "capacitor",
      direction,
      amount: Math.abs(cleanNumber(capDrainedTo[1])),
      unit: "gj",
      actor: direction === "out" ? listenerActor : other,
      target: direction === "out" ? other : listenerActor,
      module: normalizeSpaces(capDrainedTo[3]),
      quality: "Drained",
    };
  }

  const incomingMiss = clean.match(/^(.+?)\s+misses you completely\s+-\s+(.+)$/i);
  if (incomingMiss) {
    return {
      ...base,
      kind: "miss",
      direction: "in",
      amount: 0,
      unit: "event",
      actor: parseActor(incomingMiss[1]),
      target: listenerActor,
      module: normalizeSpaces(incomingMiss[2]),
      quality: "Misses",
    };
  }

  const outgoingMiss = clean.match(/^Your\s+(.+?)\s+misses\s+(.+?)\s+completely/i);
  if (outgoingMiss) {
    return {
      ...base,
      kind: "miss",
      direction: "out",
      amount: 0,
      unit: "event",
      actor: listenerActor,
      target: parseActor(outgoingMiss[2]),
      module: normalizeSpaces(outgoingMiss[1]),
      quality: "Misses",
    };
  }

  const repair = clean.match(/^([\d,.]+)\s+(?:HP\s+)?(?:(?:remote\s+)?(?:shield|armor|hull|structure)|(?:shield|armor|hull|structure)\s+remote)?\s*(?:repaired|boosted|transferred)\s+(?:to|from|by)?\s*(.+?)\s+-\s+(.+)$/i);
  if (repair) {
    const lower = clean.toLowerCase();
    const direction: CombatDirection = lower.includes(" from ") || lower.includes(" by ") ? "in" : "out";
    const richActor = parseRichActors(body)[0];
    let other = richActor || parseActor(repair[2]);
    if (richActor && !richActor.corporation) {
      const actorText = normalizeSpaces(repair[2]);
      const actorSuffix = normalizeSpaces(`${richActor.name} ${richActor.ship || ""}`);
      const corporation = actorText.endsWith(actorSuffix)
        ? normalizeSpaces(actorText.slice(0, -actorSuffix.length))
        : "";
      if (corporation) other = { ...richActor, corporation };
    }
    return {
      ...base,
      kind: "repair",
      direction,
      amount: cleanNumber(repair[1]),
      unit: "hp",
      actor: direction === "out" ? listenerActor : other,
      target: direction === "out" ? other : listenerActor,
      module: normalizeSpaces(repair[3]),
      quality: "Repair",
    };
  }

  const outgoingEwarHit = clean.match(/^(.+?)\s+(jammed|webbed|webified|painted|target painted|tracking disrupted|guidance disrupted|sensor dampened|warp disrupted|warp scrambled|scrambled|disrupted)\s+-\s+(.+)$/i);
  if (outgoingEwarHit && hasEwarKeyword(`${outgoingEwarHit[2]} ${outgoingEwarHit[3]}`)) {
    return {
      ...base,
      kind: "ewar",
      direction: "out",
      amount: 1,
      unit: "event",
      actor: listenerActor,
      target: parseActor(outgoingEwarHit[1]),
      module: normalizeSpaces(outgoingEwarHit[3]),
      quality: normalizeSpaces(outgoingEwarHit[2]),
    };
  }

  const incomingJammed = clean.match(/^(?:You're|You are)\s+jammed\s+by\s+(.+?)\s+-\s+(.+)$/i);
  if (incomingJammed) {
    const source = parseActor(incomingJammed[1]);
    return {
      ...base,
      kind: "ewar",
      direction: "in",
      amount: 1,
      unit: "event",
      actor: source,
      target: listenerActor,
      module: cleanModuleName(incomingJammed[2]),
      quality: "jammed",
    };
  }

  if (hasEwarKeyword(`${clean} ${body}`)) {
    const directional = clean.match(/\bfrom\s+(.+?)\s+to\s+(.+?)(?:\s+-\s+(.+))?$/i);
    const source = directional ? parseActor(directional[1]) : null;
    const targetText = directional ? normalizeSpaces(directional[2]).replace(/!+$/g, "") : "";
    const target =
      targetText.toLowerCase() === "you"
        ? listenerActor
        : targetText
          ? parseActor(targetText)
          : null;
    const listenerKey = actorKey(listenerActor);
    const direction: CombatDirection =
      source && actorKey(source) === listenerKey
        ? "out"
        : target && actorKey(target) === listenerKey
          ? "in"
          : "neutral";
    const moduleName = normalizeSpaces(
      directional?.[3] || (clean.includes(" - ") ? clean.split(" - ").pop() : clean.split(/\s+from\s+/i)[0]) || "Electronic warfare"
    );
    return {
      ...base,
      kind: "ewar",
      direction,
      amount: 1,
      unit: "event",
      actor: source || (direction === "out" ? listenerActor : null),
      target: target || (direction === "in" ? listenerActor : null),
      module: moduleName,
      quality: "EWAR",
    };
  }

  return null;
}

function ensureMetric(map: Map<string, CombatMetricRow>, actor?: CombatActor | null) {
  const key = actorKey(actor);
  let row = map.get(key);
  if (!row) {
    row = {
      key,
      name: actorName(actor),
      corporation: actor?.corporation || null,
      alliance: actor?.alliance || null,
      ship: actor?.ship || null,
      amount: 0,
      events: 0,
      hits: 0,
      misses: 0,
      minHit: 0,
      maxHit: 0,
      avgHit: 0,
      firstSeen: null,
      lastSeen: null,
    };
    map.set(key, row);
  }
  return row;
}

function addMetric(map: Map<string, CombatMetricRow>, actor: CombatActor | null | undefined, event: CombatLogEvent) {
  const row = ensureMetric(map, actor);
  const amount = Number(event.amount || 0);
  row.amount += amount;
  row.events += 1;
  if (amount > 0) {
    row.hits = Number(row.hits || 0) + 1;
    row.minHit = row.minHit && row.minHit > 0 ? Math.min(row.minHit, amount) : amount;
  } else {
    row.misses = Number(row.misses || 0) + 1;
  }
  row.maxHit = Math.max(row.maxHit || 0, amount);
  row.avgHit = row.hits ? row.amount / row.hits : 0;
  row.firstSeen = row.firstSeen || event.time;
  row.lastSeen = event.time;
}

function addMiss(map: Map<string, CombatMetricRow>, actor: CombatActor | null | undefined, event: CombatLogEvent) {
  const row = ensureMetric(map, actor);
  row.events += 1;
  row.misses = Number(row.misses || 0) + 1;
  row.firstSeen = row.firstSeen || event.time;
  row.lastSeen = event.time;
}

function addModule(map: Map<string, CombatModuleRow>, event: CombatLogEvent) {
  const key = moduleKey(event.module);
  let row = map.get(key);
  if (!row) {
    row = { key, name: event.module || "Unknown module", amount: 0, events: 0, maxHit: 0 };
    map.set(key, row);
  }
  row.amount += Number(event.amount || 0);
  row.events += 1;
  row.maxHit = Math.max(row.maxHit || 0, Number(event.amount || 0));
}

function topRows<T extends { amount: number; events: number }>(map: Map<string, T>, limit = 40) {
  return Array.from(map.values())
    .sort((a, b) => b.amount - a.amount || b.events - a.events)
    .slice(0, limit);
}

const ACTIVE_DAMAGE_GAP_SECONDS = 20;
const TIMELINE_BUCKET_SECONDS = 10;

function timelineLabel(time: string) {
  return time.slice(11, 19);
}

function bucketTime(time: string, bucketSeconds = TIMELINE_BUCKET_SECONDS) {
  const date = new Date(time);
  if (Number.isNaN(date.getTime())) return `${time.slice(0, 16)}:00Z`;
  const bucketMs = bucketSeconds * 1000;
  return new Date(Math.floor(date.getTime() / bucketMs) * bucketMs).toISOString();
}

function emptyTimelinePoint(time: string, bucketSeconds = TIMELINE_BUCKET_SECONDS): CombatTimelineRow {
  return {
    time,
    label: timelineLabel(time),
    bucketSeconds,
    damageOut: 0,
    damageIn: 0,
    repairsOut: 0,
    repairsIn: 0,
    capacitorOut: 0,
    capacitorIn: 0,
    ewar: 0,
  };
}

function filledTimeline(
  timeline: Map<string, CombatTimelineRow>,
  startTime: string | null,
  endTime: string | null,
  bucketSeconds = TIMELINE_BUCKET_SECONDS
) {
  if (!startTime || !endTime) return Array.from(timeline.values()).sort((a, b) => a.time.localeCompare(b.time));

  const bucketMs = bucketSeconds * 1000;
  const startMs = new Date(bucketTime(startTime, bucketSeconds)).getTime();
  const endMs = new Date(bucketTime(endTime, bucketSeconds)).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) {
    return Array.from(timeline.values()).sort((a, b) => a.time.localeCompare(b.time));
  }

  const rows: CombatTimelineRow[] = [];
  for (let ms = startMs; ms <= endMs; ms += bucketMs) {
    const key = new Date(ms).toISOString();
    rows.push(timeline.get(key) || emptyTimelinePoint(key, bucketSeconds));
  }
  return rows;
}

function activeDamageSeconds(events: CombatLogEvent[], direction: CombatDirection) {
  const times = events
    .filter((event) => event.kind === "damage" && event.direction === direction && event.amount > 0)
    .map((event) => new Date(event.time).getTime())
    .filter((time) => Number.isFinite(time))
    .sort((a, b) => a - b);

  if (!times.length) return 0;

  let activeSeconds = 0;
  let clusterStart = times[0];
  let previous = times[0];

  for (const time of times.slice(1)) {
    const gapSeconds = (time - previous) / 1000;
    if (gapSeconds > ACTIVE_DAMAGE_GAP_SECONDS) {
      activeSeconds += Math.max(1, Math.round((previous - clusterStart) / 1000));
      clusterStart = time;
    }
    previous = time;
  }

  activeSeconds += Math.max(1, Math.round((previous - clusterStart) / 1000));
  return activeSeconds;
}

function makeEngagements(events: CombatLogEvent[]) {
  const relevant = events.filter((event) => event.kind !== "other");
  const groups: CombatEngagement[] = [];
  let current: CombatEngagement | null = null;
  let previousTime = 0;

  for (const event of relevant) {
    const eventMs = new Date(event.time).getTime();
    if (!current || eventMs - previousTime > 120000) {
      current = {
        id: `engagement-${groups.length + 1}`,
        startTime: event.time,
        endTime: event.time,
        durationSeconds: 0,
        events: 0,
        damageOut: 0,
        damageIn: 0,
        capacitorOut: 0,
        capacitorIn: 0,
      };
      groups.push(current);
    }

    current.endTime = event.time;
    current.durationSeconds = Math.max(
      1,
      Math.round((new Date(current.endTime).getTime() - new Date(current.startTime).getTime()) / 1000)
    );
    current.events += 1;
    if (event.kind === "damage" && event.direction === "out") current.damageOut += event.amount;
    if (event.kind === "damage" && event.direction === "in") current.damageIn += event.amount;
    if (event.kind === "capacitor" && event.direction === "out") current.capacitorOut += event.amount;
    if (event.kind === "capacitor" && event.direction === "in") current.capacitorIn += event.amount;
    previousTime = eventMs;
  }

  return groups;
}

export function parseCombatLog(text: string, fileName = "combat-log.txt", options: CombatLogParseOptions = {}): CombatLogReport {
  const lines = String(text || "").split(/\r?\n/);
  const listenerLine = lines.find((line) => line.includes("Listener:"));
  const sessionLine = lines.find((line) => line.includes("Session Started:"));
  const listener = listenerLine ? normalizeSpaces(listenerLine.split("Listener:")[1] || "") : null;
  const sessionStartedAt = sessionLine ? parseEveTime(normalizeSpaces(sessionLine.split("Session Started:")[1] || "")) : null;
  const listenerActor = listener ? parseActor(listener) : null;

  const events: CombatLogEvent[] = [];
  const channels: Record<string, number> = {};
  let parsedLines = 0;
  let unparsedCombatLines = 0;
  let notifyLines = 0;
  let capBoosterReloads = 0;
  let droneEventsIgnored = 0;

  const records: Array<{ line: string; index: number }> = [];
  lines.forEach((line, index) => {
    if (/^\[\s*\d{4}\.\d{2}\.\d{2}\s+\d{2}:\d{2}:\d{2}\s*\]\s+\([^)]+\)/.test(line)) {
      records.push({ line, index });
    } else if (records.length) {
      records[records.length - 1].line += ` ${line}`;
    }
  });

  records.forEach(({ line, index }) => {
    const match = line.match(/^\[\s*(\d{4}\.\d{2}\.\d{2}\s+\d{2}:\d{2}:\d{2})\s*\]\s+\(([^)]+)\)\s+(.*)$/);
    if (!match) return;

    parsedLines += 1;
    const time = parseEveTime(match[1]);
    if (!time) return;
    const channel = normalizeSpaces(match[2]).toLowerCase();
    channels[channel] = (channels[channel] || 0) + 1;
    const body = match[3] || "";
    const clean = stripMarkup(body);
    if (channel === "notify") {
      notifyLines += 1;
      if (/capacitor booster has run out of charges/i.test(clean)) capBoosterReloads += 1;
    }
    const event = eventFromBody(body, clean, time, index, listenerActor);
    if (event && options.ignoreDrones && isDroneCombatEvent(event)) {
      droneEventsIgnored += 1;
      return;
    }
    if (event) events.push(event);
    else if (channel === "combat") unparsedCombatLines += 1;
  });

  const damageOutTargets = new Map<string, CombatMetricRow>();
  const damageInSources = new Map<string, CombatMetricRow>();
  const outgoingWeapons = new Map<string, CombatModuleRow>();
  const incomingWeapons = new Map<string, CombatModuleRow>();
  const capacitorTargets = new Map<string, CombatMetricRow>();
  const capacitorSources = new Map<string, CombatMetricRow>();
  const repairTargets = new Map<string, CombatMetricRow>();
  const repairSources = new Map<string, CombatMetricRow>();
  const ewar = new Map<string, CombatMetricRow>();
  const ewarTargets = new Map<string, CombatMetricRow>();
  const ewarSources = new Map<string, CombatMetricRow>();
  const ewarModules = new Map<string, CombatModuleRow>();
  const timeline = new Map<string, CombatTimelineRow>();
  const quality = new Map<string, { quality: string; outgoing: number; incoming: number }>();
  const startTime = events[0]?.time || sessionStartedAt;
  const endTime = events[events.length - 1]?.time || sessionStartedAt;

  let damageOut = 0;
  let damageIn = 0;
  let repairsOut = 0;
  let repairsIn = 0;
  let capacitorOut = 0;
  let capacitorIn = 0;
  let ewarEvents = 0;
  let missedShots = 0;

  for (const event of events) {
    const bucket = bucketTime(event.time);
    let point = timeline.get(bucket);
    if (!point) {
      point = emptyTimelinePoint(bucket);
      timeline.set(bucket, point);
    }

    if (event.kind === "damage") {
      if (event.direction === "out") {
        damageOut += event.amount;
        point.damageOut += event.amount;
        addMetric(damageOutTargets, event.target, event);
        addModule(outgoingWeapons, event);
      } else {
        damageIn += event.amount;
        point.damageIn += event.amount;
        addMetric(damageInSources, event.actor, event);
        addModule(incomingWeapons, event);
      }

      const key = event.quality || "Hit";
      const row = quality.get(key) || { quality: key, outgoing: 0, incoming: 0 };
      if (event.direction === "out") row.outgoing += 1;
      if (event.direction === "in") row.incoming += 1;
      quality.set(key, row);
    }

    if (event.kind === "capacitor") {
      if (event.direction === "out") {
        capacitorOut += event.amount;
        point.capacitorOut += event.amount;
        addMetric(capacitorTargets, event.target, event);
      } else {
        capacitorIn += event.amount;
        point.capacitorIn += event.amount;
        addMetric(capacitorSources, event.actor, event);
      }
    }

    if (event.kind === "repair") {
      if (event.direction === "out") {
        repairsOut += event.amount;
        point.repairsOut += event.amount;
        addMetric(repairTargets, event.target, event);
      } else {
        repairsIn += event.amount;
        point.repairsIn += event.amount;
        addMetric(repairSources, event.actor, event);
      }
    }

    if (event.kind === "ewar") {
      ewarEvents += 1;
      point.ewar += 1;
      if (event.direction === "out") addMetric(ewarTargets, event.target, event);
      if (event.direction === "in") addMetric(ewarSources, event.actor, event);
      addMetric(ewar, event.direction === "out" ? event.target : event.direction === "in" ? event.actor : event.target || event.actor, event);
      if (event.direction !== "neutral") addModule(ewarModules, event);
    }

    if (event.kind === "miss") {
      missedShots += 1;
      if (event.direction === "out") {
        addMiss(damageOutTargets, event.target, event);
        addModule(outgoingWeapons, event);
      }
      if (event.direction === "in") {
        addMiss(damageInSources, event.actor, event);
        addModule(incomingWeapons, event);
      }
    }
  }

  const sortedTimeline = filledTimeline(timeline, startTime, endTime);
  const durationSeconds =
    startTime && endTime
      ? Math.max(1, Math.round((new Date(endTime).getTime() - new Date(startTime).getTime()) / 1000))
      : 0;
  const activeDamageOutSeconds = activeDamageSeconds(events, "out");
  const activeDamageInSeconds = activeDamageSeconds(events, "in");
  const activeDpsOut = activeDamageOutSeconds ? damageOut / activeDamageOutSeconds : 0;
  const activeDpsIn = activeDamageInSeconds ? damageIn / activeDamageInSeconds : 0;
  const windowDpsOut = durationSeconds ? damageOut / durationSeconds : 0;
  const windowDpsIn = durationSeconds ? damageIn / durationSeconds : 0;
  const targetCount = new Set(
    [...damageOutTargets.keys(), ...capacitorTargets.keys(), ...ewarTargets.keys()].filter((key) => key !== "unknown")
  ).size;
  const attackerCount = new Set(
    [...damageInSources.keys(), ...capacitorSources.keys(), ...ewarSources.keys()].filter((key) => key !== "unknown")
  ).size;
  const titleDate = startTime ? startTime.slice(0, 10) : "Unknown Date";
  const parsedCombatLines = Math.max(1, channels.combat || 0);

  return {
    title: listener ? `${listener} Combat Log - ${titleDate}` : `Combat Log - ${titleDate}`,
    fileName,
    listener,
    sessionStartedAt,
    startTime,
    endTime,
    summary: {
      totalLines: lines.length,
      parsedLines,
      combatEvents: events.length,
      damageOut,
      damageIn,
      repairsOut,
      repairsIn,
      capacitorOut,
      capacitorIn,
      ewarEvents,
      missedShots,
      targets: targetCount,
      attackers: attackerCount,
      weapons: new Set([...outgoingWeapons.keys(), ...incomingWeapons.keys()]).size,
      durationSeconds,
      activeDamageOutSeconds,
      activeDamageInSeconds,
      activeDpsOut,
      activeDpsIn,
      windowDpsOut,
      windowDpsIn,
      dpsOut: activeDpsOut,
      dpsIn: activeDpsIn,
      parseRatio: Math.max(0, Math.min(1, (parsedCombatLines - unparsedCombatLines) / parsedCombatLines)),
    },
    data: {
      version: 2,
      generatedAt: new Date().toISOString(),
      topDamageOutTargets: topRows(damageOutTargets, 60),
      topDamageInSources: topRows(damageInSources, 60),
      outgoingWeapons: topRows(outgoingWeapons, 60),
      incomingWeapons: topRows(incomingWeapons, 60),
      capacitorTargets: topRows(capacitorTargets, 60),
      capacitorSources: topRows(capacitorSources, 60),
      repairTargets: topRows(repairTargets, 60),
      repairSources: topRows(repairSources, 60),
      ewar: topRows(ewar, 60),
      ewarTargets: topRows(ewarTargets, 60),
      ewarSources: topRows(ewarSources, 60),
      ewarModules: topRows(ewarModules, 60),
      hitQuality: Array.from(quality.values()).sort((a, b) => b.outgoing + b.incoming - (a.outgoing + a.incoming)),
      timeline: sortedTimeline,
      engagements: makeEngagements(events),
      events,
      diagnostics: {
        unparsedCombatLines,
        notifyLines,
        capBoosterReloads,
        droneEventsIgnored,
        channels,
      },
    },
  };
}
