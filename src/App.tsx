import { Suspense, lazy, useEffect, useRef, useState } from "react";
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
import { pruneCharacterReferences } from "./storage/referenceIntegrity";
import { readWorkspaceDatasets } from "./storage/workspaceBackup";
import { APP_BUILD, APP_SPRINT, APP_VERSION, RELEASE_YEAR } from "./config/version";

// The editor, the preview and the developer panel are not needed for the first
// paint, so they are code-split out of the entry chunk. Dashboard stays static:
// it is the landing page, and fetching it through a second round-trip would
// delay first paint more than the smaller entry chunk saves.
const CharacterForm = lazy(() =>
  import("./pages/CharacterForm").then((module) => ({ default: module.CharacterForm })),
);
const CharacterPreview = lazy(() =>
  import("./pages/CharacterPreview").then((module) => ({ default: module.CharacterPreview })),
);
const DeveloperCenter = lazy(() =>
  import("./pages/DeveloperCenter").then((module) => ({ default: module.DeveloperCenter })),
);
const RelationshipGraph = lazy(() =>
  import("./pages/RelationshipGraph").then((module) => ({ default: module.RelationshipGraph })),
);
const Timeline = lazy(() =>
  import("./pages/Timeline").then((module) => ({ default: module.Timeline })),
);
const WorldManager = lazy(() =>
  import("./pages/WorldManager").then((module) => ({ default: module.WorldManager })),
);

const THEME_KEY = "character-studio.theme";
const ABOUT_SEEN_KEY = "character-studio.about-seen";
const DASHBOARD_PREFS_KEY = "character-studio.dashboard-prefs";

