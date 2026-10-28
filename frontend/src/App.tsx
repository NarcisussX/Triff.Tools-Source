/*
 * Defines the React application shell, global navigation drawer, UI scale controls, and public routes.
 * Renders page components for saved URLs and uses Tranquility status plus localStorage for header state.
 */

import { Navigate, Routes, Route, Link, useLocation } from "react-router-dom";
import { lazy, Suspense, useState, useEffect, useCallback, useRef } from "react";
import { LogOut, Menu, Settings, User, X } from "lucide-react";
import { applySeo, trackPageView } from "./seo";
import {
  loadGoogleAnalytics,
  readAnalyticsConsent,
  saveAnalyticsConsent,
  type AnalyticsConsent,
} from "./lib/analyticsConsent";
import {
  notifySiteAuthChanged,
  SITE_AUTH_CHANGED_EVENT,
  SITE_AUTH_OPEN_EVENT,
  type SiteAuthChangeDetail,
  type SiteAuthMode,
  type SiteAuthOpenDetail,
} from "./auth/siteAuthEvents";
import FittingAuthModal from "./components/fitting/FittingAuthModal";
import type { AuthUser } from "./components/fitting/types";
import AnimatedRouteViewport from "./routes/AnimatedRouteViewport";
import RoutePreloader from "./routes/RoutePreloader";
import { routeLoaders } from "./routes/routeLoaders";

import agentFinderIconRaw from "./assets/icons/agentfinder.svg?raw";
import attributesIconRaw from "./assets/icons/attributes.svg?raw";
import augmentationsIconRaw from "./assets/icons/augmentations.svg?raw";
import biographyIconRaw from "./assets/icons/biography.svg?raw";
import bountyOfficeIconRaw from "./assets/icons/bountyoffice.svg?raw";
import calendarIconRaw from "./assets/icons/calendar.svg?raw";
import capitalNavigationIconRaw from "./assets/icons/capitalnavigation.svg?raw";
import cargoContainerIconRaw from "./assets/icons/cargocontainer.svg?raw";
import cargoContainerLockedIconRaw from "./assets/icons/cargocontainerlocked.svg?raw";
import chatChannelsIconRaw from "./assets/icons/chatchannels.svg?raw";
import compareToolIconRaw from "./assets/icons/comparetool.svg?raw";
import contractAuctionIconRaw from "./assets/icons/contractauction.svg?raw";
import corpMapIconRaw from "./assets/icons/corpmap.svg?raw";
import fittingIconRaw from "./assets/icons/fitting.svg?raw";
import folderCargoIconRaw from "./assets/icons/folder_cargo.svg?raw";
import industryIconRaw from "./assets/icons/industry.svg?raw";
import insuranceIconRaw from "./assets/icons/insurance.svg?raw";
import journalIconRaw from "./assets/icons/journal.svg?raw";
import jumpClonesIconRaw from "./assets/icons/jumpclones.svg?raw";
import killRightsIconRaw from "./assets/icons/killrights.svg?raw";
import marketIconRaw from "./assets/icons/market.svg?raw";
import officesIconRaw from "./assets/icons/offices.svg?raw";
import otherIconRaw from "./assets/icons/other.svg?raw";
import personalStandingsIconRaw from "./assets/icons/personalstandings.svg?raw";
import planetsIconRaw from "./assets/icons/planets.svg?raw";
import recruitmentIconRaw from "./assets/icons/recruitment.svg?raw";
import reprocessingIconRaw from "./assets/icons/reprocessing.svg?raw";
import sanctionableActionsIconRaw from "./assets/icons/sanctionableactions.svg?raw";
import walletIconRaw from "./assets/icons/wallet.svg?raw";
import warReportIconRaw from "./assets/icons/warreport.svg?raw";

import Landing from "./pages/Landing";

type Item = {
  to: string;
  label: string;
  Icon?: EveUiIconDef;
  iconSrc?: string;
};

type EveUiIconDef = {
  markup: string;
};

