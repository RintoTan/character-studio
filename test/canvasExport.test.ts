import { describe, expect, it } from "vitest";
import {
  MAX_EXPORT_SIDE,
  aspectBounds,
  boundsOfPoints,
  exportPixelSize,
  parseViewBox,
  scopeBounds,
} from "../src/utils/canvasExport";

describe("canvas export bounds", () => {
  it("wraps every point with the padding the nodes and labels need", () => {
    const bounds = boundsOfPoints(
      [
        { x: 100, y: 100 },
        { x: 300, y: 260 },
      ],
      40,
    );

    expect(bounds).toEqual({ x: 60, y: 60, width: 280, height: 240 });
  });

  it("answers null for an empty drawing rather than a zero-sized canvas", () => {
    expect(boundsOfPoints([], 40)).toBeNull();
  });

  it("keeps a single node from collapsing to a point", () => {
    const bounds = boundsOfPoints([{ x: 5, y: 5 }], 0);
    expect(bounds).toEqual({ x: 5, y: 5, width: 1, height: 1 });
  });

  it("reads a view box and rejects nonsense", () => {
    expect(parseViewBox("-20 -10 640 480")).toEqual({ x: -20, y: -10, width: 640, height: 480 });
    expect(parseViewBox("0 0 0 480")).toBeNull();
    expect(parseViewBox("nope")).toBeNull();
  });

  it("takes 当前视图 from the view box, not from the nodes", () => {
    const bounds = scopeBounds({
      scope: "view",
      allPoints: [{ x: 0, y: 0 }],
      selectedPoints: [{ x: 0, y: 0 }],
      viewBox: "10 20 300 200",
      padding: 50,
    });

    expect(bounds).toEqual({ x: 10, y: 20, width: 300, height: 200 });
  });

  it("takes 全部内容 from every node, so zooming out or in cannot change it", () => {
    const all = [
      { x: -400, y: -200 },
      { x: 600, y: 500 },
    ];
    const narrowView = "0 0 100 100";
    const wideView = "-2000 -2000 4000 4000";

    const narrow = scopeBounds({
      scope: "all",
      allPoints: all,
      selectedPoints: [],
      viewBox: narrowView,
      padding: 30,
    });
    const wide = scopeBounds({
      scope: "all",
      allPoints: all,
      selectedPoints: [],
      viewBox: wideView,
      padding: 30,
    });

    expect(narrow).toEqual(wide);
    expect(narrow).toEqual({ x: -430, y: -230, width: 1060, height: 760 });
  });

  it("takes 选中区域 from the selection and refuses an empty one", () => {
    const selected = scopeBounds({
      scope: "selection",
      allPoints: [
        { x: 0, y: 0 },
        { x: 900, y: 900 },
      ],
      selectedPoints: [
        { x: 100, y: 100 },
        { x: 200, y: 160 },
      ],
      viewBox: "0 0 640 480",
      padding: 20,
    });

    expect(selected).toEqual({ x: 80, y: 80, width: 140, height: 100 });

    expect(
      scopeBounds({
        scope: "selection",
        allPoints: [{ x: 0, y: 0 }],
        selectedPoints: [],
        viewBox: "0 0 640 480",
        padding: 20,
      }),
    ).toBeNull();
  });
});

describe("canvas export pixel size", () => {
  it("scales the bounds by the requested factor", () => {
    expect(exportPixelSize({ x: 0, y: 0, width: 800, height: 400 }, 2)).toEqual({
      width: 1600,
      height: 800,
      scale: 2,
    });
  });

  it("caps the longest side instead of asking for a canvas the browser cannot make", () => {
    const size = exportPixelSize({ x: 0, y: 0, width: 12000, height: 6000 }, 3);

    expect(size.width).toBe(MAX_EXPORT_SIDE);
    expect(size.height).toBe(Math.round(MAX_EXPORT_SIDE / 2));
    expect(size.scale).toBeLessThan(3);
  });

  it("never returns a zero-sized picture", () => {
    const size = exportPixelSize({ x: 0, y: 0, width: 1, height: 1 }, 0);
    expect(size.width).toBeGreaterThanOrEqual(1);
    expect(size.height).toBeGreaterThanOrEqual(1);
    expect(size.scale).toBeGreaterThan(0);
  });
});

describe("aspectBounds", () => {
  const wide = { x: 0, y: 0, width: 400, height: 200 };

  it("leaves the drawing alone when no ratio is asked for", () => {
    expect(aspectBounds(wide, 0)).toEqual(wide);
  });

  it("grows the short side to reach a taller frame, and keeps the centre", () => {
    const framed = aspectBounds(wide, 1);
    expect(framed.width / framed.height).toBeCloseTo(1, 3);
    expect(framed.x + framed.width / 2).toBeCloseTo(wide.x + wide.width / 2, 3);
    expect(framed.y + framed.height / 2).toBeCloseTo(wide.y + wide.height / 2, 3);
  });

  it("grows the width for a wider frame without cropping height", () => {
    const framed = aspectBounds(wide, 16 / 9);
    expect(framed.width / framed.height).toBeCloseTo(16 / 9, 3);
    expect(framed.height).toBeGreaterThanOrEqual(wide.height);
  });

  it("does not shrink a frame that already matches", () => {
    const square = { x: 10, y: 10, width: 300, height: 300 };
    expect(aspectBounds(square, 1)).toEqual(square);
  });
});