// The app is served from a repository subpath on GitHub Pages, so route URLs are
// derived from the deployment base instead of being hard-coded to "/developer".
const BASE_PATH = import.meta.env.BASE_URL;
const DEVELOPER_PATH = `${BASE_PATH.replace(/\/+$/, "")}/developer`;
const isDeveloperPath = (pathname: string) => pathname.replace(/\/+$/, "") === DEVELOPER_PATH;

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
  const [isAppAboutOpen, setIsAppAboutOpen] = useState(false);
  const [isFirstAboutOpen, setIsFirstAboutOpen] = useState(false);
  const [isAppSettingsOpen, setIsAppSettingsOpen] = useState(false);
  const [isAppAssetLibraryOpen, setIsAppAssetLibraryOpen] = useState(false);
  const [isAppAssetCleanupOpen, setIsAppAssetCleanupOpen] = useState(false);
  const [isAppClearDataOpen, setIsAppClearDataOpen] = useState(false);
  const [isDeveloperResetOpen, setIsDeveloperResetOpen] = useState(false);
  const [pendingAppAssetDelete, setPendingAppAssetDelete] = useState<AvatarAssetRecord | null>(null);
  const [pendingAppAssetBatchDeleteIds, setPendingAppAssetBatchDeleteIds] = useState<string[]>([]);
  const [avatarAssets, setAvatarAssets] = useState<AvatarAssetRecord[]>([]);
  const [selectedAppAssetIds, setSelectedAppAssetIds] = useState<string[]>([]);
  const [avatarAssetStats, setAvatarAssetStats] = useState({ count: 0, size: 0 });
  const [showQuickBackToTop, setShowQuickBackToTop] = useState(false);
  const [previewExportSignal, setPreviewExportSignal] = useState(0);
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
  const [selectedCharacter, setSelectedCharacter] = useState<Character | null>(
    null,
  );
  const themeMenuRef = useRef<HTMLDivElement>(null);
  const topbarRef = useRef<HTMLElement>(null);
  const appAssetImportInputRef = useRef<HTMLInputElement>(null);
  const isHistoryNavigationRef = useRef(false);

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
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsThemeMenuOpen(false);
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
    try {
      if (!localStorage.getItem(DASHBOARD_PREFS_KEY)) {
        localStorage.setItem(
          DASHBOARD_PREFS_KEY,
          JSON.stringify({
            searchTerm: "",
            worldviewFilter: "全部",
            genderFilter: "全部",
            visualStyleFilter: "全部",
            favoriteMode: "all",
            viewMode: developerSettings.dashboardDefaults.viewMode,
            sortMode: developerSettings.dashboardDefaults.sortMode,
          }),
        );
      }
    } catch {
      // Storage unavailable: the dashboard falls back to its own defaults.
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
    localStorage.clear();
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
    window.history.replaceState({ characterStudioPage: initialPage }, "", window.location.href);

    function handlePopState(event: PopStateEvent) {
      isHistoryNavigationRef.current = true;
      const nextPage = event.state?.characterStudioPage;
      setPage(
        nextPage === "form" || nextPage === "preview" || nextPage === "developer"
          ? nextPage
          : "dashboard",
      );
      setIsAppAboutOpen(false);
      setIsFirstAboutOpen(false);
      setIsAppSettingsOpen(false);
      setIsAppAssetLibraryOpen(false);
    }

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  useEffect(() => {
    if (isHistoryNavigationRef.current) {
      isHistoryNavigationRef.current = false;
      return;
    }

    window.history.pushState(
      { characterStudioPage: page },
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

    window.requestAnimationFrame(() => {
      window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    });
  }, [page, selectedCharacter?.id]);

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

  function handleDelete(character: Character) {
    const nextCharacters = deleteCharacter(character.id);
    setCharacters(nextCharacters);
    pruneCharacterReferences(nextCharacters.map((entry) => entry.id));

    if (selectedCharacter?.id === character.id) {
      setSelectedCharacter(null);
    }
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

  function handleBulkDelete(characterIds: string[]) {
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

  function goDashboard() {
    closeAppOverlays();
    setPage("dashboard");
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
        <button className="brand-button" onClick={goDashboard}>
          <svg className="brand-mark" aria-hidden="true" viewBox="0 0 566.43 637.56">
            <polygon className="brand-mark-primary" points="0 163.51 283.22 0 476.31 111.48 386.19 163.51 283.22 104.06 90.12 215.55 90.12 438.51 254.62 533.49 254.62 637.56 0 490.54 0 163.51" />
            <polygon className="brand-mark-accent" points="311.79 533.49 476.31 438.51 476.31 215.55 566.43 163.51 566.43 490.54 311.79 637.56 311.79 533.49" />
          </svg>
          Character Studio
        </button>
        <div className="nav-actions">
          <button className="ghost-button" onClick={goDashboard}>
            Dashboard
          </button>
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
              dashboardDefaults: {
                ...developerSettings.dashboardDefaults,
                ...(patch.dashboardDefaults ?? {}),
              },
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
          onToggleFavorite={() => handleToggleFavorite(selectedCharacter)}
          exportSignal={previewExportSignal}
        />
      )}

      {page === "world" && (
        <WorldManager
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
      {page === "timeline" && (
        <Timeline
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
      {page === "relationships" && (
        <RelationshipGraph
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
        {isAppOverlayOpen && (
          <button
            aria-label="返回"
            className="floating-action"
            data-tooltip="返回"
            onClick={closeAppOverlays}
            type="button"
          >
            <Icon name="arrowLeft" />
          </button>
        )}
        {isAppOverlayOpen && (
          <button
            aria-label="回到主页"
            className="floating-action"
            data-tooltip="回到主页"
            onClick={goDashboard}
            type="button"
          >
            <Icon name="home" />
          </button>
        )}
        {!isAppOverlayOpen && page === "dashboard" && showQuickBackToTop && (
          <button
            aria-label="新建角色"
            className="floating-action"
            data-tooltip="新建角色"
            onClick={handleCreate}
            type="button"
          >
            <Icon name="plus" />
          </button>
        )}
        {!isAppOverlayOpen && page === "dashboard" && showQuickBackToTop && (
          <button
            aria-label="搜索 / 筛选"
            className="floating-action"
            data-tooltip="搜索 / 筛选"
            onClick={() => setDashboardSearchSignal((current) => current + 1)}
            type="button"
          >
            <Icon name="search" />
          </button>
        )}
        {!isAppOverlayOpen && page !== "dashboard" && (
          <button
            aria-label="回到主页"
            className="floating-action"
            data-tooltip="回到主页"
            onClick={goDashboard}
            type="button"
          >
            <Icon name="home" />
          </button>
        )}
        {!isAppOverlayOpen && page === "preview" && selectedCharacter && (
          <button
            aria-label="编辑角色"
            className="floating-action"
            data-tooltip="编辑角色"
            onClick={() => handleEdit(selectedCharacter)}
            type="button"
          >
            <Icon name="pencil" />
          </button>
        )}
        {!isAppOverlayOpen && page === "preview" && selectedCharacter && (
          <button
            aria-label="导出"
            className="floating-action"
            data-tooltip="导出"
            onClick={() => setPreviewExportSignal((current) => current + 1)}
            type="button"
          >
            <Icon name="download" />
          </button>
        )}
      </div>

      {page !== "dashboard" && (
        <footer className="dashboard-footer app-footer" data-pdf-hidden="true">
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
                <p className="eyebrow">Settings</p>
                <h2>设置</h2>
              </div>
              <button className="ghost-button" onClick={() => setIsAppSettingsOpen(false)} type="button">
                关闭
              </button>
            </div>
            <div className="settings-grid">
              <article>
                <h3>Appearance</h3>
                <div className="segmented-row">
                  {(["system", "light", "dark"] as const).map((mode) => (
                    <button
                      className={themeMode === mode ? "active" : ""}
                      key={mode}
                      onClick={() => setThemeMode(mode)}
                      type="button"
                    >
                      {mode === "system" ? "Follow System" : mode === "light" ? "Light" : "Dark"}
                    </button>
                  ))}
                </div>
              </article>
              {developerSettings.featureFlags.aiSettings && (
              <article className="ai-settings-card">
                <div className="settings-card-head">
                  <h3>AI 设置 / AI Settings</h3>
                  <span className="status-badge">🚧 Coming Soon</span>
                </div>
                <p className="muted">面向所有用户，开发中。当前不会调用 AI，也不会上传任何用户数据；未来可填写自己的 API Key。</p>
                <div className="settings-form-grid">
                  <label>
                    Provider
                    <select defaultValue={localStorage.getItem("character-studio.ai.provider") || "custom"} onChange={(event) => localStorage.setItem("character-studio.ai.provider", event.target.value)}>
                      <option value="custom">Custom</option>
                      <option value="openai">OpenAI Compatible</option>
                    </select>
                  </label>
                  <label>
                    API Key
                    <input disabled placeholder="功能未启用，暂不可填写" type="password" />
                  </label>
                  <label>
                    Base URL
                    <input placeholder="https://api.example.com/v1" defaultValue={localStorage.getItem("character-studio.ai.base-url") || ""} onChange={(event) => localStorage.setItem("character-studio.ai.base-url", event.target.value)} />
                  </label>
                  <label>
                    Model
                    <input placeholder="model-name" defaultValue={localStorage.getItem("character-studio.ai.model") || ""} onChange={(event) => localStorage.setItem("character-studio.ai.model", event.target.value)} />
                  </label>
                  <label>
                    Temperature
                    <input type="number" min="0" max="2" step="0.1" defaultValue={localStorage.getItem("character-studio.ai.temperature") || "0.8"} onChange={(event) => localStorage.setItem("character-studio.ai.temperature", event.target.value)} />
                  </label>
                  <label>
                    Top P
                    <input type="number" min="0" max="1" step="0.05" defaultValue={localStorage.getItem("character-studio.ai.top-p") || "1"} onChange={(event) => localStorage.setItem("character-studio.ai.top-p", event.target.value)} />
                  </label>
                  <label>
                    Max Tokens
                    <input type="number" min="1" step="1" defaultValue={localStorage.getItem("character-studio.ai.max-tokens") || "1200"} onChange={(event) => localStorage.setItem("character-studio.ai.max-tokens", event.target.value)} />
                  </label>
                  <label className="settings-check">
                    <input type="checkbox" defaultChecked={localStorage.getItem("character-studio.ai.streaming") === "true"} onChange={(event) => localStorage.setItem("character-studio.ai.streaming", String(event.target.checked))} />
                    <span>Streaming</span>
                  </label>
                </div>
                <button className="ghost-button" disabled type="button">连接测试 / Connection Test</button>
              </article>
              )}
              <article>
                <h3>About Data</h3>
                <p className="muted">当前数据保存在浏览器 localStorage。换设备不会自动同步。</p>
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
                  本地头像素材 {avatarAssetStats.count} 个，占用约 {formatAssetSize(avatarAssetStats.size)}。轻量 JSON 不包含头像图片二进制。
                </p>
                <p className="muted">图片只保存在当前浏览器 IndexedDB，换设备不会自动同步。</p>
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
            <p>确定要清空角色、设置和所有本地头像素材吗？此操作不可撤销。</p>
            <div className="form-actions">
              <button className="ghost-button" onClick={() => setIsAppClearDataOpen(false)} type="button">
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