const Desktop = lazy(routeLoaders.desktop);
const GasCalc = lazy(routeLoaders.gasCalc);
const BlootCalc = lazy(routeLoaders.blootCalc);
const PiCalc = lazy(routeLoaders.piCalc);
const RollingMass = lazy(routeLoaders.rollingMass);
const WormholeSites = lazy(routeLoaders.wormholeSites);
const Changelog = lazy(routeLoaders.changelog);
const OreCalculator = lazy(routeLoaders.oreCalculator);
const TimestampTool = lazy(routeLoaders.timestampTool);
const WormholeDatabase = lazy(routeLoaders.wormholeDatabase);
const WormholeStructureStats = lazy(routeLoaders.wormholeStructureStats);
const ReactionCalc = lazy(routeLoaders.reactionCalc);
const ParticipationCalc = lazy(routeLoaders.participationCalc);
const Appraisals = lazy(routeLoaders.appraisals);
const AppraisalView = lazy(routeLoaders.appraisalView);
const Account = lazy(routeLoaders.account);
const Statuses = lazy(routeLoaders.statuses);
const Industry = lazy(routeLoaders.industry);
const ContactPage = lazy(routeLoaders.contact);
const PrivacyPolicy = lazy(routeLoaders.privacy);
const TermsOfUse = lazy(routeLoaders.terms);
const CompressedOrePlanner = lazy(routeLoaders.compressedOrePlanner);
const Michael = lazy(routeLoaders.michael);
const Hokkar = lazy(routeLoaders.hokkar);
const Busa = lazy(routeLoaders.busa);
const Triff = lazy(routeLoaders.triff);
const MarketBrowser = lazy(routeLoaders.marketBrowser);
const HullActivity = lazy(routeLoaders.hullActivity);
const ItemBrowser = lazy(routeLoaders.itemBrowser);
const ItemDetail = lazy(routeLoaders.itemDetail);
const Fitting = lazy(routeLoaders.fitting);
const ManufacturingPlanner = lazy(routeLoaders.manufacturingPlanner);
const StructureAge = lazy(routeLoaders.structureAge);
const Secret = lazy(routeLoaders.secret);
const Loki = lazy(routeLoaders.loki);
const POSPlanner = lazy(routeLoaders.posPlanner);
const RoachFits = lazy(routeLoaders.roachFits);
const BattleReports = lazy(routeLoaders.battleReports);
const CombatLogs = lazy(routeLoaders.combatLogs);
const DScan = lazy(routeLoaders.dScan);
const TriffLocalReport = lazy(routeLoaders.triffLocalReport);
const Skillnix = lazy(routeLoaders.skillnix);

function LegacyTriffMonRedirect() {
  const location = useLocation();
  const suffix = location.pathname.replace(/^\/triffmon/i, "");
  return <Navigate replace to={`/skillnix${suffix}${location.search}${location.hash}`} />;
}

function makeEveUiIcon(svg: string): EveUiIconDef {
  return {
    markup: svg.replace(/^\s*<symbol\b[^>]*>/, "").replace(/<\/symbol>\s*$/, ""),
  };
}

function EveUiIcon({
  icon,
  className = "h-5 w-5",
}: {
  icon: EveUiIconDef;
  className?: string;
}) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 128 128"
      className={`inline-block shrink-0 ${className}`}
    >
      <style>{".shape{fill:currentColor}"}</style>
      <g dangerouslySetInnerHTML={{ __html: icon.markup }} />
    </svg>
  );
}

const EVE_ICONS = {
  agentFinder: makeEveUiIcon(agentFinderIconRaw),
  attributes: makeEveUiIcon(attributesIconRaw),
  augmentations: makeEveUiIcon(augmentationsIconRaw),
  biography: makeEveUiIcon(biographyIconRaw),
  bountyOffice: makeEveUiIcon(bountyOfficeIconRaw),
  calendar: makeEveUiIcon(calendarIconRaw),
  capitalNavigation: makeEveUiIcon(capitalNavigationIconRaw),
  cargoContainer: makeEveUiIcon(cargoContainerIconRaw),
  cargoContainerLocked: makeEveUiIcon(cargoContainerLockedIconRaw),
  chatChannels: makeEveUiIcon(chatChannelsIconRaw),
  compareTool: makeEveUiIcon(compareToolIconRaw),
  contractAuction: makeEveUiIcon(contractAuctionIconRaw),
  corpMap: makeEveUiIcon(corpMapIconRaw),
  fitting: makeEveUiIcon(fittingIconRaw),
  folderCargo: makeEveUiIcon(folderCargoIconRaw),
  industry: makeEveUiIcon(industryIconRaw),
  insurance: makeEveUiIcon(insuranceIconRaw),
  journal: makeEveUiIcon(journalIconRaw),
  jumpClones: makeEveUiIcon(jumpClonesIconRaw),
  killRights: makeEveUiIcon(killRightsIconRaw),
  market: makeEveUiIcon(marketIconRaw),
  offices: makeEveUiIcon(officesIconRaw),
  other: makeEveUiIcon(otherIconRaw),
  personalStandings: makeEveUiIcon(personalStandingsIconRaw),
  planets: makeEveUiIcon(planetsIconRaw),
  recruitment: makeEveUiIcon(recruitmentIconRaw),
  reprocessing: makeEveUiIcon(reprocessingIconRaw),
  sanctionableActions: makeEveUiIcon(sanctionableActionsIconRaw),
  wallet: makeEveUiIcon(walletIconRaw),
  warReport: makeEveUiIcon(warReportIconRaw),
};


