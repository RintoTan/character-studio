import { AvatarDisplay } from "./AvatarDisplay";
import { DEFAULT_AVATAR_EMOJI } from "../data/avatarCategories";
import type { Character } from "../types/character";

// How one character looks in a list, everywhere a character appears in a list.
//
// Choosing a character used to mean reading a name and hoping it was the right one:
// the dropdowns in 新建关系 showed only names, and the picker added an occupation on
// the right. A face and a line of context are what makes a hundred characters
// searchable rather than a wall of similar names, so the three surfaces that show
// characters in a list - the multi-select picker, the single-select, and the compact
// related-character list - all render this row instead of each having their own.

/** The line under a name: what tells two characters apart at a glance. */
export function characterMeta(character: Character) {
  return [character.occupation, character.worldview].filter(Boolean).join(" · ");
}

export function characterDisplayName(character: Character) {
  return character.name || "未命名角色";
}

/**
 * Whether a character answers to a search term. Name, occupation and worldview:
 * the three things a writer searches by, and the three this app stores per character.
 */
export function matchesCharacterQuery(character: Character, needle: string) {
  return [character.name, character.occupation, character.worldview]
    .filter(Boolean)
    .some((field) => String(field).toLowerCase().includes(needle));
}

export function CharacterRow({ character }: { character: Character }) {
  const meta = characterMeta(character);

  return (
    <>
      <AvatarDisplay
        assetId={character.avatarAssetId}
        className="character-row-avatar"
        emoji={character.avatarEmoji || DEFAULT_AVATAR_EMOJI}
        label={characterDisplayName(character)}
      />
      <span className="character-row-text">
        <span className="character-row-name">{characterDisplayName(character)}</span>
        {meta && <em className="character-row-meta">{meta}</em>}
      </span>
    </>
  );
}
