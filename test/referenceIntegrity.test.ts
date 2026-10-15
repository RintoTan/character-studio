// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import { pruneCharacterReferences } from "../src/storage/referenceIntegrity";
import { loadRelationships, saveRelationships } from "../src/storage/relationshipStorage";
import { loadTimeline, saveTimeline } from "../src/storage/timelineStorage";
import { loadWorldEntries, saveWorldEntries } from "../src/storage/worldStorage";
import type { Relationship } from "../src/types/relationship";
import type { TimelineEvent } from "../src/types/timeline";
import type { WorldEntry } from "../src/types/world";

const NOW = "2026-10-15T00:00:00.000Z";

const relationship = (id: string, fromId: string, toId: string): Relationship => ({
  id,
  fromId,
  toId,
  kind: "friend",
  createdAt: NOW,
  updatedAt: NOW,
});

const event = (characterIds: string[]): TimelineEvent => ({
  id: "t1",
  title: "事件",
  date: "2026-01-01",
  era: "",
  kind: "origin",
  characterIds,
  description: "",
  location: "",
  createdAt: NOW,
  updatedAt: NOW,
});

const entry = (characterIds: string[]): WorldEntry => ({
  id: "w1",
  name: "地点",
  category: "location",
  parentId: null,
  summary: "",
  details: "",
  tags: [],
  characterIds,
  createdAt: NOW,
  updatedAt: NOW,
});

describe("reference integrity after a delete", () => {
  beforeEach(() => {
    localStorage.clear();
    saveRelationships([
      relationship("r1", "c1", "c2"),
      relationship("r2", "c1", "c3"),
      relationship("r3", "c1", "deleted"),
    ]);
    saveTimeline([event(["c1", "deleted"])]);
    saveWorldEntries([entry(["deleted", "c2"])]);
  });

  it("drops references to a character that is gone, across all three domains", () => {
    const result = pruneCharacterReferences(["c1", "c2", "c3"]);

    expect(result.relationships).toBe(2);
    expect(loadRelationships().map((item) => item.id)).toEqual(["r1", "r2"]);
    expect(loadTimeline()[0].characterIds).toEqual(["c1"]);
    expect(loadWorldEntries()[0].characterIds).toEqual(["c2"]);
  });

  it("keeps the surviving character in a list and drops only the removed ones", () => {
    // Deleting everything except c1: every seeded edge ends at a removed character,
    // so the relationships go; the timeline keeps c1 because c1 still exists; the
    // world entry points only at removed characters, so its list empties.
    pruneCharacterReferences(["c1"]);

    expect(loadRelationships()).toEqual([]);
    expect(loadTimeline()[0].characterIds).toEqual(["c1"]);
    expect(loadWorldEntries()[0].characterIds).toEqual([]);
  });

  it("changes nothing when every reference still resolves", () => {
    saveRelationships([relationship("r1", "c1", "c2")]);
    saveTimeline([event(["c1"])]);
    saveWorldEntries([entry(["c2"])]);

    const before = JSON.stringify({
      relationships: loadRelationships(),
      timeline: loadTimeline(),
      world: loadWorldEntries(),
    });
    pruneCharacterReferences(["c1", "c2", "deleted"]);

    expect(
      JSON.stringify({
        relationships: loadRelationships(),
        timeline: loadTimeline(),
        world: loadWorldEntries(),
      }),
    ).toBe(before);
  });
});
