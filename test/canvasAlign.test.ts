import { describe, expect, it } from "vitest";
import {
  alignPositions,
  distributePositions,
  nodeStateClass,
  pruneSelection,
  spreadPositions,
  type AlignBox,
} from "../src/utils/canvasAlign";

const card = (id: string, x: number, y: number): AlignBox => ({ id, x, y, halfWidth: 84, halfHeight: 28 });
const circle = (id: string, x: number, y: number): AlignBox => ({ id, x, y, halfWidth: 20, halfHeight: 20 });

describe("alignment on drawn boxes", () => {
  it("lines up left edges, not centres, when the forms differ", () => {
    const out = alignPositions([card("a", 0, 0), circle("b", 300, 100)], "x", "start");

    expect(out).not.toBeNull();
    // Both left edges sit at -84, so the small node's centre has to move past it.
    expect(out!.a - 84).toBeCloseTo(-84, 5);
    expect(out!.b - 20).toBeCloseTo(-84, 5);
    expect(out!.b).not.toBeCloseTo(out!.a, 1);
  });

  it("lines up right edges", () => {
    const out = alignPositions([card("a", 0, 0), circle("b", 300, 0)], "x", "end");

    expect(out!.a + 84).toBeCloseTo(320, 5);
    expect(out!.b + 20).toBeCloseTo(320, 5);
  });

  it("centres on the middle of the selection's own box", () => {
    const out = alignPositions([card("a", 0, 0), circle("b", 300, 0)], "x", "center");
    const centreLine = (-84 + 320) / 2;

    expect(out!.a).toBeCloseTo(centreLine, 5);
    expect(out!.b).toBeCloseTo(centreLine, 5);
  });

  it("uses the vertical box for top and bottom edges", () => {
    const out = alignPositions([card("a", 0, 0), circle("b", 0, 400)], "y", "start");

    expect(out!.a - 28).toBeCloseTo(-28, 5);
    expect(out!.b - 20).toBeCloseTo(-28, 5);
  });

  it("refuses to invent an alignment for one node", () => {
    expect(alignPositions([circle("a", 0, 0)], "x", "start")).toBeNull();
  });

  it("returns nothing when the nodes already line up, so undo stays empty", () => {
    expect(alignPositions([circle("a", 10, 0), circle("b", 10, 40)], "x", "start")).toBeNull();
  });
});

describe("distribution", () => {
  it("leaves equal gaps between the drawn boxes", () => {
    const boxes = [card("a", 0, 0), circle("b", 300, 0), card("c", 900, 0)];
    const out = distributePositions(boxes, "x")!;
    const lefts = [
      out.a - 84,
      out.b - 20,
      out.c - 84,
    ];
    const rights = [out.a + 84, out.b + 20, out.c + 84];

    expect(lefts[1] - rights[0]).toBeCloseTo(lefts[2] - rights[1], 5);
  });

  it("keeps the two ends where they were", () => {
    const out = distributePositions([card("a", 0, 0), circle("b", 300, 0), card("c", 900, 0)], "x")!;

    expect(out.a).toBeCloseTo(0, 5);
    expect(out.c).toBeCloseTo(900, 5);
  });

  it("needs three nodes", () => {
    expect(distributePositions([circle("a", 0, 0), circle("b", 100, 0)], "x")).toBeNull();
  });

  it("reports no room when the boxes already fill the span", () => {
    expect(distributePositions([circle("a", 0, 0), circle("b", 40, 0), circle("c", 80, 0)], "x")).toBeNull();
  });

  it("falls back to equal centre spacing", () => {
    const out = spreadPositions([circle("a", 0, 0), circle("b", 40, 0), circle("c", 80, 0)], "x")!;

    expect(out.a).toBeCloseTo(0, 5);
    expect(out.b).toBeCloseTo(40, 5);
    expect(out.c).toBeCloseTo(80, 5);
  });
});

describe("selection hygiene", () => {
  it("drops ids whose character is gone", () => {
    expect(pruneSelection(["a", "b", "c"], ["a", "c"])).toEqual(["a", "c"]);
  });

  it("keeps the same array when nothing was dangling", () => {
    const selected = ["a", "b"];
    expect(pruneSelection(selected, ["a", "b", "c"])).toBe(selected);
  });
});

describe("node state priority", () => {
  it("never lets a hover dim the node that is selected", () => {
    const state = nodeStateClass({
      selected: true,
      focused: false,
      hovered: false,
      outsideSpotlight: false,
      dimmedByHover: true,
    });

    expect(state).toContain("selected");
    expect(state).not.toContain("dimmed");
  });

  it("marks a hover separately from a pick", () => {
    expect(nodeStateClass({ selected: false, focused: false, hovered: true, outsideSpotlight: false, dimmedByHover: false })).toBe(
      "relationship-node active",
    );
  });

  it("keeps the pick visible inside a spotlight", () => {
    const state = nodeStateClass({ selected: true, focused: false, hovered: false, outsideSpotlight: true, dimmedByHover: false });

    expect(state).toContain("spotlight-dim");
    expect(state).toContain("selected");
  });

  it("does not dress dimming up as selection", () => {
    expect(nodeStateClass({ selected: false, focused: false, hovered: false, outsideSpotlight: true, dimmedByHover: false })).toBe(
      "relationship-node spotlight-dim",
    );
  });
});
