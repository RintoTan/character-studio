import { describe, expect, it } from "vitest";
import { neighbourPreview, type NeighbourRelationship } from "../src/utils/graphNeighbours";

function ring(count: number): NeighbourRelationship[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `r-${index}`,
    fromId: "hero",
    toId: `n-${index}`,
    kind: "friend",
  }));
}

describe("explore panel neighbour preview", () => {
  it("returns nothing when no single character is selected", () => {
    expect(neighbourPreview(ring(3), null)).toBeNull();
  });

  it("lists every direct relation on a small network", () => {
    const preview = neighbourPreview(ring(5), "hero");

    expect(preview?.total).toBe(5);
    expect(preview?.rows).toHaveLength(5);
    expect(preview?.hidden).toBe(0);
    expect(preview?.rows[0]).toEqual({ id: "r-0", otherId: "n-0", kind: "friend" });
  });

  it("caps the list on a large network and counts the rest", () => {
    const preview = neighbourPreview(ring(99), "hero");

    expect(preview?.total).toBe(99);
    expect(preview?.shown).toBe(8);
    expect(preview?.hidden).toBe(91);
  });

  it("counts relations in both directions as this character's own", () => {
    const relationships: NeighbourRelationship[] = [
      { id: "a", fromId: "hero", toId: "x", kind: "friend" },
      { id: "b", fromId: "y", toId: "hero", kind: "rival" },
      { id: "c", fromId: "x", toId: "y", kind: "family" },
    ];
    const preview = neighbourPreview(relationships, "hero");

    expect(preview?.total).toBe(2);
    expect(preview?.rows.map((row) => row.otherId)).toEqual(["x", "y"]);
  });

  it("never reports a negative remainder", () => {
    const preview = neighbourPreview(ring(2), "hero", 8);

    expect(preview?.hidden).toBe(0);
  });
});
