import { describe, expect, it } from "vitest";
import { applyBatchStyle, batchTargets, mergeNodeValue, mergeValues, nodeOverrides } from "../src/utils/batchStyle";
import { DEFAULT_CANVAS_STYLE } from "../src/storage/canvasStyle";
import { emptyLayout, type CanvasLayout } from "../src/storage/relationshipLayout";

const canvas = DEFAULT_CANVAS_STYLE.node;

const base = (): CanvasLayout => ({
  ...emptyLayout(),
  positions: { a: { x: 1, y: 2 }, b: { x: 3, y: 4 }, c: { x: 5, y: 6 }, d: { x: 7, y: 8 } },
  members: ["a", "b", "c", "d"],
  nodeStyles: { a: { background: "#111" }, b: { background: "#222" } },
});

describe("mergeValues", () => {
  it("reports one shared value", () => {
    expect(mergeValues([2, 2, 2])).toEqual({ value: 2, mixed: false, count: 3 });
  });

  it("reports a mixture instead of picking one", () => {
    expect(mergeValues([2, 2, 3])).toEqual({ value: undefined, mixed: true, count: 3 });
  });

  it("ignores undefined so inheritance is not a value", () => {
    expect(mergeValues([undefined, "#333", undefined])).toEqual({ value: "#333", mixed: false, count: 1 });
  });

  it("has no value for an empty set", () => {
    expect(mergeValues([])).toEqual({ value: undefined, mixed: false, count: 0 });
  });
});

describe("applyBatchStyle", () => {
  it("writes only the picked nodes", () => {
    const next = applyBatchStyle(base(), ["a", "b"], { size: 1.4 });
    expect(next.nodeStyles?.a.size).toBe(1.4);
    expect(next.nodeStyles?.b.size).toBe(1.4);
    expect(next.nodeStyles?.c).toBeUndefined();
    expect(next.nodeStyles?.d).toBeUndefined();
  });

  it("leaves fields the patch does not mention alone", () => {
    const next = applyBatchStyle(base(), ["a"], { size: 1.2 });
    expect(next.nodeStyles?.a).toEqual({ background: "#111", size: 1.2 });
  });

  it("never writes the canvas-wide style", () => {
    const before = base();
    const next = applyBatchStyle(before, ["a", "b"], { background: "#000" });
    expect(next.style).toBe(before.style);
    expect(next.nodeStyles?.a.background).toBe("#000");
    expect(next.nodeStyles?.b.background).toBe("#000");
  });

  it("keeps positions, members and groups by reference", () => {
    const before = base();
    const next = applyBatchStyle(before, ["a"], { size: 1.1 });
    expect(next.positions).toBe(before.positions);
    expect(next.members).toBe(before.members);
    expect(next.groups).toBe(before.groups);
  });

  it("treats undefined as 恢复继承 and drops the key", () => {
    const next = applyBatchStyle(base(), ["a"], { background: undefined });
    expect(next.nodeStyles?.a).toBeUndefined();
    expect(next.nodeStyles?.b).toEqual({ background: "#222" });
  });

  it("keeps an override on one key while clearing another", () => {
    const next = applyBatchStyle(base(), ["a"], { background: undefined, size: 1.3 });
    expect(next.nodeStyles?.a).toEqual({ size: 1.3 });
  });

  it("is safe with no selection", () => {
    const before = base();
    expect(applyBatchStyle(before, [], { size: 2 })).toBe(before);
  });

  it("is safe with ids that are not on the canvas", () => {
    const before = base();
    expect(applyBatchStyle(before, ["", "ghost"], { size: 1.5 }, ["a", "b", "c", "d"])).toBe(before);
    expect(before.nodeStyles?.ghost).toBeUndefined();
  });

  it("returns the same object when nothing actually changes", () => {
    const before = base();
    expect(applyBatchStyle(before, ["a"], { background: "#111" })).toBe(before);
  });
});

describe("what a selection has in common", () => {
  it("reads overrides over the canvas value", () => {
    const layout = base();
    expect(mergeNodeValue(layout, ["a", "c"], "background", canvas).mixed).toBe(true);
    // b overrides, c inherits: two different resolved values, so no shared answer.
    expect(mergeNodeValue(layout, ["b", "c"], "background", canvas).mixed).toBe(true);
    expect(mergeNodeValue(layout, ["b"], "background", canvas).value).toBe("#222");
    expect(mergeNodeValue(layout, ["c", "d"], "background", canvas).value).toBe(canvas.background);
  });

  it("knows which nodes carry their own value", () => {
    const layout = base();
    expect(nodeOverrides(layout, "a", "background")).toBe(true);
    expect(nodeOverrides(layout, "c", "background")).toBe(false);
  });

  it("filters ids the canvas does not know", () => {
    expect(batchTargets(["a", "x", "a", ""], (id) => id !== "x")).toEqual(["a"]);
  });
});
