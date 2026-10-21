import { describe, expect, it } from "vitest";
import { planLegend, type LegendBox } from "../src/utils/exportLegend";

const bounds = { x: 0, y: 0, width: 1000, height: 800 };

function overlap(a: LegendBox, b: LegendBox) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

describe("export legend placement", () => {
  it("picks the corner with nothing under it", () => {
    // Everything sits top-left; the free corner is bottom-right.
    const nodes: LegendBox[] = [{ x: 0, y: 0, width: 400, height: 300 }];
    const plan = planLegend({ bounds, rowCount: 4, nodes });

    // Any corner that does not sit on the node is a correct answer; what matters is
    // that it is one of them and that the picture did not have to grow.
    expect(["tr", "br"]).toContain(plan.corner);
    expect(plan.extra).toEqual({ left: 0, right: 0, top: 0, bottom: 0 });
    expect(plan.panel.x + plan.panel.width).toBeLessThanOrEqual(bounds.width + 1);
    expect(plan.panel.y + plan.panel.height).toBeLessThanOrEqual(bounds.height + 1);
  });

  it("leaves the picture alone when a named corner is already free", () => {
    const plan = planLegend({ bounds, rowCount: 3, nodes: [], corner: "tr" });
    expect(plan.corner).toBe("tr");
    expect(plan.extra).toEqual({ left: 0, right: 0, top: 0, bottom: 0 });
  });

  it("adds a margin instead of printing over the drawing when every corner is busy", () => {
    const cover: LegendBox = { x: 0, y: 0, width: 1000, height: 800 };
    const plan = planLegend({ bounds, rowCount: 5, nodes: [cover], corner: "tl" });

    const grown = {
      x: bounds.x - plan.extra.left,
      y: bounds.y - plan.extra.top,
      width: bounds.width + plan.extra.left + plan.extra.right,
      height: bounds.height + plan.extra.top + plan.extra.bottom,
    };
    expect(plan.extra.left + plan.extra.top).toBeGreaterThan(0);
    // The panel sits inside the grown frame, and the grown frame contains the old one.
    expect(plan.panel.x).toBeGreaterThanOrEqual(grown.x);
    expect(plan.panel.x + plan.panel.width).toBeLessThanOrEqual(grown.x + grown.width);
    expect(plan.panel.y + plan.panel.height).toBeLessThanOrEqual(grown.y + grown.height);
    expect(grown.x).toBeLessThanOrEqual(bounds.x);
    expect(grown.y).toBeLessThanOrEqual(bounds.y);
  });

  it("scales with the picture so a 1:1 export and a poster read alike", () => {
    const small = planLegend({ bounds: { x: 0, y: 0, width: 400, height: 400 }, rowCount: 4, nodes: [] });
    const large = planLegend({ bounds: { x: 0, y: 0, width: 2400, height: 2400 }, rowCount: 4, nodes: [] });

    expect(large.panel.width / small.panel.width).toBeGreaterThan(3);
    expect(small.panel.width / 400).toBeGreaterThan(0.15);
    expect(large.panel.width / 2400).toBeLessThan(0.45);
  });

  it("does not let a busy corner go unnoticed by the automatic choice", () => {
    const nodes: LegendBox[] = [
      { x: 0, y: 0, width: 500, height: 400 },
      { x: 500, y: 0, width: 500, height: 400 },
      { x: 0, y: 400, width: 500, height: 400 },
    ];
    const plan = planLegend({ bounds, rowCount: 4, nodes });
    expect(plan.corner).toBe("br");

    const panel = plan.panel;
    expect(nodes.some((node) => overlap(node, panel))).toBe(false);
  });
});
