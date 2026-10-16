// The character list's grouping view: one bucket per worldview, ordered so the
// group an author is most likely to be working in comes first.
//
// Grouping is a view over `visibleCharacters`, never a second copy of it. The
// buckets hold the same Character references the list draws, so a group can
// never disagree with the list about who belongs to it, and collapsing a group
// only decides which rows are drawn.
//
// A search or a filter is a request to see matches, so while one is active every
// group is drawn open: a collapsed group must not be able to hide a character the
// reader just searched for. That override is derived here rather than written
// into the collapse record, so clearing the search restores exactly the state the
// reader left behind.
import type { Character } from "../../types/character";

export const UNGROUPED_WORLDVIEW = "未填写世界观";

export type DashboardGroup = {
  group: string;
  characters: Character[];
  count: number;
};

export type DashboardGroupRow =
  | { kind: "head"; group: string; count: number }
  | { kind: "card"; character: Character };

export function worldviewOf(character: Character): string {
  return (character.worldview || "").trim() || UNGROUPED_WORLDVIEW;
}

export function groupCharactersByWorldview(characters: Character[]): DashboardGroup[] {
  const buckets = new Map<string, Character[]>();

  for (const character of characters) {
    const key = worldviewOf(character);
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.push(character);
    } else {
      buckets.set(key, [character]);
    }
  }

  // Biggest first, ties broken by name so the order never depends on where the
  // characters happen to sit in storage.
  return [...buckets.entries()]
    .map(([group, grouped]) => ({ group, characters: grouped, count: grouped.length }))
    .sort((a, b) => b.count - a.count || a.group.localeCompare(b.group, "zh"));
}

/** `rows` is what the list draws; `groups` is the same computation read as a
 *  group index, so the two can never report different counts. */
export function dashboardGroupRows(
  characters: Character[],
  options: { grouped: boolean; collapsed: Record<string, boolean>; forceExpand?: boolean },
): { rows: DashboardGroupRow[]; groups: DashboardGroup[] } {
  if (!options.grouped) {
    return {
      rows: characters.map((character): DashboardGroupRow => ({ kind: "card", character })),
      groups: [],
    };
  }

  const groups = groupCharactersByWorldview(characters);
  const rows: DashboardGroupRow[] = [];

  for (const entry of groups) {
    rows.push({ kind: "head", group: entry.group, count: entry.count });
    if (options.forceExpand || options.collapsed[entry.group] !== true) {
      for (const character of entry.characters) {
        rows.push({ kind: "card", character });
      }
    }
  }

  return { rows, groups };
}

/** Which of a card's tags to draw and how many are left over. The card has room
 *  for a fixed number of chips, so the remainder is counted here instead of being
 *  silently clipped by the card's own overflow. */
export function summarizeTags(tags: string[], limit: number): { visible: string[]; hidden: number } {
  const safeLimit = Math.max(0, limit);
  return {
    visible: tags.slice(0, safeLimit),
    hidden: Math.max(0, tags.length - safeLimit),
  };
}
