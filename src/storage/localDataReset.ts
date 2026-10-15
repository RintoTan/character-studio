// The single implementation of "clear local data".
//
// Two screens offer this under the same name: the dashboard's Data section and the
// app-level settings. They were written separately, and only the dashboard kept a
// recovery copy - so the same words meant "recoverable" on one screen and
// "unrecoverable" on the other. One helper, both callers, one meaning.
//
// localStorage.clear() removes the snapshot along with everything else, which is
// why the snapshot taken beforehand has to be written back afterwards.
import type { Character } from "../types/character";
import { createSnapshot, writeSnapshot, type LocalSnapshot } from "./backup";

export function clearLocalDataPreservingSnapshot(
  reason: string,
  characters: Character[],
): LocalSnapshot | null {
  const snapshot = createSnapshot(reason, characters);
  localStorage.clear();
  if (snapshot) {
    writeSnapshot(snapshot);
  }

  return snapshot;
}
