// What an import will do, decided before anything is written.
//
// The importer used to normalise the package straight into the stores: characters
// were merged by id, and the three workspace domains were merged by id with the
// incoming record winning. That is a fine shape for a file you just exported, and a
// dangerous one for a file from somewhere else:
//
//   - a character whose id was already taken came in under a new id, while the
//     relationships in the same package still named the old one - so the edge
//     landed on whichever character already owned that id. A stranger's family.
//   - a relationship with a missing end, a timeline naming a character who is not
//     in the file, and a world entry whose parent is absent were all dropped or
//     silently repaired, and the preview said nothing.
//
// So the package is read into a plan first. The plan is a pure value: it names
// every record that will be added, updated, kept or set aside, the id mapping that
// every reference is rewritten through, and the reason for each omission. Nothing
// here touches storage; committing is a separate step.
import type { Character } from "../types/character";
import {
  isRelationshipKind,
  isSymmetricKind,
  type Relationship,
  type RelationshipKind,
} from "../types/relationship";
import {
  isTimelineEventKind,
  type TimelineEvent,
  type TimelineEventKind,
} from "../types/timeline";
import {
  isWorldCategory,
  wouldCreateWorldCycle,
  type WorldEntry,
  type WorldEntryCategory,
} from "../types/world";

/** Merge keeps what is already there; replace makes the package the whole library. */
export type ImportMode = "merge" | "replace";

/**
 * What to do with a record whose id is already taken.
 * - keep: the stored copy wins, the incoming one is not written
 * - replace: the stored copy is updated in place
 * - copy: the incoming one is written under a fresh id
 */
export type ConflictStrategy = "keep" | "replace" | "copy";

export type ImportCategories = {
  relationships: boolean;
  timeline: boolean;
  world: boolean;
  avatars: boolean;
};

export const ALL_CATEGORIES: ImportCategories = {
  relationships: true,
  timeline: true,
  world: true,
  avatars: true,
};

/** A character as the file described it, plus the id the file used for it. */
export type IncomingCharacter = { character: Character; sourceId: string };

export type ExistingLibrary = {
  characters: Character[];
  relationships: Relationship[];
  timeline: TimelineEvent[];
  world: WorldEntry[];
};

export type ImportPlanOptions = {
  mode?: ImportMode;
  strategy?: ConflictStrategy;
  categories?: Partial<ImportCategories>;
  /** Overridable so a test can produce the same plan twice. */
  now?: string;
};

/** One record that will not be written, and why. Reported, never hidden. */
export type OmittedRecord = {
  /** Which file domain the record came from. */
  domain: "character" | "relationship" | "timeline" | "world" | "avatar";
  label: string;
  reason: string;
};

export type DomainDecisions<T> = {
  /** Records to write (new or updated). */
  items: T[];
  add: number;
  update: number;
  /** Conflicts resolved in favour of what is already stored. */
  kept: number;
  /** Records carrying an id that the library already uses. */
  conflicts: number;
  /** Records set aside because a reference could not be resolved. */
  deferred: number;
  /** References removed from a record that was otherwise kept. */
  prunedReferences: number;
  /** Records refused as duplicates of one already present. */
  duplicates: number;
  /** Records whose fields did not validate at all. */
  invalid: number;
};

