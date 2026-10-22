// 整理 is a transaction: a proposal is shown, and only 确认 writes it.
//
// The rules were implicit in the component — the proposal lived in one state, the view
// it interrupted in one ref, and the coordinates it started from in whatever
// `workingLayout()` returned at the moment of the press. That made "which snapshot does
// 取消 restore" depend on how many times the author switched layouts: every switch
// overwrote the remembered view, so cancelling after comparing three arrangements
// returned to the second one's framing.
//
// This module holds the state machine on its own so the rules can be stated and tested:
//
//   idle      → no session; 整理 has not proposed anything
//   previewing→ a session exists; the proposal is drawn, nothing is written
//   committed → the proposal was applied through the one layout commit path
//
// The baseline is captured once, on the first proposal, and is never replaced while the
// session lives. Every proposal is computed from that baseline, so switching layouts
// compares alternatives against the same starting point instead of stacking.

import {
  applyPositions,
  type ArrangeMode,
  type CanvasLayout,
  type LayoutPoint,
} from "../storage/relationshipLayout";

export type ArrangeView = { k: number; x: number; y: number };

export type ArrangeProposal = {
  mode: ArrangeMode;
  /** Shown instead of the mode's name when the command has its own label. */
  label?: string;
  scope: "visible" | "all";
  positions: Record<string, LayoutPoint>;
  /**
   * The roster a restore proposes, when it proposes one at all.
   *
   * `undefined` — most commands — leaves membership alone; 环形布局 must not silently
   * re-add someone the author removed. `null` restores the legacy "no explicit roster"
   * mode, so a snapshot taken before members existed keeps behaving as it did. An array,
   * including `[]`, is a roster to write — an empty canvas is a decision, not a gap.
   */
  members?: string[] | null;
  /**
   * The framing a restore wants, in drawing coordinates. Absent for every layout
   * command: those move nodes and let the canvas keep its camera. A snapshot brings its
   * own, because "回到这个布局" means the same rectangle of the drawing as well.
   */
  view?: ArrangeView;
};

/**
 * What the canvas looked like before 整理 proposed anything. `layout` is the coordinates
 * and appearance; `view` and `selectedIds` are restored by 取消 so the author lands
 * where they were, not merely at the old coordinates under a new framing.
 */
export type ArrangeBaseline = {
  layout: CanvasLayout;
  view: ArrangeView;
  selectedIds: string[];
};

export type ArrangeSession = {
  baseline: ArrangeBaseline;
  proposal: ArrangeProposal;
};

/**
 * Opens or updates a session.
 *
 * The first call captures the starting point. Later calls — the second, third and fourth
 * layout the author tries before deciding — replace only the proposal. This is the
 * difference between "cancel returns to where I was" and "cancel returns to layout two".
 */
export function beginArrange(
  current: ArrangeSession | null,
  input: { baseline: ArrangeBaseline; proposal: ArrangeProposal },
): ArrangeSession {
  return {
    baseline: current ? current.baseline : input.baseline,
    proposal: input.proposal,
  };
}

/** What 取消 restores: the original coordinates, view and selection. */
export function cancelArrangeSession(session: ArrangeSession | null): ArrangeBaseline | null {
  return session ? session.baseline : null;
}

/**
 * Whether a proposal would actually write something.
 *
 * A 网格布局 on an already-gridded drawing lands every node back on its own coordinate.
 * Treating that as a change records an undo step for nothing and tells the author
 * "已应用" when the picture did not move. The comparison is per drawn node and tolerant
 * of floating point noise, which `gridLayout` produces on purpose.
 */
export function proposalChanges(session: ArrangeSession, tolerance = 0.5): boolean {
  const { positions, members } = session.proposal;

  // A restore that only changes who is on the canvas still has to be applied and
  // undoable: comparing coordinates alone would call it "no change" and skip the roster.
  if (members !== undefined && !sameRoster(session.baseline.layout.members, members ?? undefined)) {
    return true;
  }

  // Restoring only the framing is still a restore: same nodes, same roster, different
  // camera. Without this, 确认 would report "没有变化" and leave the camera where it was.
  const proposed = session.proposal.view;
  if (
    proposed &&
    (Math.abs(proposed.k - session.baseline.view.k) > 1e-3 ||
      Math.abs(proposed.x - session.baseline.view.x) > 1e-3 ||
      Math.abs(proposed.y - session.baseline.view.y) > 1e-3)
  ) {
    return true;
  }

  return Object.keys(positions).some((id) => {
    const before = session.baseline.layout.positions[id];
    const after = positions[id];

    if (!before) {
      return true;
    }

    return Math.abs(before.x - after.x) > tolerance || Math.abs(before.y - after.y) > tolerance;
  });
}

/**
 * Confirm: the proposal applied to the baseline, which is what a single layout commit
 * should receive. The baseline comes back with it so 撤销 can put the same coordinates
 * *and* the same view back — an arrange is undone to where it started, not to a refit.
 */
export function commitArrangeSession(session: ArrangeSession): {
  layout: CanvasLayout;
  baseline: ArrangeBaseline;
} {
  const applied = applyPositions(session.baseline.layout, session.proposal.positions);
  const { members } = session.proposal;

  // Coordinates, roster and (through the caller) framing land in one layout write, so a
  // restore cannot be half-applied.
  if (members === undefined) {
    return { layout: applied, baseline: session.baseline };
  }

  const layout = members === null ? { ...applied } : { ...applied, members: [...members] };
  if (members === null) {
    delete layout.members;
  }

  return { layout, baseline: session.baseline };
}

/** Same roster, ignoring order: membership is a set, not a list. */
function sameRoster(a: string[] | undefined, b: string[] | undefined): boolean {
  if (a === undefined || b === undefined) {
    return a === b;
  }
  if (a.length !== b.length) {
    return false;
  }
  const seen = new Set(a);
  return b.every((id) => seen.has(id));
}

/** How many nodes the current proposal repositions. Reported, not inferred from state. */
export function proposedNodeCount(session: ArrangeSession | null): number {
  return session ? Object.keys(session.proposal.positions).length : 0;
}

/**
 * Whether every point is inside the drawing box, in the coordinates the canvas is
 * drawn in.
 *
 * Confirming an arrangement must not leave the new positions off-screen — but it also
 * must not re-frame a view the author composed by hand while comparing proposals. The
 * rule is therefore conditional: keep the view when the result is already visible, and
 * re-frame only when it is not.
 */
export function pointsWithinView(
  points: { x: number; y: number }[],
  view: ArrangeView,
  viewBox: string,
  pad = 0,
): boolean {
  if (points.length === 0) {
    return true;
  }

  const [boxX, boxY, boxWidth, boxHeight] = viewBox.split(" ").map(Number);

  if (![boxX, boxY, boxWidth, boxHeight].every(Number.isFinite)) {
    return true;
  }

  return points.every((point) => {
    const x = point.x * view.k + view.x;
    const y = point.y * view.k + view.y;

    return (
      x >= boxX + pad &&
      x <= boxX + boxWidth - pad &&
      y >= boxY + pad &&
      y <= boxY + boxHeight - pad
    );
  });
}
