// Relationships between characters, the first 2.0 domain.
//
// Kept as its own collection rather than embedded in the character record: an
// edge belongs to two characters, and storing a copy on each side is how the two
// copies drift apart. Characters keep their free-text relationshipKeywords field
// for prose; these edges are the structured graph.
export type RelationshipKind =
  | "family"
  | "mentor"
  | "friend"
  | "rival"
  | "enemy"
  | "colleague"
  | "romance"
  | "other";

export type Relationship = {
  id: string;
  /** Character the relationship is described from. */
  fromId: string;
  /** Character it points at. */
  toId: string;
  kind: RelationshipKind;
  note?: string;
  createdAt: string;
  updatedAt: string;
};

export const RELATIONSHIP_KINDS: Array<{ value: RelationshipKind; label: string; symmetric: boolean }> = [
  { value: "family", label: "亲属", symmetric: true },
  { value: "mentor", label: "师承", symmetric: false },
  { value: "friend", label: "友人", symmetric: true },
  { value: "rival", label: "对手", symmetric: true },
  { value: "enemy", label: "敌对", symmetric: true },
  { value: "colleague", label: "同僚", symmetric: true },
  { value: "romance", label: "情感", symmetric: true },
  { value: "other", label: "其他", symmetric: true },
];

export function relationshipKindLabel(kind: RelationshipKind): string {
  return RELATIONSHIP_KINDS.find((entry) => entry.value === kind)?.label ?? "其他";
}

export function isRelationshipKind(value: unknown): value is RelationshipKind {
  return typeof value === "string" && RELATIONSHIP_KINDS.some((entry) => entry.value === value);
}

// `symmetric` was declared here from the first version but nothing read it: every
// edge was drawn as an arrow, so 友人 between two people read as one of them
// befriending the other. It now decides three things — whether the edge carries an
// arrow head, whether the pair reads as "↔" instead of "→", and whether the reverse
// of the same pair is a duplicate rather than a second relationship.
export function isSymmetricKind(kind: RelationshipKind): boolean {
  return RELATIONSHIP_KINDS.find((entry) => entry.value === kind)?.symmetric ?? true;
}

/** The two characters as an unordered pair: what a symmetric kind relates. */
export function unorderedPairKey(fromId: string, toId: string): string {
  return fromId <= toId ? `${fromId}~${toId}` : `${toId}~${fromId}`;
}

/**
 * The same relationship, already stored.
 *
 * Two ways to be the same: written the other way round with a symmetric kind —
 * 友人 A→B and 友人 B→A are one fact typed twice — or written twice in the same
 * direction, which storage already drops on read. Both are refused up front, with a
 * reason: a save that silently does nothing is indistinguishable from a broken
 * button. 师承 A→B and 师承 B→A are *not* duplicates: each of them mentors the other.
 */
export function findDuplicateRelationship(
  relationships: Relationship[],
  fromId: string,
  toId: string,
  kind: RelationshipKind,
): Relationship | undefined {
  const symmetric = isSymmetricKind(kind);

  return relationships.find((entry) => {
    if (entry.kind !== kind) {
      return false;
    }

    if (entry.fromId === fromId && entry.toId === toId) {
      return true;
    }

    return symmetric && entry.fromId === toId && entry.toId === fromId;
  });
}
