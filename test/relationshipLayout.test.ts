import { describe, expect, it } from "vitest";
import {
  canvasBox,
  edgeBends,
  edgeGeometry,
  labelZoomThreshold,
  measureNameWidth,
  nodePositions,
  widestNameHalfWidth,
  type GraphPoint,
} from "../src/pages/RelationshipGraph";
import { graphMetrics } from "../src/storage/graphPrefs";

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

  it("grows the ring with the roster so a hundred nodes stop overlapping", () => {
    for (const count of [30, 112]) {
      const points = nodePositions(count);
      const radius = Math.hypot(points[0].x - 320, points[0].y - 320);
      // Distance between two neighbours along the arc.
      const spacing = (2 * Math.PI * radius) / count;

      // On the old fixed 236 radius, 112 characters sat 13.2 units apart while each
      // node is 60 units across.
      expect(spacing).toBeGreaterThanOrEqual(60);
      expect(points).toHaveLength(count);
    }
  });

  it("asks for more zoom before showing names as the roster grows", () => {
    expect(labelZoomThreshold(12)).toBe(1.5);
    expect(labelZoomThreshold(60)).toBe(1.5);
    expect(labelZoomThreshold(112)).toBeCloseTo(2.8, 5);
    expect(labelZoomThreshold(112)).toBeGreaterThan(labelZoomThreshold(40));
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

describe("name measurement", () => {
  it("measures a CJK name at a full em per character", () => {
    expect(measureNameWidth("沈青梧", 13)).toBeCloseTo(39, 5);
    // Five full-width characters plus the narrow "·" separator between them.
    expect(measureNameWidth("文森特·梵高", 13)).toBeCloseTo(5 * 13 + 0.55 * 13, 5);
  });

  it("measures Latin and digits at about half an em", () => {
    expect(measureNameWidth("Al", 13)).toBeCloseTo(14.3, 5);
    expect(measureNameWidth("", 13)).toBe(0);
  });

  it("takes the widest of the names it is given", () => {
    expect(widestNameHalfWidth(["闻人雪", "顾寒声"], 13)).toBeCloseTo(19.5, 5);
    expect(widestNameHalfWidth([], 13)).toBe(0);
  });
});

describe("canvas box versus names", () => {
  const half = widestNameHalfWidth(["文森特·梵高"], 13);

  function dims(boxed: { viewBox: string }) {
    const [x, y, w, h] = boxed.viewBox.split(" ").map(Number);

    return { x, y, w, h };
  }

  it("grows sideways once a label is wider than the node it belongs to", () => {
    const ring = nodePositions(6);
    const plain = dims(canvasBox(ring));
    const named = dims(canvasBox(ring, undefined, half));

    expect(named.w).toBeGreaterThan(plain.w);
    // Vertically it is the reserved name drop, not the label's width, that decides.
    expect(named.h).toBe(plain.h);
  });

  it("never lets a centred name overhang the canvas, at any roster size", () => {
    // This is the two-sided clipping: the outermost nodes of a wheel are exactly
    // where a centred label overhangs the edge of the drawing.
    for (const count of [2, 3, 6, 12, 30]) {
      const positions = nodePositions(count);
      const { x, w } = dims(canvasBox(positions, undefined, half));

      for (const point of positions) {
        expect(point.x - half).toBeGreaterThanOrEqual(x - 0.01);
        expect(point.x + half).toBeLessThanOrEqual(x + w + 0.01);
      }
    }
  });
});

describe("edge geometry", () => {
  const from: GraphPoint = { x: 170, y: 320 };
  const to: GraphPoint = { x: 470, y: 320 };
  const metrics = graphMetrics({ avatarSize: "medium", nameSize: "medium" });
  const rim = { start: from.x + metrics.radius + 2, end: to.x - metrics.radius - 3 };

  it("runs rim to rim instead of centre to centre", () => {
    expect(edgeGeometry(from, to, { metrics }).path).toBe(
      `M ${rim.start} 320 L ${rim.end} 320`,
    );
  });

  it("keeps the kind label clear of the stroke it names", () => {
    const edge = edgeGeometry(from, to, { metrics });

    // The chord runs along y = 320; the label is set well off it, so a 2px stroke
    // cannot pass through the glyphs.
    expect(Math.abs(edge.labelY - 320)).toBeGreaterThanOrEqual(10);
    expect(edge.labelX).toBeCloseTo((rim.start + rim.end) / 2, 1);
  });

  it("draws no arrow head for a symmetric relationship", () => {
    expect(edgeGeometry(from, to, { metrics, symmetrical: true }).arrow).toBeNull();
    expect(edgeGeometry(from, to, { metrics }).arrow).not.toBeNull();
  });

  it("aims the arrow head at the target node", () => {
    const tip = edgeGeometry(from, to, { metrics }).arrow?.split(" ")[0].split(",").map(Number);

    expect(tip?.[0]).toBeCloseTo(rim.end, 1);
    expect(tip?.[1]).toBeCloseTo(320, 1);
  });

  it("bulges a bent edge and reads its label from the outside", () => {
    const straight = edgeGeometry(from, to, { metrics });
    const bent = edgeGeometry(from, to, { metrics, bend: 1 });

    expect(bent.path).toContain("Q");
    // The left normal of a left-to-right edge points down in SVG, so a positive
    // bend and its label both end up below the chord.
    expect(bent.labelY).toBeGreaterThan(straight.labelY);
  });

  it("reserves no bend for a pair with a single edge", () => {
    const bends = edgeBends([{ id: "ab", fromId: "a", toId: "b" }]);

    expect(bends.get("ab")).toBe(0);
  });

  it("fans reciprocal edges onto opposite sides of the same chord", () => {
    const bends = edgeBends([
      { id: "ab", fromId: "a", toId: "b" },
      { id: "ba", fromId: "b", toId: "a" },
    ]);
    const forward = edgeGeometry(from, to, { bend: bends.get("ab") as number, metrics });
    const backward = edgeGeometry(to, from, { bend: bends.get("ba") as number, metrics });

    expect(bends.get("ab")).not.toBe(0);
    // Stored the other way round, each edge still bulges clear of the other: without
    // mirroring the bend to the pair's own order both normals flip and the two edges
    // land on the same side again, which is the overlap this exists to remove.
    expect(Math.sign(forward.labelY - 320)).not.toBe(Math.sign(backward.labelY - 320));
  });

  it("fans three edges of one pair apart, leaving the middle one straight", () => {
    const bends = edgeBends([
      { id: "ab", fromId: "a", toId: "b" },
      { id: "ba", fromId: "b", toId: "a" },
      { id: "ab2", fromId: "a", toId: "b" },
    ]);

    // The middle edge of three stays on the chord; the outer two take opposite sides.
    expect(bends.get("ba")).toBe(0);
    expect(Math.sign(bends.get("ab") as number)).toBe(-Math.sign(bends.get("ab2") as number));
  });
});
