import { useEffect, useRef, useState } from "react";
import { CharacterForm } from "./pages/CharacterForm";
import { CharacterPreview } from "./pages/CharacterPreview";
import { Dashboard } from "./pages/Dashboard";
import { AvatarDisplay } from "./components/AvatarDisplay";
import {
  deleteCharacter,
  duplicateCharacter,
  loadCharacters,
  saveCharacters,
  upsertCharacter,
} from "./storage/characterStorage";
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

type Page = "dashboard" | "form" | "preview";
type ThemeMode = "system" | "light" | "dark";

const THEME_KEY = "character-studio.theme";
const ABOUT_SEEN_KEY = "character-studio.about-seen";

function App() {
  const [page, setPage] = useState<Page>("dashboard");
  const [characters, setCharacters] = useState<Character[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isThemeMenuOpen, setIsThemeMenuOpen] = useState(false);
  const [isAppAboutOpen, setIsAppAboutOpen] = useState(false);
  const [isAppSettingsOpen, setIsAppSettingsOpen] = useState(false);
  const [isAppAssetLibraryOpen, setIsAppAssetLibraryOpen] = useState(false);
  const [isAppAssetCleanupOpen, setIsAppAssetCleanupOpen] = useState(false);
  const [isAppClearDataOpen, setIsAppClearDataOpen] = useState(false);
  const [pendingAppAssetDelete, setPendingAppAssetDelete] = useState<AvatarAssetRecord | null>(null);
  const [pendingAppAssetBatchDeleteIds, setPendingAppAssetBatchDeleteIds] = useState<string[]>([]);
  const [avatarAssets, setAvatarAssets] = useState<AvatarAssetRecord[]>([]);
  const [selectedAppAssetIds, setSelectedAppAssetIds] = useState<string[]>([]);
  const [avatarAssetStats, setAvatarAssetStats] = useState({ count: 0, size: 0 });
  const [showQuickBackToTop, setShowQuickBackToTop] = useState(false);
  const [editorSaveSignal, setEditorSaveSignal] = useState(0);
  const [editorDraftSaveSignal, setEditorDraftSaveSignal] = useState(0);
  const [previewExportSignal, setPreviewExportSignal] = useState(0);
  const [dashboardSearchSignal, setDashboardSearchSignal] = useState(0);
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
  const appAssetImportInputRef = useRef<HTMLInputElement>(null);
  const isHistoryNavigationRef = useRef(false);

  useEffect(() => {
    setCharacters(loadCharacters());
    setIsLoading(false);
    if (localStorage.getItem(ABOUT_SEEN_KEY) !== "true") {
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
        setIsAppAssetLibraryOpen(false);
        setPendingAppAssetDelete(null);
        setIsAppAssetCleanupOpen(false);
        setIsAppClearDataOpen(false);
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
    setIsAppSettingsOpen(false);
    setIsAppAssetLibraryOpen(false);
    setIsAppAssetCleanupOpen(false);
    setIsAppClearDataOpen(false);
    setPendingAppAssetDelete(null);
    setPendingAppAssetBatchDeleteIds([]);
  }

  useEffect(() => {
    window.history.replaceState({ characterStudioPage: "dashboard" }, "", window.location.href);

    function handlePopState(event: PopStateEvent) {
      isHistoryNavigationRef.current = true;
      const nextPage = event.state?.characterStudioPage;
      setPage(nextPage === "form" || nextPage === "preview" ? nextPage : "dashboard");
      setIsAppAboutOpen(false);
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

    window.history.pushState({ characterStudioPage: page }, "", window.location.href);
  }, [page]);

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
    setCharacters(deleteCharacter(character.id));

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
      <nav className="topbar">
        <button className="brand-button" onClick={goDashboard}>
          <img alt="" className="brand-mark" src="/favicon.svg" />
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
                ◐
              </button>
              <button
                aria-label="打开主题菜单"
                className="theme-combo-button theme-combo-arrow"
                onClick={() => setIsThemeMenuOpen((current) => !current)}
                type="button"
              >
                ▾
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
                  跟随系统
                </button>
                <button
                  className={themeMode === "light" ? "selected" : ""}
                  onClick={() => {
                    setThemeMode("light");
                    setIsThemeMenuOpen(false);
                  }}
                  type="button"
                >
                  浅色
                </button>
                <button
                  className={themeMode === "dark" ? "selected" : ""}
                  onClick={() => {
                    setThemeMode("dark");
                    setIsThemeMenuOpen(false);
                  }}
                  type="button"
                >
                  深色
                </button>
              </div>
            )}
          </div>
        </div>
      </nav>

      {page === "dashboard" && (
        <Dashboard
          characters={characters}
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
        />
      )}

      {page === "form" && (
        <CharacterForm
          character={selectedCharacter}
          onSave={handleSave}
          onDraftSave={handleDraftSave}
          onAutoSave={handleAutoSave}
          onDelete={handleDelete}
          onCancel={() => setPage("dashboard")}
          saveSignal={editorSaveSignal}
          draftSaveSignal={editorDraftSaveSignal}
        />
      )}

      {page === "preview" && selectedCharacter && (
        <CharacterPreview
          character={selectedCharacter}
          onBack={() => setPage("dashboard")}
          onEdit={() => handleEdit(selectedCharacter)}
          onToggleFavorite={() => handleToggleFavorite(selectedCharacter)}
          exportSignal={previewExportSignal}
        />
      )}

      <div className="floating-actions" aria-label="快捷操作">
        {showQuickBackToTop && (
          <button
            aria-label="回到顶部"
            className="floating-action"
            data-tooltip="回到顶部"
            onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
            type="button"
          >
            ↑
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
            ←
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
            ⌂
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
            +
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
            ⌕
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
            ⌂
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
            ⌁
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
            ↓
          </button>
        )}
        {!isAppOverlayOpen && page === "form" && (
          <button
            aria-label="保存角色"
            className="floating-action"
            data-tooltip="保存角色"
            onClick={() => setEditorSaveSignal((current) => current + 1)}
            type="button"
          >
            ✓
          </button>
        )}
        {!isAppOverlayOpen && page === "form" && (
          <button
            aria-label="临时保存"
            className="floating-action"
            data-tooltip="临时保存"
            onClick={() => setEditorDraftSaveSignal((current) => current + 1)}
            type="button"
          >
            ◇
          </button>
        )}
      </div>

      {page !== "dashboard" && (
        <footer className="dashboard-footer app-footer" data-pdf-hidden="true">
          <button onClick={() => setIsAppAboutOpen(true)} type="button">
            About Character Studio
          </button>
          <button onClick={() => setIsAppAssetLibraryOpen(true)} type="button">
            头像素材库
          </button>
          <button onClick={() => setIsAppSettingsOpen((current) => !current)} type="button">
            Settings
          </button>
          <span>RINTO © 2026</span>
        </footer>
      )}

      {isAppAboutOpen && (
        <div className="modal-backdrop" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setIsAppAboutOpen(false);
        }} role="presentation">
          <div className="about-dialog" role="dialog" aria-modal="true">
            <div className="preview-card-title">
              <div>
                <p className="eyebrow">About</p>
                <h2>About Character Studio</h2>
              </div>
              <button className="ghost-button" onClick={() => setIsAppAboutOpen(false)} type="button">
                关闭
              </button>
            </div>
            <div className="about-grid">
              <article>
                <h3>Character Studio 是什么</h3>
                <p>一个面向 OC 创作的轻量角色工作台，用于整理角色资料、草稿、预览和备份。</p>
              </article>
              <article>
                <h3>核心功能</h3>
                <ul className="about-list">
                  <li>Dashboard、Editor、Preview、草稿箱与收藏夹。</li>
                  <li>主题切换、导入导出、PDF / JPG / PNG 输出。</li>
                </ul>
              </article>
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
                <p className="muted">RINTO 联合 Codex 共同开发 2026。</p>
              </article>
              <article>
                <h3>鸣谢</h3>
                <p>感谢 OpenAI Codex、React、TypeScript、Vite、jsPDF 与 html2canvas 提供支持。</p>
              </article>
              <article>
                <h3>Changelog</h3>
                <p>近期版本重点完善了 Avatar、头像素材库、导入导出、Design System 与移动端体验。</p>
              </article>
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
            </div>
            <p className="about-footer">RINTO © 2026</p>
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
              <article>
                <h3>About Data</h3>
                <p className="muted">当前数据保存在浏览器 localStorage。换设备不会自动同步。</p>
                <div className="settings-actions">
                  <button className="danger-button" onClick={() => setIsAppClearDataOpen(true)} type="button">
                    清空本地数据
                  </button>
                </div>
              </article>
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
