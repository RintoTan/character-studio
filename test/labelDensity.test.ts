import { describe, expect, it } from "vitest";
import { labelDensity, namesNode, pickSpacedLabels } from "../src/utils/labelDensity";

const base = {
  showNames: true,
  exporting: false,
  labelsFit: true,
  compact: false,
  visibleCount: 40,
};

describe("label density", () => {
  it("names every node when they all fit", () => {
    expect(labelDensity(base)).toBe("all");
  });

  it("keeps only the shape-carrying nodes when they do not fit", () => {
    expect(labelDensity({ ...base, labelsFit: false })).toBe("hubs");
  });

  it("turns names off when the reader turned them off, even for an export", () => {
    expect(labelDensity({ ...base, showNames: false })).toBe("none");
    expect(labelDensity({ ...base, showNames: false, exporting: true })).toBe("none");
  });

  it("names everything in an export when names are on", () => {
    expect(labelDensity({ ...base, labelsFit: false, exporting: true })).toBe("all");
  });

  it("gives a phone canvas every name up to twelve nodes", () => {
    expect(labelDensity({ ...base, labelsFit: false, compact: true, visibleCount: 12 })).toBe("all");
    expect(labelDensity({ ...base, labelsFit: false, compact: true, visibleCount: 13 })).toBe("hubs");
    // The phone allowance is only for a phone.
    expect(labelDensity({ ...base, labelsFit: false, compact: false, visibleCount: 12 })).toBe("hubs");
  });
});

describe("which nodes keep their names", () => {
  const nobody = { hovered: false, focused: false, neighbour: false, selected: false, hub: false };

  it("names nobody at all when names are off", () => {
    expect(namesNode("none", { ...nobody, selected: true, hub: true })).toBe(false);
  });

  it("names everybody when they fit", () => {
    expect(namesNode("all", nobody)).toBe(true);
  });

  it("names the selected, focused, neighbours and hubs only", () => {
    expect(namesNode("hubs", nobody)).toBe(false);
    expect(namesNode("hubs", { ...nobody, selected: true })).toBe(true);
    expect(namesNode("hubs", { ...nobody, focused: true })).toBe(true);
    expect(namesNode("hubs", { ...nobody, neighbour: true })).toBe(true);
    expect(namesNode("hubs", { ...nobody, hub: true })).toBe(true);
    expect(namesNode("hubs", { ...nobody, hovered: true })).toBe(true);
  });
});

describe("spacing hub names", () => {
  const at = (id: string, x: number, y: number, weight: number) => ({ id, x, y, weight });

  it("keeps the busiest name when two sit on top of each other", () => {
    const kept = pickSpacedLabels([at("a", 0, 0, 3), at("b", 10, 0, 9)], 50);
    expect(kept.map((item) => item.id)).toEqual(["b"]);
  });

  it("keeps names that have room between them", () => {
    const kept = pickSpacedLabels([at("a", 0, 0, 9), at("b", 120, 0, 8)], 50);
    expect(kept.map((item) => item.id)).toEqual(["a", "b"]);
  });

  it("decides by degree, not by input order", () => {
    const kept = pickSpacedLabels([at("low", 0, 0, 1), at("high", 4, 0, 5), at("far", 200, 0, 2)], 50);
    expect(kept.map((item) => item.id)).toEqual(["high", "far"]);
  });
});
