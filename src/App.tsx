import { Suspense, lazy, useEffect, useRef, useState } from "react";
import { AiSettingsForm } from "./components/AiSettingsForm";
import { AvatarDisplay } from "./components/AvatarDisplay";
import { Icon } from "./components/Icon";
import {
  applyDeveloperSettings,
  defaultDeveloperSettings,
  loadDeveloperSettings,
  saveDeveloperSettings,
  type DeveloperSettings,
} from "./config/developerSettings";
import {
  deleteCharacter,
  duplicateCharacter,
  loadCharacters,
  saveCharacters,
  upsertCharacter,
} from "./storage/characterStorage";
import { clearLocalDataPreservingSnapshot } from "./storage/localDataReset";
import type { Page, ThemeMode } from "./types/app";
import type { Character } from "./types/character";
import {
  clearAvatarAssets,
  cleanupUnusedAvatarAssets,
  deleteAvatarAsset,
  exportAvatarAssetsJson,
  formatAssetSize,
  getAvatarAssetStats,
  importAvatarAssetsJson,
  listAvatarAssets,
  type AvatarAssetRecord,
} from "./utils/avatarAssets";
import {
  exportAllCharactersJson,
  exportFullBackupZip,
} from "./utils/importExport";
import { Dashboard } from "./pages/Dashboard";
import {
  DASHBOARD_PREFS_KEY,
  defaultPrefs,
  saveDashboardPrefs,
} from "./storage/dashboardPrefs";
import { pruneCharacterReferences } from "./storage/referenceIntegrity";
import {
  captureDeleteRecovery,
  restoreDeleteRecovery,
  type DeleteRequestResult,
  type RestoreDeleteResult,
} from "./storage/deleteRecovery";
import { readWorkspaceDatasets } from "./storage/workspaceBackup";
import { loadRelationships } from "./storage/relationshipStorage";
import { loadTimeline } from "./storage/timelineStorage";
import { loadWorldEntries } from "./storage/worldStorage";
import { APP_BUILD, APP_SPRINT, APP_VERSION, RELEASE_YEAR } from "./config/version";
import { importWithRecovery } from "./utils/lazyImport";

// The editor, the preview and the developer panel are not needed for the first
// paint, so they are code-split out of the entry chunk. Dashboard stays static:
// it is the landing page, and fetching it through a second round-trip would
// delay first paint more than the smaller entry chunk saves.
//
// Every route goes through importWithRecovery: a page left open across a deploy
// holds the old entry script, and the first route it opens after that would ask for
// a chunk the deploy has already removed.
// `importWithRecovery` is written out at each route rather than wrapped in a helper:
// a helper generic over the props cannot be inferred through `ComponentType`, which
// is a union, so it degrades to `never` and rejects every component that requires
// props. Writing it inline lets `lazy` supply the contextual type.
const CharacterForm = lazy(() =>
  importWithRecovery(() =>
    import("./pages/CharacterForm").then((module) => ({ default: module.CharacterForm })),
  ),
);
const CharacterPreview = lazy(() =>
  importWithRecovery(() =>
    import("./pages/CharacterPreview").then((module) => ({ default: module.CharacterPreview })),
  ),
);
const DeveloperCenter = lazy(() =>
  importWithRecovery(() =>
    import("./pages/DeveloperCenter").then((module) => ({ default: module.DeveloperCenter })),
  ),
);
const RelationshipGraph = lazy(() =>
  importWithRecovery(() =>
    import("./pages/RelationshipGraph").then((module) => ({ default: module.RelationshipGraph })),
  ),
);
const Timeline = lazy(() =>
  importWithRecovery(() =>
    import("./pages/Timeline").then((module) => ({ default: module.Timeline })),
  ),
);
const WorldManager = lazy(() =>
  importWithRecovery(() =>
    import("./pages/WorldManager").then((module) => ({ default: module.WorldManager })),
  ),
);

const THEME_KEY = "character-studio.theme";
const ABOUT_SEEN_KEY = "character-studio.about-seen";

// The app is served from a repository subpath on GitHub Pages, so route URLs are
// derived from the deployment base instead of being hard-coded to "/developer".
const BASE_PATH = import.meta.env.BASE_URL;
const DEVELOPER_PATH = `${BASE_PATH.replace(/\/+$/, "")}/developer`;
const isDeveloperPath = (pathname: string) => pathname.replace(/\/+$/, "") === DEVELOPER_PATH;

// Every screen the app pushes a history entry for has to be listed here, or Back
// quietly lands somewhere else instead of the screen the entry names.
const RESTORABLE_PAGES: readonly Page[] = [
  "dashboard",
  "form",
  "preview",
  "developer",
  "relationships",
  "timeline",
  "world",
];
const isRestorablePage = (value: unknown): value is Page =>
  typeof value === "string" && (RESTORABLE_PAGES as readonly string[]).includes(value);

// What a workspace was opened to show: the graph's character, the timeline's event,
// the world manager's entry. Only the two facts a screen needs to rebuild itself go
// into the history entry — never the record they point at, which the workspace reads
// from storage as it always does.
type PageTarget =
  | { kind: "relationships"; id: string }
  | { kind: "timeline"; id: string }
  | { kind: "world"; id: string };

const isPageTarget = (value: unknown): value is PageTarget => {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as { kind?: unknown; id?: unknown };
  return (
    (candidate.kind === "relationships" || candidate.kind === "timeline" || candidate.kind === "world") &&
    typeof candidate.id === "string" &&
    candidate.id.length > 0
  );
};


function PageFallback() {
  return (
    <div className="page-fallback" role="status" aria-live="polite">
      <span aria-hidden="true" className="page-fallback-spinner" />
      <span>加载中…</span>
    </div>
  );
}

