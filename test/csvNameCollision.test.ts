// @vitest-environment happy-dom
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { prepareCharacterImport } from "../src/utils/importExport";
import type { Character } from "../src/types/character";

// A CSV names characters instead of identifying them, so a relationship row is only
// as good as the name -> id map built for it. DEC-38-03 settles what that map may do:
// a name that identifies exactly one character resolves, and a name that identifies
// none or several does not - the row is left out and counted. These cases are the
// contract for that rule; before it, the last character to claim a name won and the
// edge could point at someone the author never named (KI-14).

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

const csvText = (rows: string[][]) =>
  "\uFEFF" +
  rows
    .map((cells) => cells.map((cell) => `"${cell.split('"').join('""')}"`).join(","))
    .join("\r\n");

const asCsvFile = (text: string) => new File([text], "characters.csv", { type: "text/csv" });

const character = (overrides: Partial<Character>): Character => ({
  id: "x",
  name: "x",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...overrides,
});

const existing = [
  character({ id: "existing-shen", name: "沈青梧", worldview: "北境" }),
  character({ id: "existing-lu", name: "陆停云", worldview: "北境" }),
];

const importCsv = (rows: string[][], current: Character[] = existing) =>
  prepareCharacterImport([asCsvFile(csvText(rows))] as unknown as FileList, current);

beforeEach(() => {
  localStorage.clear();
});

describe("CSV character identity", () => {
  it("does not connect a relationship to an imported character of the same name", async () => {
    const plan = await importCsv([
      header,
      row({ 类型: "角色", 名字: "沈青梧", 性别: "女" }),
      row({ 类型: "关系", 源角色: "沈青梧", 目标角色: "陆停云", 关系类型: "友人" }),
    ]);

    const imported = plan.characters.find((entry) => entry.character.name === "沈青梧")?.character;
    // The import still brings the character in - a repeated name is allowed data.
    expect(imported).toBeTruthy();
    expect(imported?.id).not.toBe("existing-shen");

    // The edge is not created at all, for either candidate, and the author is told.
    expect(plan.workspace?.relationships).toEqual([]);
    expect(plan.preview.unresolvedReferences.ambiguous).toBe(1);
    expect(plan.preview.unresolvedReferences.missing).toBe(0);
  });

  it("does not pick between two characters of the same name inside one file", async () => {
    const plan = await importCsv([
      header,
      row({ 类型: "角色", 名字: "沈青梧", 性别: "女" }),
      row({ 类型: "角色", 名字: "沈青梧", 性别: "男" }),
      row({ 类型: "关系", 源角色: "沈青梧", 目标角色: "陆停云", 关系类型: "友人" }),
    ]);

    expect(plan.characters.filter((entry) => entry.character.name === "沈青梧")).toHaveLength(2);
    expect(plan.workspace?.relationships).toEqual([]);
    expect(plan.preview.unresolvedReferences.ambiguous).toBe(1);
  });

  it("treats a name shared across worldviews as ambiguous rather than choosing one", async () => {
    const twoWorlds = [
      character({ id: "north-shen", name: "沈青梧", worldview: "北境" }),
      character({ id: "south-shen", name: "沈青梧", worldview: "南国" }),
    ];
    const plan = await importCsv(
      [
        header,
        row({ 类型: "关系", 源角色: "沈青梧", 目标角色: "陆停云", 关系类型: "友人" }),
        row({ 类型: "角色", 名字: "陆停云" }),
      ],
      twoWorlds,
    );

    expect(plan.workspace?.relationships).toEqual([]);
    expect(plan.preview.unresolvedReferences.ambiguous).toBe(1);
  });

  it("counts a reference to a character that does not exist, and still imports the rest", async () => {
    const plan = await importCsv([
      header,
      row({ 类型: "关系", 源角色: "沈青梧", 目标角色: "查无此人", 关系类型: "友人" }),
      row({ 类型: "角色", 名字: "陆停云" }),
    ]);

    expect(plan.workspace?.relationships).toEqual([]);
    expect(plan.preview.unresolvedReferences.missing).toBe(1);
    expect(plan.preview.unresolvedReferences.ambiguous).toBe(0);
    // The characters in the file still arrive: one bad row does not fail the import.
    expect(plan.characters.map((entry) => entry.character.name)).toContain("陆停云");
  });

  it("keeps connecting relationships whose names both identify one character", async () => {
    const plan = await importCsv([
      header,
      row({ 类型: "关系", 源角色: "沈青梧", 目标角色: "陆停云", 关系类型: "友人" }),
      row({ 类型: "角色", 名字: "谢枯荣" }),
    ]);

    expect(plan.workspace?.relationships[0]).toMatchObject({
      fromId: "existing-shen",
      toId: "existing-lu",
    });
    expect(plan.preview.unresolvedReferences).toEqual({ ambiguous: 0, missing: 0 });
  });

  it("imports the unambiguous rows of a file that also contains an ambiguous one", async () => {
    const plan = await importCsv([
      header,
      row({ 类型: "角色", 名字: "沈青梧" }),
      row({ 类型: "关系", 源角色: "沈青梧", 目标角色: "陆停云", 关系类型: "友人" }),
      row({ 类型: "关系", 源角色: "谢枯荣", 目标角色: "池镜", 关系类型: "同僚" }),
      row({ 类型: "角色", 名字: "谢枯荣" }),
      row({ 类型: "角色", 名字: "池镜" }),
    ]);

    // The ambiguous pair is dropped; the other pair is new to the file and resolves.
    expect(plan.workspace?.relationships).toHaveLength(1);
    expect(plan.preview.unresolvedReferences.ambiguous).toBe(1);
  });

  it("never half-connects an edge when only one end is ambiguous", async () => {
    const plan = await importCsv([
      header,
      row({ 类型: "角色", 名字: "沈青梧" }),
      row({ 类型: "关系", 源角色: "沈青梧", 目标角色: "陆停云", 关系类型: "友人" }),
    ]);

    expect(plan.workspace?.relationships).toEqual([]);
  });

  it("counts ambiguous timeline links and world parents too", async () => {
    const plan = await importCsv([
      header,
      row({ 类型: "角色", 名字: "沈青梧" }),
      row({ 类型: "时间线", 事件标题: "相遇", 事件日期: "2026-01-01", 涉及角色: "沈青梧、陆停云" }),
      row({ 类型: "世界观", 名字: "白塔城", 分类: "地点", 父级: "沈青梧" }),
    ]);

    // One ambiguous name in the timeline cell, one in the world parent column.
    expect(plan.preview.unresolvedReferences.ambiguous).toBe(2);
    expect(plan.workspace?.timeline[0]?.characterIds ?? []).not.toContain("existing-shen");
  });
});
