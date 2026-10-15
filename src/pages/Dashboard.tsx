import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { AiSettingsForm } from "../components/AiSettingsForm";
import { AvatarDisplay } from "../components/AvatarDisplay";
import { Icon } from "../components/Icon";
import { APP_BUILD_DATE, APP_COMMIT_SHORT, APP_SPRINT, APP_VERSION, RELEASE_YEAR } from "../config/version";
import type { Character } from "../types/character";
import {
  exportAllCharactersJson,
  exportCharacterSnapshot,
  exportCharacterSnapshotsZip,
  exportCharacterJson,
  exportCharactersCsv,
  exportFullBackupZip,
  exportSelectedCharactersJson,
  commitCharacterImport,
  prepareCharacterImport,
  type PreparedCharacterImport,
} from "../utils/importExport";
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
} from "../utils/avatarAssets";
import { createSnapshot, readSnapshot, writeSnapshot, type LocalSnapshot } from "../storage/backup";
import { readWorkspaceDatasets } from "../storage/workspaceBackup";
import {
  applyBulkPatch,
  describeBulkPatch,
  isEmptyBulkPatch,
  parseTagInput,
  type CharacterBulkPatch,
} from "../utils/bulkEdit";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { useDashboardLayers } from "../hooks/useDashboardLayers";
import { useDashboardPrefs } from "../hooks/useDashboardPrefs";
import {
  clearedFilters,
  defaultPrefs,
  loadDashboardFlags,
  saveDashboardFlags,
  type DashboardFlags,
  type DashboardPrefs,
  type ScopeMode,
  type SortMode,
  type ViewMode,
} from "../storage/dashboardPrefs";
import { defaultContent } from "../content/defaultContent";

type DashboardProps = {
  characters: Character[];
  projectInfo?: {
    version: string;
    sprint: string;
    build: string;
    releaseYear: string;
  };
  contentText?: {
    aboutTitle: string;
    aboutSummary: string;
    firstAboutTagline: string;
    importGuide: string;
    exportGuide: string;
    dialogCopy: string;
    privacy: string;
    license: string;
  };
  dashboardSettings?: {
    viewMode: ViewMode;
    sortMode: SortMode;
    cardTagCount: number;
    showDraftCount: boolean;
    showFavoriteCount: boolean;
    showUpdatedTime: boolean;
  };
  aiSettingsEnabled?: boolean;
  assetLibraryEnabled?: boolean;
  onCreate: () => void;
  onEdit: (character: Character) => void;
  onPreview: (character: Character) => void;
  onDelete: (character: Character) => void;
  onDuplicate: (character: Character) => void;
  onBulkDelete: (characterIds: string[]) => void;
  onBulkDuplicate: (characters: Character[]) => void;
  onImport: (characters: Character[]) => void;
  onPromoteDraft: (character: Character) => void;
  onToggleFavorite: (character: Character) => void;
  isLoading?: boolean;
  onToggleTheme: () => void;
  themeMode: ThemeMode;
  onSetThemeMode: (themeMode: ThemeMode) => void;
  searchSignal?: number;
  // A request from another screen to clear the filters. The dashboard owns the
  // preferences, so it applies the change and persists it like any other edit.
  filtersResetSignal?: number;
  filtersResetFavoriteMode?: "all" | "drafts";
  footerText?: string;
  // Flattened view of the settings this screen needs, plus a patch callback, so
  // the dashboard edits the single settings object instead of its own keys.
  editorSettings?: { compactMobileEditor: boolean };
  onDashboardSettingsChange?: (patch: {
    editorDefaults?: Partial<{ compactMobileEditor: boolean }>;
    exportDefaults?: Partial<{ jpgQuality: number; pdfLightMode: boolean }>;
  }) => void;
  exportSettings?: { jpgQuality: number; pngScale: number; pdfLightMode: boolean };
  onOpenRelationships?: () => void;
  onOpenTimeline?: () => void;
  onOpenWorld?: () => void;
};

type ThemeMode = "system" | "light" | "dark";
type CharacterExportScope = "all" | "selected";
type CharacterExportChoice = "json" | "zip" | "csv" | "pdf" | "jpg" | "png";
// Past this many characters the card view groups its cards by worldview, because a
// single flat wall of them stops being scannable. A presentation threshold only:
// the search panel is never opened on arrival, at any roster size.
const LARGE_ROSTER = 30;

