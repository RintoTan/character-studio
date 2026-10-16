// Recovering a character delete - including the references that delete removed.
//
// A character is not one row. It is also the endpoint of edges in the relationship
// graph, a participant in timeline events, and a related character on world entries,
// and deleting it prunes all of that. Until now nothing put any of it back: the
// dashboard's ten-second undo restored the character record alone, and the bulk and
// editor deletes saved no copy at all (KI-17).
//
// The protection reuses the two mechanisms that already exist rather than inventing
// a third kind:
//
//   • backup.ts reports "nothing to protect" and "the copy could not be written" as
//     separate answers, and a copy that cannot be written stops the operation it was
//     protecting (DEC-38-01). The same three answers are used here.
//   • workspaceBackup.ts already carries the three non-character domains in one
//     payload, and the reference ids are what make a reference meaningful. Nothing
//     new is invented for the data itself; only the single-slot record is.
//
// Two rules shape the recovery:
//
//   • It merges. A domain is never replaced, so work created after the delete is not
//     overwritten by going back.
//   • It resolves by id. Never by name - two characters can carry the same name, and
//     a reference put back on the wrong one is worse than a reference not put back.
//
// Partial writes: several localStorage writes are not a transaction, and the three
// domain writers swallow a failed write by design, so nothing here assumes either.
// Every step adds only what is missing, which makes the whole recovery idempotent,
// and every write is read back before it is believed. A write that did not land
// leaves the record in place, so pressing undo again finishes the job instead of
// duplicating it - and the caller is told the result was partial.
import { describeSnapshotFailure } from "./backup";
import { loadCharacters, saveCharacters } from "./characterStorage";
import { loadRelationships, saveRelationships } from "./relationshipStorage";
import { loadTimeline, saveTimeline } from "./timelineStorage";
import { loadWorldEntries, saveWorldEntries } from "./worldStorage";
import type { Character } from "../types/character";
import type { Relationship } from "../types/relationship";
import type { TimelineEvent } from "../types/timeline";
import type { WorldEntry } from "../types/world";

export const DELETE_RECOVERY_KEY = "character-studio.delete-recovery";

/** The part of an item a delete edits: which characters it points at. */
type ReferenceRecord = { id: string; characterIds: string[] };

export type DeleteRecoveryRecord = {
  version: 1;
  reason: string;
  createdAt: string;
  /** The characters the delete removes. A record only ever applies to these. */
  characterIds: string[];
  characters: Character[];
  /** Edges the prune removes outright, kept so they can be put back. */
  relationships: Relationship[];
  /** Items that keep existing but lose participants. */
  timeline: ReferenceRecord[];
  world: ReferenceRecord[];
};

export type CaptureDeleteResult =
  | { status: "captured"; record: DeleteRecoveryRecord }
  | { status: "nothing-to-protect" }
  | { status: "failed"; reason: string };

/** What a delete asks of its caller: protected, or refused. */
export type DeleteRequestResult = { ok: true } | { ok: false; reason: string };

export type RestoreCounts = {
  characters: number;
  relationships: number;
  timeline: number;
  world: number;
};

