// Keeping the four domains pointing at characters that exist.
//
// Three of the domains reference characters by id: a relationship has two ends, a
// timeline event has participants, a world entry has related characters. When a
// character is deleted those references have to go with it — and the delete had two
// paths, only one of which did that:
//
//   • single delete (editor / preview) called the three prunes;
//   • bulk delete removed the characters and saved, and stopped there.
//
// There is partial self-healing: each domain page prunes its own store against the
// current characters when it mounts (relationship graph, timeline, world book). So
// a bulk delete did not corrupt anything permanently — the dangling ids sat in
// storage until the corresponding page was next opened. What they did do is survive
// long enough to be exported: a backup taken before visiting those pages carried
// ids that no longer resolve, and the import validator drops unresolvable
// references, so restoring that backup would silently lose them.
//
// The two delete paths share this one helper now, so the rule is stated once
// instead of per call site.

import { pruneRelationships } from "./relationshipStorage";
import { pruneTimelineCharacters } from "./timelineStorage";
import { pruneWorldCharacters } from "./worldStorage";

export type ReferenceIntegrityResult = {
  relationships: number;
  timelineEvents: number;
  worldEntries: number;
};

/**
 * Drops every reference to a character that is not in `validCharacterIds`, and
 * returns what is left in each domain. Call it with the surviving characters.
 */
export function pruneCharacterReferences(
  validCharacterIds: Iterable<string>,
): ReferenceIntegrityResult {
  const valid = new Set(validCharacterIds);

  return {
    relationships: pruneRelationships(valid).length,
    timelineEvents: pruneTimelineCharacters(valid).length,
    worldEntries: pruneWorldCharacters(valid).length,
  };
}
