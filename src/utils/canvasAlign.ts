/**
 * Alignment and distribution on true visual bounds.
 *
 * A node's stored coordinate is its centre, but a card and a circle have very
 * different widths, so "left align" cannot move every centre to the same x: the
 * left *edges* are what a reader sees, and a card's edge is 84 units from its
 * centre while a circle's is 20. Everything here works from the drawn box, not
 * from the point, which is also what keeps mixed node forms from looking ragged.
 */

export type AlignAxis = "x" | "y";
export type AlignMode = "start" | "center" | "end";

export interface AlignBox {
  id: string;
  x: number;
  y: number;
  halfWidth: number;
  halfHeight: number;
}

const half = (box: AlignBox, axis: AlignAxis) => (axis === "x" ? box.halfWidth : box.halfHeight);

/**
 * New centre coordinates on the chosen axis, or null when there is nothing to do.
 *
 * `start` lines up left/top edges, `end` right/bottom edges, and `center` lines up
 * the centres on the middle of the selection's own bounding box — the same three
 * meanings a drawing tool gives these commands.
 */
export function alignPositions(
  boxes: AlignBox[],
  axis: AlignAxis,
  mode: AlignMode,
): Record<string, number> | null {
  if (boxes.length < 2) {
    return null;
  }

  const centres = boxes.map((box) => (axis === "x" ? box.x : box.y));
  let line: number;

  if (mode === "center") {
    const starts = boxes.map((box) => (axis === "x" ? box.x : box.y) - half(box, axis));
    const ends = boxes.map((box) => (axis === "x" ? box.x : box.y) + half(box, axis));
    line = (Math.min(...starts) + Math.max(...ends)) / 2;
  } else if (mode === "start") {
    line = Math.min(...boxes.map((box) => (axis === "x" ? box.x : box.y) - half(box, axis)));
  } else {
    line = Math.max(...boxes.map((box) => (axis === "x" ? box.x : box.y) + half(box, axis)));
  }

  const out: Record<string, number> = {};
  boxes.forEach((box, index) => {
    out[box.id] = mode === "center" ? line : mode === "start" ? line + half(box, axis) : line - half(box, axis);
  });

  // A no-op alignment should not enter the undo history.
  return centres.every((value, index) => Math.abs(out[boxes[index].id] - value) < 0.01) ? null : out;
}

/**
 * New centre coordinates with equal gaps between the drawn boxes, or null when the
 * command does not apply.
 *
 * The first and last boxes stay where they are and the gap between neighbours is
 * solved from the space left over. When the boxes are wider than the span they
 * would have to fill, no gap exists: returning null lets the caller fall back to
 * equal centre spacing rather than piling nodes on top of each other.
 */
export function distributePositions(boxes: AlignBox[], axis: AlignAxis): Record<string, number> | null {
  if (boxes.length < 3) {
    return null;
  }

  const centre = (box: AlignBox) => (axis === "x" ? box.x : box.y);
  const ordered = [...boxes].sort((a, b) => centre(a) - centre(b));
  const first = centre(ordered[0]) - half(ordered[0], axis);
  const last = centre(ordered[ordered.length - 1]) + half(ordered[ordered.length - 1], axis);
  const span = last - first;
  const occupied = ordered.reduce((sum, box) => sum + half(box, axis) * 2, 0);

  if (span <= occupied) {
    return null;
  }

  const gap = (span - occupied) / (ordered.length - 1);
  let cursor = first;
  const out: Record<string, number> = {};

  ordered.forEach((box) => {
    out[box.id] = cursor + half(box, axis);
    cursor += half(box, axis) * 2 + gap;
  });

  // The two ends are fixed by construction; floating point should not argue.
  out[ordered[0].id] = centre(ordered[0]);
  out[ordered[ordered.length - 1].id] = centre(ordered[ordered.length - 1]);

  return out;
}

/** Equal centre spacing, used when the boxes leave no room for a gap. */
export function spreadPositions(boxes: AlignBox[], axis: AlignAxis): Record<string, number> | null {
  if (boxes.length < 3) {
    return null;
  }

  const centre = (box: AlignBox) => (axis === "x" ? box.x : box.y);
  const ordered = [...boxes].sort((a, b) => centre(a) - centre(b));
  const first = centre(ordered[0]);
  const last = centre(ordered[ordered.length - 1]);
  const step = (last - first) / (ordered.length - 1);
  const out: Record<string, number> = {};

  ordered.forEach((box, index) => {
    out[box.id] = first + step * index;
  });

  return out;
}

/**
 * The selection without ids that no longer exist.
 *
 * Deleting a character used to leave its id in the selection: the count included
 * somebody who was not on the canvas, and 对齐 could wait for a third node that
 * would never appear.
 */
export function pruneSelection(selected: string[], existing: Iterable<string>): string[] {
  const present = new Set(existing);
  const kept = selected.filter((id) => present.has(id));

  return kept.length === selected.length ? selected : kept;
}

/**
 * The class list that decides how a node is drawn.
 *
 * Priority is the point of this function: a hover must not erase a selection, and
 * a spotlight must not pass for one. It is a class, not a colour — the ring and the
 * check badge come from `.selected`, which is why this has to be exact.
 */
export function nodeStateClass(state: {
  selected: boolean;
  focused: boolean;
  hovered: boolean;
  outsideSpotlight: boolean;
  dimmedByHover: boolean;
}): string {
  if (state.outsideSpotlight) {
    return state.selected ? "relationship-node spotlight-dim selected" : "relationship-node spotlight-dim";
  }

  const parts = ["relationship-node"];

  if (state.focused) {
    parts.push("active", "focused");
  } else if (state.hovered) {
    parts.push("active");
  } else if (state.dimmedByHover && !state.selected) {
    parts.push("dimmed");
  }

  if (state.selected) {
    parts.push("selected");
  }

  return parts.join(" ");
}