export type RestoreDeleteResult = {
  status: "restored" | "partial" | "failed";
  /** The list the screen should show now. Always safe to render. */
  characters: Character[];
  counts: RestoreCounts;
  /** Empty when the recovery was complete; otherwise what went wrong. */
  reason: string;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function collectCarriers(
  items: ReadonlyArray<{ id: string; characterIds: string[] }>,
  doomed: Set<string>,
): ReferenceRecord[] {
  const carriers: ReferenceRecord[] = [];
  for (const item of items) {
    const characterIds = Array.isArray(item.characterIds)
      ? item.characterIds.filter((id): id is string => typeof id === "string")
      : [];
    if (characterIds.some((id) => doomed.has(id))) {
      carriers.push({ id: item.id, characterIds });
    }
  }
  return carriers;
}

/**
 * Writes the copy that has to exist before a delete is allowed to run.
 *
 * Called before the characters are removed, so a delete that fails halfway still has
 * a complete description of what it was going to remove.
 */
export function captureDeleteRecovery(
  reason: string,
  characters: Character[],
): CaptureDeleteResult {
  if (characters.length === 0) {
    return { status: "nothing-to-protect" };
  }

  const doomed = new Set(characters.map((character) => character.id));
  const record: DeleteRecoveryRecord = {
    version: 1,
    reason,
    createdAt: new Date().toISOString(),
    characterIds: characters.map((character) => character.id),
    characters,
    relationships: loadRelationships().filter(
      (relationship) => doomed.has(relationship.fromId) || doomed.has(relationship.toId),
    ),
    timeline: collectCarriers(loadTimeline(), doomed),
    world: collectCarriers(loadWorldEntries(), doomed),
  };

  try {
    localStorage.setItem(DELETE_RECOVERY_KEY, JSON.stringify(record));
  } catch (error) {
    return { status: "failed", reason: describeSnapshotFailure(error) };
  }

  return { status: "captured", record };
}

export function clearDeleteRecovery(): void {
  try {
    localStorage.removeItem(DELETE_RECOVERY_KEY);
  } catch {
    // ignore
  }
}

function isReferenceList(value: unknown): value is ReferenceRecord[] {
  return (
    Array.isArray(value) &&
    value.every((item) => {
      const record = asRecord(item);
      return Boolean(
        record &&
          typeof record.id === "string" &&
          Array.isArray(record.characterIds) &&
          record.characterIds.every((id) => typeof id === "string"),
      );
    })
  );
}

/** True only for a record that can be applied exactly as written. */
function isUsableRecord(value: unknown): value is DeleteRecoveryRecord {
  const record = asRecord(value);
  if (!record || record.version !== 1) {
    return false;
  }

  const characterIds = record.characterIds;
  if (!Array.isArray(characterIds) || characterIds.length === 0) {
    return false;
  }
  if (!characterIds.every((id) => typeof id === "string")) {
    return false;
  }

  const characters = record.characters;
  if (!Array.isArray(characters) || characters.length === 0) {
    return false;
  }

  // Every recorded character must be one of the ids the record claims, or the record
  // describes a different delete than the one it would be applied to.
  const claimed = new Set(characterIds as string[]);
  const charactersUsable = characters.every((item) => {
    const character = asRecord(item);
    const id = character?.id;
    return typeof id === "string" && claimed.has(id);
  });
  if (!charactersUsable) {
    return false;
  }

  return (
    Array.isArray(record.relationships) &&
    isReferenceList(record.timeline) &&
    isReferenceList(record.world)
  );
}

/** Null for anything that cannot be applied as written, including a damaged record. */
function readRecord(): DeleteRecoveryRecord | null {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(DELETE_RECOVERY_KEY);
  } catch {
    return null;
  }

  if (!raw) {
    return null;
  }

  let parsed: unknown = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = null;
  }

  if (!isUsableRecord(parsed)) {
    // A record that cannot be applied is worse than no record: it would be read
    // again on every attempt. It is dropped here, once, so the next attempt reports
    // "there is nothing to recover" instead of silently doing nothing.
    clearDeleteRecovery();
    return null;
  }

  return parsed;
}

type DomainResult = { restored: number; unrecoverable: number; ok: boolean };

type CarrierStore<T extends { id: string; characterIds: string[] }> = {
  load: () => T[];
  save: (items: T[]) => void;
};

/**
 * Puts recorded participants back on the items that are still there.
 *
 * An item that is gone was removed on purpose after the delete, so it is left gone -
 * putting it back would overwrite a decision the author made later, which is exactly
 * the thing a restore must not do.
 */
function restoreCarriers<T extends { id: string; characterIds: string[]; updatedAt: string }>(
  store: CarrierStore<T>,
  recorded: ReferenceRecord[],
  liveIds: Set<string>,
): DomainResult {
  const current = store.load();
  const known = new Set(current.map((item) => item.id));
  const planned: Array<{ id: string; added: string[] }> = [];
  let restored = 0;

  const merged = current.map((item) => {
    const record = recorded.find((candidate) => candidate.id === item.id);
    if (!record) {
      return item;
    }

    const added = record.characterIds.filter(
      (id) => liveIds.has(id) && !item.characterIds.includes(id),
    );
    if (added.length === 0) {
      return item;
    }

    restored += added.length;
    planned.push({ id: item.id, added });
    return {
      ...item,
      characterIds: [...item.characterIds, ...added],
      updatedAt: new Date().toISOString(),
    };
  });

  const unrecoverable = recorded.filter((record) => !known.has(record.id)).length;

  if (planned.length === 0) {
    return { restored: 0, unrecoverable, ok: true };
  }

  store.save(merged);

  // The domain writers absorb a failed write, so the only way to know what landed is
  // to read it back. What did not land is retryable rather than lost.
  const after = new Map(store.load().map((item) => [item.id, item]));
  let lost = 0;
  for (const { id, added } of planned) {
    const item = after.get(id);
    if (!item || !added.every((characterId) => item.characterIds.includes(characterId))) {
      lost += added.length;
    }
  }

  return { restored: restored - lost, unrecoverable, ok: lost === 0 };
}

