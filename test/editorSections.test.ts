import { describe, expect, it } from "vitest";
import {
  EDITOR_SECTIONS,
  completionStatus,
  nextUnfinishedSection,
  sectionShortTitle,
  unfinishedSections,
} from "../src/pages/editor/sections";
import { EDITOR_SECTION_IDS } from "../src/storage/editorUiState";

const complete = {
  name: "澪",
  gender: "女",
  species: "精灵",
  occupation: "术士",
  worldview: "雾海纪",
  appearanceDescription: "银发紫瞳。",
  visualStyle: "写实",
  personalityTags: ["冷静"],
  abilityDescription: "操控雾气。",
  backstory: "出身雾海。",
  characterKeywords: "银发",
  imagePrompt: "silver hair",
};

describe("editor sections", () => {
  it("lists sections in the same order the fold memory stores them", () => {
    expect(EDITOR_SECTIONS.map((section) => section.id)).toEqual([...EDITOR_SECTION_IDS]);
  });

  it("gives every section a short title", () => {
    for (const section of EDITOR_SECTIONS) {
      expect(sectionShortTitle(section.id).length).toBeGreaterThan(0);
    }
  });

  it("calls a section 未完成 only when it is empty", () => {
    expect(completionStatus("basic", {})).toBe("未完成");
    expect(completionStatus("personality", { personalityTags: [] })).toBe("未完成");
    expect(completionStatus("basic", { name: "澪" })).toBe("部分完成");
  });

  it("needs all five identity fields before 基础信息 is done", () => {
    const four = { name: "澪", gender: "女", species: "精灵", occupation: "术士" };

    expect(completionStatus("basic", four)).toBe("部分完成");
    expect(completionStatus("basic", { ...four, worldview: "雾海纪" })).toBe("已完成");
  });

  it("needs both halves of the prompt section", () => {
    expect(completionStatus("prompt", { characterKeywords: "银发" })).toBe("部分完成");
    expect(
      completionStatus("prompt", { characterKeywords: "银发", imagePrompt: "silver hair" }),
    ).toBe("已完成");
  });

  it("reports the sections that still need work", () => {
    expect(unfinishedSections({ ...complete, backstory: "" }).map((section) => section.id)).toEqual([
      "backstory",
    ]);
    expect(unfinishedSections(complete)).toEqual([]);
  });

  it("walks forward from where the author is, then wraps", () => {
    const data = { ...complete, abilityDescription: "", backstory: "" };

    expect(nextUnfinishedSection(data, "basic")).toBe("ability");
    expect(nextUnfinishedSection(data, "ability")).toBe("backstory");
    // Nothing left after 背景故事, so the control wraps to the first gap.
    expect(nextUnfinishedSection(data, "backstory")).toBe("ability");
  });

  it("returns nothing to jump to when the character is complete", () => {
    expect(nextUnfinishedSection(complete, "basic")).toBeNull();
  });

  it("ignores sections that are hidden from the rail", () => {
    const data = { ...complete, characterKeywords: "", imagePrompt: "" };

    expect(nextUnfinishedSection(data, "basic")).toBe("prompt");
    expect(nextUnfinishedSection(data, "basic", ["basic", "appearance"])).toBeNull();
  });
});
