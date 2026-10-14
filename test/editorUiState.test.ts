// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import {
  EDITOR_COLLAPSE_KEY,
  defaultCollapseState,
  loadCollapseState,
  normalizeCollapseState,
  saveCollapseState,
} from "../src/storage/editorUiState";

describe("editor collapse memory", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("returns null when nothing has been remembered yet", () => {
    expect(loadCollapseState()).toBeNull();
  });

  it("round-trips a folded layout", () => {
    const state = { ...defaultCollapseState, appearance: true, backstory: true };
    saveCollapseState(state);

    expect(loadCollapseState()).toEqual(state);
  });

  it("fills sections a stored state predates from the default", () => {
    localStorage.setItem(EDITOR_COLLAPSE_KEY, JSON.stringify({ appearance: true }));

    expect(loadCollapseState()).toEqual({ ...defaultCollapseState, appearance: true });
  });

  it("ignores unknown keys and non-boolean values", () => {
    expect(
      normalizeCollapseState({ basic: true, prompt: "yes", futureSection: true }),
    ).toEqual({ ...defaultCollapseState, basic: true });
  });

  it("refuses shapes that cannot describe a layout", () => {
    expect(normalizeCollapseState(null)).toBeNull();
    expect(normalizeCollapseState([])).toBeNull();
    expect(normalizeCollapseState("basic")).toBeNull();
    expect(normalizeCollapseState({})).toBeNull();
    expect(normalizeCollapseState({ basic: true, prompt: false, appearance: 1 })).not.toBeNull();
  });

  it("survives corrupt storage instead of throwing on open", () => {
    localStorage.setItem(EDITOR_COLLAPSE_KEY, "{not json");

    expect(loadCollapseState()).toBeNull();
  });

  it("does not let a failing write escape", () => {
    const original = localStorage.setItem;
    localStorage.setItem = () => {
      throw new Error("QuotaExceededError");
    };

    expect(() => saveCollapseState(defaultCollapseState)).not.toThrow();
    localStorage.setItem = original;
  });
});
