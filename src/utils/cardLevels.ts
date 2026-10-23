// How rich a card may be drawn, given the room it has.
//
// Three levels exist: `full` (portrait plus occupation), `plate` (a narrow card with
// the portrait) and `compact` (which is not a card at all — the geometry falls back to
// a circle). Crowding is allowed to thin a card down, because a canvas of a hundred
// people cannot show a hundred business cards.
//
// What crowding may not do is contradict the author. A form set on one character is an
// instruction, so it stops at `plate`: still a card, still recognisably the shape that
// was asked for. Only the canvas-wide default — a look, not an instruction — is
// allowed to collapse all the way to a circle.
export type CardLevel = "compact" | "plate" | "full";

const RANK: Record<CardLevel, number> = { compact: 0, plate: 1, full: 2 };

export function cardLevelFor(options: {
  /** What the fitter could afford here. */
  fitted: CardLevel;
  /** The most this canvas allows at the current zoom. */
  ceiling: CardLevel;
  /** Selected or focused: the room limit does not apply. */
  exempt: boolean;
  /** The form was set on this character rather than inherited from the canvas. */
  explicit: boolean;
}): CardLevel {
  const capped = options.exempt || RANK[options.fitted] <= RANK[options.ceiling] ? options.fitted : options.ceiling;

  return options.explicit && RANK[capped] < RANK.plate ? "plate" : capped;
}
