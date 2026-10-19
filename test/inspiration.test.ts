import { describe, expect, it } from "vitest";
import {
  CATEGORY_TARGETS,
  generateSuggestions,
  mergeSuggestions,
  rerollSuggestion,
} from "../src/inspiration/engine";
import type { ApplyItem } from "../src/inspiration/types";
import type { CharacterDraft } from "../src/types/character";

const empty = {} as CharacterDraft;

const archiveKeeper = {
  occupation: "档案整理员",
  worldview: "雾海大陆",
  backstory: "负责整理旧城的档案与记录。",
} as CharacterDraft;

describe("inspiration engine", () => {
  it("returns the same candidates for the same seed", () => {
    const a = generateSuggestions({ category: "background", context: empty, seed: 42 });
    const b = generateSuggestions({ category: "background", context: empty, seed: 42 });

    expect(a.map((item) => item.entryId)).toEqual(b.map((item) => item.entryId));
  });

  it("does not repeat an entry inside one generation", () => {
    const list = generateSuggestions({ category: "appearance", context: empty, seed: 7 });
    expect(new Set(list.map((item) => item.entryId)).size).toBe(list.length);
  });

  it("uses the character context when there is something to use", () => {
    const list = generateSuggestions({ category: "background", context: archiveKeeper, seed: 3 });
    expect(list.length).toBeGreaterThan(0);
    expect(list.some((item) => item.matchedKeywords.length > 0)).toBe(true);
  });

  it("still works for an empty character", () => {
    const list = generateSuggestions({ category: "items", context: empty, seed: 11 });
    expect(list).toHaveLength(3);
    expect(list.every((item) => item.text.length > 0)).toBe(true);
  });

  it("rerolls away from the entries already on screen", () => {
    const [first] = generateSuggestions({ category: "interests", context: empty, seed: 1, count: 1 });
    const next = rerollSuggestion({
      category: "interests",
      context: empty,
      seed: 2,
      avoidEntryIds: [first.entryId],
    });

    expect(next).toBeDefined();
    expect(next?.entryId).not.toBe(first.entryId);
  });

  it("maps every category to a field the character actually has", () => {
    expect(CATEGORY_TARGETS.motivation.field).toBe("backstory");
    expect(CATEGORY_TARGETS.personality.field).toBe("personalityTags");
    expect(CATEGORY_TARGETS.personality.kind).toBe("tag");
    expect(CATEGORY_TARGETS.items.field).toBe("importantItems");
  });
});

describe("mergeSuggestions", () => {
  const suggestion = (overrides: Partial<ApplyItem["suggestion"]>) =>
    ({
      id: "s1",
      category: "background",
      entryId: "bg-01",
      text: "新的背景。",
      field: "backstory",
      fieldLabel: "背景故事",
      kind: "text",
      matchedKeywords: [],
      ...overrides,
    }) as ApplyItem["suggestion"];

  it("appends to existing text without replacing it", () => {
    const base = { backstory: "旧内容。" } as CharacterDraft;
    const next = mergeSuggestions(base, [{ suggestion: suggestion({}), mode: "append" }]);

    expect(next.backstory).toBe("旧内容。\n新的背景。");
  });

  it("replaces only when asked, and when the field is empty", () => {
    const base = { backstory: "旧内容。" } as CharacterDraft;
    const replaced = mergeSuggestions(base, [{ suggestion: suggestion({}), mode: "replace" }]);
    const blank = mergeSuggestions({} as CharacterDraft, [
      { suggestion: suggestion({}), mode: "append" },
    ]);

    expect(replaced.backstory).toBe("新的背景。");
    expect(blank.backstory).toBe("新的背景。");
  });

  it("adds a personality tag once", () => {
    const base = { personalityTags: ["谨慎"] } as CharacterDraft;
    const item: ApplyItem = {
      suggestion: suggestion({ kind: "tag", field: "personalityTags", fieldLabel: "性格标签", text: "谨慎" }),
      mode: "append",
    };

    expect(mergeSuggestions(base, [item]).personalityTags).toEqual(["谨慎"]);
  });

  it("keeps both suggestions when two target the same field", () => {
    const next = mergeSuggestions({} as CharacterDraft, [
      { suggestion: suggestion({ id: "a", text: "第一段。" }), mode: "append" },
      { suggestion: suggestion({ id: "b", text: "第二段。" }), mode: "append" },
    ]);

    expect(next.backstory).toBe("第一段。\n第二段。");
  });

  it("joins two occupations on one line", () => {
    const next = mergeSuggestions({ occupation: "抄写员" } as CharacterDraft, [
      {
        suggestion: suggestion({ field: "occupation", fieldLabel: "职业", text: "档案整理员" }),
        mode: "append",
      },
    ]);

    expect(next.occupation).toBe("抄写员 · 档案整理员");
  });
});
