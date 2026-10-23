// How many names the drawing shows, as one rule instead of two booleans read in two
// places.
//
// The canvas had `showLabels` (every name or none) and a separate `hubIds` set that
// decided which names survived when not all of them fit. Which of the two was in force
// was implicit in the expression at the call site, so "why is this name missing" had no
// answer outside the render function, and no test could name the threshold.
//
// The three modes are the whole policy:
//   all  — every drawn node is named (export always lands here);
//   hubs — only the nodes that carry the shape: selected, focused, a direct neighbour,
//          or one of the ten busiest; the rest name themselves on hover;
//   none — the reader turned names off.
export type LabelDensity = "all" | "hubs" | "none";

export function labelDensity(input: {
  /** The reader's switch. It outranks everything, including an export. */
  showNames: boolean;
  /** 全部: keep every name even when they collide, because the reader asked. */
  forceNames?: boolean;
  /** An export is the fitted drawing with its names on it. */
  exporting: boolean;
  /** Whether every visible name fits without overlapping. */
  labelsFit: boolean;
  /** A phone canvas has room for a handful of names even when a hundred would not. */
  compact: boolean;
  visibleCount: number;
}): LabelDensity {
  if (!input.showNames) {
    return "none";
  }
  if (input.forceNames) {
    return "all";
  }
  if (input.exporting || input.labelsFit) {
    return "all";
  }
  if (input.compact && input.visibleCount <= 12) {
    return "all";
  }
  return "hubs";
}

/** Whether one node keeps its name under a density, given what it is to the reader. */
export function namesNode(
  density: LabelDensity,
  state: { hovered: boolean; focused: boolean; neighbour: boolean; selected: boolean; hub: boolean },
): boolean {
  if (density === "none") {
    return false;
  }
  if (density === "all") {
    return true;
  }
  return state.hovered || state.focused || state.neighbour || state.selected || state.hub;
}

/**
 * Which of the candidate names can be drawn without landing on each other.
 *
 * Ten names chosen by degree alone were ten names stacked on the same arc: the hubs
 * of a ring sit next to each other, so the labels overlapped into a grey smear that
 * said less than no label at all. Keeping the busiest and dropping anything closer
 * than one name's width is deterministic, needs no text measurement, and degrades to
 * "three legible names" instead of "ten illegible ones".
 */
export function pickSpacedLabels<T extends { x: number; y: number; weight: number }>(
  candidates: T[],
  minDistance: number,
): T[] {
  const kept: T[] = [];

  for (const candidate of [...candidates].sort((left, right) => right.weight - left.weight)) {
    if (kept.every((other) => Math.hypot(other.x - candidate.x, other.y - candidate.y) >= minDistance)) {
      kept.push(candidate);
    }
  }

  return kept;
}
