// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import {
  applyWorkspaceDatasets,
  countWorkspaceDatasets,
  extractWorkspaceDatasets,
  normalizeImportedRelationships,
  normalizeImportedTimeline,
  normalizeImportedWorld,
} from "../src/storage/workspaceBackup";
import type { Character } from "../src/types/character";
import { saveCharacters } from "../src/storage/characterStorage";
import { RELATIONSHIPS_KEY } from "../src/storage/relationshipStorage";
import { TIMELINE_KEY } from "../src/storage/timelineStorage";
import { WORLD_KEY } from "../src/storage/worldStorage";

const now = "2026-10-15T00:00:00.000Z";

const relationship = (overrides: Record<string, unknown> = {}) => ({
  id: "rel-1",
  fromId: "char-1",
  toId: "char-2",
  kind: "friend",
  note: "",
  createdAt: now,
  updatedAt: now,
  ...overrides,
});

const event = (overrides: Record<string, unknown> = {}) => ({
  id: "evt-1",
  title: "初次相遇",
  date: "2026-01-01",
  kind: "origin",
  characterIds: ["char-1"],
  createdAt: now,
  updatedAt: now,
  ...overrides,
});

const entry = (overrides: Record<string, unknown> = {}) => ({
  id: "world-1",
  name: "雾海纪",
  category: "location",
  tags: ["主世界"],
  characterIds: ["char-1"],
  createdAt: now,
  updatedAt: now,
  ...overrides,
});

const known = new Set(["char-1", "char-2"]);

describe("workspace backup", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("keeps relationships that point at characters in the file", () => {
    const { items, dropped } = normalizeImportedRelationships([relationship()], known);

    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe("friend");
    expect(dropped).toBe(0);
  });

  it("drops relationships that are broken, unknown or doubled", () => {
    const { items, dropped } = normalizeImportedRelationships(
      [
        relationship({ id: "a", fromId: "char-9" }), // character not in the file
        relationship({ id: "b", kind: "soulmate" }), // not a real kind
        relationship({ id: "c", toId: "char-1" }), // points at itself
        relationship({ id: "d" }),
        relationship({ id: "d" }), // same id twice
        { not: "a relationship" },
        relationship({ id: "e" }),
      ],
      known,
    );

    expect(items.map((item) => item.id)).toEqual(["d", "e"]);
    expect(dropped).toBe(5);
  });

  it("keeps timeline events but only the character links that exist", () => {
    const { items, dropped } = normalizeImportedTimeline(
      [
        event({ characterIds: ["char-1", "char-99"] }),
        event({ id: "evt-2", kind: "nonsense" }),
        event({ id: "evt-3", title: "" }),
      ],
      known,
    );

    expect(items).toHaveLength(1);
    expect(items[0].characterIds).toEqual(["char-1"]);
    expect(dropped).toBe(2);
  });

  it("drops a world parent that is not part of the import", () => {
    const { items } = normalizeImportedWorld(
      [entry(), entry({ id: "world-2", name: "白塔城", parentId: "world-404" })],
      known,
    );

    // A hierarchy stored as flat ids must not be able to arrive pointing nowhere.
    expect(items[0].parentId).toBeUndefined();
    expect(items[1].parentId).toBeUndefined();
  });

  it("keeps a world parent that is part of the import", () => {
    const { items } = normalizeImportedWorld(
      [entry(), entry({ id: "world-2", name: "白塔城", parentId: "world-1" })],
      known,
    );

    expect(items[1].parentId).toBe("world-1");
  });

  it("finds the datasets at the top level or under workspace", () => {
    expect(extractWorkspaceDatasets({ characters: [], relationships: [relationship()] })).toEqual({
      relationships: [relationship()],
      timeline: [],
      world: [],
    });

    expect(
      extractWorkspaceDatasets({
        workspace: { relationships: [], timeline: [event()], world: [entry()] },
      }),
    ).toEqual({ relationships: [], timeline: [event()], world: [entry()] });

    expect(extractWorkspaceDatasets({ characters: [] })).toBeNull();
    expect(extractWorkspaceDatasets(null)).toBeNull();
  });

  it("counts what a file carries", () => {
    expect(
      countWorkspaceDatasets({ relationships: [relationship()], timeline: [event()], world: [] }),
    ).toEqual({ relationships: 1, timeline: 1, world: 0 });
  });

  it("merges into storage by id instead of replacing what is already there", () => {
    // The relationship store prunes edges whose characters are gone, which is the
    // behaviour that keeps the graph honest — so a merge test needs the characters.
    saveCharacters([
      { id: "char-1", name: "甲", createdAt: now, updatedAt: now } as unknown as Character,
      { id: "char-2", name: "乙", createdAt: now, updatedAt: now } as unknown as Character,
    ]);
    localStorage.setItem(
      RELATIONSHIPS_KEY,
      JSON.stringify([relationship({ id: "rel-existing" })]),
    );

    // Distinct pairs: the store collapses the same pair in the same direction with
    // the same kind into one edge, so a merge test needs edges that differ.
    const result = applyWorkspaceDatasets(
      {
        relationships: [relationship({ id: "rel-new", fromId: "char-2", toId: "char-1" }), relationship({ id: "rel-1", kind: "romance" })],
        timeline: [event()],
        world: [entry()],
      },
      known,
    );

    expect(result.relationships).toEqual({ items: 2, added: 2, updated: 0, dropped: 0 });
    const stored = JSON.parse(localStorage.getItem(RELATIONSHIPS_KEY) || "[]") as Array<{ id: string }>;
    expect(stored.map((item) => item.id).sort()).toEqual(["rel-1", "rel-existing", "rel-new"]);

    // Second run over the same file updates rather than duplicating.
    const again = applyWorkspaceDatasets(
      { relationships: [relationship({ id: "rel-1", kind: "romance" })], timeline: [], world: [] },
      known,
    );
    expect(again.relationships).toEqual({ items: 1, added: 0, updated: 1, dropped: 0 });
    expect(JSON.parse(localStorage.getItem(RELATIONSHIPS_KEY) || "[]")).toHaveLength(3);

    expect(JSON.parse(localStorage.getItem(TIMELINE_KEY) || "[]")).toHaveLength(1);
    expect(JSON.parse(localStorage.getItem(WORLD_KEY) || "[]")).toHaveLength(1);
  });

  it("reports what it refused to import", () => {
    const result = applyWorkspaceDatasets(
      { relationships: [relationship({ fromId: "missing" })], timeline: [], world: [] },
      known,
    );

    expect(result.relationships).toEqual({ items: 0, added: 0, updated: 0, dropped: 1 });
    expect(localStorage.getItem(RELATIONSHIPS_KEY)).toBe("[]");
  });
});