export type ImportPlan = {
  mode: ImportMode;
  strategy: ConflictStrategy;
  categories: ImportCategories;
  /** Incoming id -> the id it will have after the import. Every reference is rewritten through this. */
  characterIds: Map<string, string>;
  /** Incoming world id -> the id it will have after the import. Keeps child parents correct. */
  worldIds: Map<string, string>;
  characters: {
    /** The records that will be written, each with the id the file used for it. */
    items: Array<{ sourceId: string; character: Character; action: "add" | "update" }>;
    add: number;
    update: number;
    kept: number;
    /** Incoming characters whose id is already stored, whatever the strategy. */
    conflicts: number;
    /** Characters present before and kept in a merge; zero in a replace. */
    retained: number;
    /** Characters removed because the import replaces the library. */
    replaced: number;
  };
  relationships: DomainDecisions<Relationship>;
  timeline: DomainDecisions<TimelineEvent>;
  world: DomainDecisions<WorldEntry>;
  omitted: OmittedRecord[];
  /** Counts for the preview, gathered while planning so the UI never recounts. */
  incoming: {
    characters: number;
    relationships: number;
    timeline: number;
    world: number;
    avatars: number;
  };
  target: {
    characters: number;
    relationships: number;
    timeline: number;
    world: number;
  };
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function asStringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function emptyDomain<T>(): DomainDecisions<T> {
  return {
    items: [],
    add: 0,
    update: 0,
    kept: 0,
    conflicts: 0,
    deferred: 0,
    prunedReferences: 0,
    duplicates: 0,
    invalid: 0,
  };
}

/**
 * The plan.
 *
 * `incoming.characters` are already normalised (see normalizeCharacter): their ids
 * are unique and their fields validated. `sourceIds` restores the id the file used,
 * which is the only thing the package's own references can be matched against.
 */
export function buildImportPlan(
  incomingCharacters: IncomingCharacter[],
  workspace: { relationships: unknown[]; timeline: unknown[]; world: unknown[] } | null,
  existing: ExistingLibrary,
  options: ImportPlanOptions = {},
): ImportPlan {
  const mode = options.mode ?? "merge";
  const strategy = options.strategy ?? "copy";
  const categories = { ...ALL_CATEGORIES, ...options.categories };
  const now = options.now ?? new Date().toISOString();
  const characterIds = new Map<string, string>();
  const worldIds = new Map<string, string>();
  const omitted: OmittedRecord[] = [];

  const existingCharacters = new Map(existing.characters.map((item) => [item.id, item]));
  // Ids the library already holds. The importer normalises before planning, so an
  // incoming id is usually free already; this set is what makes the plan correct on
  // its own rather than only when its caller was careful.
  const takenCharacterIds = new Set(mode === "merge" ? existing.characters.map((item) => item.id) : []);
  const characterItems: Array<{ sourceId: string; character: Character; action: "add" | "update" }> = [];
  let add = 0;
  let update = 0;
  let kept = 0;
  let characterConflicts = 0;

  for (const { character, sourceId } of incomingCharacters) {
    const stored = mode === "merge" && sourceId ? existingCharacters.get(sourceId) : undefined;

    if (stored) {
      characterConflicts += 1;

      if (strategy === "keep") {
        characterIds.set(sourceId, stored.id);
        kept += 1;
        continue;
      }

      if (strategy === "replace") {
        // The stored identity wins so that nothing that already points at this
        // character starts pointing somewhere else.
        const replaced: Character = {
          ...character,
          id: stored.id,
          createdAt: stored.createdAt || character.createdAt,
          updatedAt: now,
        };
        characterIds.set(sourceId, stored.id);
        characterItems.push({ sourceId, character: replaced, action: "update" });
        update += 1;
        continue;
      }
    }

    // A copy under a taken id gets a fresh one. Every reference in the package is
    // rewritten through `characterIds`, so nothing is left pointing at the record
    // that used to own that id.
    let finalId = character.id;
    if (takenCharacterIds.has(finalId)) {
      finalId = crypto.randomUUID();
    }
    takenCharacterIds.add(finalId);

    const added: Character = finalId === character.id ? character : { ...character, id: finalId };
    if (sourceId) {
      characterIds.set(sourceId, finalId);
    }
    characterItems.push({ sourceId, character: added, action: "add" });
    add += 1;
  }

  const finalCharacterIds = new Set(characterItems.map((item) => item.character.id));
  // In a merge the stored characters stay, so references to them remain valid.
  const knownCharacterIds = new Set([
    ...(mode === "merge" ? existing.characters.map((item) => item.id) : []),
    ...finalCharacterIds,
  ]);

  const resolveCharacter = (id: string) => characterIds.get(id) ?? (knownCharacterIds.has(id) ? id : null);

  const relationships = planRelationships(
    categories.relationships ? workspace?.relationships ?? [] : [],
    resolveCharacter,
    mode === "merge" ? existing.relationships : [],
    strategy,
    mode,
    now,
    omitted,
  );
  const timeline = planTimeline(
    categories.timeline ? workspace?.timeline ?? [] : [],
    resolveCharacter,
    mode === "merge" ? existing.timeline : [],
    strategy,
    mode,
    now,
    omitted,
  );
  const world = planWorld(
    categories.world ? workspace?.world ?? [] : [],
    resolveCharacter,
    mode === "merge" ? existing.world : [],
    strategy,
    mode,
    now,
    worldIds,
    omitted,
  );

  // Everything already in a merged library stays in it; a replace keeps none.
  const retained = mode === "merge" ? existing.characters.length : 0;

  return {
    mode,
    strategy,
    categories,
    characterIds,
    worldIds,
    characters: {
      items: characterItems,
      add,
      update,
      kept,
      conflicts: characterConflicts,
      retained,
      replaced: mode === "replace" ? existing.characters.length : 0,
    },
    relationships,
    timeline,
    world,
    omitted,
    incoming: {
      characters: incomingCharacters.length,
      relationships: workspace?.relationships.length ?? 0,
      timeline: workspace?.timeline.length ?? 0,
      world: workspace?.world.length ?? 0,
      avatars: 0,
    },
    // What the library holds once the plan is applied. Counted from the ids rather
    // than by adding numbers: a record whose id was already present updates in place
    // and must not be counted twice.
    target: {
      characters: mode === "replace" ? characterItems.length : existing.characters.length + add,
      // A file that carries no workspace section cannot replace one: an old
      // characters-only backup leaves the graph, the timeline and the world book
      // exactly as they are, and the preview says so by keeping the current counts.
      relationships:
        mode === "replace"
          ? workspace
            ? relationships.items.length
            : existing.relationships.length
          : countTarget(existing.relationships, relationships.items),
      timeline:
        mode === "replace"
          ? workspace
            ? timeline.items.length
            : existing.timeline.length
          : countTarget(existing.timeline, timeline.items),
      world:
        mode === "replace"
          ? workspace
            ? world.items.length
            : existing.world.length
          : countTarget(existing.world, world.items),
    },
  };
}

function countTarget<T extends { id: string }>(stored: T[], incoming: T[]) {
  const ids = new Set(stored.map((item) => item.id));
  return stored.length + incoming.filter((item) => !ids.has(item.id)).length;
}

function planRelationships(
  raw: unknown[],
  resolveCharacter: (id: string) => string | null,
  stored: Relationship[],
  strategy: ConflictStrategy,
  mode: ImportMode,
  now: string,
  omitted: OmittedRecord[],
): DomainDecisions<Relationship> {
  const result = emptyDomain<Relationship>();
  const storedById = new Map(stored.map((item) => [item.id, item]));
  const accumulated = mode === "merge" ? [...stored] : [];

  raw.forEach((value, index) => {
    const record = asRecord(value);
    const id = record ? asString(record.id) : "";
    const kind = record ? asString(record.kind) : "";

    if (!record || !id || !isRelationshipKind(kind)) {
      result.invalid += 1;
      omitted.push({
        domain: "relationship",
        label: `第 ${index + 1} 条关系`,
        reason: "缺少 id 或关系类型不在支持范围内",
      });
      return;
    }

    const fromId = resolveCharacter(asString(record.fromId));
    const toId = resolveCharacter(asString(record.toId));

    if (!fromId || !toId) {
      result.deferred += 1;
      omitted.push({
        domain: "relationship",
        label: `${asString(record.kind)} · ${index + 1}`,
        reason: !fromId && !toId
          ? "两端的角色都不在导入范围内"
          : !fromId
            ? "起点的角色不在导入范围内"
            : "终点的角色不在导入范围内",
      });
      return;
    }

    if (fromId === toId) {
      result.invalid += 1;
      omitted.push({ domain: "relationship", label: `${kind} · ${index + 1}`, reason: "两端的角色相同" });
      return;
    }

    const candidate: Relationship = {
      id,
      fromId,
      toId,
      kind: kind as RelationshipKind,
      note: asString(record.note) || undefined,
      createdAt: asString(record.createdAt) || now,
      updatedAt: asString(record.updatedAt) || now,
    };

    const storedMatch = storedById.get(id);

    if (storedMatch) {
      result.conflicts += 1;

      if (mode === "merge" && strategy === "keep") {
        result.kept += 1;
        return;
      }

      if (mode === "merge" && strategy === "replace") {
        candidate.createdAt = storedMatch.createdAt || candidate.createdAt;
        candidate.updatedAt = now;
        result.items.push(candidate);
        result.update += 1;
        const position = accumulated.findIndex((entry) => entry.id === id);
        if (position >= 0) {
          accumulated[position] = candidate;
        }
        return;
      }

      candidate.id = crypto.randomUUID();
    }

    // Duplicates are judged on the pair and the kind, because two people who are
    // friends are one fact however the file spells it. 师承 A→B and 师承 B→A are not.
    const duplicate = accumulated.some(
      (entry) =>
        entry.kind === candidate.kind &&
        ((entry.fromId === candidate.fromId && entry.toId === candidate.toId) ||
          (isSymmetricKind(candidate.kind) &&
            entry.fromId === candidate.toId &&
            entry.toId === candidate.fromId)),
    );

    if (duplicate) {
      result.duplicates += 1;
      return;
    }

    accumulated.push(candidate);
    result.items.push(candidate);
    result.add += 1;
  });

  return result;
}

function planTimeline(
  raw: unknown[],
  resolveCharacter: (id: string) => string | null,
  stored: TimelineEvent[],
  strategy: ConflictStrategy,
  mode: ImportMode,
  now: string,
  omitted: OmittedRecord[],
): DomainDecisions<TimelineEvent> {
  const result = emptyDomain<TimelineEvent>();
  const storedById = new Map(stored.map((item) => [item.id, item]));
  const accumulated = mode === "merge" ? [...stored] : [];

  raw.forEach((value, index) => {
    const record = asRecord(value);
    const id = record ? asString(record.id) : "";
    const title = record ? asString(record.title) : "";
    const kind = record ? asString(record.kind) : "";
    const date = record ? asString(record.date) : "";

    if (!record || !id || !title || !date || !isTimelineEventKind(kind)) {
      result.invalid += 1;
      omitted.push({
        domain: "timeline",
        label: `第 ${index + 1} 个事件`,
        reason: "缺少 id、标题、日期或事件类型不在支持范围内",
      });
      return;
    }

    const requested = asStringArray(record.characterIds);
    const characterIds: string[] = [];
    let missing = 0;

    for (const characterId of requested) {
      const resolved = resolveCharacter(characterId);
      if (resolved) {
        if (!characterIds.includes(resolved)) {
          characterIds.push(resolved);
        }
      } else {
        missing += 1;
      }
    }

    // An event is worth keeping even when some of its cast is absent: the event
    // happened, and the missing half is a gap to fill rather than a reason to lose
    // the record. What must not happen is the reference disappearing without a word.
    if (missing > 0) {
      result.prunedReferences += missing;
      omitted.push({
        domain: "timeline",
        label: title,
        reason: `保留事件，移除了 ${missing} 个无法解析的关联角色`,
      });
    }

    const candidate: TimelineEvent = {
      id,
      title,
      date,
      era: asString(record.era) || undefined,
      kind: kind as TimelineEventKind,
      description: asString(record.description) || undefined,
      location: asString(record.location) || undefined,
      characterIds,
      createdAt: asString(record.createdAt) || now,
      updatedAt: asString(record.updatedAt) || now,
    };

    const storedMatch = storedById.get(id);

    if (storedMatch) {
      result.conflicts += 1;

      if (mode === "merge" && strategy === "keep") {
        result.kept += 1;
        return;
      }

      if (mode === "merge" && strategy === "replace") {
        candidate.createdAt = storedMatch.createdAt || candidate.createdAt;
        candidate.updatedAt = now;
        result.items.push(candidate);
        result.update += 1;
        const position = accumulated.findIndex((entry) => entry.id === id);
        if (position >= 0) {
          accumulated[position] = candidate;
        }
        return;
      }

      candidate.id = crypto.randomUUID();
    }

    accumulated.push(candidate);
    result.items.push(candidate);
    result.add += 1;
  });

  return result;
}

function planWorld(
  raw: unknown[],
  resolveCharacter: (id: string) => string | null,
  stored: WorldEntry[],
  strategy: ConflictStrategy,
  mode: ImportMode,
  now: string,
  worldIds: Map<string, string>,
  omitted: OmittedRecord[],
): DomainDecisions<WorldEntry> {
  const result = emptyDomain<WorldEntry>();
  const storedById = new Map(stored.map((item) => [item.id, item]));
  const accumulated = mode === "merge" ? [...stored] : [];
  // Parents may arrive after their children, so the pass runs twice: first to settle
  // ids, then to resolve parents against the settled set.
  const drafts: Array<{ sourceId: string; entry: WorldEntry; missingParents: number }> = [];

  raw.forEach((value, index) => {
    const record = asRecord(value);
    const id = record ? asString(record.id) : "";
    const name = record ? asString(record.name) : "";
    const category = record ? asString(record.category) : "";

    if (!record || !id || !name || !isWorldCategory(category)) {
      result.invalid += 1;
      omitted.push({
        domain: "world",
        label: `第 ${index + 1} 个条目`,
        reason: "缺少 id、名称或分类不在支持范围内",
      });
      return;
    }

    const requested = asStringArray(record.characterIds);
    const characterIds: string[] = [];
    let missingCharacters = 0;

    for (const characterId of requested) {
      const resolved = resolveCharacter(characterId);
      if (resolved) {
        if (!characterIds.includes(resolved)) {
          characterIds.push(resolved);
        }
      } else {
        missingCharacters += 1;
      }
    }

    const entry: WorldEntry = {
      id,
      name,
      category: category as WorldEntryCategory,
      parentId: asString(record.parentId) || undefined,
      summary: asString(record.summary) || undefined,
      details: asString(record.details) || undefined,
      tags: asStringArray(record.tags),
      characterIds,
      createdAt: asString(record.createdAt) || now,
      updatedAt: asString(record.updatedAt) || now,
    };

    const storedMatch = storedById.get(id);

    if (storedMatch) {
      result.conflicts += 1;

      if (mode === "merge" && strategy === "keep") {
        result.kept += 1;
        worldIds.set(id, id);
        return;
      }

      if (mode === "merge" && strategy === "replace") {
        entry.createdAt = storedMatch.createdAt || entry.createdAt;
        entry.updatedAt = now;
        worldIds.set(id, id);
        drafts.push({ sourceId: id, entry, missingParents: missingCharacters });
        result.update += 1;
        return;
      }

      entry.id = crypto.randomUUID();
    }

    worldIds.set(id, entry.id);
    drafts.push({ sourceId: id, entry, missingParents: missingCharacters });
    result.add += 1;
  });

  const knownWorldIds = new Set([
    ...(mode === "merge" ? stored.map((item) => item.id) : []),
    ...drafts.map((item) => item.entry.id),
  ]);

  for (const { entry, missingParents } of drafts) {
    if (missingParents > 0) {
      result.prunedReferences += missingParents;
      omitted.push({
        domain: "world",
        label: entry.name,
        reason: `保留条目，移除了 ${missingParents} 个无法解析的关联角色`,
      });
    }

    if (entry.parentId) {
      const mappedParent = worldIds.get(entry.parentId) ?? (knownWorldIds.has(entry.parentId) ? entry.parentId : null);

      if (!mappedParent) {
        // A parent outside the package is a gap, not a hierarchy. The entry is kept
        // at the top level and the gap is named, rather than a parent being invented.
        entry.parentId = undefined;
        omitted.push({ domain: "world", label: entry.name, reason: "父级不在导入范围内，已改为顶层条目" });
      } else if (mappedParent === entry.id) {
        entry.parentId = undefined;
        omitted.push({ domain: "world", label: entry.name, reason: "父级指向自己，已改为顶层条目" });
      } else {
        entry.parentId = mappedParent;
      }
    }

    result.items.push(entry);
    accumulated.push(entry);
  }

  // A cycle cannot be seen one entry at a time, so the settled set is checked as a
  // whole and the offending edge is cut rather than the entry being lost.
  for (const entry of result.items) {
    if (!entry.parentId) {
      continue;
    }

    const others = accumulated.filter((item) => item.id !== entry.id);
    if (wouldCreateWorldCycle(others, entry.id, entry.parentId)) {
      omitted.push({ domain: "world", label: entry.name, reason: "父级会形成循环，已改为顶层条目" });
      entry.parentId = undefined;
    }
  }

  return result;
}
