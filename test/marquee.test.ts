import { describe, expect, it } from "vitest";
import { dragRect, isMarquee, marqueeHits } from "../src/utils/marquee";
import { popoverPosition } from "../src/utils/popover";

const box = (left: number, top: number, right: number, bottom: number) => ({ left, top, right, bottom });

describe("marquee hit rule", () => {
  it("selects a node whose centre is inside", () => {
    expect(marqueeHits(box(10, 10, 30, 30), box(0, 0, 100, 100))).toBe(true);
  });

  it("ignores a node that only overlaps at its edge", () => {
    // Centre at (110, 20): the box reaches into the marquee, the centre does not.
    expect(marqueeHits(box(100, 10, 120, 30), box(0, 0, 100, 100))).toBe(false);
  });

  it("is the same rectangle whichever way the drag went", () => {
    expect(dragRect(100, 80, 20, 10)).toEqual(box(20, 10, 100, 80));
  });

  it("needs a real distance before it counts as a rectangle", () => {
    expect(isMarquee(dragRect(10, 10, 12, 12))).toBe(false);
    expect(isMarquee(dragRect(10, 10, 60, 40))).toBe(true);
  });
});

describe("appearance panel placement", () => {
  const viewport = { width: 1440, height: 900 };

  it("opens below the trigger, right edges aligned", () => {
    const placed = popoverPosition({ top: 120, left: 900, right: 980, bottom: 150 }, { width: 340, height: 420 }, viewport);

    expect(placed.side).toBe("below");
    expect(placed.left).toBe(640);
    expect(placed.top).toBe(158);
  });

  it("flips above when the trigger is near the bottom", () => {
    const placed = popoverPosition({ top: 840, left: 900, right: 980, bottom: 870 }, { width: 340, height: 420 }, viewport);

    expect(placed.side).toBe("above");
    expect(placed.top).toBeGreaterThanOrEqual(12);
    expect(placed.top + placed.maxHeight).toBeLessThanOrEqual(840);
  });

  it("never leaves the viewport horizontally", () => {
    const placed = popoverPosition({ top: 100, left: 8, right: 60, bottom: 130 }, { width: 340, height: 400 }, viewport);

    expect(placed.left).toBeGreaterThanOrEqual(12);
    expect(placed.left + 340).toBeLessThanOrEqual(viewport.width);
  });

  it("shrinks instead of hanging off a short screen", () => {
    const placed = popoverPosition({ top: 260, left: 100, right: 180, bottom: 290 }, { width: 340, height: 560 }, { width: 375, height: 600 });

    expect(placed.maxHeight).toBeLessThanOrEqual(600 - 24);
    expect(placed.top + placed.maxHeight).toBeLessThanOrEqual(588);
  });
});
