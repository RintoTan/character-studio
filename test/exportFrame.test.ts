import { describe, expect, it } from "vitest";
import {
  MAX_EXPORT_SIDE,
  clampPan,
  growToAspect,
  manualFrame,
  outputSize,
  projectRect,
} from "../src/utils/exportFrame";

const content = { x: 100, y: 50, width: 400, height: 200 };

describe("export frame", () => {
  it("grows the short side to a ratio without cropping content", () => {
    // 400×200 is wider than 16:9, so the short side (height) grows.
    const wide = growToAspect(content, 16 / 9);
    expect(wide.width).toBeCloseTo(400, 5);
    expect(wide.height).toBeCloseTo(225, 5);
    // The frame grew: it still contains the content.
    expect(wide.y).toBeLessThanOrEqual(content.y);
    expect(wide.y + wide.height).toBeGreaterThanOrEqual(content.y + content.height);
  });

  it("centres the grown frame on the content", () => {
    const tall = growToAspect(content, 1 / 2);
    const cx = tall.x + tall.width / 2;
    expect(cx).toBeCloseTo(content.x + content.width / 2, 5);
    expect(tall.height).toBeCloseTo(800, 5);
  });

  it("keeps content inside a manual frame at 100%", () => {
    const frame = manualFrame({ content, zoom: 1, panX: 0, panY: 0 });
    expect(frame).toEqual(content);
  });

  it("zooms out into a larger frame, never a smaller one", () => {
    const frame = manualFrame({ content, zoom: 0.5, panX: 0, panY: 0 });
    expect(frame.width).toBeCloseTo(800, 5);
    expect(frame.height).toBeCloseTo(400, 5);
    expect(frame.x).toBeLessThan(content.x);
  });

  it("turns a pan into a moved frame, not a moved node", () => {
    const frame = manualFrame({ content, zoom: 2, panX: 30, panY: -10, ratio: 2 });
    const centre = { x: frame.x + frame.width / 2, y: frame.y + frame.height / 2 };
    expect(centre.x).toBeCloseTo(content.x + content.width / 2 + 30, 5);
    expect(centre.y).toBeCloseTo(content.y + content.height / 2 - 10, 5);
    // The content itself is untouched: framing cannot write a coordinate.
    expect(content).toEqual({ x: 100, y: 50, width: 400, height: 200 });
  });

  it("clamps a pan that would push the artwork out of the frame", () => {
    const far = clampPan({ content, panX: 100000, panY: -100000, zoom: 1 });
    const frame = manualFrame({ content, zoom: 1, ...far });
    const overlapX =
      Math.min(frame.x + frame.width, content.x + content.width) - Math.max(frame.x, content.x);
    const overlapY =
      Math.min(frame.y + frame.height, content.y + content.height) - Math.max(frame.y, content.y);
    expect(overlapX).toBeGreaterThan(0);
    expect(overlapY).toBeGreaterThan(0);
    expect(far.panX).toBeLessThan(100000);
  });

  it("reports the pixel size from the requested width and the frame ratio", () => {
    const size = outputSize({ frame: content, width: 1200 });
    expect(size).toEqual({ width: 1200, height: 600, clipped: false, reason: null });
  });

  it("clips a request beyond the side budget and says why", () => {
    const size = outputSize({ frame: content, width: MAX_EXPORT_SIDE * 4 });
    expect(size.clipped).toBe(true);
    expect(Math.max(size.width, size.height)).toBeLessThanOrEqual(MAX_EXPORT_SIDE);
    expect(size.reason).toContain("内存上限");
  });

  it("clips a request beyond the total pixel budget", () => {
    const tall = { x: 0, y: 0, width: 100, height: 400 };
    const size = outputSize({ frame: tall, width: 8000 });
    expect(size.clipped).toBe(true);
    expect(size.width * size.height).toBeLessThanOrEqual(40_000_000);
  });

  it("projects the content into a preview box using the frame, not a second guess", () => {
    const frame = { x: 0, y: 0, width: 800, height: 400 };
    const box = { width: 400, height: 400 };
    const projected = projectRect({ x: 200, y: 100, width: 400, height: 200 }, frame, box);
    expect(projected).toEqual({ x: 100, y: 50, width: 200, height: 100 });
  });
});