export function Dashboard({
  characters,
  projectInfo = {
    version: APP_VERSION,
    sprint: APP_SPRINT,
    build: RELEASE_YEAR,
    releaseYear: RELEASE_YEAR,
  },
  // defaultContent is the single source for this copy; a hand-kept copy here
  // drifted from it as soon as a field was added.
  contentText = defaultContent,
  dashboardSettings,
  aiSettingsEnabled = true,
  assetLibraryEnabled = true,
  onCreate,
  onEdit,
  onPreview,
  onDelete,
  onDuplicate,
  onBulkDelete,
  onBulkDuplicate,
  onImport,
  onPromoteDraft,
  onToggleFavorite,
  isLoading = false,
  onToggleTheme,
  themeMode,
  onSetThemeMode,
  searchSignal = 0,
  filtersResetSignal = 0,
  filtersResetFavoriteMode = "all",
  footerText = `RINTO © ${RELEASE_YEAR}`,

  onDashboardSettingsChange,
  exportSettings,
  onOpenRelationships,
  onOpenTimeline,
  onOpenWorld,
  editorSettings,}: DashboardProps) {
  const [pendingDelete, setPendingDelete] = useState<Character | null>(null);
  // The hero drops its copy once the roster starts scrolling: the title is worth
  // reading once, the controls are worth having throughout, and the toolbar is what
  // has to stay reachable on a hundred-character list.
  const [isCondensedHeader, setIsCondensedHeader] = useState(false);

  useEffect(() => {
    function handleScroll() {
      setIsCondensedHeader(window.scrollY > 72);
    }

    handleScroll();
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);
  const [isBulkDeleteOpen, setIsBulkDeleteOpen] = useState(false);
  // Bulk editing: every field is opt-in, so an edit only touches what is switched on.
  const [isBulkEditOpen, setIsBulkEditOpen] = useState(false);
  const [bulkDraft, setBulkDraft] = useState({
    worldviewOn: false,
    worldview: "",
    visualStyleOn: false,
    visualStyle: "",
    favoriteOn: false,
    favorite: true,
    addTagsOn: false,
    addTags: "",
    removeTagsOn: false,
    removeTags: "",
  });
  const [isMoreMenuOpen, setIsMoreMenuOpen] = useState(false);
  // Folded on arrival, in every case, and the dashboard is the only thing that
  // opens it. Three separate writers used to force it open on entry — the setting
  // below, that same setting's checkbox in Settings, and an effect that expanded
  // the panel once the roster passed LARGE_ROSTER — so "closed" was not a state a
  // reader could rely on. Folded is an invariant here, not a default: there is
  // deliberately no way to store an "open on arrival" preference, because one
  // would have to lose to this line.
  const [isSearchPanelOpen, setIsSearchPanelOpen] = useState(false);
  const [isBulkMode, setIsBulkMode] = useState(false);
  const [openCardMenuId, setOpenCardMenuId] = useState<string | null>(null);
  const [exportTarget, setExportTarget] = useState<Character | null>(null);
  const [isBulkExportOpen, setIsBulkExportOpen] = useState(false);
  const [isBulkMoreOpen, setIsBulkMoreOpen] = useState(false);
  const [characterExportScope, setCharacterExportScope] = useState<CharacterExportScope | null>(null);
  const [characterExportChoice, setCharacterExportChoice] = useState<CharacterExportChoice>("json");
  const [isCommandOpen, setIsCommandOpen] = useState(false);
  const [isAboutOpen, setIsAboutOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isAssetLibraryOpen, setIsAssetLibraryOpen] = useState(false);
  const [importPlan, setImportPlan] = useState<PreparedCharacterImport | null>(null);
  const [isImportDetailOpen, setIsImportDetailOpen] = useState(false);
  const [isClearDataOpen, setIsClearDataOpen] = useState(false);
  const [isAssetCleanupOpen, setIsAssetCleanupOpen] = useState(false);
  const [pendingRestore, setPendingRestore] = useState<LocalSnapshot | null>(null);
  const [pendingAssetDelete, setPendingAssetDelete] = useState<AvatarAssetRecord | null>(null);
  const [pendingAssetBatchDeleteIds, setPendingAssetBatchDeleteIds] = useState<string[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectedAssetIds, setSelectedAssetIds] = useState<string[]>([]);
  const [avatarAssets, setAvatarAssets] = useState<AvatarAssetRecord[]>([]);
  const [avatarAssetStats, setAvatarAssetStats] = useState({ count: 0, size: 0 });
  const [prefs, setPrefs] = useDashboardPrefs({
    resetSignal: filtersResetSignal,
    resetFavoriteMode: filtersResetFavoriteMode,
  });
  const [flags, setFlags] = useState<DashboardFlags>(loadDashboardFlags);
  const [undoCharacter, setUndoCharacter] = useState<Character | null>(null);
  const [toastMessage, setToastMessage] = useState("");
  const [toastType, setToastType] = useState<
    "success" | "warning" | "error" | "loading"
  >("success");
  const [loadingAction, setLoadingAction] = useState<string | null>(null);
  const [exportProgress, setExportProgress] = useState("");
  const undoTimerRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const assetImportInputRef = useRef<HTMLInputElement>(null);
  const moreMenuRef = useRef<HTMLDivElement>(null);
  const cardMenuRef = useRef<HTMLDivElement>(null);
  const exportDialogRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchSignalRef = useRef(searchSignal);
  const cardTagLimit = Math.max(0, Math.min(dashboardSettings?.cardTagCount ?? 5, 8));

  // One switch, read once, used by the table header and the table cell.
  //
  // The header used to render unconditionally while the cell was conditional, so
  // hiding the time left a column with a title and no data -- and pushed every
  // later column one track to the left, which is what "the action column is not
  // aligned" turned out to be. Gating both from the same value is what stops the
  // two from ever disagreeing again.
  const showUpdatedTime = dashboardSettings?.showUpdatedTime !== false;

  // Every layer the dashboard can have on top of it, declared once.
  //
  // Escape dismisses all of them; only `blocksMenus` differs, so that is what each
  // entry states. The order is the order the Escape handler used to run them.
  //
  // The four entries marked below are where the three old hand-written lists
  // disagreed. All four now take the same rules as everything else:
  //
  //   - `character-delete` and `bulk-delete` used to refuse Escape while the two
  //     destructive confirmations that are worse (`clear-data`, `asset-delete`)
  //     accepted it. Escape on a confirmation means cancel, so refusing it never
  //     protected anything -- it only removed the keyboard way out.
  //   - `bulk-edit` and `restore-snapshot` were in none of the old lists, so Escape
  //     did not close them and the background menus did not close behind them
  //     either. Both are modals and now say so.
  const layers = useDashboardLayers([
    // Dropdowns and panel toggles: nothing underneath them to suppress.
    { id: "more-menu", open: isMoreMenuOpen, blocksMenus: false, close: () => setIsMoreMenuOpen(false) },
    { id: "card-menu", open: openCardMenuId !== null, blocksMenus: false, close: () => setOpenCardMenuId(null) },
    { id: "search-panel", open: isSearchPanelOpen, blocksMenus: false, close: () => setIsSearchPanelOpen(false) },

    // Modals.
    { id: "export-target", open: Boolean(exportTarget), blocksMenus: true, close: () => setExportTarget(null) },
    { id: "bulk-export", open: isBulkExportOpen, blocksMenus: true, close: () => setIsBulkExportOpen(false) },
    { id: "bulk-more", open: isBulkMoreOpen, blocksMenus: true, close: () => setIsBulkMoreOpen(false) },
    { id: "character-export", open: Boolean(characterExportScope), blocksMenus: true, close: () => setCharacterExportScope(null) },
    { id: "command", open: isCommandOpen, blocksMenus: true, close: () => setIsCommandOpen(false) },
    { id: "about", open: isAboutOpen, blocksMenus: true, close: () => setIsAboutOpen(false) },
    { id: "settings", open: isSettingsOpen, blocksMenus: true, close: () => setIsSettingsOpen(false) },
    { id: "asset-library", open: isAssetLibraryOpen, blocksMenus: true, close: () => setIsAssetLibraryOpen(false) },
    { id: "import-plan", open: Boolean(importPlan), blocksMenus: true, close: () => setImportPlan(null) },
    { id: "clear-data", open: isClearDataOpen, blocksMenus: true, close: () => setIsClearDataOpen(false) },
    { id: "asset-cleanup", open: isAssetCleanupOpen, blocksMenus: true, close: () => setIsAssetCleanupOpen(false) },
    { id: "asset-delete", open: Boolean(pendingAssetDelete), blocksMenus: true, close: () => setPendingAssetDelete(null) },
    { id: "asset-batch-delete", open: pendingAssetBatchDeleteIds.length > 0, blocksMenus: true, close: () => setPendingAssetBatchDeleteIds([]) },
    { id: "bulk-edit", open: isBulkEditOpen, blocksMenus: true, close: () => setIsBulkEditOpen(false) },
    { id: "restore-snapshot", open: Boolean(pendingRestore), blocksMenus: true, close: () => setPendingRestore(null) },

    // Destructive character confirmations. Escape cancels them, like every other
    // confirmation; see the note above.
    { id: "character-delete", open: Boolean(pendingDelete), blocksMenus: true, close: () => setPendingDelete(null) },
    { id: "bulk-delete", open: isBulkDeleteOpen, blocksMenus: true, close: () => setIsBulkDeleteOpen(false) },

    // Modes and selection: nothing to suppress.
    { id: "bulk-mode", open: isBulkMode, blocksMenus: false, close: () => setIsBulkMode(false) },
    { id: "selection", open: selectedIds.length > 0, blocksMenus: false, close: () => setSelectedIds([]) },
  ]);

  const worldviewOptions = getUniqueOptions(characters, "worldview");
  const genderOptions = getUniqueOptions(characters, "gender");
  const visualStyleOptions = getUniqueOptions(characters, "visualStyle");
  const visibleCharacters = getVisibleCharacters(
    characters,
    prefs,
    flags,
  );


  // A hundred cards in one column is a scroll, not a list. Past this size the card
  // view groups itself by worldview, with a header per group that can be folded.
  // On a phone the five dropdowns are hidden behind one disclosure: the search field
  // stays, because that is what a long roster is actually navigated with, and the
  // panel used to put 420px of selects in front of the list.
  const isNarrowScreen = useMediaQuery("(max-width: 720px)");
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);
  const activeFilterCount =
    (prefs.favoriteMode !== "all" ? 1 : 0) +
    (prefs.worldviewFilter !== "全部" ? 1 : 0) +
    (prefs.genderFilter !== "全部" ? 1 : 0) +
    (prefs.visualStyleFilter !== "全部" ? 1 : 0) +
    (prefs.sortMode !== "updated-desc" ? 1 : 0);
  const worldviewSuggestions = useMemo(
    () =>
      [...new Set(characters.map((entry) => (entry.worldview || "").trim()).filter(Boolean))].sort((a, b) =>
        a.localeCompare(b, "zh"),
      ),
    [characters],
  );
  const visualStyleSuggestions = useMemo(
    () =>
      [...new Set(characters.map((entry) => (entry.visualStyle || "").trim()).filter(Boolean))].sort((a, b) =>
        a.localeCompare(b, "zh"),
      ),
    [characters],
  );
  const [isGroupedCards, setIsGroupedCards] = useState(true);
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const groupedCards = isGroupedCards && visibleCharacters.length > LARGE_ROSTER;

  const cardRows = useMemo(() => {
    type Row =
      | { kind: "head"; group: string; count: number }
      | { kind: "card"; character: Character };

    if (!groupedCards) {
      return visibleCharacters.map((character): Row => ({ kind: "card", character }));
    }

    const buckets = new Map<string, Character[]>();
    for (const character of visibleCharacters) {
      const key = (character.worldview || "").trim() || "未填写世界观";
      const bucket = buckets.get(key);
      if (bucket) {
        bucket.push(character);
      } else {
        buckets.set(key, [character]);
      }
    }

    // Biggest group first: the group an author is most likely to be working in.
    const groups = [...buckets.entries()]
      .map(([group, characters]) => ({ group, characters }))
      .sort((a, b) => b.characters.length - a.characters.length || a.group.localeCompare(b.group, "zh"));

    const rows: Row[] = [];
    for (const entry of groups) {
      rows.push({ kind: "head", group: entry.group, count: entry.characters.length });
      if (collapsedGroups[entry.group] !== true) {
        for (const character of entry.characters) {
          rows.push({ kind: "card", character });
        }
      }
    }
    return rows;
  }, [collapsedGroups, groupedCards, visibleCharacters]);
  const hasActiveSearchOrFilter =
    prefs.searchTerm.trim() ||
    prefs.worldviewFilter !== "全部" ||
    prefs.genderFilter !== "全部" ||
    prefs.visualStyleFilter !== "全部" ||
    prefs.favoriteMode !== "all";
  const hasSearchOrFilter = Boolean(
    prefs.searchTerm.trim() ||
    prefs.worldviewFilter !== "全部" ||
    prefs.genderFilter !== "全部" ||
    prefs.visualStyleFilter !== "全部",
  );
  const heroCopy = getHeroCopy(prefs.favoriteMode);
  const listTitle = getListTitle(prefs, hasSearchOrFilter);
  const stats = getDashboardStats(characters, flags);
  const isFavoriteView = prefs.favoriteMode === "favorites";
  const isDraftView = prefs.favoriteMode === "drafts";

  // Developer defaults are a starting point, not a policy.
  //
  // This used to copy `viewMode` and `sortMode` out of the defaults on every run,
  // including the mount that happens when the author comes back from the editor.
  // Combined with the effect that persists `prefs`, it wrote the default straight
  // over the author's choice: switch to the list view, edit one character, come
  // back, and the dashboard was showing cards again. The defaults are applied only
  // when the developer actually changes one, which is also what keeps the two
  // controls in the developer centre honest instead of inert.
  const appliedDefaultsRef = useRef<{ viewMode?: ViewMode; sortMode?: SortMode }>({});
  const nextViewMode = dashboardSettings?.viewMode;
  const nextSortMode = dashboardSettings?.sortMode;

  useEffect(() => {
    if (!dashboardSettings) {
      return;
    }

    const previous = appliedDefaultsRef.current;
    appliedDefaultsRef.current = { viewMode: nextViewMode, sortMode: nextSortMode };

    const changed: Partial<DashboardPrefs> = {};
    if (previous.viewMode !== undefined && previous.viewMode !== nextViewMode) {
      changed.viewMode = nextViewMode;
    }
    if (previous.sortMode !== undefined && previous.sortMode !== nextSortMode) {
      changed.sortMode = nextSortMode;
    }

    if (Object.keys(changed).length > 0) {
      setPrefs((current) => ({ ...current, ...changed }));
    }
  }, [dashboardSettings, nextSortMode, nextViewMode]);

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      if (
        moreMenuRef.current &&
        !moreMenuRef.current.contains(event.target as Node)
      ) {
        setIsMoreMenuOpen(false);
      }
      if (
        cardMenuRef.current &&
        !cardMenuRef.current.contains(event.target as Node) &&
        !exportDialogRef.current?.contains(event.target as Node)
      ) {
        setOpenCardMenuId(null);
        setExportTarget(null);
        setIsBulkExportOpen(false);
        setIsBulkMoreOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        layers.dismiss();
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
    // `dismiss` is stable, so this still registers exactly one listener.
  }, [layers.dismiss]);

  useEffect(() => {
    function handleKeyboardShortcuts(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const isTyping =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.tagName === "SELECT";

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setIsCommandOpen((current) => !current);
        return;
      }

      if (isTyping) {
        return;
      }

      if (event.key.toLowerCase() === "n") {
        event.preventDefault();
        onCreate();
      }

      if (event.key === "/") {
        event.preventDefault();
        setIsSearchPanelOpen(true);
        window.setTimeout(() => searchInputRef.current?.focus(), 0);
      }
    }

    document.addEventListener("keydown", handleKeyboardShortcuts);
    return () => document.removeEventListener("keydown", handleKeyboardShortcuts);
  }, [onCreate]);



  // A dropdown has no business staying open behind a dialog. Which layers count is
  // declared above; the signature stands in for the fifteen values this effect used
  // to depend on, so it re-runs on the same changes it always did.
  useEffect(() => {
    if (layers.blocksMenus) {
      setIsMoreMenuOpen(false);
      setOpenCardMenuId(null);
    }
  }, [layers.blockingSignature, layers.blocksMenus]);

  useEffect(() => {
    if (!isSettingsOpen && !isAssetLibraryOpen) {
      return;
    }

    void refreshAvatarAssetStats();
  }, [isSettingsOpen, isAssetLibraryOpen]);

  useEffect(() => {
    if (searchSignal === searchSignalRef.current) {
      return;
    }

    searchSignalRef.current = searchSignal;
    setIsSearchPanelOpen(true);
    window.setTimeout(() => searchInputRef.current?.focus(), 0);
  }, [searchSignal]);

  useEffect(() => {
    saveDashboardFlags(flags);
  }, [flags]);

  useEffect(() => {
    if (flags.favoriteIds.length === 0) {
      return;
    }

    const legacyFavoriteIds = new Set(flags.favoriteIds);
    const nextCharacters = characters.map((character) =>
      legacyFavoriteIds.has(character.id) && !character.isDraft
        ? { ...character, favorite: true, isFavorite: undefined }
        : character,
    );

    onImport(nextCharacters);
    setFlags((current) => ({ ...current, favoriteIds: [] }));
  }, [characters, flags.favoriteIds, onImport]);

  function showToast(
    message: string,
    type: "success" | "warning" | "error" | "loading" = "success",
  ) {
    setToastType(type);
    setToastMessage(message);
    window.setTimeout(() => setToastMessage(""), 2200);
  }

  function showUndoToast(character: Character) {
    if (undoTimerRef.current) {
      window.clearTimeout(undoTimerRef.current);
    }

    setUndoCharacter(character);
    setToastMessage("角色已删除。");
    undoTimerRef.current = window.setTimeout(() => {
      setToastMessage("");
      setUndoCharacter(null);
      undoTimerRef.current = null;
    }, 10000);
    window.setTimeout(() => {
      const undoButton = document.querySelector<HTMLButtonElement>(
        "[data-undo-delete='true']",
      );
      undoButton?.focus();
    }, 0);
  }

  function restoreDeletedCharacter(character: Character) {
    onImport([character, ...characters]);

    if (undoTimerRef.current) {
      window.clearTimeout(undoTimerRef.current);
      undoTimerRef.current = null;
    }

    showToast("角色已恢复");
    setUndoCharacter(null);
  }

  function confirmDelete() {
    if (!pendingDelete) {
      return;
    }

    const deletedCharacter = pendingDelete;
    onDelete(deletedCharacter);
    setSelectedIds((current) =>
      current.filter((id) => id !== deletedCharacter.id),
    );
    setPendingDelete(null);
    showUndoToast(deletedCharacter);
  }

  function selectedCharacters() {
    return characters.filter((character) => selectedIds.includes(character.id));
  }

  function toggleSelected(characterId: string) {
    setSelectedIds((current) =>
      current.includes(characterId)
        ? current.filter((id) => id !== characterId)
        : [...current, characterId],
    );
  }

  function enterBulkMode() {
    setIsBulkMode(true);
  }

  function exitBulkMode() {
    setIsBulkMode(false);
    setSelectedIds([]);
  }

  function toggleSelectAll() {
    setSelectedIds((current) =>
      current.length === visibleCharacters.length
        ? []
        : visibleCharacters.map((character) => character.id),
    );
  }

  function handleBulkDuplicate() {
    const selected = selectedCharacters();

    if (selected.length === 0) {
      showToast("请先选择角色");
      return;
    }

    onBulkDuplicate(selected);
    setSelectedIds([]);
    setIsBulkMode(false);
    showToast(`已复制 ${selected.length} 个角色`);
  }

  function updateBulkDraft(patch: Partial<typeof bulkDraft>) {
    setBulkDraft((current) => ({ ...current, ...patch }));
  }

  function applyBulkEdit() {
    if (selectedIds.length === 0) {
      showToast("请先选择角色");
      return;
    }

    const patch: CharacterBulkPatch = {};
    if (bulkDraft.worldviewOn && bulkDraft.worldview.trim()) {
      patch.worldview = bulkDraft.worldview;
    }
    if (bulkDraft.visualStyleOn && bulkDraft.visualStyle.trim()) {
      patch.visualStyle = bulkDraft.visualStyle;
    }
    if (bulkDraft.favoriteOn) {
      patch.favorite = bulkDraft.favorite;
    }
    if (bulkDraft.addTagsOn) {
      patch.addTags = parseTagInput(bulkDraft.addTags);
    }
    if (bulkDraft.removeTagsOn) {
      patch.removeTags = parseTagInput(bulkDraft.removeTags);
    }

    if (isEmptyBulkPatch(patch)) {
      showToast("请先勾选要修改的字段");
      return;
    }

    const result = applyBulkPatch(characters, selectedIds, patch);
    onImport(result.characters);
    setIsBulkEditOpen(false);

    const parts = describeBulkPatch(result.fieldCounts);
    showToast(
      parts.length > 0
        ? `已更新 ${result.changedCount} 个角色（${parts.join(" · ")}）`
        : "选中的角色不需要修改",
    );
  }

  function confirmBulkDelete() {
    if (selectedIds.length === 0) {
      showToast("请先选择角色");
      setIsBulkDeleteOpen(false);
      return;
    }

    onBulkDelete(selectedIds);
    showToast(`已删除 ${selectedIds.length} 个角色`, "warning");
    setSelectedIds([]);
    setIsBulkMode(false);
    setIsBulkDeleteOpen(false);
  }

  function handleExportSelectedJson() {
    const selected = selectedCharacters();

    if (selected.length === 0) {
      showToast("请先选择角色");
      return;
    }

    exportSelectedCharactersJson(selected);
    showToast("选中角色 JSON 已导出");
  }

  async function handleExportSelectedFullBackup() {
    const selected = selectedCharacters();

    if (selected.length === 0) {
      showToast("请先选择角色");
      return;
    }

    setLoadingAction("selected-full-backup");

    try {
      await exportFullBackupZip(selected, readWorkspaceDatasets());
      showToast("选中角色完整备份 ZIP 已导出", "success");
    } catch {
      showToast("完整备份导出失败", "error");
    } finally {
      setLoadingAction(null);
    }
  }

  function openCharacterExportDialog(scope: CharacterExportScope) {
    if (scope === "selected" && selectedCharacters().length === 0) {
      showToast("请先选择角色", "warning");
      return;
    }

    if (scope === "all" && characters.length === 0) {
      showToast("暂无角色可导出", "warning");
      return;
    }

    setCharacterExportChoice("json");
    setCharacterExportScope(scope);
    setIsBulkExportOpen(false);
    setIsMoreMenuOpen(false);
  }

  async function startCharacterExport() {
    const scope = characterExportScope;
    const choice = characterExportChoice;

    if (!scope) {
      return;
    }

    if (scope === "selected") {
      if (choice === "json") {
        handleExportSelectedJson();
      } else if (choice === "zip") {
        await handleExportSelectedFullBackup();
      } else if (choice === "pdf" || choice === "jpg" || choice === "png") {
        await handleBulkSnapshotExport(choice);
      }
    } else if (choice === "json") {
      handleExportAllJson();
    } else if (choice === "zip") {
      await handleExportFullBackup();
    } else if (choice === "csv") {
      handleExportCsv();
    }

    setCharacterExportScope(null);
  }

  async function handleExportCharacterJson(character: Character) {
    try {
      await exportCharacterJson(character);
      showToast("当前角色 JSON 已导出");
    } catch {
      showToast("当前角色 JSON 导出失败", "error");
    }
  }

  async function handleCardExport(format: "json" | "pdf" | "jpg" | "png") {
    if (!exportTarget) {
      return;
    }

    const target = exportTarget;
    setExportTarget(null);

    if (format === "json") {
      void handleExportCharacterJson(target);
      return;
    }

    setLoadingAction(`card-${format}`);

    try {
      await exportCharacterSnapshot(target, format);
      showToast(`${format.toUpperCase()} 已导出`);
    } catch {
      showToast(`${format.toUpperCase()} 导出失败`, "error");
    } finally {
      setLoadingAction(null);
    }
  }

  async function handleBulkExport(format: "json" | "pdf" | "jpg" | "png") {
    if (format === "json") {
      handleExportSelectedJson();
      setIsBulkExportOpen(false);
      return;
    }

    setIsBulkExportOpen(false);
    await handleBulkSnapshotExport(format);
  }

  async function handleBulkSnapshotExport(format: "pdf" | "jpg" | "png") {
    const selected = selectedCharacters();

    if (selected.length === 0) {
      showToast("请先选择角色");
      return;
    }

    setLoadingAction(`bulk-${format}`);
    setExportProgress(`0 / ${selected.length}`);

    try {
      const result = await exportCharacterSnapshotsZip(selected, format, (current, total) => {
        setExportProgress(`${current} / ${total}`);
      });
      showToast(
        result.failedCount > 0
          ? `已完成导出，失败 ${result.failedCount} 个角色。`
          : `选中角色 ${format.toUpperCase()} ZIP 已导出`,
        result.failedCount > 0 ? "warning" : "success",
      );
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : `${format.toUpperCase()} 导出失败`,
        "error",
      );
    } finally {
      setLoadingAction(null);
      setExportProgress("");
    }
  }

  function bulkSetFavorite(shouldFavorite: boolean) {
    if (selectedIds.length === 0) {
      showToast("请先选择角色");
      return;
    }

    const legacyFavoriteIds = new Set(flags.favoriteIds);
    let changedCount = 0;
    let skippedCount = 0;
    const selectedSet = new Set(selectedIds);
    const nextCharacters = characters.map((character) => {
      if (!selectedSet.has(character.id) || character.isDraft) {
        return character;
      }

      const currentFavorite = isCharacterFavorite(character, legacyFavoriteIds);
      if (currentFavorite === shouldFavorite) {
        skippedCount += 1;
        return character;
      }

      changedCount += 1;
      return {
        ...character,
        favorite: shouldFavorite,
        isFavorite: undefined,
      };
    });

    onImport(nextCharacters);
    setFlags((current) => ({
      ...current,
      favoriteIds: current.favoriteIds.filter((id) => !selectedSet.has(id)),
    }));
    setSelectedIds([]);

    if (shouldFavorite) {
      showToast(`新增收藏 ${changedCount} 个，已跳过 ${skippedCount} 个。`);
      return;
    }

    showToast(`已移出收藏 ${changedCount} 个，已跳过 ${skippedCount} 个。`);
  }

  function clearSearchAndFilters() {
    setPrefs((current) => clearedFilters(current, { favoriteMode: "all", resetSort: true }));
  }

  function updatePrefs(nextPrefs: Partial<DashboardPrefs>) {
    setPrefs((current) => ({ ...current, ...nextPrefs }));
  }

  function toggleFavorite(characterId: string) {
    const character = characters.find((item) => item.id === characterId);
    if (!character) {
      return;
    }

    const isFavorite = isCharacterFavorite(character, new Set(flags.favoriteIds));
    onToggleFavorite({
      ...character,
      favorite: isFavorite,
      isFavorite: undefined,
    });
    setFlags((current) => ({
      ...current,
      favoriteIds: current.favoriteIds.filter((id) => id !== characterId),
    }));
    setOpenCardMenuId(null);
    showToast(isFavorite ? "已移出收藏" : "已加入收藏");
  }

  function togglePinned(characterId: string) {
    setFlags((current) => {
      const isPinned = current.pinnedIds.includes(characterId);
      return {
        ...current,
        pinnedIds: isPinned
          ? current.pinnedIds.filter((id) => id !== characterId)
          : [...current.pinnedIds, characterId],
      };
    });
    setOpenCardMenuId(null);
  }

  function handleExportAllJson() {
    if (characters.length === 0) {
      showToast("暂无角色可导出", "warning");
      return;
    }

    setLoadingAction("json");
    setIsMoreMenuOpen(false);
    exportAllCharactersJson(characters);
    showToast("全部角色 JSON 已导出", "success");
    window.setTimeout(() => setLoadingAction(null), 300);
  }

  function handleExportCsv() {
    if (characters.length === 0) {
      showToast("暂无角色可导出", "warning");
      return;
    }

    setLoadingAction("csv");
    setIsMoreMenuOpen(false);
    exportCharactersCsv(characters, readWorkspaceDatasets());
    showToast("CSV 已导出", "success");
    window.setTimeout(() => setLoadingAction(null), 300);
  }

  async function handleExportFullBackup() {
    if (characters.length === 0) {
      showToast("暂无角色可导出", "warning");
      return;
    }

    setLoadingAction("full-backup");
    setIsMoreMenuOpen(false);

    try {
      await exportFullBackupZip(characters, readWorkspaceDatasets());
      showToast("完整备份 ZIP 已导出", "success");
    } catch {
      showToast("完整备份导出失败", "error");
    } finally {
      setLoadingAction(null);
    }
  }

  function openFirstSearchResult() {
    if (visibleCharacters.length > 0) {
      onPreview(visibleCharacters[0]);
    }
  }

  function restoreSnapshot() {
    if (!pendingRestore) {
      return;
    }

    onImport(pendingRestore.characters);
    setPendingRestore(null);
    setIsSettingsOpen(false);
    showToast(`已恢复 ${pendingRestore.characterCount} 个角色`, "success");
  }

  async function clearLocalData() {
    // Clearing wipes the entire list, so keep a recovery copy first.
    const snapshot = createSnapshot("清空本地数据前自动备份", characters);
    localStorage.clear();
    if (snapshot) {
      // localStorage.clear() removed the snapshot as well; write it back.
      writeSnapshot(snapshot);
    }
    await clearAvatarAssets();
    onImport([]);
    setSelectedIds([]);
    setSelectedAssetIds([]);
    setAvatarAssets([]);
    setAvatarAssetStats({ count: 0, size: 0 });
    setIsBulkMode(false);
    setIsClearDataOpen(false);
    setIsSettingsOpen(false);
    clearSearchAndFilters();
    showToast("本地数据已清空", "warning");
  }

  async function handleImportAvatarAssets(file: File | undefined) {
    if (!file) {
      return;
    }

    try {
      const result = await importAvatarAssetsJson(file);
      await refreshAvatarAssetStats();
      showToast(`已导入 ${result.importedCount} 个头像素材，跳过 ${result.skippedCount} 个重复素材`);
    } catch {
      showToast("头像素材导入失败", "error");
    } finally {
      if (assetImportInputRef.current) {
        assetImportInputRef.current.value = "";
      }
    }
  }

  async function refreshAvatarAssetStats() {
    try {
      const [stats, assets] = await Promise.all([
        getAvatarAssetStats(),
        listAvatarAssets(),
      ]);

      setAvatarAssetStats(stats);
      setAvatarAssets(assets);
      setSelectedAssetIds((current) =>
        current.filter((id) => assets.some((asset) => asset.id === id)),
      );
    } catch {
      setAvatarAssetStats({ count: 0, size: 0 });
      setAvatarAssets([]);
      setSelectedAssetIds([]);
    }
  }

  async function confirmAssetCleanup() {
    try {
      const usedAssetIds = characters
        .map((character) => character.avatarAssetId)
        .filter((id): id is string => Boolean(id));
      const removedCount = await cleanupUnusedAvatarAssets(usedAssetIds);

      await refreshAvatarAssetStats();
      setIsAssetCleanupOpen(false);
      showToast(`已清理 ${removedCount} 个未使用头像素材`);
    } catch {
      showToast("清理头像素材失败", "error");
    }
  }

  function getAssetUsageCount(assetId: string) {
    return characters.filter((character) => character.avatarAssetId === assetId).length;
  }

  async function requestAssetDelete(asset: AvatarAssetRecord) {
    if (getAssetUsageCount(asset.id) > 0) {
      setPendingAssetDelete(asset);
      return;
    }

    try {
      await deleteAvatarAsset(asset.id);
      await refreshAvatarAssetStats();
      showToast("头像素材已删除");
    } catch {
      showToast("删除头像素材失败", "error");
    }
  }

  async function confirmAssetDelete() {
    if (!pendingAssetDelete) {
      return;
    }

    try {
      await deleteAvatarAsset(pendingAssetDelete.id);
      const nextCharacters = characters.map((character) =>
        character.avatarAssetId === pendingAssetDelete.id
          ? { ...character, avatarAssetId: "", updatedAt: new Date().toISOString() }
          : character,
      );

      onImport(nextCharacters);
      setPendingAssetDelete(null);
      await refreshAvatarAssetStats();
      showToast("头像素材已删除，相关角色已回退 Emoji");
    } catch {
      showToast("删除头像素材失败", "error");
    }
  }

  function toggleAssetSelected(assetId: string) {
    setSelectedAssetIds((current) =>
      current.includes(assetId)
        ? current.filter((id) => id !== assetId)
        : [...current, assetId],
    );
  }

  function toggleAllAssetsSelected() {
    setSelectedAssetIds((current) =>
      current.length === avatarAssets.length ? [] : avatarAssets.map((asset) => asset.id),
    );
  }

  async function deleteAssets(assetIds: string[]) {
    await Promise.all(assetIds.map((id) => deleteAvatarAsset(id)));
    const deletedSet = new Set(assetIds);
    const nextCharacters = characters.map((character) =>
      character.avatarAssetId && deletedSet.has(character.avatarAssetId)
        ? { ...character, avatarAssetId: "", updatedAt: new Date().toISOString() }
        : character,
    );

    if (nextCharacters.some((character, index) => character !== characters[index])) {
      onImport(nextCharacters);
    }

    setSelectedAssetIds([]);
    await refreshAvatarAssetStats();
  }

  async function deleteSelectedUnusedAssets() {
    const unusedIds = selectedAssetIds.filter((id) => getAssetUsageCount(id) === 0);

    if (unusedIds.length === 0) {
      showToast("没有选中未使用素材", "warning");
      return;
    }

    await deleteAssets(unusedIds);
    showToast(`已删除 ${unusedIds.length} 个未使用头像素材`);
  }

  function requestSelectedAssetDelete() {
    if (selectedAssetIds.length === 0) {
      showToast("请先选择头像素材", "warning");
      return;
    }

    const usedIds = selectedAssetIds.filter((id) => getAssetUsageCount(id) > 0);

    if (usedIds.length > 0) {
      setPendingAssetBatchDeleteIds(selectedAssetIds);
      return;
    }

    void deleteAssets(selectedAssetIds).then(() => showToast("所选头像素材已删除"));
  }

  async function confirmAssetBatchDelete() {
    if (pendingAssetBatchDeleteIds.length === 0) {
      return;
    }

    await deleteAssets(pendingAssetBatchDeleteIds);
    showToast("所选头像素材已删除，相关角色已回退 Emoji");
    setPendingAssetBatchDeleteIds([]);
  }

  function runCommand(command: string) {
    if (command === "create") {
      onCreate();
    }
    if (command === "search") {
      setIsSearchPanelOpen(true);
      window.setTimeout(() => searchInputRef.current?.focus(), 0);
    }
    if (command === "drafts") {
      updatePrefs({ favoriteMode: "drafts" });
    }
    if (command === "favorites") {
      updatePrefs({ favoriteMode: "favorites" });
    }
    if (command === "import") {
      fileInputRef.current?.click();
    }
    if (command === "export") {
      openCharacterExportDialog("all");
    }
    if (command === "theme") {
      onToggleTheme();
    }
    setIsCommandOpen(false);
  }

  async function handleImportJson(files: FileList | null) {
    if (!files?.length) {
      return;
    }

    setLoadingAction("import");
    setIsMoreMenuOpen(false);

    try {
      const nextImportPlan = await prepareCharacterImport(files, characters);
      setImportPlan(nextImportPlan);
      setIsImportDetailOpen(false);
    } catch {
      showToast("导入失败：JSON 文件不合法", "error");
    } finally {
      setLoadingAction(null);

      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  }

  async function confirmImportPlan() {
    if (!importPlan) {
      return;
    }

    setLoadingAction("import");

    try {
      createSnapshot("导入前自动备份", characters);
      const result = await commitCharacterImport(importPlan, characters);
      onImport(result.characters);
      setImportPlan(null);
      await refreshAvatarAssetStats();
      showToast(
        `已导入 ${result.importedCharacterCount} 个角色，${result.importedAvatarCount} 个头像素材，自动绑定 ${result.autoBoundAvatarCount} 个`,
        "success",
      );
    } catch {
      showToast("导入失败：写入数据时出现问题", "error");
    } finally {
      setLoadingAction(null);
    }
  }

  function renderCharacterListPanel() {
    return (
      <div className="panel">

        <div className="section-title">
          <div>
            <h2>{listTitle}</h2>
            <span>
              {visibleCharacters.length} 个角色
              {selectedIds.length > 0 && (
                <span className="selected-count-inline">
                  {" / "}
                  已选 {selectedIds.length} 个
                </span>
              )}
            </span>
          </div>
          {visibleCharacters.length > 0 && (
            <div className="bulk-actions">
              {isBulkMode ? (
                <>
                  <div className="bulk-actions-desktop">
                    <button
                      className="ghost-button"
                      onClick={toggleSelectAll}
                      type="button"
                    >
                      {selectedIds.length === visibleCharacters.length
                        ? "取消全选"
                        : "全选"}
                    </button>
                    <button
                      className="ghost-button"
                      disabled={selectedIds.length === 0}
                      onClick={() => setIsBulkEditOpen(true)}
                      type="button"
                    >
                      批量编辑
                    </button>
                    {!isDraftView && (
                      <>
                        {isFavoriteView ? (
                          <button
                            className="ghost-button"
                            disabled={selectedIds.length === 0}
                            onClick={() => bulkSetFavorite(false)}
                            type="button"
                          >
                            移出收藏
                          </button>
                        ) : (
                          <button
                            className="ghost-button"
                            disabled={selectedIds.length === 0}
                            onClick={() => bulkSetFavorite(true)}
                            type="button"
                          >
                            加入收藏
                          </button>
                        )}
                        <button
                          className="ghost-button"
                          disabled={selectedIds.length === 0 || loadingAction !== null}
                          onClick={() => openCharacterExportDialog("selected")}
                          type="button"
                        >
                          导出
                        </button>
                      </>
                    )}
                    <button
                      className="ghost-button"
                      disabled={selectedIds.length === 0}
                      onClick={handleBulkDuplicate}
                      type="button"
                    >
                      {isDraftView ? "复制" : "批量复制"}
                    </button>
                    <button
                      className="danger-button"
                      disabled={selectedIds.length === 0}
                      onClick={() =>
                        selectedIds.length > 0
                          ? setIsBulkDeleteOpen(true)
                          : showToast("请先选择角色")
                      }
                      type="button"
                    >
                      {isDraftView ? "删除" : "批量删除"}
                    </button>
                    <button
                      className="ghost-button"
                      onClick={exitBulkMode}
                      type="button"
                    >
                      取消选择
                    </button>
                  </div>
                  <div className="mobile-bulk-toolbar">
                    <div className="mobile-bulk-summary">
                      <span>已选择 {selectedIds.length} 个角色</span>
                      <button className="ghost-button" onClick={exitBulkMode} type="button">
                        取消
                      </button>
                    </div>
                    <div className="mobile-bulk-actions">
                       <button className="ghost-button" onClick={toggleSelectAll} type="button">
                         <Icon name="checkSquare" size={15} />
                         {selectedIds.length === visibleCharacters.length ? "取消全选" : "全选"}
                       </button>
                      <button
                        className="ghost-button"
                        disabled={selectedIds.length === 0}
                        onClick={() => setIsBulkEditOpen(true)}
                        type="button"
                      >
                        <Icon name="pencil" size={15} />
                        编辑
                      </button>
                      {!isDraftView && (
                        <button
                          className="ghost-button"
                          disabled={selectedIds.length === 0}
                          onClick={() => bulkSetFavorite(isFavoriteView ? false : true)}
                          type="button"
                        >
                           <Icon name="heart" size={15} />
                           {isFavoriteView ? "移出" : "收藏"}
                        </button>
                      )}
                      {!isDraftView && (
                        <button
                          className="ghost-button"
                          disabled={selectedIds.length === 0 || loadingAction !== null}
                          onClick={() => openCharacterExportDialog("selected")}
                          type="button"
                        >
                           <Icon name="download" size={15} />
                           导出
                         </button>
                      )}
                       <button className="ghost-button" onClick={() => setIsBulkMoreOpen(true)} type="button">
                         <Icon name="more" size={15} />
                         更多
                       </button>
                    </div>
                  </div>
                </>
              ) : (
                <button
                  className="ghost-button bulk-select-button"
                  aria-label="批量选择"
                  data-tooltip="批量选择"
                  onClick={enterBulkMode}
                  type="button"
                >
                   <span className="desktop-label">批量选择</span>
                   <span className="mobile-icon">
                     <Icon name="checkSquare" size={16} />
                   </span>
                 </button>
              )}

            </div>
          )}
        </div>

        {isLoading ? (
          <div className="skeleton-grid">
            {Array.from({ length: 4 }).map((_, index) => (
              <div className="skeleton-card" key={index} />
            ))}
          </div>
        ) : characters.length === 0 ? (
          <div className="empty-state">
            <h3>还没有角色</h3>
            <p>开始创建你的第一个角色。</p>
            <button className="primary-button" onClick={onCreate} type="button">
              新建角色
            </button>
          </div>
        ) : visibleCharacters.length === 0 ? (
          <div className="empty-state">
            <h3>没有找到符合条件的角色。</h3>
            <p>试试调整搜索词或筛选条件。</p>
            <button
              className="ghost-button"
              disabled={!hasActiveSearchOrFilter}
              onClick={clearSearchAndFilters}
              type="button"
            >
              清除筛选
            </button>
          </div>
        ) : (
          <>
          {visibleCharacters.length === 1 && (
            <div className="single-list-note">
              <span>目前只有 1 个角色，可以继续新建来丰富你的角色库。</span>
              <button className="ghost-button" onClick={onCreate} type="button">
                新建角色
              </button>
            </div>
          )}
          {prefs.viewMode === "list" ? (
          <div className="character-table-wrap">
            {/* The column template is driven by the same flag the header and the rows
                read. With a fixed eight-track template, hiding the time column left the
                last track reserved and empty, so the action column sat in the time
                column's track and every row stopped short of the right edge. */}
            <div
              className="character-table"
              style={
                {
                  "--table-columns": showUpdatedTime
                    ? "1.4fr 1fr 1fr 0.6fr 1.2fr 0.8fr 1fr 0.7fr"
                    : "1.4fr 1fr 1fr 0.6fr 1.2fr 0.8fr 0.7fr",
                } as CSSProperties
              }
            >
              <div className="character-table-head">
                <span>角色</span>
                <span>职业</span>
                <span>世界观</span>
                <span>年龄</span>
                <span>标签</span>
                <span>状态</span>
                {showUpdatedTime && <span>最后编辑</span>}
                <span>操作</span>
              </div>
              {visibleCharacters.map((character) => {
                const isFavorite = isCharacterFavorite(character, new Set(flags.favoriteIds));
                const isDraft = character.isDraft === true;
                const isPinned = flags.pinnedIds.includes(character.id);

                return (
                  <div
                    className={
                      openCardMenuId === character.id
                        ? "character-table-row menu-open"
                        : "character-table-row"
                    }
                    key={character.id}
                  >
                    {/* One grid cell, not two: the row is a grid, so the circle and the
                        name have to share the first column rather than push every other
                        column along by one. */}
                    <div className="table-character-cell">
                      {isBulkMode && (
                        <button
                          aria-label={`选择 ${character.name || "未命名角色"}`}
                          className={
                            selectedIds.includes(character.id)
                              ? "select-circle inline selected"
                              : "select-circle inline"
                          }
                          onClick={() => toggleSelected(character.id)}
                          type="button"
                        />
                      )}
                      <button className="table-main" onClick={() => onPreview(character)} type="button">
                      <AvatarDisplay
                        assetId={character.avatarAssetId}
                        className="table-avatar"
                        emoji={character.avatarEmoji || "🙂"}
                      />
                        <strong>{character.name || "未命名角色"}</strong>
                      </button>
                    </div>
                    <span>{character.occupation || "未填写"}</span>
                    <span>{character.worldview || "未填写"}</span>
                    <span>{character.age || "未填写"}</span>
                    <div className="table-tags">
                      {getPersonalityTags(character).slice(0, Math.min(cardTagLimit, 4)).map((tag) => (
                        <button
                          className={`tag-tone-${getTagTone(tag)}`}
                          key={tag}
                          onClick={() => onPreview(character)}
                          type="button"
                        >
                          {tag}
                        </button>
                      ))}
                    </div>
                    {/* The status column said 草稿 / 已收藏 / 正式, which left out the one
                        state the card view does show — a pinned character read as plain
                        正式 here. The badges are the card view's own, so the two views
                        cannot describe the same character differently. */}
                    <span className="table-status">
                      <span className={`status-badge${isDraft ? " draft" : ""}`}>
                        {isDraft ? "草稿" : "正式"}
                      </span>
                      {isPinned && <span className="status-badge pinned">置顶</span>}
                      {isFavorite && <span className="status-badge favorite">收藏</span>}
                    </span>
                    {showUpdatedTime && <span>{formatStamp(character.updatedAt)}</span>}
                    <div className="table-actions">
                      {isBulkMode ? (
                        <button
                          className={
                            selectedIds.includes(character.id)
                              ? "select-circle selected inline"
                              : "select-circle inline"
                          }
                          onClick={() => toggleSelected(character.id)}
                          type="button"
                        />
                      ) : (
                        <>
                          <button
                          aria-label="编辑"
                          className="bare-icon-button table-edit-button"
                          onClick={() => onEdit(character)}
                          title="编辑"
                          type="button"
                        >
                            <Icon name="pencil" size={16} />
                          </button>
                          <div className="card-menu-wrap table-menu-wrap" ref={openCardMenuId === character.id ? cardMenuRef : null}>
                            <button
                              aria-label="更多"
                              className="bare-icon-button"
                              onClick={(event) => {
                                event.stopPropagation();
                                setOpenCardMenuId((current) =>
                                  current === character.id ? null : character.id,
                                );
                              }}
                              type="button"
                            >
                              <Icon name="more" size={16} />
                            </button>
                            {openCardMenuId === character.id && (
                              <div className="card-menu table-card-menu" onClick={(event) => event.stopPropagation()}>
                                <button onClick={() => onPreview(character)} type="button">
                                  <Icon name="eye" size={16} />
                                  预览
                                </button>
                                <button
                                  onClick={() => {
                                    onEdit(character);
                                    setOpenCardMenuId(null);
                                  }}
                                  type="button"
                                >
                                  <Icon name="pencil" size={16} />
                                  编辑
                                </button>
                                {!isDraft && (
                                  <button
                                    onClick={() => toggleFavorite(character.id)}
                                    type="button"
                                  >
                                    {isFavorite ? "移出收藏" : "加入收藏"}
                                  </button>
                                )}
                                <button
                                  onClick={() => {
                                    onDuplicate(character);
                                    setOpenCardMenuId(null);
                                  }}
                                  type="button"
                                >
                                  <Icon name="copy" size={16} />
                                  复制
                                </button>
                                <button
                                  onClick={() => {
                                    setExportTarget(character);
                                    setOpenCardMenuId(null);
                                  }}
                                  type="button"
                                >
                                  <Icon name="download" size={16} />
                                  导出
                                </button>
                                <span className="menu-separator" aria-hidden="true" />
                                <button
                                  className="menu-danger"
                                  onClick={() => {
                                    setPendingDelete(character);
                                    setOpenCardMenuId(null);
                                  }}
                                  type="button"
                                >
                                  <Icon name="trash" size={16} />
                                  删除
                                </button>
                              </div>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          ) : (
          <div className={visibleCharacters.length === 1 ? "card-list single-card-list" : "card-list"}>
            {cardRows.map((row) => {
              if (row.kind === "head") {
                const isCollapsed = collapsedGroups[row.group] === true;
                return (
                  <div className="character-group-head" key={`head-${row.group}`}>
                    <button
                      aria-expanded={!isCollapsed}
                      className={isCollapsed ? "character-group-toggle collapsed" : "character-group-toggle"}
                      onClick={() =>
                        setCollapsedGroups((current) => ({ ...current, [row.group]: !current[row.group] }))
                      }
                      type="button"
                    >
                      <Icon name="chevronDown" size={15} />
                      <span>{row.group}</span>
                      <em>{row.count}</em>
                    </button>
                  </div>
                );
              }

              const character = row.character;
              const tags = getPersonalityTags(character);
              const visibleTags = tags.slice(0, cardTagLimit);
              const isFavorite = isCharacterFavorite(character, new Set(flags.favoriteIds));
              const isPinned = flags.pinnedIds.includes(character.id);
              const isDraft = character.isDraft === true;

              return (
              <article
                className={
                  [
                    "character-card",
                    selectedIds.includes(character.id) ? "selected" : "",
                    isBulkMode ? "bulk-mode" : "",
                    openCardMenuId === character.id ? "menu-open" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")
                }
                key={character.id}
              >
                {isBulkMode && (
                  <button
                    aria-label={`选择 ${character.name || "未命名角色"}`}
                    className={
                      selectedIds.includes(character.id)
                        ? "select-circle selected"
                        : "select-circle"
                    }
                    onClick={(event) => {
                      event.stopPropagation();
                      toggleSelected(character.id);
                    }}
                    type="button"
                  />
                )}
                <div className="card-main">
                  <button
                    aria-label={`预览 ${character.name || "未命名角色"}`}
                    className="avatar-click-target preview-hit"
                    onClick={() => onPreview(character)}
                    type="button"
                  >
                    <AvatarDisplay
                      assetId={character.avatarAssetId}
                      className="avatar-placeholder"
                      emoji={character.avatarEmoji || "🙂"}
                    />
                  </button>
                  <div className="card-copy">
                    <button
                      className="card-title-button preview-hit"
                      onClick={() => onPreview(character)}
                      type="button"
                    >
                      {character.name || "未命名角色"}
                    </button>
                    <button
                      className="card-subtitle-button preview-hit"
                      onClick={() => onPreview(character)}
                      type="button"
                    >
                      {character.occupation || "暂无职业"} ｜{" "}
                      {character.worldview || "暂无世界观"}
                      <span className="card-age-fragment">
                        {" ｜ "}
                        {character.age || "年龄未知"}
                      </span>
                    </button>
                  </div>
                </div>
                {(isDraft || isPinned || tags.length > 0) && (
                  <div className="card-tags" onClick={(event) => event.stopPropagation()}>
                    {isDraft && <span className="status-badge draft">草稿</span>}
                    {!isDraft && isPinned && <span className="status-badge pinned">置顶</span>}
                    {!isDraft && visibleTags.map((tag) => (
                      <button
                        className={`tag-tone-${getTagTone(tag)} preview-hit`}
                        key={tag}
                        onClick={() => onPreview(character)}
                        type="button"
                      >
                        {tag}
                      </button>
                    ))}
                  </div>
                )}
                {!isBulkMode && !isDraft && (
                  <>
                    <div className="card-actions">
                      <button
                        aria-label="编辑"
                        className="bare-icon-button card-edit-button"
                        onClick={(event) => {
                          event.stopPropagation();
                          onEdit(character);
                        }}
                        title="编辑"
                        type="button"
                      >
                        <Icon name="pencil" size={16} />
                      </button>
                      <div className="card-menu-wrap" ref={openCardMenuId === character.id ? cardMenuRef : null}>
                        <button
                          aria-label="更多"
                          className="bare-icon-button"
                          onClick={(event) => {
                            event.stopPropagation();
                            setOpenCardMenuId((current) =>
                              current === character.id ? null : character.id,
                            );
                          }}
                          type="button"
                        >
                          <Icon name="more" size={16} />
                        </button>
                        {openCardMenuId === character.id && (
                          <div className="card-menu" onClick={(event) => event.stopPropagation()}>
                            <button onClick={() => onPreview(character)} type="button">
                              <Icon name="eye" size={16} />
                              预览
                            </button>
                            <button
                              onClick={() => {
                                onEdit(character);
                                setOpenCardMenuId(null);
                              }}
                              type="button"
                            >
                              <Icon name="pencil" size={16} />
                              编辑
                            </button>
                            <button
                              onClick={() => {
                                togglePinned(character.id);
                                setOpenCardMenuId(null);
                              }}
                              type="button"
                            >
                              <Icon name="pin" size={16} />
                              {isPinned ? "取消置顶" : "置顶"}
                            </button>
                            <button
                              onClick={() => {
                                onDuplicate(character);
                                setOpenCardMenuId(null);
                              }}
                              type="button"
                            >
                              <Icon name="copy" size={16} />
                              复制
                            </button>
                            <button
                              onClick={() => {
                                setExportTarget(character);
                                setOpenCardMenuId(null);
                              }}
                              type="button"
                            >
                              <Icon name="download" size={16} />
                              导出
                            </button>
                            <span className="menu-separator" aria-hidden="true" />
                            <button
                              className="menu-danger"
                              onClick={() => {
                                setPendingDelete(character);
                                setOpenCardMenuId(null);
                              }}
                              type="button"
                            >
                              <Icon name="trash" size={16} />
                              删除
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="card-footer-actions">
                      <button
                        aria-label={isFavorite ? "取消收藏" : "收藏"}
                        className={isFavorite ? "mini-icon active" : "mini-icon"}
                        onClick={() => toggleFavorite(character.id)}
                        title={isFavorite ? "取消收藏" : "收藏"}
                        type="button"
                      >
                         <Icon filled={isFavorite} name="heart" size={16} />
                       </button>
                      {showUpdatedTime && (
                        <button
                          className="card-time-button preview-hit"
                          onClick={() => onPreview(character)}
                          title={`创建 ${formatDate(character.createdAt)} · 最后编辑 ${formatDate(character.updatedAt)}`}
                          type="button"
                        >
                          创建 {formatStamp(character.createdAt)} · 编辑 {formatStamp(character.updatedAt)}
                        </button>
                      )}
                    </div>
                  </>
                )}
                {!isBulkMode && isDraft && (
                  <div className="draft-card-actions">
                    <button
                      className="ghost-button"
                      onClick={() => onEdit(character)}
                      type="button"
                    >
                      继续编辑
                    </button>
                    <button
                      className="ghost-button"
                      onClick={() => onPromoteDraft(character)}
                      type="button"
                    >
                      保存为正式
                    </button>
                    <button
                      className="danger-button"
                      onClick={() => setPendingDelete(character)}
                      type="button"
                    >
                      删除
                    </button>
                  </div>
                )}
                {(isBulkMode || isDraft) && (
                  <div className="card-meta">
                    {showUpdatedTime && (
                      <button
                        className="card-time-button preview-hit"
                        onClick={() => onPreview(character)}
                        title={`创建 ${formatDate(character.createdAt)} · 最后编辑 ${formatDate(character.updatedAt)}`}
                        type="button"
                      >
                        创建 {formatStamp(character.createdAt)} · 编辑 {formatStamp(character.updatedAt)}
                      </button>
                    )}
                  </div>
                )}
              </article>
              );
            })}
          </div>
          )}
          </>
        )}
      </div>
    );
  }


  function renderSearchControls() {
    return (
      <div className={isSearchPanelOpen ? "dashboard-controls-panel open" : "dashboard-controls-panel"}>
        <button
          aria-label="清空筛选"
          className="filter-clear-button"
          data-tooltip={hasSearchOrFilter || prefs.favoriteMode !== "all" ? "清空筛选" : "收起筛选"}
          onClick={() => {
            if (hasSearchOrFilter || prefs.favoriteMode !== "all") {
              clearSearchAndFilters();
              return;
            }

            setIsSearchPanelOpen(false);
          }}
           type="button"
         >
           <Icon name={hasSearchOrFilter || prefs.favoriteMode !== "all" ? "close" : "chevronDown"} />
         </button>
        <div className="dashboard-controls">
          <label>
            搜索
            <input
              ref={searchInputRef}
              value={prefs.searchTerm}
              onChange={(event) => updatePrefs({ searchTerm: event.target.value })}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  openFirstSearchResult();
                }
              }}
              placeholder="搜索角色名、职业、世界观、性格标签"
            />
          </label>
          {(!isNarrowScreen || isAdvancedOpen) && (
            <>
          <label>
            范围
            <select
              value={prefs.favoriteMode}
              onChange={(event) =>
                updatePrefs({ favoriteMode: event.target.value as ScopeMode })
              }
            >
              <option value="all">全部角色</option>
              <option value="favorites">仅收藏</option>
              <option value="drafts">草稿箱</option>
            </select>
          </label>
          <label>
            排序
            <select
              value={prefs.sortMode}
              onChange={(event) =>
                updatePrefs({ sortMode: event.target.value as SortMode })
              }
            >
              <option value="updated-desc">最近编辑</option>
              <option value="created-desc">最近创建</option>
              <option value="name-asc">名称 A-Z</option>
              <option value="name-desc">名称 Z-A</option>
            </select>
          </label>
          <label>
            世界观
            <select
              value={prefs.worldviewFilter}
              onChange={(event) =>
                updatePrefs({ worldviewFilter: event.target.value })
              }
            >
              <option value="全部">全部</option>
              {worldviewOptions.map((worldview) => (
                <option key={worldview} value={worldview}>
                  {worldview}
                </option>
              ))}
            </select>
          </label>
          <label>
            性别
            <select
              value={prefs.genderFilter}
              onChange={(event) => updatePrefs({ genderFilter: event.target.value })}
            >
              <option value="全部">全部</option>
              {genderOptions.map((gender) => (
                <option key={gender} value={gender}>
                  {gender}
                </option>
              ))}
            </select>
          </label>
          <label>
            视觉风格
            <select
              value={prefs.visualStyleFilter}
              onChange={(event) =>
                updatePrefs({ visualStyleFilter: event.target.value })
              }
            >
              <option value="全部">全部</option>
              {visualStyleOptions.map((style) => (
                <option key={style} value={style}>
                  {style}
                </option>
              ))}
            </select>
          </label>
            </>
          )}
          {isNarrowScreen && (
            <button
              aria-expanded={isAdvancedOpen}
              className="ghost-button dashboard-advanced-toggle"
              onClick={() => setIsAdvancedOpen((current) => !current)}
              type="button"
            >
              {isAdvancedOpen
                ? "收起筛选"
                : activeFilterCount > 0
                  ? `筛选 · ${activeFilterCount} 项生效`
                  : "筛选选项"}
              <Icon name="chevronDown" size={15} />
            </button>
          )}
        </div>
      </div>
    );
  }


  function renderIntroPanel() {
    return (
      <>
      <div className="panel intro-panel" data-condensed={isCondensedHeader ? "true" : "false"}>
        <div className="intro-copy">
          <p className="eyebrow">OC Workspace</p>
          <h1>{heroCopy.title}</h1>
          <p className="muted">
            {heroCopy.description}
          </p>
          <div className="dashboard-stats">
            <button
              className={prefs.favoriteMode === "all" ? "active" : ""}
              onClick={() => updatePrefs({ favoriteMode: "all" })}
              type="button"
            >
              全部 {stats.officialCount}
            </button>
            <button
              className={prefs.favoriteMode === "favorites" ? "active" : ""}
              onClick={() => updatePrefs({ favoriteMode: "favorites" })}
              type="button"
            >
              收藏{dashboardSettings?.showFavoriteCount !== false ? ` ${stats.favoriteCount}` : ""}
            </button>
            <button
              className={prefs.favoriteMode === "drafts" ? "active" : ""}
              onClick={() => updatePrefs({ favoriteMode: "drafts" })}
              type="button"
            >
              草稿{dashboardSettings?.showDraftCount !== false ? ` ${stats.draftCount}` : ""}
            </button>
          </div>
        </div>
        {/* The toolbar belongs to the hero block rather than floating under it as a
            pill of its own: together they are one sticky header, and the copy is
            dropped from it once the roster starts scrolling. */}
        <div className="dashboard-action-bar">
          <div className="hero-actions dashboard-hero-actions">
            <button
              aria-label="搜索"
              className={isSearchPanelOpen ? "hero-icon-button hero-collapsible active" : "hero-icon-button hero-collapsible"}
              data-tooltip="搜索"
              onClick={() => setIsSearchPanelOpen((current) => !current)}
              type="button"
            >
              <Icon name="search" />
              <span className="mobile-search-label">搜索</span>
            </button>
            <button
              aria-label="新建角色"
              className="hero-icon-button hero-collapsible primary-icon"
              data-tooltip="新建角色"
              onClick={onCreate}
              type="button"
            >
              <Icon name="plus" />
            </button>
            <button
              aria-label="草稿箱"
              className={
                prefs.favoriteMode === "drafts"
                  ? "hero-icon-button hero-collapsible active"
                  : "hero-icon-button hero-collapsible"
              }
              data-tooltip="草稿箱"
              onClick={() =>
                updatePrefs({
                  favoriteMode:
                    prefs.favoriteMode === "drafts" ? "all" : "drafts",
                })
              }
              type="button"
            >
              <Icon name="file" />
              {stats.draftCount > 0 && <span className="button-badge">{stats.draftCount}</span>}
            </button>
            <button
              aria-label="收藏夹"
              className={
                prefs.favoriteMode === "favorites"
                  ? "hero-icon-button hero-collapsible active"
                  : "hero-icon-button hero-collapsible"
              }
              data-tooltip="收藏夹"
              onClick={() =>
                updatePrefs({
                  favoriteMode:
                    prefs.favoriteMode === "favorites" ? "all" : "favorites",
                })
              }
              type="button"
            >
              <Icon name="heart" />
            </button>
            <button
              aria-label={prefs.viewMode === "cards" ? "切换列表视图" : "切换卡片视图"}
              className="hero-icon-button"
              data-tooltip={prefs.viewMode === "cards" ? "列表视图" : "卡片视图"}
              onClick={() =>
                updatePrefs({
                  viewMode: prefs.viewMode === "cards" ? "list" : "cards",
                })
              }
              type="button"
            >
              <Icon name={prefs.viewMode === "cards" ? "list" : "grid"} />
            </button>
            <div className="dashboard-actions" ref={moreMenuRef}>
              <input
                accept="application/json,.json,application/zip,.zip,.csv,text/csv"
                className="hidden-input"
                multiple
                onChange={(event) => handleImportJson(event.target.files)}
                ref={fileInputRef}
                type="file"
              />
              <button
                aria-label="更多操作"
                className="hero-icon-button"
                data-tooltip="更多操作"
                disabled={loadingAction !== null}
                onClick={() => setIsMoreMenuOpen((current) => !current)}
                type="button"
              >
                {loadingAction ? "…" : <Icon name="more" />}
              </button>
              {isMoreMenuOpen && (
                <div className="export-menu">
                  {/* The three workspaces are the reason to open this menu at all, so
                      they come first and they are buttons rather than rows: as three
                      entries of exactly the weight of 「导出 CSV」 they read as more
                      settings, which is why they went unnoticed. */}
                  <div className="export-menu-features">
                    {onOpenRelationships && (
                      <button
                        className="export-menu-feature"
                        onClick={onOpenRelationships}
                        type="button"
                      >
                        <Icon name="link" size={18} />
                        <span>
                          <strong>角色关系网</strong>
                          <small>角色之间的连接</small>
                        </span>
                      </button>
                    )}
                    {onOpenTimeline && (
                      <button
                        className="export-menu-feature"
                        onClick={onOpenTimeline}
                        type="button"
                      >
                        <Icon name="clock" size={18} />
                        <span>
                          <strong>世界观时间线</strong>
                          <small>发生过的节点</small>
                        </span>
                      </button>
                    )}
                    {onOpenWorld && (
                      <button
                        className="export-menu-feature"
                        onClick={onOpenWorld}
                        type="button"
                      >
                        <Icon name="globe" size={18} />
                        <span>
                          <strong>世界观管理</strong>
                          <small>设定与派系</small>
                        </span>
                      </button>
                    )}
                  </div>
                  <button
                    className="menu-responsive-only"
                    onClick={() => setIsSearchPanelOpen((current) => !current)}
                    type="button"
                  >
                    <Icon name="search" size={16} />
                    搜索
                  </button>
                  <button
                    className="menu-responsive-only"
                    onClick={onCreate}
                    type="button"
                  >
                    <Icon name="plus" size={16} />
                    新建角色
                  </button>
                  <button
                    className="menu-responsive-only"
                    onClick={() =>
                      updatePrefs({
                        favoriteMode:
                          prefs.favoriteMode === "drafts" ? "all" : "drafts",
                      })
                    }
                    type="button"
                  >
                    <Icon name="file" size={16} />
                    {prefs.favoriteMode === "drafts" ? "退出草稿箱" : "草稿箱"}
                  </button>
                  <button
                    className="menu-responsive-only"
                    onClick={() =>
                      updatePrefs({
                        favoriteMode:
                          prefs.favoriteMode === "favorites"
                            ? "all"
                            : "favorites",
                      })
                    }
                    type="button"
                  >
                    <Icon name="heart" size={16} />
                    {prefs.favoriteMode === "favorites" ? "退出收藏夹" : "收藏夹"}
                  </button>
                  {/* Grouping is a display option, so it belongs with the other
                      display options rather than as a button of its own beside the
                      list title -- where it competed with the title and, on a phone,
                      pushed the title into an ellipsis. */}
                  {visibleCharacters.length > LARGE_ROSTER && prefs.viewMode === "cards" && (
                    <button
                      aria-pressed={groupedCards}
                      onClick={() => setIsGroupedCards((current) => !current)}
                      type="button"
                    >
                      <Icon name="grid" size={16} />
                      {isGroupedCards ? "取消按世界观分组" : "按世界观分组"}
                    </button>
                  )}
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    type="button"
                  >
                    <Icon name="upload" size={16} />
                    导入角色 JSON/ZIP/CSV
                  </button>
                  {/* One entry per direction, not per format: the dialog behind this
                      asks which format, so 「导出 CSV」 beside it was a second way to
                      the same screen — and it was the only one that skipped the dialog. */}
                  <button onClick={() => openCharacterExportDialog("all")} type="button">
                    <Icon name="package" size={16} />
                    导出角色 JSON/ZIP/CSV
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
      </>
    );
  }


  function renderAssetLibraryDialog() {
    return (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setIsAssetLibraryOpen(false);
            }
          }}
          role="presentation"
        >
          <div className="settings-dialog asset-library-dialog" role="dialog" aria-modal="true">
            <div className="preview-card-title">
              <div>
                <p className="eyebrow">头像素材库</p>
                <h2>头像素材库</h2>
              </div>
              <button className="ghost-button" onClick={() => setIsAssetLibraryOpen(false)} type="button">
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
                    onChange={(event) => void handleImportAvatarAssets(event.target.files?.[0])}
                    ref={assetImportInputRef}
                    type="file"
                  />
                  <button className="ghost-button" onClick={() => assetImportInputRef.current?.click()} type="button">
                  导入头像素材
                  </button>
                  <button className="ghost-button" onClick={() => void exportAvatarAssetsJson()} type="button">
                    导出头像素材
                  </button>
                  <button className="ghost-button" onClick={() => setIsAssetCleanupOpen(true)} type="button">
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
                  <button className="ghost-button" onClick={toggleAllAssetsSelected} type="button">
                    {selectedAssetIds.length === avatarAssets.length ? "取消全选" : "全选"}
                  </button>
                  <button className="ghost-button" disabled={selectedAssetIds.length === 0} onClick={() => void exportAvatarAssetsJson(selectedAssetIds)} type="button">
                    导出所选
                  </button>
                  <button className="ghost-button" disabled={selectedAssetIds.length === 0} onClick={() => void deleteSelectedUnusedAssets()} type="button">
                    删除未使用
                  </button>
                  <button className="danger-button" disabled={selectedAssetIds.length === 0} onClick={requestSelectedAssetDelete} type="button">
                    删除所选
                  </button>
                </div>
                <div className="settings-asset-list">
                  {avatarAssets.map((asset) => {
                    const usageCount = getAssetUsageCount(asset.id);
                    const createdAt = asset.createdAt
                      ? new Date(asset.createdAt).toLocaleDateString()
                      : "未知";

                    return (
                      <div className="settings-asset-item" key={asset.id}>
                        <label className="asset-select-check">
                          <input
                            checked={selectedAssetIds.includes(asset.id)}
                            onChange={() => toggleAssetSelected(asset.id)}
                            type="checkbox"
                          />
                          <span className="sr-only">选择素材</span>
                        </label>
                        <AvatarDisplay
                          assetId={asset.id}
                          className="settings-asset-thumb"
                          emoji="🙂"
                        />
                        <div>
                          <strong>{asset.name || "avatar"}</strong>
                          <span>
                            {(asset.mimeType || asset.blob?.type || "image").replace("image/", "").toUpperCase()} ·{" "}
                            {formatAssetSize(asset.size || asset.blob?.size || 0)} · {createdAt}
                          </span>
                          <small>{usageCount > 0 ? `正在被 ${usageCount} 个角色使用` : "未使用 / 无主素材"}</small>
                        </div>
                        <button
                          className={usageCount > 0 ? "danger-button" : "ghost-button"}
                          onClick={() => void requestAssetDelete(asset)}
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
    );
  }


  return (
    <section className="page-grid">
      {toastMessage && (
        <div className={`toast ${toastType}`}>
          {toastMessage}
          {undoCharacter && (
            <button
              data-undo-delete="true"
              onClick={() => restoreDeletedCharacter(undoCharacter)}
              type="button"
            >
              撤销
            </button>
          )}
        </div>
      )}

      {pendingDelete && (
        <div className="modal-backdrop" role="presentation">
          <div className="confirm-dialog" role="dialog" aria-modal="true">
            <h2>删除角色</h2>
            <p>确定要删除这个角色吗？此操作不可撤销。</p>
            <div className="form-actions">
              <button
                className="ghost-button"
                onClick={() => setPendingDelete(null)}
                type="button"
              >
                取消
              </button>
              <button
                className="danger-button"
                onClick={confirmDelete}
                type="button"
              >
                确认删除
              </button>
            </div>
          </div>
        </div>
      )}

      {isBulkEditOpen && (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setIsBulkEditOpen(false);
            }
          }}
          role="presentation"
        >
          <div aria-modal="true" className="confirm-dialog bulk-edit-dialog" role="dialog">
            <h2>批量编辑 {selectedIds.length} 个角色</h2>
            <p className="bulk-edit-hint">只修改你勾选的字段，其余字段保持原样。</p>

            <label className="bulk-edit-row">
              <input
                checked={bulkDraft.worldviewOn}
                onChange={(event) => updateBulkDraft({ worldviewOn: event.target.checked })}
                type="checkbox"
              />
              <span>世界观</span>
              <input
                className="bulk-edit-input"
                disabled={!bulkDraft.worldviewOn}
                list="bulk-worldview-options"
                onChange={(event) => updateBulkDraft({ worldview: event.target.value })}
                placeholder="例如：赛博朋克"
                type="text"
                value={bulkDraft.worldview}
              />
            </label>

            <label className="bulk-edit-row">
              <input
                checked={bulkDraft.visualStyleOn}
                onChange={(event) => updateBulkDraft({ visualStyleOn: event.target.checked })}
                type="checkbox"
              />
              <span>视觉风格</span>
              <input
                className="bulk-edit-input"
                disabled={!bulkDraft.visualStyleOn}
                list="bulk-visualstyle-options"
                onChange={(event) => updateBulkDraft({ visualStyle: event.target.value })}
                placeholder="例如：厚涂"
                type="text"
                value={bulkDraft.visualStyle}
              />
            </label>

            <label className="bulk-edit-row">
              <input
                checked={bulkDraft.favoriteOn}
                onChange={(event) => updateBulkDraft({ favoriteOn: event.target.checked })}
                type="checkbox"
              />
              <span>收藏状态</span>
              <select
                disabled={!bulkDraft.favoriteOn}
                onChange={(event) => updateBulkDraft({ favorite: event.target.value === "yes" })}
                value={bulkDraft.favorite ? "yes" : "no"}
              >
                <option value="yes">设为已收藏</option>
                <option value="no">移出收藏</option>
              </select>
            </label>

            <label className="bulk-edit-row">
              <input
                checked={bulkDraft.addTagsOn}
                onChange={(event) => updateBulkDraft({ addTagsOn: event.target.checked })}
                type="checkbox"
              />
              <span>添加标签</span>
              <input
                className="bulk-edit-input"
                disabled={!bulkDraft.addTagsOn}
                onChange={(event) => updateBulkDraft({ addTags: event.target.value })}
                placeholder="逗号分隔，例如：反派、冷面"
                type="text"
                value={bulkDraft.addTags}
              />
            </label>

            <label className="bulk-edit-row">
              <input
                checked={bulkDraft.removeTagsOn}
                onChange={(event) => updateBulkDraft({ removeTagsOn: event.target.checked })}
                type="checkbox"
              />
              <span>移除标签</span>
              <input
                className="bulk-edit-input"
                disabled={!bulkDraft.removeTagsOn}
                onChange={(event) => updateBulkDraft({ removeTags: event.target.value })}
                placeholder="逗号分隔"
                type="text"
                value={bulkDraft.removeTags}
              />
            </label>

            <datalist id="bulk-worldview-options">
              {worldviewSuggestions.map((value) => (
                <option key={value} value={value} />
              ))}
            </datalist>
            <datalist id="bulk-visualstyle-options">
              {visualStyleSuggestions.map((value) => (
                <option key={value} value={value} />
              ))}
            </datalist>

            <div className="form-actions">
              <button className="ghost-button" onClick={() => setIsBulkEditOpen(false)} type="button">
                取消
              </button>
              <button
                className="primary-button"
                disabled={selectedIds.length === 0}
                onClick={applyBulkEdit}
                type="button"
              >
                应用到 {selectedIds.length} 个角色
              </button>
            </div>
          </div>
        </div>
      )}

      {isBulkDeleteOpen && (
        <div className="modal-backdrop" role="presentation">
          <div className="confirm-dialog" role="dialog" aria-modal="true">
            <h2>批量删除</h2>
            <p>
              确定要删除选中的 {selectedIds.length} 个角色吗？此操作不可撤销。
            </p>
            <div className="form-actions">
              <button
                className="ghost-button"
                onClick={() => setIsBulkDeleteOpen(false)}
                type="button"
              >
                取消
              </button>
              <button
                className="danger-button"
                onClick={confirmBulkDelete}
                type="button"
              >
                确认删除
              </button>
            </div>
          </div>
        </div>
      )}

      {exportTarget && (
        <div
          className="modal-backdrop export-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setExportTarget(null);
            }
          }}
          role="presentation"
        >
          <div
            className="export-dialog"
            ref={exportDialogRef}
            role="dialog"
            aria-modal="true"
          >
            <div className="preview-card-title">
              <div>
                <p className="eyebrow">Export</p>
                <h2>导出角色</h2>
              </div>
              <button
                className="ghost-button"
                onClick={() => setExportTarget(null)}
                type="button"
              >
                关闭
              </button>
            </div>
            <div className="export-dialog-list">
              <button onClick={() => handleCardExport("json")} type="button">
                JSON
              </button>
              <button
                disabled={loadingAction === "card-pdf"}
                onClick={() => handleCardExport("pdf")}
                type="button"
              >
                {loadingAction === "card-pdf" ? "导出中..." : "PDF"}
              </button>
              <button
                disabled={loadingAction === "card-jpg"}
                onClick={() => handleCardExport("jpg")}
                type="button"
              >
                {loadingAction === "card-jpg" ? "导出中..." : "JPG"}
              </button>
              <button
                disabled={loadingAction === "card-png"}
                onClick={() => handleCardExport("png")}
                type="button"
              >
                {loadingAction === "card-png" ? "导出中..." : "PNG"}
              </button>
            </div>
          </div>
        </div>
      )}

      {characterExportScope && (
        <div
          className="modal-backdrop export-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setCharacterExportScope(null);
            }
          }}
          role="presentation"
        >
          <div className="export-dialog" role="dialog" aria-modal="true">
            <div className="preview-card-title">
              <div>
                <p className="eyebrow">导出</p>
                <h2>{characterExportScope === "selected" ? "导出选中角色" : "导出角色"}</h2>
                <p className="muted">请选择导出方式</p>
              </div>
              <button
                className="ghost-button"
                onClick={() => setCharacterExportScope(null)}
                type="button"
              >
                关闭
              </button>
            </div>
            <div className="export-choice-list">
              {getCharacterExportOptions(characterExportScope).map((option) => (
                <label className="export-choice-item" key={option.value}>
                  <input
                    checked={characterExportChoice === option.value}
                    onChange={() => setCharacterExportChoice(option.value)}
                    type="radio"
                  />
                  <span>
                    <strong>{option.label}</strong>
                    <small>{option.description}</small>
                  </span>
                </label>
              ))}
            </div>
            {exportProgress && loadingAction?.startsWith("bulk-") && (
              <p className="muted">导出进度：{exportProgress}</p>
            )}
            <div className="dialog-actions">
              <button className="ghost-button" onClick={() => setCharacterExportScope(null)} type="button">
                取消
              </button>
              <button
                className="primary-button"
                disabled={loadingAction !== null}
                onClick={() => void startCharacterExport()}
                type="button"
              >
                {loadingAction ? "正在导出..." : "开始导出"}
              </button>
            </div>
          </div>
        </div>
      )}

      {isBulkMoreOpen && (
        <div
          className="modal-backdrop export-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setIsBulkMoreOpen(false);
            }
          }}
          role="presentation"
        >
          <div className="export-dialog mobile-bulk-dialog" role="dialog" aria-modal="true">
            <div className="preview-card-title">
              <div>
                <p className="eyebrow">Batch</p>
                <h2>更多操作</h2>
              </div>
              <button className="ghost-button" onClick={() => setIsBulkMoreOpen(false)} type="button">
                关闭
              </button>
            </div>
            <div className="export-dialog-list">
              <button
                disabled={selectedIds.length === 0}
                onClick={() => {
                  setIsBulkMoreOpen(false);
                  handleBulkDuplicate();
                }}
                type="button"
              >
                批量复制
              </button>
              <button
                className="menu-danger"
                disabled={selectedIds.length === 0}
                onClick={() => {
                  setIsBulkMoreOpen(false);
                  selectedIds.length > 0
                    ? setIsBulkDeleteOpen(true)
                    : showToast("请先选择角色");
                }}
                type="button"
              >
                批量删除
              </button>
            </div>
          </div>
        </div>
      )}

      {isCommandOpen && (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setIsCommandOpen(false);
            }
          }}
          role="presentation"
        >
          <div className="command-palette" role="dialog" aria-modal="true">
            <p className="eyebrow">Command Palette</p>
            <h2>快速操作</h2>
            <div className="command-list">
              {[
                ["create", "新建角色", "N"],
                ["search", "搜索角色", "/"],
                ["drafts", "打开草稿箱", ""],
                ["favorites", "打开收藏夹", ""],
                ["import", "导入角色 JSON/ZIP/CSV", ""],
                ["export", "导出角色 JSON/ZIP", ""],
                ["theme", "切换主题", ""],
              ].map(([id, label, shortcut]) => (
                <button key={id} onClick={() => runCommand(id)} type="button">
                  <span>{label}</span>
                  {shortcut && <kbd>{shortcut}</kbd>}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {isAboutOpen && (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setIsAboutOpen(false);
            }
          }}
          role="presentation"
        >
          <div className="about-dialog" role="dialog" aria-modal="true">
            <div className="preview-card-title">
              <div>
                <p className="eyebrow">About</p>
                <h2>About Character Studio</h2>
              </div>
              <button className="ghost-button" onClick={() => setIsAboutOpen(false)} type="button">
                关闭
              </button>
            </div>
            <div className="about-grid">
              <article>
                <h3>{contentText.aboutTitle}</h3>
                <p>{contentText.aboutSummary}</p>
              </article>
              <article>
                <h3>当前支持</h3>
                <ul className="about-list">
                  <li>Dashboard 角色管理、搜索、筛选、收藏与置顶。</li>
                  <li>Editor 编写设定、草稿保存、随机灵感与 Prompt 生成。</li>
                  <li>Preview 角色展示，并支持 JSON、CSV、PDF 导入导出。</li>
                </ul>
              </article>
              <article>
                <h3>快捷键</h3>
                <dl className="shortcut-list">
                  <div>
                    <dt>N</dt>
                    <dd>新建角色</dd>
                  </div>
                  <div>
                    <dt>/</dt>
                    <dd>打开搜索</dd>
                  </div>
                  <div>
                    <dt>Esc</dt>
                    <dd>关闭弹层</dd>
                  </div>
                  <div>
                    <dt>⌘K / Ctrl+K</dt>
                    <dd>打开 Command Palette</dd>
                  </div>
                  <div>
                    <dt>Enter</dt>
                    <dd>打开搜索结果</dd>
                  </div>
                  <div>
                    <dt>Tab</dt>
                    <dd>切换输入焦点</dd>
                  </div>
                </dl>
              </article>
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
              <article>
                <h3>鸣谢</h3>
                <p>感谢以下项目与工具提供支持：</p>
                <ul className="about-list compact">
                  <li>智能体工具（开发协作）</li>
                  <li>React</li>
                  <li>TypeScript</li>
                  <li>Vite</li>
                  <li>jsPDF</li>
                  <li>html2canvas</li>
                </ul>
              </article>
              <article>
                <h3>Changelog</h3>
                <p>已优化 Dashboard、草稿箱、Avatar Picker、导入导出、主题切换和 Preview 展示体验。</p>
              </article>
              <article>
                <h3>Import / Export Guide</h3>
                <ul className="about-list">
                  <li>单角色 JSON：包含角色；如有上传头像，会携带头像数据，适合分享单个角色。</li>
                  <li>角色 JSON：仅角色文字数据，不含头像，适合轻量备份。</li>
                  <li>完整备份 ZIP：包含角色、头像绑定信息与头像素材，适合跨设备迁移。</li>
                  <li>头像素材 JSON：可独立导入 / 导出素材库，不强制绑定角色。</li>
                  <li>CSV、PDF、JPG、PNG：用于文字归档或展示，不用于重新导入。</li>
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
            </div>
            <div className="about-brand-footer">
              <svg className="about-brand-logo" aria-hidden="true" viewBox="0 0 566.43 637.56">
                <polygon className="brand-mark-primary" points="0 163.51 283.22 0 476.31 111.48 386.19 163.51 283.22 104.06 90.12 215.55 90.12 438.51 254.62 533.49 254.62 637.56 0 490.54 0 163.51" />
                <polygon className="brand-mark-accent" points="311.79 533.49 476.31 438.51 476.31 215.55 566.43 163.51 566.43 490.54 311.79 637.56 311.79 533.49" />
              </svg>
              <div className="about-brand-meta">
                <h3>Character Studio</h3>
                <p>Version {APP_VERSION}</p>
                <p>Sprint {APP_SPRINT}</p>
                <p>Released {RELEASE_YEAR}</p>
                <p>
                  Build {APP_COMMIT_SHORT}
                  {APP_BUILD_DATE ? ` · ${APP_BUILD_DATE}` : ""}
                </p>
              </div>
              <p className="about-brand-tagline">{contentText.firstAboutTagline}</p>
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
          </div>
        </div>
      )}

      {isSettingsOpen && (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setIsSettingsOpen(false);
            }
          }}
          role="presentation"
        >
          <div className="settings-dialog" role="dialog" aria-modal="true">
            <div className="preview-card-title">
              <div>
                <p className="eyebrow">Settings</p>
                <h2>设置</h2>
              </div>
              <button className="ghost-button" onClick={() => setIsSettingsOpen(false)} type="button">
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
                      onClick={() => onSetThemeMode(mode)}
                      type="button"
                    >
                      {mode === "system" ? "Follow System" : mode === "light" ? "Light" : "Dark"}
                    </button>
                  ))}
                </div>
              </article>
              <article>
                <h3>Default View</h3>
                <div className="segmented-row">
                  <button
                    className={prefs.viewMode === "cards" ? "active" : ""}
                    onClick={() => updatePrefs({ viewMode: "cards" })}
                    type="button"
                  >
                    Card
                  </button>
                  <button
                    className={prefs.viewMode === "list" ? "active" : ""}
                    onClick={() => updatePrefs({ viewMode: "list" })}
                    type="button"
                  >
                    List
                  </button>
                </div>
              </article>
              {aiSettingsEnabled && <AiSettingsForm />}
              <article>
                <h3>Mobile</h3>
                <label className="settings-check">
                  <input
                    type="checkbox"
                    checked={editorSettings?.compactMobileEditor ?? true}
                    onChange={(event) =>
                      onDashboardSettingsChange?.({
                        editorDefaults: { compactMobileEditor: event.target.checked },
                      })
                    }
                  />
                  <span>简洁模式</span>
                </label>
              </article>
              <article>
                <h3>Export</h3>
                <label>
                  JPG 导出质量
                  <input
                    min="0.1"
                    max="1"
                    onChange={(event) =>
                      onDashboardSettingsChange?.({
                        exportDefaults: { jpgQuality: Number(event.target.value) },
                      })
                    }
                    step="0.1"
                    type="number"
                    value={exportSettings?.jpgQuality ?? 0.9}
                  />
                  <span className="field-hint">数值越高，图片越清晰，文件越大。</span>
                </label>
                <label className="settings-check">
                  <input
                    checked={exportSettings?.pdfLightMode ?? true}
                    onChange={(event) =>
                      onDashboardSettingsChange?.({
                        exportDefaults: { pdfLightMode: event.target.checked },
                      })
                    }
                    type="checkbox"
                  />
                  <span>PDF Light Mode</span>
                </label>
              </article>
              <article>
                <h3>Data</h3>
                <div className="settings-actions">
                  <button className="ghost-button" onClick={() => openCharacterExportDialog("all")} type="button">
                    导出角色 JSON/ZIP
                  </button>
                  <button className="ghost-button" onClick={() => fileInputRef.current?.click()} type="button">
                    导入角色 JSON/ZIP/CSV
                  </button>
                  {(() => {
                    const snapshot = readSnapshot();
                    if (!snapshot) {
                      return null;
                    }

                    return (
                      <button className="ghost-button" onClick={() => setPendingRestore(snapshot)} type="button">
                        恢复上次自动备份（{snapshot.characterCount} 个角色 · {snapshot.createdAt.slice(0, 10)}）
                      </button>
                    );
                  })()}
                  <button className="danger-button" onClick={() => setIsClearDataOpen(true)} type="button">
                    清空本地数据
                  </button>
                </div>
                <div className="settings-notes">
                  <p>{contentText.importGuide}</p>
                  <p>{contentText.exportGuide}</p>
                  <p>{contentText.dialogCopy}</p>
                  <p>{contentText.privacy}</p>
                  <p className="settings-license">{contentText.license}</p>
                </div>
              </article>
              {assetLibraryEnabled && (
              <article>
                <h3>头像素材库</h3>
                <p className="muted">
                  本地头像素材 {avatarAssetStats.count} 个，占用约 {formatAssetSize(avatarAssetStats.size)}。
                </p>
                <p className="muted">
                  图片存储在当前浏览器 IndexedDB 中，轻量 JSON 不包含头像图片二进制。
                </p>
                <div className="settings-actions">
                  <button
                    className="ghost-button"
                    onClick={() => {
                      setIsSettingsOpen(false);
                      setIsAssetLibraryOpen(true);
                    }}
                    type="button"
                  >
                    打开头像素材库
                  </button>
                </div>
              </article>
              )}
              <article>
                <h3>About Data</h3>
                <p className="muted">当前数据保存在浏览器 localStorage。换设备不会自动同步，清除浏览器缓存可能导致数据丢失。</p>
              </article>
            </div>
          </div>
        </div>
      )}

      {importPlan && (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setImportPlan(null);
            }
          }}
          role="presentation"
        >
          <div className="settings-dialog compact-dialog" role="dialog" aria-modal="true">
            <div className="preview-card-title">
              <div>
                <p className="eyebrow">导入预览</p>
                <h2>确认导入</h2>
              </div>
              <button className="ghost-button" onClick={() => setImportPlan(null)} type="button">
                取消
              </button>
            </div>
            <div className="settings-grid import-preview-grid">
              <article>
                <h3>即将导入</h3>
                <p className="muted">确认前不会写入角色或头像素材。</p>
                <div className="import-preview-stats">
                  <span>角色：{importPlan.preview.roleCount} 个</span>
                  <span>头像素材：{importPlan.preview.avatarCount} 个</span>
                  <span>导入类型：{getImportTypeLabel(importPlan.preview.importType)}</span>
                  {/* Files written before the graph, the timeline and the world book
                      existed carry characters only, and then this line is absent. */}
                  {importPlan.preview.workspaceCounts && (
                    <span>
                      关系网 {importPlan.preview.workspaceCounts.relationships} · 世界观{" "}
                      {importPlan.preview.workspaceCounts.world} · 时间线{" "}
                      {importPlan.preview.workspaceCounts.timeline}
                    </span>
                  )}
                </div>
                <button
                  className="ghost-button import-detail-toggle"
                  onClick={() => setIsImportDetailOpen((current) => !current)}
                  type="button"
                >
                  {isImportDetailOpen ? "收起详细信息 ▲" : "查看详细信息 ▼"}
                </button>
                {isImportDetailOpen && (
                  <div className="import-preview-stats">
                    <span>自动绑定头像：{importPlan.preview.autoMatchedAvatarCount} 个</span>
                    <span>未绑定头像：{importPlan.preview.unmatchedAvatarCount} 个</span>
                    <span>重复头像素材：{importPlan.preview.duplicateAssetCount} 个</span>
                    <span>同名角色：{importPlan.preview.duplicateCharacterCount} 个</span>
                    <span>数据版本：{getDataVersionLabel(importPlan.preview.dataVersion)}</span>
                    <span>完整备份信息：{importPlan.preview.hasBackupInfo ? "包含" : "未包含"}</span>
                  </div>
                )}
              </article>
              <article>
                <h3>冲突处理</h3>
                <p className="muted">
                  当前策略为保留全部角色；同 ID 会自动生成新 ID，重复头像素材会自动复用。
                </p>
                <p className="muted">
                  头像只根据备份内的头像绑定信息或单角色内嵌头像恢复，不会靠文件名猜测。
                </p>
              </article>
            </div>
            <div className="dialog-actions">
              <button className="ghost-button" onClick={() => setImportPlan(null)} type="button">
                取消
              </button>
              <button
                className="primary-button"
                disabled={loadingAction === "import"}
                onClick={() => void confirmImportPlan()}
                type="button"
              >
                {loadingAction === "import" ? "正在导入..." : "确认导入"}
              </button>
            </div>
          </div>
        </div>
      )}

      {isAssetLibraryOpen && (
        renderAssetLibraryDialog()
      )}

      {pendingRestore && (
        <div className="modal-backdrop" role="presentation">
          <div className="confirm-dialog" role="dialog" aria-modal="true">
            <h2>恢复上次自动备份</h2>
            <p>
              将用 {pendingRestore.createdAt.slice(0, 10)} 的备份覆盖当前角色数据（{pendingRestore.characterCount} 个角色）。
              当前列表会被替换，头像图片不在备份中。
            </p>
            <div className="form-actions">
              <button className="ghost-button" onClick={() => setPendingRestore(null)} type="button">
                取消
              </button>
              <button className="primary-button" onClick={restoreSnapshot} type="button">
                确认恢复
              </button>
            </div>
          </div>
        </div>
      )}

      {isClearDataOpen && (
        <div className="modal-backdrop" role="presentation">
          <div className="confirm-dialog" role="dialog" aria-modal="true">
            <h2>清空本地数据</h2>
            <p>确定要清空所有本地角色数据吗？当前共 {characters.length} 个角色。清空前会自动保留一份可恢复的备份（仅角色数据，不含头像图片）。</p>
            <div className="form-actions">
              <button className="ghost-button" onClick={() => setIsClearDataOpen(false)} type="button">
                取消
              </button>
              <button className="danger-button" onClick={clearLocalData} type="button">
                确认清空
              </button>
            </div>
          </div>
        </div>
      )}

      {isAssetCleanupOpen && (
        <div className="modal-backdrop" role="presentation">
          <div className="confirm-dialog" role="dialog" aria-modal="true">
            <h2>清理头像素材</h2>
            <p>确定要清理未被任何角色使用的本地头像素材吗？正在使用的头像不会被删除。</p>
            <div className="form-actions">
              <button className="ghost-button" onClick={() => setIsAssetCleanupOpen(false)} type="button">
                取消
              </button>
              <button className="danger-button" onClick={confirmAssetCleanup} type="button">
                确认清理
              </button>
            </div>
          </div>
        </div>
      )}

      {pendingAssetDelete && (
        <div className="modal-backdrop" role="presentation">
          <div className="confirm-dialog" role="dialog" aria-modal="true">
            <h2>删除正在使用的头像素材</h2>
            <p>
              这个头像素材正在被 {getAssetUsageCount(pendingAssetDelete.id)} 个角色使用。
              删除后这些角色会自动回退到 Emoji 头像。
            </p>
            <div className="form-actions">
              <button className="ghost-button" onClick={() => setPendingAssetDelete(null)} type="button">
                取消
              </button>
              <button className="danger-button" onClick={() => void confirmAssetDelete()} type="button">
                确认删除
              </button>
            </div>
          </div>
        </div>
      )}

      {pendingAssetBatchDeleteIds.length > 0 && (
        <div className="modal-backdrop" role="presentation">
          <div className="confirm-dialog" role="dialog" aria-modal="true">
            <h2>批量删除头像素材</h2>
            <p>
              选中的素材中有正在被角色使用的头像。删除后相关角色会自动回退到 Emoji 头像。
            </p>
            <div className="form-actions">
              <button className="ghost-button" onClick={() => setPendingAssetBatchDeleteIds([])} type="button">
                取消
              </button>
              <button className="danger-button" onClick={() => void confirmAssetBatchDelete()} type="button">
                确认删除
              </button>
            </div>
          </div>
        </div>
      )}

        {renderIntroPanel()}

        {renderSearchControls()}

        {renderCharacterListPanel()}
      <footer className="dashboard-footer">
        <button onClick={() => setIsAboutOpen(true)} type="button">
          About Character Studio
        </button>
        {assetLibraryEnabled && (
          <button onClick={() => setIsAssetLibraryOpen(true)} type="button">
            头像素材库
          </button>
        )}
        <button onClick={() => setIsSettingsOpen((current) => !current)} type="button">
          Settings
        </button>
        <span>{footerText}</span>
      </footer>
    </section>
  );
}

