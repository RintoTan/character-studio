// @vitest-environment happy-dom
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import {
  commitCharacterImport,
  exportCharactersCsv,
  parseCsv,
  prepareCharacterImport,
} from "../src/utils/importExport";
import type { Character } from "../src/types/character";

const downloads: Blob[] = [];

const character = (overrides: Partial<Character> = {}): Character => ({
  id: "char-1",
  name: "林烬",
  updatedAt: "2026-01-01T00:00:00.000Z",
  gender: "女",
  age: "24",
  species: "人类",
  occupation: "游侠",
  worldview: "北境",
  personalityTags: ["冷静", "固执"],
  visualStyle: "厚涂",
  appearanceDescription: "银发红瞳",
  abilityDescription: "御风",
  backstory: "第一行\n第二行",
  characterKeywords: "银发，红瞳",
  imagePrompt: "silver hair",
  ...overrides,
});

const asCsvFile = (text: string, name = "characters.csv") => new File([text], name, { type: "text/csv" });

/** Runs the real exporter and hands back exactly what it would have downloaded. */
async function exportedCsv(characters: Character[]) {
  downloads.length = 0;
  exportCharactersCsv(characters);
  expect(downloads).toHaveLength(1);
  return downloads[0].text();
}

beforeEach(() => {
  downloads.length = 0;
  URL.createObjectURL = ((blob: Blob) => {
    downloads.push(blob);
    return "blob:mock";
  }) as typeof URL.createObjectURL;
  URL.revokeObjectURL = (() => {}) as typeof URL.revokeObjectURL;
  localStorage.clear();
});

describe("parseCsv", () => {
  it("splits rows and cells", () => {
    expect(parseCsv("a,b\nc,d")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("keeps commas inside quoted cells", () => {
    expect(parseCsv('"a,b",c')).toEqual([["a,b", "c"]]);
  });

  it("unescapes doubled quotes", () => {
    expect(parseCsv('"He said ""hi"""')).toEqual([['He said "hi"']]);
  });

  it("keeps newlines inside quoted cells", () => {
    expect(parseCsv('"line1\nline2",x')).toEqual([["line1\nline2", "x"]]);
  });

  it("handles CRLF, CR and LF row endings the same way", () => {
    expect(parseCsv("a,b\r\nc,d")).toEqual([["a", "b"], ["c", "d"]]);
    expect(parseCsv("a,b\rc,d")).toEqual([["a", "b"], ["c", "d"]]);
  });

  it("drops a leading BOM", () => {
    expect(parseCsv("\uFEFFa,b")).toEqual([["a", "b"]]);
  });

  it("does not produce a phantom row for a trailing newline", () => {
    expect(parseCsv("a,b\n")).toEqual([["a", "b"]]);
  });

  it("keeps empty cells", () => {
    expect(parseCsv("a,,c")).toEqual([["a", "", "c"]]);
  });

  it("returns nothing for empty input", () => {
    expect(parseCsv("")).toEqual([]);
  });
});

describe("CSV import round trip", () => {
  it("re-imports everything the exporter wrote", async () => {
    const original = character();
    const csv = await exportedCsv([original]);

    const plan = await prepareCharacterImport([asCsvFile(csv)], []);
    expect(plan.preview.importType).toBe("csv");
    expect(plan.preview.dataVersion).toBe("CSV");
    expect(plan.characters).toHaveLength(1);

    const imported = plan.characters[0].character;
    expect(imported.name).toBe(original.name);
    expect(imported.gender).toBe(original.gender);
    expect(imported.age).toBe(original.age);
    expect(imported.species).toBe(original.species);
    expect(imported.occupation).toBe(original.occupation);
    expect(imported.worldview).toBe(original.worldview);
    expect(imported.personalityTags).toEqual(["冷静", "固执"]);
    expect(imported.visualStyle).toBe(original.visualStyle);
    expect(imported.appearanceDescription).toBe(original.appearanceDescription);
    expect(imported.abilityDescription).toBe(original.abilityDescription);
    expect(imported.backstory).toBe(original.backstory);
    expect(imported.characterKeywords).toBe(original.characterKeywords);
    expect(imported.imagePrompt).toBe(original.imagePrompt);
  });

  it("commits an import into an existing list without losing either side", async () => {
    const csv = await exportedCsv([character({ name: "导入的" })]);
    const existing = [character({ id: "existing", name: "已有的" })];

    const plan = await prepareCharacterImport([asCsvFile(csv)], existing);
    const result = await commitCharacterImport(plan, existing);

    expect(result.importedCharacterCount).toBe(1);
    // Sort both sides: Array.sort() compares UTF-16 code units, not zh collation.
    expect(result.characters.map((c) => c.name).sort()).toEqual(["已有的", "导入的"].sort());
    // A CSV has no id column, so the imported character gets a fresh one.
    expect(result.characters.find((c) => c.name === "导入的")?.id).not.toBe("char-1");
  });

  it("survives values that contain commas, quotes and newlines", async () => {
    const csv = await exportedCsv([
      character({ name: 'He said "hi", twice', backstory: "第一行\r\n第二行，含逗号" }),
    ]);

    const plan = await prepareCharacterImport([asCsvFile(csv)], []);
    const imported = plan.characters[0].character;

    expect(imported.name).toBe('He said "hi", twice');
    expect(imported.backstory).toBe("第一行\n第二行，含逗号");
  });

  it("matches columns by label, so a reordered CSV still imports", async () => {
    const csv = await exportedCsv([character()]);
    const rows = parseCsv(csv);
    const nameAt = rows[0].indexOf("名字");
    const genderAt = rows[0].indexOf("性别");

    // swap the two columns in the header and every row
    const swapped = rows.map((row) => {
      const copy = [...row];
      [copy[nameAt], copy[genderAt]] = [copy[genderAt], copy[nameAt]];
      return copy;
    });
    const reordered = swapped.map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(",")).join("\n");

    const plan = await prepareCharacterImport([asCsvFile(reordered)], []);

    expect(plan.characters[0].character.name).toBe("林烬");
    expect(plan.characters[0].character.gender).toBe("女");
  });

  it("ignores the blank lines a spreadsheet leaves behind", async () => {
    const csv = await exportedCsv([character()]);
    const plan = await prepareCharacterImport([asCsvFile(`${csv}\n\n,\n`)], []);

    expect(plan.characters).toHaveLength(1);
  });

  it("accepts a hand-written CSV that only fills in some columns", async () => {
    const plan = await prepareCharacterImport([asCsvFile('名字,职业\n苏离,术士')], []);

    expect(plan.characters[0].character.name).toBe("苏离");
    expect(plan.characters[0].character.occupation).toBe("术士");
    expect(plan.characters[0].character.appearanceDescription).toBe("");
  });

  it("rejects a file with no name column instead of importing junk", async () => {
    await expect(prepareCharacterImport([asCsvFile("职业,年龄\n游侠,24")], [])).rejects.toThrow(/名字/);
  });

  it("rejects a CSV whose rows are all empty", async () => {
    await expect(prepareCharacterImport([asCsvFile("名字,职业\n,\n,")], [])).rejects.toThrow();
  });

  it("falls back to a placeholder name when the cell is blank", async () => {
    const plan = await prepareCharacterImport([asCsvFile("名字,职业\n,游侠")], []);

    expect(plan.characters[0].character.name).toBe("未命名角色");
  });
});
