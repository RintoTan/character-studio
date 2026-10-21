import { describe, expect, it } from "vitest";
import {
  computePinchPan,
  pinchView,
  shouldStartDrag,
  toggleSelectionItem,
  translateMemberPositions,
} from "../src/utils/touchGestures";

describe("mobile touch gestures & multi-selection", () => {
  it("initializes pinch state cleanly on first two-finger frame", () => {
    const first = { x: 100, y: 100 };
    const second = { x: 200, y: 100 };
    const { state, delta } = computePinchPan(null, first, second);

    expect(state.distance).toBe(100);
    expect(state.centerX).toBe(150);
    expect(state.centerY).toBe(100);
    expect(delta).toBeNull();
  });

  it("calculates zoom factor and mid-point translation simultaneously", () => {
    const prev = { distance: 100, centerX: 150, centerY: 100 };
    // Fingers spread apart (distance 100 -> 150) and both shift right by 20px
    const first = { x: 95, y: 100 };
    const second = { x: 245, y: 100 };
    const { state, delta } = computePinchPan(prev, first, second);

    expect(state.distance).toBe(150);
    expect(state.centerX).toBe(170);
    expect(delta).not.toBeNull();
    expect(delta?.factor).toBe(1.5);
    expect(delta?.dx).toBe(20);
    expect(delta?.dy).toBe(0);
  });

  it("ignores zero or negative distance without producing NaN", () => {
    const prev = { distance: 0, centerX: 50, centerY: 50 };
    const first = { x: 50, y: 50 };
    const second = { x: 50, y: 50 };
    const { state, delta } = computePinchPan(prev, first, second);

    expect(state.distance).toBe(0);
    expect(delta).toBeNull();
  });

  it("applies proper jitter thresholds for touch vs mouse drags", () => {
    // 5px movement: mouse triggers drag (>4), touch is suppressed (<=8)
    expect(shouldStartDrag(3, 4, "mouse")).toBe(true);
    expect(shouldStartDrag(3, 4, "touch")).toBe(false);

    // 10px movement: both trigger intentional drag
    expect(shouldStartDrag(6, 8, "touch")).toBe(true);
  });

  describe("pinchView: one atomic update for zoom + pan", () => {
    const clamp = (k: number) => Math.min(Math.max(k, 0.3), 3);
    const start = { k: 1, x: 40, y: 20 };

    it("moves the drawing when only the midpoint moves", () => {
      const next = pinchView(start, { x: 100, y: 100 }, { x: 130, y: 80 }, 1, clamp);

      expect(next.k).toBe(1);
      expect(next.x).toBe(70);
      expect(next.y).toBe(0);
    });

    it("keeps the anchored point still when only the distance changes", () => {
      const anchor = { x: 120, y: 90 };
      const next = pinchView(start, anchor, anchor, 2, clamp);

      expect(next.k).toBe(2);
      // The content point under the anchor must still sit under it.
      expect(next.x).toBe(120 - (120 - 40) * 2);
      expect(next.y).toBe(90 - (90 - 20) * 2);
    });

    it("composes zoom and midpoint movement without doubling the pan", () => {
      const from = { x: 100, y: 100 };
      const to = { x: 140, y: 100 };
      const next = pinchView(start, from, to, 2, clamp);

      expect(next.k).toBe(2);
      // Zoom-about-from, then exactly one (to - from) shift.
      expect(next.x).toBe(from.x - (from.x - start.x) * 2 + 40);
      expect(next.y).toBe(from.y - (from.y - start.y) * 2);
    });

    it("clamps the zoom without letting the anchor drift", () => {
      const anchor = { x: 50, y: 50 };
      const next = pinchView({ k: 2.9, x: 0, y: 0 }, anchor, anchor, 4, clamp);

      expect(next.k).toBe(3);
      expect(next.x).toBe(anchor.x - anchor.x * (3 / 2.9));
    });

    it("is a no-op when nothing changed", () => {
      const anchor = { x: 10, y: 10 };
      expect(pinchView(start, anchor, anchor, 1, clamp)).toEqual(start);
    });
  });

  it("toggles items in additive multi-select mode", () => {
    expect(toggleSelectionItem([], "a", true)).toEqual(["a"]);
    expect(toggleSelectionItem(["a"], "b", true)).toEqual(["a", "b"]);
    expect(toggleSelectionItem(["a", "b"], "a", true)).toEqual(["b"]);
  });

  it("replaces selection when not in additive mode", () => {
    expect(toggleSelectionItem(["a", "b"], "c", false)).toEqual(["c"]);
  });

  it("translates multiple member positions uniformly without altering unselected items", () => {
    const base = {
      a: { x: 10, y: 20 },
      b: { x: 50, y: 60 },
      c: { x: 100, y: 200 },
    };
    const translated = translateMemberPositions(base, ["a", "b"], { x: 5.5, y: -2.3 });

    expect(translated.a).toEqual({ x: 15.5, y: 17.7 });
    expect(translated.b).toEqual({ x: 55.5, y: 57.7 });
    // c was not a member, must remain unchanged
    expect(translated.c).toEqual({ x: 100, y: 200 });
  });
});
