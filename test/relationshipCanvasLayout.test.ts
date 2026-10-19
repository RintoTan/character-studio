import { describe, expect, it } from "vitest";
import {
  applyPositions,
  clusterLayout,
  connectedComponents,
  createGroup,
  emptyLayout,
  groupBounds,
  groupOf,
  LAYOUT_SCHEMA_VERSION,
  materializeLayout,
  mergeImportedLayout,
  normalizeLayout,
  placeMissingPositions,
  pruneLayout,
  removeGroup,
  renameGroup,
  ringLayout,
  setPosition,
  translatePositions,
} from "../src/storage/relationshipLayout";

describe("normalizeLayout", () => {
  it("returns an empty layout for anything that is not a record", () => {
    for (const value of [null, undefined, 42, "x", [], true]) {
      expect(normalizeLayout(value)).toEqual({
        schemaVersion: LAYOUT_SCHEMA_VERSION,
        positions: {},
        groups: [],
      });
    }
  });

  it("drops a single corrupt coordinate without discarding the rest", () => {
    const layout = normalizeLayout({
      positions: {
        a: { x: 10, y: 20 },
        b: { x: "10", y: 20 },
        c: { x: Number.NaN, y: 0 },
        d: { x: 1e9, y: 0 },
      },
    });

    expect(Object.keys(layout.positions)).toEqual(["a"]);
  });

  it("rounds coordinates to two decimals", () => {
    const layout = normalizeLayout({ positions: { a: { x: 1.23456, y: -9.87654 } } });
    expect(layout.positions.a).toEqual({ x: 1.23, y: -9.88 });
  });

  it("keeps groups that make sense and drops the ones that do not", () => {
    const layout = normalizeLayout({
      groups: [
        { id: "g1", name: "旧友", characterIds: ["a", "b"] },
        { id: "g1", name: "重复", characterIds: ["c", "d"] },
        { id: "g2", name: "   ", characterIds: ["e", "f"] },
        { id: "g3", name: "单人", characterIds: ["g"] },
        { id: "g4", name: "跨组", characterIds: ["a", "h", "h"] },
      ],
    });

    expect(layout.groups).toEqual([{ id: "g1", name: "旧友", characterIds: ["a", "b"] }]);
  });

  it("puts a character in at most one group", () => {
    const layout = normalizeLayout({
      groups: [
        { id: "g1", name: "A", characterIds: ["x", "y"] },
        { id: "g2", name: "B", characterIds: ["y", "z"] },
      ],
    });

    expect(layout.groups.map((group) => group.characterIds)).toEqual([["x", "y"]]);
  });
});

describe("pruneLayout", () => {
  it("removes positions for deleted characters and shrinks groups", () => {
    const layout = normalizeLayout({
      positions: { a: { x: 0, y: 0 }, b: { x: 10, y: 10 }, gone: { x: 5, y: 5 } },
      groups: [
        { id: "g1", name: "两人", characterIds: ["a", "b"] },
        { id: "g2", name: "带删除", characterIds: ["a", "gone"] },
      ],
    });

    const pruned = pruneLayout(layout, ["a", "b"]);
    expect(Object.keys(pruned.positions).sort()).toEqual(["a", "b"]);
    expect(pruned.groups.map((group) => group.id)).toEqual(["g1"]);
  });

  it("leaves an unchanged layout alone", () => {
    const layout = normalizeLayout({ positions: { a: { x: 1, y: 2 } }, groups: [] });
    expect(pruneLayout(layout, ["a"])).toEqual(layout);
  });
});