function getUniqueOptions(
  characters: Character[],
  field: "worldview" | "gender" | "visualStyle",
) {
  return Array.from(
    new Set(
      characters
        .map((character) => character[field]?.trim())
        .filter((value): value is string => Boolean(value)),
    ),
  ).sort((a, b) => a.localeCompare(b));
}

function getPersonalityTags(character: Character) {
  return Array.from(
    new Set((character.personalityTags || []).filter((tag) => tag.trim())),
  );
}

function getCharacterExportOptions(scope: CharacterExportScope): Array<{
  value: CharacterExportChoice;
  label: string;
  description: string;
}> {
  const baseOptions: Array<{
    value: CharacterExportChoice;
    label: string;
    description: string;
  }> = [
    {
      value: "json",
      label: "导出角色 JSON",
      description: "仅角色数据，适合轻量备份",
    },
    {
      value: "zip",
      label: "导出完整备份 ZIP",
      description: "包含角色与头像，推荐跨设备迁移",
    },
  ];

  if (scope === "all") {
    return [
      ...baseOptions,
      {
        value: "csv",
        label: "导出 CSV",
        description: "导出文字资料",
      },
    ];
  }

  return [
    ...baseOptions,
    {
      value: "pdf",
      label: "导出 PDF",
      description: "展示用途，不可重新导入",
    },
    {
      value: "jpg",
      label: "导出 JPG",
      description: "图片分享，体积较小",
    },
    {
      value: "png",
      label: "导出 PNG",
      description: "图片分享，画质更清晰",
    },
  ];
}

