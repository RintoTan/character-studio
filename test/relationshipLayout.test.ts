import { describe, expect, it } from "vitest";
import {
  canvasBox,
  canvasScreenScale,
  centreOn,
  contentBounds,
  edgeBends,
  edgeGeometry,
  fitZoom,
  groupBleed,
  labelReadability,
  labelZoomNeeded,
  labelsFitAfter,
  labelsReadable,
  measureNameWidth,
  minimumNodeSpacing,
  nodePositions,
  projectToScreen,
  viewBoxPointAt,
  widestNameHalfWidth,
  type GraphPoint,
} from "../src/pages/RelationshipGraph";
import { defaultGraphPrefs, graphMetrics } from "../src/storage/graphPrefs";
import { groupBounds, GROUP_PADDING } from "../src/storage/relationshipLayout";

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

// The card the canvas actually gets on a desktop window.
const CARD = { width: 1050, height: 520 };

function canvasFor(count: number, metrics = graphMetrics(defaultGraphPrefs)) {
  const positions = nodePositions(count, metrics.radius);
  const box = canvasBox(positions, metrics, widestNameHalfWidth(["沈青梧"], metrics.nameSize));

  return { positions, metrics, box };
}

describe("node labels", () => {
  it("draws names at fit view once the graph is small enough to read them", () => {
    // The defect this replaces: the rule was a zoom factor, and 1.5 was above the zoom
    // a two- to twelve-character graph ever starts at, so the names were simply absent
    // until the author zoomed into a wheel that had been scaled up to fill the card.
    for (const count of [2, 3, 6, 12]) {
      const { positions, metrics, box } = canvasFor(count);

      expect(
        labelsReadable({ positions, nameSize: metrics.nameSize, zoom: 1, scale: canvasScreenScale(CARD, box.viewBox) }),
      ).toBe(true);
    }
  });

  it("hides the names of a large roster at fit, and shows them at the zoom they need", () => {
    const { positions, metrics, box } = canvasFor(100);
    const scale = canvasScreenScale(CARD, box.viewBox);
    const needed = labelZoomNeeded(metrics.nameSize, scale);

    expect(labelsReadable({ positions, nameSize: metrics.nameSize, zoom: 1, scale })).toBe(false);
    expect(labelsReadable({ positions, nameSize: metrics.nameSize, zoom: needed, scale })).toBe(true);
    // Zooming in is what makes a name readable; a hundred of them at fit is a smear,
    // which is why this is a rendered-size decision rather than "always draw them".
    expect(needed).toBeGreaterThan(1);
  });

  it("asks for a larger zoom the more the drawing is shrunk to fit", () => {
    // Same drawing, two canvases: the phone shows less of it, so it needs more zoom
    // before a name is legible. This is the whole difference between the two screens.
    expect(labelZoomNeeded(13, 0.4)).toBeGreaterThan(labelZoomNeeded(13, 2));
  });

  it("never claims a label is readable before the canvas has been measured", () => {
    const { positions, metrics } = canvasFor(3);

    expect(labelsReadable({ positions, nameSize: metrics.nameSize, zoom: 4, scale: 0 })).toBe(false);
  });

  it("draws the name of a lone node", () => {
    const { positions, metrics } = canvasFor(1);

    // One node has no neighbour to collide with, so only its own size can rule it out.
    expect(labelsReadable({ positions, nameSize: metrics.nameSize, zoom: 1, scale: 1 })).toBe(true);
  });

  it("measures the closest pair of nodes, not the average", () => {
    expect(minimumNodeSpacing(nodePositions(1))).toBe(Number.POSITIVE_INFINITY);
    expect(minimumNodeSpacing(nodePositions(2))).toBeCloseTo(2 * 150, 5);
    expect(minimumNodeSpacing([{ x: 0, y: 0 }, { x: 90, y: 0 }, { x: 40, y: 0 }])).toBeCloseTo(40, 5);
  });
});

