// @vitest-environment happy-dom
import { act, createElement, type FC } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useEditorSections } from "../src/hooks/useEditorSections";
import {
  EDITOR_COLLAPSE_KEY,
  defaultCollapseState,
  type EditorCollapseState,
} from "../src/storage/editorUiState";
import type { CharacterDraft } from "../src/types/character";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mounted: Array<() => void> = [];

function mountHook<T>(useHook: () => T) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const holder: { current: T } = { current: undefined as unknown as T };

  const Probe: FC = () => {
    holder.current = useHook();
    return null;
  };

  act(() => {
    root.render(createElement(Probe));
  });

  const unmount = () => {
    act(() => {
      root.unmount();
    });
    container.remove();
  };
  mounted.push(unmount);

  return { read: () => holder.current, unmount };
}

const draft = (overrides: Partial<CharacterDraft> = {}): CharacterDraft => ({
  name: "",
  avatarEmoji: "🙂",
  avatarAssetId: "",
  isDraft: false,
  age: "",
  birthDate: "",
  birthYear: "",
  gender: "",
  species: "",
  occupation: "",
  worldview: "",
  personalityTags: [],
  appearanceDescription: "",
  abilityDescription: "",
  backstory: "",
  likes: "",
  dislikes: "",
  habits: "",
  importantItems: "",
  relationshipKeywords: "",
  visualStyle: "",
  characterKeywords: "",
  imagePrompt: "",
  ...overrides,
});

const ALL = ["basic", "appearance", "personality", "ability", "backstory", "prompt"] as const;

const stored = (): EditorCollapseState =>
  JSON.parse(localStorage.getItem(EDITOR_COLLAPSE_KEY) || "null") as EditorCollapseState;

function makeHarness(options: { initial?: CharacterDraft; visible?: string[] } = {}) {
  const state = {
    formData: options.initial ?? draft(),
    toasts: [] as string[],
  };
  const use = () =>
    useEditorSections({
      formData: state.formData,
      visibleSectionIds: (options.visible ?? [...ALL]) as never,
      showToast: (message: string) => state.toasts.push(message),
    });
  return { state, use };
}