function getImportTypeLabel(importType: "json" | "zip" | "csv" | "mixed") {
  if (importType === "csv") {
    return "表格 CSV";
  }

  if (importType === "zip") {
    return "完整备份 ZIP";
  }

  if (importType === "mixed") {
    return "角色 JSON 与完整备份 ZIP";
  }

  return "角色 JSON";
}

function getDataVersionLabel(dataVersion: string) {
  if (!dataVersion || dataVersion === "JSON") {
    return "角色数据";
  }

  if (dataVersion === "CSV") {
    return "表格数据（CSV）";
  }

  if (dataVersion === "ZIP") {
    return "完整备份";
  }

  if (dataVersion.includes("full-backup")) {
    return "完整备份";
  }

  return dataVersion.replace(/schemaVersion|manifest|backup-info|assetKey/gi, "数据");
}

function getVisibleCharacters(
  characters: Character[],
  prefs: DashboardPrefs,
  flags: DashboardFlags,
) {
  const keyword = prefs.searchTerm.trim().toLocaleLowerCase();
  const pinnedIds = new Set(flags.pinnedIds);
  const favoriteIds = new Set(flags.favoriteIds);

  return [...characters]
    .filter((character) => {
      const isDraft = character.isDraft === true;
      const searchableText = [
        character.name,
        character.occupation,
        character.worldview,
        ...(character.personalityTags || []),
      ]
        .join(" ")
        .toLocaleLowerCase();
      const matchesSearch = keyword ? searchableText.includes(keyword) : true;
      const matchesWorldview =
        prefs.worldviewFilter === "全部" ||
        character.worldview === prefs.worldviewFilter;
      const matchesGender =
        prefs.genderFilter === "全部" || character.gender === prefs.genderFilter;
      const matchesVisualStyle =
        prefs.visualStyleFilter === "全部" ||
        character.visualStyle === prefs.visualStyleFilter;
      const matchesScope =
        prefs.favoriteMode === "drafts"
          ? isDraft
          : !isDraft &&
            (prefs.favoriteMode === "all" ||
              (prefs.favoriteMode === "favorites" &&
                isCharacterFavorite(character, favoriteIds)));

      return (
        matchesSearch &&
        matchesWorldview &&
        matchesGender &&
        matchesVisualStyle &&
        matchesScope
      );
    })
    .sort((a, b) => {
      const pinnedDelta = Number(pinnedIds.has(b.id)) - Number(pinnedIds.has(a.id));

      if (pinnedDelta !== 0) {
        return pinnedDelta;
      }

      if (prefs.sortMode === "name-asc") {
        return (a.name || "").localeCompare(b.name || "");
      }

      if (prefs.sortMode === "name-desc") {
        return (b.name || "").localeCompare(a.name || "");
      }

      if (prefs.sortMode === "created-desc") {
        return getTime(b.createdAt || b.updatedAt) - getTime(a.createdAt || a.updatedAt);
      }

      return getTime(b.updatedAt) - getTime(a.updatedAt);
    });
}

