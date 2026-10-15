// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import {
  AVATAR_SIZES,
  GRAPH_PREFS_KEY,
  NAME_SIZES,
  defaultGraphPrefs,
  graphMetrics,
  loadGraphPrefs,
  normalizeGraphPrefs,
  saveGraphPrefs,
} from "../src/storage/graphPrefs";

describe("graph size preferences", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("returns the defaults when nothing has been stored", () => {
    expect(loadGraphPrefs()).toEqual(defaultGraphPrefs);
  });

  it("round-trips the sizes the author picked", () => {
    saveGraphPrefs({ avatarSize: "large", nameSize: "small" });

    expect(loadGraphPrefs()).toEqual({ avatarSize: "large", nameSize: "small" });
    expect(JSON.parse(localStorage.getItem(GRAPH_PREFS_KEY) || "{}")).toEqual({
      avatarSize: "large",
      nameSize: "small",
    });
  });

  it("falls back per field, so one bad value does not reset the other", () => {
    // The pair is stored as one object; reading it as one object would let a single
    // unknown value take the field beside it down too.
    expect(normalizeGraphPrefs({ avatarSize: "huge", nameSize: "large" })).toEqual({
      avatarSize: defaultGraphPrefs.avatarSize,
      nameSize: "large",
    });
  });

  it("survives anything that is not an object at all", () => {
    for (const value of [null, "large", 7, ["large"], undefined]) {
      expect(normalizeGraphPrefs(value)).toEqual(defaultGraphPrefs);
    }
  });

  it("degrades to the defaults rather than throwing on unparsable storage", () => {
    localStorage.setItem(GRAPH_PREFS_KEY, "{not json");

    expect(loadGraphPrefs()).toEqual(defaultGraphPrefs);
  });

  it("grows the node, the glyph and the name drop together", () => {
    // Three numbers describe one circle and the name hanging off it, so they are
    // one choice: a larger node with a small glyph in the middle of it is not a
    // sensible state to be able to store.
    for (const size of AVATAR_SIZES) {
      const metrics = graphMetrics({ avatarSize: size.value, nameSize: "medium" });

      expect(metrics.radius).toBe(size.radius);
      expect(metrics.emojiSize).toBe(size.emojiSize);
      expect(metrics.nameDrop).toBe(size.nameDrop);
      expect(metrics.nameDrop).toBeGreaterThan(metrics.radius);
    }
  });

  it("keeps every name size inside its own avatar size", () => {
    for (const avatar of AVATAR_SIZES) {
      for (const name of NAME_SIZES) {
        const metrics = graphMetrics({ avatarSize: avatar.value, nameSize: name.value });

        expect(metrics.nameSize).toBe(name.fontSize);
        expect(metrics.nameSpace).toBe(name.nameSpace);
        // A name taller than the room reserved under the node is a clipped name.
        expect(metrics.nameSpace).toBeGreaterThan(metrics.nameSize);
      }
    }
  });
});
