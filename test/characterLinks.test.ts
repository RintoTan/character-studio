import { describe, expect, it } from "vitest";
import type { Relationship } from "../src/types/relationship";
import type { TimelineEvent } from "../src/types/timeline";
import type { WorldEntry } from "../src/types/world";
import {
  RELATED_PREVIEW_LIMIT,
  relatedCounts,
  relationshipDirectionLabel,
  relationshipPeerId,
  relationshipsOf,
  timelineEventsOf,
  worldEntriesOf,
} from "../src/utils/characterLinks";

const relationship = (overrides: Partial<Relationship> & { id: string }): Relationship =>
  ({
    fromId: "a",
    toId: "b",
    kind: "friend",
    note: "",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  }) as Relationship;

const event = (overrides: Partial<TimelineEvent> & { id: string; date: string }): TimelineEvent =>
  ({
    title: overrides.id,
    kind: "turning",
    description: "",
    location: "",
    era: "",
    characterIds: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  }) as TimelineEvent;

const entry = (overrides: Partial<WorldEntry> & { id: string; name: string }): WorldEntry =>
  ({
    category: "location",
    tags: [],
    characterIds: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  }) as WorldEntry;

const relationships: Relationship[] = [
  relationship({ id: "r-1", fromId: "a", toId: "b", kind: "friend" }),
  relationship({ id: "r-2", fromId: "c", toId: "a", kind: "mentor" }),
  relationship({ id: "r-3", fromId: "b", toId: "c", kind: "family" }),
];

describe("a character's relationships", () => {
  it("keeps only the edges this character is an end of", () => {
    expect(relationshipsOf(relationships, "a").map((item) => item.id)).toEqual(["r-1", "r-2"]);
    expect(relationshipsOf(relationships, "c").map((item) => item.id)).toEqual(["r-2", "r-3"]);
    expect(relationshipsOf(relationships, "nobody")).toEqual([]);
  });

  it("names the other end from either side", () => {
    expect(relationshipPeerId(relationships[0], "a")).toBe("b");
    expect(relationshipPeerId(relationships[0], "b")).toBe("a");
    // The direction is the record's, not the reader's: 师承 c→a is c mentoring a.
    expect(relationshipPeerId(relationships[1], "c")).toBe("a");
  });

  it("states the stored direction for an uneven kind and stays quiet for an even one", () => {
    expect(relationshipDirectionLabel(relationships[0], "a")).toBe("友人");
    expect(relationshipDirectionLabel(relationships[1], "a")).toBe("师承 · 对方为师承方");
    expect(relationshipDirectionLabel(relationships[1], "c")).toBe("师承 · 此角色为师承方");
  });
});

describe("a character's events", () => {
  const events: TimelineEvent[] = [
    event({ id: "e-late", date: "2026-05-01", characterIds: ["a"] }),
    event({ id: "e-early", date: "2024-01-01", characterIds: ["a", "b"] }),
    event({ id: "e-middle", date: "2025-03-03", characterIds: ["b"] }),
    event({ id: "e-other", date: "2025-01-01", characterIds: ["c"] }),
  ];

  it("finds the ones that list the character and orders them the timeline's way", () => {
    expect(timelineEventsOf(events, "a").map((item) => item.id)).toEqual(["e-early", "e-late"]);
    expect(timelineEventsOf(events, "b").map((item) => item.id)).toEqual(["e-early", "e-middle"]);
    expect(timelineEventsOf(events, "nobody")).toEqual([]);
  });

  it("does not match on anything but the id", () => {
    // Same name, different character: an event of 甲 must not appear on 乙.
    const sameName = [
      event({ id: "e-1", date: "2025-01-01", title: "同名", characterIds: ["id-甲"] }),
    ];
    expect(timelineEventsOf(sameName, "id-乙")).toEqual([]);
    expect(timelineEventsOf(sameName, "id-甲")).toHaveLength(1);
  });
});

describe("a character's world entries", () => {
  const entries: WorldEntry[] = [
    entry({ id: "w-1", name: "雾海纪", characterIds: ["a", "b"] }),
    entry({ id: "w-2", name: "北境城", parentId: "w-1", characterIds: ["b"] }),
    entry({ id: "w-3", name: "无人条目" }),
  ];

  it("finds the entries that file the character", () => {
    expect(worldEntriesOf(entries, "a").map((item) => item.id)).toEqual(["w-1"]);
    expect(worldEntriesOf(entries, "b").map((item) => item.id)).toEqual(["w-1", "w-2"]);
    expect(worldEntriesOf(entries, "c")).toEqual([]);
  });

  it("counts the three kinds together", () => {
    expect(
      relatedCounts({
        relationships,
        events: [event({ id: "e-1", date: "2025-01-01", characterIds: ["a"] })],
        entries,
        characterId: "a",
      }),
    ).toEqual({ relationships: 2, events: 1, entries: 1 });
    expect(
      relatedCounts({ relationships, events: [], entries, characterId: "nobody" }),
    ).toEqual({ relationships: 0, events: 0, entries: 0 });
  });

  it("shows three before offering the rest", () => {
    expect(RELATED_PREVIEW_LIMIT).toBe(3);
    const many = Array.from({ length: 9 }, (_, index) =>
      event({ id: `e-${index}`, date: `2025-01-0${index + 1}`, characterIds: ["a"] }),
    );
    expect(timelineEventsOf(many, "a")).toHaveLength(9);
    expect(timelineEventsOf(many, "a").slice(0, RELATED_PREVIEW_LIMIT)).toHaveLength(3);
  });
});
