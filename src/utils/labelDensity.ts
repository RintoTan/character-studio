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

/**
 * The size a name is drawn at, in world units.
 *
 * Names scale with the drawing, which is right for the overview: at 28% a hundred
 * labels would be four-pixel noise. But the person the reader has actually selected or
 * focused is not part of the overview — their name is the one piece of text that has to
 * survive the zoom. For those two states the name is lifted to a fixed screen size, so
 * it stays readable when the node itself is small; everything else keeps scaling and
 * simply disappears under the callers' own legibility floor.
 */
export function readableNameSize(options: {
  /** The name size the canvas style asks for, in world units. */
  nameSize: number;
  /** Screen pixels per world unit at the current zoom. */
  pxPerUnit: number;
  /** Selected or focused: this name must survive the zoom. */
  pinned: boolean;
  /** Screen size below which a pinned name is lifted. */
  floorPx?: number;
}): number {
  const floor = options.floorPx ?? 11;
  const pxPerUnit = Math.max(options.pxPerUnit, 0.0001);
  const current = options.nameSize * pxPerUnit;

  if (!options.pinned || current >= floor) {
    return options.nameSize;
  }

  return floor / pxPerUnit;
}

/**
 * Whether a card still earns its name *inside* the card at this zoom.
 *
 * A card draws its name in its own body, which is why the canvas never adds an outside
 * label to one. At 0.28x that body is eight pixels tall and the name lands at four:
 * unreadable, and — because the outside label is suppressed for cards — the selected
 * card was the one node on the canvas with no legible name at all, while a plain circle
 * next to it got the pinned one. Below the floor the card hands its name back to the
 * canvas, which draws it the way it draws every other node's.
 */
export function cardNameVisible(options: {
  /** The name size the card body asks for, in world units. */
  nameSize: number;
  /** Screen pixels per world unit at the current zoom. */
  pxPerUnit: number;
  /** Screen size below which the in-card name is not worth drawing. */
  floorPx?: number;
}): boolean {
  const floor = options.floorPx ?? 6;
  return options.nameSize * Math.max(options.pxPerUnit, 0.0001) >= floor;
}
