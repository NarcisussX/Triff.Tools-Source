import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link2, RefreshCw } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { ToolButton, ToolFrame, ToolNotice, ToolTabs } from "../components/tool-ui";
import { CharacterView } from "../features/triffmon/CharacterView";
import { Dashboard } from "../features/triffmon/Dashboard";
import { PlansView } from "../features/triffmon/PlansView";
import { RequirementsView } from "../features/triffmon/RequirementsView";
import { parseTriffMonRequiredSkills } from "../features/triffmon/fitIntegration";
import {
  TriffMonApiError,
  addPlanEntry,
  esiLoginUrl,
  getCatalog,
  getCharacterSnapshot,
  getCharacters,
  getPlans,
  syncCharacter,
  unlinkCharacter,
  updateCharacterPreferences,
} from "../features/triffmon/api";
import type {
  CharacterPreference,
  CharacterSnapshot,
  SkillPlan,
  TriffMonCatalog,
  TriffMonCharacter,
} from "../features/triffmon/types";
import { useNow } from "../features/triffmon/useNow";
import { apiErrorMessage, characterPath, liveQueueHealth, monitorCharacterId, parseTriffMonRoute, planPath } from "../features/triffmon/utils";

const EMPTY_CATALOG: TriffMonCatalog = { skills: [], skillGroups: [], requirementTargets: [] };

type RootTab = "monitor" | "plans" | "requirements";

function activeRootTab(view: ReturnType<typeof parseTriffMonRoute>["view"]): RootTab {
  if (view === "plans") return "plans";
  if (view === "requirements") return "requirements";
  return "monitor";
}

function routeContext(route: ReturnType<typeof parseTriffMonRoute>, characters: TriffMonCharacter[], plans: SkillPlan[]): string {
  if (route.view === "character") {
    const character = characters.find((item) => monitorCharacterId(item) === route.characterId);
    return `${character?.name ?? "Character"} › ${route.tab === "queue" ? "Training Queue" : "Skills"}`;
  }
  if (route.view === "plans") {
    const plan = route.planId ? plans.find((item) => item.id === route.planId) : null;
    return plan ? `Skill Plans › ${plan.name}` : "Skill Plans";
  }
  if (route.view === "requirements") return "Ship & Fit Requirements";
  return "Multi-character Monitor";
}