const CALCULATORS: Item[] = [
  { to: "/gas-calc", label: "Gas Huffing ISK/h", Icon: EVE_ICONS.cargoContainer },
  { to: "/ore", label: "Ore Mining ISK/h", Icon: EVE_ICONS.cargoContainerLocked },
  { to: "/compressed", label: "Ore Reprocessing Calculator", Icon: EVE_ICONS.reprocessing },
  { to: "/appraisals", label: "ISKtimate", Icon: EVE_ICONS.wallet },
  { to: "/industry", label: "Industry Cost Calculator", Icon: EVE_ICONS.industry },
  { to: "/schedule", label: "BPC Copy Planner", Icon: EVE_ICONS.other },
  { to: "/reaction-calc", label: "Reactions Calculator", Icon: EVE_ICONS.attributes },
  { to: "/pi-calc", label: "PI Profitability Calculator", Icon: EVE_ICONS.planets },
  { to: "/bloot", label: "Ratting Split Calculator", Icon: EVE_ICONS.personalStandings },
  { to: "/participation", label: "Participation Calculator", Icon: EVE_ICONS.recruitment },
  { to: "/POSPlanner", label: "POS Planner", Icon: EVE_ICONS.offices },
];

const REFERENCE: Item[] = [
  { to: "/roachfits", label: "C5 Ratting Fits", Icon: EVE_ICONS.insurance },
  { to: "/market", label: "Market Browser", Icon: EVE_ICONS.market },
  { to: "/wormhole-sites", label: "Wormhole PvE Sites", Icon: EVE_ICONS.killRights },
  { to: "/rolling-mass", label: "Rolling Mass", Icon: EVE_ICONS.compareTool },
  { to: "/wormholes", label: "Wormhole Database", Icon: EVE_ICONS.corpMap },
  { to: "/holeintel", label: "Structure Age Calculator", Icon: EVE_ICONS.agentFinder },
  { to: "/evictions", label: "Eviction Stats", Icon: EVE_ICONS.warReport },
  { to: "/dscan", label: "D-Scan Intel", Icon: EVE_ICONS.biography },
  { to: "/triff-local", label: "Local intel", Icon: EVE_ICONS.bountyOffice },
  { to: "/combat-logs", label: "Combat Log Parser", Icon: EVE_ICONS.folderCargo },
  { to: "/br", label: "BattleReport Generator", Icon: EVE_ICONS.sanctionableActions },
];

const META: Item[] = [
  { to: "/fitting", label: "Fitting Tool", Icon: EVE_ICONS.fitting },
  { to: "/timestamp", label: "Time Converter", Icon: EVE_ICONS.calendar },
  { to: "/desktop", label: "Desktop", Icon: EVE_ICONS.other },
  { to: "/contact", label: "Contact Me", Icon: EVE_ICONS.chatChannels },
  { to: "/changelog", label: "Changelog", Icon: EVE_ICONS.contractAuction },
  { to: "/statuses", label: "Status", Icon: EVE_ICONS.folderCargo },
  { to: "/api/docs", label: "API Docs", Icon: EVE_ICONS.augmentations },
  { to: "/items", label: "Item Browser", Icon: EVE_ICONS.journal },
];