function getHeroCopy(scope: ScopeMode) {
  if (scope === "favorites") {
    return {
      title: "收藏夹",
      description: "查看你标记收藏的角色。",
    };
  }

  if (scope === "drafts") {
    return {
      title: "草稿箱",
      description: "继续编辑尚未正式保存的角色。",
    };
  }

  return {
    title: "角色创作工作台",
    description: "记录角色的身份、外观、性格和背景。",
  };
}

function getDashboardStats(characters: Character[], flags: DashboardFlags) {
  const draftCount = characters.filter((character) => character.isDraft).length;
  const officialCharacters = characters.filter((character) => !character.isDraft);
  const favoriteIds = new Set(flags.favoriteIds);

  return {
    officialCount: officialCharacters.length,
    draftCount,
    favoriteCount: officialCharacters.filter((character) =>
      isCharacterFavorite(character, favoriteIds),
    ).length,
  };
}

function isCharacterFavorite(character: Character, legacyFavoriteIds = new Set<string>()) {
  return Boolean(
    character.favorite ?? character.isFavorite ?? legacyFavoriteIds.has(character.id),
  );
}

function getListTitle(prefs: DashboardPrefs, hasSearchOrFilter: boolean) {
  if (hasSearchOrFilter) {
    return "搜索 / 筛选结果";
  }

  if (prefs.favoriteMode === "favorites") {
    return "收藏角色";
  }

  if (prefs.favoriteMode === "drafts") {
    return "草稿角色";
  }

  return "角色列表";
}

function getTagTone(tag: string) {
  const tones = Array.from({ length: 18 }, (_, index) => index);
  const total = Array.from(tag).reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return tones[total % tones.length];
}

function getTime(value?: string) {
  return value ? new Date(value).getTime() || 0 : 0;
}

/**
 * A shorter stamp for places that carry two of them side by side -- the card shows
 * when a character was created and when it was last edited, and two 12-hour stamps
 * with an AM/PM on each do not fit. Days are dropped outside the current year.
 */
function formatStamp(value?: string) {
  if (!value) {
    return "未知";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "未知";
  }

  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");

  if (date.getFullYear() !== new Date().getFullYear()) {
    return `${date.getFullYear()}/${month}/${day}`;
  }

  return `${month}/${day} ${hours}:${minutes}`;
}

function formatDate(value?: string) {
  if (!value) {
    return "未知";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "未知";
  }

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = date.getHours();
  const hour12 = String(hours % 12 || 12).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const period = hours >= 12 ? "PM" : "AM";
  const time = `${hour12}:${minutes} ${period}`;
  const currentYear = new Date().getFullYear();

  if (year === currentYear) {
    return `${month}/${day} ${time}`;
  }

  return `${year}/${month}/${day} ${time}`;
}
