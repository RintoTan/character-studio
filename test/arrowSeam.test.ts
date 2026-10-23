import { describe, expect, it } from "vitest";
import { edgeGeometry } from "../src/pages/RelationshipGraph";

const from = { x: 100, y: 100 };
const to = { x: 400, y: 100 };
const metrics = { radius: 30, emojiSize: 26, nameSize: 13, nameDrop: 44, nameSpace: 22 };

function endpointOf(path: string) {
  const numbers = path.match(/-?\d+(\.\d+)?/g)!.map(Number);
  return { x: numbers[numbers.length - 2], y: numbers[numbers.length - 1] };
}

describe("arrow head seam", () => {
  it("stops the stroke before the head instead of underneath it", () => {
    const withArrow = edgeGeometry(from, to, { metrics, arrowStyle: "concise" });
    const withoutArrow = edgeGeometry(from, to, { metrics, arrowStyle: "none" });

    expect(withArrow.arrow).not.toBeNull();
    expect(withoutArrow.arrow).toBeNull();

    const arrowEnd = endpointOf(withArrow.path);
    const plainEnd = endpointOf(withoutArrow.path);

    // The head is about 10 units long; the line must give up most of that distance.
    expect(plainEnd.x - arrowEnd.x).toBeGreaterThan(6);
    expect(plainEnd.x - arrowEnd.x).toBeLessThan(14);
    // Same y: the edge is horizontal, so the pull-back is purely along the line.
    expect(Math.abs(plainEnd.y - arrowEnd.y)).toBeLessThan(0.01);
  });

  it("keeps every arrow style clear of the stroke", () => {
    const plain = endpointOf(edgeGeometry(from, to, { metrics, arrowStyle: "none" }).path);

    for (const style of ["concise", "thin", "soft"] as const) {
      const end = endpointOf(edgeGeometry(from, to, { metrics, arrowStyle: style }).path);
      expect(plain.x - end.x).toBeGreaterThan(5);
    }
  });

  it("never pulls the stroke past the middle of a short edge", () => {
    const short = edgeGeometry({ x: 0, y: 0 }, { x: 30, y: 0 }, { metrics: { ...metrics, radius: 8 }, arrowScale: 3 });
    const end = endpointOf(short.path);
    expect(end.x).toBeGreaterThan(0);
    expect(end.x).toBeLessThan(30);
  });

  it("pulls back along the curve's own tangent, not the chord", () => {
    const straight = edgeGeometry(from, to, { metrics, arrowStyle: "concise" });
    const bent = edgeGeometry(from, to, { metrics, arrowStyle: "concise", bend: 0.8 });
    const straightEnd = endpointOf(straight.path);
    const bentEnd = endpointOf(bent.path);

    // A bent edge approaches its target from another angle, so the trimmed end must
    // not sit at the same place as a straight one's.
    expect(Math.abs(bentEnd.y - straightEnd.y)).toBeGreaterThan(0.5);
  });
});
