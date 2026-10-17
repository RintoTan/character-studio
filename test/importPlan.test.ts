// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { buildImportPlan, type ExistingLibrary, type IncomingCharacter } from "../src/utils/importPlan";
import type { Character } from "../src/types/character";
import type { Relationship } from "../src/types/relationship";
import type { TimelineEvent } from "../src/types/timeline";
import type { WorldEntry } from "../src/types/world";

const now = "2026-10-17T00:00:00.000Z";

const character = (overrides: Partial<Character> = {}): Character => ({
  id: "char-a",
  name: "甲",
  createdAt: now,
  updatedAt: now,
  ...overrides,
});

const incoming = (id: string, overrides: Partial<Character> = {}): IncomingCharacter => ({
  sourceId: id,
  character: character({ id, ...overrides }),
});

const relationship = (overrides: Partial<Relationship> = {}): Relationship => ({
  id: "rel-1",
  fromId: "char-a",
  toId: "char-b",
  kind: "friend",
  createdAt: now,
  updatedAt: now,
  ...overrides,
});

const event = (overrides: Partial<TimelineEvent> = {}): TimelineEvent => ({
  id: "evt-1",
  title: "初遇",
  date: "2040-01-01",
  kind: "origin",
  characterIds: ["char-a"],
  createdAt: now,
  updatedAt: now,
  ...overrides,
});

const entry = (overrides: Partial<WorldEntry> = {}): WorldEntry => ({
  id: "world-1",
  name: "白塔城",
  category: "location",
  tags: [],
  characterIds: [],
  createdAt: now,
  updatedAt: now,
  ...overrides,
});

const emptyLibrary = (): ExistingLibrary => ({
  characters: [],
  relationships: [],
  timeline: [],
  world: [],
});

