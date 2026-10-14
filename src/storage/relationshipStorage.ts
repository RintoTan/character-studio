// Persistence for the relationship graph, in the same shape as characterStorage:
// one localStorage key, everything normalised on read, and a corrupted value
// degrades to an empty list rather than throwing.
import { isRelationshipKind, type Relationship } from "../types/relationship";

export const RELATIONSHIPS_KEY = "character-studio.relationships";

function normalise(raw: unknown): Relationship | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const candidate = raw as Partial<Relationship>;
  const fromId = typeof candidate.fromId === "string" ? candidate.fromId : "";
  const toId = typeof candidate.toId === "string" ? candidate.toId : "";
  if (!candidate.id || !fromId || !toId) {
    return null;
  }

  // A character related to itself carries no information in a graph view.
  if (fromId === toId) {
    return null;
  }

  const timestamp = new Date(0).toISOString();
  return {
    id: String(candidate.id),
    fromId,
    toId,
    // An unknown kind from a newer or hand-edited file still renders.
    kind: isRelationshipKind(candidate.kind) ? candidate.kind : "other",
    note: typeof candidate.note === "string" && candidate.note ? candidate.note : undefined,
    createdAt: typeof candidate.createdAt === "string" ? candidate.createdAt : timestamp,
    updatedAt: typeof candidate.updatedAt === "string" ? candidate.updatedAt : timestamp,
  };
}

export function loadRelationships(): Relationship[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(RELATIONSHIPS_KEY) || "[]");
    if (!Array.isArray(parsed)) {
      return [];
    }

    const seen = new Set<string>();
    const result: Relationship[] = [];
    for (const entry of parsed) {
      const relationship = normalise(entry);
      if (!relationship) {
        continue;
      }
      // The same pair in the same direction twice is a duplicate edge.
      const dedupeKey = `${relationship.fromId}->${relationship.toId}:${relationship.kind}`;
      if (seen.has(dedupeKey)) {
        continue;
      }
      seen.add(dedupeKey);
      result.push(relationship);
    }
    return result;
  } catch {
    return [];
  }
}

export function saveRelationships(relationships: Relationship[]): void {
  try {
    localStorage.setItem(RELATIONSHIPS_KEY, JSON.stringify(relationships));
  } catch {
    // A full quota must not take the screen down with it.
  }
}

export function upsertRelationship(relationship: Relationship): Relationship[] {
  const relationships = loadRelationships();
  const index = relationships.findIndex((entry) => entry.id === relationship.id);
  if (index === -1) {
    relationships.push(relationship);
  } else {
    relationships[index] = relationship;
  }
  saveRelationships(relationships);
  return relationships;
}

export function deleteRelationship(id: string): Relationship[] {
  const remaining = loadRelationships().filter((entry) => entry.id !== id);
  saveRelationships(remaining);
  return remaining;
}

/**
 * Drops edges whose endpoints no longer exist. Called after characters are
 * deleted or an import replaces the character list, so the graph cannot point at
 * characters that are gone.
 */
export function pruneRelationships(validCharacterIds: Iterable<string>): Relationship[] {
  const valid = new Set(validCharacterIds);
  const pruned = loadRelationships().filter(
    (entry) => valid.has(entry.fromId) && valid.has(entry.toId),
  );
  saveRelationships(pruned);
  return pruned;
}

/** Every edge touching a character, in either direction. */
export function relationshipsFor(characterId: string): Relationship[] {
  return loadRelationships().filter(
    (entry) => entry.fromId === characterId || entry.toId === characterId,
  );
}

export function createRelationship(
  fromId: string,
  toId: string,
  kind: Relationship["kind"],
  note?: string,
): Relationship {
  const now = new Date().toISOString();
  return {
    id: `rel-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    fromId,
    toId,
    kind,
    note: note?.trim() ? note.trim() : undefined,
    createdAt: now,
    updatedAt: now,
  };
}