describe("editor sections", () => {
  beforeEach(() => {
    localStorage.clear();
    // happy-dom does not implement either, and both are incidental to what is being
    // asserted here.
    Element.prototype.scrollIntoView = vi.fn();
    window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
  });

  afterEach(() => {
    while (mounted.length > 0) {
      mounted.pop()?.();
    }
    vi.restoreAllMocks();
  });

  it("opens with every module unfolded when nothing is stored", () => {
    const { use } = makeHarness();
    const hook = mountHook(use).read();

    expect(hook.collapsedSections).toEqual(defaultCollapseState);
    expect(hook.activeSection).toBe("basic");
    expect(hook.editorMode).toBe("edit");
  });

  it("opens with the fold the author left behind", () => {
    localStorage.setItem(
      EDITOR_COLLAPSE_KEY,
      JSON.stringify({ ...defaultCollapseState, personality: true, prompt: true }),
    );

    const { use } = makeHarness();
    const hook = mountHook(use).read();

    expect(hook.collapsedSections.personality).toBe(true);
    expect(hook.collapsedSections.prompt).toBe(true);
    expect(hook.collapsedSections.basic).toBe(false);
  });

  describe("the author's own fold is remembered", () => {
    it("writes the module the author folded", () => {
      const { use } = makeHarness();
      const hook = mountHook(use);

      act(() => hook.read().toggleSection("ability"));

      expect(hook.read().collapsedSections.ability).toBe(true);
      expect(stored().ability).toBe(true);
    });

    it("unfolds it again on the second toggle, and that is stored too", () => {
      const { use } = makeHarness();
      const hook = mountHook(use);

      act(() => hook.read().toggleSection("ability"));
      act(() => hook.read().toggleSection("ability"));

      expect(hook.read().collapsedSections.ability).toBe(false);
      expect(stored().ability).toBe(false);
    });

    it("leaves the other modules alone", () => {
      const { use } = makeHarness();
      const hook = mountHook(use);

      act(() => hook.read().toggleSection("backstory"));

      const saved = stored();
      expect(Object.keys(saved).sort()).toEqual([...ALL].sort());
      expect(ALL.filter((id) => saved[id])).toEqual(["backstory"]);
    });
  });

  describe("jumping to a module", () => {
    it("unfolds the target and remembers both the jump and the unfold", () => {
      localStorage.setItem(
        EDITOR_COLLAPSE_KEY,
        JSON.stringify({ ...defaultCollapseState, prompt: true }),
      );
      const { use } = makeHarness({ visible: [...ALL] });
      const hook = mountHook(use);

      act(() => hook.read().jumpToSection("prompt"));

      expect(hook.read().activeSection).toBe("prompt");
      expect(hook.read().collapsedSections.prompt).toBe(false);
      // The unfold is the author's doing, so it is persisted.
      expect(stored().prompt).toBe(false);
    });

    it("scrolls the module into view rather than only moving the highlight", () => {
      // The scroll is deferred by a `setTimeout(…, 0)` so it lands after the unfold
      // has been committed -- scrolling to a module that is still folded would
      // measure the wrong box. Faking timers is how that deferral is observed.
      vi.useFakeTimers();

      const target = document.createElement("section");
      target.id = "workspace-backstory";
      document.body.appendChild(target);

      const { use } = makeHarness({ visible: [...ALL] });
      const hook = mountHook(use);

      act(() => hook.read().jumpToSection("backstory"));
      expect(target.scrollIntoView).not.toHaveBeenCalled();

      act(() => {
        vi.advanceTimersByTime(0);
      });
      expect(target.scrollIntoView).toHaveBeenCalled();

      target.remove();
      vi.useRealTimers();
    });
  });

  describe("the developer's per-open default", () => {
    it("applies the fold but does NOT overwrite what the author stored", () => {
      // This is the whole reason the two are separate functions. The setting means
      // "when newly entering the edit page", so writing it back would replace the
      // author's habit with a default on every visit.
      localStorage.setItem(
        EDITOR_COLLAPSE_KEY,
        JSON.stringify({ ...defaultCollapseState, ability: true }),
      );

      const { use } = makeHarness();
      const hook = mountHook(use);

      act(() => hook.read().applyDefaultCollapse({ ...defaultCollapseState, prompt: true }));

      expect(hook.read().collapsedSections.prompt).toBe(true);
      expect(hook.read().collapsedSections.ability).toBe(false);
      // Storage still says what the author left, not what the default applied.
      expect(stored().ability).toBe(true);
      expect(stored().prompt).toBe(false);
    });
  });

  describe("jumping to the next unfinished module", () => {
    it("lands on the next unfinished one and says which", () => {
      // Nothing is filled in, so every module is unfinished and the control should
      // move past the one the author is on.
      const { state, use } = makeHarness({ initial: draft() });
      const hook = mountHook(use);

      act(() => hook.read().jumpToNextUnfinished());

      expect(hook.read().activeSection).toBe("appearance");
      expect(state.toasts).toHaveLength(1);
      expect(state.toasts[0]).toContain("外貌");
    });

    it("wraps around instead of going dead on the last module", () => {
      // Every module complete except `basic`, and the author is sitting on the last
      // one -- so the only unfinished section is behind them.
      const { use } = makeHarness({
        initial: draft({
          appearanceDescription: "x",
          visualStyle: "y",
          personalityTags: ["冷静"],
          abilityDescription: "z",
          backstory: "w",
          characterKeywords: "k",
          imagePrompt: "p",
        }),
      });
      const hook = mountHook(use);

      act(() => hook.read().jumpToSection("prompt"));
      act(() => hook.read().jumpToNextUnfinished());

      expect(hook.read().activeSection).toBe("basic");
    });

    it("offers nothing, and says so, when everything is finished", () => {
      const { state, use } = makeHarness({
        initial: draft({
          name: "名字",
          gender: "女",
          species: "人类",
          occupation: "职业",
          worldview: "世界观",
          appearanceDescription: "x",
          visualStyle: "y",
          personalityTags: ["冷静"],
          abilityDescription: "z",
          backstory: "w",
          characterKeywords: "k",
          imagePrompt: "p",
        }),
      });
      const hook = mountHook(use);

      act(() => hook.read().jumpToNextUnfinished());

      expect(state.toasts).toEqual(["所有模块都已完成"]);
      expect(hook.read().activeSection).toBe("basic");
    });

    it("only considers the modules actually on offer", () => {
      // The prompt module is hidden by the settings, so it cannot be the answer.
      const { use } = makeHarness({ initial: draft(), visible: ["basic"] });
      const hook = mountHook(use);

      act(() => hook.read().jumpToNextUnfinished());

      expect(hook.read().activeSection).toBe("basic");
      expect(hook.read().activeSection).not.toBe("prompt");
    });
  });

  describe("the preview", () => {
    it("switches the mode and returns to the top, without touching the fold", () => {
      const { use } = makeHarness();
      const hook = mountHook(use);

      act(() => hook.read().toggleSection("ability"));
      const foldBefore = JSON.stringify(hook.read().collapsedSections);

      act(() => hook.read().openEditorPreview());

      expect(hook.read().editorMode).toBe("preview");
      expect(JSON.stringify(hook.read().collapsedSections)).toBe(foldBefore);
    });
  });
});
