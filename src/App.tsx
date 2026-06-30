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
          isLoading={isLoading}
          onToggleTheme={toggleTheme}
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
            ✎
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
    </main>
  );
}

export default App;
