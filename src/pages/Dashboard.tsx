import { useEffect, useRef, useState } from "react";
import type { Character } from "../types/character";
import {
  exportAllCharactersJson,
  exportCharacterSnapshot,
  exportCharacterSnapshotsZip,
  exportCharacterJson,
  exportCharactersCsv,
  exportSelectedCharactersJson,
  importCharactersFromFiles,
} from "../utils/importExport";

type DashboardProps = {
  characters: Character[];
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
};

type SortMode = "updated-desc" | "created-desc" | "name-asc" | "name-desc";
type ScopeMode = "all" | "favorites" | "drafts";
type ViewMode = "cards" | "list";
type ThemeMode = "system" | "light" | "dark";

const DASHBOARD_PREFS_KEY = "character-studio.dashboard-prefs";
const DASHBOARD_FLAGS_KEY = "character-studio.dashboard-flags";

type DashboardPrefs = {
  searchTerm: string;
  sortMode: SortMode;
  worldviewFilter: string;
  genderFilter: string;
  visualStyleFilter: string;
  favoriteMode: ScopeMode;
  viewMode: ViewMode;
};

type DashboardFlags = {
  favoriteIds: string[];
  pinnedIds: string[];
};

const defaultPrefs: DashboardPrefs = {
  searchTerm: "",
  sortMode: "updated-desc",
  worldviewFilter: "全部",
  genderFilter: "全部",
  visualStyleFilter: "全部",
  favoriteMode: "all",
  viewMode: "cards",
};

const defaultFlags: DashboardFlags = {
  favoriteIds: [],
  pinnedIds: [],
};

