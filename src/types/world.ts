// World-building entries, the third 2.0 domain: locations, factions, species,
// items and concepts that characters and timeline events live inside.
//
// Entries can nest (a city inside a nation), so `parentId` exists — and because a
// hierarchy stored as flat ids can be corrupted into a cycle, every write path
// checks for one rather than trusting the caller.
export type WorldEntryCategory = "location" | "faction" | "species" | "item" | "concept" | "other";

export type WorldEntry = {
  id: string;
  name: string;
  category: WorldEntryCategory;
  /** Parent entry, for hierarchies. Never forms a cycle. */
  parentId?: string;
  summary?: string;
  details?: string;
  tags: string[];
  characterIds: string[];
  createdAt: string;
  updatedAt: string;
};

export const WORLD_CATEGORIES: Array<{ value: WorldEntryCategory; label: string }> = [
  { value: "location", label: "地点" },
  { value: "faction", label: "势力" },
  { value: "species", label: "种族" },
  { value: "item", label: "物品" },
  { value: "concept", label: "概念" },
  { value: "other", label: "其他" },
];

export function worldCategoryLabel(category: WorldEntryCategory): string {
  return WORLD_CATEGORIES.find((entry) => entry.value === category)?.label ?? "其他";
}

export function isWorldCategory(value: unknown): value is WorldEntryCategory {
  return typeof value === "string" && WORLD_CATEGORIES.some((entry) => entry.value === value);
}

export function worldCategoryOrder(category: WorldEntryCategory): number {
  return WORLD_CATEGORIES.findIndex((entry) => entry.value === category);
}

/**
 * True when making `parentId` the parent of `id` would close a loop. Walks up from
 * the proposed parent: if that path reaches `id`, the link is invalid.
 */
export function wouldCreateWorldCycle(
  entries: Array<Pick<WorldEntry, "id" | "parentId">>,
  id: string,
  parentId: string | undefined,
): boolean {
  if (!parentId) {
    return false;
  }
  if (parentId === id) {
    return true;
  }

  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const seen = new Set<string>([id]);
  let cursor: string | undefined = parentId;
  while (cursor) {
    if (seen.has(cursor)) {
      return true;
    }
    seen.add(cursor);
    cursor = byId.get(cursor)?.parentId;
  }
  return false;
}
