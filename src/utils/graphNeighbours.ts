/**
 * The explore panel's opening statement: who the selected character stands next to.
 *
 * A small drawing is readable by naming those relations; a large one needs the lens
 * and the spotlight, so the list is capped and the remainder is only counted. Capping
 * here (not in the view) keeps one rule for both sizes, and keeps a 100-character
 * network from producing an unbounded list inside a phone sheet.
 */

import type { RelationshipKind } from "../types/relationship";

export type NeighbourRelationship = {
  id: string;
  fromId: string;
  toId: string;
  kind: RelationshipKind;
};

export type NeighbourPreview = {
  total: number;
  shown: number;
  hidden: number;
  rows: { id: string; otherId: string; kind: RelationshipKind }[];
};

export function neighbourPreview(
  relationships: readonly NeighbourRelationship[],
  selectedId: string | null,
  limit = 8,
): NeighbourPreview | null {
  if (!selectedId) {
    return null;
  }

  const own = relationships.filter(
    (relationship) =>
      relationship.fromId === selectedId || relationship.toId === selectedId,
  );

  const shown = own.slice(0, Math.max(0, limit));

  return {
    total: own.length,
    shown: shown.length,
    hidden: Math.max(0, own.length - shown.length),
    rows: shown.map((relationship) => ({
      id: relationship.id,
      otherId: relationship.fromId === selectedId ? relationship.toId : relationship.fromId,
      kind: relationship.kind,
    })),
  };
}
