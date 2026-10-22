import { describe, expect, it } from "vitest";
import { chooseLabelOffset, dashArrayFor, edgeInk, measureNameWidth, wrapNameLines } from "../src/pages/RelationshipGraph";
import { DEFAULT_KIND_COLORS, normalizeCanvasStyle } from "../src/storage/canvasStyle";

const widthOf = (lines: string[], size: number) => lines.map((line) => measureNameWidth(line, size));

describe("a name wraps inside its node", () => {
  it("keeps a short name on one line", () => {
    expect(wrapNameLines("沈砚", 140, 14)).toEqual(["沈砚"]);
  });

  it("breaks a twelve-character Chinese name into two measured lines", () => {
    const lines = wrapNameLines("沈砚与北境的守夜人记录官", 140, 14);

    expect(lines).toHaveLength(2);
    expect(lines.join("")).toBe("沈砚与北境的守夜人记录官");
    widthOf(lines, 14).forEach((width) => expect(width).toBeLessThanOrEqual(140));
  });

  it("prefers a space when a Latin name must break", () => {
    const lines = wrapNameLines("Alexander the Nightwatchman", 150, 14);

    expect(lines).toHaveLength(2);
    expect(lines[0].endsWith("Alexander") || lines[0].endsWith("Alexander the")).toBe(true);
    expect(lines[1].startsWith("the") || lines[1].startsWith("Nightwatchman")).toBe(true);
  });

  it("shortens what still does not fit instead of running past the node", () => {
    const name = "极其漫长而且完全无法完整显示的角色名称用于测试省略";
    const lines = wrapNameLines(name, 100, 14, 2);

    expect(lines).toHaveLength(2);
    expect(lines[1].endsWith("…")).toBe(true);
    widthOf(lines, 14).forEach((width) => expect(width).toBeLessThanOrEqual(100));
  });

  it("never returns an empty first line", () => {
    expect(wrapNameLines("", 100, 14)).toEqual([]);
    expect(wrapNameLines("名", 0, 14)).toEqual(["名"]);
  });
});

describe("a relationship label steps off what it covers", () => {
  const label = { width: 30, height: 14 };

  it("stays put when the spot is free", () => {
    const placement = chooseLabelOffset(100, 100, 0, 1, label.width, label.height, []);

    expect(placement).toEqual({ x: 100, y: 100 });
  });

  it("steps off a node frame that occupies the midpoint, staying on its wire", () => {
    // The wire runs horizontally at y=100, so its normal is vertical.
    const obstacle = { x: 60, y: 80, width: 80, height: 40 };
    const placement = chooseLabelOffset(100, 100, 0, 1, label.width, label.height, [obstacle]);

    const overlaps =
      placement.x < obstacle.x + obstacle.width &&
      placement.x + label.width > obstacle.x &&
      placement.y < obstacle.y + obstacle.height &&
      placement.y + label.height > obstacle.y;

    expect(overlaps).toBe(false);
    // Still near its own wire: one short step, not a jump across the drawing.
    expect(Math.abs(placement.y - 100)).toBeLessThanOrEqual(40);
    expect(placement.x).toBe(100);
  });

  it("steps sideways when both above and below are taken", () => {
    // A narrow block over the midpoint leaves room to either side of the wire.
    const placement = chooseLabelOffset(100, 100, 1, 0, label.width, label.height, [
      { x: 88, y: 70, width: 24, height: 60 },
    ]);

    expect(placement.x).not.toBe(100);
    expect(Math.abs(placement.x - 100)).toBeLessThanOrEqual(60);
  });

  it("falls back to the original spot rather than leaving the wire", () => {
    const everywhere = [
      { x: -1000, y: -1000, width: 3000, height: 3000 },
    ];

    expect(chooseLabelOffset(100, 100, 0, 1, label.width, label.height, everywhere)).toEqual({
      x: 100,
      y: 100,
    });
  });
});

