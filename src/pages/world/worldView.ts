// Filtering, hierarchy and reading helpers for the world-building screen.
//
// Out of the component because these are the rules the screen is judged by — which
// entries are shown, at what depth, and which parent a child may take — and they are
// worth testing without a DOM. Nothing here writes, reorders or repairs: the stored
// order is the display order, and storage stays the only thing that fixes a bad parent.
import { WORLD_CATEGORIES, type WorldEntry, type WorldEntryCategory } from "../../types/world";

export const EVERY_CATEGORY = "全部分类";

export const PARENT_FILTERS = [
  { value: "any", label: "层级不限" },
  { value: "root", label: "仅顶层" },
  { value: "child", label: "仅有上级" },
] as const;

export const CHARACTER_FILTERS = [
  { value: "any", label: "角色不限" },
  { value: "with", label: "有关联角色" },
  { value: "without", label: "无关联角色" },
] as const;

export type ParentFilter = (typeof PARENT_FILTERS)[number]["value"];
export type CharacterFilter = (typeof CHARACTER_FILTERS)[number]["value"];

export type WorldFilter = {
  query: string;
  category: WorldEntryCategory | typeof EVERY_CATEGORY;
  parent: ParentFilter;
  characters: CharacterFilter;
};

export const emptyWorldFilter: WorldFilter = {
  query: "",
  category: EVERY_CATEGORY,
  parent: "any",
  characters: "any",
};

export function isWorldFilterActive(filter: WorldFilter): boolean {
  return (
    filter.query.trim() !== "" ||
    filter.category !== EVERY_CATEGORY ||
    filter.parent !== "any" ||
    filter.characters !== "any"
  );
}

/** Leading and trailing spaces are not a term, and case is not a distinction. */
export function normalizeWorldQuery(value: string): string {
  return value.trim().toLowerCase();
}

/** How many entries each category holds, in the declared category order. */
export function worldCategoryCounts(entries: WorldEntry[]): Array<{
  value: WorldEntryCategory | typeof EVERY_CATEGORY;
  label: string;
  count: number;
}> {
  const all: { value: WorldEntryCategory | typeof EVERY_CATEGORY; label: string; count: number } = {
    value: EVERY_CATEGORY,
    label: EVERY_CATEGORY,
    count: entries.length,
  };

  return [
    all,
    ...WORLD_CATEGORIES.map((category) => ({
      value: category.value,
      label: category.label,
      count: entries.filter((entry) => entry.category === category.value).length,
    })),
  ];
}

export type WorldNameLookup = (characterId: string) => string | undefined;

/**
 * Whether one entry matches. The search covers what a reader would look for an entry
 * by: its name, its summary, its details, its tags, and the names of the characters
 * filed under it.
 */
export function matchesWorldFilter(
  entry: WorldEntry,
  filter: WorldFilter,
  nameOf: WorldNameLookup,
): boolean {
  if (filter.category !== EVERY_CATEGORY && entry.category !== filter.category) {
    return false;
  }

  if (filter.parent === "root" && entry.parentId) {
    return false;
  }

  if (filter.parent === "child" && !entry.parentId) {
    return false;
  }

  if (filter.characters === "with" && entry.characterIds.length === 0) {
    return false;
  }

  if (filter.characters === "without" && entry.characterIds.length > 0) {
    return false;
  }

  const needle = normalizeWorldQuery(filter.query);
  if (!needle) {
    return true;
  }

  const haystack = [
    entry.name,
    entry.summary ?? "",
    entry.details ?? "",
    ...entry.tags,
    // Through the lookup rather than the id: a name is what a reader searches by.
    ...entry.characterIds.map((id) => nameOf(id) ?? ""),
  ]
    .join("\n")
    .toLowerCase();

  return haystack.includes(needle);
}

/** Ids of everything below this entry, at any depth. */
export function worldDescendantIds(entries: WorldEntry[], id: string): Set<string> {
  const byParent = new Map<string, WorldEntry[]>();
  for (const entry of entries) {
    if (!entry.parentId) {
      continue;
    }
    const bucket = byParent.get(entry.parentId);
    if (bucket) {
      bucket.push(entry);
    } else {
      byParent.set(entry.parentId, [entry]);
    }
  }

  const descendants = new Set<string>();
  // Breadth-first over the children map, with a visited set: a stored cycle would
  // otherwise make this run forever, and storage only repairs one on the next write.
  const queue = [...(byParent.get(id) ?? [])];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (descendants.has(current.id)) {
      continue;
    }
    descendants.add(current.id);
    queue.push(...(byParent.get(current.id) ?? []));
  }

  return descendants;
}

