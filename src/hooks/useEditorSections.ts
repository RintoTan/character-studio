import { useState } from "react";
import {
  defaultCollapseState,
  loadCollapseState,
  saveCollapseState,
  type EditorCollapseState,
  type EditorSectionId,
} from "../storage/editorUiState";
import {
  EDITOR_SECTIONS,
  nextUnfinishedSection,
} from "../pages/editor/sections";
import type { CharacterDraft } from "../types/character";

// Which section the author is looking at, whether the editor is showing the form or
// the preview, and which modules are folded.
//
// The fold has two callers with different intent, and keeping them apart is the
// point of this hook:
//
//   * the author folds a module or jumps to one -- that is a habit, and it is
//     written to storage;
//   * the developer's `expandAllSections` / `collapseAllSections` setting applies a
//     default "when newly entering the edit page". It is deliberately NOT written,
//     because persisting it would overwrite the habit the author stored.
//
// So the two are separate functions rather than one, and the difference is visible
// here instead of being an accident of which setter a call site happened to reach
// for.

type Options = {
  formData: CharacterDraft;
  /** The sections actually on offer, in order: the settings can hide some. */
  visibleSectionIds: EditorSectionId[];
  showToast: (message: string) => void;
};

export function useEditorSections({ formData, visibleSectionIds, showToast }: Options) {
  // "Where the author last jumped to", for highlighting the section nav. There is no
  // scroll spy, so this is the nav's memory rather than a reading of the viewport.
  const [activeSection, setActiveSection] = useState<EditorSectionId>("basic");
  const [editorMode, setEditorMode] = useState<"edit" | "preview">("edit");
  const [collapsedSections, setCollapsedSections] = useState<EditorCollapseState>(
    () => loadCollapseState() ?? defaultCollapseState,
  );

  /** The author's own fold. Remembered across visits. */
  function setCollapse(next: EditorCollapseState) {
    setCollapsedSections(next);
    saveCollapseState(next);
  }

  /** The developer's per-open default. Applied to this session only; see the note above. */
  function applyDefaultCollapse(next: EditorCollapseState) {
    setCollapsedSections(next);
  }

  function toggleSection(sectionId: EditorSectionId) {
    setCollapse({
      ...collapsedSections,
      [sectionId]: !collapsedSections[sectionId],
    });
  }

  function jumpToSection(sectionId: EditorSectionId) {
    setActiveSection(sectionId);
    // Jumping to a folded module that stays folded would be a jump to a heading, so
    // the jump unfolds it.
    setCollapse({ ...collapsedSections, [sectionId]: false });
    window.setTimeout(() => {
      document
        .getElementById(`workspace-${sectionId}`)
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 0);
  }

  function jumpToNextUnfinished() {
    // Continue from wherever the author is, and wrap around so the control always
    // lands somewhere instead of going dead at the last section.
    const targetId = nextUnfinishedSection(formData, activeSection, visibleSectionIds);

    if (!targetId) {
      showToast("所有模块都已完成");
      return;
    }

    jumpToSection(targetId);
    showToast(
      `已跳到「${EDITOR_SECTIONS.find((section) => section.id === targetId)?.title ?? targetId}」`,
    );
  }

  function openEditorPreview() {
    setEditorMode("preview");
    window.requestAnimationFrame(() => {
      window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    });
  }

  return {
    activeSection,
    setActiveSection,
    editorMode,
    setEditorMode,
    collapsedSections,
    setCollapse,
    applyDefaultCollapse,
    toggleSection,
    jumpToSection,
    jumpToNextUnfinished,
    openEditorPreview,
  };
}