const UI_SCALE_PRESETS = [
  { id: "normal", label: "Normal", value: 1 },
  { id: "slight", label: "Slightly larger", value: 1.1 },
  { id: "much", label: "Much larger", value: 1.25 },
  { id: "derz", label: "Derz (retirement age)", value: 1.5 },
] as const;

async function readAuthJson<T>(response: Response): Promise<T> {
  let data: any = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }
  if (!response.ok) {
    throw new Error(data?.error || data?.message || `Request failed (${response.status})`);
  }
  return data as T;
}

export default function App() {
  const [isOpen, setIsOpen] = useState(false);
  const [playersOnline, setPlayersOnline] = useState<number | null>(null);
  const location = useLocation();
  const isSecretRoute = location.pathname.replace(/\/+$/, "").toLowerCase() === "/secret";
  const isAdminReplay = location.pathname.replace(/\/+$/, "").toLowerCase() === "/holeintel"
    && new URLSearchParams(location.search).has("adminReplay");
  const lastTrackedPage = useRef<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authModalMode, setAuthModalMode] = useState<SiteAuthMode>("login");
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [analyticsConsent, setAnalyticsConsent] = useState<AnalyticsConsent | null>(() =>
    readAnalyticsConsent()
  );
  const [analyticsBannerOpen, setAnalyticsBannerOpen] = useState(() => readAnalyticsConsent() === null);

  const [uiScale, setUiScale] = useState<number>(() => {
    if (typeof window === "undefined") return 1;
    const stored = window.localStorage.getItem("tt-ui-scale");
    const parsed = stored ? parseFloat(stored) : NaN;
    return !Number.isNaN(parsed) && parsed > 0 ? parsed : 1;
  });

  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.style.setProperty(
      "--tt-ui-scale",
      uiScale.toString()
    );
    window.localStorage.setItem("tt-ui-scale", String(uiScale));
  }, [uiScale]);

  useEffect(() => {
    if (isSecretRoute) {
      setPlayersOnline(null);
      return;
    }
    let alive = true;

    const fetchPlayers = async () => {
      try {
        const res = await fetch(
          "https://esi.evetech.net/latest/status/?datasource=tranquility",
          { cache: "no-store" }
        );
        if (!res.ok) throw new Error(`ESI ${res.status}`);
        const data = await res.json();

        const val =
          data && typeof data.players === "number" ? data.players : null;

        if (alive) setPlayersOnline(val);
      } catch {
        if (alive) setPlayersOnline(null);
      }
    };

    fetchPlayers();
    const interval = setInterval(fetchPlayers, 60_000);
    return () => {
      alive = false;
      clearInterval(interval);
    };
  }, [isSecretRoute]);

  useEffect(() => setIsOpen(false), [location.pathname]);

  useEffect(() => {
    const seo = applySeo(location.pathname);
    if (isSecretRoute || isAdminReplay) return;
    const pageKey = `${location.pathname}${location.search}`;
    if (lastTrackedPage.current !== pageKey) {
      if (trackPageView(seo)) {
        lastTrackedPage.current = pageKey;
      }
    }
  }, [analyticsConsent, isAdminReplay, isSecretRoute, location.pathname, location.search]);

  useEffect(() => {
    if (!isSecretRoute && !isAdminReplay && analyticsConsent === "granted") {
      loadGoogleAnalytics();
    }
  }, [analyticsConsent, isAdminReplay, isSecretRoute]);

  const onKey = useCallback((e: KeyboardEvent) => {
    if (e.key === "Escape") {
      setIsOpen(false);
      setSettingsOpen(false);
    }
  }, []);

  useEffect(() => {
    if (!isOpen && !settingsOpen) return;
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, settingsOpen, onKey]);

  useEffect(() => {
    if (isSecretRoute) {
      setAuthUser(null);
      setAuthChecked(false);
      return;
    }
    let alive = true;

    async function loadAuth() {
      try {
        const response = await fetch("/api/auth/me", { credentials: "include" });
        const data = await readAuthJson<{ ok: boolean; authenticated: boolean; user: AuthUser | null }>(response);
        if (alive) setAuthUser(data.authenticated ? data.user : null);
      } catch {
        if (alive) setAuthUser(null);
      } finally {
        if (alive) setAuthChecked(true);
      }
    }

    function handleAuthChanged(event: Event) {
      const detail = (event as CustomEvent<SiteAuthChangeDetail>).detail;
      if (detail && "user" in detail) {
        setAuthUser(detail.user);
        setAuthChecked(true);
      } else {
        void loadAuth();
      }
    }

    function handleAuthOpen(event: Event) {
      const detail = (event as CustomEvent<SiteAuthOpenDetail>).detail;
      setAuthModalMode(detail?.mode || "login");
      setAuthError(null);
      setAuthModalOpen(true);
    }

    void loadAuth();
    window.addEventListener(SITE_AUTH_CHANGED_EVENT, handleAuthChanged);
    window.addEventListener(SITE_AUTH_OPEN_EVENT, handleAuthOpen);
    return () => {
      alive = false;
      window.removeEventListener(SITE_AUTH_CHANGED_EVENT, handleAuthChanged);
      window.removeEventListener(SITE_AUTH_OPEN_EVENT, handleAuthOpen);
    };
  }, [isSecretRoute]);

  async function authLogin(username: string, password: string) {
    setAuthBusy(true);
    setAuthError(null);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await readAuthJson<{ ok: boolean; authenticated: boolean; user: AuthUser }>(response);
      setAuthUser(data.user);
      setAuthModalOpen(false);
      notifySiteAuthChanged(data.user);
      return data.user;
    } catch (err) {
      setAuthError((err as Error).message || "Login failed.");
      return null;
    } finally {
      setAuthBusy(false);
    }
  }

  async function authRegister(username: string, password: string) {
    setAuthBusy(true);
    setAuthError(null);
    try {
      const response = await fetch("/api/auth/register", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await readAuthJson<{ ok: boolean; authenticated: boolean; user: AuthUser }>(response);
      setAuthUser(data.user);
      setAuthModalOpen(false);
      notifySiteAuthChanged(data.user);
      return data.user;
    } catch (err) {
      setAuthError((err as Error).message || "Registration failed.");
      return null;
    } finally {
      setAuthBusy(false);
    }
  }

  async function logout() {
    await fetch("/api/auth/logout", {
      method: "POST",
      credentials: "include",
    }).catch(() => undefined);
    setAuthUser(null);
    notifySiteAuthChanged(null);
  }

  function chooseAnalyticsConsent(consent: AnalyticsConsent) {
    saveAnalyticsConsent(consent);
    setAnalyticsConsent(consent);
    setAnalyticsBannerOpen(false);
  }

  if (isSecretRoute) {
    return (
      <div className="min-h-screen bg-[#03050a] text-slate-100">
        <Suspense
          fallback={(
            <div className="fixed inset-0 grid min-h-screen place-items-center bg-[#03050a] px-4">
              <input
                type="password"
                aria-label="Password"
                placeholder="Checking…"
                disabled
                className="h-10 w-full max-w-[320px] cursor-wait border border-[#353943] bg-[#080b11] px-3 font-mono text-[13px] text-slate-100 opacity-70 outline-none placeholder:text-slate-600"
              />
            </div>
          )}
        >
          <Routes location={location}>
            <Route path="/secret" element={<Secret />} />
          </Routes>
        </Suspense>
      </div>
    );
  }

  const accountNav: Item[] = [
    {
      to: "/account",
      label: authUser ? "Account Home" : "Sign In / Account",
      Icon: EVE_ICONS.personalStandings,
    },
  ];
  const Section = ({ title, items }: { title: string; items: Item[] }) => (
    <div className="border-t border-[#2b2d36] pt-2 first:border-t-0 first:pt-0">
      <div className="px-2 pb-1 text-[10px] uppercase tracking-[0.18em] text-slate-500">
        {title}
      </div>
      <nav className="space-y-[2px]">
        {items.map(({ to, label, Icon, iconSrc }) => {
          const isApi = to.startsWith("/api/");
          const cleanTo = to.replace(/\/$/, "");
          const active =
            !isApi &&
            (location.pathname === cleanTo || location.pathname.startsWith(`${cleanTo}/`));

          const classes = [
            "group flex items-center gap-2 px-2.5 py-1.5 text-[11px]",
            "border border-transparent",
            active
              ? "bg-[#14161d] border-[#3a3c40] text-slate-100"
              : "text-slate-300 hover:bg-[#101219] hover:border-[#262933]",
            "transition-colors duration-150 cursor-pointer",
          ].join(" ");

          const iconClass = [
            "h-5 w-5",
            active
              ? "text-slate-100"
              : "text-slate-500 group-hover:text-slate-200",
          ].join(" ");

          return (
            <Link
              key={cleanTo}
              to={cleanTo}
              reloadDocument={isApi}
              className={classes}
            >
              {iconSrc ? (
                <img
                  src={iconSrc}
                  alt=""
                  className={`${iconClass} object-contain`}
                  aria-hidden="true"
                />
              ) : Icon ? (
                <EveUiIcon icon={Icon} className={iconClass} />
              ) : null}
              <span className="truncate">{label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );

  return (
    <div className="relative min-h-screen text-white font-sans">
      <RoutePreloader drawerOpen={isOpen} />
      <header className="sticky top-0 z-50 border-b border-[#3a3c40] bg-[#05070b]/98 shadow-[0_0_24px_rgba(0,0,0,0.9)]">
        <div className="bg-gradient-to-r from-[#111319] via-[#171920] to-[#242833] border-b border-[#3a3c40]">
          <div className="mx-auto grid h-12 max-w-7xl grid-cols-[auto,1fr,auto] items-center px-3">
            <div className="flex items-center gap-3">
              <Link
                to="/"
                className="uppercase tracking-[0.22em] text-[12px] text-slate-200 hover:text-white transition-colors"
              >
                Triff.Tools
              </Link>

              <div className="relative">
                <button
                  className="flex h-7 w-7 items-center justify-center border border-[#3a3c40] bg-[#05070b] text-[11px] text-slate-200 hover:bg-[#090c13] hover:text-white focus:outline-none focus-visible:ring-1 focus-visible:ring-[#53b6ff]"
                  aria-label="UI scale settings"
                  onClick={() => setSettingsOpen((v) => !v)}
                >
                  <Settings size={15} />
                </button>

                {settingsOpen && (
                  <div className="absolute left-0 z-[70] mt-1 min-w-[220px] rounded-sm border border-[#3a3c40] bg-[#05070b] p-1 shadow-[0_0_18px_rgba(0,0,0,0.9)]">
                    <div className="px-2 py-1 text-[10px] uppercase tracking-[0.18em] text-slate-500">
                      UI Scale
                    </div>
                    {UI_SCALE_PRESETS.map((preset) => (
                      <button
                        key={preset.id}
                        className={`flex w-full items-center justify-between px-2 py-1.5 text-[11px] text-slate-200 hover:bg-[#111319] ${
                          uiScale === preset.value ? "bg-[#14161d]" : ""
                        }`}
                        onClick={() => {
                          setUiScale(preset.value);
                          setSettingsOpen(false);
                        }}
                      >
                        <span>{preset.label}</span>
                        {uiScale === preset.value && (
                          <span className="text-[10px] text-[#53b6ff]">●</span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <button
                type="button"
                className="hidden md:inline-flex items-center rounded-sm border border-[#3a3c40] bg-[#05070b] px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] text-slate-300 hover:bg-[#111319] hover:border-[#53b6ff]/60 hover:text-[#e3f4ff]"
                onClick={() => setSettingsOpen(true)}
              >
                <span className="mr-1">←</span>
                <span>Text too small?</span>
              </button>
            </div>

            <div className="flex items-center justify-center text-[11px] font-mono text-slate-400">
              <span className="mr-1 text-slate-500">TQ:</span>
              <span className="text-[#53b6ff]">
                {typeof playersOnline === "number"
                  ? `${playersOnline.toLocaleString()} online`
                  : "ESI: reconnecting…"}
              </span>
            </div>

            <div className="flex items-center justify-end gap-2">
              {authUser ? (
                <div className="flex h-7 max-w-[170px] items-center border border-[#3a3c40] bg-[#05070b] text-[10px] uppercase tracking-[0.14em] text-slate-300">
                  <Link
                    to="/account"
                    className="hidden min-w-0 items-center gap-1 px-2 sm:flex"
                    title={authUser.username}
                  >
                    <User size={12} className="shrink-0 text-[#53b6ff]" />
                    <span className="truncate">{authUser.username}</span>
                  </Link>
                  <button
                    type="button"
                    className="flex h-full items-center justify-center gap-1 px-2 text-slate-400 hover:bg-[#090c13] hover:text-slate-100 focus:outline-none focus-visible:ring-1 focus-visible:ring-[#53b6ff]"
                    onClick={() => void logout()}
                    aria-label="Sign out"
                    title={`Sign out ${authUser.username}`}
                  >
                    <LogOut size={13} />
                    <span className="hidden md:inline">Logout</span>
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  className="flex h-7 items-center gap-1 border border-[#3a3c40] bg-[#05070b] px-2 text-[10px] uppercase tracking-[0.14em] text-slate-300 hover:bg-[#090c13] hover:text-slate-100 focus:outline-none focus-visible:ring-1 focus-visible:ring-[#53b6ff]"
                  onClick={() => {
                    setAuthError(null);
                    setAuthModalMode("login");
                    setAuthModalOpen(true);
                  }}
                >
                  <User size={13} />
                  <span className="hidden sm:inline">{authChecked ? "Sign in" : "Checking"}</span>
                </button>
              )}
              <button
                className={`flex h-7 w-7 items-center justify-center border border-[#3a3c40] bg-[#05070b] text-slate-200 hover:bg-[#090c13] hover:text-white focus:outline-none focus-visible:ring-1 focus-visible:ring-[#53b6ff] transition ${
                  isOpen ? "opacity-0 pointer-events-none" : ""
                }`}
                onClick={() => setIsOpen((v) => !v)}
                aria-label="Toggle navigation"
              >
                <Menu size={17} />
              </button>
            </div>
          </div>
        </div>
      </header>

      <aside
        className={[
          "fixed inset-y-0 right-0 z-[60]",
          "w-80 sm:w-96 bg-[#05070b]/98",
          "border-l border-[#3a3c40] transition-transform duration-300 ease-in-out",
          isOpen ? "translate-x-0" : "translate-x-full",
        ].join(" ")}
        role="dialog"
        aria-modal="true"
      >
        <div
          aria-hidden
          className="absolute -left-px top-0 h-full w-px bg-gradient-to-b from-transparent via-[#53b6ff]/40 to-transparent"
        />

        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between h-8 px-2 bg-gradient-to-r from-[#111319] via-[#171920] to-[#242833] border-b border-[#3a3c40]">
            <span className="uppercase tracking-[0.18em] text-[10px] text-slate-300">
              Neocom ▸ Navigate
            </span>
            <button
              className="flex items-center justify-center h-5 w-5 border border-[#3a3c40] bg-[#05070b] hover:bg-[#090c13] text-slate-200 hover:text-white text-[10px]"
              onClick={() => setIsOpen(false)}
              aria-label="Close menu"
            >
              <X size={14} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-2 py-3 bg-[#05070b] space-y-3">
            <Section title="Account" items={accountNav} />
            <Section title="Calculators" items={CALCULATORS} />
            <Section title="Reference" items={REFERENCE} />
            <Section title="Meta" items={META} />
          </div>

          <div className="border-t border-[#262933] bg-[#05070b] px-2 py-2 text-[10px] text-slate-500">
            <div className="flex items-center justify-between">
              <span>Triff.Tools</span>
              <span className="text-slate-600">3.14.0</span>
            </div>
          </div>
        </div>
      </aside>

      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/70"
          onClick={() => setIsOpen(false)}
        />
      )}

      <FittingAuthModal
        open={authModalOpen}
        busy={authBusy}
        error={authError}
        initialMode={authModalMode}
        onClose={() => setAuthModalOpen(false)}
        onLogin={authLogin}
        onRegister={authRegister}
      />

      {analyticsBannerOpen && (
        <div className="fixed inset-x-0 bottom-0 z-[80] border-t border-[#3a3c40] bg-[#05070b] px-3 py-3 shadow-[0_-10px_28px_rgba(0,0,0,0.85)]">
          <div className="mx-auto flex max-w-7xl flex-col items-center justify-center gap-3 text-center text-[11px] text-slate-300 sm:flex-row">
            <div className="leading-relaxed sm:text-left">
              <span className="font-semibold text-slate-100">Triff.Tools uses Google Analytics</span>{" "}
              to understand site traffic.
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="border border-[#53b6ff]/70 bg-[#0b2233] px-3 py-1.5 text-[10px] uppercase tracking-[0.14em] text-[#dff5ff] shadow-[0_0_14px_rgba(83,182,255,0.18)] hover:bg-[#12364f] focus:outline-none focus-visible:ring-1 focus-visible:ring-[#53b6ff]"
                onClick={() => chooseAnalyticsConsent("granted")}
              >
                Allow
              </button>
              <button
                type="button"
                className="border border-[#3a3c40] bg-[#05070b] px-3 py-1.5 text-[10px] uppercase tracking-[0.14em] text-slate-300 hover:border-[#7b2f2f] hover:bg-[#180b0b] hover:text-slate-100 focus:outline-none focus-visible:ring-1 focus-visible:ring-[#53b6ff]"
                onClick={() => chooseAnalyticsConsent("denied")}
              >
                Decline
              </button>
            </div>
          </div>
        </div>
      )}

      <main className="flex-grow">
        <AnimatedRouteViewport location={location}>
          <Routes location={location}>
          <Route path="/desktop" element={<Desktop />} />
          <Route path="/" element={<Landing />} />
          <Route path="/gas-calc" element={<GasCalc />} />
          <Route path="/bloot" element={<BlootCalc />} />
          <Route path="/pi-calc" element={<PiCalc />} />
          <Route path="/rolling-mass" element={<RollingMass />} />
          <Route path="/wormhole-sites" element={<WormholeSites />} />
          <Route path="/changelog" element={<Changelog />} />
          <Route path="/ore" element={<OreCalculator />} />
          <Route path="/timestamp" element={<TimestampTool />} />
          <Route path="/wormholes" element={<WormholeDatabase />} />
          <Route path="/evictions" element={<WormholeStructureStats />} />
          <Route path="/reaction-calc" element={<ReactionCalc />} />
          <Route path="/participation" element={<ParticipationCalc />} />
          <Route path="/appraisals" element={<Appraisals />} />
          <Route path="/appraisals/:id" element={<AppraisalView />} />
          <Route path="/account" element={<Account authUser={authUser} authChecked={authChecked} />} />
          <Route path="/statuses" element={<Statuses />} />
          <Route path="/industry" element={<Industry />} />
          <Route path="/contact" element={<ContactPage />} />
          <Route path="/privacy" element={<PrivacyPolicy />} />
          <Route path="/terms" element={<TermsOfUse />} />
          <Route path="/compressed" element={<CompressedOrePlanner />} />
          <Route path="/michael" element={<Michael />} />
          <Route path="/hokkar" element={<Hokkar />} />
          <Route path="/busa" element={<Busa />} />
          <Route path="/triff" element={<Triff />} />
          <Route path="/market" element={<MarketBrowser />} />
          <Route path="/hulls" element={<HullActivity />} />
          <Route path="/dscan" element={<DScan />} />
          <Route path="/dscan/:id" element={<DScan />} />
          <Route path="/items" element={<ItemBrowser />} />
          <Route path="/items/:typeID" element={<ItemDetail />} />
          <Route path="/fitting" element={<Fitting />} />
          <Route path="/fitting/fit/:sharedFitId" element={<Fitting />} />
          <Route path="/schedule" element={<ManufacturingPlanner />} />
          <Route path="/holeintel" element={<StructureAge />} />
          <Route path="/secret" element={<Secret />} />
          <Route path="/loki" element={<Loki />} />
          <Route path="/POSPlanner" element={<POSPlanner />} />
          <Route path="/RoachFits" element={<RoachFits />} />
          <Route path="/br" element={<BattleReports />} />
          <Route path="/br/:id" element={<BattleReports />} />
          <Route path="/combat-logs" element={<CombatLogs />} />
          <Route path="/combat-logs/:id" element={<CombatLogs />} />
          <Route path="/triff-local" element={<TriffLocalReport />} />
          <Route path="/triff-local/:id" element={<TriffLocalReport />} />
          <Route path="/skillnix" element={<Skillnix />} />
          <Route path="/skillnix/*" element={<Skillnix />} />
          <Route path="/triffmon" element={<LegacyTriffMonRedirect />} />
          <Route path="/triffmon/*" element={<LegacyTriffMonRedirect />} />
          </Routes>
        </AnimatedRouteViewport>
      </main>
    </div>
  );
}
