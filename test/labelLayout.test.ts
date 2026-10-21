import { describe, expect, it } from "vitest";
import { chooseLabelOffset, measureNameWidth, wrapNameLines } from "../src/pages/RelationshipGraph";

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
