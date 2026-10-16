import { describe, expect, it } from "vitest";
import {
  UNGROUPED_WORLDVIEW,
  dashboardGroupRows,
  groupCharactersByWorldview,
  summarizeTags,
  worldviewOf,
} from "../src/pages/dashboard/dashboardGroups";
import type { Character } from "../src/types/character";

const make = (id: string, worldview: string): Character => ({ id, name: id, worldview });

// Three worldviews, sizes 3 / 2 / 1, plus one character with nothing filled in.
const roster: Character[] = [
  make("a1", "北境"),
  make("a2", "北境"),
  make("a3", "北境"),
  make("b1", "云海"),
  make("b2", "云海"),
  make("c1", ""),
];

const cards = (rows: ReturnType<typeof dashboardGroupRows>["rows"]) =>
  rows.flatMap((row) => (row.kind === "card" ? [row.character.id] : []));
const heads = (rows: ReturnType<typeof dashboardGroupRows>["rows"]) =>
  rows.flatMap((row) => (row.kind === "head" ? [`${row.group}:${row.count}`] : []));

describe("groupCharactersByWorldview", () => {
  it("按世界观分组，组大的在前，数量与成员一致", () => {
    const groups = groupCharactersByWorldview(roster);

    expect(groups.map((entry) => entry.group)).toEqual(["北境", "云海", UNGROUPED_WORLDVIEW]);
    expect(groups.map((entry) => entry.count)).toEqual([3, 2, 1]);
    for (const entry of groups) {
      expect(entry.count).toBe(entry.characters.length);
    }
  });

  it("组内保持角色原有的存储顺序", () => {
    const groups = groupCharactersByWorldview(roster);
    const north = groups.find((entry) => entry.group === "北境");

    expect(north?.characters.map((character) => character.id)).toEqual(["a1", "a2", "a3"]);
  });

  it("没有填写世界观的角色归入「未填写世界观」，空白串也算没填", () => {
    expect(worldviewOf(make("x", "   "))).toBe(UNGROUPED_WORLDVIEW);
    expect(worldviewOf(make("y", " 北境 "))).toBe("北境");
  });

  it("并列数量的组按名称排序，不随角色顺序变化", () => {
    const first = groupCharactersByWorldview([make("1", "乙"), make("2", "甲")]);
    const second = groupCharactersByWorldview([make("2", "甲"), make("1", "乙")]);

    expect(first.map((entry) => entry.group)).toEqual(second.map((entry) => entry.group));
  });
});

describe("dashboardGroupRows", () => {
  it("不分组时直接按原顺序平铺，不产生分组头", () => {
    const { rows, groups } = dashboardGroupRows(roster, { grouped: false, collapsed: {} });

    expect(heads(rows)).toEqual([]);
    expect(cards(rows)).toEqual(roster.map((character) => character.id));
    expect(groups).toEqual([]);
  });

  it("折叠的组只剩组头，数量仍然是该组全部角色的数量", () => {
    const { rows, groups } = dashboardGroupRows(roster, {
      grouped: true,
      collapsed: { 北境: true },
    });

    expect(heads(rows)).toEqual(["北境:3", "云海:2", `${UNGROUPED_WORLDVIEW}:1`]);
    expect(cards(rows)).not.toContain("a1");
    expect(cards(rows)).toContain("b1");
    // The index reports the same count the head does, collapsed or not.
    expect(groups.find((entry) => entry.group === "北境")?.count).toBe(3);
  });

  it("搜索或筛选生效时，折叠的组也展开，匹配的角色不被藏起来", () => {
    const collapsed = { 北境: true };
    const browsing = dashboardGroupRows(roster, { grouped: true, collapsed }).rows;
    const searching = dashboardGroupRows(roster, { grouped: true, collapsed, forceExpand: true }).rows;

    expect(cards(browsing)).not.toContain("a1");
    expect(cards(searching)).toContain("a1");
    // The override is derived: the record itself is untouched, so clearing the
    // search puts the group back to collapsed.
    expect(collapsed).toEqual({ 北境: true });
    expect(cards(dashboardGroupRows(roster, { grouped: true, collapsed }).rows)).not.toContain("a1");
  });

  it("筛选后的分组数量按筛选结果计算，不是全量", () => {
    const filtered = roster.filter((character) => character.worldview === "北境" || character.id === "b1");
    const { rows, groups } = dashboardGroupRows(filtered, { grouped: true, collapsed: {} });

    expect(heads(rows)).toEqual(["北境:3", "云海:1"]);
    expect(groups.map((entry) => entry.count)).toEqual([3, 1]);
  });
});

describe("summarizeTags", () => {
  it("超出上限的标签计入剩余数量", () => {
    expect(summarizeTags(["a", "b", "c", "d"], 2)).toEqual({ visible: ["a", "b"], hidden: 2 });
  });

  it("上限为 0 或标签为空时不显示任何标签", () => {
    expect(summarizeTags(["a"], 0)).toEqual({ visible: [], hidden: 1 });
    expect(summarizeTags([], 3)).toEqual({ visible: [], hidden: 0 });
  });
});
