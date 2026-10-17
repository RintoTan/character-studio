// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { toLegacyColorFunctions } from "../src/utils/importExport";

// html2canvas parses colours itself and knows nothing newer than rgb/rgba/hsl/hex.
// A color-mix() token computes to `color(srgb …)`, which it rejects outright with
// `Attempting to parse an unsupported color function "color"` — and that fails the
// whole capture, not just the one property. So the clone is downgraded first.
describe("colour downgrade for html2canvas", () => {
  it("converts a computed color-mix() value to rgba", () => {
    expect(toLegacyColorFunctions("color(srgb 0.934667 0.936588 0.940706)")).toBe(
      "rgba(238, 239, 240, 1)",
    );
  });

  it("keeps the alpha of a translucent value", () => {
    expect(toLegacyColorFunctions("color(srgb 1 1 1 / 0.7)")).toBe("rgba(255, 255, 255, 0.7)");
    expect(toLegacyColorFunctions("color(srgb 0 0 0 / 50%)")).toBe("rgba(0, 0, 0, 0.5)");
  });

  it("converts every colour inside a composite value", () => {
    expect(
      toLegacyColorFunctions(
        "color(srgb 0 0 0 / 0.1) 0px 1px 2px 0px, color(srgb 1 1 1 / 0.7) 0px 1px 0px inset",
      ),
    ).toBe("rgba(0, 0, 0, 0.1) 0px 1px 2px 0px, rgba(255, 255, 255, 0.7) 0px 1px 0px inset");
  });

  it("leaves values it already understands untouched", () => {
    for (const value of [
      "rgb(17, 24, 39)",
      "rgba(0, 0, 0, 0.5)",
      "#f3f4f6",
      "none",
      "var(--text)",
    ]) {
      expect(toLegacyColorFunctions(value)).toBe(value);
    }
  });

  it("clamps channels rather than emitting an invalid colour", () => {
    expect(toLegacyColorFunctions("color(srgb 1.4 -0.2 0.5)")).toBe("rgba(255, 0, 128, 1)");
  });

  it("leaves a colour space it does not know alone", () => {
    // Better an unparsed property than a wrong colour: oklch has no srgb-scale
    // channels to read here.
    expect(toLegacyColorFunctions("color(display-p3 0.4 0.5 0.6)")).toBe(
      "color(display-p3 0.4 0.5 0.6)",
    );
  });
});

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

  it("keeps every editable profile field across import -> export -> import", async () => {
    // The importer rebuilds a Character field by field rather than spreading the
    // payload (unknown keys must not reach storage). That is the right shape, but it
    // means every field has to be listed: five editable ones were missing, so a
    // backup round trip emptied them.
    const original: Character = {
      id: "char-full",
      name: "沈砚",
      avatarEmoji: "",
      avatarAssetId: "asset-07",
      favorite: true,
      isDraft: true,
      draftOfId: "char-origin",
      gender: "女",
      age: "62",
      birthDate: "1998-03-04",
      birthYear: "雾海历 -34 年",
      species: "人类",
      occupation: "自治议会议长",
      worldview: "白塔城",
      tags: [
        { id: "tag-01", name: "议会", color: "blue" },
        { id: "tag-02", name: "停战协议" },
      ],
      personalityTags: ["克制", "长于权衡"],
      appearanceDescription: "银灰短发，左眼下方有一道旧灼痕。",
      abilityDescription: "能在四小时的争吵里记住每一方的底线。",
      backstory: "长背景".repeat(300),
      likes: "黑咖啡、旧档案纸的味道",
      dislikes: "",
      habits: "作决定前把钢笔帽旋开又拧紧，恰好三次。",
      importantItems: "一枚磨平了字的私章；七只空燃料桶的编号清单",
      relationshipKeywords: "停战协议的担保人；与商会、学会、远征队都欠着一笔人情。",
      visualStyle: "低饱和",
      characterKeywords: "银灰短发、灼痕、深灰长袍",
      imagePrompt: "elegant older stateswoman, silver short hair",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-02-01T00:00:00.000Z",
    };

    exportAllCharactersJson([original]);
    const firstJson = await exportedText();
    const firstPlan = await prepareCharacterImport(
      [asFile(firstJson, "backup.json", "application/json")],
      [],
    );
    const imported = firstPlan.characters[0].character;

    expect(imported.likes).toBe(original.likes);
    expect(imported.dislikes).toBe("");
    expect(imported.habits).toBe(original.habits);
    expect(imported.importantItems).toBe(original.importantItems);
    expect(imported.relationshipKeywords).toBe(original.relationshipKeywords);

    // Second pass through the exporter, exactly as a restore-then-backup would go.
    downloads.length = 0;
    exportAllCharactersJson([imported]);
    const secondJson = await exportedText();
    const secondPlan = await prepareCharacterImport(
      [asFile(secondJson, "backup-2.json", "application/json")],
      [],
    );
    const again = secondPlan.characters[0].character;

    const profile = (item: Character) => ({
      id: item.id,
      name: item.name,
      avatarEmoji: item.avatarEmoji,
      avatarAssetId: item.avatarAssetId,
      favorite: item.favorite,
      isDraft: item.isDraft,
      draftOfId: item.draftOfId,
      gender: item.gender,
      age: item.age,
      birthDate: item.birthDate,
      birthYear: item.birthYear,
      species: item.species,
      occupation: item.occupation,
      worldview: item.worldview,
      tags: item.tags,
      personalityTags: item.personalityTags,
      appearanceDescription: item.appearanceDescription,
      abilityDescription: item.abilityDescription,
      backstory: item.backstory,
      likes: item.likes,
      dislikes: item.dislikes,
      habits: item.habits,
      importantItems: item.importantItems,
      relationshipKeywords: item.relationshipKeywords,
      visualStyle: item.visualStyle,
      characterKeywords: item.characterKeywords,
      imagePrompt: item.imagePrompt,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    });

    expect(profile(again)).toEqual(profile(imported));
    expect(again.likes).toBe(original.likes);
    expect(again.relationshipKeywords).toBe(original.relationshipKeywords);
  });

  it("still drops keys that are not part of the Character model", async () => {
    const withExtra = { ...character(), injected: "should not survive" } as Character & {
      injected: string;
    };
    const plan = await prepareCharacterImport(
      [asFile(JSON.stringify(withExtra), "one.json", "application/json")],
      [],
    );
    const imported = plan.characters[0].character as Character & { injected?: string };

    expect("injected" in imported).toBe(false);
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
