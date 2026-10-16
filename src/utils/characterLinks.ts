// What a character is connected to, read out of the data that already records it.
//
// Every function here answers its question by scanning the stored records, and none of
// them writes anything back: a link exists because a relationship names the character,
// an event lists them, or an entry files them. Nothing is cached in a second place, so
// deleting one of those records is enough to remove the link.
//
// Identity is always the id. Two characters may share a name — a name is a label, and
// matching on one would attach a stranger's events to this character.
import { sortTimeline } from "../storage/timelineStorage";
import { isSymmetricKind, relationshipKindLabel } from "../types/relationship";
import type { Relationship } from "../types/relationship";
import type { TimelineEvent } from "../types/timeline";
import type { WorldEntry } from "../types/world";

/** How many of each kind a preview shows before offering the rest. */
export const RELATED_PREVIEW_LIMIT = 3;

/** The relationships this character is an end of, in stored order. */
export function relationshipsOf(relationships: Relationship[], characterId: string): Relationship[] {
  return relationships.filter(
    (relationship) => relationship.fromId === characterId || relationship.toId === characterId,
  );
}

/** The other end of an edge, from this character's point of view. */
export function relationshipPeerId(relationship: Relationship, characterId: string): string {
  return relationship.fromId === characterId ? relationship.toId : relationship.fromId;
}

/**
 * What the kind means from where this character stands. The stored direction is kept —
 * 师承 A→B and 师承 B→A are different records — so the row can state it rather than
 * flatten it into a symmetric label.
 */
export function relationshipDirectionLabel(relationship: Relationship, characterId: string): string {
  const label = relationshipKindLabel(relationship.kind);

  if (isSymmetricKind(relationship.kind)) {
    return label;
  }

  return relationship.fromId === characterId
    ? `${label} · 此角色为${label}方`
    : `${label} · 对方为${label}方`;
}

/** The events this character appears in, under the timeline's own ordering rule. */
export function timelineEventsOf(events: TimelineEvent[], characterId: string): TimelineEvent[] {
  const related = events.filter((event) => event.characterIds.includes(characterId));

  // Sorted with the same function the timeline screen uses, so the preview and the
  // timeline never disagree about what "first" means.
  return sortTimeline(related);
}

/** The world entries that name this character, in stored order. */
export function worldEntriesOf(entries: WorldEntry[], characterId: string): WorldEntry[] {
  return entries.filter((entry) => entry.characterIds.includes(characterId));
}

export type RelatedCounts = {
  relationships: number;
  events: number;
  entries: number;
};

/** The three counts, for the summary line and for deciding what to draw at all. */
export function relatedCounts(input: {
  relationships: Relationship[];
  events: TimelineEvent[];
  entries: WorldEntry[];
  characterId: string;
}): RelatedCounts {
  return {
    relationships: relationshipsOf(input.relationships, input.characterId).length,
    events: timelineEventsOf(input.events, input.characterId).length,
    entries: worldEntriesOf(input.entries, input.characterId).length,
  };
}
