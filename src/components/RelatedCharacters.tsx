import { useMemo, useState } from "react";
import { CharacterRow, matchesCharacterQuery } from "./CharacterRow";
import { Icon } from "./Icon";
import type { Character } from "../types/character";

// The characters attached to an event or a world entry, for reading.
//
// A timeline event or a world entry can carry dozens of characters, and they were
// rendered as one chip each: forty names turned the card into a wall and pushed the
// description off it. Reading who is involved is not the same job as editing who is
// involved, so this is not the picker: four chips, a count, and the rest one click
// away - searchable once open, because a long list you can only scroll is the
// problem this is meant to solve.
//
// Nothing here changes a relationship: it reads the ids it is given, in the order
// they are stored, so what is displayed cannot drift from what is saved. Each chip
// and each row goes to the same place the old chips did.

const DEFAULT_LIMIT = 4;

type RelatedCharactersProps = {
  characters: Character[];
  limit?: number;
  onOpenCharacter: (characterId: string) => void;
};

export function RelatedCharacters({
  characters,
  limit = DEFAULT_LIMIT,
  onOpenCharacter,
}: RelatedCharactersProps) {
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState("");

  const needle = query.trim().toLowerCase();
  const matched = useMemo(
    () => (needle ? characters.filter((character) => matchesCharacterQuery(character, needle)) : characters),
    [characters, needle],
  );

  if (characters.length === 0) {
    return null;
  }

  // Stable by construction: the first N of the stored order, never a sample.
  const shown = characters.slice(0, limit);
  const hidden = characters.length - shown.length;

  if (!expanded) {
    return (
      <div className="related-characters">
        <div className="related-characters-row">
          {shown.map((character) => (
            <button
              className="related-chip"
              key={character.id}
              onClick={() => onOpenCharacter(character.id)}
              title={character.name || "未命名角色"}
              type="button"
            >
              <CharacterRow character={character} />
            </button>
          ))}
          {hidden > 0 && (
            <button
              className="related-chip related-chip-more"
              onClick={() => setExpanded(true)}
              type="button"
            >
              +{hidden} 位角色
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="related-characters">
      <div className="related-characters-head">
        <label className="character-picker-search">
          <Icon name="search" size={15} />
          <input
            aria-label="搜索关联角色"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索角色名、职业、世界观"
            type="search"
            value={query}
          />
          {query && (
            <button aria-label="清除搜索" onClick={() => setQuery("")} type="button">
              <Icon name="close" size={13} />
            </button>
          )}
        </label>
        <span className="character-picker-count">
          {characters.length} 位关联角色
          {query && ` · 匹配 ${matched.length}`}
        </span>
        <button
          className="ghost-button"
          onClick={() => {
            setExpanded(false);
            setQuery("");
          }}
          type="button"
        >
          收起
        </button>
      </div>

      <div className="related-characters-list">
        {matched.length === 0 ? (
          <p className="muted">没有匹配的角色。</p>
        ) : (
          matched.map((character) => (
            <button
              className="character-picker-option"
              key={character.id}
              onClick={() => onOpenCharacter(character.id)}
              type="button"
            >
              <CharacterRow character={character} />
            </button>
          ))
        )}
      </div>
    </div>
  );
}
