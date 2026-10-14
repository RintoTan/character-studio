// Snapshots of the character list, taken before a destructive operation.
//
// This app is local-first: there is no server copy to fall back on, and the only
// existing safety net was a manual export. Clearing data or importing a file
// overwrites the live list, so a single automatic snapshot is kept for recovery.
//
// Scope is deliberate: only the character records (small, text) are captured.
// Avatar binaries live in IndexedDB and are not snapshotted, so a restore can
// leave avatar references pointing at assets that are no longer there.
import type { Character } from "../types/character";

export const BACKUP_KEY = "character-studio.backup";

export type LocalSnapshot = {
  reason: string;
  createdAt: string;
  characterCount: number;
  characters: Character[];
};

export function createSnapshot(reason: string, characters: Character[]): LocalSnapshot | null {
  if (characters.length === 0) {
    return null;
  }

  const snapshot: LocalSnapshot = {
    reason,
    createdAt: new Date().toISOString(),
    characterCount: characters.length,
    characters,
  };

  try {
    localStorage.setItem(BACKUP_KEY, JSON.stringify(snapshot));
  } catch {
    // A full quota must never block the operation the user actually asked for.
    return null;
  }

  return snapshot;
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
