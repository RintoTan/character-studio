// The dashboard flags used to carry the favourites: `favoriteIds` was a list of
// character ids, and the flag has since moved onto the character record itself. The
// migration that moves it ran on the dashboard's first render, where the characters
// prop is still empty — the app loads them in its own effect — so it read "no
// characters", concluded the ids were stale and wrote that empty list back to storage,
// deleting the library before the load could produce it. Measured: a `favoriteIds`
// entry in the flags key emptied the roster on the next boot.
//
// So the decision is made here, as a value, with the one rule that matters stated
// where it can be tested: an empty roster is not evidence that the ids are stale, it
// is also what a screen shows before its data arrives. Nothing is migrated while the
// roster is empty, and no list is written from it.
import type { Character } from "../../types/character";

export type LegacyFavoritePlan = {
  /** The roster with the matching characters marked, or the same array when it already
   *  says what it should — an unchanged roster must not be written back. */
  characters: Character[];
  /** The ids that were migrated or found stale; the caller clears them from the flags. */
  clearedIds: string[];
};

export function planLegacyFavoriteMigration(
  characters: Character[],
  favoriteIds: readonly string[],
): LegacyFavoritePlan | null {
  const ids = favoriteIds.filter((id) => typeof id === "string" && id.length > 0);

  if (ids.length === 0) {
    return null;
  }

  if (characters.length === 0) {
    return null;
  }

  const legacy = new Set(ids);
  let changed = false;
  const next = characters.map((character) => {
    if (!legacy.has(character.id) || character.isDraft === true || character.favorite === true) {
      return character;
    }
    changed = true;
    return { ...character, favorite: true, isFavorite: undefined };
  });

  return {
    characters: changed ? next : characters,
    clearedIds: ids,
  };
}