describe("one ink rule for the canvas and every legend", () => {
  const style = (overrides: Record<string, unknown> = {}) =>
    ({
      edge: {
        byKind: true,
        color: "#7b87a8",
        width: 1.4,
        dash: "solid" as const,
        arrow: "concise" as const,
        arrowSize: 1,
        ...overrides,
      },
    }) as never;

  it("gives each kind its own colour when colouring by type", () => {
    const friend = edgeInk("friend", style());
    const rival = edgeInk("rival", style());

    expect(friend.color).not.toBe(rival.color);
  });

  it("uses one colour for every kind when colouring is off", () => {
    const single = style({ byKind: false, color: "#334155" });

    expect(edgeInk("friend", single).color).toBe("#334155");
    expect(edgeInk("rival", single).color).toBe("#334155");
  });

  it("lets a local override win without changing the style", () => {
    expect(edgeInk("friend", style(), { color: "#ff0000", width: 3 }).color).toBe("#ff0000");
    expect(edgeInk("friend", style(), { width: 3 }).width).toBe(3);
  });

  it("draws the same dash patterns the canvas uses", () => {
    expect(dashArrayFor("solid")).toBeUndefined();
    expect(dashArrayFor("dashed")).toBe("7 5");
    expect(dashArrayFor("dotted")).toBe("2 4");
  });
});

// ---------------------------------------------------------------------------
// Ink priority: single line > canvas style > preset > built-in default.
// One reader (`edgeInk`), so the canvas and the export cannot disagree.
// ---------------------------------------------------------------------------
describe("relationship ink", () => {
  const styleWith = (edge: Record<string, unknown> = {}) =>
    normalizeCanvasStyle({ preset: "classic", edge });

  it("uses the single canvas colour when colour-by-kind is off", () => {
    const ink = edgeInk("enemy", styleWith({ color: "#123456", byKind: false }));
    expect(ink.color).toBe("#123456");
  });

  it("uses the kind palette when colour-by-kind is on", () => {
    const ink = edgeInk("enemy", styleWith({ byKind: true }));
    expect(ink.color).toBe(DEFAULT_KIND_COLORS.enemy);
    expect(ink.color).not.toBe(DEFAULT_KIND_COLORS.family);
  });

  it("lets an author rewrite one kind without touching the others", () => {
    const ink = edgeInk("enemy", styleWith({ byKind: true, kindColors: { enemy: "#ff0000" } }));
    expect(ink.color).toBe("#ff0000");
    expect(edgeInk("family", styleWith({ byKind: true, kindColors: { enemy: "#ff0000" } })).color).toBe(
      DEFAULT_KIND_COLORS.family,
    );
  });

  it("a single line overrides colour, width, dash and opacity together", () => {
    const global = styleWith({ color: "#111111", width: 1, dash: "solid", opacity: 0.5 });
    const ink = edgeInk("friend", global, { color: "#222222", width: 4, dash: "dotted", opacity: 1 });
    expect(ink).toEqual({ color: "#222222", width: 4, dash: "dotted", opacity: 1 });
  });

  it("a line that overrides nothing keeps inheriting the canvas", () => {
    const global = styleWith({ color: "#111111", width: 2.2, dash: "dashed", opacity: 0.6 });
    expect(edgeInk("friend", global, { width: 3 })).toEqual({
      color: "#111111",
      width: 3,
      dash: "dashed",
      opacity: 0.6,
    });
  });

  it("drops unreadable per-kind colours instead of painting a blank line", () => {
    const style = styleWith({ byKind: true, kindColors: { enemy: "not-a-colour", family: "#abcdef" } });
    expect(style.edge.kindColors).toEqual({ family: "#abcdef" });
    expect(edgeInk("enemy", style).color).toBe(DEFAULT_KIND_COLORS.enemy);
  });

  it("clamps opacity and keeps an old style readable", () => {
    expect(styleWith({ opacity: 0 }).edge.opacity).toBe(0.2);
    expect(styleWith({ opacity: 9 }).edge.opacity).toBe(1);
    expect(styleWith({}).edge.opacity).toBe(1);
    expect(styleWith({}).edge.kindColors).toEqual({});
  });
});
