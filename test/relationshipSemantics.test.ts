import { describe, expect, it } from "vitest";
import {
  RELATIONSHIP_KINDS,
  findDuplicateRelationship,
  isSymmetricKind,
  relationshipKindLabel,
  unorderedPairKey,
  type Relationship,
} from "../src/types/relationship";

function edge(fromId: string, toId: string, kind: Relationship["kind"]): Relationship {
  return {
    id: `${fromId}-${toId}-${kind}`,
    fromId,
    toId,
    kind,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  };
}

describe("relationship direction", () => {
  it("treats friendship, family and rivalry as two-sided", () => {
    for (const kind of ["friend", "family", "rival", "enemy", "romance", "colleague", "other"] as const) {
      expect(isSymmetricKind(kind)).toBe(true);
    }
  });

  it("keeps mentorship one-way", () => {
    expect(isSymmetricKind("mentor")).toBe(false);
  });

  it("declares exactly one directional kind, so the drawing rule is not a guess", () => {
    const directional = RELATIONSHIP_KINDS.filter((entry) => !entry.symmetric).map((entry) => entry.value);

    expect(directional).toEqual(["mentor"]);
  });

  it("names a pair the same way round in both directions", () => {
    expect(unorderedPairKey("a", "b")).toBe(unorderedPairKey("b", "a"));
    expect(unorderedPairKey("a", "b")).not.toBe(unorderedPairKey("a", "c"));
  });

  it("finds the same relationship written the other way round", () => {
    const relationships = [edge("b", "a", "friend")];

    expect(findDuplicateRelationship(relationships, "a", "b", "friend")?.id).toBe("b-a-friend");
  });

  it("finds the same relationship written twice in the same direction", () => {
    // Storage drops this repeat on read, so it can never be seen; refusing it up
    // front is what keeps a no-op save from reading as a broken button.
    const relationships = [edge("a", "b", "friend")];

    expect(findDuplicateRelationship(relationships, "a", "b", "friend")?.id).toBe("a-b-friend");
  });

  it("does not treat the reverse of a one-way kind as a duplicate", () => {
    // 师承 A→B and 师承 B→A are two facts: each of them mentors the other.
    const relationships = [edge("b", "a", "mentor")];

    expect(findDuplicateRelationship(relationships, "a", "b", "mentor")).toBeUndefined();
    expect(findDuplicateRelationship([edge("a", "b", "mentor")], "a", "b", "mentor")).toBeDefined();
  });

  it("only matches the same kind", () => {
    const relationships = [edge("b", "a", "friend")];

    expect(findDuplicateRelationship(relationships, "a", "b", "rival")).toBeUndefined();
  });

  it("labels every kind it can store", () => {
    for (const kind of RELATIONSHIP_KINDS) {
      expect(relationshipKindLabel(kind.value)).toBe(kind.label);
    }
  });
});