describe("placeMissingPositions", () => {
  it("places newcomers below the drawing and never moves existing nodes", () => {
    const layout = normalizeLayout({
      positions: { a: { x: 0, y: 0 }, b: { x: 100, y: 40 } },
    });

    const next = placeMissingPositions(layout, ["a", "b", "c", "d"], { spacing: 100, columns: 2 });

    expect(next.positions.a).toEqual({ x: 0, y: 0 });
    expect(next.positions.b).toEqual({ x: 100, y: 40 });
    expect(next.positions.c).toEqual({ x: 0, y: 140 });
    expect(next.positions.d).toEqual({ x: 100, y: 140 });
  });

  it("starts from the given origin when nothing is placed yet", () => {
    const next = placeMissingPositions(emptyLayout(), ["a", "b"], { spacing: 50, origin: { x: 7, y: 9 } });
    expect(next.positions).toEqual({ a: { x: 7, y: 9 }, b: { x: 57, y: 9 } });
  });

  it("is a no-op when every id already has a position", () => {
    const layout = normalizeLayout({ positions: { a: { x: 3, y: 4 } } });
    expect(placeMissingPositions(layout, ["a"])).toBe(layout);
  });
});

describe("materializeLayout", () => {
  it("turns the drawn ring into coordinates without moving anything", () => {
    const ring = [
      { x: 10, y: 20 },
      { x: 30, y: 40 },
    ];
    const next = materializeLayout(emptyLayout(), ["a", "b"], ring);
    expect(next.positions).toEqual({ a: { x: 10, y: 20 }, b: { x: 30, y: 40 } });
  });

  it("keeps a hand-placed node when the ring disagrees", () => {
    const layout = normalizeLayout({ positions: { a: { x: 999, y: 999 } } });
    const next = materializeLayout(layout, ["a", "b"], [
      { x: 0, y: 0 },
      { x: 10, y: 10 },
    ]);

    expect(next.positions.a).toEqual({ x: 999, y: 999 });
    expect(next.positions.b).toEqual({ x: 10, y: 10 });
  });
});

describe("moves", () => {
  it("sets one position without touching the others", () => {
    const layout = normalizeLayout({ positions: { a: { x: 1, y: 1 }, b: { x: 2, y: 2 } } });
    const next = setPosition(layout, "a", { x: 12.3456, y: 7.8912 });

    expect(next.positions.a).toEqual({ x: 12.35, y: 7.89 });
    expect(next.positions.b).toEqual({ x: 2, y: 2 });
  });

  it("translates only the ids it is given", () => {
    const layout = normalizeLayout({ positions: { a: { x: 0, y: 0 }, b: { x: 10, y: 10 } } });
    const next = translatePositions(layout, ["a"], { x: 5, y: -5 });

    expect(next.positions.a).toEqual({ x: 5, y: -5 });
    expect(next.positions.b).toEqual({ x: 10, y: 10 });
  });

  it("applies a whole arrangement at once", () => {
    const layout = emptyLayout();
    const next = applyPositions(layout, { a: { x: 1, y: 2 }, b: { x: 3, y: 4 } });
    expect(next.positions).toEqual({ a: { x: 1, y: 2 }, b: { x: 3, y: 4 } });
  });
});

describe("ringLayout", () => {
  it("places a single node on the centre", () => {
    expect(ringLayout(["a"], { x: 5, y: 6 })).toEqual({ a: { x: 5, y: 6 } });
  });

  it("spaces a pair evenly about the centre", () => {
    const positions = ringLayout(["a", "b"], { x: 0, y: 0 });
    expect(positions.a).toEqual({ x: -150, y: 0 });
    expect(positions.b).toEqual({ x: 150, y: 0 });
  });

  it("grows the ring with the count so nodes do not overlap", () => {
    const few = ringLayout(["a", "b", "c"], { x: 0, y: 0 });
    const many = ringLayout(Array.from({ length: 40 }, (_, index) => `c${index}`), { x: 0, y: 0 });
    const radius = (positions: Record<string, { x: number; y: number }>) =>
      Math.hypot(Object.values(positions)[0].x, Object.values(positions)[0].y);

    expect(radius(many)).toBeGreaterThan(radius(few));
  });

  it("is deterministic for the same ids", () => {
    const ids = ["b", "a", "c"];
    expect(ringLayout(ids, { x: 0, y: 0 })).toEqual(ringLayout(ids, { x: 0, y: 0 }));
  });
});