describe("canvas placement", () => {
  const viewBox = "-100 -50 400 200";
  const rect = { left: 30, top: 12, width: 800, height: 200 };

  it("fits the view box by the axis that runs out first", () => {
    // 400x200 into 800x200: the height is the binding axis, so the drawing is centred
    // horizontally rather than stretched, which is what `meet` does.
    expect(canvasScreenScale(rect, viewBox)).toBeCloseTo(1, 5);
  });

  it("maps a client point into the view box and back again", () => {
    const point = viewBoxPointAt(rect.left + 500, rect.top + 80, rect, viewBox);
    const back = projectToScreen(point, { k: 1, x: 0, y: 0 }, viewBox, rect);

    expect(back.x).toBeCloseTo(rect.left + 500, 5);
    expect(back.y).toBeCloseTo(rect.top + 80, 5);
  });

  it("keeps the point under the cursor when the box and the element disagree in shape", () => {
    // The old arithmetic mapped x and y by their own ratios, which is only equal to the
    // fit when the two have the same proportions. This rect does not, and the point is
    // where the wheel expects to be zooming about.
    const scale = canvasScreenScale(rect, viewBox);
    const point = viewBoxPointAt(rect.left + 100, rect.top + 20, rect, viewBox);

    expect(scale).not.toBeCloseTo(rect.width / 400, 5);
    expect(projectToScreen(point, { k: 1, x: 0, y: 0 }, viewBox, rect).x).toBeCloseTo(
      rect.left + 100,
      5,
    );
  });

  it("centres a node whatever the zoom", () => {
    const node = { x: 320, y: 320 };

    for (const zoom of [1, 2.5, 4]) {
      const view = centreOn(node, zoom, viewBox);
      const projected = projectToScreen(node, view, viewBox, rect);

      expect(projected.x).toBeCloseTo(rect.left + rect.width / 2, 4);
      expect(projected.y).toBeCloseTo(rect.top + rect.height / 2, 4);
    }
  });

  it("counts the pan from the view box, not from the drawing's own origin", () => {
    // A view box that does not start at 0 0 is the normal case here, and treating the
    // box origin as 0 puts the node off by exactly that offset.
    expect(centreOn({ x: 320, y: 320 }, 1, viewBox)).toEqual({ k: 1, x: -220, y: -270 });
  });
});

describe("fitting the canvas to the drawing", () => {
  const frame = { width: 1000, height: 500 };

  it("measures a lone node as its own footprint, not as a spread", () => {
    const bounds = contentBounds([{ x: 320, y: 320 }], graphMetrics(defaultGraphPrefs), 20);

    // One node: no distance to span, so what is left is the node's own radius plus the
    // padding its label needs on either side.
    expect(bounds.width).toBeCloseTo((NODE_RADIUS + 16 + 20) * 2, 4);
    expect(bounds.height).toBeCloseTo(NODE_RADIUS + 16 + NAME_DROP + NAME_SPACE, 4);
  });

  it("matches the box the graph is actually drawn in", () => {
    const positions = nodePositions(5);

    // canvasBox grows its box around this extent, so the fit zoom and the view box have
    // to agree on how large the drawing is.
    const bounds = contentBounds(positions, graphMetrics(defaultGraphPrefs), 40);
    const drawn = canvasBox(positions, graphMetrics(defaultGraphPrefs), 40);
    const [x, y, w, h] = drawn.viewBox.split(" ").map(Number);
    const xs = positions.map((point) => point.x);
    const ys = positions.map((point) => point.y);

    expect(w).toBeGreaterThanOrEqual(bounds.width);
    expect(h).toBeGreaterThanOrEqual(bounds.height);
    expect(x).toBeLessThan(Math.min(...xs));
    expect(y).toBeLessThan(Math.min(...ys));
  });

  it("grows the drawing until it uses the canvas, keeping a margin", () => {
    // 1600x800 units drawn at half size is 800x400 of a 1000x500 frame: the same ratio
    // on both axes, so the fit is 1000/800 less the tenth of margin.
    expect(fitZoom({ width: 1600, height: 800 }, frame, 0.5)).toBeCloseTo(1.125, 4);
  });

  it("lets the tighter axis decide", () => {
    // Wide and tall: the width has room to spare, the height does not.
    expect(fitZoom({ width: 1000, height: 1200 }, frame, 0.3)).toBeCloseTo(1.25, 4);
  });

  it("scales a drawing larger than the frame down until it fits", () => {
    // 4000x400 units at half size is 2000x200 of a 1000x500 frame. The fit has to be
    // 0.45 — with a floor of 1 the canvas showed the middle of a drawing it could not
    // contain, which on a phone was a screen of edges and no nodes.
    const wide = fitZoom({ width: 4000, height: 400 }, frame, 0.5);
    expect(wide).toBeCloseTo(0.45, 4);
    expect(4000 * wide * 0.5).toBeLessThanOrEqual(frame.width);

    // One that fits without the margin keeps its natural size: shrinking it would only
    // put its names under the readable threshold.
    expect(fitZoom({ width: 2000, height: 1000 }, frame, 0.5)).toBe(1);
  });

  it("stops short of filling the frame mechanically", () => {
    // One node on a measured canvas asks for far more than a plate-sized circle.
    expect(fitZoom({ width: 8, height: 8 }, frame, 1)).toBe(1.6);
  });

  it("is the box's fit while nothing has been measured", () => {
    expect(fitZoom({ width: 100, height: 100 }, { width: 0, height: 0 }, 1)).toBe(1);
    expect(fitZoom({ width: 100, height: 100 }, frame, 0)).toBe(1);
    expect(fitZoom({ width: 0, height: 0 }, frame, 1)).toBe(1);
  });
});