function App() {
  const [page, setPage] = useState<Page>(() =>
    isDeveloperPath(window.location.pathname) ? "developer" : "dashboard",
  );
  const [characters, setCharacters] = useState<Character[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isThemeMenuOpen, setIsThemeMenuOpen] = useState(false);
  const [isWorkspaceMenuOpen, setIsWorkspaceMenuOpen] = useState(false);
  const [isAppAboutOpen, setIsAppAboutOpen] = useState(false);
  const [isFirstAboutOpen, setIsFirstAboutOpen] = useState(false);
  const [isAppSettingsOpen, setIsAppSettingsOpen] = useState(false);
  const [isAppAssetLibraryOpen, setIsAppAssetLibraryOpen] = useState(false);
  const [isAppAssetCleanupOpen, setIsAppAssetCleanupOpen] = useState(false);
  const [isAppClearDataOpen, setIsAppClearDataOpen] = useState(false);
  const [clearDataError, setClearDataError] = useState<string | null>(null);
  // A delete can start anywhere - the dashboard, the editor, the preview - but the
  // undo affordance lives on the dashboard, and the editor leaves this screen before
  // an undo could be offered there. So the request is handed to the dashboard rather
  // than duplicated: one delete, one card that can call it back.
  const [deleteUndo, setDeleteUndo] = useState<{ characterIds: string[]; message: string } | null>(
    null,
  );
  const [isDeveloperResetOpen, setIsDeveloperResetOpen] = useState(false);
  const [pendingAppAssetDelete, setPendingAppAssetDelete] = useState<AvatarAssetRecord | null>(null);
  const [pendingAppAssetBatchDeleteIds, setPendingAppAssetBatchDeleteIds] = useState<string[]>([]);
  const [avatarAssets, setAvatarAssets] = useState<AvatarAssetRecord[]>([]);
  const [selectedAppAssetIds, setSelectedAppAssetIds] = useState<string[]>([]);
  const [avatarAssetStats, setAvatarAssetStats] = useState({ count: 0, size: 0 });
  const [showQuickBackToTop, setShowQuickBackToTop] = useState(false);
  const [showQuickToBottom, setShowQuickToBottom] = useState(false);
  // What the switcher says you are in. The character workspace covers its own
  // sub-screens: editing and previewing a character is still that workspace.
  const workspaceLabel =
    page === "relationships"
      ? "角色关系网"
      : page === "timeline"
        ? "世界观时间线"
        : page === "world"
          ? "世界观管理"
          : page === "developer"
            ? "开发者中心"
            : "角色创作工作台";

  const [dashboardSearchSignal, setDashboardSearchSignal] = useState(0);
  // A request to clear the dashboard filters, raised by the editor after a delete.
  // The counter makes each request distinct so a repeat still applies.
  const [dashboardFiltersReset, setDashboardFiltersReset] = useState<{
    signal: number;
    favoriteMode: "all" | "drafts";
  }>({ signal: 0, favoriteMode: "all" });
  const [developerSettings, setDeveloperSettings] = useState(loadDeveloperSettings);
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => {
    const storedTheme = localStorage.getItem(THEME_KEY);
    return storedTheme === "light" || storedTheme === "dark" || storedTheme === "system"
      ? storedTheme
      : "system";
  });
  // A one-shot request for another workspace to open on something specific: the
  // character the graph should focus, the event the timeline should show, the entry the
  // world manager should open. It is consumed by that screen and cleared, so it never
  // becomes a second source of truth for what is selected.
  //
  // It is also what a history entry carries, which is how Forward can rebuild the
  // screen Back left: the entry names the page and the target, and returning to it
  // re-issues the same one-shot request the click did.
  const [pageTarget, setPageTarget] = useState<PageTarget | null>(null);
  // The preview's related lists, read when the preview opens rather than kept in sync
  // with two workspaces the reader is not looking at.
  const [previewLinks, setPreviewLinks] = useState<{
    relationships: ReturnType<typeof loadRelationships>;
    events: ReturnType<typeof loadTimeline>;
    entries: ReturnType<typeof loadWorldEntries>;
  }>({ relationships: [], events: [], entries: [] });
  const [selectedCharacter, setSelectedCharacter] = useState<Character | null>(
    null,
  );
  const themeMenuRef = useRef<HTMLDivElement>(null);
  const workspaceMenuRef = useRef<HTMLDivElement>(null);
  const topbarRef = useRef<HTMLElement>(null);
  const appAssetImportInputRef = useRef<HTMLInputElement>(null);
  // A navigation that asked for a target hands it over here, so the push effect can
  // read it without the effect that clears it (the target being consumed) looking like
  // a second navigation and pushing a duplicate entry.
  const pendingTargetRef = useRef<PageTarget | null>(null);
  // Which screen the history entry we are standing on describes. Comparing against
  // this — rather than against a "was that a popstate?" flag — is what tells a real
  // navigation apart from a re-render, including Back/Forward between two entries of
  // the same page.
  const committedEntryRef = useRef<{ page: Page; target: PageTarget | null } | null>(null);

  useEffect(() => {
    setCharacters(loadCharacters());
    setIsLoading(false);
    if (localStorage.getItem(ABOUT_SEEN_KEY) !== "true") {
      setIsFirstAboutOpen(true);
      setIsAppAboutOpen(true);
    }
  }, []);

  useEffect(() => {
    function handleScroll() {
      setShowQuickBackToTop(
        window.scrollY > 280 &&
          document.documentElement.scrollHeight > window.innerHeight + 120,
      );
      // The mirror of it, and conditional for the same reason: only while there is
      // more than a screenful of page left below, so it never offers to scroll a
      // distance the reader could cover with one flick.
      setShowQuickToBottom(
        document.documentElement.scrollHeight - window.innerHeight - window.scrollY > 280,
      );
    }

    handleScroll();
    window.addEventListener("scroll", handleScroll);
    window.addEventListener("resize", handleScroll);
    return () => {
      window.removeEventListener("scroll", handleScroll);
      window.removeEventListener("resize", handleScroll);
    };
  }, []);

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      if (
        themeMenuRef.current &&
        !themeMenuRef.current.contains(event.target as Node)
      ) {
        setIsThemeMenuOpen(false);
      }

      if (workspaceMenuRef.current && !workspaceMenuRef.current.contains(event.target as Node)) {
        setIsWorkspaceMenuOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsThemeMenuOpen(false);
        setIsWorkspaceMenuOpen(false);
        setIsAppAboutOpen(false);
        setIsFirstAboutOpen(false);
        setIsAppAssetLibraryOpen(false);
        setPendingAppAssetDelete(null);
        setIsAppAssetCleanupOpen(false);
        setIsAppClearDataOpen(false);
        setIsDeveloperResetOpen(false);
        setPendingAppAssetBatchDeleteIds([]);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  // Everything sticky below the topbar offsets itself by this value, so a
  // hard-coded number is wrong at half the breakpoints: the topbar is 46px on a
  // desktop but wraps to 95px on a narrow screen, and at 95 the editor's action
  // bar slid underneath it. Measuring and republishing keeps the layers stacked
  // at every width and font scale.
  useEffect(() => {
    const el = topbarRef.current;
    if (!el) {
      return;
    }

    const publish = () => {
      document.documentElement.style.setProperty(
        "--topbar-height",
        `${Math.round(el.getBoundingClientRect().height)}px`,
      );
    };

    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");

    function applyTheme() {
      const resolvedTheme =
        themeMode === "system"
          ? mediaQuery.matches
            ? "dark"
            : "light"
          : themeMode;

      document.documentElement.dataset.theme = resolvedTheme;
      localStorage.setItem(THEME_KEY, themeMode);
    }

    applyTheme();
    mediaQuery.addEventListener("change", applyTheme);
    return () => mediaQuery.removeEventListener("change", applyTheme);
  }, [themeMode]);

  useEffect(() => {
    saveDeveloperSettings(developerSettings);
    applyDeveloperSettings(developerSettings);
    if (!developerSettings.application.showFirstAbout) {
      localStorage.setItem(ABOUT_SEEN_KEY, "true");
    }

    // Seed the dashboard's preferences only when nothing is stored yet.
    //
    // This used to rewrite the whole object on every settings change, and it hard
    // wrote `viewMode` and `sortMode` from the developer defaults while doing it.
    // The dashboard persists the user's own choice under the same key, so any
    // settings change — including the ones the dashboard itself pushes — undid it:
    // that is why switching to the list view did not survive a trip through the
    // editor. A default is an initial value, not a policy.
    // Built from the dashboard's own defaults rather than a second hand-written
    // copy of the same seven fields, so adding a field cannot leave the seeded
    // value missing it.
    if (!localStorage.getItem(DASHBOARD_PREFS_KEY)) {
      saveDashboardPrefs({
        ...defaultPrefs,
        viewMode: developerSettings.dashboardDefaults.viewMode,
        sortMode: developerSettings.dashboardDefaults.sortMode,
      });
    }
  }, [developerSettings]);

  useEffect(() => {
    if (!isAppSettingsOpen && !isAppAssetLibraryOpen) {
      return;
    }

    void refreshAvatarAssetStats();
  }, [isAppSettingsOpen, isAppAssetLibraryOpen]);

  async function refreshAvatarAssetStats() {
    try {
      const [stats, assets] = await Promise.all([
        getAvatarAssetStats(),
        listAvatarAssets(),
      ]);

      setAvatarAssetStats(stats);
      setAvatarAssets(assets);
      setSelectedAppAssetIds((current) =>
        current.filter((id) => assets.some((asset) => asset.id === id)),
      );
    } catch {
      setAvatarAssetStats({ count: 0, size: 0 });
      setAvatarAssets([]);
      setSelectedAppAssetIds([]);
    }
  }

  async function confirmAppAssetCleanup() {
    const usedAssetIds = characters
      .map((character) => character.avatarAssetId)
      .filter((id): id is string => Boolean(id));

    await cleanupUnusedAvatarAssets(usedAssetIds);
    await refreshAvatarAssetStats();
    setIsAppAssetCleanupOpen(false);
  }

  function getAssetUsageCount(assetId: string) {
    return characters.filter((character) => character.avatarAssetId === assetId).length;
  }

  async function requestAppAssetDelete(asset: AvatarAssetRecord) {
    if (getAssetUsageCount(asset.id) > 0) {
      setPendingAppAssetDelete(asset);
      return;
    }

    await deleteAvatarAsset(asset.id);
    await refreshAvatarAssetStats();
  }

  async function confirmAppAssetDelete() {
    if (!pendingAppAssetDelete) {
      return;
    }

    await deleteAvatarAsset(pendingAppAssetDelete.id);
    const nextCharacters = characters.map((character) =>
      character.avatarAssetId === pendingAppAssetDelete.id
        ? { ...character, avatarAssetId: "", updatedAt: new Date().toISOString() }
        : character,
    );

    saveCharacters(nextCharacters);
    setCharacters(nextCharacters);
    if (selectedCharacter?.avatarAssetId === pendingAppAssetDelete.id) {
      setSelectedCharacter({ ...selectedCharacter, avatarAssetId: "" });
    }
    setPendingAppAssetDelete(null);
    await refreshAvatarAssetStats();
  }

  function toggleAppAssetSelected(assetId: string) {
    setSelectedAppAssetIds((current) =>
      current.includes(assetId)
        ? current.filter((id) => id !== assetId)
        : [...current, assetId],
    );
  }

  function toggleAllAppAssetsSelected() {
    setSelectedAppAssetIds((current) =>
      current.length === avatarAssets.length ? [] : avatarAssets.map((asset) => asset.id),
    );
  }

  async function deleteAppAssets(assetIds: string[]) {
    await Promise.all(assetIds.map((id) => deleteAvatarAsset(id)));
    const deletedIds = new Set(assetIds);
    const nextCharacters = characters.map((character) =>
      character.avatarAssetId && deletedIds.has(character.avatarAssetId)
        ? { ...character, avatarAssetId: "", updatedAt: new Date().toISOString() }
        : character,
    );

    saveCharacters(nextCharacters);
    setCharacters(nextCharacters);
    if (selectedCharacter?.avatarAssetId && deletedIds.has(selectedCharacter.avatarAssetId)) {
      setSelectedCharacter({ ...selectedCharacter, avatarAssetId: "" });
    }
    setSelectedAppAssetIds([]);
    await refreshAvatarAssetStats();
  }

  async function deleteSelectedAppUnusedAssets() {
    const unusedIds = selectedAppAssetIds.filter((id) => getAssetUsageCount(id) === 0);

    if (unusedIds.length === 0) {
      return;
    }

    await deleteAppAssets(unusedIds);
  }

  function requestSelectedAppAssetDelete() {
    if (selectedAppAssetIds.length === 0) {
      return;
    }

    if (selectedAppAssetIds.some((id) => getAssetUsageCount(id) > 0)) {
      setPendingAppAssetBatchDeleteIds(selectedAppAssetIds);
      return;
    }

    void deleteAppAssets(selectedAppAssetIds);
  }

  async function confirmAppAssetBatchDelete() {
    if (pendingAppAssetBatchDeleteIds.length === 0) {
      return;
    }

    await deleteAppAssets(pendingAppAssetBatchDeleteIds);
    setPendingAppAssetBatchDeleteIds([]);
  }

  async function clearAppLocalData() {
    // This path wipes more than the dashboard's does (avatars, workspace data and
    // every setting), but the character list is the part a snapshot can bring back,
    // and it used to get none at all. Same helper as the dashboard, so the two
    // entries cannot drift into different meanings again.
    const outcome = clearLocalDataPreservingSnapshot("清空本地数据前自动备份", characters);
    if (!outcome.ok) {
      // DEC-38-01: without a recovery copy the clear does not run. The dialog stays
      // open so the message sits next to the button that failed.
      setClearDataError(
        `自动备份失败（${outcome.reason}），已取消清空。请清理浏览器存储空间，或先自行导出备份后再试。`,
      );
      return;
    }

    setClearDataError(null);
    await clearAvatarAssets();
    saveCharacters([]);
    setCharacters([]);
    setSelectedCharacter(null);
    setAvatarAssets([]);
    setAvatarAssetStats({ count: 0, size: 0 });
    setSelectedAppAssetIds([]);
    setIsAppClearDataOpen(false);
    setIsAppSettingsOpen(false);
    setPage("dashboard");
  }

  async function handleAppImportAvatarAssets(file: File | undefined) {
    if (!file) {
      return;
    }

    try {
      await importAvatarAssetsJson(file);
      await refreshAvatarAssetStats();
    } catch {
      // Dashboard has toast feedback; app-level Settings keeps the import failure non-fatal.
    } finally {
      if (appAssetImportInputRef.current) {
        appAssetImportInputRef.current.value = "";
      }
    }
  }

  function closeAppOverlays() {
    setIsThemeMenuOpen(false);
    setIsAppAboutOpen(false);
    setIsFirstAboutOpen(false);
    setIsAppSettingsOpen(false);
    setIsAppAssetLibraryOpen(false);
    setIsAppAssetCleanupOpen(false);
    setIsAppClearDataOpen(false);
    setIsDeveloperResetOpen(false);
    setPendingAppAssetDelete(null);
    setPendingAppAssetBatchDeleteIds([]);
  }

  function updateDeveloperSettings(nextSettings: DeveloperSettings) {
    setDeveloperSettings(nextSettings);
  }

  function resetDeveloperModule(module: keyof DeveloperSettings) {
    setDeveloperSettings((current) => ({
      ...current,
      [module]: defaultDeveloperSettings[module],
    }));
  }

  function confirmDeveloperSettingsReset() {
    setDeveloperSettings(defaultDeveloperSettings);
    setIsDeveloperResetOpen(false);
  }

  function resetFirstAboutState() {
    localStorage.removeItem(ABOUT_SEEN_KEY);
    setIsFirstAboutOpen(true);
    setIsAppAboutOpen(true);
  }

  function exportDeveloperCharactersJson() {
    exportAllCharactersJson(characters);
  }

  function exportDeveloperFullBackup() {
    void exportFullBackupZip(characters, readWorkspaceDatasets());
  }

  useEffect(() => {
    const initialPage = isDeveloperPath(window.location.pathname) ? "developer" : "dashboard";
    window.history.replaceState(
      { characterStudioPage: initialPage, characterStudioTarget: null },
      "",
      window.location.href,
    );
    committedEntryRef.current = { page: initialPage, target: null };

    function handlePopState(event: PopStateEvent) {
      // This used to name three pages and send every other value to the dashboard.
      // The three workspaces arrived after it was written and were never added, so
      // leaving one and pressing Back showed the dashboard while the history entry
      // still said "relationships" — measured, see KI-15.
      const nextPage = event.state?.characterStudioPage;
      const landedPage = isRestorablePage(nextPage) ? nextPage : "dashboard";
      const nextTarget = isPageTarget(event.state?.characterStudioTarget)
        ? (event.state.characterStudioTarget as PageTarget)
        : null;

      // The entry we have landed on is the one the effect below must not push again,
      // and the target it names is what the workspace re-opens on — which is what
      // makes Forward rebuild the screen instead of showing the workspace with
      // nothing focused.
      committedEntryRef.current = { page: landedPage, target: nextTarget };
      setPage(landedPage);
      setPageTarget(nextTarget);
      setIsAppAboutOpen(false);
      setIsFirstAboutOpen(false);
      setIsAppSettingsOpen(false);
      setIsAppAssetLibraryOpen(false);
    }

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  useEffect(() => {
    const target = pendingTargetRef.current;
    pendingTargetRef.current = null;
    const committed = committedEntryRef.current;

    // Nothing new to record: the entry we are on already describes this screen. This
    // covers two things that must not add an entry — a target being consumed by the
    // workspace that just used it, and a Back/Forward that React re-rendered after the
    // popstate handler had already synced `committedEntryRef`.
    if (!target && committed && committed.page === page) {
      return;
    }

    committedEntryRef.current = { page, target };
    window.history.pushState(
      { characterStudioPage: page, characterStudioTarget: target },
      "",
      page === "developer"
        ? DEVELOPER_PATH
        : isDeveloperPath(window.location.pathname)
          ? BASE_PATH
          : window.location.href,
    );
  }, [page]);

  useEffect(() => {
    if (page !== "preview") {
      return;
    }

    setPreviewLinks({
      relationships: loadRelationships(),
      events: loadTimeline(),
      entries: loadWorldEntries(),
    });
  }, [page, selectedCharacter?.id]);

  useEffect(() => {
    if (page !== "preview") {
      return;
    }

    window.requestAnimationFrame(() => {
      window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    });
  }, [page, selectedCharacter?.id]);

  /** Opens a workspace with something to show, pushing one history entry like any
   *  other page change so Back returns to where the reader came from. */
  function openWorkspace(kind: "relationships" | "timeline" | "world", id: string) {
    const target: PageTarget = { kind, id };
    // Handed to the push effect as well as to the workspace: the workspace consumes it
    // and clears it, but the history entry has to keep its copy so Forward can hand it
    // over again.
    pendingTargetRef.current = target;
    setPageTarget(target);
    setPage(kind);
  }

  function handlePageTargetHandled() {
    setPageTarget(null);
  }

  function goBack() {
    if (window.history.state?.characterStudioPage && window.history.length > 1) {
      window.history.back();
      return;
    }

    setPage("dashboard");
  }

  function handleSave(character: Character) {
    if (character.isDraft) {
      handlePromoteDraft(character);
      return;
    }

    const savedCharacter = {
      ...character,
      isDraft: false,
      draftOfId: undefined,
    };
    setCharacters(upsertCharacter(savedCharacter));
    setSelectedCharacter(savedCharacter);
    setPage("preview");
  }

  function handleDraftSave(character: Character) {
    const sourceCharacter = selectedCharacter;
    const existingDraft =
      sourceCharacter && !sourceCharacter.isDraft
        ? characters.find((item) => item.draftOfId === sourceCharacter.id)
        : null;
    const draftCharacter = {
      ...character,
      id: sourceCharacter?.isDraft
        ? sourceCharacter.id
        : existingDraft?.id || crypto.randomUUID(),
      isDraft: true,
      draftOfId: sourceCharacter?.isDraft
        ? sourceCharacter.draftOfId
        : sourceCharacter?.id,
      createdAt: existingDraft?.createdAt || character.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    setCharacters(upsertCharacter(draftCharacter));
    setSelectedCharacter(draftCharacter);
    setPage("dashboard");
  }

  function handlePromoteDraft(draft: Character) {
    const now = new Date().toISOString();
    const officialCharacter: Character = {
      ...draft,
      id: draft.draftOfId || draft.id,
      isDraft: false,
      draftOfId: undefined,
      createdAt:
        characters.find((character) => character.id === draft.draftOfId)?.createdAt ||
        draft.createdAt ||
        now,
      updatedAt: now,
    };
    const nextCharacters = characters.filter(
      (character) => character.id !== draft.id && character.id !== officialCharacter.id,
    );

    saveCharacters([officialCharacter, ...nextCharacters]);
    setCharacters([officialCharacter, ...nextCharacters]);
    setSelectedCharacter(officialCharacter);
    setPage("preview");
  }

  function handleAutoSave(character: Character) {
    setCharacters(upsertCharacter(character));
    setSelectedCharacter(character);
  }

  function handleCreate() {
    closeAppOverlays();
    setSelectedCharacter(null);
    setPage("form");
  }

  function handleEdit(character: Character) {
    closeAppOverlays();
    setSelectedCharacter(character);
    setPage("form");
  }

  function handlePreview(character: Character) {
    closeAppOverlays();
    setSelectedCharacter(character);
    setPage("preview");
  }

  // The three delete entry points (dashboard single, dashboard bulk, editor) all run
  // through here, so the rule is stated once: take a recovery copy first, and if that
  // copy cannot be written, do not delete. The prune below is what removes the
  // character from the three domains, and this record is the only description of what
  // it removed (DEC-38-01, KI-17).
  function handleDelete(character: Character): DeleteRequestResult {
    const capture = captureDeleteRecovery("删除角色", [character]);
    if (capture.status === "failed") {
      return { ok: false, reason: capture.reason };
    }

    const nextCharacters = deleteCharacter(character.id);
    setCharacters(nextCharacters);
    pruneCharacterReferences(nextCharacters.map((entry) => entry.id));

    if (selectedCharacter?.id === character.id) {
      setSelectedCharacter(null);
    }

    setDeleteUndo({ characterIds: [character.id], message: "角色已删除。" });
    return { ok: true };
  }

  function handleDuplicate(character: Character) {
    setCharacters(duplicateCharacter(character));
  }

  function handleToggleFavorite(character: Character) {
    const isFavorite = character.favorite ?? character.isFavorite ?? false;
    const updatedCharacter = {
      ...character,
      favorite: !isFavorite,
      isFavorite: undefined,
    };
    setCharacters(upsertCharacter(updatedCharacter));

    if (selectedCharacter?.id === character.id) {
      setSelectedCharacter(updatedCharacter);
    }
  }

  function handleBulkDelete(characterIds: string[]): DeleteRequestResult {
    const doomed = characters.filter((character) => characterIds.includes(character.id));
    const capture = captureDeleteRecovery("批量删除角色", doomed);
    if (capture.status === "failed") {
      return { ok: false, reason: capture.reason };
    }

    const nextCharacters = characters.filter(
      (character) => !characterIds.includes(character.id),
    );
    saveCharacters(nextCharacters);
    setCharacters(nextCharacters);
    // The single delete path has always pruned the three domains that point at
    // characters; this path did not, so a bulk delete left references to characters
    // that no longer exist. Same rule, one helper, both paths.
    pruneCharacterReferences(nextCharacters.map((character) => character.id));

    if (selectedCharacter && characterIds.includes(selectedCharacter.id)) {
      setSelectedCharacter(null);
    }

    setDeleteUndo({
      characterIds,
      message: `已删除 ${doomed.length} 个角色。`,
    });
    return { ok: true };
  }

  // The undo, in one place, for whichever delete asked for it. It restores the
  // characters and the references that delete removed, or it says which part it could
  // not do - a partial recovery is never reported as a complete one.
  function handleRestoreDeleted(characterIds: string[]): RestoreDeleteResult {
    const result = restoreDeleteRecovery(characterIds);
    setCharacters(result.characters);
    setDeleteUndo(null);
    return result;
  }

  function handleBulkDuplicate(charactersToDuplicate: Character[]) {
    const copies = charactersToDuplicate.map((character) => ({
      ...character,
      id: crypto.randomUUID(),
      name: `${character.name || "未命名角色"} Copy`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }));
    const nextCharacters = [...copies, ...characters];
    saveCharacters(nextCharacters);
    setCharacters(nextCharacters);
  }

  function handleImport(nextCharacters: Character[]) {
    saveCharacters(nextCharacters);
    setCharacters(nextCharacters);
    closeAppOverlays();
    setPage("dashboard");
  }

  function toggleTheme() {
    setThemeMode((current) => (current === "dark" ? "light" : "dark"));
    setIsThemeMenuOpen(false);
  }

  function goDashboard(options: { resetFilters?: boolean } = {}) {
    closeAppOverlays();
    setPage("dashboard");

    // The mark is the way home, and it is on screen from every screen. An author who
    // has wandered into 草稿箱 or 收藏夹 with a search typed in has no single other
    // control that clears all of it, so going home from the mark means the dashboard
    // as it opens rather than the dashboard as they left it. The Dashboard button
    // next to it stays literal: go there, keep the view.
    if (options.resetFilters) {
      setDashboardFiltersReset((current) => ({ signal: current.signal + 1, favoriteMode: "all" }));
    }
  }

  const isAppOverlayOpen =
    isAppAboutOpen ||
    isAppSettingsOpen ||
    isAppAssetLibraryOpen ||
    isAppAssetCleanupOpen ||
    isAppClearDataOpen ||
    Boolean(pendingAppAssetDelete) ||
    pendingAppAssetBatchDeleteIds.length > 0;

  return (
    <main className="app-shell">
      <nav className="topbar" ref={topbarRef}>
        <button
          className="brand-button"
          onClick={() => goDashboard({ resetFilters: true })}
          title="回到初始界面（清除搜索、筛选与收藏／草稿视图）"
          type="button"
        >
          <svg className="brand-mark" aria-hidden="true" viewBox="0 0 566.43 637.56">
            <polygon className="brand-mark-primary" points="0 163.51 283.22 0 476.31 111.48 386.19 163.51 283.22 104.06 90.12 215.55 90.12 438.51 254.62 533.49 254.62 637.56 0 490.54 0 163.51" />
            <polygon className="brand-mark-accent" points="311.79 533.49 476.31 438.51 476.31 215.55 566.43 163.51 566.43 490.54 311.79 637.56 311.79 533.49" />
          </svg>
          Character Studio
        </button>
        <div className="nav-actions">
          {/* Workspace navigation lives here, not in the home page's 「更多」 menu:
              which module you are in is a property of the app, and it used to be
              reachable only by opening a menu whose rows were indistinguishable from
              「导出 CSV」. The entries are gated exactly as the dashboard's own were —
              a nav that lists a page the build does not ship has a dead entry in it.
              The theme control stays a separate thing beside it. */}
          <div className="workspace-menu-wrap" ref={workspaceMenuRef}>
            <button
              aria-expanded={isWorkspaceMenuOpen}
              aria-haspopup="menu"
              className={isWorkspaceMenuOpen ? "workspace-switch active" : "workspace-switch"}
              onClick={() => setIsWorkspaceMenuOpen((current) => !current)}
              type="button"
            >
              <Icon name="grid" size={16} />
              <span className="workspace-switch-label">{workspaceLabel}</span>
              <Icon name="chevronDown" size={15} />
            </button>
            {isWorkspaceMenuOpen && (
              <div className="workspace-menu" role="menu">
                <p className="workspace-menu-group">工作区</p>
                <button
                  className={page === "dashboard" ? "selected" : ""}
                  onClick={() => {
                    setIsWorkspaceMenuOpen(false);
                    goDashboard();
                  }}
                  role="menuitem"
                  type="button"
                >
                  <Icon name="grid" size={16} />
                  <span>
                    <strong>角色创作工作台</strong>
                    <small>角色列表、编辑与预览</small>
                  </span>
                </button>
                {developerSettings.featureFlags.experimentalRelationshipGraph && (
                  <button
                    className={page === "relationships" ? "selected" : ""}
                    onClick={() => {
                      setIsWorkspaceMenuOpen(false);
                      setPage("relationships");
                    }}
                    role="menuitem"
                    type="button"
                  >
                    <Icon name="link" size={16} />
                    <span>
                      <strong>角色关系网</strong>
                      <small>角色之间的连接</small>
                    </span>
                  </button>
                )}
                {developerSettings.featureFlags.experimentalTimeline && (
                  <button
                    className={page === "timeline" ? "selected" : ""}
                    onClick={() => {
                      setIsWorkspaceMenuOpen(false);
                      setPage("timeline");
                    }}
                    role="menuitem"
                    type="button"
                  >
                    <Icon name="clock" size={16} />
                    <span>
                      <strong>世界观时间线</strong>
                      <small>发生过的节点</small>
                    </span>
                  </button>
                )}
                {developerSettings.featureFlags.worldManager && (
                  <button
                    className={page === "world" ? "selected" : ""}
                    onClick={() => {
                      setIsWorkspaceMenuOpen(false);
                      setPage("world");
                    }}
                    role="menuitem"
                    type="button"
                  >
                    <Icon name="globe" size={16} />
                    <span>
                      <strong>世界观管理</strong>
                      <small>设定与派系</small>
                    </span>
                  </button>
                )}
              </div>
            )}
          </div>
          <div className="theme-menu-wrap" ref={themeMenuRef}>
            <div className="theme-combo" aria-label="主题控制">
              <button
                aria-label="切换浅色或深色主题"
                className="theme-combo-button theme-combo-main"
                onClick={toggleTheme}
                type="button"
              >
                <Icon
                  name={themeMode === "system" ? "monitor" : themeMode === "dark" ? "moon" : "sun"}
                />
              </button>
              <button
                aria-label="打开主题菜单"
                className="theme-combo-button theme-combo-arrow"
                onClick={() => setIsThemeMenuOpen((current) => !current)}
                type="button"
              >
                <Icon name="chevronDown" size={16} />
              </button>
            </div>
            {isThemeMenuOpen && (
              <div className="theme-menu">
                <button
                  className={themeMode === "system" ? "selected" : ""}
                  onClick={() => {
                     setThemeMode("system");
                     setIsThemeMenuOpen(false);
                   }}
                   type="button"
                 >
                   <Icon name="monitor" size={15} />
                   <span>跟随系统</span>
                 </button>
                <button
                  className={themeMode === "light" ? "selected" : ""}
                  onClick={() => {
                     setThemeMode("light");
                     setIsThemeMenuOpen(false);
                   }}
                   type="button"
                 >
                   <Icon name="sun" size={15} />
                   <span>浅色</span>
                 </button>
                <button
                  className={themeMode === "dark" ? "selected" : ""}
                  onClick={() => {
                     setThemeMode("dark");
                     setIsThemeMenuOpen(false);
                   }}
                   type="button"
                 >
                   <Icon name="moon" size={15} />
                   <span>深色</span>
                 </button>
              </div>
            )}
          </div>
        </div>
      </nav>

      <Suspense fallback={<PageFallback />}>
      {page === "dashboard" && (
        <Dashboard
          characters={characters}
          projectInfo={developerSettings.project}
          contentText={developerSettings.content}
          dashboardSettings={developerSettings.dashboardDefaults}
          editorSettings={developerSettings.editorDefaults}
          exportSettings={developerSettings.exportDefaults}
          onOpenRelationships={
            developerSettings.featureFlags.experimentalRelationshipGraph
              ? () => setPage("relationships")
              : undefined
          }
          onOpenTimeline={
            developerSettings.featureFlags.experimentalTimeline ? () => setPage("timeline") : undefined
          }
          onOpenWorld={
            developerSettings.featureFlags.worldManager ? () => setPage("world") : undefined
          }
          onDashboardSettingsChange={(patch) =>
            updateDeveloperSettings({
              ...developerSettings,
              editorDefaults: {
                ...developerSettings.editorDefaults,
                ...(patch.editorDefaults ?? {}),
              },
              exportDefaults: {
                ...developerSettings.exportDefaults,
                ...(patch.exportDefaults ?? {}),
              },
            })
          }
          aiSettingsEnabled={developerSettings.featureFlags.aiSettings}
          assetLibraryEnabled={developerSettings.featureFlags.assetLibrary}
          onCreate={handleCreate}
          onEdit={handleEdit}
          onPreview={handlePreview}
          onDelete={handleDelete}
          onDuplicate={handleDuplicate}
          onBulkDelete={handleBulkDelete}
          onRestoreDeleted={handleRestoreDeleted}
          deleteUndo={deleteUndo}
          onDeleteUndoShown={() => setDeleteUndo(null)}
          onBulkDuplicate={handleBulkDuplicate}
          onImport={handleImport}
          onPromoteDraft={handlePromoteDraft}
          onToggleFavorite={handleToggleFavorite}
          isLoading={isLoading}
          onToggleTheme={toggleTheme}
          themeMode={themeMode}
          onSetThemeMode={setThemeMode}
          searchSignal={dashboardSearchSignal}
          filtersResetSignal={dashboardFiltersReset.signal}
          filtersResetFavoriteMode={dashboardFiltersReset.favoriteMode}
          footerText={developerSettings.content.footerText || developerSettings.application.footerText}
        />
      )}

      {page === "form" && (
        <CharacterForm
          character={selectedCharacter}
          editorSettings={developerSettings.editorDefaults}
          featureFlags={developerSettings.featureFlags}
          onSave={handleSave}
          onDraftSave={handleDraftSave}
          onAutoSave={handleAutoSave}
          onDelete={handleDelete}
          onRequestDashboardFilterReset={(favoriteMode) =>
            setDashboardFiltersReset((current) => ({ signal: current.signal + 1, favoriteMode }))
          }
          onCancel={() => setPage("dashboard")}
        />
      )}

      {page === "preview" && selectedCharacter && (
        <CharacterPreview
          character={selectedCharacter}
          exportSettings={{
            ...developerSettings.exportDefaults,
            footerText: developerSettings.content.footerText,
          }}
          onBack={() => setPage("dashboard")}
          onEdit={() => handleEdit(selectedCharacter)}
          onOpenEntry={(entryId) => openWorkspace("world", entryId)}
          onOpenEvent={(eventId) => openWorkspace("timeline", eventId)}
          onOpenGraph={() => openWorkspace("relationships", selectedCharacter.id)}
          onOpenRelatedCharacter={(characterId) => {
            const target = characters.find((entry) => entry.id === characterId);
            if (target) {
              setSelectedCharacter(target);
              setPage("preview");
            }
          }}
          onToggleFavorite={() => handleToggleFavorite(selectedCharacter)}
          related={{
            characters,
            relationships: previewLinks.relationships,
            events: previewLinks.events,
            entries: previewLinks.entries,
          }}
        />
      )}

      {page === "world" && (
        <WorldManager
          characters={characters}
          focusEntryId={pageTarget?.kind === "world" ? pageTarget.id : null}
          onBack={() => setPage("dashboard")}
          onFocusHandled={handlePageTargetHandled}
          onOpenCharacter={(characterId) => {
            const target = characters.find((entry) => entry.id === characterId);
            if (target) {
              setSelectedCharacter(target);
              setPage("preview");
            }
          }}
        />
      )}
      {page === "timeline" && (
        <Timeline
          characters={characters}
          focusEventId={pageTarget?.kind === "timeline" ? pageTarget.id : null}
          onBack={() => setPage("dashboard")}
          onFocusHandled={handlePageTargetHandled}
          onOpenCharacter={(characterId) => {
            const target = characters.find((entry) => entry.id === characterId);
            if (target) {
              setSelectedCharacter(target);
              setPage("preview");
            }
          }}
        />
      )}
      {page === "relationships" && (
        <RelationshipGraph
          focusCharacterId={pageTarget?.kind === "relationships" ? pageTarget.id : null}
          onFocusHandled={handlePageTargetHandled}
          characters={characters}
          onBack={() => setPage("dashboard")}
          onOpenCharacter={(characterId) => {
            const target = characters.find((entry) => entry.id === characterId);
            if (target) {
              setSelectedCharacter(target);
              setPage("preview");
            }
          }}
        />
      )}
      {page === "developer" && (
        <DeveloperCenter
          avatarAssetStats={avatarAssetStats}
          characters={characters}
          currentPage={page}
          onExportCharactersJson={exportDeveloperCharactersJson}
          onExportFullBackup={exportDeveloperFullBackup}
          onOpenAssetLibrary={() => {
            setIsAppAssetLibraryOpen(true);
            void refreshAvatarAssetStats();
          }}
          onResetAll={() => setIsDeveloperResetOpen(true)}
          onResetFirstAbout={resetFirstAboutState}
          onResetModule={resetDeveloperModule}
          onSettingsChange={updateDeveloperSettings}
          settings={developerSettings}
          themeMode={themeMode}
        />
      )}
      </Suspense>

      {/* Two scroll affordances and nothing else.
          The bar also carried 新建角色, 搜索/筛选, 回到主页 and 编辑角色 — each a second
          copy of a control that already exists where the work happens (the dashboard's
          own toolbar, the workspace headers, the preview's actions) — and on a phone it
          sat on top of the very form it acted on. What is left only ever moves the page,
          appears only once there is a screenful to move, and stays clear of the home
          indicator. While a modal is open nothing floats over it at all. */}
      {!isAppOverlayOpen && (
        <div className="floating-actions" aria-label="快捷操作">
          {showQuickBackToTop && (
            <button
              aria-label="回到顶部"
              className="floating-action"
              data-tooltip="回到顶部"
              onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
              type="button"
            >
              <Icon name="arrowUp" />
            </button>
          )}
          {showQuickToBottom && (
            <button
              aria-label="滑到底部"
              className="floating-action"
              data-tooltip="滑到底部"
              onClick={() =>
                window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "smooth" })
              }
              type="button"
            >
              <Icon name="arrowDown" />
            </button>
          )}
          {/* The floating export button went with the preview page's own export menu —
              it existed only to open that dialog. Character exports live in the
              dashboard, where the scope (one character, the selection, or everything)
              and the format are chosen in one place. The same reasoning retired the
              rest of the bar's shortcuts: 新建角色 and 搜索/筛选 (both in the dashboard
              toolbar), 回到主页 (in every workspace header) and 编辑角色 (in the
              preview's own actions). */}
        </div>
      )}

      {page !== "dashboard" && (
        <footer className="dashboard-footer app-footer">
          <button onClick={() => {
            setIsFirstAboutOpen(false);
            setIsAppAboutOpen(true);
          }} type="button">
            About Character Studio
          </button>
          {developerSettings.featureFlags.assetLibrary && (
            <button onClick={() => setIsAppAssetLibraryOpen(true)} type="button">
              头像素材库
            </button>
          )}
          <button onClick={() => setIsAppSettingsOpen((current) => !current)} type="button">
            Settings
          </button>
          <span>{developerSettings.content.footerText || developerSettings.application.footerText}</span>
        </footer>
      )}

      {isAppAboutOpen && (
        <div className="modal-backdrop" onMouseDown={(event) => {
          if (event.target === event.currentTarget) {
            setIsAppAboutOpen(false);
            setIsFirstAboutOpen(false);
          }
        }} role="presentation">
          <div className="about-dialog" role="dialog" aria-modal="true">
            <div className="preview-card-title">
              <div>
                <p className="eyebrow">About</p>
                <h2>About Character Studio</h2>
              </div>
              <button className="ghost-button" onClick={() => {
                setIsAppAboutOpen(false);
                setIsFirstAboutOpen(false);
              }} type="button">
                关闭
              </button>
            </div>
            {isFirstAboutOpen ? (
              <div className="first-about">
                <div className="first-about-hero">
                  <svg className="first-about-logo" aria-hidden="true" viewBox="0 0 566.43 637.56">
                    <polygon className="brand-mark-primary" points="0 163.51 283.22 0 476.31 111.48 386.19 163.51 283.22 104.06 90.12 215.55 90.12 438.51 254.62 533.49 254.62 637.56 0 490.54 0 163.51" />
                    <polygon className="brand-mark-accent" points="311.79 533.49 476.31 438.51 476.31 215.55 566.43 163.51 566.43 490.54 311.79 637.56 311.79 533.49" />
                  </svg>
                  <h2>Character Studio</h2>
                  <p>{developerSettings.content.firstAboutTagline}</p>
                  <div className="about-version-row">
                    {developerSettings.application.showVersion && <span className="status-badge">Version {APP_VERSION}</span>}
                    {developerSettings.application.showSprint && <span className="status-badge">Sprint {APP_SPRINT}</span>}
                    {developerSettings.application.showBuild && <span className="status-badge">Build {APP_BUILD}</span>}
                  </div>
                </div>
                <div className="first-about-cards">
                  <article>
                    <h3>这是什么</h3>
                    <p>一个面向 OC 创作的本地优先工作台，用来整理角色资料、草稿、预览与备份。</p>
                  </article>
                  <article>
                    <h3>核心功能</h3>
                    <p>Dashboard 管理角色，Editor 编写设定，Preview 生成分享展示，并支持头像素材库。</p>
                  </article>
                  <article>
                    <h3>导入 / 导出</h3>
                    <p>支持单角色 JSON、完整备份 ZIP、CSV，以及 PDF / JPG / PNG 展示导出。</p>
                  </article>
                </div>
                <div className="first-about-links">
                  <a href="https://github.com/RintoTan/character-studio" rel="noreferrer" target="_blank">
                    GitHub 项目仓库
                  </a>
                  <a href="https://github.com/RintoTan/character-studio/blob/main/Developer%20Handbook.md" rel="noreferrer" target="_blank">
                    Developer Handbook 开发手册
                  </a>
                </div>
                <p className="first-about-credit">RINTO 使用智能体协同开发 {RELEASE_YEAR}</p>
                <label className="settings-check first-about-switch">
                  <input
                    type="checkbox"
                    onChange={(event) =>
                      localStorage.setItem(ABOUT_SEEN_KEY, String(event.target.checked))
                    }
                  />
                  <span>不再自动显示</span>
                </label>
              </div>
            ) : (
              <>
            <div className="about-grid">
              <article>
                <h3>{developerSettings.content.aboutTitle}</h3>
                <p>{developerSettings.content.aboutSummary}</p>
              </article>
              <article>
                <h3>核心功能</h3>
                <ul className="about-list">
                  <li>Dashboard、Editor、Preview、草稿箱与收藏夹。</li>
                  <li>主题切换、导入导出、PDF / JPG / PNG 输出。</li>
                </ul>
              </article>
              {isFirstAboutOpen && (
                <article>
                  <h3>当前版本</h3>
                  <div className="about-version-row">
                    {developerSettings.application.showVersion && <span className="status-badge">Version {APP_VERSION}</span>}
                    {developerSettings.application.showSprint && <span className="status-badge">Sprint {APP_SPRINT}</span>}
                    {developerSettings.application.showBuild && <span className="status-badge">Build {APP_BUILD}</span>}
                  </div>
                </article>
              )}
              {!isFirstAboutOpen && (
                <article>
                  <h3>快捷键</h3>
                  <dl className="shortcut-list">
                    <div><dt>N</dt><dd>新建角色</dd></div>
                    <div><dt>/</dt><dd>打开搜索</dd></div>
                    <div><dt>Esc</dt><dd>关闭弹层</dd></div>
                    <div><dt>⌘K / Ctrl+K</dt><dd>打开 Command Palette</dd></div>
                    <div><dt>Enter</dt><dd>打开搜索结果</dd></div>
                    <div><dt>Tab</dt><dd>切换输入焦点</dd></div>
                  </dl>
                </article>
              )}
              {!isFirstAboutOpen && (
                <article>
                  <h3>Roadmap</h3>
                  <div className="roadmap-columns">
                    <div>
                      <h4>已完成</h4>
                      <ul className="about-list">
                        <li>Dashboard</li>
                        <li>Character Editor</li>
                        <li>Character Preview</li>
                        <li>Draft Box</li>
                        <li>Favorites</li>
                        <li>Theme</li>
                        <li>JSON / CSV / PDF 导入导出</li>
                      </ul>
                    </div>
                    <div>
                      <h4>计划开发</h4>
                      <ul className="about-list">
                        <li>Character Relationship</li>
                        <li>Timeline</li>
                        <li>World Manager</li>
                        <li>AI Assistant</li>
                        <li>Cloud Sync</li>
                      </ul>
                    </div>
                  </div>
                </article>
              )}
              <article>
                <h3>导入 / 导出说明</h3>
                <ul className="about-list">
                  <li>单角色 JSON：包含角色；如有上传头像，会携带头像数据，适合分享单个角色。</li>
                  <li>角色 JSON：仅角色文字数据，不含头像，适合轻量备份。</li>
                  <li>完整备份 ZIP：包含角色、头像绑定信息与头像素材，适合跨设备迁移。</li>
                  <li>头像素材 JSON：可独立导入 / 导出素材库，不强制绑定角色。</li>
                  <li>CSV、PDF、JPG、PNG：用于查看、归档或展示，不用于重新导入。</li>
                </ul>
              </article>
              <article>
                <h3>项目信息</h3>
                <div className="project-link-grid">
                  <a href="https://github.com/RintoTan/character-studio" rel="noreferrer" target="_blank">
                    <span>GitHub</span>
                    <strong>项目仓库</strong>
                  </a>
                  <a href="https://github.com/RintoTan/character-studio/blob/main/Developer%20Handbook.md" rel="noreferrer" target="_blank">
                    <span>Handbook</span>
                    <strong>开发手册</strong>
                  </a>
                </div>
                <p className="muted">RINTO 使用智能体协同开发 {RELEASE_YEAR}。</p>
              </article>
              {!isFirstAboutOpen && (
                <article>
                  <h3>鸣谢</h3>
                  <p>感谢 React、TypeScript、Vite、jsPDF、html2canvas，以及开发过程中协同的智能体工具。</p>
                </article>
              )}
              {!isFirstAboutOpen && (
                <article>
                  <h3>Changelog</h3>
                  <p>近期版本重点完善了 Avatar、头像素材库、导入导出、Design System 与移动端体验。</p>
                </article>
              )}
              {isFirstAboutOpen && (
                <article>
                  <h3>首次提示</h3>
                  <label className="settings-check">
                    <input
                      type="checkbox"
                      onChange={(event) =>
                        localStorage.setItem(ABOUT_SEEN_KEY, String(event.target.checked))
                      }
                    />
                    <span>不再自动显示</span>
                  </label>
                </article>
              )}
            </div>
            {!isFirstAboutOpen ? (
              <div className="about-brand-footer">
                <svg className="about-brand-logo" aria-hidden="true" viewBox="0 0 566.43 637.56">
                  <polygon className="brand-mark-primary" points="0 163.51 283.22 0 476.31 111.48 386.19 163.51 283.22 104.06 90.12 215.55 90.12 438.51 254.62 533.49 254.62 637.56 0 490.54 0 163.51" />
                  <polygon className="brand-mark-accent" points="311.79 533.49 476.31 438.51 476.31 215.55 566.43 163.51 566.43 490.54 311.79 637.56 311.79 533.49" />
                </svg>
                <div className="about-brand-meta">
                  <h3>Character Studio</h3>
                  {developerSettings.application.showVersion && <p>Version {APP_VERSION}</p>}
                  {developerSettings.application.showSprint && <p>Sprint {APP_SPRINT}</p>}
                  <p>Released {RELEASE_YEAR}</p>
                </div>
                <p className="about-brand-tagline">{developerSettings.content.firstAboutTagline}</p>
                <div className="about-brand-links">
                  <a href="https://github.com/RintoTan/character-studio" rel="noreferrer" target="_blank">
                    GitHub
                  </a>
                  <a href="https://github.com/RintoTan/character-studio/blob/main/Developer%20Handbook.md" rel="noreferrer" target="_blank">
                    Developer Handbook
                  </a>
                </div>
                <div className="about-brand-credit">
                  <strong>RINTO 使用智能体协同开发</strong>
                  <span>{RELEASE_YEAR}</span>
                </div>
                <p className="about-brand-copyright">
                  © {RELEASE_YEAR} RINTO<br />
                  All Rights Reserved.
                </p>
              </div>
            ) : (
              <p className="about-footer">{developerSettings.content.footerText}</p>
            )}
              </>
            )}
          </div>
        </div>
      )}

      {isAppSettingsOpen && (
        <div className="modal-backdrop" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setIsAppSettingsOpen(false);
        }} role="presentation">
          <div className="settings-dialog" role="dialog" aria-modal="true">
            <div className="preview-card-title">
              <div>
                <p className="eyebrow">本地设置</p>
                <h2>设置</h2>
              </div>
              <button className="ghost-button" onClick={() => setIsAppSettingsOpen(false)} type="button">
                关闭
              </button>
            </div>
            {/* Two groups, in the order they are worth reading: what works, then what
                does not exist yet. Unreleased settings used to sit between the live
                ones at the same level, which made the dialog read as if AI were a
                feature that might be broken rather than one that is not here yet. */}
            <div className="settings-body">
              <div className="settings-group">
                <p className="settings-group-label">可用设置</p>
                <div className="settings-grid">
                  <article>
                    <h3>主题外观</h3>
                    <p className="muted">跟随系统，或固定在浅色 / 深色。只影响这台设备上的显示。</p>
                    <div className="segmented-row">
                      {(["system", "light", "dark"] as const).map((mode) => (
                        <button
                          className={themeMode === mode ? "active" : ""}
                          key={mode}
                          onClick={() => setThemeMode(mode)}
                          type="button"
                        >
                          {mode === "system" ? "跟随系统" : mode === "light" ? "浅色" : "深色"}
                        </button>
                      ))}
                    </div>
                  </article>
                  <article>
                    <h3>数据与存储</h3>
                    <p className="muted">
                      角色数据保存在这台浏览器的 localStorage，不上传，也不会自动跨设备同步。
                    </p>
                    <div className="settings-actions">
                      <button className="danger-button" onClick={() => setIsAppClearDataOpen(true)} type="button">
                        清空本地数据
                      </button>
                    </div>
                  </article>
                  {developerSettings.featureFlags.assetLibrary && (
                    <article>
                      <h3>头像素材库</h3>
                      <p className="muted">
                        本地头像素材 {avatarAssetStats.count} 个，占用约 {formatAssetSize(avatarAssetStats.size)}。
                        图片只保存在这台浏览器的 IndexedDB，不会自动跨设备同步；导出的轻量 JSON 不包含图片二进制。
                      </p>
                      <div className="settings-actions">
                        <button
                          className="ghost-button"
                          onClick={() => {
                            setIsAppSettingsOpen(false);
                            setIsAppAssetLibraryOpen(true);
                          }}
                          type="button"
                        >
                          打开头像素材库
                        </button>
                      </div>
                    </article>
                  )}
                </div>
              </div>
              {developerSettings.featureFlags.aiSettings && (
                /* Unreleased: a named row that opens, rather than a full disabled form
                   holding the top of the dialog. The values and the fields are the
                   same ones, so nothing about the feature changed — the dialog just
                   stopped making a reader scroll past it to reach what works. */
                <details className="settings-pending">
                  <summary>未发布功能 · AI 设置</summary>
                  <p className="muted">
                    下面的设置现在不会生效，填写也不会改变任何行为 —— 它们只是提前展示这个功能将来的样子。
                  </p>
                  <div className="settings-grid">
                    <AiSettingsForm />
                  </div>
                </details>
              )}
            </div>
          </div>
        </div>
      )}

      {isAppAssetLibraryOpen && (
        <div className="modal-backdrop" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setIsAppAssetLibraryOpen(false);
        }} role="presentation">
          <div className="settings-dialog asset-library-dialog" role="dialog" aria-modal="true">
            <div className="preview-card-title">
              <div>
                <p className="eyebrow">头像素材库</p>
                <h2>头像素材库</h2>
              </div>
              <button className="ghost-button" onClick={() => setIsAppAssetLibraryOpen(false)} type="button">
                关闭
              </button>
            </div>
            <div className="settings-grid">
              <article>
                <h3>头像素材</h3>
                <p className="muted">
                  共 {avatarAssetStats.count} 个素材，占用约 {formatAssetSize(avatarAssetStats.size)}。素材仅保存在当前浏览器 IndexedDB。
                </p>
                <div className="settings-actions">
                  <input
                    accept="application/json,.json"
                    className="hidden-input"
                    onChange={(event) => void handleAppImportAvatarAssets(event.target.files?.[0])}
                    ref={appAssetImportInputRef}
                    type="file"
                  />
                  <button className="ghost-button" onClick={() => appAssetImportInputRef.current?.click()} type="button">
                    导入头像素材
                  </button>
                  <button className="ghost-button" onClick={() => void exportAvatarAssetsJson()} type="button">
                    导出头像素材
                  </button>
                  <button className="ghost-button" onClick={() => setIsAppAssetCleanupOpen(true)} type="button">
                    清理未使用素材
                  </button>
                </div>
              </article>
              <article>
                <h3>素材统计</h3>
                <div className="import-preview-stats">
                  <span>素材总数量：{avatarAssetStats.count}</span>
                  <span>已绑定数量：{avatarAssets.filter((asset) => getAssetUsageCount(asset.id) > 0).length}</span>
                  <span>未绑定数量：{avatarAssets.filter((asset) => getAssetUsageCount(asset.id) === 0).length}</span>
                  <span>引用角色数量：{characters.filter((character) => character.avatarAssetId).length}</span>
                  <span>总占用空间：{formatAssetSize(avatarAssetStats.size)}</span>
                </div>
              </article>
            </div>
            {avatarAssets.length > 0 ? (
              <>
                <div className="settings-asset-toolbar">
                  <button className="ghost-button" onClick={toggleAllAppAssetsSelected} type="button">
                    {selectedAppAssetIds.length === avatarAssets.length ? "取消全选" : "全选"}
                  </button>
                  <button className="ghost-button" disabled={selectedAppAssetIds.length === 0} onClick={() => void exportAvatarAssetsJson(selectedAppAssetIds)} type="button">
                    导出所选
                  </button>
                  <button className="ghost-button" disabled={selectedAppAssetIds.length === 0} onClick={() => void deleteSelectedAppUnusedAssets()} type="button">
                    删除未使用
                  </button>
                  <button className="danger-button" disabled={selectedAppAssetIds.length === 0} onClick={requestSelectedAppAssetDelete} type="button">
                    删除所选
                  </button>
                </div>
                <div className="settings-asset-list">
                  {avatarAssets.map((asset) => {
                    const usageCount = getAssetUsageCount(asset.id);

                    return (
                      <div className="settings-asset-item" key={asset.id}>
                        <label className="asset-select-check">
                          <input
                            checked={selectedAppAssetIds.includes(asset.id)}
                            onChange={() => toggleAppAssetSelected(asset.id)}
                            type="checkbox"
                          />
                          <span className="sr-only">选择素材</span>
                        </label>
                        <AvatarDisplay assetId={asset.id} className="settings-asset-thumb" emoji="🙂" />
                        <div>
                          <strong>{asset.name || "avatar"}</strong>
                          <span>
                            {(asset.mimeType || asset.blob?.type || "image").replace("image/", "").toUpperCase()} ·{" "}
                            {formatAssetSize(asset.size || asset.blob?.size || 0)}
                          </span>
                          <small>{usageCount > 0 ? `正在被 ${usageCount} 个角色使用` : "未使用 / 无主素材"}</small>
                        </div>
                        <button
                          className={usageCount > 0 ? "danger-button" : "ghost-button"}
                          onClick={() => void requestAppAssetDelete(asset)}
                          type="button"
                        >
                          删除
                        </button>
                      </div>
                    );
                  })}
                </div>
              </>
            ) : (
              <p className="muted">暂无本地头像素材。</p>
            )}
          </div>
        </div>
      )}

      {isAppAssetCleanupOpen && (
        <div className="modal-backdrop" role="presentation">
          <div className="confirm-dialog" role="dialog" aria-modal="true">
            <h2>清理头像素材</h2>
            <p>确定要清理未被任何角色使用的本地头像素材吗？正在使用的头像不会被删除。</p>
            <div className="form-actions">
              <button className="ghost-button" onClick={() => setIsAppAssetCleanupOpen(false)} type="button">
                取消
              </button>
              <button className="danger-button" onClick={confirmAppAssetCleanup} type="button">
                确认清理
              </button>
            </div>
          </div>
        </div>
      )}

      {isAppClearDataOpen && (
        <div className="modal-backdrop" role="presentation">
          <div className="confirm-dialog" role="dialog" aria-modal="true">
            <h2>清空本地数据</h2>
            <p>
              确定要清空角色、设置和所有本地头像素材吗？清空前会自动备份一份角色文字资料，但头像素材、
              角色关系网、世界观时间线、世界观条目和全部设置都不在这份备份里，清空后无法用它找回。
            </p>
            {clearDataError && (
              <div className="form-error" role="alert">
                {clearDataError}
              </div>
            )}
            <div className="form-actions">
              <button
                className="ghost-button"
                onClick={() => {
                  setClearDataError(null);
                  setIsAppClearDataOpen(false);
                }}
                type="button"
              >
                取消
              </button>
              <button className="danger-button" onClick={() => void clearAppLocalData()} type="button">
                确认清空
              </button>
            </div>
          </div>
        </div>
      )}

      {isDeveloperResetOpen && (
        <div className="modal-backdrop" role="presentation">
          <div className="confirm-dialog" role="dialog" aria-modal="true">
            <h2>重置 Developer Center 设置</h2>
            <p>这只会恢复 Developer Center 的全局配置，不会删除角色、草稿、头像素材或导入导出数据。</p>
            <div className="form-actions">
              <button className="ghost-button" onClick={() => setIsDeveloperResetOpen(false)} type="button">
                取消
              </button>
              <button className="danger-button" onClick={confirmDeveloperSettingsReset} type="button">
                确认重置
              </button>
            </div>
          </div>
        </div>
      )}

      {pendingAppAssetBatchDeleteIds.length > 0 && (
        <div className="modal-backdrop" role="presentation">
          <div className="confirm-dialog" role="dialog" aria-modal="true">
            <h2>批量删除头像素材</h2>
            <p>选中的素材中有正在被角色使用的头像。删除后相关角色会自动回退到 Emoji 头像。</p>
            <div className="form-actions">
              <button className="ghost-button" onClick={() => setPendingAppAssetBatchDeleteIds([])} type="button">
                取消
              </button>
              <button className="danger-button" onClick={() => void confirmAppAssetBatchDelete()} type="button">
                确认删除
              </button>
            </div>
          </div>
        </div>
      )}

      {pendingAppAssetDelete && (
        <div className="modal-backdrop" role="presentation">
          <div className="confirm-dialog" role="dialog" aria-modal="true">
            <h2>删除正在使用的头像素材</h2>
            <p>
              这个头像素材正在被 {getAssetUsageCount(pendingAppAssetDelete.id)} 个角色使用。
              删除后这些角色会自动回退到 Emoji 头像。
            </p>
            <div className="form-actions">
              <button className="ghost-button" onClick={() => setPendingAppAssetDelete(null)} type="button">
                取消
              </button>
              <button className="danger-button" onClick={() => void confirmAppAssetDelete()} type="button">
                确认删除
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

export default App;
