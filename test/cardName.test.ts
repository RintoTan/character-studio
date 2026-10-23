// A card draws its own name inside its body, so the canvas suppresses the outside label
// — that is why a card at 0.28x zoom had no readable name while the round node next to
// it got the pinned one. These cases pin the hand-back point: the in-card name is drawn
// while it is worth reading, and below that the canvas names the card like any node.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { cardNameVisible } from "../src/utils/labelDensity";

describe("a card keeps its own name only while that name can be read", () => {
  it("draws the in-card name at reading zoom", () => {
    expect(cardNameVisible({ nameSize: 14, pxPerUnit: 0.63 })).toBe(true);
    expect(cardNameVisible({ nameSize: 15, pxPerUnit: 1.2 })).toBe(true);
  });

  it("hands it back below six screen pixels", () => {
    // The hundred-node canvas: a 4px name inside an 8px card body.
    expect(cardNameVisible({ nameSize: 15, pxPerUnit: 0.28 })).toBe(false);
    expect(cardNameVisible({ nameSize: 9, pxPerUnit: 0.4 })).toBe(false);
  });

  it("puts the boundary at the floor, not either side of it", () => {
    expect(cardNameVisible({ nameSize: 10, pxPerUnit: 0.6, floorPx: 6 })).toBe(true);
    expect(cardNameVisible({ nameSize: 10, pxPerUnit: 0.59, floorPx: 6 })).toBe(false);
    expect(cardNameVisible({ nameSize: 10, pxPerUnit: 0.8, floorPx: 9 })).toBe(false);
  });

  it("survives a zero scale instead of dividing by it", () => {
    expect(cardNameVisible({ nameSize: 15, pxPerUnit: 0 })).toBe(false);
    expect(cardNameVisible({ nameSize: 15, pxPerUnit: -1 })).toBe(false);
  });
});

describe("the canvas names a card it can no longer label inside", () => {
  const page = readFileSync(new URL("../src/pages/RelationshipGraph.tsx", import.meta.url), "utf8");

  it("asks the helper before drawing the in-card name", () => {
    expect(page).toMatch(/const cardNameShown =[\s\S]{0,40}geom\.card &&[\s\S]{0,80}cardNameVisible\(/);
    expect(page).toMatch(/\{cardNameShown && \(/);
  });

  it("lets the outside label take over for that card", () => {
    expect(page).toMatch(/labelled && \(!geom\.card \|\| !cardNameShown\)/);
  });

  it("still lifts a selected name, so the fallback is readable", () => {
    expect(page).toMatch(/pinned: \(isSelected && selectedIds\.length === 1\) \|\| isFocused/);
  });
});
