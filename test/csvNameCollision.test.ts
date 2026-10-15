// @vitest-environment happy-dom
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { prepareCharacterImport } from "../src/utils/importExport";
import type { Character } from "../src/types/character";

// A CSV names characters instead of identifying them, so a relationship row is only
// as trustworthy as the name -> id map built for it. These tests pin what that map
// does today. KI-14 records the two rows marked 缺陷 below; they describe the defect
// rather than a contract, and the fix will have to change them deliberately.

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

const importCsv = (rows: string[][]) =>
  prepareCharacterImport([asCsvFile(csvText(rows))] as unknown as FileList, existing);

beforeEach(() => {
  localStorage.clear();
});

describe("CSV character identity", () => {
  it("缺陷 KI-14: an imported character of the same name takes over the existing one's relationships", async () => {
    const plan = await importCsv([
      header,
      row({ 类型: "角色", 名字: "沈青梧", 性别: "女" }),
      row({ 类型: "关系", 源角色: "沈青梧", 目标角色: "陆停云", 关系类型: "友人" }),
    ]);

    const imported = plan.characters.find((entry) => entry.character.name === "沈青梧")?.character;
    expect(imported).toBeTruthy();
    // The import never re-keys onto an existing id, so this is a genuinely new record.
    expect(imported?.id).not.toBe("existing-shen");

    // 缺陷: the edge names 沈青梧, and the name meant "existing-shen" before the file
    // arrived. It now points at the newcomer, and nothing tells the author.
    expect(plan.workspace?.relationships[0]).toMatchObject({
      fromId: imported?.id,
      toId: "existing-lu",
      kind: "friend",
    });
  });

  it("缺陷 KI-14: two characters of the same name inside one file collide as well", async () => {
    const plan = await importCsv([
      header,
      row({ 类型: "角色", 名字: "沈青梧", 性别: "女" }),
      row({ 类型: "角色", 名字: "沈青梧", 性别: "男" }),
      row({ 类型: "关系", 源角色: "沈青梧", 目标角色: "陆停云", 关系类型: "友人" }),
    ]);

    const sameName = plan.characters.filter((entry) => entry.character.name === "沈青梧");
    expect(sameName).toHaveLength(2);
    const distinctIds = new Set(sameName.map((entry) => entry.character.id));
    expect(distinctIds.size).toBe(2);

    // 缺陷: whichever row was read last owns the name, so "the second one" wins.
    expect(plan.workspace?.relationships[0]).toMatchObject({
      fromId: sameName[1].character.id,
      toId: "existing-lu",
    });
  });

  it("does not distinguish two characters that share a name in different worldviews", async () => {
    const twoWorlds = [
      character({ id: "north-shen", name: "沈青梧", worldview: "北境" }),
      character({ id: "south-shen", name: "沈青梧", worldview: "南国" }),
    ];
    const plan = await prepareCharacterImport(
      [
        asCsvFile(
          csvText([
            header,
            row({ 类型: "关系", 源角色: "沈青梧", 目标角色: "陆停云", 关系类型: "友人" }),
            row({ 类型: "角色", 名字: "陆停云" }),
          ]),
        ),
      ] as unknown as FileList,
      twoWorlds,
    );

    // The map is keyed by name alone, so the worldview column cannot break the tie.
    expect(plan.workspace?.relationships[0]).toMatchObject({ fromId: "south-shen" });
  });

  it("drops a relationship that names a character the import cannot resolve", async () => {
    const plan = await importCsv([
      header,
      row({ 类型: "关系", 源角色: "沈青梧", 目标角色: "查无此人", 关系类型: "友人" }),
      row({ 类型: "角色", 名字: "陆停云" }),
    ]);

    // Existing semantics: an unresolvable name is dropped without a word. The defect
    // above is that a resolvable-but-wrong name is not treated the same way.
    expect(plan.workspace?.relationships).toEqual([]);
  });

  it("keeps a relationship whose names both resolve to existing characters", async () => {
    const plan = await importCsv([
      header,
      row({ 类型: "关系", 源角色: "沈青梧", 目标角色: "陆停云", 关系类型: "友人" }),
      row({ 类型: "角色", 名字: "谢枯荣" }),
    ]);

    expect(plan.workspace?.relationships[0]).toMatchObject({
      fromId: "existing-shen",
      toId: "existing-lu",
    });
  });
});
