import { describe, expect, it } from "vitest";
import { canvasBox, nodePositions, type GraphPoint } from "../src/pages/RelationshipGraph";

const NODE_RADIUS = 30;
const NAME_DROP = 44;
const NAME_SPACE = 22;

function box(positions: GraphPoint[]) {
  const { viewBox, width } = canvasBox(positions);
  const [x, y, w, h] = viewBox.split(" ").map(Number);

  return { x, y, w, h, width };
}

describe("relationship graph layout", () => {
  it("draws nothing for no characters", () => {
    expect(nodePositions(0)).toEqual([]);
    expect(canvasBox([]).width).toBe(640);
  });

  it("puts a lone node in the middle instead of at the top of the wheel", () => {
    expect(nodePositions(1)).toEqual([{ x: 320, y: 320 }]);
  });

  it("places a pair side by side", () => {
    const [first, second] = nodePositions(2);

    expect(first.y).toBe(second.y);
    expect(second.x - first.x).toBe(300);
    expect(Math.abs(first.x - 320)).toBe(Math.abs(second.x - 320));
  });

  it("keeps the wheel for three or more, evenly spaced on the radius", () => {
    const points = nodePositions(6);

    expect(points).toHaveLength(6);
    expect(new Set(points.map((point) => `${point.x},${point.y}`)).size).toBe(6);
    for (const point of points) {
      const distance = Math.hypot(point.x - 320, point.y - 320);
      expect(distance).toBeCloseTo(236, 5);
    }
  });

  it("stops reserving a 640 square for a two-node graph", () => {
    const pair = box(nodePositions(2));

    expect(pair.width).toBeLessThan(640);
    expect(pair.h).toBeLessThan(240);
    // The pair used to span 472 units vertically; side by side it spans none.
    expect(pair.h).toBeLessThan(box(nodePositions(6)).h);
  });

  it("never lets a node or its label fall outside the canvas", () => {
    for (const count of [1, 2, 3, 6, 12]) {
      const positions = nodePositions(count);
      const { x, y, w, h } = box(positions);

      // The viewBox is rounded to two decimals for the DOM, which is the only
      // reason these are compared with a tolerance rather than exactly.
      const epsilon = 0.01;
      for (const point of positions) {
        expect(point.x - NODE_RADIUS).toBeGreaterThanOrEqual(x - epsilon);
        expect(point.x + NODE_RADIUS).toBeLessThanOrEqual(x + w + epsilon);
        expect(point.y - NODE_RADIUS).toBeGreaterThanOrEqual(y - epsilon);
        expect(point.y + NAME_DROP + NAME_SPACE).toBeLessThanOrEqual(y + h + epsilon);
      }
    }
  });

  it("keeps a minimum box so a small graph is not a stamp", () => {
    expect(canvasBox(nodePositions(1))).toEqual({
      viewBox: "160 240 320 180",
      width: 320,
    });
  });
});
