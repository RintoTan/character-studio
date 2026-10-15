// @vitest-environment happy-dom
import { act, createElement, type FC } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { useIdentityEditing } from "../src/hooks/useIdentityEditing";
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
  name: "测试",
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

function makeHarness(initial: CharacterDraft = draft()) {
  const state = { formData: initial };
  const use = () =>
    useIdentityEditing({
      setFormData: (update) => {
        state.formData =
          typeof update === "function"
            ? (update as (current: CharacterDraft) => CharacterDraft)(state.formData)
            : update;
      },
      setField: (field, value) => {
        state.formData = { ...state.formData, [field]: value };
      },
    });
  return { state, use };
}

describe("identity editing", () => {
  afterEach(() => {
    while (mounted.length > 0) {
      mounted.pop()?.();
    }
  });

  describe("personality tags", () => {
    it("adds a tag that is not there and takes away one that is", () => {
      const { state, use } = makeHarness();
      const hook = mountHook(use);

      act(() => hook.read().togglePersonalityTag("冷静"));
      expect(state.formData.personalityTags).toEqual(["冷静"]);

      act(() => hook.read().togglePersonalityTag("温柔"));
      expect(state.formData.personalityTags).toEqual(["冷静", "温柔"]);

      act(() => hook.read().togglePersonalityTag("冷静"));
      expect(state.formData.personalityTags).toEqual(["温柔"]);
    });

    it("survives a draft whose tags are missing rather than throwing", () => {
      const { state, use } = makeHarness({
        ...draft(),
        personalityTags: undefined as unknown as string[],
      });
      const hook = mountHook(use);

      act(() => hook.read().togglePersonalityTag("冷静"));

      expect(state.formData.personalityTags).toEqual(["冷静"]);
    });

    it("adds a typed tag, trimmed, and empties the box", () => {
      const { state, use } = makeHarness();
      const hook = mountHook(use);

      act(() => hook.read().setCustomTag("  寡言  "));
      act(() => hook.read().addCustomTag());

      expect(state.formData.personalityTags).toEqual(["寡言"]);
      expect(hook.read().customTag).toBe("");
    });

    it("refuses a blank box, and leaves the box alone", () => {
      const { state, use } = makeHarness();
      const hook = mountHook(use);

      act(() => hook.read().setCustomTag("   "));
      act(() => hook.read().addCustomTag());

      expect(state.formData.personalityTags).toEqual([]);
      expect(hook.read().customTag).toBe("   ");
    });

    it("does not duplicate a tag the character already has", () => {
      const { state, use } = makeHarness(draft({ personalityTags: ["冷静"] }));
      const hook = mountHook(use);

      act(() => hook.read().setCustomTag("冷静"));
      act(() => hook.read().addCustomTag());

      expect(state.formData.personalityTags).toEqual(["冷静"]);
      // The box still clears: the input reads as taken either way.
      expect(hook.read().customTag).toBe("");
    });

    it("removes a tag by name", () => {
      const { state, use } = makeHarness(draft({ personalityTags: ["冷静", "温柔", "冷静"] }));
      const hook = mountHook(use);

      act(() => hook.read().removeTag("冷静"));

      expect(state.formData.personalityTags).toEqual(["温柔"]);
    });
  });

  describe("gender", () => {
    it("writes a choice from the list straight through", () => {
      const { state, use } = makeHarness();
      const hook = mountHook(use);

      act(() => hook.read().handleGenderModeChange("女"));

      expect(hook.read().genderMode).toBe("女");
      expect(state.formData.gender).toBe("女");
    });

    it("keeps what was typed when the author switches back to 自定义", () => {
      // The point of the local state: 自定义 means "the value below is mine", so
      // re-selecting it must not blank out the text the author already entered.
      const { state, use } = makeHarness();
      const hook = mountHook(use);

      act(() => hook.read().handleCustomGenderChange("性别流动"));
      act(() => hook.read().handleGenderModeChange("女"));
      act(() => hook.read().handleGenderModeChange("自定义"));

      expect(state.formData.gender).toBe("性别流动");
    });

    it("writes every keystroke of a custom value", () => {
      const { state, use } = makeHarness();
      const hook = mountHook(use);

      act(() => hook.read().handleCustomGenderChange("非二元"));
      expect(state.formData.gender).toBe("非二元");

      act(() => hook.read().handleCustomGenderChange("未知"));
      expect(state.formData.gender).toBe("未知");
    });
  });

  describe("age and birthday", () => {
    it("keeps digits only, so a typed letter cannot reach the field", () => {
      const { state, use } = makeHarness();
      const hook = mountHook(use);

      act(() => hook.read().setManualAge("2a4 岁"));

      expect(state.formData.age).toBe("24");
      expect(hook.read().ageMode).toBe("manual");
    });

    it("clears the birthday when the author types an age, so the two cannot disagree", () => {
      const { state, use } = makeHarness(draft({ birthDate: "2000-01-01", birthYear: "2000" }));
      const hook = mountHook(use);

      act(() => hook.read().setManualAge("30"));

      expect(state.formData.birthDate).toBe("");
      expect(state.formData.birthYear).toBe("");
    });

    it("derives the age from a birthday and clears the other two fields", () => {
      const { state, use } = makeHarness(draft({ age: "99", birthYear: "1999" }));
      const hook = mountHook(use);

      act(() => hook.read().setBirthDate("2004-06-01"));

      expect(state.formData.birthDate).toBe("2004-06-01");
      expect(state.formData.birthYear).toBe("");
      // Derived, so it is a number of years rather than whatever was there before.
      expect(state.formData.age).toMatch(/^\d+$/);
      expect(state.formData.age).not.toBe("99");
      expect(hook.read().ageMode).toBe("birthDate");
    });

    it("blanks the age when the date is cleared", () => {
      const { state, use } = makeHarness(draft({ age: "30" }));
      const hook = mountHook(use);

      act(() => hook.read().setBirthDate(""));

      expect(state.formData.birthDate).toBe("");
      expect(state.formData.age).toBe("");
    });
  });
});
