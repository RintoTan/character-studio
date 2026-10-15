// The single implementation of "clear local data".
//
// Two screens offer this under the same name: the dashboard's Data section and the
// app-level settings. They were written separately, and only the dashboard kept a
// recovery copy - so the same words meant "recoverable" on one screen and
// "unrecoverable" on the other. One helper, both callers, one meaning.
//
// The order is fixed by DEC-38-01: protect, then delete. If the copy cannot be
// written, nothing is deleted. The user is told that the copy failed and asked to
// free up storage or export a backup by hand - there is deliberately no "continue
// without a backup" button, because without the copy the clear is unrecoverable.
import { attemptSnapshot, readSnapshot, writeSnapshot, type LocalSnapshot } from "./backup";
import type { Character } from "../types/character";

export type ClearLocalDataResult =
  | {
      ok: true;
      /** The copy left behind for recovery, if there is one. */
      snapshot: LocalSnapshot | null;
      /** True when an older copy was preserved because there was nothing new to keep. */
      keptPrevious: boolean;
    }
  | { ok: false; reason: string };

export function clearLocalDataPreservingSnapshot(
  reason: string,
  characters: Character[],
): ClearLocalDataResult {
  // Read before clearing: localStorage.clear() takes the older copy with it.
  const previous = readSnapshot();
  const attempt = attemptSnapshot(reason, characters);

  if (attempt.status === "failed") {
    return { ok: false, reason: attempt.reason };
  }

  localStorage.clear();

  // The clear removed the copy along with everything else, so it has to be written
  // back. When the list was already empty there is nothing new to keep - and the
  // older copy is then the only way back to the state before the last destructive
  // operation, so it is put back rather than thrown away (KI-16).
  const keep = attempt.status === "created" ? attempt.snapshot : previous;
  if (keep) {
    writeSnapshot(keep);
  }

  return {
    ok: true,
    snapshot: keep,
    keptPrevious: attempt.status === "empty" && previous !== null,
  };
}