describe("connectedComponents", () => {
  it("groups nodes joined by any path and separates the rest", () => {
    expect(
      connectedComponents(["a", "b", "c", "d"], [
        { fromId: "a", toId: "b" },
        { fromId: "b", toId: "c" },
      ]),
    ).toEqual([["a", "b", "c"], ["d"]]);
  });

  it("ignores edges pointing outside the arranged set", () => {
    expect(connectedComponents(["a"], [{ fromId: "a", toId: "outside" }])).toEqual([["a"]]);
  });
});

describe("clusterLayout", () => {
  const edges = [
    { fromId: "a", toId: "b" },
    { fromId: "b", toId: "c" },
    { fromId: "d", toId: "e" },
  ];

  it("produces one position per requested id", () => {
    const positions = clusterLayout(["a", "b", "c", "d", "e", "f"], edges, { x: 0, y: 0 });
    expect(Object.keys(positions).sort()).toEqual(["a", "b", "c", "d", "e", "f"]);
  });

  it("keeps each connected clump tighter than the distance between clumps", () => {
    const positions = clusterLayout(["a", "b", "c", "d", "e"], edges, { x: 0, y: 0 });
    const distance = (left: string, right: string) =>
      Math.hypot(positions[left].x - positions[right].x, positions[left].y - positions[right].y);

    const inside = Math.max(distance("a", "b"), distance("b", "c"), distance("a", "c"));
    const between = Math.min(distance("a", "d"), distance("a", "e"), distance("c", "d"), distance("c", "e"));

    expect(inside).toBeLessThan(between);
  });

  it("is deterministic across calls", () => {
    const ids = ["e", "c", "a", "d", "b"];
    expect(clusterLayout(ids, edges, { x: 12, y: 8 })).toEqual(clusterLayout(ids, edges, { x: 12, y: 8 }));
  });

  it("falls back to a ring when everything is connected", () => {
    const positions = clusterLayout(["a", "b", "c"], edges, { x: 0, y: 0 });
    expect(Object.keys(positions).sort()).toEqual(["a", "b", "c"]);
  });
});

describe("visual groups", () => {
  const base = normalizeLayout({
    positions: {
      a: { x: 0, y: 0 },
      b: { x: 100, y: 0 },
      c: { x: 300, y: 0 },
    },
  });

  it("creates a group from a selection and computes its rectangle", () => {
    const next = createGroup(base, "  旧友  ", ["a", "b"], "g1");
    expect(next?.groups).toEqual([{ id: "g1", name: "旧友", characterIds: ["a", "b"] }]);

    const bounds = groupBounds(next!, next!.groups[0], 10);
    expect(bounds).toEqual({ x: -10, y: -10, width: 120, height: 20 });
  });

  it("refuses a group with fewer than two members or no name", () => {
    expect(createGroup(base, "单人", ["a"], "g1")).toBeNull();
    expect(createGroup(base, "   ", ["a", "b"], "g1")).toBeNull();
  });

  it("moves a character out of an older group when it joins a new one", () => {
    const first = createGroup(base, "A", ["a", "b"], "g1")!;
    const second = createGroup(first, "B", ["b", "c"], "g2")!;

    expect(second.groups).toEqual([
      { id: "g2", name: "B", characterIds: ["b", "c"] },
      // g1 is left with one member, so it is no longer a group.
    ]);
    expect(groupOf(second, "b")?.id).toBe("g2");
  });

  it("renames, removes and reports membership", () => {
    const grouped = createGroup(base, "旧友", ["a", "b"], "g1")!;
    expect(renameGroup(grouped, "g1", " 新名 ").groups[0].name).toBe("新名");
    expect(renameGroup(grouped, "g1", "  ")).toBe(grouped);
    expect(groupOf(grouped, "c")).toBeNull();
    expect(removeGroup(grouped, "g1").groups).toEqual([]);
  });

  it("returns no rectangle when no member has a position", () => {
    const layout = normalizeLayout({ groups: [{ id: "g1", name: "空", characterIds: ["a", "b"] }] });
    expect(groupBounds(layout, layout.groups[0])).toBeNull();
  });
});

