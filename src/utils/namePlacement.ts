// Where a selected name sits, in world units.
//
// The coordinate space was measured rather than assumed: the label's `getScreenCTM()`
// at a 0.13x fit is scale 0.1287 with a fixed translate, and moving its `y` attribute by
// a controlled 100 units moved the rendered box by exactly 13 px. So labels, node
// centres and `positions` share one space, and px-per-unit is the same factor the type
// is sized with. That is what makes an outward placement expressible at all.
//
// A name hangs outside the wheel rather than under its node: at a 0.13x fit the
// neighbours are 13px apart, so a 40px-wide label below the node lands on them, while
// the space outside the ring is empty by construction.

export type PlacementPoint = { x: number; y: number };

export type PlacementBounds = { x0: number; y0: number; x1: number; y1: number };

export type Placement = {
  x: number;
  y: number;
  textAnchor: "middle" | "start" | "end";
  side: "up" | "down" | "left" | "right";
};

/** Screen pixels of air between the node's body and the label's box. */
const AIR_PX = 8;
/** How much of a label's box sits above its baseline, as a fraction of the font size. */
const ASCENT = 0.8;

/**
 * Place a name on the far side of its node, measured from the middle of the drawing.
 *
 * Falls back to `{ side: "down" }` for a node sitting on that middle (there is no
 * outward direction), and flips to the opposite side only when the outward box would
 * leave the visible area and the opposite one has room.
 */
export function radialNamePlacement(options: {
  node: PlacementPoint;
  centre: PlacementPoint;
  halfWidth: number;
  halfHeight: number;
  isCard: boolean;
  pxPerUnit: number;
  /** Drawn name size, in world units. */
  fontSize: number;
  /** Widest line, in world units — needed to keep the box inside `bounds`. */
  labelWidth: number;
  lines?: number;
  airPx?: number;
  bounds?: PlacementBounds;
}): Placement {
  const scale = Math.max(options.pxPerUnit, 0.0001);
  const air = (options.airPx ?? AIR_PX) / scale;
  const lines = Math.max(options.lines ?? 1, 1);
  const lineHeight = options.fontSize * 1.2;
  const boxHeight = options.fontSize * ASCENT + (lines - 1) * lineHeight;
  const boxWidth = Math.max(options.labelWidth, options.fontSize);

  const dx = options.node.x - options.centre.x;
  const dy = options.node.y - options.centre.y;

  const place = (side: Placement["side"]): Placement => {
    const vertical = side === "up" || side === "down";
    // A card is a box: its edge is half its width beside it and half its height above
    // or below. A circle is the same either way.
    // Beside a node the label must clear the whole body, not just the geometry's half
    // width: a circle's avatar box is as wide as it is tall.
    const reach = !vertical
      ? Math.max(Math.abs(options.halfWidth), Math.abs(options.halfHeight))
      : Math.abs(options.halfHeight);

    if (side === "up") {
      return { x: options.node.x, y: options.node.y - reach - air, textAnchor: "middle", side };
    }
    if (side === "down") {
      return {
        x: options.node.x,
        y: options.node.y + reach + air + boxHeight,
        textAnchor: "middle",
        side,
      };
    }
    if (side === "left") {
      return {
        x: options.node.x - reach - air,
        y: options.node.y + options.fontSize * ASCENT * 0.5,
        textAnchor: "end",
        side,
      };
    }
    return {
      x: options.node.x + reach + air,
      y: options.node.y + options.fontSize * ASCENT * 0.5,
      textAnchor: "start",
      side,
    };
  };

  const preferred: Placement["side"] = Math.abs(dy) >= Math.abs(dx) || (dx === 0 && dy === 0)
    ? dy < 0
      ? "up"
      : "down"
    : dx < 0
      ? "left"
      : "right";
  const opposite: Placement["side"] = {
    up: "down" as const,
    down: "up" as const,
    left: "right" as const,
    right: "left" as const,
  }[preferred];

  const clamp = (placement: Placement): { placement: Placement; clipped: boolean } => {
    if (!options.bounds) {
      return { placement, clipped: false };
    }

    const { x0, y0, x1, y1 } = options.bounds;
    const pad = air * 0.5;
    let { x, y } = placement;
    let clipped = false;

    if (placement.textAnchor === "middle") {
      const half = boxWidth / 2;
      const lo = x0 + half + pad;
      const hi = x1 - half - pad;
      if (lo <= hi) {
        const next = Math.min(Math.max(x, lo), hi);
        clipped = clipped || next !== x;
        x = next;
      } else {
        x = (x0 + x1) / 2;
      }
    } else if (placement.textAnchor === "start") {
      const hi = x1 - boxWidth - pad;
      if (x > hi) {
        clipped = true;
        x = Math.max(hi, x0 + pad);
      }
    } else {
      const lo = x0 + boxWidth + pad;
      if (x < lo) {
        clipped = true;
        x = Math.min(lo, x1 - pad);
      }
    }

    // Keep the whole box inside vertically: the baseline sits `boxHeight` below its top.
    const top = y - options.fontSize * ASCENT;
    const bottom = top + boxHeight;
    if (top < y0 + pad) {
      clipped = true;
      y += y0 + pad - top;
    } else if (bottom > y1 - pad) {
      clipped = true;
      y -= bottom - (y1 - pad);
    }

    return { placement: { ...placement, x, y }, clipped };
  };

  const outward = clamp(place(preferred));
  const outwardTop = outward.placement.y - options.fontSize * ASCENT;
  const outwardBottom = outwardTop + boxHeight;
  const verticalClipped = Boolean(options.bounds) &&
    (outwardTop < options.bounds!.y0 || outwardBottom > options.bounds!.y1);

  if (!outward.clipped || (preferred !== "up" && preferred !== "down" && !verticalClipped)) {
    // A sideways label is anchored at its near edge, so clamping its far edge is a
    // slide along the reading direction, not a reason to cross the node.
    return outward.placement;
  }

  const inward = clamp(place(opposite));
  return inward.clipped ? outward.placement : inward.placement;
}
