// The batch edit has to survive the places the layout actually travels: the browser's
// own serialisation, a full backup, and an import that remaps ids. This file exercises
// those three paths on the real storage functions rather than on a hand-made object,
// because "it worked in memory" is not what an author loses when a restore drops a field.
import { describe, expect, it } from "vitest";
import { applyBatchStyle } from "../src/utils/batchStyle";
import { DEFAULT_CANVAS_STYLE } from "../src/storage/canvasStyle";
import {
  emptyLayout,
  mergeImportedLayout,
  normalizeLayout,
  pruneLayout,
  type CanvasLayout,
} from "../src/storage/relationshipLayout";

const ids = ["a", "b", "c", "d", "e"];

const canvas = (): CanvasLayout => ({
  ...emptyLayout(),
  positions: Object.fromEntries(ids.map((id, i) => [id, { x: i * 10, y: i * 5 }])),
  members: [...ids],
});

/** What `localStorage` hands back on the next page load. */
const roundTrip = (layout: CanvasLayout): CanvasLayout =>
  normalizeLayout(JSON.parse(JSON.stringify(layout)));

describe("a batch edit through storage", () => {
  it("keeps the three it wrote and the two it did not", () => {
    const edited = applyBatchStyle(canvas(), ["a", "b", "c"], { form: "card", size: 1.4 }, ids);
    const reloaded = roundTrip(edited);

    expect(Object.keys(reloaded.nodeStyles ?? {}).sort()).toEqual(["a", "b", "c"]);
    expect(reloaded.nodeStyles?.a).toEqual({ form: "card", size: 1.4 });
    expect(reloaded.nodeStyles?.d).toBeUndefined();
    expect(reloaded.nodeStyles?.e).toBeUndefined();
  });

  it("does not disturb the canvas-wide style on the way through", () => {
    const before = canvas();
    const reloaded = roundTrip(applyBatchStyle(before, ["a"], { background: "#123456" }, ids));
    expect(reloaded.style ?? DEFAULT_CANVAS_STYLE).toEqual(before.style ?? DEFAULT_CANVAS_STYLE);
  });
});

describe("a full backup and restore", () => {
  const backup = (layout: CanvasLayout) => ({ relationshipLayout: JSON.parse(JSON.stringify(layout)) });

  it("carries every override back on replace", () => {
    const edited = applyBatchStyle(canvas(), ["a", "b", "c"], { form: "card" }, ids);
    const file = backup(edited);
    const restored = mergeImportedLayout({
      current: emptyLayout(),
      incoming: file.relationshipLayout,
      idBySource: new Map(),
      finalIds: ids,
      mode: "replace",
    });

    expect(Object.keys(restored.nodeStyles ?? {}).sort()).toEqual(["a", "b", "c"]);
    expect(restored.nodeStyles?.b).toEqual({ form: "card" });
  });

  it("drops an override whose character did not survive the import", () => {
    const edited = applyBatchStyle(canvas(), ["a", "b", "c"], { form: "card" }, ids);
    const restored = mergeImportedLayout({
      current: emptyLayout(),
      incoming: edited,
      idBySource: new Map([["c", "c-new"]]),
      finalIds: ["a", "b", "c-new"],
      mode: "replace",
    });

    expect(Object.keys(restored.nodeStyles ?? {}).sort()).toEqual(["a", "b", "c-new"]);
    expect(restored.nodeStyles?.["c-new"]).toEqual({ form: "card" });
  });

  it("keeps the imported style when merging into an existing canvas", () => {
    const edited = applyBatchStyle(canvas(), ["a"], { size: 1.6 }, ids);
    const merged = mergeImportedLayout({
      current: canvas(),
      incoming: edited,
      idBySource: new Map(),
      finalIds: ids,
      mode: "merge",
    });

    expect(merged.nodeStyles?.a).toEqual({ size: 1.6 });
  });
});

describe("pruning and inheritance", () => {
  it("drops overrides for characters that no longer exist", () => {
    const edited = applyBatchStyle(canvas(), ["a", "b"], { form: "card" }, ids);
    const pruned = pruneLayout(edited, ["a", "d", "e"]);
    expect(Object.keys(pruned.nodeStyles ?? {})).toEqual(["a"]);
  });

  it("removes the override entirely when the batch goes back to inheriting", () => {
    const edited = applyBatchStyle(canvas(), ["a", "b", "c"], { form: "card" }, ids);
    const inherited = applyBatchStyle(edited, ["a", "b", "c"], { form: undefined }, ids);
    expect(inherited.nodeStyles).toEqual({});
  });
});