describe("mergeImportedLayout", () => {
  const backup = {
    schemaVersion: 1,
    positions: {
      "file-a": { x: 100, y: 100 },
      "file-b": { x: 200, y: 200 },
      gone: { x: 1, y: 2 },
    },
    groups: [
      { id: "g1", name: "备份组", characterIds: ["file-a", "file-b"] },
      { id: "g2", name: "缺人", characterIds: ["file-a", "gone"] },
    ],
  };

  it("restores the package canvas through an id remap", () => {
    const merged = mergeImportedLayout({
      current: normalizeLayout({ positions: { stale: { x: 9, y: 9 } } }),
      incoming: backup,
      idBySource: new Map([
        ["file-a", "new-a"],
        ["file-b", "new-b"],
      ]),
      finalIds: ["new-a", "new-b"],
      mode: "replace",
    });

    expect(merged.positions).toEqual({
      "new-a": { x: 100, y: 100 },
      "new-b": { x: 200, y: 200 },
    });
    expect(merged.groups).toEqual([
      { id: "g1", name: "备份组", characterIds: ["new-a", "new-b"] },
    ]);
  });

  it("protects local coordinates in a merge", () => {
    const merged = mergeImportedLayout({
      current: normalizeLayout({ positions: { "file-a": { x: 7, y: 7 } } }),
      incoming: backup,
      idBySource: new Map(),
      finalIds: ["file-a", "file-b"],
      mode: "merge",
    });

    expect(merged.positions["file-a"]).toEqual({ x: 7, y: 7 });
    expect(merged.positions["file-b"]).toEqual({ x: 200, y: 200 });
  });

  it("drops references to characters the import did not bring", () => {
    const merged = mergeImportedLayout({
      current: emptyLayout(),
      incoming: backup,
      idBySource: new Map(),
      finalIds: ["file-a", "file-b"],
      mode: "replace",
    });

    expect(Object.keys(merged.positions).sort()).toEqual(["file-a", "file-b"]);
    expect(merged.groups.map((group) => group.id)).toEqual(["g1"]);
  });

  it("adds an imported group without stealing local members or ids", () => {
    const current = normalizeLayout({
      positions: { local: { x: 0, y: 0 } },
      groups: [{ id: "g1", name: "本地组", characterIds: ["local", "file-a"] }],
    });

    const merged = mergeImportedLayout({
      current,
      incoming: {
        positions: {},
        groups: [
          { id: "g1", name: "同名备份组", characterIds: ["file-b", "file-c"] },
          // Its only surviving member is already claimed locally, so this one
          // must vanish rather than become a group of one.
          { id: "g2", name: "被本地拿走", characterIds: ["file-a", "file-d"] },
        ],
      },
      idBySource: new Map(),
      finalIds: ["local", "file-a", "file-b", "file-c", "file-d"],
      mode: "merge",
    });

    expect(merged.groups[0]).toEqual(current.groups[0]);
    expect(merged.groups[1]).toMatchObject({ id: "g1-imported", characterIds: ["file-b", "file-c"] });
    expect(merged.groups.flatMap((group) => group.characterIds).filter((id) => id === "file-a")).toHaveLength(1);
  });

  it("accepts a workspace with no layout at all", () => {
    const merged = mergeImportedLayout({
      current: normalizeLayout({ positions: { local: { x: 3, y: 4 } } }),
      incoming: null,
      idBySource: new Map(),
      finalIds: ["local"],
      mode: "merge",
    });

    expect(merged.positions).toEqual({ local: { x: 3, y: 4 } });
  });

  it("treats a corrupt payload as an empty one", () => {
    const merged = mergeImportedLayout({
      current: emptyLayout(),
      incoming: { positions: { a: { x: "x", y: 0 } }, groups: "nope" },
      idBySource: new Map(),
      finalIds: ["a"],
      mode: "replace",
    });

    expect(merged.positions).toEqual({});
    expect(merged.groups).toEqual([]);
  });
});
