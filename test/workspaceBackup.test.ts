// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import {
  countWorkspaceDatasets,
  extractWorkspaceDatasets,
  readWorkspaceCounts,
  writePlannedDatasets,
} from "../src/storage/workspaceBackup";
import { RELATIONSHIPS_KEY } from "../src/storage/relationshipStorage";
import { TIMELINE_KEY } from "../src/storage/timelineStorage";
import { WORLD_KEY } from "../src/storage/worldStorage";
import type { Relationship } from "../src/types/relationship";
import type { TimelineEvent } from "../src/types/timeline";
import type { WorldEntry } from "../src/types/world";

const now = "2026-10-15T00:00:00.000Z";

const relationship = (overrides: Partial<Relationship> = {}): Relationship => ({
  id: "rel-1",
  fromId: "char-1",
  toId: "char-2",
  kind: "friend",
  createdAt: now,
  updatedAt: now,
  ...overrides,
});

const event = (overrides: Partial<TimelineEvent> = {}): TimelineEvent => ({
  id: "evt-1",
  title: "初次相遇",
  date: "2026-01-01",
  kind: "origin",
  characterIds: ["char-1"],
  createdAt: now,
  updatedAt: now,
  ...overrides,
});

const entry = (overrides: Partial<WorldEntry> = {}): WorldEntry => ({
  id: "world-1",
  name: "雾海纪",
  category: "location",
  tags: ["主世界"],
  characterIds: ["char-1"],
  createdAt: now,
  updatedAt: now,
  ...overrides,
});

const read = (key: string) => JSON.parse(localStorage.getItem(key) || "[]") as Array<{ id: string }>;

describe("workspace backup", () => {
  beforeEach(() => {
    localStorage.clear();
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
    localStorage.setItem(RELATIONSHIPS_KEY, JSON.stringify([relationship({ id: "rel-existing" })]));

    const counts = writePlannedDatasets("merge", {
      relationships: [
        relationship({ id: "rel-new", fromId: "char-2", toId: "char-1" }),
        relationship({ id: "rel-1", kind: "romance" }),
      ],
      timeline: [event()],
      world: [entry()],
    });

    expect(counts).toEqual({ relationships: 3, timeline: 1, world: 1 });
    expect(read(RELATIONSHIPS_KEY).map((item) => item.id).sort()).toEqual([
      "rel-1",
      "rel-existing",
      "rel-new",
    ]);
    expect(read(TIMELINE_KEY)).toHaveLength(1);
    expect(read(WORLD_KEY)).toHaveLength(1);
  });

  it("updates a record whose id is already stored rather than duplicating it", () => {
    localStorage.setItem(RELATIONSHIPS_KEY, JSON.stringify([relationship({ note: "旧" })]));

    const counts = writePlannedDatasets("merge", {
      relationships: [relationship({ note: "新" })],
      timeline: [],
      world: [],
    });

    expect(counts.relationships).toBe(1);
    const stored = JSON.parse(localStorage.getItem(RELATIONSHIPS_KEY) || "[]") as Relationship[];
    expect(stored[0].note).toBe("新");
  });

  it("replaces every domain when the plan is a restore", () => {
    localStorage.setItem(RELATIONSHIPS_KEY, JSON.stringify([relationship({ id: "rel-old" })]));
    localStorage.setItem(TIMELINE_KEY, JSON.stringify([event({ id: "evt-old" })]));
    localStorage.setItem(WORLD_KEY, JSON.stringify([entry({ id: "world-old" })]));

    writePlannedDatasets("replace", {
      relationships: [relationship({ id: "rel-clean" })],
      timeline: [event({ id: "evt-clean" })],
      world: [entry({ id: "world-clean" })],
    });

    expect(read(RELATIONSHIPS_KEY).map((item) => item.id)).toEqual(["rel-clean"]);
    expect(read(TIMELINE_KEY).map((item) => item.id)).toEqual(["evt-clean"]);
    expect(read(WORLD_KEY).map((item) => item.id)).toEqual(["world-clean"]);
  });

  it("reports what the stores hold by reading them back", () => {
    writePlannedDatasets("merge", {
      relationships: [relationship()],
      timeline: [],
      world: [],
    });

    expect(readWorkspaceCounts()).toEqual({ relationships: 1, timeline: 0, world: 0 });
  });
});
