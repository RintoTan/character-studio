import { describe, expect, it } from "vitest";
import {
  applyBulkPatch,
  describeBulkPatch,
  isEmptyBulkPatch,
  parseTagInput,
} from "../src/utils/bulkEdit";
import type { Character } from "../src/types/character";

const NOW = "2026-10-15T00:00:00.000Z";

function character(overrides: Partial<Character> = {}): Character {
  return {
    id: "c1",
    name: "澪",
    worldview: "雾海纪",
    visualStyle: "写实",
    personalityTags: ["冷静"],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("bulk tag input", () => {
  it("splits on every comma a person might type", () => {
    expect(parseTagInput("反派, 病娇、冷面；boss")).toEqual(["反派", "病娇", "冷面", "boss"]);
  });

  it("drops blanks and repeats regardless of case", () => {
    expect(parseTagInput("Boss, boss , ,反派")).toEqual(["Boss", "反派"]);
  });
});

describe("bulk patch", () => {
  it("only writes the fields that were switched on", () => {
    const result = applyBulkPatch([character()], ["c1"], { worldview: "赛博朋克" }, NOW);

    expect(result.characters[0].worldview).toBe("赛博朋克");
    expect(result.characters[0].visualStyle).toBe("写实");
    expect(result.characters[0].personalityTags).toEqual(["冷静"]);
    expect(result.changedCount).toBe(1);
    expect(result.characters[0].updatedAt).toBe(NOW);
  });

  it("leaves characters that need no change by identity", () => {
    const untouched = character({ id: "c2" });
    const target = character({ id: "c1", worldview: "赛博朋克" });
    const result = applyBulkPatch([target, untouched], ["c1"], { worldview: "赛博朋克" }, NOW);

    expect(result.characters[0]).toBe(target);
    expect(result.characters[1]).toBe(untouched);
    expect(result.changedCount).toBe(0);
  });

  it("adds tags without duplicating what is already there", () => {
    const result = applyBulkPatch([character()], ["c1"], { addTags: ["冷静", "反派"] }, NOW);

    expect(result.characters[0].personalityTags).toEqual(["冷静", "反派"]);
    expect(result.fieldCounts.tagsAdded).toBe(1);
  });

  it("removes tags case-insensitively and reports how many went", () => {
    const target = character({ personalityTags: ["Cool", "冷静"] });
    const result = applyBulkPatch([target], ["c1"], { removeTags: ["cool"] }, NOW);

    expect(result.characters[0].personalityTags).toEqual(["冷静"]);
    expect(result.fieldCounts.tagsRemoved).toBe(1);
  });

  it("can add and remove in one pass", () => {
    const result = applyBulkPatch([character()], ["c1"], { addTags: ["反派"], removeTags: ["冷静"] }, NOW);

    expect(result.characters[0].personalityTags).toEqual(["反派"]);
    expect(result.fieldCounts).toEqual({ worldview: 0, visualStyle: 0, favorite: 0, tagsAdded: 1, tagsRemoved: 1 });
  });

  it("sets the favourite flag and clears the legacy one", () => {
    const target = character({ isFavorite: true });
    const result = applyBulkPatch([target], ["c1"], { favorite: true }, NOW);

    expect(result.characters[0].favorite).toBe(true);
    expect(result.characters[0].isFavorite).toBeUndefined();
  });

  it("leaves drafts alone when the patch is only about favouriting", () => {
    const draft = character({ id: "d1", isDraft: true });
    const result = applyBulkPatch([draft], ["d1"], { favorite: true }, NOW);

    expect(result.characters[0]).toBe(draft);
  });

  it("does not touch characters outside the selection", () => {
    const other = character({ id: "c2" });
    const result = applyBulkPatch([character(), other], ["c1"], { worldview: "科幻" }, NOW);

    expect(result.characters[1]).toBe(other);
  });

  it("reports nothing when the patch asks for nothing", () => {
    expect(isEmptyBulkPatch({})).toBe(true);
    expect(isEmptyBulkPatch({ worldview: "   " })).toBe(true);
    expect(isEmptyBulkPatch({ addTags: ["反派"] })).toBe(false);
    expect(describeBulkPatch({ worldview: 3, visualStyle: 0, favorite: 0, tagsAdded: 2, tagsRemoved: 1 })).toEqual([
      "世界观 3",
      "标签 +2",
      "标签 −1",
    ]);
  });
});
