// The coordinate space was measured, not assumed: at a 0.13x fit the label's
// `getScreenCTM()` is scale 0.1287 with a fixed translate, and a controlled 100-unit
// shift of its `y` moved the box by exactly 13px. Labels, node centres and `positions`
// therefore share one space, and the clearance can be written as `airPx / pxPerUnit`.
import { describe, expect, it } from "vitest";
import { radialNamePlacement } from "../src/utils/namePlacement";

const ring = { x: 320, y: 0 };
const base = {
  centre: ring,
  halfWidth: 54,
  halfHeight: 54,
  isCard: false,
  pxPerUnit: 0.13,
  fontSize: 11 / 0.13,
  labelWidth: 40,
};

describe("a selected name goes outward from the wheel's centre", () => {
  it("sits above a node at the top, clear of its body", () => {
    const node = { x: 320, y: -921 };
    const placement = radialNamePlacement({ ...base, node });

    expect(placement.side).toBe("up");
    expect(placement.textAnchor).toBe("middle");
    // 8 screen pixels of air, expressed in world units at this zoom.
    expect(node.y - placement.y).toBeCloseTo(54 + 8 / 0.13, 5);
  });

  it("sits below a node at the bottom", () => {
    const node = { x: 320, y: 921 };
    const placement = radialNamePlacement({ ...base, node });

    expect(placement.side).toBe("down");
    expect(placement.y - node.y).toBeGreaterThan(54 + 8 / 0.13);
  });

  it("sits beside a node on the left and on the right", () => {
    const left = radialNamePlacement({ ...base, node: { x: -600, y: 0 } });
    const right = radialNamePlacement({ ...base, node: { x: 1240, y: 0 } });

    expect(left.side).toBe("left");
    expect(left.textAnchor).toBe("end");
    expect(-600 - left.x).toBeCloseTo(54 + 8 / 0.13, 5);

    expect(right.side).toBe("right");
    expect(right.textAnchor).toBe("start");
    expect(right.x - 1240).toBeCloseTo(54 + 8 / 0.13, 5);
  });

  it("measures the clearance in screen pixels at every zoom", () => {
    for (const pxPerUnit of [0.13, 0.29, 0.69]) {
      const node = { x: 320, y: -921 };
      const placement = radialNamePlacement({ ...base, node, pxPerUnit, fontSize: 11 / pxPerUnit });
      expect((node.y - placement.y - 54) * pxPerUnit).toBeCloseTo(8, 5);
    }
  });

  it("uses the card's own edge, not its height", () => {
    const node = { x: -600, y: 0 };
    const placement = radialNamePlacement({ ...base, node, isCard: true, halfWidth: 120, halfHeight: 24 });

    expect(placement.side).toBe("left");
    expect(-600 - placement.x).toBeCloseTo(120 + 8 / 0.13, 5);
  });

  it("falls back to below the node when it sits on the centre", () => {
    const placement = radialNamePlacement({ ...base, node: { x: 320, y: 0 } });

    expect(placement.side).toBe("down");
  });
});

describe("a name that would leave the canvas moves instead of clipping", () => {
  const bounds = { x0: -1300, y0: -900, x1: 1940, y1: 900 };

  it("keeps an outward name inside the top edge by flipping it", () => {
    const node = { x: 320, y: -890 };
    const placement = radialNamePlacement({ ...base, node, bounds });

    // Above this node there is no room for a 14px label, so it hangs below instead.
    expect(placement.side).toBe("down");
    expect(placement.y).toBeGreaterThan(node.y);
  });

  it("keeps a sideways name inside the right edge", () => {
    const node = { x: 1900, y: 0 };
    const placement = radialNamePlacement({ ...base, node, bounds, labelWidth: 300 });
    // A sideways label is anchored at its near edge, so the far edge is what has to fit.
    const far = placement.textAnchor === "start" ? placement.x + 300 : placement.x;

    expect(far).toBeLessThanOrEqual(bounds.x1 + 1);
  });

  it("leaves an outward name that already fits untouched", () => {
    const node = { x: 320, y: -600 };
    const placement = radialNamePlacement({ ...base, node, bounds });

    expect(placement.side).toBe("up");
    expect(node.y - placement.y).toBeCloseTo(54 + 8 / 0.13, 5);
  });
});
