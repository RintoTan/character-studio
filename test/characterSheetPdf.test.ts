import { describe, expect, it } from "vitest";
import {
  MISSING_GLYPH_BOX,
  buildCharacterSheet,
  findUnsupportedCharacters,
  renderCharacterSheetPdf,
} from "../src/utils/characterSheetPdf";
import type { Character } from "../src/types/character";
import type { Relationship } from "../src/types/relationship";
import type { TimelineEvent } from "../src/types/timeline";
import type { WorldEntry } from "../src/types/world";

const now = "2026-10-17T00:00:00.000Z";

const character = (overrides: Partial<Character> = {}): Character => ({
  id: "char-a",
  name: "沈砚",
  occupation: "议长",
  worldview: "白塔城",
  createdAt: now,
  updatedAt: now,
  ...overrides,
});

const relationship = (overrides: Partial<Relationship> = {}): Relationship => ({
  id: "rel-1",
  fromId: "char-a",
  toId: "char-b",
  kind: "mentor",
  createdAt: now,
  updatedAt: now,
  ...overrides,
});

const event = (overrides: Partial<TimelineEvent> = {}): TimelineEvent => ({
  id: "evt-1",
  title: "潮汐失衡",
  date: "2040-01-01",
  kind: "disaster",
  characterIds: ["char-a"],
  createdAt: now,
  updatedAt: now,
  ...overrides,
});

const entry = (overrides: Partial<WorldEntry> = {}): WorldEntry => ({
  id: "world-1",
  name: "白塔城",
  category: "location",
  tags: [],
  characterIds: ["char-a"],
  createdAt: now,
  updatedAt: now,
  ...overrides,
});

const base = {
  character: character(),
  characters: [character(), character({ id: "char-b", name: "林雾生" })],
  relationships: [] as Relationship[],
  timeline: [] as TimelineEvent[],
  world: [] as WorldEntry[],
  includeRelated: true,
};

describe("character sheet", () => {
  it("keeps every field that has a value and drops the empty ones", () => {
    const sheet = buildCharacterSheet({
      ...base,
      character: character({
        gender: "女",
        age: "62",
        species: "人类",
        likes: "黑咖啡",
        dislikes: " ",
        habits: "旋钢笔帽",
        importantItems: "私章",
        abilityDescription: "记住每一方的底线",
        appearanceDescription: "银灰短发",
        backstory: "第一次潮汐失衡时她十九岁。",
        relationshipKeywords: "停战协议的担保人",
      }),
    });

    expect(sheet.subtitle).toBe("议长 · 白塔城 · 人类");
    expect(sheet.facts.map((fact) => fact.label)).toEqual(["性别", "年龄", "种族", "职业", "世界观"]);

    const titles = sheet.sections.map((section) => section.title);
    expect(titles).toEqual(["外貌与性格", "能力与偏好", "背景故事", "其他档案字段"]);

    const ability = sheet.sections.find((section) => section.key === "ability");
    expect(ability?.fields?.map((field) => field.label)).toEqual(["喜好", "习惯", "重要物品"]);
  });

  it("omits a section entirely when it has nothing to say", () => {
    const sheet = buildCharacterSheet({ ...base, character: character() });

    expect(sheet.sections.some((section) => section.key === "appearance")).toBe(false);
    expect(sheet.sections.some((section) => section.key === "backstory")).toBe(false);
  });

  it("states the direction of a one-way relationship and marks mutual ones", () => {
    const sheet = buildCharacterSheet({
      ...base,
      relationships: [
        relationship({ id: "rel-1", kind: "mentor" }),
        relationship({ id: "rel-2", kind: "friend", fromId: "char-b", toId: "char-a" }),
      ],
    });

    const relations = sheet.sections.find((section) => section.key === "relations");
    expect(relations?.relations).toEqual([
      { peer: "林雾生", kind: "师承", direction: "此角色 → 对方", note: "" },
      { peer: "林雾生", kind: "友人", direction: "互为", note: "" },
    ]);
  });

  it("drops an edge whose other end no longer exists, and says how many", () => {
    const sheet = buildCharacterSheet({
      ...base,
      relationships: [relationship({ id: "rel-1" }), relationship({ id: "rel-2", toId: "ghost" })],
    });

    const relations = sheet.sections.find((section) => section.key === "relations");
    expect(relations?.relations).toHaveLength(1);
    expect(sheet.notes.join("")).toContain("1 条关系的关联角色已不存在");
  });

  it("lists each event and entry once, in the timeline's own order", () => {
    const sheet = buildCharacterSheet({
      ...base,
      timeline: [
        event({ id: "evt-2", title: "后来", date: "2050-01-01" }),
        event({ id: "evt-1", title: "较早", date: "2040-01-01" }),
        event({ id: "evt-3", title: "别人", date: "2041-01-01", characterIds: ["char-b"] }),
      ],
      world: [entry(), entry({ id: "world-2", name: "潮下城" })],
    });

    const events = sheet.sections.find((section) => section.key === "events");
    expect(events?.events?.map((row) => row.title)).toEqual(["较早", "后来"]);

    const world = sheet.sections.find((section) => section.key === "world");
    expect(world?.entries?.map((row) => row.name)).toEqual(["白塔城", "潮下城"]);
    expect(world?.entries?.[0].category).toBe("地点");
  });

  it("leaves the related sections out when the reader turned them off", () => {
    const sheet = buildCharacterSheet({
      ...base,
      includeRelated: false,
      relationships: [relationship()],
      timeline: [event()],
      world: [entry()],
    });

    expect(sheet.sections.some((section) => section.key === "relations")).toBe(false);
    expect(sheet.counts).toEqual({ relationships: 0, events: 0, entries: 0 });
  });

  it("reports characters the embedded font cannot draw", () => {
    const sheet = buildCharacterSheet({ ...base, character: character({ name: "沈砚𠮷" }) });
    const missing = findUnsupportedCharacters(sheet, (char) => char !== "𠮷");

    expect(missing).toEqual(["𠮷"]);
    expect(findUnsupportedCharacters(sheet, () => true)).toEqual([]);
  });

  it("draws a box where the font has no glyph rather than losing the character", () => {
    const drawn: string[] = [];
    const doc = {
      internal: { pageSize: { getWidth: () => 210, getHeight: () => 297 } },
      setFont: () => {},
      setFontSize: () => {},
      setTextColor: () => {},
      addPage: () => {},
      setPage: () => {},
      getNumberOfPages: () => 1,
      text: (value: string | string[]) => {
        drawn.push(Array.isArray(value) ? value.join("") : value);
      },
      splitTextToSize: (value: string) => [value],
      addImage: () => {},
      addFileToVFS: () => {},
      addFont: () => {},
      setDrawColor: () => {},
      setLineWidth: () => {},
      line: () => {},
      output: () => new Blob(),
    };

    const hasGlyph = (char: string) => char !== "龘" && char !== "🌙";
    const sheet = buildCharacterSheet({
      ...base,
      character: character({ name: "龘·沈砚🌙", backstory: "第一行有🌙，第二行没有。" }),
    });

    renderCharacterSheetPdf(() => doc, sheet, { name: "NotoSansSC-CS", base64: "", hasGlyph });

    const text = drawn.join("\n");
    expect(text).toContain(`${MISSING_GLYPH_BOX}·沈砚${MISSING_GLYPH_BOX}`);
    expect(text).toContain(`第一行有${MISSING_GLYPH_BOX}`);
    expect(text).not.toContain("龘");
    expect(text).not.toContain("🌙");
  });
});
