import { describe, expect, it } from "vitest";
import {
  MEMBER_PLACEMENT_GAP,
  addMembers,
  normalizeMembers,
  placeNewPoints,
  removeMembers,
} from "../src/utils/canvasMembers";

const ring = Object.fromEntries(
  Array.from({ length: 8 }, (_, index) => {
    const angle = (index / 8) * Math.PI * 2;
    return [`c${index}`, { x: Math.round(Math.cos(angle) * 200), y: Math.round(Math.sin(angle) * 200) }];
  }),
);

describe("canvas membership", () => {
  it("keeps known ids, drops unknown and duplicate ones, and treats a missing list as legacy", () => {
    expect(normalizeMembers(["a", "b", "a", "gone"], ["a", "b", "c"])).toEqual(["a", "b"]);
    expect(normalizeMembers(undefined, ["a"])).toBeUndefined();
    expect(normalizeMembers("a", ["a"])).toBeUndefined();
  });

  it("adds and removes without touching the order of the rest", () => {
    expect(addMembers(["a", "b"], ["b", "c"])).toEqual(["a", "b", "c"]);
    expect(removeMembers(["a", "b", "c"], ["b"])).toEqual(["a", "c"]);
  });

  it("places a new member outside everything already placed, far from every node", () => {
    const added = placeNewPoints(ring, ["new"]);
    const point = added.new;
    expect(point).toBeDefined();
    for (const other of Object.values(ring)) {
      expect(Math.hypot(point.x - other.x, point.y - other.y)).toBeGreaterThan(60);
    }
    const radius = Math.hypot(point.x, point.y);
    expect(radius).toBeGreaterThan(200);
  });

  it("gives several new members distinct spots and leaves existing coordinates alone", () => {
    const before = JSON.stringify(ring);
    const added = placeNewPoints(ring, ["a1", "a2", "a3"]);
    expect(Object.keys(added)).toHaveLength(3);
    const points = Object.values(added);
    for (let i = 0; i < points.length; i += 1) {
      for (let j = i + 1; j < points.length; j += 1) {
        expect(Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y)).toBeGreaterThan(40);
      }
    }
    expect(JSON.stringify(ring)).toBe(before);
    expect(MEMBER_PLACEMENT_GAP).toBeGreaterThan(0);
  });

  it("places nothing when the canvas has no coordinates yet", () => {
    expect(placeNewPoints({}, ["a"])).toEqual({});
  });
});
