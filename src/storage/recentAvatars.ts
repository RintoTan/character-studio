// The emoji avatars an author actually uses, newest first.
//
// Two closures inside CharacterForm used to own this, with the key name and the
// list length written out inline. The rules were real -- newest first, no repeats,
// capped -- and untestable, so they live here now.

export const RECENT_AVATAR_KEY = "character-studio.recent-avatars";

/** How many to keep. The picker shows one row of them. */
export const RECENT_AVATAR_LIMIT = 12;

/**
 * Reads the list, discarding anything that is not an emoji this build offers.
 *
 * An emoji removed from the library in a later build would otherwise sit in the
 * recents row forever, rendering as a blank button. The offer list is passed in
 * rather than imported so this module stays free of the avatar library itself.
 */
export function loadRecentAvatars(offered: readonly string[]): string[] {
  try {
    const raw = localStorage.getItem(RECENT_AVATAR_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];

    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string" && offered.includes(item)).slice(0, RECENT_AVATAR_LIMIT)
      : [];
  } catch {
    return [];
  }
}

/**
 * Moves an emoji to the front, dropping its earlier position, and returns the new
 * list. A failure to write is swallowed: this is a convenience row, not data.
 */
export function saveRecentAvatar(emoji: string, current: readonly string[]): string[] {
  const next = [emoji, ...current.filter((item) => item !== emoji)].slice(0, RECENT_AVATAR_LIMIT);

  try {
    localStorage.setItem(RECENT_AVATAR_KEY, JSON.stringify(next));
  } catch {
    // Quota or private mode.
  }

  return next;
}
