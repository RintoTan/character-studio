// Persistence for world entries, in the same shape as the other stores.
//
// Two things are repaired on read rather than trusted: a parentId that points at
// an entry which no longer exists, and a hierarchy that has become a cycle (which
// a hand-edited file can contain even though the write paths refuse to create it).
import {
  isWorldCategory,
  worldCategoryOrder,
  wouldCreateWorldCycle,
  type WorldEntry,
  type WorldEntryCategory,
} from "../types/world";

export const WORLD_KEY = "character-studio.world";

const EPOCH = new Date(0).toISOString();

function normalise(raw: unknown): WorldEntry | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const candidate = raw as Partial<WorldEntry>;
  if (!candidate.id) {
    return null;
  }

  const name = typeof candidate.name === "string" ? candidate.name.trim() : "";
  if (!name) {
    return null;
  }

  const strings = (value: unknown) =>
    Array.isArray(value)
      ? [...new Set(value.filter((item): item is string => typeof item === "string" && !!item.trim()))]
      : [];

  return {
    id: String(candidate.id),
    name,
    category: isWorldCategory(candidate.category) ? candidate.category : "other",
    parentId: typeof candidate.parentId === "string" && candidate.parentId ? candidate.parentId : undefined,
    summary: typeof candidate.summary === "string" && candidate.summary.trim() ? candidate.summary : undefined,
    details: typeof candidate.details === "string" && candidate.details.trim() ? candidate.details : undefined,
    tags: strings(candidate.tags),
    characterIds: strings(candidate.characterIds),
    createdAt: typeof candidate.createdAt === "string" ? candidate.createdAt : EPOCH,
    updatedAt: typeof candidate.updatedAt === "string" ? candidate.updatedAt : EPOCH,
  };
}

/** Sorted by category, then name, so the list reads the same way every time. */
export function sortWorldEntries(entries: WorldEntry[]): WorldEntry[] {
  return [...entries].sort(
    (a, b) =>
      worldCategoryOrder(a.category) - worldCategoryOrder(b.category) ||
      a.name.localeCompare(b.name, "zh-Hans-CN"),
  );
}

export function loadWorldEntries(): WorldEntry[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(WORLD_KEY) || "[]");
    if (!Array.isArray(parsed)) {
      return [];
    }

    const seen = new Set<string>();
    const entries: WorldEntry[] = [];
    for (const raw of parsed) {
      const entry = normalise(raw);
      if (!entry || seen.has(entry.id)) {
        continue;
      }
      seen.add(entry.id);
      entries.push(entry);
    }

    const ids = new Set(entries.map((entry) => entry.id));
    const repaired = entries.map((entry) => {
      // A parent that is gone, a self-parent, or a cycle, is dropped rather than
      // left to break tree rendering.
      if (!entry.parentId || !ids.has(entry.parentId)) {
        return entry.parentId ? { ...entry, parentId: undefined } : entry;
      }
      if (wouldCreateWorldCycle(entries, entry.id, entry.parentId)) {
        return { ...entry, parentId: undefined };
      }
      return entry;
    });

    return sortWorldEntries(repaired);
  } catch {
    return [];
  }
}

export function saveWorldEntries(entries: WorldEntry[]): void {
  try {
    localStorage.setItem(WORLD_KEY, JSON.stringify(sortWorldEntries(entries)));
  } catch {
    // A full quota must not take the screen down with it.
  }
}

export function upsertWorldEntry(entry: WorldEntry): WorldEntry[] {
  const entries = loadWorldEntries();
  const index = entries.findIndex((candidate) => candidate.id === entry.id);
  if (index === -1) {
    entries.push(entry);
  } else {
    entries[index] = entry;
  }
  saveWorldEntries(entries);
  return loadWorldEntries();
}

/** Deleting an entry detaches its children instead of deleting them with it. */
export function deleteWorldEntry(id: string): WorldEntry[] {
  const remaining = loadWorldEntries()
    .filter((entry) => entry.id !== id)
    .map((entry) => (entry.parentId === id ? { ...entry, parentId: undefined } : entry));
  saveWorldEntries(remaining);
  return loadWorldEntries();
}

export function pruneWorldCharacters(validCharacterIds: Iterable<string>): WorldEntry[] {
  const valid = new Set(validCharacterIds);
  const entries = loadWorldEntries();
  const pruned = entries.map((entry) => {
    const characterIds = entry.characterIds.filter((id) => valid.has(id));
    return characterIds.length === entry.characterIds.length ? entry : { ...entry, characterIds };
  });
  saveWorldEntries(pruned);
  return loadWorldEntries();
}

export function worldChildren(entries: WorldEntry[], parentId: string | undefined): WorldEntry[] {
  return entries.filter((entry) => (entry.parentId ?? undefined) === parentId);
}

export function entriesForCharacter(characterId: string): WorldEntry[] {
  return loadWorldEntries().filter((entry) => entry.characterIds.includes(characterId));
}

export function createWorldEntry(input: {
  name: string;
  category: WorldEntryCategory;
  parentId?: string;
  summary?: string;
  details?: string;
  tags?: string[];
  characterIds?: string[];
}): WorldEntry | null {
  const name = input.name.trim();
  if (!name) {
    return null;
  }

  // Refuse a parent link that would close a loop rather than storing it.
  const existing = loadWorldEntries();
  const parentId =
    input.parentId && !wouldCreateWorldCycle(existing, "new", input.parentId)
      ? input.parentId
      : undefined;

  const now = new Date().toISOString();
  return {
    id: `world-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    name,
    category: input.category,
    parentId,
    summary: input.summary?.trim() ? input.summary.trim() : undefined,
    details: input.details?.trim() ? input.details.trim() : undefined,
    tags: [...new Set((input.tags ?? []).map((tag) => tag.trim()).filter(Boolean))],
    characterIds: [...new Set(input.characterIds ?? [])],
    createdAt: now,
    updatedAt: now,
  };
}
