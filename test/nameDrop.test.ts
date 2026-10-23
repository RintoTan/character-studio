// The label's air used to be 14 *world* units, so at the 0.13x a phone fits a hundred
// nodes at it cleared the node by 1.8 screen pixels and the selected name sat on the
// node — while a node at 0.69x had a comfortable gap. The air is a screen distance now.
import { describe, expect, it } from "vitest";
import { nameDropWorld } from "../src/utils/labelDensity";

const halfHeight = 34; // 40 nodes at 0.69x
const nameDrop = 61; // the style's own gap, world units

describe("a name keeps a constant screen gap under its node", () => {
  it("clears the node by more than the type's own ascent", () => {
    const drop = nameDropWorld({ halfHeight, nameDrop, pxPerUnit: 0.13 });
    const baselineGap = (drop - halfHeight) * 0.13;
    // A lifted name is 11px tall, so its box reaches 8.8px above the baseline.
    expect(baselineGap).toBeGreaterThan(0.8 * 11);
    expect(baselineGap).toBeCloseTo(15, 5);
  });

  it("never gives less than ten pixels, and keeps a larger style gap", () => {
    for (const pxPerUnit of [0.29, 0.69]) {
      const air = (nameDropWorld({ halfHeight, nameDrop, pxPerUnit }) - halfHeight) * pxPerUnit;
      expect(air).toBeGreaterThanOrEqual(15 - 1e-6);
    }
  });

  it("leaves the reading-zoom placement alone", () => {
    // At 0.69x the style's own 61-unit gap wins, exactly as before this change.
    expect(nameDropWorld({ halfHeight, nameDrop, pxPerUnit: 0.69 })).toBeCloseTo(
      Math.max(nameDrop, halfHeight + 14),
      1,
    );
  });

  it("never pulls a name closer than the style asks for", () => {
    // A style with a bigger gap keeps it: the screen air is a floor, not a replacement.
    const drop = nameDropWorld({ halfHeight: 10, nameDrop: 61, pxPerUnit: 1 });
    expect(drop - 10).toBeCloseTo(51, 5);
  });

  it("survives a zero scale", () => {
    expect(Number.isFinite(nameDropWorld({ halfHeight, nameDrop, pxPerUnit: 0 }))).toBe(true);
  });
});
