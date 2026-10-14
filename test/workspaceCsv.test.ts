import { describe, expect, it } from "vitest";
import { readWorkspaceRowsFromCsv, resolveWorkspaceRows } from "../src/utils/workspaceCsv";

const header = [
  "类型",
  "名字",
  "性别",
  "源角色",
  "目标角色",
  "关系类型",
  "备注",
  "分类",
  "父级",
  "标签",
  "简介",
  "事件标题",
  "事件日期",
  "纪年",
  "事件类型",
  "描述",
  "地点",
  "涉及角色",
];

const row = (values: Record<string, string>) => header.map((label) => values[label] ?? "");

const combined = [
  header,
  row({ 类型: "角色", 名字: "澪", 性别: "女" }),
  row({ 类型: "角色", 名字: "砚", 性别: "男" }),
  row({ 类型: "关系", 源角色: "澪", 目标角色: "砚", 关系类型: "友人", 备注: "同窗" }),
  row({ 类型: "关系", 源角色: "澪", 目标角色: "路人", 关系类型: "友人" }),
  row({ 类型: "关系", 源角色: "澪", 目标角色: "砚", 关系类型: "不存在的类型" }),
  row({ 类型: "世界观", 名字: "雾海纪", 分类: "地点", 标签: "主世界、常雾" }),
  row({ 类型: "世界观", 名字: "白塔城", 分类: "地点", 父级: "雾海纪" }),
  row({ 类型: "时间线", 事件标题: "初次相遇", 事件日期: "2026-01-01", 事件类型: "起源", 涉及角色: "澪、路人" }),
];

const makeId = (prefix: string, index: number) => `${prefix}-${index + 1}`;
const names = new Map([
  ["澪", "char-1"],
  ["砚", "char-2"],
]);

describe("combined CSV", () => {
  it("reads the three domains out of one table", () => {
    const rows = readWorkspaceRowsFromCsv(combined);

    expect(rows?.relationships).toHaveLength(3);
    expect(rows?.world).toHaveLength(2);
    expect(rows?.timeline).toHaveLength(1);
    expect(rows?.timeline[0].characterNames).toBe("澪、路人");
  });

  it("returns nothing for a characters-only file", () => {
    expect(readWorkspaceRowsFromCsv([["名字", "性别"], ["澪", "女"]])).toBeNull();
    expect(readWorkspaceRowsFromCsv([])).toBeNull();
  });

  it("turns labels into the values the app stores", () => {
    const resolved = resolveWorkspaceRows(readWorkspaceRowsFromCsv(combined)!, names, makeId);

    // The second and third relationship rows name a missing character and an
    // unknown kind, so only the real edge survives.
    expect(resolved.relationships).toEqual([
      { id: "rel-1", fromId: "char-1", toId: "char-2", kind: "friend", note: "同窗" },
    ]);
    expect(resolved.world.map((entry) => entry.category)).toEqual(["location", "location"]);
    expect(resolved.world[0].tags).toEqual(["主世界", "常雾"]);
    expect(resolved.timeline[0].kind).toBe("origin");
    // "路人" is not a character in this file, so the event keeps only the one link.
    expect(resolved.timeline[0].characterIds).toEqual(["char-1"]);
  });

  it("resolves a parent by name in a second pass", () => {
    const resolved = resolveWorkspaceRows(readWorkspaceRowsFromCsv(combined)!, names, makeId);

    expect(resolved.world[0].parentId).toBeUndefined();
    expect(resolved.world[1].parentId).toBe(resolved.world[0].id);
  });

  it("drops rows that cannot be understood", () => {
    const broken = [
      header,
      row({ 类型: "关系", 源角色: "澪" }), // no target
      row({ 类型: "关系", 源角色: "澪", 目标角色: "澪", 关系类型: "友人" }), // points at itself
      row({ 类型: "世界观", 分类: "地点" }), // no name
      row({ 类型: "时间线", 事件标题: "没有日期", 事件类型: "起源" }),
    ];
    const resolved = resolveWorkspaceRows(readWorkspaceRowsFromCsv(broken)!, names, makeId);

    expect(resolved.relationships).toEqual([]);
    expect(resolved.world).toEqual([]);
    expect(resolved.timeline).toEqual([]);
  });
});