describe("import plan", () => {
  it("points the package's relationships at the copy, not at whoever held that id", () => {
    // The bug this replaces: the incoming 甲 had to take a new id because the
    // library already had a different 甲, and the edge stayed on "char-a" - which
    // is the *stored* person. A relationship between two strangers.
    const existing: ExistingLibrary = {
      ...emptyLibrary(),
      characters: [character({ id: "char-a", name: "另一个甲" })],
      relationships: [],
    };

    const plan = buildImportPlan(
      [incoming("char-a", { name: "甲" })],
      { relationships: [relationship({ fromId: "char-a", toId: "char-b" })], timeline: [], world: [] },
      existing,
      { strategy: "copy", now },
    );

    const copied = plan.characters.items[0];
    expect(copied.character.id).not.toBe("char-a");
    expect(plan.characterIds.get("char-a")).toBe(copied.character.id);

    // char-b does not exist anywhere, so the edge is set aside rather than attached.
    expect(plan.relationships.items).toHaveLength(0);
    expect(plan.relationships.deferred).toBe(1);
  });

  it("rewrites both ends through the mapping when both characters are in the package", () => {
    const existing: ExistingLibrary = {
      ...emptyLibrary(),
      characters: [character({ id: "char-a", name: "另一个甲" })],
    };

    const plan = buildImportPlan(
      [incoming("char-a", { name: "甲" }), incoming("char-b", { name: "乙" })],
      { relationships: [relationship()], timeline: [], world: [] },
      existing,
      { strategy: "copy", now },
    );

    const edge = plan.relationships.items[0];
    expect(edge.fromId).toBe(plan.characterIds.get("char-a"));
    expect(edge.toId).toBe(plan.characterIds.get("char-b"));
    // Only the id that was taken is remapped; the free one is left alone.
    expect(edge.fromId).not.toBe("char-a");
    expect(edge.toId).toBe("char-b");
  });

  it("keeps the stored record on the keep strategy and still resolves references to it", () => {
    const existing: ExistingLibrary = {
      ...emptyLibrary(),
      characters: [character({ id: "char-a", name: "旧甲" })],
    };

    const plan = buildImportPlan(
      [incoming("char-a", { name: "新甲" }), incoming("char-b")],
      { relationships: [relationship()], timeline: [], world: [] },
      existing,
      { strategy: "keep", now },
    );

    expect(plan.characters.items.map((item) => item.character.id)).toEqual(["char-b"]);
    expect(plan.characters.kept).toBe(1);
    expect(plan.relationships.items[0].fromId).toBe("char-a");
    // The stored character is untouched; the plan does not carry it as an update.
    expect(plan.characters.items.some((item) => item.character.name === "新甲")).toBe(false);
  });

  it("replaces in place on the replace strategy, keeping the stored identity and creation time", () => {
    const existing: ExistingLibrary = {
      ...emptyLibrary(),
      characters: [character({ id: "char-a", name: "旧甲", createdAt: "2026-01-01T00:00:00.000Z" })],
    };

    const plan = buildImportPlan(
      [incoming("char-a", { name: "新甲" }), incoming("char-b")],
      { relationships: [relationship()], timeline: [], world: [] },
      existing,
      { strategy: "replace", now },
    );

    const replaced = plan.characters.items.find((item) => item.sourceId === "char-a");
    expect(replaced?.action).toBe("update");
    expect(replaced?.character.id).toBe("char-a");
    expect(replaced?.character.name).toBe("新甲");
    expect(replaced?.character.createdAt).toBe("2026-01-01T00:00:00.000Z");
    expect(plan.relationships.items[0].fromId).toBe("char-a");
  });

  it("sets aside a relationship with a missing end and says which end", () => {
    const plan = buildImportPlan(
      [incoming("char-a")],
      {
        relationships: [
          relationship({ id: "rel-a", toId: "char-ghost" }),
          relationship({ id: "rel-b", fromId: "char-ghost", toId: "char-ghost" }),
        ],
        timeline: [],
        world: [],
      },
      emptyLibrary(),
      { now },
    );

    expect(plan.relationships.items).toHaveLength(0);
    expect(plan.relationships.deferred).toBe(2);
    expect(plan.omitted.map((item) => item.reason)).toEqual([
      "终点的角色不在导入范围内",
      "两端的角色都不在导入范围内",
    ]);
  });

  it("keeps a timeline event when part of its cast is missing, and reports the pruned link", () => {
    const plan = buildImportPlan(
      [incoming("char-a")],
      { relationships: [], timeline: [event({ characterIds: ["char-a", "char-ghost"] })], world: [] },
      emptyLibrary(),
      { now },
    );

    expect(plan.timeline.items).toHaveLength(1);
    expect(plan.timeline.items[0].characterIds).toEqual(["char-a"]);
    expect(plan.timeline.prunedReferences).toBe(1);
    expect(plan.omitted[0].reason).toContain("无法解析的关联角色");
  });

  it("moves an entry whose parent is absent to the top and names it", () => {
    const plan = buildImportPlan(
      [],
      { relationships: [], timeline: [], world: [entry({ parentId: "world-404" })] },
      emptyLibrary(),
      { now },
    );

    expect(plan.world.items[0].parentId).toBeUndefined();
    expect(plan.omitted[0].reason).toContain("父级不在导入范围内");
  });

  it("keeps a parent that is part of the package and follows a remapped parent id", () => {
    const existing: ExistingLibrary = {
      ...emptyLibrary(),
      world: [entry({ id: "world-1", name: "已存在的同名层级" })],
    };

    const plan = buildImportPlan(
      [],
      {
        relationships: [],
        timeline: [],
        world: [
          entry({ id: "world-1", name: "白塔城" }),
          entry({ id: "world-2", name: "钟楼", parentId: "world-1" }),
        ],
      },
      existing,
      { strategy: "copy", now },
    );

    const parent = plan.world.items.find((item) => item.name === "白塔城");
    const child = plan.world.items.find((item) => item.name === "钟楼");
    expect(parent?.id).not.toBe("world-1");
    // The parent was copied, so the child must follow the copy rather than the
    // stored entry that happens to share the old id.
    expect(child?.parentId).toBe(parent?.id);
  });

  it("cuts a cycle and says so instead of storing it", () => {
    const plan = buildImportPlan(
      [],
      {
        relationships: [],
        timeline: [],
        world: [
          entry({ id: "w1", name: "甲层", parentId: "w2" }),
          entry({ id: "w2", name: "乙层", parentId: "w1" }),
        ],
      },
      emptyLibrary(),
      { now },
    );

    // One of the two edges has to go, or the hierarchy is unreadable. Which one is
    // not arbitrary to the reader - what matters is that exactly one survives and
    // the other is reported.
    const withParent = plan.world.items.filter((item) => item.parentId);
    expect(withParent).toHaveLength(1);
    expect(plan.omitted.some((item) => item.reason.includes("循环"))).toBe(true);
  });

  it("refuses a duplicate edge, including the same pair written the other way round", () => {
    const plan = buildImportPlan(
      [incoming("char-a"), incoming("char-b")],
      {
        relationships: [
          relationship({ id: "rel-1" }),
          relationship({ id: "rel-2", fromId: "char-b", toId: "char-a" }),
        ],
        timeline: [],
        world: [],
      },
      emptyLibrary(),
      { now },
    );

    expect(plan.relationships.items).toHaveLength(1);
    expect(plan.relationships.duplicates).toBe(1);
  });

  it("does not treat 师承 in the other direction as a duplicate", () => {
    const plan = buildImportPlan(
      [incoming("char-a"), incoming("char-b")],
      {
        relationships: [
          relationship({ id: "rel-1", kind: "mentor" }),
          relationship({ id: "rel-2", kind: "mentor", fromId: "char-b", toId: "char-a" }),
        ],
        timeline: [],
        world: [],
      },
      emptyLibrary(),
      { now },
    );

    expect(plan.relationships.items).toHaveLength(2);
  });

  it("refuses records whose fields do not validate and counts them", () => {
    const plan = buildImportPlan(
      [incoming("char-a")],
      {
        relationships: [
          relationship({ id: "", kind: "friend" }),
          relationship({ id: "rel-2", kind: "soulmate" as Relationship["kind"] }),
          relationship({ id: "rel-3", toId: "char-a" }),
        ],
        timeline: [event({ id: "", characterIds: [] })],
        world: [entry({ id: "w1", category: "planet" as WorldEntry["category"] })],
      },
      emptyLibrary(),
      { now },
    );

    // empty id, unknown kind, and an edge whose two ends are the same character
    expect(plan.relationships.invalid).toBe(3);
    expect(plan.relationships.items).toHaveLength(0);
    expect(plan.timeline.invalid).toBe(1);
    expect(plan.world.invalid).toBe(1);
  });

  it("drops the stored library on a restore and keeps everything on a merge", () => {
    const existing: ExistingLibrary = {
      characters: [character({ id: "char-a" }), character({ id: "char-z", name: "旧" })],
      relationships: [relationship({ id: "rel-old" })],
      timeline: [event({ id: "evt-old" })],
      world: [entry({ id: "world-old" })],
    };
    const workspace = {
      // A different pair from the stored edge, or the duplicate rule would (rightly)
      // refuse it and the count would test the wrong thing.
      relationships: [relationship({ id: "rel-new", fromId: "char-a", toId: "char-b", kind: "enemy" })],
      timeline: [event({ id: "evt-new" })],
      world: [entry({ id: "world-new" })],
    };

    const merge = buildImportPlan(
      [incoming("char-a"), incoming("char-b")],
      workspace,
      existing,
      { mode: "merge", strategy: "keep", now },
    );
    expect(merge.target.characters).toBe(3); // char-a kept, char-b added, char-z untouched
    expect(merge.target.relationships).toBe(2);

    const restore = buildImportPlan(
      [incoming("char-a"), incoming("char-b")],
      workspace,
      existing,
      { mode: "replace", now },
    );
    expect(restore.target.characters).toBe(2);
    expect(restore.target.relationships).toBe(1);
    expect(restore.target.timeline).toBe(1);
    expect(restore.target.world).toBe(1);
  });

  it("excludes a domain the author turned off without losing the rest", () => {
    const plan = buildImportPlan(
      [incoming("char-a")],
      { relationships: [relationship({ toId: "char-a" })], timeline: [event()], world: [entry()] },
      emptyLibrary(),
      { categories: { relationships: false, world: false }, now },
    );

    expect(plan.relationships.items).toHaveLength(0);
    expect(plan.timeline.items).toHaveLength(1);
    expect(plan.world.items).toHaveLength(0);
  });
});
