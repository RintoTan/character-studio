import { describe, expect, it } from "vitest";
import {
  addSnapshot,
  captureSnapshot,
  cleanSnapshotName,
  normalizeSnapshots,
  removeSnapshot,
  renameSnapshot,
  snapshotCoverage,
  snapshotMemberCount,
  snapshotPositions,
  SNAPSHOT_LIMIT,
} from "../src/utils/layoutSnapshots";
import { emptyLayout } from "../src/storage/relationshipLayout";

const view = { k: 1.5, x: -20, y: 40 };
const layout = {
  ...emptyLayout(),
  positions: { a: { x: 10, y: 20 }, b: { x: 30, y: 40 } },
};

describe("layout snapshots", () => {
  it("captures the current coordinates and framing under a cleaned name", () => {
    const { snapshot, error } = captureSnapshot(layout, "  北境   布局  ", view, ["a", "b"], "2026-05-01T00:00:00.000Z");
    expect(error).toBeNull();
    expect(snapshot?.name).toBe("北境 布局");
    expect(snapshot?.positions).toEqual({ a: { x: 10, y: 20 }, b: { x: 30, y: 40 } });
    expect(snapshot?.view).toEqual(view);
  });

  it("refuses a nameless or empty capture instead of saving a broken entry", () => {
    expect(captureSnapshot(layout, "   ", view, ["a"], "t").error).toBeTruthy();
    expect(captureSnapshot({ ...layout, positions: {} }, "空的", view, [], "t").error).toBeTruthy();
  });

  it("keeps characters added later where they are and ignores deleted ones", () => {
    const snapshot = { positions: { a: { x: 100, y: 100 }, gone: { x: 5, y: 5 } } };
    const current = { a: { x: 1, y: 1 }, b: { x: 7, y: 7 } };
    const next = snapshotPositions(snapshot, current, ["a", "b"]);
    expect(next.a).toEqual({ x: 100, y: 100 });
    expect(next.b).toEqual({ x: 7, y: 7 });
    expect(next.gone).toBeUndefined();
    expect(snapshotCoverage(snapshot, ["a", "b"])).toEqual({ covered: 1, missing: 1, total: 2 });
  });

  it("replaces a same-named snapshot and stays under the cap", () => {
    let list = [] as ReturnType<typeof addSnapshot>;
    for (let index = 0; index < SNAPSHOT_LIMIT + 5; index += 1) {
      list = addSnapshot(list, {
        id: `s${index}`,
        name: `布局 ${index}`,
        positions: { a: { x: index, y: index } },
        view,
        createdAt: "t",
      });
    }
    expect(list).toHaveLength(SNAPSHOT_LIMIT);
    const replaced = addSnapshot(list, {
      id: "new",
      name: "布局 5",
      positions: { a: { x: 1, y: 2 } },
      view,
      createdAt: "t",
    });
    expect(replaced.filter((item) => item.name === "布局 5")).toHaveLength(1);
    expect(replaced[0].id).toBe("new");
  });

  it("renames and removes by id without touching the rest", () => {
    const list = [
      { id: "1", name: "一", positions: { a: { x: 0, y: 0 } }, view, createdAt: "t" },
      { id: "2", name: "二", positions: { a: { x: 1, y: 1 } }, view, createdAt: "t" },
    ];
    expect(renameSnapshot(list, "2", "  新名字 ")[1].name).toBe("新名字");
    expect(renameSnapshot(list, "2", "   ")[1].name).toBe("二");
    expect(removeSnapshot(list, "1").map((item) => item.id)).toEqual(["2"]);
  });

  it("drops unreadable stored entries but keeps the valid ones", () => {
    const stored = normalizeSnapshots([
      { id: "ok", name: "可用", positions: { a: { x: 1, y: 2 }, bad: { x: "3", y: 4 } }, view, createdAt: "t" },
      { id: "empty", name: "空", positions: {} },
      { id: "nan", name: "坏", positions: { a: { x: Number.POSITIVE_INFINITY, y: 0 } } },
      "nope",
    ]);
    expect(stored).toHaveLength(1);
    expect(stored[0].positions).toEqual({ a: { x: 1, y: 2 } });
    expect(normalizeSnapshots(undefined)).toEqual([]);
  });

  it("clamps a long name rather than letting it break the list row", () => {
    expect(cleanSnapshotName("名".repeat(80)).length).toBe(40);
  });

  it("records the roster with the coordinates, and an empty roster is a decision", () => {
    const withRoster = captureSnapshot(
      { ...layout, members: ["b"] },
      "留下一个",
      view,
      ["a", "b"],
      "t",
    ).snapshot;
    expect(withRoster?.members).toEqual(["b"]);

    const emptyRoster = captureSnapshot(
      { ...layout, positions: {}, members: [] },
      "空画布",
      view,
      ["a", "b"],
      "t",
    );
    expect(emptyRoster.error).toBeNull();
    expect(emptyRoster.snapshot?.members).toEqual([]);
    expect(emptyRoster.snapshot?.positions).toEqual({});
  });

  it("leaves a legacy canvas without a roster instead of saving it as an empty one", () => {
    const legacy = captureSnapshot(layout, "旧画布", view, ["a", "b"], "t").snapshot;
    expect(legacy?.members).toBeUndefined();
    expect(snapshotMemberCount(legacy!)).toBeNull();
  });

  it("reads back a stored roster, keeps [] and still accepts an old entry without one", () => {
    const stored = normalizeSnapshots([
      { id: "new", name: "有成员", positions: { a: { x: 1, y: 1 } }, members: ["a", "gone"], view, createdAt: "t" },
      { id: "empty", name: "空画布", positions: {}, members: [], view, createdAt: "t" },
      { id: "old", name: "旧快照", positions: { b: { x: 2, y: 2 } }, view, createdAt: "t" },
      { id: "broken", name: "坏成员", positions: { a: { x: 1, y: 1 } }, members: "a", view, createdAt: "t" },
    ]);

    expect(stored.map((item) => item.id)).toEqual(["new", "empty", "old", "broken"]);
    expect(stored[0].members).toEqual(["a", "gone"]);
    expect(stored[1].members).toEqual([]);
    expect(stored[2].members).toBeUndefined();
    expect(stored[3].members).toBeUndefined();
  });
});
