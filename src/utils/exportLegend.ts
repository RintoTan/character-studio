// Where the relationship legend goes in an exported picture.
//
// The legend is part of the artwork, not of the editor: it must not sit on a node, a
// name or the only line connecting two people. Four corners, and an automatic choice
// that counts what each corner would cover. When every corner is busy the picture gets
// a margin instead — adding room is honest, painting over the graph is not.

export type LegendBounds = { x: number; y: number; width: number; height: number };
export type LegendBox = { x: number; y: number; width: number; height: number };
export type LegendCorner = "auto" | "tl" | "tr" | "bl" | "br";

export type LegendPlan = {
  panel: LegendBox;
  /** Extra drawing units added around the bounds so the panel sits in its own margin. */
  extra: { left: number; right: number; top: number; bottom: number };
  corner: Exclude<LegendCorner, "auto">;
};

const CORNERS: Array<Exclude<LegendCorner, "auto">> = ["tl", "tr", "bl", "br"];

function overlaps(a: LegendBox, b: LegendBox): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

function place(bounds: LegendBounds, width: number, height: number, corner: Exclude<LegendCorner, "auto">): LegendBox {
  const pad = Math.min(bounds.width, bounds.height) * 0.02;
  const left = bounds.x + pad;
  const right = bounds.x + bounds.width - pad - width;
  const top = bounds.y + pad;
  const bottom = bounds.y + bounds.height - pad - height;

  return {
    x: corner === "tl" || corner === "bl" ? left : right,
    y: corner === "tl" || corner === "tr" ? top : bottom,
    width,
    height,
  };
}

/**
 * Chooses a corner and, if all four are occupied, the margin the panel needs.
 *
 * `nodes` are the frames of everything that will be drawn, in export coordinates. The
 * panel is sized from the picture, so the same layout reads the same at 1:1 and 9:16.
 */
export function planLegend(input: {
  bounds: LegendBounds;
  rowCount: number;
  nodes: LegendBox[];
  corner?: LegendCorner;
}): LegendPlan {
  const { bounds, rowCount, nodes, corner = "auto" } = input;
  const unit = Math.min(bounds.width, bounds.height);
  const rowHeight = Math.max(12, Math.min(unit * 0.055, unit / (rowCount + 3)));
  const width = Math.max(unit * 0.2, rowHeight * 6.4);
  const height = rowHeight * (rowCount + 0.9);

  const counts = CORNERS.map((candidate) => {
    const box = place(bounds, width, height, candidate);
    return { corner: candidate, box, covered: nodes.filter((node) => overlaps(node, box)).length };
  });

  const chosen =
    corner === "auto"
      ? [...counts].sort((a, b) => a.covered - b.covered)[0]
      : counts.find((entry) => entry.corner === corner)!;

  // Every corner covers something: give the panel a margin of its own rather than
  // printing it on top of the drawing.
  if (chosen.covered > 0) {
    const margin = height * 1.15;
    const extra = { left: 0, right: 0, top: 0, bottom: 0 };
    if (chosen.corner === "tl" || chosen.corner === "bl") {
      extra.left = margin;
    } else {
      extra.right = margin;
    }
    if (chosen.corner === "tl" || chosen.corner === "tr") {
      extra.top = margin;
    } else {
      extra.bottom = margin;
    }

    // The drawing keeps its coordinates; only the exported frame grows, so the panel
    // lands in the new margin instead of on a node.
    const grown: LegendBounds = {
      x: bounds.x - extra.left,
      y: bounds.y - extra.top,
      width: bounds.width + extra.left + extra.right,
      height: bounds.height + extra.top + extra.bottom,
    };

    return {
      corner: chosen.corner,
      extra,
      panel: place(grown, width, height, chosen.corner),
    };
  }

  return { corner: chosen.corner, extra: { left: 0, right: 0, top: 0, bottom: 0 }, panel: chosen.box };
}