function restoreRelationships(recorded: Relationship[], liveIds: Set<string>): DomainResult {
  const current = loadRelationships();
  const present = new Set(current.map((item) => item.id));

  // An edge comes back only if both of its recorded endpoints exist again, and it is
  // matched by id: a name is not an identity.
  const additions = recorded.filter(
    (item) => !present.has(item.id) && liveIds.has(item.fromId) && liveIds.has(item.toId),
  );
  const unrecoverable = recorded.length - additions.length;

  if (additions.length === 0) {
    return { restored: 0, unrecoverable, ok: true };
  }

  saveRelationships([...current, ...additions]);

  const written = new Set(loadRelationships().map((item) => item.id));
  const missing = additions.filter((item) => !written.has(item.id)).length;

  return { restored: additions.length - missing, unrecoverable, ok: missing === 0 };
}

/**
 * Restores the characters and the references a delete removed.
 *
 * `characterIds` is what the caller believes it is undoing. A record belongs to one
 * delete and a later delete replaces it, so a request that does not match the record
 * is refused rather than applied to the wrong characters.
 */
export function restoreDeleteRecovery(characterIds: string[]): RestoreDeleteResult {
  const current = loadCharacters();
  const empty: RestoreCounts = { characters: 0, relationships: 0, timeline: 0, world: 0 };
  const refused = (reason: string): RestoreDeleteResult => ({
    status: "failed",
    characters: current,
    counts: empty,
    reason,
  });

  const record = readRecord();
  if (!record) {
    return refused("没有可用的删除恢复记录");
  }

  if (
    characterIds.length === 0 ||
    !characterIds.every((id) => record.characterIds.includes(id))
  ) {
    return refused("恢复记录与这次删除不匹配");
  }

  const present = new Set(current.map((character) => character.id));
  const additions = record.characters.filter((character) => !present.has(character.id));

  let nextCharacters = current;
  if (additions.length > 0) {
    nextCharacters = [...additions, ...current];
    try {
      saveCharacters(nextCharacters);
    } catch (error) {
      return refused(`角色写入失败：${describeSnapshotFailure(error)}`);
    }
  }

  // Characters first and verified: a reference restored before its character exists
  // is a dangling reference, which is the thing this whole record exists to prevent.
  nextCharacters = loadCharacters();
  const restoredIds = new Set(nextCharacters.map((character) => character.id));
  if (!record.characters.every((character) => restoredIds.has(character.id))) {
    return refused("角色未能写回本地存储，已停止恢复");
  }

  const liveIds = new Set(nextCharacters.map((character) => character.id));
  const relationships = restoreRelationships(record.relationships, liveIds);
  const timeline = restoreCarriers(
    { load: loadTimeline, save: saveTimeline },
    record.timeline,
    liveIds,
  );
  const world = restoreCarriers(
    { load: loadWorldEntries, save: saveWorldEntries },
    record.world,
    liveIds,
  );

  const counts: RestoreCounts = {
    characters: additions.length,
    relationships: relationships.restored,
    timeline: timeline.restored,
    world: world.restored,
  };

  const writesFailed = !relationships.ok || !timeline.ok || !world.ok;
  const unrecoverable = relationships.unrecoverable + timeline.unrecoverable + world.unrecoverable;

  // The record is spent only when nothing was left unwritten. Keeping it after a
  // failed write is what makes the retry safe: every step adds only what is missing.
  if (!writesFailed) {
    clearDeleteRecovery();
  }

  if (writesFailed) {
    return {
      status: "partial",
      characters: nextCharacters,
      counts,
      reason: "部分关联未能写入本地存储，恢复记录已保留，可以再试一次",
    };
  }

  if (unrecoverable > 0) {
    return {
      status: "partial",
      characters: nextCharacters,
      counts,
      reason: `有 ${unrecoverable} 处关联在删除之后被单独删除或改动，无法找回`,
    };
  }

  return { status: "restored", characters: nextCharacters, counts, reason: "" };
}

/** The character list a stored record would put back - for a caller that only asks. */
export function readDeleteRecovery(): DeleteRecoveryRecord | null {
  return readRecord();
}
