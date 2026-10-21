import { describe, expect, it } from "vitest";
import {
  AVATAR_ROUND_MAX,
  AVATAR_ROUND_MIN,
  avatarFrame,
  avatarShapeFor,
  nodeGeometry,
} from "../src/pages/RelationshipGraph";
import { normalizeCanvasStyle, DEFAULT_CANVAS_STYLE } from "../src/storage/canvasStyle";

describe("avatar shape", () => {
  it("keeps a near-square picture round and gives a long one a rounded frame", () => {
    expect(avatarShapeFor("auto", 1)).toBe("circle");
    expect(avatarShapeFor("auto", AVATAR_ROUND_MIN)).toBe("circle");
    expect(avatarShapeFor("auto", AVATAR_ROUND_MAX)).toBe("circle");
    // 3:4 portrait and 3:1 panorama are both outside the band.
    expect(avatarShapeFor("auto", 0.75)).toBe("rounded");
    expect(avatarShapeFor("auto", 3)).toBe("rounded");
  });

  it("lets the author override the measurement in both directions", () => {
    expect(avatarShapeFor("circle", 0.4)).toBe("circle");
    expect(avatarShapeFor("rounded", 1)).toBe("rounded");
  });

  it("stays circular until the picture has actually loaded", () => {
    // A missing or unreadable ratio is not evidence of a wide picture.
    expect(avatarShapeFor("auto", undefined)).toBe("circle");
    expect(avatarShapeFor(undefined, Number.NaN)).toBe("circle");
    expect(avatarShapeFor("auto", 0)).toBe("circle");
  });

  it("sizes a rounded frame by the picture without letting a panorama become a strip", () => {
    const circle = avatarFrame("circle", 30);
    expect(circle.halfWidth).toBe(30);
    expect(circle.halfHeight).toBe(30);
    expect(circle.rx).toBe(30);

    const portrait = avatarFrame("rounded", 30, 0.5);
    expect(portrait.halfHeight).toBeCloseTo(34.8, 1);
    expect(portrait.halfWidth).toBeCloseTo(34.8 * 0.62, 1);

    // Clamped at 0.62: the frame stops narrowing even for a 4:1 picture.
    const extreme = avatarFrame("rounded", 30, 0.25);
    expect(extreme.halfWidth).toBeCloseTo(34.8 * 0.62, 1);

    const wide = avatarFrame("rounded", 30, 2.4);
    expect(wide.halfWidth).toBeCloseTo(34.8, 1);
    expect(wide.halfHeight).toBeCloseTo(34.8 / 1.7, 1);
    // Corners are a share of the short side, never larger than it.
    expect(wide.rx).toBeLessThan(wide.halfHeight);
  });

  it("gives the drawing and the edges one geometry", () => {
    const metrics = { radius: 30, emojiSize: 26, nameDrop: 46, nameSpace: 16 } as never;
    const rounded = nodeGeometry("avatar", metrics, 1, { shape: "rounded", ratio: 0.6 });
    expect(rounded.rounded).toBe(true);
    expect(rounded.card).toBe(false);
    expect(rounded.halfWidth).not.toBe(rounded.radius);
    expect(rounded.halfHeight).toBeGreaterThan(rounded.radius);

    const circle = nodeGeometry("avatar", metrics, 1, { shape: "circle", ratio: 0.6 });
    expect(circle.rounded).toBe(false);
    expect(circle.halfWidth).toBe(circle.radius);

    // Compact nodes are dots; a frame would be a different object.
    const compact = nodeGeometry("compact", metrics, 1, { shape: "rounded", ratio: 0.6 });
    expect(compact.rounded).toBe(false);
  });
});

describe("avatar shape storage", () => {
  it("defaults to auto and keeps an explicit choice", () => {
    expect(DEFAULT_CANVAS_STYLE.node.avatarShape).toBe("auto");
    expect(normalizeCanvasStyle({ node: { avatarShape: "rounded" } }).node.avatarShape).toBe("rounded");
    // A record written before the option existed must not arrive as an empty string.
    expect(normalizeCanvasStyle({ node: { avatarShape: "" as never } }).node.avatarShape).toBe("auto");
    expect(normalizeCanvasStyle({ node: {} }).node.avatarShape).toBe("auto");
  });
});
