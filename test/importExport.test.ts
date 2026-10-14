// @vitest-environment happy-dom
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import {
  commitCharacterImport,
  exportAllCharactersJson,
  exportCharactersCsv,
  prepareCharacterImport,
} from "../src/utils/importExport";
import type { Character } from "../src/types/character";

// Exports hand their payload to downloadBlob, which builds a Blob and clicks a
// link. Capturing the blob lets the real serialiser be round-tripped instead of
// re-implementing it in the test.
const downloads: Blob[] = [];

const character = (overrides: Partial<Character> = {}): Character => ({
  id: "char-1",
  name: "林烬",
  updatedAt: "2026-01-01T00:00:00.000Z",
  gender: "女",
  age: "24",
  species: "人类",
  occupation: "游侠",
  personalityTags: ["冷静", "固执"],
  ...overrides,
});

const asFile = (text: string, name: string, type: string) => new File([text], name, { type });

const exportedText = async () => {
  expect(downloads).toHaveLength(1);
  return downloads[0].text();
};

describe("exportCharactersCsv", () => {
  beforeEach(() => {
    downloads.length = 0;
    URL.createObjectURL = ((blob: Blob) => {
      downloads.push(blob);
      return "blob:mock";
    }) as typeof URL.createObjectURL;
    URL.revokeObjectURL = (() => {}) as typeof URL.revokeObjectURL;
  });

  it("emits a BOM so spreadsheet software reads the Chinese text correctly", async () => {
    exportCharactersCsv([character()]);

    expect((await exportedText()).startsWith("\uFEFF")).toBe(true);
  });

  it("always quotes cells and doubles embedded quotes", async () => {
    exportCharactersCsv([character({ name: 'He said "hi"' })]);

    const csv = await exportedText();
    expect(csv).toContain('"He said ""hi"""');
  });

  it("joins personality tags with an ideographic comma", async () => {
    exportCharactersCsv([character()]);

    expect(await exportedText()).toContain('"冷静、固执"');
  });

  it("normalises CRLF inside a cell to a single newline", async () => {
    exportCharactersCsv([character({ backstory: "第一行\r\n第二行" })]);

    const csv = await exportedText();
    expect(csv).toContain('"第一行\n第二行"');
    expect(csv).not.toContain("\r");
  });

  it("still writes a row for a character with only the required fields", async () => {
    exportCharactersCsv([{ id: "bare", name: "只有名字", updatedAt: "2026-01-01T00:00:00.000Z" }]);

    const csv = await exportedText();
    // Header plus one data row.
    expect(csv.trim().split("\n")).toHaveLength(2);
    expect(csv).toContain('"只有名字"');
  });
});

describe("JSON import round trip", () => {
  beforeEach(() => {
    downloads.length = 0;
    URL.createObjectURL = ((blob: Blob) => {
      downloads.push(blob);
      return "blob:mock";
    }) as typeof URL.createObjectURL;
    URL.revokeObjectURL = (() => {}) as typeof URL.revokeObjectURL;
    localStorage.clear();
  });

  it("re-imports exactly what it exported", async () => {
    const original = character();
    exportAllCharactersJson([original]);
    const json = await exportedText();

    const plan = await prepareCharacterImport([asFile(json, "backup.json", "application/json")], []);
    expect(plan.characters).toHaveLength(1);
    expect(plan.characters[0].character.name).toBe("林烬");
    expect(plan.characters[0].character.personalityTags).toEqual(["冷静", "固执"]);

    const result = await commitCharacterImport(plan, []);
    expect(result.importedCharacterCount).toBe(1);
    expect(result.characters).toHaveLength(1);
    expect(result.characters[0].id).toBe(original.id);
    expect(result.characters[0].occupation).toBe("游侠");
  });

  it("keeps existing characters when importing into a non-empty list", async () => {
    exportAllCharactersJson([character({ id: "imported", name: "导入的" })]);
    const json = await exportedText();

    const existing = [character({ id: "existing", name: "已有的" })];
    const plan = await prepareCharacterImport([asFile(json, "backup.json", "application/json")], existing);
    const result = await commitCharacterImport(plan, existing);

    const ids = result.characters.map((c) => c.id);
    expect(ids).toContain("existing");
    expect(ids).toContain("imported");
  });

  it("accepts a single-character export shape", async () => {
    // exportCharacterJson writes the bare object, not an array.
    const plan = await prepareCharacterImport(
      [asFile(JSON.stringify(character()), "one.json", "application/json")],
      [],
    );

    expect(plan.characters).toHaveLength(1);
  });

  it("rejects an empty file so the caller can tell the user", async () => {
    // Throwing is the contract: Dashboard.tsx wraps this in try/catch and shows
    // "导入失败：JSON 文件不合法", so a silent empty plan would be the bug.
    await expect(
      prepareCharacterImport([asFile("[]", "empty.json", "application/json")], []),
    ).rejects.toThrow();
  });

  it("rejects an unreadable file and leaves the existing list untouched", async () => {
    const existing = [character({ id: "existing", name: "已有的" })];

    await expect(
      prepareCharacterImport([asFile("{ this is not json", "broken.json", "application/json")], existing),
    ).rejects.toThrow();

    expect(existing).toHaveLength(1);
    expect(existing[0].id).toBe("existing");
  });
});
