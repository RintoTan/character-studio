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

function place(
  bounds: LegendBounds,
  width: number,
  height: number,
  corner: Exclude<LegendCorner, "auto">,
  margin: number,
): LegendBox {
  const pad = Math.min(bounds.width, bounds.height) * Math.max(0, margin);
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
  /** Multiplies the panel's type size. 1 is the drawing's own scale. */
  scale?: number;
  /** Inner padding as a fraction of the picture's short side. */
  margin?: number;
  /** A hand-placed offset, in drawing units. */
  nudge?: { x: number; y: number };
}): LegendPlan {
  const { bounds, rowCount, nodes, corner = "auto", scale = 1, margin = 0.02 } = input;
  const unit = Math.min(bounds.width, bounds.height);
  const size = Math.max(0.5, Math.min(2.2, scale));
  const rowHeight = Math.max(12, Math.min(unit * 0.055, unit / (rowCount + 3))) * size;
  const width = Math.max(unit * 0.2, rowHeight * 6.4);
  const height = rowHeight * (rowCount + 0.9);

  const counts = CORNERS.map((candidate) => {
    const box = place(bounds, width, height, candidate, margin);
    return { corner: candidate, box, covered: nodes.filter((node) => overlaps(node, box)).length };
  });

  const chosen =
    corner === "auto"
      ? [...counts].sort((a, b) => a.covered - b.covered)[0]
      : counts.find((entry) => entry.corner === corner)!;

  // Every corner covers something: give the panel a margin of its own rather than
  // printing it on top of the drawing.
  if (chosen.covered > 0) {
    // Not `margin`: that name is the padding fraction, and shadowing it here put the
    // panel a whole picture outside the frame the first time this grew a margin.
    const grow = height * 1.15;
    const extra = { left: 0, right: 0, top: 0, bottom: 0 };
    if (chosen.corner === "tl" || chosen.corner === "bl") {
      extra.left = grow;
    } else {
      extra.right = grow;
    }
    if (chosen.corner === "tl" || chosen.corner === "tr") {
      extra.top = grow;
    } else {
      extra.bottom = grow;
    }

    // The drawing keeps its coordinates; only the exported frame grows, so the panel
    // lands in the new margin instead of on a node.
    const grown: LegendBounds = {
      x: bounds.x - extra.left,
      y: bounds.y - extra.top,
      width: bounds.width + extra.left + extra.right,
      height: bounds.height + extra.top + extra.bottom,
    };

    const withMargin = {
      corner: chosen.corner,
      extra,
      panel: place(grown, width, height, chosen.corner, margin),
    };

    return input.nudge ? nudgeLegend(withMargin, grown, input.nudge) : withMargin;
  }

  const settled = { corner: chosen.corner, extra: { left: 0, right: 0, top: 0, bottom: 0 }, panel: chosen.box };
  return input.nudge ? nudgeLegend(settled, bounds, input.nudge) : settled;
}

/**
 * Move a planned panel by hand and keep it inside the picture.
 *
 * Corner placement is a good default and a poor editor: the author can see that the
 * only free space is a strip in the middle. A nudge is expressed in drawing units so
 * it survives zoom, and the panel is clamped so it can never leave the exported
 * rectangle. When the panel is placed by hand the frame stops growing for it — the
 * margin existed only to give an automatic corner somewhere safe to sit.
 */
export function nudgeLegend(
  plan: LegendPlan,
  bounds: LegendBounds,
  nudge: { x: number; y: number },
): LegendPlan {
  if (!nudge.x && !nudge.y) {
    return plan;
  }

  const pad = Math.min(bounds.width, bounds.height) * 0.01;
  const minX = bounds.x + pad;
  const maxX = bounds.x + bounds.width - pad - plan.panel.width;
  const minY = bounds.y + pad;
  const maxY = bounds.y + bounds.height - pad - plan.panel.height;

  return {
    corner: plan.corner,
    // The margin stays. Dropping it here would shrink the frame on the first pixel of
    // the drag, which both jumps the preview and moves the ground under the pointer.
    extra: plan.extra,
    panel: {
      ...plan.panel,
      x: Math.min(Math.max(plan.panel.x + nudge.x, minX), Math.max(minX, maxX)),
      y: Math.min(Math.max(plan.panel.y + nudge.y, minY), Math.max(minY, maxY)),
    },
  };
}
