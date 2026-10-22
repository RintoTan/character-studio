import { describe, expect, it } from "vitest";
import { canvasScreenScale, projectToScreen, viewBoxPointAt } from "../src/pages/RelationshipGraph";

const VIEW_BOX = "0 0 1000 800";
const RECT = { left: 120, top: 40, width: 800, height: 640 };

describe("world ↔ screen mapping", () => {
  it("round-trips a world point through the view", () => {
    const view = { k: 1.4, x: -120, y: 60 };
    const point = { x: 320, y: 240 };
    const screen = projectToScreen(point, view, VIEW_BOX, RECT);
    const back = viewBoxPointAt(screen.x, screen.y, RECT, VIEW_BOX);

    // viewBoxPointAt returns the point in the drawing's frame, which is where the
    // node was drawn: p * k + view.
    expect(back.x).toBeCloseTo(point.x * view.k + view.x, 5);
    expect(back.y).toBeCloseTo(point.y * view.k + view.y, 5);
  });

  it("moves a node by exactly the pixels its view x is shifted by", () => {
    const view = { k: 0.5, x: 0, y: 0 };
    const point = { x: 200, y: 100 };
    const scale = canvasScreenScale(RECT, VIEW_BOX);
    const before = projectToScreen(point, view, VIEW_BOX, RECT);
    const after = projectToScreen(point, { ...view, x: view.x + 40 / scale }, VIEW_BOX, RECT);

    // This is the drawer compensation: a pan of 40 screen pixels, no zoom change.
    expect(after.x - before.x).toBeCloseTo(40, 5);
    expect(after.y - before.y).toBeCloseTo(0, 5);
  });

  it("keeps the centre of a fitted view in the middle of the frame", () => {
    // centreOn(500, 400) for this viewBox is { k: 1, x: 0, y: 0 }.
    const view = { k: 1, x: 0, y: 0 };
    const centre = projectToScreen({ x: 500, y: 400 }, view, VIEW_BOX, RECT);

    expect(centre.x).toBeCloseTo(RECT.left + RECT.width / 2, 5);
    expect(centre.y).toBeCloseTo(RECT.top + RECT.height / 2, 5);
  });
});