describe("groupBleed", () => {
  // What a group's border needs and what the canvas box already reserves: the box
  // leaves room for the widest label, the border stands GROUP_PADDING from its
  // members. The bleed is the shortfall, so the border is never outside the drawing.
  const reserve = (labelHalfWidth: number) => 30 + 16 + labelHalfWidth;

  it("adds nothing when no group is drawn", () => {
    expect(groupBleed(false, { radius: 30, emojiSize: 26, nameSize: 13, nameDrop: 44, nameSpace: 22 }, 0)).toEqual({ x: 0, y: 0 });
  });

  it("covers the border when the labels reserve less than the group padding", () => {
    const metrics = { radius: 30, emojiSize: 26, nameSize: 13, nameDrop: 44, nameSpace: 22 };
    const bleed = groupBleed(true, metrics, 10);

    expect(bleed.x).toBe(GROUP_PADDING + 10 - reserve(10));
    expect(reserve(10) + bleed.x).toBeGreaterThan(GROUP_PADDING);
    // Above and below there is no label to reserve, so the border needs more there.
    expect(bleed.y).toBe(GROUP_PADDING + 10 - (30 + 16));
    expect(bleed.y).toBeGreaterThan(bleed.x);
  });

  it("adds nothing when the widest label already reserves more than the border needs", () => {
    const metrics = { radius: 30, emojiSize: 26, nameSize: 13, nameDrop: 44, nameSpace: 22 };

    expect(groupBleed(true, metrics, 60)).toEqual({ x: 0, y: GROUP_PADDING + 10 - (30 + 16) });
  });

  it("is symmetric, so adding the bleed does not move the centre of the view", () => {
    const metrics = { radius: 30, emojiSize: 26, nameSize: 13, nameDrop: 44, nameSpace: 22 };
    const positions = [
      { x: 0, y: 0 },
      { x: 320, y: 0 },
    ];
    const { viewBox } = canvasBox(positions, metrics, 10);
    const [x, , width] = viewBox.split(" ").map(Number);
    const bleed = groupBleed(true, metrics, 10).x;
    const widenedCentre = x - bleed + (width + bleed * 2) / 2;

    expect(bleed).toBeGreaterThan(0);
    // Growing both sides keeps the drawing where the author left it: only the frame
    // around it changed, which is what stops the view jumping when a group appears.
    expect(widenedCentre).toBeCloseTo(x + width / 2, 6);
    expect(positions).toEqual([
      { x: 0, y: 0 },
      { x: 320, y: 0 },
    ]);
  });

  it("keeps every member inside the rectangle a group draws", () => {
    const layout = {
      positions: { a: { x: 0, y: 0 }, b: { x: 400, y: 260 } },
      groups: [{ id: "g", name: "北境线", characterIds: ["a", "b"] }],
    };
    const rect = groupBounds(layout as never, layout.groups[0] as never);
    const left = Math.min(0, 400);
    const top = Math.min(0, 260);

    expect(rect.x).toBeLessThanOrEqual(left - GROUP_PADDING);
    expect(rect.y).toBeLessThanOrEqual(top - GROUP_PADDING);
    expect(rect.x + rect.width).toBeGreaterThanOrEqual(400 + GROUP_PADDING);
    expect(rect.y + rect.height).toBeGreaterThanOrEqual(260 + GROUP_PADDING);
  });
});

describe("label switch hysteresis", () => {
  it("reads room as a ratio around the point where names fit", () => {
    const { positions, metrics } = canvasFor(3);

    expect(labelReadability({ positions, nameSize: metrics.nameSize, zoom: 1, scale: 1 })).toBeGreaterThan(1);
    expect(labelReadability({ positions, nameSize: metrics.nameSize, zoom: 4, scale: 0 })).toBe(0);
  });

  it("does not flip while the zoom sits on the boundary", () => {
    // Names are on at 1.0; a nudge to 0.95 would turn them off under a single
    // threshold and the wheel would strobe. They only go below 0.9.
    expect(labelsFitAfter(true, 0.95)).toBe(true);
    expect(labelsFitAfter(true, 0.89)).toBe(false);
    expect(labelsFitAfter(false, 0.99)).toBe(false);
    expect(labelsFitAfter(false, 1)).toBe(true);
  });
});
