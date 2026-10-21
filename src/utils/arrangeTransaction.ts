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
  scope: "visible" | "all";
  positions: Record<string, LayoutPoint>;
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
  const { positions } = session.proposal;

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
  return {
    layout: applyPositions(session.baseline.layout, session.proposal.positions),
    baseline: session.baseline,
  };
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
