// Backing up the domains that are not characters.
//
// The character list had a full backup long before the relationship graph, the
// timeline and the world book existed, so those three were the only data in the
// app that could not leave the browser. They travel in the same file as the
// characters now, and they are validated on the way in for the same reason the
// character import validates: a backup can be hand-edited, and a relationship that
// points at a character who is not in the file is not a relationship.

import { RELATIONSHIP_KINDS, type Relationship, type RelationshipKind } from "../types/relationship";
import { TIMELINE_EVENT_KINDS, type TimelineEvent, type TimelineEventKind } from "../types/timeline";
import { WORLD_CATEGORIES, type WorldEntry, type WorldEntryCategory } from "../types/world";
import { loadRelationships, saveRelationships } from "./relationshipStorage";
import { loadTimeline, saveTimeline } from "./timelineStorage";
import { loadWorldEntries, saveWorldEntries } from "./worldStorage";

export const WORKSPACE_BACKUP_VERSION = 1;
/** Marks a file that carries the three non-character domains. */
export const WORKSPACE_SECTION_KEY = "workspace";

export type WorkspaceDatasets = {
  relationships: unknown[];
  timeline: unknown[];
  world: unknown[];
};

export type WorkspaceCounts = {
  relationships: number;
  timeline: number;
  world: number;
};

export type DatasetOutcome = {
  items: number;
  added: number;
  updated: number;
  dropped: number;
};

export type WorkspaceApplyResult = {
  relationships: DatasetOutcome;
  timeline: DatasetOutcome;
  world: DatasetOutcome;
};

const emptyOutcome = (): DatasetOutcome => ({ items: 0, added: 0, updated: 0, dropped: 0 });

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function asStringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function isKnownKind<T extends string>(options: ReadonlyArray<{ value: T }>, value: string): value is T {
  return options.some((option) => option.value === value);
}

/** Keeps only the character ids that actually exist after the import. */
function keepKnownIds(value: unknown, validCharacterIds: Set<string>) {
  return asStringArray(value).filter((id) => validCharacterIds.has(id));
}

export function normalizeImportedRelationships(value: unknown, validCharacterIds: Set<string>) {
  const items: Relationship[] = [];
  const seen = new Set<string>();
  let dropped = 0;
  const now = new Date().toISOString();

  for (const raw of Array.isArray(value) ? value : []) {
    const record = asRecord(raw);
    const id = record ? asString(record.id) : "";
    const fromId = record ? asString(record.fromId) : "";
    const toId = record ? asString(record.toId) : "";
    const kind = record ? asString(record.kind) : "";

    if (
      !record ||
      !id ||
      !fromId ||
      !toId ||
      fromId === toId ||
      !isKnownKind(RELATIONSHIP_KINDS as ReadonlyArray<{ value: RelationshipKind }>, kind) ||
      !validCharacterIds.has(fromId) ||
      !validCharacterIds.has(toId) ||
      seen.has(id)
    ) {
      dropped += 1;
      continue;
    }

    seen.add(id);
    items.push({
      id,
      fromId,
      toId,
      kind: kind as RelationshipKind,
      note: asString(record.note) || undefined,
      createdAt: asString(record.createdAt, now),
      updatedAt: asString(record.updatedAt, now),
    });
  }

  return { items, dropped };
}

export function normalizeImportedTimeline(value: unknown, validCharacterIds: Set<string>) {
  const items: TimelineEvent[] = [];
  const seen = new Set<string>();
  let dropped = 0;
  const now = new Date().toISOString();

  for (const raw of Array.isArray(value) ? value : []) {
    const record = asRecord(raw);
    const id = record ? asString(record.id) : "";
    const title = record ? asString(record.title) : "";
    const kind = record ? asString(record.kind) : "";
    const date = record ? asString(record.date) : "";

    if (
      !record ||
      !id ||
      !title ||
      !date ||
      !isKnownKind(TIMELINE_EVENT_KINDS as ReadonlyArray<{ value: TimelineEventKind }>, kind) ||
      seen.has(id)
    ) {
      dropped += 1;
      continue;
    }

    seen.add(id);
    items.push({
      id,
      title,
      date,
      era: asString(record.era) || undefined,
      kind: kind as TimelineEventKind,
      description: asString(record.description) || undefined,
      location: asString(record.location) || undefined,
      characterIds: keepKnownIds(record.characterIds, validCharacterIds),
      createdAt: asString(record.createdAt, now),
      updatedAt: asString(record.updatedAt, now),
    });
  }

  return { items, dropped };
}

