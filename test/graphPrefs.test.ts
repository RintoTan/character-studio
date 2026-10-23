// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import {
  EXPORT_SCALES,
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
    saveGraphPrefs({
      avatarSize: "large",
      nameSize: "small",
      showAvatars: false,
      showNames: true,
      forceNames: false,
      showEdges: false,
      exportScale: 3,
      exportLegend: false,
      exportLegendCorner: "auto",
      exportLegendScale: 1,
      exportLegendMargin: 0.02,
      exportLegendBg: "canvas",
      exportLegendOpacity: 0.94,
      exportLockAspect: true,
    });

    expect(loadGraphPrefs()).toEqual({
      avatarSize: "large",
      nameSize: "small",
      showAvatars: false,
      showNames: true,
      forceNames: false,
      showEdges: false,
      exportScale: 3,
      exportLegend: false,
      exportLegendCorner: "auto",
      exportLegendScale: 1,
      exportLegendMargin: 0.02,
      exportLegendBg: "canvas",
      exportLegendOpacity: 0.94,
      exportLockAspect: true,
    });
    expect(JSON.parse(localStorage.getItem(GRAPH_PREFS_KEY) || "{}")).toEqual({
      avatarSize: "large",
      nameSize: "small",
      showAvatars: false,
      showNames: true,
      forceNames: false,
      showEdges: false,
      exportScale: 3,
      exportLegend: false,
      exportLegendCorner: "auto",
      exportLegendScale: 1,
      exportLegendMargin: 0.02,
      exportLegendBg: "canvas",
      exportLegendOpacity: 0.94,
      exportLockAspect: true,
    });
  });

  it("falls back per field, so one bad value does not reset the others", () => {
    // The settings are stored as one object; reading it as one object would let
    // a single unknown value take the fields beside it down too.
    expect(normalizeGraphPrefs({ avatarSize: "huge", nameSize: "large", exportScale: 9 })).toEqual({
      avatarSize: defaultGraphPrefs.avatarSize,
      nameSize: "large",
      showAvatars: defaultGraphPrefs.showAvatars,
      showNames: defaultGraphPrefs.showNames,
      forceNames: defaultGraphPrefs.forceNames,
      showEdges: defaultGraphPrefs.showEdges,
      exportScale: defaultGraphPrefs.exportScale,
      exportLegend: defaultGraphPrefs.exportLegend,
      exportLegendCorner: defaultGraphPrefs.exportLegendCorner,
      exportLegendScale: defaultGraphPrefs.exportLegendScale,
      exportLegendMargin: defaultGraphPrefs.exportLegendMargin,
      exportLegendBg: defaultGraphPrefs.exportLegendBg,
      exportLegendOpacity: defaultGraphPrefs.exportLegendOpacity,
      exportLockAspect: defaultGraphPrefs.exportLockAspect,
    });
  });

  it("reads a record written before the visibility switches existed as visible", () => {
    // A stored object from the previous version has neither key. Reading a missing
    // field as false would turn both off for every existing author on upgrade.
    expect(normalizeGraphPrefs({ avatarSize: "large", nameSize: "small", exportScale: 3 })).toEqual({
      avatarSize: "large",
      nameSize: "small",
      showAvatars: true,
      showNames: true,
      forceNames: false,
      showEdges: true,
      exportScale: 3,
      exportLegend: false,
      exportLegendCorner: "auto",
      exportLegendScale: 1,
      exportLegendMargin: 0.02,
      exportLegendBg: "canvas",
      exportLegendOpacity: 0.94,
      exportLockAspect: true,
    });

    // The same for a value of the wrong type: only an explicit boolean is honoured,
    // and the fields beside it are untouched.
    for (const value of ["no", 0, 1, null, undefined]) {
      const prefs = normalizeGraphPrefs({ showAvatars: value, showNames: value, avatarSize: "large" });

      expect(prefs.showAvatars).toBe(true);
      expect(prefs.showNames).toBe(true);
      expect(prefs.avatarSize).toBe("large");
    }

    expect(normalizeGraphPrefs({ showAvatars: false, showNames: false }).showAvatars).toBe(false);
  });

  it("reads a record written before 显示关系线 existed as drawing the lines", () => {
    // Hiding the lines is a new switch. A workspace saved by 2.40.0 has no key for it,
    // and reading that as false would open every existing drawing with its
    // relationships invisible.
    expect(normalizeGraphPrefs({ avatarSize: "large", nameSize: "small", exportScale: 2 }).showEdges).toBe(
      true,
    );
    expect(normalizeGraphPrefs({ showEdges: false }).showEdges).toBe(false);
    for (const value of ["no", 0, 1, null, undefined]) {
      expect(normalizeGraphPrefs({ showEdges: value }).showEdges).toBe(true);
    }
  });

  it("only accepts the export resolutions it offers", () => {
    for (const value of EXPORT_SCALES) {
      expect(normalizeGraphPrefs({ exportScale: value.value }).exportScale).toBe(value.value);
    }

    // 0 would produce an empty file and 10 a several-hundred-megabyte one.
    for (const value of [0, 4, 10, -2, 2.5, "2", null]) {
      expect(normalizeGraphPrefs({ exportScale: value }).exportScale).toBe(
        defaultGraphPrefs.exportScale,
      );
    }
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