/**
 * The entries this one may take as a parent: not itself, and nothing below it — which
 * is exactly the set that cannot close a loop, so the list and the rule agree.
 */
export function worldParentOptions(entries: WorldEntry[], id: string | undefined): WorldEntry[] {
  if (!id) {
    return entries;
  }
  const blocked = worldDescendantIds(entries, id);
  blocked.add(id);
  return entries.filter((entry) => !blocked.has(entry.id));
}

/** The chain of ancestors, outermost first. Used for the path shown on a row. */
export function worldPathOf(entries: WorldEntry[], id: string): WorldEntry[] {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const path: WorldEntry[] = [];
  const seen = new Set<string>([id]);
  let cursor = byId.get(id)?.parentId;

  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    const parent = byId.get(cursor);
    if (!parent) {
      break;
    }
    path.unshift(parent);
    cursor = parent.parentId;
  }

  return path;
}

export type WorldTreeRow = {
  entry: WorldEntry;
  /** Nesting level, 0 for a root. */
  depth: number;
  hasChildren: boolean;
  /** How many entries sit directly under this one. */
  childCount: number;
  /** True when the row is only here because something below it matched. */
  viaPath: boolean;
};

// Indentation stops growing: at depth 12 an unbounded 16px per level leaves no room for
// the name. Children are still nested — they simply stop moving further right.
export const WORLD_INDENT_STEP = 16;
export const WORLD_INDENT_MAX_DEPTH = 4;

export function worldIndent(depth: number): number {
  return Math.min(depth, WORLD_INDENT_MAX_DEPTH) * WORLD_INDENT_STEP;
}

/**
 * The rows the tree draws, in stored order.
 *
 * With no filter this is the hierarchy as stored: roots, and the children of anything
 * not collapsed. With a filter it is the matches **plus the path down to them** —
 * a match whose parent happens to be collapsed must still be reachable, so the path is
 * shown whether or not the branch is open, and it is marked as a path rather than a
 * match. Descendants of a match are not added: what the reader asked for is the entry.
 */
export function worldTreeRows(
  entries: WorldEntry[],
  options: {
    filter: WorldFilter;
    nameOf: WorldNameLookup;
    collapsed: Set<string>;
    isFilterActive: boolean;
    maxDepth?: number;
  },
): WorldTreeRow[] {
  const { filter, nameOf, collapsed, isFilterActive } = options;
  const maxDepth = options.maxDepth ?? 12;
  const byParent = new Map<string | undefined, WorldEntry[]>();
  for (const entry of entries) {
    const key = entry.parentId ?? undefined;
    const bucket = byParent.get(key);
    if (bucket) {
      bucket.push(entry);
    } else {
      byParent.set(key, [entry]);
    }
  }

  const matches = new Set(
    isFilterActive
      ? entries.filter((entry) => matchesWorldFilter(entry, filter, nameOf)).map((entry) => entry.id)
      : [],
  );

  // Everything on the path from a match up to its root, so a match is never hidden by
  // an ancestor's collapsed state.
  const onPath = new Set<string>();
  if (isFilterActive) {
    const byId = new Map(entries.map((entry) => [entry.id, entry]));
    for (const id of matches) {
      let cursor = byId.get(id)?.parentId;
      const seen = new Set<string>([id]);
      while (cursor && !seen.has(cursor)) {
        seen.add(cursor);
        onPath.add(cursor);
        cursor = byId.get(cursor)?.parentId;
      }
    }
  }

  const rows: WorldTreeRow[] = [];

  function walk(parentId: string | undefined, depth: number) {
    if (depth > maxDepth) {
      return;
    }
    for (const entry of byParent.get(parentId) ?? []) {
      const children = byParent.get(entry.id) ?? [];
      const matched = matches.has(entry.id);
      const path = onPath.has(entry.id);

      if (isFilterActive && !matched && !path) {
        continue;
      }

      rows.push({
        entry,
        depth,
        hasChildren: children.length > 0,
        childCount: children.length,
        viaPath: isFilterActive && !matched,
      });

      // While filtering, a branch opens because something under it matched; a matching
      // entry does not drag its own children in.
      const open = isFilterActive ? path : !collapsed.has(entry.id);
      if (open) {
        walk(entry.id, depth + 1);
      }
    }
  }

  walk(undefined, 0);
  return rows;
}
