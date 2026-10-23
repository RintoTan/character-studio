// Which large surface the relationship studio has open, and what the small bar under
// the drawing is allowed to say.
//
// The page used to carry one boolean per panel — arrange, groups, appearance, the two
// studio drawers — plus two phone menus. Nothing stopped three of them being true at
// once, which is how a selection bar, an arrange panel and an undo notice ended up
// stacked on top of each other and how an appearance panel could open behind an
// arrange panel. One value, one open surface, is the rule that replaces all of them.
//
// A drawer is not the same thing as a popover: a popover is dismissed by the next
// click anywhere, a drawer holds work in progress and is closed by its own button,
// Escape, or the task that replaces it. Keeping that distinction here means the
// rendering code cannot accidentally give a drawer popover behaviour.

export type GraphSurface =
  | "none"
  | "characters"
  | "design"
  | "explore"
  | "arrange"
  | "groups"
  /** Output is a task panel like the others, not a menu that floats over the drawing. */
  | "export";

export type SurfaceRequest = Exclude<GraphSurface, "none">;

/**
 * Opening a surface closes whatever was open; asking for the one that is open closes
 * it. That second half is what makes the toolbar buttons toggles rather than a set of
 * switches that can all be on.
 */
export function toggleSurface(current: GraphSurface, next: SurfaceRequest): GraphSurface {
  return current === next ? "none" : next;
}

/** Closing is idempotent: closing a surface that is not the open one changes nothing. */
export function closeSurface(current: GraphSurface, closing: SurfaceRequest): GraphSurface {
  return current === closing ? "none" : current;
}

export function surfaceIsOpen(current: GraphSurface): boolean {
  return current !== "none";
}

/**
 * What the appearance panel is editing. The title has to name it, because "外观" over
 * a canvas and "外观" over one node are different jobs and the old panel looked the
 * same for both.
 */
export type AppearanceTarget =
  | { kind: "edge" }
  | { kind: "node"; id: string }
  | { kind: "multi"; count: number }
  | { kind: "canvas" };

export function appearanceTarget(
  selectedIds: string[],
  selectedEdgeId: string | null,
): AppearanceTarget {
  if (selectedEdgeId) {
    return { kind: "edge" };
  }

  if (selectedIds.length === 1) {
    return { kind: "node", id: selectedIds[0] };
  }

  if (selectedIds.length > 1) {
    return { kind: "multi", count: selectedIds.length };
  }

  return { kind: "canvas" };
}

export function appearanceTitle(target: AppearanceTarget): string {
  switch (target.kind) {
    case "edge":
      return "所选关系线";
    case "node":
      return "所选角色";
    case "multi":
      return `已选 ${target.count} 个角色`;
    default:
      return "整体画布";
  }
}

/** The two tabs of the appearance panel: canvas-wide, or one object. */
export type DesignScope = "canvas" | "object";

/**
 * Which tab actually renders.
 *
 * `chosen` is the tab the author clicked and it is remembered across openings, so
 * re-opening 设计 never throws away their choice. Having something selected is not
 * the same as editing it, though: the object tab needs an object, and with nothing
 * selected it would stand there as a personal-appearance form with nobody's values.
 * So the canvas tab renders instead — the choice itself is left alone, and picking
 * another object brings the object tab back.
 */
export function designPanelScope(chosen: DesignScope, target: AppearanceTarget): DesignScope {
  return chosen === "object" && target.kind === "canvas" ? "canvas" : chosen;
}

/**
 * Which single bar belongs under the drawing.
 *
 * These were three siblings that could all render at once: a preview bar with its
 * confirm buttons, the selection bar, and an undo notice. Each is the most important
 * thing on screen while it is relevant, and none of them is more important than the
 * others, so at most one shows. Preview wins because it is a decision still open;
 * a selection follows because it is the state the next action uses; the undo notice is
 * the fallback, and it is the one that may be folded into the selection bar.
 */
export type ContextBarMode = "preview" | "selection" | "undo" | "none";

export function contextBarMode(input: {
  previewing: boolean;
  selectedCount: number;
  canUndo: boolean;
}): ContextBarMode {
  if (input.previewing) {
    return "preview";
  }

  if (input.selectedCount > 0) {
    return "selection";
  }

  if (input.canUndo) {
    return "undo";
  }

  return "none";
}

/**
 * A status line about a finished move is feedback, not a place to work from. It fades
 * on its own so the author never has to dismiss a notice before touching the canvas.
 */
export const ARRANGE_NOTICE_MS = 6000;

/** Alignment needs a partner; distribution needs a third node to have a middle. */
export function arrangeAvailability(selectedCount: number): {
  canAlign: boolean;
  canDistribute: boolean;
  reason: string | null;
} {
  return {
    canAlign: selectedCount >= 2,
    canDistribute: selectedCount >= 3,
    reason:
      selectedCount >= 3
        ? null
        : selectedCount === 2
          ? "等距分布需要至少三个角色；两个人只能对齐。"
          : "对齐需要至少两个角色。",
  };
}
