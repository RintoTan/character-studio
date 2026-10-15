// Snapshots of the character list, taken before a destructive operation.
//
// This app is local-first: there is no server copy to fall back on, and the only
// existing safety net was a manual export. Clearing data or importing a file
// overwrites the live list, so a single automatic snapshot is kept for recovery.
//
// Scope is deliberate: only the character records (small, text) are captured.
// Avatar binaries live in IndexedDB and are not snapshotted, so a restore can
// leave avatar references pointing at assets that are no longer there. A caller
// that describes this copy to the user must not call it a full backup - see the
// two "clear local data" confirmations.
import type { Character } from "../types/character";

export const BACKUP_KEY = "character-studio.backup";

export type LocalSnapshot = {
  reason: string;
  createdAt: string;
  characterCount: number;
  characters: Character[];
};

export type SnapshotAttempt =
  | { status: "empty" }
  | { status: "created"; snapshot: LocalSnapshot }
  | { status: "failed"; reason: string };

// "There was nothing worth keeping" and "the copy could not be written" used to be
// the same answer - null - and that made them indistinguishable to callers. They
// call for opposite decisions: the first is harmless, the second must stop the very
// operation the copy was protecting. So the attempt reports which one happened and
// the decision is left to the caller.
export function attemptSnapshot(reason: string, characters: Character[]): SnapshotAttempt {
  if (characters.length === 0) {
    return { status: "empty" };
  }

  const snapshot: LocalSnapshot = {
    reason,
    createdAt: new Date().toISOString(),
    characterCount: characters.length,
    characters,
  };

  try {
    localStorage.setItem(BACKUP_KEY, JSON.stringify(snapshot));
  } catch (error) {
    return { status: "failed", reason: describeSnapshotFailure(error) };
  }

  return { status: "created", snapshot };
}

function describeSnapshotFailure(error: unknown): string {
  const name = (error as { name?: string } | null)?.name;
  if (name === "QuotaExceededError" || name === "NS_ERROR_DOM_QUOTA_REACHED") {
    return "浏览器存储空间不足";
  }
  return "浏览器拒绝了本地写入";
}

// Snapshot-or-null, for the callers that keep going without one. Clearing is no
// longer among them: DEC-38-01 makes a failed copy stop the clear, so that path
// calls attemptSnapshot through storage/localDataReset instead. The import path
// still uses this and still continues, which is a difference worth closing later -
// it is recorded rather than changed here.
export function createSnapshot(reason: string, characters: Character[]): LocalSnapshot | null {
  const attempt = attemptSnapshot(reason, characters);
  return attempt.status === "created" ? attempt.snapshot : null;
}

// "Clear local data" calls localStorage.clear(), which would also delete the
// snapshot taken just before it. Callers re-write it through this helper.
export function writeSnapshot(snapshot: LocalSnapshot): void {
  try {
    localStorage.setItem(BACKUP_KEY, JSON.stringify(snapshot));
  } catch {
    // ignore
  }
}

export function readSnapshot(): LocalSnapshot | null {
  try {
    const raw = localStorage.getItem(BACKUP_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as LocalSnapshot;
    return Array.isArray(parsed?.characters) ? parsed : null;
  } catch {
    return null;
  }
}

export function clearSnapshot(): void {
  try {
    localStorage.removeItem(BACKUP_KEY);
  } catch {
    // ignore
  }
}
