import { describe, expect, it } from "vitest";
import { readableNameSize } from "../src/utils/labelDensity";

describe("a name at low zoom", () => {
  it("keeps scaling for ordinary nodes", () => {
    expect(readableNameSize({ nameSize: 14, pxPerUnit: 0.28, pinned: false })).toBe(14);
  });

  it("lifts a selected name to a fixed screen size", () => {
    // 14 world units at 0.28 px/unit is a 3.9px smudge; the pinned name becomes 11px.
    const size = readableNameSize({ nameSize: 14, pxPerUnit: 0.28, pinned: true });
    expect(size * 0.28).toBeCloseTo(11, 5);
  });

  it("leaves a pinned name alone once it is already legible", () => {
    expect(readableNameSize({ nameSize: 14, pxPerUnit: 1.2, pinned: true })).toBe(14);
  });

  it("does not shrink a name that is already larger than the floor", () => {
    expect(readableNameSize({ nameSize: 30, pxPerUnit: 0.5, pinned: true })).toBe(30);
  });
});
