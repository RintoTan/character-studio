import { describe, expect, it } from "vitest";
import {
  beginArrange,
  cancelArrangeSession,
  commitArrangeSession,
  pointsWithinView,
  proposalChanges,
  proposedNodeCount,
  type ArrangeBaseline,
  type ArrangeProposal,
} from "../src/utils/arrangeTransaction";
import { emptyLayout, type CanvasLayout } from "../src/storage/relationshipLayout";

function layoutWith(positions: Record<string, { x: number; y: number }>): CanvasLayout {
  return { ...emptyLayout(), positions };
}

function baseline(layout = layoutWith({ a: { x: 0, y: 0 }, b: { x: 100, y: 0 } })): ArrangeBaseline {
  return {
    layout,
    view: { k: 0.9, x: 12, y: 34 },
    selectedIds: ["a"],
  };
}

function proposal(mode: ArrangeProposal["mode"], positions: Record<string, { x: number; y: number }>): ArrangeProposal {
  return { mode, scope: "visible", positions };
}

describe("arrange transaction", () => {
  it("keeps the first snapshot when the author compares several layouts", () => {
    const first = beginArrange(null, {
      baseline: baseline(),
      proposal: proposal("cluster", { a: { x: 10, y: 10 }, b: { x: 90, y: 10 } }),
    });
    const second = beginArrange(first, {
      baseline: { ...baseline(), view: { k: 1.6, x: 0, y: 0 } },
      proposal: proposal("grid", { a: { x: 0, y: 0 }, b: { x: 60, y: 0 } }),
    });
    const third = beginArrange(second, {
      baseline: { ...baseline(), view: { k: 0.4, x: 9, y: 9 } },
      proposal: proposal("ring", { a: { x: 5, y: 5 }, b: { x: 55, y: 5 } }),
    });

    expect(third.baseline.view).toEqual({ k: 0.9, x: 12, y: 34 });
    expect(third.proposal.mode).toBe("ring");
    expect(cancelArrangeSession(third)?.view).toEqual({ k: 0.9, x: 12, y: 34 });
  });

  it("restores coordinates, view and selection on cancel, and writes nothing", () => {
    const before = baseline();
    const session = beginArrange(null, {
      baseline: before,
      proposal: proposal("cluster", { a: { x: 900, y: 900 }, b: { x: -900, y: -900 } }),
    });
    const restored = cancelArrangeSession(session);

    expect(restored?.layout.positions).toEqual({ a: { x: 0, y: 0 }, b: { x: 100, y: 0 } });
    expect(restored?.view).toEqual({ k: 0.9, x: 12, y: 34 });
    expect(restored?.selectedIds).toEqual(["a"]);
  });

  it("cancelling without a session is a no-op rather than a reset", () => {
    expect(cancelArrangeSession(null)).toBeNull();
  });

  it("commits the proposal onto the baseline and keeps what undo needs", () => {
    const session = beginArrange(null, {
      baseline: baseline(),
      proposal: proposal("grid", { a: { x: 40, y: 40 }, b: { x: 140, y: 40 } }),
    });
    const committed = commitArrangeSession(session);

    expect(committed.layout.positions).toEqual({ a: { x: 40, y: 40 }, b: { x: 140, y: 40 } });
    // The layout handed to 撤销 is the one before the arrange, untouched.
    expect(committed.baseline.layout.positions).toEqual({ a: { x: 0, y: 0 }, b: { x: 100, y: 0 } });
    expect(committed.baseline.view).toEqual({ k: 0.9, x: 12, y: 34 });
  });

  it("does not carry an earlier proposal into a later one", () => {
    const first = beginArrange(null, {
      baseline: baseline(),
      proposal: proposal("cluster", { a: { x: 500, y: 500 }, b: { x: 500, y: 500 } }),
    });
    const second = beginArrange(first, {
      baseline: baseline(),
      proposal: proposal("grid", { a: { x: 40, y: 40 }, b: { x: 140, y: 40 } }),
    });

    expect(second.proposal.positions).toEqual({ a: { x: 40, y: 40 }, b: { x: 140, y: 40 } });
    expect(commitArrangeSession(second).layout.positions).toEqual({
      a: { x: 40, y: 40 },
      b: { x: 140, y: 40 },
    });
  });

  it("treats a proposal that lands on the same coordinates as no change", () => {
    const same = beginArrange(null, {
      baseline: baseline(),
      proposal: proposal("grid", { a: { x: 0.2, y: -0.1 }, b: { x: 100.3, y: 0 } }),
    });
    const moved = beginArrange(null, {
      baseline: baseline(),
      proposal: proposal("grid", { a: { x: 0, y: 0 }, b: { x: 100, y: 40 } }),
    });

    expect(proposalChanges(same)).toBe(false);
    expect(proposalChanges(moved)).toBe(true);
  });

  it("counts a node that had no stored coordinate as a change", () => {
    const session = beginArrange(null, {
      baseline: baseline(layoutWith({ a: { x: 0, y: 0 } })),
      proposal: proposal("ring", { a: { x: 0, y: 0 }, b: { x: 80, y: 0 } }),
    });

    expect(proposalChanges(session)).toBe(true);
    expect(proposedNodeCount(session)).toBe(2);
    expect(proposedNodeCount(null)).toBe(0);
  });
});

describe("confirm keeps the result reachable", () => {
  const viewBox = "0 0 1000 500";

  it("keeps a hand-composed view when the arrangement is already visible", () => {
    expect(pointsWithinView([{ x: 100, y: 100 }, { x: 400, y: 300 }], { k: 1, x: 0, y: 0 }, viewBox)).toBe(
      true,
    );
  });

  it("reports a node the current view would cut off", () => {
    // 900 * 1.5 = 1350, past the right edge of a 1000-wide box.
    expect(pointsWithinView([{ x: 900, y: 100 }], { k: 1.5, x: 0, y: 0 }, viewBox)).toBe(false);
    // The same point with the transform that a fit would produce.
    expect(pointsWithinView([{ x: 900, y: 100 }], { k: 1, x: 0, y: 0 }, viewBox)).toBe(true);
  });

  it("does not treat an unmeasured box as an off-screen node", () => {
    expect(pointsWithinView([{ x: 900, y: 100 }], { k: 1, x: 0, y: 0 }, "")).toBe(true);
    expect(pointsWithinView([], { k: 1, x: 0, y: 0 }, viewBox)).toBe(true);
  });
});
