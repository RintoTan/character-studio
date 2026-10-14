import { useMemo, useState } from "react";
import { Icon } from "./Icon";
import type { Character } from "../types/character";

// Picking characters used to be a flat checkbox list of everything in the
// workspace. With a hundred characters that is a wall of names, so the list now
// brings its own search, keeps what is already chosen at the top, and reports both
// numbers — how many are chosen and how many are in the list. The controls only
// appear once the workspace is big enough to need them.
const SEARCH_THRESHOLD = 12;

type CharacterPickerProps = {
  characters: Character[];
  legend: string;
  onChange: (ids: string[]) => void;
  selectedIds: string[];
};

export function CharacterPicker({ characters, legend, onChange, selectedIds }: CharacterPickerProps) {
  const [query, setQuery] = useState("");

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();

    return characters.filter((character) => {
      if (!needle) {
        return true;
      }

      return [character.name, character.occupation, character.worldview]
        .filter(Boolean)
        .some((field) => String(field).toLowerCase().includes(needle));
    });
  }, [characters, query]);

  // Chosen first, so a selection made three screens ago is still visible.
  const ordered = useMemo(() => {
    const chosen = matches.filter((character) => selectedIds.includes(character.id));
    const rest = matches.filter((character) => !selectedIds.includes(character.id));

    return [...chosen, ...rest];
  }, [matches, selectedIds]);

  const showSearch = characters.length > SEARCH_THRESHOLD;

  function toggle(characterId: string, checked: boolean) {
    onChange(
      checked
        ? [...selectedIds, characterId]
        : selectedIds.filter((id) => id !== characterId),
    );
  }

  return (
    <fieldset className="field character-picker">
      <legend>{legend}</legend>

      {showSearch && (
        <div className="character-picker-toolbar">
          <label className="character-picker-search">
            <Icon name="search" size={15} />
            <input
              aria-label={`搜索${legend}`}
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
            已选 <strong>{selectedIds.length}</strong> / {characters.length}
            {query && ` · 匹配 ${matches.length}`}
          </span>
        </div>
      )}

      <div className="character-picker-list">
        {ordered.length === 0 ? (
          <p className="muted">没有匹配的角色。</p>
        ) : (
          ordered.map((character) => (
            <label className="settings-check" key={character.id}>
              <input
                checked={selectedIds.includes(character.id)}
                onChange={(event) => toggle(character.id, event.target.checked)}
                type="checkbox"
              />
              <span>{character.name || "未命名角色"}</span>
              {character.occupation && (
                <em className="character-picker-meta">{character.occupation}</em>
              )}
            </label>
          ))
        )}
      </div>

      {showSearch && (
        <div className="character-picker-actions">
          <button
            className="ghost-button"
            disabled={matches.length === 0 || matches.every((character) => selectedIds.includes(character.id))}
            onClick={() => {
              const ids = new Set([...selectedIds, ...matches.map((character) => character.id)]);
              onChange([...ids]);
            }}
            type="button"
          >
            全选{query ? "结果" : "全部"}
          </button>
          <button
            className="ghost-button"
            disabled={selectedIds.length === 0}
            onClick={() => onChange(query ? selectedIds.filter((id) => !matches.some((character) => character.id === id)) : [])}
            type="button"
          >
            {query ? "取消选中结果" : "清空选择"}
          </button>
        </div>
      )}
    </fieldset>
  );
}