export default function Skillnix() {
  const location = useLocation();
  const navigate = useNavigate();
  const route = useMemo(() => parseTriffMonRoute(location.pathname), [location.pathname]);
  const now = useNow();
  const [characters, setCharacters] = useState<TriffMonCharacter[]>([]);
  const [plans, setPlans] = useState<SkillPlan[]>([]);
  const [catalog, setCatalog] = useState<TriffMonCatalog>(EMPTY_CATALOG);
  const [snapshot, setSnapshot] = useState<CharacterSnapshot | null>(null);
  const [loadingCharacters, setLoadingCharacters] = useState(true);
  const [loadingPlans, setLoadingPlans] = useState(true);
  const [loadingSnapshot, setLoadingSnapshot] = useState(false);
  const [busyCharacterId, setBusyCharacterId] = useState<string | null>(null);
  const [charactersError, setCharactersError] = useState<string | null>(null);
  const [plansError, setPlansError] = useState<string | null>(null);
  const [snapshotError, setSnapshotError] = useState<string | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [authRequired, setAuthRequired] = useState(false);
  const [linkFeedback, setLinkFeedback] = useState<{ tone: "success" | "danger"; message: string } | null>(null);
  const linkPopup = useRef<Window | null>(null);
  const automaticRefreshAttempts = useRef(0);

  const reloadCharacters = useCallback(async () => {
    setLoadingCharacters(true);
    setCharactersError(null);
    try {
      const loaded = await getCharacters();
      setCharacters(loaded);
      setAuthRequired(false);
    } catch (error) {
      setCharactersError(apiErrorMessage(error));
      setAuthRequired(error instanceof TriffMonApiError && (error.status === 401 || error.status === 403));
    } finally {
      setLoadingCharacters(false);
    }
  }, []);

  const reloadPlans = useCallback(async () => {
    setLoadingPlans(true);
    setPlansError(null);
    try {
      setPlans(await getPlans());
    } catch (error) {
      setPlansError(apiErrorMessage(error));
    } finally {
      setLoadingPlans(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setLoadingCharacters(true);
    setLoadingPlans(true);
    setCharactersError(null);
    setPlansError(null);
    setCatalogError(null);
    void Promise.allSettled([
      getCharacters(controller.signal).then((loaded) => { setCharacters(loaded); setAuthRequired(false); }).catch((error) => {
        if (controller.signal.aborted) return;
        setCharactersError(apiErrorMessage(error));
        setAuthRequired(error instanceof TriffMonApiError && (error.status === 401 || error.status === 403));
      }).finally(() => { if (!controller.signal.aborted) setLoadingCharacters(false); }),
      getPlans(controller.signal).then(setPlans).catch((error) => { if (!controller.signal.aborted) setPlansError(apiErrorMessage(error)); }).finally(() => { if (!controller.signal.aborted) setLoadingPlans(false); }),
      getCatalog(controller.signal).then(setCatalog).catch((error) => { if (!controller.signal.aborted) setCatalogError(apiErrorMessage(error)); }),
    ]);
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (route.view !== "character") {
      setSnapshot(null);
      setSnapshotError(null);
      setLoadingSnapshot(false);
      return;
    }
    const controller = new AbortController();
    setLoadingSnapshot(true);
    setSnapshotError(null);
    setSnapshot(null);
    void getCharacterSnapshot(route.characterId, controller.signal).then(setSnapshot).catch((error) => {
      if (controller.signal.aborted) return;
      setSnapshotError(apiErrorMessage(error));
    }).finally(() => {
      if (!controller.signal.aborted) setLoadingSnapshot(false);
    });
    return () => controller.abort();
  }, [route.view === "character" ? route.characterId : null]);

  useEffect(() => {
    if (loadingCharacters) return;
    const hasRefreshableStaleCharacter = characters.some((character) => (
      character.stale
      && character.missingScopes.length === 0
      && !["reauth_required", "missing_scopes"].includes(character.tokenStatus)
    ));
    if (!hasRefreshableStaleCharacter) {
      automaticRefreshAttempts.current = 0;
      return;
    }
    const delay = automaticRefreshAttempts.current < 4 ? 3_000 : 60_000;
    const timer = window.setTimeout(() => {
      automaticRefreshAttempts.current += 1;
      void reloadCharacters();
    }, delay);
    return () => window.clearTimeout(timer);
  }, [characters, loadingCharacters, reloadCharacters]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      const data = event.data && typeof event.data === "object"
        ? event.data as { type?: unknown; ok?: unknown; characterName?: unknown; message?: unknown }
        : null;
      if (data?.type !== "TRIFF_EVE_SSO_COMPLETE") return;
      linkPopup.current = null;
      if (data.ok === true) {
        const characterName = typeof data.characterName === "string" ? data.characterName.trim().slice(0, 100) : "";
        setLinkFeedback({ tone: "success", message: `Linked EVE character: ${characterName || "character"}.` });
        void reloadCharacters();
        return;
      }
      const callbackMessage = typeof data.message === "string" ? data.message.trim().slice(0, 300) : "";
      setLinkFeedback({ tone: "danger", message: callbackMessage || "EVE SSO linking failed. Please try again." });
    };
    const handleFocus = () => {
      if (linkPopup.current && linkPopup.current.closed) {
        linkPopup.current = null;
        void reloadCharacters();
      }
    };
    window.addEventListener("message", handleMessage);
    window.addEventListener("focus", handleFocus);
    return () => {
      window.removeEventListener("message", handleMessage);
      window.removeEventListener("focus", handleFocus);
    };
  }, [reloadCharacters]);

  const linkCharacter = () => {
    setLinkFeedback(null);
    const returnTo = `${location.pathname}${location.search}`;
    const url = esiLoginUrl(returnTo);
    const popup = window.open(url, "skillnix-esi-link", "popup=yes,width=560,height=760,resizable=yes,scrollbars=yes");
    if (popup) {
      linkPopup.current = popup;
      popup.focus();
    } else {
      window.location.assign(url);
    }
  };

  const setPreference = async (characterId: string, patch: Partial<CharacterPreference>) => {
    const before = characters;
    setCharacters((current) => current.map((character) => monitorCharacterId(character) === characterId ? { ...character, ...patch } : character));
    setCharactersError(null);
    try {
      const updated = await updateCharacterPreferences(characterId, patch);
      if (updated) setCharacters((current) => current.map((character) => monitorCharacterId(character) === characterId ? updated : character));
    } catch (error) {
      setCharacters(before);
      setCharactersError(apiErrorMessage(error));
    }
  };

  const syncOneCharacter = async (characterId: string) => {
    if (busyCharacterId) return;
    setBusyCharacterId(characterId);
    setSnapshotError(null);
    try {
      const refreshed = await syncCharacter(characterId);
      if (refreshed.character) {
        setCharacters((current) => current.map((character) => monitorCharacterId(character) === characterId ? { ...character, ...refreshed.character } : character));
      } else {
        await reloadCharacters();
      }
      if (route.view === "character" && route.characterId === characterId) setSnapshot(refreshed);
    } catch (error) {
      const message = apiErrorMessage(error);
      if (route.view === "character" && route.characterId === characterId) setSnapshotError(message);
      else setCharactersError(message);
    } finally {
      setBusyCharacterId(null);
    }
  };

  const removeCharacter = async (character: TriffMonCharacter) => {
    if (!window.confirm(`Unlink ${character.name}? Saved plans will remain, but Skillnix will stop syncing this character.`)) return;
    setBusyCharacterId(character.id);
    try {
      await unlinkCharacter(monitorCharacterId(character));
      setCharacters((current) => current.filter((item) => item.id !== character.id));
      if (route.view === "character" && (route.characterId === character.id || route.characterId === String(character.characterId))) navigate("/skillnix");
    } catch (error) {
      setCharactersError(apiErrorMessage(error));
      setSnapshotError(apiErrorMessage(error));
    } finally {
      setBusyCharacterId(null);
    }
  };

  const addSkillToPlan = async (planId: string, skillTypeId: number, targetLevel: number, addPrerequisites: boolean) => {
    await addPlanEntry(planId, { skillTypeId, targetLevel, addPrerequisites });
    await reloadPlans();
  };

  const selectedCharacter = route.view === "character"
    ? characters.find((character) => monitorCharacterId(character) === route.characterId) ?? null
    : null;
  const attentionCount = characters.filter((character) => !character.hidden && liveQueueHealth(character, now) !== "healthy").length;
  const requirementTypeId = Number(new URLSearchParams(location.search).get("type_id"));
  const requirementParams = new URLSearchParams(location.search);
  const fitRequiredSkills = parseTriffMonRequiredSkills(requirementParams.get("skills"));
  const requirementLabel = requirementParams.get("label");
  const context = routeContext(route, characters, plans);
  const activeTab = activeRootTab(route.view);

  return (
    <ToolFrame
      section="Characters"
      title="Skillnix"
      subtitle="Skill training, plans, queue health, and readiness across every linked character"
      context={context}
      status={characters.length ? `${characters.length} linked · ${attentionCount} need attention` : "No linked characters"}
      variant="wide"
      actions={<ToolButton size="sm" variant="primary" onClick={linkCharacter}><Link2 className="h-3.5 w-3.5" /><span className="hidden sm:inline">Link character</span><span className="sm:hidden">Link</span></ToolButton>}
    >
      <div className="space-y-2">
        <ToolTabs<RootTab>
          tabs={[{ key: "monitor", label: "Monitor" }, { key: "plans", label: `Plans${plans.length ? ` (${plans.length})` : ""}` }, { key: "requirements", label: "Requirements" }]}
          active={activeTab}
          onChange={(tab) => {
            if (tab === "monitor") navigate("/skillnix");
            if (tab === "plans") navigate(planPath());
            if (tab === "requirements") navigate("/skillnix/requirements");
          }}
        />

        {authRequired ? <ToolNotice tone="warning"><div className="flex flex-wrap items-center justify-between gap-2"><span>Sign in to Triff.Tools, then link one or more EVE characters to use Skillnix.</span><ToolButton size="sm" variant="primary" onClick={linkCharacter}>Link EVE character</ToolButton></div></ToolNotice> : null}
        {linkFeedback ? <ToolNotice tone={linkFeedback.tone}>{linkFeedback.message}</ToolNotice> : null}
        {catalogError ? <ToolNotice tone="warning">Skill catalog unavailable: {catalogError}. Character monitoring can still work, but plan search and type suggestions are limited.</ToolNotice> : null}

        {route.view === "dashboard" ? (
          <Dashboard
            characters={characters}
            now={now}
            loading={loadingCharacters}
            error={charactersError}
            busyCharacterId={busyCharacterId}
            onOpenCharacter={(characterId, tab) => navigate(characterPath(characterId, tab))}
            onPreference={(characterId, patch) => void setPreference(characterId, patch)}
            onSync={(characterId) => void syncOneCharacter(characterId)}
            onUnlink={(character) => void removeCharacter(character)}
            onLink={linkCharacter}
            onReload={() => void reloadCharacters()}
          />
        ) : null}

        {route.view === "character" ? (
          <CharacterView
            character={selectedCharacter}
            snapshot={snapshot}
            plans={plans}
            tab={route.tab}
            now={now}
            loading={loadingSnapshot}
            syncing={busyCharacterId === route.characterId || busyCharacterId === selectedCharacter?.id}
            error={snapshotError}
            onBack={() => navigate("/skillnix")}
            onTab={(tab) => navigate(characterPath(route.characterId, tab))}
            onSync={() => void syncOneCharacter(route.characterId)}
            onUnlink={() => { if (selectedCharacter) void removeCharacter(selectedCharacter); }}
            onAddSkill={addSkillToPlan}
          />
        ) : null}

        {route.view === "plans" ? (
          <PlansView
            planId={route.planId}
            plans={plans}
            characters={characters}
            catalog={catalog}
            loading={loadingPlans}
            error={plansError}
            onOpenPlan={(planId) => navigate(planPath(planId))}
            onPlansChanged={reloadPlans}
          />
        ) : null}

        {route.view === "requirements" ? (
          <RequirementsView
            key={location.search}
            characters={characters}
            plans={plans}
            catalog={catalog}
            initialTypeId={Number.isFinite(requirementTypeId) && requirementTypeId > 0 ? requirementTypeId : null}
            initialRequiredSkills={fitRequiredSkills}
            initialLabel={requirementLabel}
            onPlansChanged={reloadPlans}
          />
        ) : null}
      </div>
    </ToolFrame>
  );
}
