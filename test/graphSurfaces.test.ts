import { describe, expect, it } from "vitest";
import {
  appearanceTarget,
  designPanelScope,
  appearanceTitle,
  arrangeAvailability,
  closeSurface,
  contextBarMode,
  surfaceIsOpen,
  toggleSurface,
} from "../src/utils/graphSurfaces";

describe("primary surface", () => {
  it("opening a second surface replaces the first instead of stacking", () => {
    expect(toggleSurface("arrange", "design")).toBe("design");
    expect(toggleSurface("design", "explore")).toBe("explore");
    expect(toggleSurface("characters", "arrange")).toBe("arrange");
  });

  it("pressing the open surface's own button closes it", () => {
    expect(toggleSurface("design", "design")).toBe("none");
    expect(toggleSurface("arrange", "arrange")).toBe("none");
  });

  it("closing a surface that is not open leaves the open one alone", () => {
    expect(closeSurface("design", "arrange")).toBe("design");
    expect(closeSurface("design", "design")).toBe("none");
  });

  it("reports whether anything is open", () => {
    expect(surfaceIsOpen("none")).toBe(false);
    expect(surfaceIsOpen("groups")).toBe(true);
  });
});

describe("appearance target", () => {
  it("names the edge when a line is selected, ahead of any node", () => {
    expect(appearanceTarget(["a"], "e1")).toEqual({ kind: "edge" });
    expect(appearanceTitle(appearanceTarget(["a"], "e1"))).toBe("所选关系线");
  });

  it("names the single node", () => {
    const target = appearanceTarget(["a"], null);
    expect(target).toEqual({ kind: "node", id: "a" });
    expect(appearanceTitle(target)).toBe("所选角色");
  });

  it("says how many nodes when several are selected rather than pretending one", () => {
    const target = appearanceTarget(["a", "b", "c"], null);
    expect(target).toEqual({ kind: "multi", count: 3 });
    expect(appearanceTitle(target)).toBe("已选 3 个角色");
  });

  it("falls back to the whole canvas when nothing is selected", () => {
    expect(appearanceTarget([], null)).toEqual({ kind: "canvas" });
    expect(appearanceTitle(appearanceTarget([], null))).toBe("整体画布");
  });
});

describe("context bar", () => {
  it("shows one bar at a time, preview first", () => {
    expect(contextBarMode({ previewing: true, selectedCount: 4, canUndo: true })).toBe("preview");
    expect(contextBarMode({ previewing: false, selectedCount: 4, canUndo: true })).toBe("selection");
    expect(contextBarMode({ previewing: false, selectedCount: 0, canUndo: true })).toBe("undo");
    expect(contextBarMode({ previewing: false, selectedCount: 0, canUndo: false })).toBe("none");
  });
});

describe("arrange availability", () => {
  it("needs two nodes to align and three to distribute", () => {
    expect(arrangeAvailability(1)).toMatchObject({ canAlign: false, canDistribute: false });
    expect(arrangeAvailability(2)).toMatchObject({ canAlign: true, canDistribute: false });
    expect(arrangeAvailability(3)).toMatchObject({ canAlign: true, canDistribute: true });
  });

  it("gives a reason whenever an action is unavailable", () => {
    expect(arrangeAvailability(1).reason).toContain("两个");
    expect(arrangeAvailability(2).reason).toContain("三个");
    expect(arrangeAvailability(5).reason).toBeNull();
  });
});

describe("design panel tab", () => {
  it("starts on the canvas and stays there while nothing is selected", () => {
    expect(designPanelScope("canvas", appearanceTarget([], null))).toBe("canvas");
  });

  it("keeps the tab the author chose instead of following the selection", () => {
    const one = appearanceTarget(["a"], null);
    expect(designPanelScope("canvas", one)).toBe("canvas");
    expect(designPanelScope("object", one)).toBe("object");
  });

  it("never renders a personal form with nobody selected", () => {
    expect(designPanelScope("object", appearanceTarget([], null))).toBe("canvas");
    expect(designPanelScope("object", appearanceTarget([], "e1"))).toBe("object");
    expect(designPanelScope("object", appearanceTarget(["a", "b"], null))).toBe("object");
  });
});
