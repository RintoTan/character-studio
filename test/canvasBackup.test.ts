// @vitest-environment happy-dom
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { commitCharacterImport, prepareCharacterImport } from "../src/utils/importExport";
import { RELATIONSHIP_LAYOUT_KEY, loadLayout } from "../src/storage/relationshipLayout";
import type { Character } from "../src/types/character";

const now = "2026-01-01T00:00:00.000Z";

const character = (id: string, name: string): Character => ({
  id,
  name,
  updatedAt: now,
  gender: "",
  age: "",
  species: "",
  occupation: "",
  worldview: "",
  personalityTags: [],
  visualStyle: "",
  appearanceDescription: "",
  abilityDescription: "",
  backstory: "",
  birthDate: "",
  birthYear: "",
  likes: "",
  dislikes: "",
  habits: "",
  importantItems: "",
  relationshipKeywords: "",
  characterKeywords: "",
  imagePrompt: "",
  avatarEmoji: "🙂",
  createdAt: now,
});

const layout = {
  schemaVersion: 1,
  positions: {
    "char-a": { x: 100, y: 120 },
    "char-b": { x: 300, y: 120 },
  },
  groups: [{ id: "g1", name: "旧友", characterIds: ["char-a", "char-b"] }],
};

const backupFile = (characters: Character[], relationshipLayout: unknown = layout) =>
  [new File(
    [
      JSON.stringify({
        exportType: "character-studio-full-backup",
        exportedAt: now,
        workspaceVersion: 1,
        characters,
        avatarAssets: [],
        relationships: [],
        timeline: [],
        world: [],
        relationshipLayout,
      }),
    ],
    "backup.json",
    { type: "application/json" },
  )] as unknown as FileList;

const readLayout = () => JSON.parse(localStorage.getItem(RELATIONSHIP_LAYOUT_KEY) || "null");

describe("canvas layout in a full backup", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("restores the package canvas on 完全恢复", async () => {
    const plan = await prepareCharacterImport(backupFile([character("char-a", "甲"), character("char-b", "乙")]), [], {
      mode: "replace",
    });
    await commitCharacterImport(plan, []);

    expect(readLayout()).toMatchObject({
      schemaVersion: 2,
      positions: layout.positions,
      groups: layout.groups,
      style: expect.objectContaining({ preset: "classic" }),
    });
  });

  it("replaces a local canvas that the package disagrees with", async () => {
    localStorage.setItem(
      RELATIONSHIP_LAYOUT_KEY,
      JSON.stringify({ schemaVersion: 1, positions: { "char-a": { x: 0, y: 0 } }, groups: [] }),
    );

    const plan = await prepareCharacterImport(backupFile([character("char-a", "甲"), character("char-b", "乙")]), [], {
      mode: "replace",
    });
    await commitCharacterImport(plan, []);

    expect(loadLayout().positions["char-a"]).toEqual({ x: 100, y: 120 });
  });

  it("keeps local coordinates when merging", async () => {
    localStorage.setItem(
      RELATIONSHIP_LAYOUT_KEY,
      JSON.stringify({
        schemaVersion: 1,
        positions: { "char-a": { x: 7, y: 7 } },
        groups: [],
      }),
    );

    const plan = await prepareCharacterImport(backupFile([character("char-a", "甲"), character("char-b", "乙")]), [], {
      mode: "merge",
    });
    await commitCharacterImport(plan, []);

    const stored = loadLayout();
    expect(stored.positions["char-a"]).toEqual({ x: 7, y: 7 });
    expect(stored.positions["char-b"]).toEqual({ x: 300, y: 120 });
  });

  it("follows the id remap when a merged character is copied under a new id", async () => {
    const stored = character("char-a", "本地甲");
    const plan = await prepareCharacterImport(backupFile([character("char-a", "外来甲")]), [stored], {
      mode: "merge",
      strategy: "copy",
    });
    await commitCharacterImport(plan, [stored]);

    const importedId = plan.plan.characters.items[0].character.id;
    expect(importedId).not.toBe("char-a");
    expect(readLayout().positions[importedId]).toEqual({ x: 100, y: 120 });
    expect(readLayout().positions["char-a"]).toBeUndefined();
  });

  it("leaves the canvas alone when an old package carries no layout", async () => {
    localStorage.setItem(
      RELATIONSHIP_LAYOUT_KEY,
      JSON.stringify({
        schemaVersion: 1,
        positions: { "char-a": { x: 7, y: 7 } },
        groups: [],
      }),
    );

    const plan = await prepareCharacterImport(
      backupFile([character("char-a", "甲"), character("char-b", "乙")], null),
      [],
      { mode: "merge" },
    );
    await commitCharacterImport(plan, []);

    const after = loadLayout();
    expect(after.positions["char-a"]).toEqual({ x: 7, y: 7 });
    // The newcomer still gets somewhere to stand.
    expect(after.positions["char-b"]).toBeTruthy();
  });
});
