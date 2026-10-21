import { describe, expect, it } from "vitest";
import { emphasisLevel, isBackgroundLevel } from "../src/utils/emphasis";

describe("emphasis priority", () => {
  it("puts the object being edited above every looking-tool", () => {
    expect(
      emphasisLevel({ selected: true, spotlightTarget: true, searchHit: true, lensMatch: true }),
    ).toBe("selected");
  });

  it("puts the spotlight target above a search hit and a neighbour", () => {
    expect(emphasisLevel({ spotlightTarget: true, searchHit: true, spotlightNeighbour: true })).toBe(
      "spotlight",
    );
    // A neighbour of the spotlight is one hop away; a search hit is the person the
    // author asked for, so the hit wins.
    expect(emphasisLevel({ searchHit: true, spotlightNeighbour: true })).toBe("search");
    expect(emphasisLevel({ spotlightNeighbour: true, lensMatch: true })).toBe("neighbour");
    expect(emphasisLevel({ lensMatch: true })).toBe("lens");
    expect(emphasisLevel({})).toBe("normal");
  });

  it("never treats an emphasised object as background", () => {
    for (const level of ["selected", "spotlight", "search", "neighbour", "lens"] as const) {
      expect(isBackgroundLevel(level)).toBe(false);
    }
    expect(isBackgroundLevel("normal")).toBe(true);
  });
});
