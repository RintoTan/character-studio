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