export function normalizeImportedWorld(value: unknown, validCharacterIds: Set<string>) {
  const items: WorldEntry[] = [];
  const seen = new Set<string>();
  let dropped = 0;
  const now = new Date().toISOString();

  for (const raw of Array.isArray(value) ? value : []) {
    const record = asRecord(raw);
    const id = record ? asString(record.id) : "";
    const name = record ? asString(record.name) : "";
    const category = record ? asString(record.category) : "";

    if (
      !record ||
      !id ||
      !name ||
      !isKnownKind(WORLD_CATEGORIES as ReadonlyArray<{ value: WorldEntryCategory }>, category) ||
      seen.has(id)
    ) {
      dropped += 1;
      continue;
    }

    seen.add(id);
    items.push({
      id,
      name,
      category: category as WorldEntryCategory,
      parentId: asString(record.parentId) || undefined,
      summary: asString(record.summary) || undefined,
      details: asString(record.details) || undefined,
      tags: asStringArray(record.tags),
      characterIds: keepKnownIds(record.characterIds, validCharacterIds),
      createdAt: asString(record.createdAt, now),
      updatedAt: asString(record.updatedAt, now),
    });
  }

  // A hierarchy stored as flat ids can be corrupted into a cycle by an import, so
  // a parent that is not in the same set is treated as no parent.
  const ids = new Set(items.map((item) => item.id));
  for (const item of items) {
    if (item.parentId && !ids.has(item.parentId)) {
      item.parentId = undefined;
    }
  }

  return { items, dropped };
}

export function readWorkspaceDatasets(): WorkspaceDatasets {
  return {
    relationships: loadRelationships(),
    timeline: loadTimeline(),
    world: loadWorldEntries(),
  };
}

/** Pulls the three datasets out of an arbitrary parsed JSON payload. */
export function extractWorkspaceDatasets(value: unknown): WorkspaceDatasets | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  // Either the arrays sit at the top level of a full backup, or under `workspace`
  // in the ZIP manifest form.
  const nested = asRecord(record[WORKSPACE_SECTION_KEY]);
  const source = nested ?? record;
  const relationships = Array.isArray(source.relationships) ? source.relationships : null;
  const timeline = Array.isArray(source.timeline) ? source.timeline : null;
  const world = Array.isArray(source.world) ? source.world : null;

  if (!relationships && !timeline && !world) {
    return null;
  }

  return {
    relationships: relationships ?? [],
    timeline: timeline ?? [],
    world: world ?? [],
  };
}

export function countWorkspaceDatasets(datasets: WorkspaceDatasets): WorkspaceCounts {
  return {
    relationships: datasets.relationships.length,
    timeline: datasets.timeline.length,
    world: datasets.world.length,
  };
}

function mergeById<T extends { id: string; updatedAt?: string }>(
  current: T[],
  incoming: T[],
): { items: T[]; added: number; updated: number } {
  const byId = new Map(current.map((item) => [item.id, item]));
  let added = 0;
  let updated = 0;

  for (const item of incoming) {
    if (byId.has(item.id)) {
      updated += 1;
    } else {
      added += 1;
    }
    byId.set(item.id, item);
  }

  return { items: [...byId.values()], added, updated };
}

/**
 * Merges the imported domains into what is already stored, by id. Merge rather than
 * replace: a backup is a copy of what someone had, and restoring it must not delete
 * work that was created after the backup was taken.
 */
export function applyWorkspaceDatasets(
  datasets: WorkspaceDatasets,
  validCharacterIds: Set<string>,
): WorkspaceApplyResult {
  const relationships = normalizeImportedRelationships(datasets.relationships, validCharacterIds);
  const timeline = normalizeImportedTimeline(datasets.timeline, validCharacterIds);
  const world = normalizeImportedWorld(datasets.world, validCharacterIds);

  const mergedRelationships = mergeById(loadRelationships(), relationships.items);
  const mergedTimeline = mergeById(loadTimeline(), timeline.items);
  const mergedWorld = mergeById(loadWorldEntries(), world.items);

  saveRelationships(mergedRelationships.items);
  saveTimeline(mergedTimeline.items);
  saveWorldEntries(mergedWorld.items);

  return {
    relationships: { ...emptyOutcome(), items: relationships.items.length, added: mergedRelationships.added, updated: mergedRelationships.updated, dropped: relationships.dropped },
    timeline: { ...emptyOutcome(), items: timeline.items.length, added: mergedTimeline.added, updated: mergedTimeline.updated, dropped: timeline.dropped },
    world: { ...emptyOutcome(), items: world.items.length, added: mergedWorld.added, updated: mergedWorld.updated, dropped: world.dropped },
  };
}
