import { useEffect, useRef, useState } from "react";
import { CharacterForm } from "./pages/CharacterForm";
import { CharacterPreview } from "./pages/CharacterPreview";
import { Dashboard } from "./pages/Dashboard";
import {
  deleteCharacter,
  duplicateCharacter,
  loadCharacters,
  saveCharacters,
  upsertCharacter,
} from "./storage/characterStorage";
import type { Character } from "./types/character";

type Page = "dashboard" | "form" | "preview";
type ThemeMode = "system" | "light" | "dark";

const THEME_KEY = "character-studio.theme";

function App() {
  const [page, setPage] = useState<Page>("dashboard");
  const [characters, setCharacters] = useState<Character[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isThemeMenuOpen, setIsThemeMenuOpen] = useState(false);
  const [isAppAboutOpen, setIsAppAboutOpen] = useState(false);
  const [isAppSettingsOpen, setIsAppSettingsOpen] = useState(false);
  const [showQuickBackToTop, setShowQuickBackToTop] = useState(false);
  const [editorSaveSignal, setEditorSaveSignal] = useState(0);
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
  const isHistoryNavigationRef = useRef(false);

  useEffect(() => {
    setCharacters(loadCharacters());
    setIsLoading(false);
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
    window.history.replaceState({ characterStudioPage: "dashboard" }, "", window.location.href);

    function handlePopState(event: PopStateEvent) {
      isHistoryNavigationRef.current = true;
      const nextPage = event.state?.characterStudioPage;
      setPage(nextPage === "form" || nextPage === "preview" ? nextPage : "dashboard");
      setIsAppAboutOpen(false);
      setIsAppSettingsOpen(false);
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
    setSelectedCharacter(null);
    setPage("form");
  }

  function handleEdit(character: Character) {
    setSelectedCharacter(character);
    setPage("form");
  }

  function handlePreview(character: Character) {
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
      updatedAt: new Date().toISOString(),
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
    setPage("dashboard");
  }

  function toggleTheme() {
    setThemeMode((current) => (current === "dark" ? "light" : "dark"));
    setIsThemeMenuOpen(false);
  }

  return (
    <main className="app-shell">
      <nav className="topbar">
        <button className="brand-button" onClick={() => setPage("dashboard")}>
          Character Studio
        </button>
        <div className="nav-actions">
          <button className="ghost-button" onClick={() => setPage("dashboard")}>
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
        />
      )}

      {page === "preview" && selectedCharacter && (
        <CharacterPreview
          character={selectedCharacter}
          onBack={() => setPage("dashboard")}
          onEdit={() => handleEdit(selectedCharacter)}
          onToggleFavorite={() => handleToggleFavorite(selectedCharacter)}
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
        {page !== "dashboard" && (
          <button
            aria-label="返回"
            className="floating-action"
            data-tooltip="返回"
            onClick={goBack}
            type="button"
          >
            ←
          </button>
        )}
        {page !== "dashboard" && (
          <button
            aria-label="回到主页"
            className="floating-action"
            data-tooltip="回到主页"
            onClick={() => setPage("dashboard")}
            type="button"
          >
            ⌂
          </button>
        )}
        {page === "preview" && selectedCharacter && (
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
        {page === "form" && (
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
      </div>

      {page !== "dashboard" && (
        <footer className="dashboard-footer app-footer" data-pdf-hidden="true">
          <button onClick={() => setIsAppAboutOpen(true)} type="button">
            About Character Studio
          </button>
          <span>RINTO © 2026</span>
          <button onClick={() => setIsAppSettingsOpen((current) => !current)} type="button">
            Settings
          </button>
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
              </article>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

export default App;