export function Dashboard({
  characters,
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
}: DashboardProps) {
  const [pendingDelete, setPendingDelete] = useState<Character | null>(null);
  const [isBulkDeleteOpen, setIsBulkDeleteOpen] = useState(false);
  const [isMoreMenuOpen, setIsMoreMenuOpen] = useState(false);
  const [isSearchPanelOpen, setIsSearchPanelOpen] = useState(
    () => localStorage.getItem("character-studio.settings.open-search") === "true",
  );
  const [isBulkMode, setIsBulkMode] = useState(false);
  const [openCardMenuId, setOpenCardMenuId] = useState<string | null>(null);
  const [exportTarget, setExportTarget] = useState<Character | null>(null);
  const [isBulkExportOpen, setIsBulkExportOpen] = useState(false);
  const [isBulkMoreOpen, setIsBulkMoreOpen] = useState(false);
  const [isCommandOpen, setIsCommandOpen] = useState(false);
  const [isAboutOpen, setIsAboutOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isClearDataOpen, setIsClearDataOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [prefs, setPrefs] = useState<DashboardPrefs>(loadDashboardPrefs);
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
  const moreMenuRef = useRef<HTMLDivElement>(null);
  const cardMenuRef = useRef<HTMLDivElement>(null);
  const exportDialogRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const worldviewOptions = getUniqueOptions(characters, "worldview");
  const genderOptions = getUniqueOptions(characters, "gender");
  const visualStyleOptions = getUniqueOptions(characters, "visualStyle");
  const visibleCharacters = getVisibleCharacters(
    characters,
    prefs,
    flags,
  );
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
        setIsMoreMenuOpen(false);
        setOpenCardMenuId(null);
        setExportTarget(null);
        setIsBulkExportOpen(false);
        setIsBulkMoreOpen(false);
        setIsSearchPanelOpen(false);
        setIsCommandOpen(false);
        setIsAboutOpen(false);
        setIsSettingsOpen(false);
        setIsClearDataOpen(false);
        setIsBulkMode(false);
        setSelectedIds([]);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

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

  useEffect(() => {
    localStorage.setItem(DASHBOARD_PREFS_KEY, JSON.stringify(prefs));
  }, [prefs]);

  useEffect(() => {
    localStorage.setItem(DASHBOARD_FLAGS_KEY, JSON.stringify(flags));
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

  function handleExportCharacterJson(character: Character) {
    exportCharacterJson(character);
    showToast("当前角色 JSON 已导出");
  }

  async function handleCardExport(format: "json" | "pdf" | "jpg" | "png") {
    if (!exportTarget) {
      return;
    }

    const target = exportTarget;
    setExportTarget(null);

    if (format === "json") {
      handleExportCharacterJson(target);
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
        updatedAt: new Date().toISOString(),
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
    setPrefs((current) => ({
      ...current,
      searchTerm: "",
      sortMode: "updated-desc",
      worldviewFilter: "全部",
      genderFilter: "全部",
      visualStyleFilter: "全部",
      favoriteMode: "all",
    }));
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
    exportCharactersCsv(characters);
    showToast("CSV 已导出", "success");
    window.setTimeout(() => setLoadingAction(null), 300);
  }

  function openFirstSearchResult() {
    if (visibleCharacters.length > 0) {
      onPreview(visibleCharacters[0]);
    }
  }

  function clearLocalData() {
    onImport([]);
    setSelectedIds([]);
    setIsBulkMode(false);
    setIsClearDataOpen(false);
    setIsSettingsOpen(false);
    clearSearchAndFilters();
    showToast("本地数据已清空", "warning");
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
      handleExportAllJson();
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
      const nextCharacters = await importCharactersFromFiles(files, characters);
      onImport(nextCharacters);
      showToast(`成功导入 ${nextCharacters.length - characters.length} 个角色`);
    } catch {
      showToast("导入失败：JSON 文件不合法", "error");
    } finally {
      setLoadingAction(null);

      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
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

      {isBulkExportOpen && (
        <div
          className="modal-backdrop export-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setIsBulkExportOpen(false);
            }
          }}
          role="presentation"
        >
          <div className="export-dialog" role="dialog" aria-modal="true">
            <div className="preview-card-title">
              <div>
                <p className="eyebrow">Export</p>
                <h2>导出选中角色</h2>
              </div>
              <button
                className="ghost-button"
                onClick={() => setIsBulkExportOpen(false)}
                type="button"
              >
                关闭
              </button>
            </div>
            <div className="export-dialog-list">
              <button onClick={() => handleBulkExport("json")} type="button">
                JSON
              </button>
              <button
                disabled={loadingAction === "bulk-pdf"}
                onClick={() => handleBulkExport("pdf")}
                type="button"
              >
                {loadingAction === "bulk-pdf" ? `导出中 ${exportProgress}` : "PDF"}
              </button>
              <button
                disabled={loadingAction === "bulk-jpg"}
                onClick={() => handleBulkExport("jpg")}
                type="button"
              >
                {loadingAction === "bulk-jpg" ? `导出中 ${exportProgress}` : "JPG"}
              </button>
              <button
                disabled={loadingAction === "bulk-png"}
                onClick={() => handleBulkExport("png")}
                type="button"
              >
                {loadingAction === "bulk-png" ? `导出中 ${exportProgress}` : "PNG"}
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
        <div className="modal-backdrop" role="presentation">
          <div className="command-palette" role="dialog" aria-modal="true">
            <p className="eyebrow">Command Palette</p>
            <h2>快速操作</h2>
            <div className="command-list">
              {[
                ["create", "新建角色", "N"],
                ["search", "搜索角色", "/"],
                ["drafts", "打开草稿箱", ""],
                ["favorites", "打开收藏夹", ""],
                ["import", "导入角色", ""],
                ["export", "导出全部 JSON", ""],
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
        <div className="modal-backdrop" role="presentation">
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
                <h3>Character Studio 是什么</h3>
                <p>一个面向 OC 创作的轻量角色工作台，用于整理角色资料、草稿、预览和备份。</p>
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
                  <li>OpenAI Codex（开发协作）</li>
                  <li>React</li>
                  <li>TypeScript</li>
                  <li>Vite</li>
                  <li>jsPDF</li>
                  <li>html2canvas</li>
                </ul>
              </article>
              <article>
                <h3>Changelog</h3>
                <p>Sprint 6 优化了 Dashboard、草稿箱、Avatar Picker、导入导出、主题切换和 Preview 展示体验。</p>
              </article>
            </div>
            <p className="about-footer">RINTO © 2026</p>
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
              <article>
                <h3>Mobile</h3>
                <label className="settings-check">
                  <input
                    type="checkbox"
                    defaultChecked={localStorage.getItem("character-studio.settings.compact-mobile") !== "false"}
                    onChange={(event) =>
                      localStorage.setItem(
                        "character-studio.settings.compact-mobile",
                        String(event.target.checked),
                      )
                    }
                  />
                  <span>简洁模式</span>
                </label>
                <label className="settings-check">
                  <input
                    type="checkbox"
                    defaultChecked={localStorage.getItem("character-studio.settings.open-search") === "true"}
                    onChange={(event) => {
                      localStorage.setItem(
                        "character-studio.settings.open-search",
                        String(event.target.checked),
                      );
                      setIsSearchPanelOpen(event.target.checked);
                    }}
                  />
                  <span>默认展开搜索</span>
                </label>
                <label className="settings-check">
                  <input
                    type="checkbox"
                    defaultChecked={localStorage.getItem("character-studio.settings.hide-low-priority") !== "false"}
                    onChange={(event) =>
                      localStorage.setItem(
                        "character-studio.settings.hide-low-priority",
                        String(event.target.checked),
                      )
                    }
                  />
                  <span>自动隐藏低优先级信息</span>
                </label>
              </article>
              <article>
                <h3>Export</h3>
                <label>
                  JPG Quality
                  <input
                    defaultValue={localStorage.getItem("character-studio.settings.jpg-quality") || "0.9"}
                    min="0.1"
                    max="1"
                    onChange={(event) =>
                      localStorage.setItem("character-studio.settings.jpg-quality", event.target.value)
                    }
                    step="0.1"
                    type="number"
                  />
                </label>
                <label className="settings-check">
                  <input
                    type="checkbox"
                    defaultChecked={localStorage.getItem("character-studio.settings.pdf-light") !== "false"}
                    onChange={(event) =>
                      localStorage.setItem(
                        "character-studio.settings.pdf-light",
                        String(event.target.checked),
                      )
                    }
                  />
                  <span>PDF Light Mode</span>
                </label>
              </article>
              <article>
                <h3>Data</h3>
                <div className="settings-actions">
                  <button className="ghost-button" onClick={handleExportAllJson} type="button">
                    导出全部 JSON
                  </button>
                  <button className="ghost-button" onClick={() => fileInputRef.current?.click()} type="button">
                    导入 JSON
                  </button>
                  <button className="danger-button" onClick={() => setIsClearDataOpen(true)} type="button">
                    清空本地数据
                  </button>
                </div>
              </article>
              <article>
                <h3>About Data</h3>
                <p className="muted">当前数据保存在浏览器 localStorage。换设备不会自动同步，清除浏览器缓存可能导致数据丢失。</p>
              </article>
            </div>
          </div>
        </div>
      )}

      {isClearDataOpen && (
        <div className="modal-backdrop" role="presentation">
          <div className="confirm-dialog" role="dialog" aria-modal="true">
            <h2>清空本地数据</h2>
            <p>确定要清空所有本地角色数据吗？此操作不可撤销。</p>
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

      <div className="panel intro-panel">
        <div>
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
              收藏 {stats.favoriteCount}
            </button>
            <button
              className={prefs.favoriteMode === "drafts" ? "active" : ""}
              onClick={() => updatePrefs({ favoriteMode: "drafts" })}
              type="button"
            >
              草稿 {stats.draftCount}
            </button>
          </div>
        </div>
        <div className="hero-actions dashboard-hero-actions">
          <button
            aria-label="搜索"
            className={isSearchPanelOpen ? "hero-icon-button hero-collapsible active" : "hero-icon-button hero-collapsible"}
            data-tooltip="搜索"
            onClick={() => setIsSearchPanelOpen((current) => !current)}
            type="button"
          >
            ⌕
            <span className="mobile-search-label">搜索</span>
          </button>
          <button
            aria-label="新建角色"
            className="hero-icon-button hero-collapsible primary-icon"
            data-tooltip="新建角色"
            onClick={onCreate}
            type="button"
          >
            +
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
            □
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
            ♡
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
            {prefs.viewMode === "cards" ? "☰" : "▦"}
          </button>
          <div className="dashboard-actions" ref={moreMenuRef}>
            <input
              accept="application/json,.json"
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
              {loadingAction ? "…" : "···"}
            </button>
            {isMoreMenuOpen && (
              <div className="export-menu">
                <button
                  className="menu-responsive-only"
                  onClick={() => setIsSearchPanelOpen((current) => !current)}
                  type="button"
                >
                  搜索
                </button>
                <button
                  className="menu-responsive-only"
                  onClick={onCreate}
                  type="button"
                >
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
                  {prefs.favoriteMode === "favorites" ? "退出收藏夹" : "收藏夹"}
                </button>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  type="button"
                >
                  导入角色
                </button>
                <button onClick={handleExportAllJson} type="button">
                  导出全部 JSON
                </button>
                <button onClick={handleExportCsv} type="button">
                  导出 CSV
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

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
          ×
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
        </div>
      </div>

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
                          onClick={() => setIsBulkExportOpen(true)}
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
                        <span>□</span>
                        {selectedIds.length === visibleCharacters.length ? "取消全选" : "全选"}
                      </button>
                      {!isDraftView && (
                        <button
                          className="ghost-button"
                          disabled={selectedIds.length === 0}
                          onClick={() => bulkSetFavorite(isFavoriteView ? false : true)}
                          type="button"
                        >
                          <span>{isFavoriteView ? "♡" : "♡"}</span>
                          {isFavoriteView ? "移出" : "收藏"}
                        </button>
                      )}
                      {!isDraftView && (
                        <button
                          className="ghost-button"
                          disabled={selectedIds.length === 0 || loadingAction !== null}
                          onClick={() => setIsBulkExportOpen(true)}
                          type="button"
                        >
                          <span>↓</span>
                          导出
                        </button>
                      )}
                      <button className="ghost-button" onClick={() => setIsBulkMoreOpen(true)} type="button">
                        <span>···</span>
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
                  <span className="mobile-icon">□</span>
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
            <div className="character-table">
              <div className="character-table-head">
                <span>角色</span>
                <span>职业</span>
                <span>世界观</span>
                <span>年龄</span>
                <span>标签</span>
                <span>状态</span>
                <span>最后编辑</span>
                <span>操作</span>
              </div>
              {visibleCharacters.map((character) => {
                const isFavorite = isCharacterFavorite(character, new Set(flags.favoriteIds));
                const isDraft = character.isDraft === true;

                return (
                  <div
                    className={
                      openCardMenuId === character.id
                        ? "character-table-row menu-open"
                        : "character-table-row"
                    }
                    key={character.id}
                  >
                    <button className="table-main" onClick={() => onPreview(character)} type="button">
                      <span className="table-avatar">{character.avatarEmoji || "🙂"}</span>
                      <strong>{character.name || "未命名角色"}</strong>
                    </button>
                    <span>{character.occupation || "未填写"}</span>
                    <span>{character.worldview || "未填写"}</span>
                    <span>{character.age || "未填写"}</span>
                    <div className="table-tags">
                      {getPersonalityTags(character).slice(0, 4).map((tag) => (
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
                    <span>{isDraft ? "草稿" : isFavorite ? "已收藏" : "正式"}</span>
                    <span>{formatDate(character.updatedAt)}</span>
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
                          <button className="bare-icon-button table-edit-button" onClick={() => onEdit(character)} type="button">
                            ⌁
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
                              ···
                            </button>
                            {openCardMenuId === character.id && (
                              <div className="card-menu table-card-menu" onClick={(event) => event.stopPropagation()}>
                                <button onClick={() => onPreview(character)} type="button">
                                  预览
                                </button>
                                <button
                                  onClick={() => {
                                    onEdit(character);
                                    setOpenCardMenuId(null);
                                  }}
                                  type="button"
                                >
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
                                  复制
                                </button>
                                <button
                                  onClick={() => {
                                    setExportTarget(character);
                                    setOpenCardMenuId(null);
                                  }}
                                  type="button"
                                >
                                  导出
                                </button>
                                <button
                                  className="menu-danger"
                                  onClick={() => {
                                    setPendingDelete(character);
                                    setOpenCardMenuId(null);
                                  }}
                                  type="button"
                                >
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
            {visibleCharacters.map((character) => {
              const tags = getPersonalityTags(character);
              const visibleTags = tags.slice(0, 5);
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
                    className="avatar-placeholder preview-hit"
                    onClick={() => onPreview(character)}
                    type="button"
                  >
                    {character.avatarEmoji || "🙂"}
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
                        ⌁
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
                          ···
                        </button>
                        {openCardMenuId === character.id && (
                          <div className="card-menu" onClick={(event) => event.stopPropagation()}>
                            <button onClick={() => onPreview(character)} type="button">
                              预览
                            </button>
                            <button
                              onClick={() => {
                                onEdit(character);
                                setOpenCardMenuId(null);
                              }}
                              type="button"
                            >
                              编辑
                            </button>
                            <button
                              onClick={() => {
                                togglePinned(character.id);
                                setOpenCardMenuId(null);
                              }}
                              type="button"
                            >
                              {isPinned ? "取消置顶" : "置顶"}
                            </button>
                            <button
                              onClick={() => {
                                onDuplicate(character);
                                setOpenCardMenuId(null);
                              }}
                              type="button"
                            >
                              复制
                            </button>
                            <button
                              onClick={() => {
                                setExportTarget(character);
                                setOpenCardMenuId(null);
                              }}
                              type="button"
                            >
                              导出
                            </button>
                            <button
                              className="menu-danger"
                              onClick={() => {
                                setPendingDelete(character);
                                setOpenCardMenuId(null);
                              }}
                              type="button"
                            >
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
                        {isFavorite ? "♥" : "♡"}
                      </button>
                      <button
                        className="card-time-button preview-hit"
                        onClick={() => onPreview(character)}
                        type="button"
                      >
                        {formatDate(character.updatedAt)}
                      </button>
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
                    <button
                      className="card-time-button preview-hit"
                      onClick={() => onPreview(character)}
                      type="button"
                    >
                      {formatDate(character.updatedAt)}
                    </button>
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
      <footer className="dashboard-footer">
        <button onClick={() => setIsAboutOpen(true)} type="button">
          About Character Studio
        </button>
        <span>RINTO © 2026</span>
        <button onClick={() => setIsSettingsOpen((current) => !current)} type="button">
          Settings
        </button>
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

function loadDashboardPrefs(): DashboardPrefs {
  try {
    const value = localStorage.getItem(DASHBOARD_PREFS_KEY);
    const parsedValue = value ? { ...defaultPrefs, ...JSON.parse(value) } : defaultPrefs;

    return {
      ...parsedValue,
      viewMode: parsedValue.viewMode === "list" ? "list" : "cards",
    };
  } catch {
    return defaultPrefs;
  }
}

function loadDashboardFlags(): DashboardFlags {
  try {
    const value = localStorage.getItem(DASHBOARD_FLAGS_KEY);
    return value ? { ...defaultFlags, ...JSON.parse(value) } : defaultFlags;
  } catch {
    return defaultFlags;
  }
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
