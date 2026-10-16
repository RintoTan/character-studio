import { describe, expect, it } from "vitest";
import type { WorldEntry } from "../src/types/world";
import {
  EVERY_CATEGORY,
  emptyWorldFilter,
  isWorldFilterActive,
  matchesWorldFilter,
  worldCategoryCounts,
  worldDescendantIds,
  worldIndent,
  worldParentOptions,
  worldPathOf,
  worldTreeRows,
} from "../src/pages/world/worldView";

const names: Record<string, string> = { "c-1": "沈青梧", "c-2": "陆停云" };
const nameOf = (id: string) => names[id];

function entry(overrides: Partial<WorldEntry> & { id: string; name: string }): WorldEntry {
  return {
    category: "location",
    tags: [],
    characterIds: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  } as WorldEntry;
}

// 雾海纪 → 北境城 → 白塔区, plus a faction and a concept with no parent.
const entries: WorldEntry[] = [
  entry({ id: "w-1", name: "雾海纪", category: "location", summary: "故事发生的年代与海域", details: "冬天很长", tags: ["主线"], characterIds: ["c-1"] }),
  entry({ id: "w-2", name: "北境城", category: "location", parentId: "w-1", summary: "最北的聚居地", characterIds: ["c-1", "c-2"] }),
  entry({ id: "w-3", name: "白塔区", category: "location", parentId: "w-2", summary: "旧灯塔所在的一区" }),
  entry({ id: "w-4", name: "星轨会", category: "faction", summary: "以观测为名的组织", tags: ["组织"] }),
  entry({ id: "w-5", name: "回声", category: "concept", details: "同一句话留下的不同版本" }),
];

describe("world categories", () => {
  it("counts every declared category, including the empty ones", () => {
    const counts = worldCategoryCounts(entries);

    expect(counts[0]).toEqual({ value: EVERY_CATEGORY, label: EVERY_CATEGORY, count: 5 });
    expect(counts.find((group) => group.value === "location")?.count).toBe(3);
    expect(counts.find((group) => group.value === "faction")?.count).toBe(1);
    // A category with nothing in it still has a place in the navigation.
    expect(counts.find((group) => group.value === "species")?.count).toBe(0);
    expect(counts).toHaveLength(7);
  });

  it("counts nothing when there is nothing", () => {
    expect(worldCategoryCounts([])[0].count).toBe(0);
  });
});

describe("world filtering", () => {
  const matches = (overrides: Partial<typeof emptyWorldFilter>) =>
    entries.filter((item) => matchesWorldFilter(item, { ...emptyWorldFilter, ...overrides }, nameOf)).map((item) => item.id);

  it("treats the empty filter as no filter at all", () => {
    expect(isWorldFilterActive(emptyWorldFilter)).toBe(false);
    expect(isWorldFilterActive({ ...emptyWorldFilter, query: "   " })).toBe(false);
    expect(matches({})).toEqual(["w-1", "w-2", "w-3", "w-4", "w-5"]);
  });

  it("searches name, summary, details, tags and character names", () => {
    expect(matches({ query: "北境城" })).toEqual(["w-2"]);
    expect(matches({ query: "最北" })).toEqual(["w-2"]); // summary
    expect(matches({ query: "冬天" })).toEqual(["w-1"]); // details
    expect(matches({ query: "组织" })).toEqual(["w-4"]); // tag
    expect(matches({ query: "陆停云" })).toEqual(["w-2"]); // through the name
    expect(matches({ query: "c-2" })).toEqual([]); // an id is not a name
  });

  it("ignores surrounding spaces and case", () => {
    expect(matches({ query: "  回声  " })).toEqual(["w-5"]);
    const latin = [entry({ id: "x", name: "Ashfall" })];
    expect(
      latin.filter((item) => matchesWorldFilter(item, { ...emptyWorldFilter, query: " ashFALL " }, nameOf)),
    ).toHaveLength(1);
  });

  it("filters by category, by level and by whether characters are attached", () => {
    expect(matches({ category: "faction" })).toEqual(["w-4"]);
    expect(matches({ parent: "root" })).toEqual(["w-1", "w-4", "w-5"]);
    expect(matches({ parent: "child" })).toEqual(["w-2", "w-3"]);
    expect(matches({ characters: "with" })).toEqual(["w-1", "w-2"]);
    expect(matches({ characters: "without" })).toEqual(["w-3", "w-4", "w-5"]);
  });

  it("combines the search with the filters", () => {
    expect(matches({ query: "北境", parent: "child" })).toEqual(["w-2"]);
    expect(matches({ query: "北境", parent: "root" })).toEqual([]);
    expect(matches({ category: "location", query: "灯" })).toEqual(["w-3"]);
    expect(matches({ category: "faction", characters: "without" })).toEqual(["w-4"]);
    expect(matches({ category: "faction", characters: "with" })).toEqual([]);
  });

  it("keeps the stored entries intact", () => {
    const before = JSON.stringify(entries);
    matches({ query: "北境" });

    expect(JSON.stringify(entries)).toBe(before);
  });
});

describe("world hierarchy", () => {
  const rows = (filter = emptyWorldFilter, collapsed = new Set<string>()) =>
    worldTreeRows(entries, {
      filter,
      nameOf,
      collapsed,
      isFilterActive: isWorldFilterActive(filter),
    });

  it("walks the stored order and reports depth, children and counts", () => {
    expect(
      rows().map((row) => [row.entry.name, row.depth, row.childCount, row.hasChildren]),
    ).toEqual([
      ["雾海纪", 0, 1, true],
      ["北境城", 1, 1, true],
      ["白塔区", 2, 0, false],
      ["星轨会", 0, 0, false],
      ["回声", 0, 0, false],
    ]);
  });

  it("hides the children of a collapsed branch and nothing else", () => {
    expect(rows(emptyWorldFilter, new Set(["w-2"])).map((row) => row.entry.name)).toEqual([
      "雾海纪",
      "北境城",
      "星轨会",
      "回声",
    ]);
    expect(rows(emptyWorldFilter, new Set(["w-1"])).map((row) => row.entry.name)).toEqual([
      "雾海纪",
      "星轨会",
      "回声",
    ]);
  });

  it("keeps a match reachable even when its parent is collapsed", () => {
    // 白塔区 is two levels down and its parents are shut: the result must still be
    // findable, so the path is drawn and marked as a path rather than as a match.
    const filtered = rows({ ...emptyWorldFilter, query: "白塔区" }, new Set(["w-1", "w-2"]));

    expect(filtered.map((row) => row.entry.name)).toEqual(["雾海纪", "北境城", "白塔区"]);
    expect(filtered.map((row) => row.viaPath)).toEqual([true, true, false]);
    expect(filtered[2].depth).toBe(2);
  });

  it("does not drag a matching entry's own children into the result", () => {
    const filtered = rows({ ...emptyWorldFilter, query: "北境城" });

    expect(filtered.map((row) => row.entry.name)).toEqual(["雾海纪", "北境城"]);
  });

  it("stops indenting, but never stops nesting", () => {
    expect([0, 1, 2, 3, 4].map((depth) => worldIndent(depth))).toEqual([0, 16, 32, 48, 64]);
    expect(worldIndent(5)).toBe(64);
    expect(worldIndent(12)).toBe(64);

    const deep = Array.from({ length: 6 }, (_, index) =>
      entry({ id: `d-${index}`, name: `第 ${index} 层`, parentId: index === 0 ? undefined : `d-${index - 1}` }),
    );
    const deepRows = worldTreeRows(deep, {
      filter: emptyWorldFilter,
      nameOf,
      collapsed: new Set(),
      isFilterActive: false,
    });

    expect(deepRows.map((row) => row.depth)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("lists everything below an entry, at any depth", () => {
    expect([...worldDescendantIds(entries, "w-1")].sort()).toEqual(["w-2", "w-3"]);
    expect([...worldDescendantIds(entries, "w-3")]).toEqual([]);
  });

  it("does not hang on a hierarchy that has become a loop", () => {
    const looped = [
      entry({ id: "a", name: "A", parentId: "b" }),
      entry({ id: "b", name: "B", parentId: "a" }),
    ];

    expect([...worldDescendantIds(looped, "a")].sort()).toEqual(["a", "b"]);
  });

  it("offers every parent but the entry itself and its descendants", () => {
    expect(worldParentOptions(entries, "w-1").map((item) => item.id)).toEqual(["w-4", "w-5"]);
    expect(worldParentOptions(entries, "w-3").map((item) => item.id)).toEqual(["w-1", "w-2", "w-4", "w-5"]);
    // A new entry has no descendants to avoid, so everything is available — the cycle
    // rule is what narrows it, and `createWorldEntry` applies it again on write.
    expect(worldParentOptions(entries, undefined)).toHaveLength(5);
  });

  it("reports the chain of ancestors, outermost first", () => {
    expect(worldPathOf(entries, "w-3").map((item) => item.name)).toEqual(["雾海纪", "北境城"]);
    expect(worldPathOf(entries, "w-1")).toEqual([]);
  });
});
