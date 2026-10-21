import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useEscapeDismiss } from "../hooks/useLightDismiss";
import { CharacterRow, characterDisplayName, matchesCharacterQuery } from "./CharacterRow";
import { Icon } from "./Icon";
import type { Character } from "../types/character";

// Choosing characters, in two shapes that share everything but the answer they give.
//
// A flat checkbox list of the whole workspace was the original picker; with a hundred
// characters that is a wall of names, so it grew search and a count. What is added
// here is the part that made it still awkward to use:
//
//   • The list no longer reorders itself when something is chosen. Chosen-first
//     ordering meant the row you just ticked jumped to the top, so the list moved
//     under the cursor and a second click landed somewhere else. The count and the
//     switch state already say what is chosen, and 只看已选 answers the question the
//     reordering was there to answer.
//   • Rows carry a face and context (CharacterRow), not just a name.
//   • Arrow keys and Enter work, on the same list, in both shapes.
//
// CharacterPicker answers with many ids (timeline events, world entries).
// CharacterSelect answers with one (the ends of a relationship) and stays collapsed
// until asked, because two open lists in one dialog push its buttons off screen.

const SEARCH_THRESHOLD = 12;

type CharacterPickerProps = {
  characters: Character[];
  legend: string;
  onChange: (ids: string[]) => void;
  selectedIds: string[];
};

type CharacterSelectProps = {
  characters: Character[];
  legend: string;
  onChange: (id: string) => void;
  value: string;
};

function filterCharacters(
  characters: Character[],
  selectedIds: string[],
  query: string,
  onlyChosen: boolean,
) {
  const needle = query.trim().toLowerCase();

  return characters.filter((character) => {
    if (onlyChosen && !selectedIds.includes(character.id)) {
      return false;
    }

    return needle ? matchesCharacterQuery(character, needle) : true;
  });
}

export function CharacterPicker({ characters, legend, onChange, selectedIds }: CharacterPickerProps) {
  const [query, setQuery] = useState("");
  const [onlyChosen, setOnlyChosen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const listId = useId();

  const list = useMemo(
    () => filterCharacters(characters, selectedIds, query, onlyChosen),
    [characters, selectedIds, query, onlyChosen],
  );

  const showTools = characters.length > SEARCH_THRESHOLD;

  // The highlight follows the list it points into.
  useEffect(() => {
    setActiveIndex(0);
  }, [query, onlyChosen]);

  function toggle(characterId: string, checked: boolean) {
    onChange(
      checked
        ? [...selectedIds, characterId]
        : selectedIds.filter((id) => id !== characterId),
    );
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((current) => Math.min(current + 1, Math.max(list.length - 1, 0)));
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) => Math.max(current - 1, 0));
      return;
    }

    if (event.key === "Enter") {
      const character = list[activeIndex];

      if (character) {
        // The dialog this sits in treats Enter as "confirm", so the list keeps the
        // key for itself while it has something highlighted.
        event.preventDefault();
        event.stopPropagation();
        toggle(character.id, !selectedIds.includes(character.id));
      }
      return;
    }

    if (event.key === "Escape" && query) {
      event.preventDefault();
      event.stopPropagation();
      setQuery("");
    }
  }

  const allShownChosen =
    list.length === 0 || list.every((character) => selectedIds.includes(character.id));

  return (
    <fieldset className="field character-picker">
      <legend>{legend}</legend>

      {showTools && (
        <div className="character-picker-toolbar">
          <label className="character-picker-search">
            <Icon name="search" size={15} />
            <input
              aria-activedescendant={list.length > 0 ? `${listId}-${activeIndex}` : undefined}
              aria-controls={listId}
              aria-label={`搜索${legend}`}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={handleKeyDown}
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
            {query && ` · 匹配 ${list.length}`}
          </span>
          <button
            aria-pressed={onlyChosen}
            className={onlyChosen ? "chip-toggle active" : "chip-toggle"}
            onClick={() => setOnlyChosen((current) => !current)}
            type="button"
          >
            只看已选
          </button>
        </div>
      )}

      <div className="character-picker-list" id={listId} role="listbox" aria-multiselectable="true">
        {list.length === 0 ? (
          <p className="muted">没有匹配的角色。</p>
        ) : (
          list.map((character, index) => (
            <label
              className={
                index === activeIndex
                  ? "settings-check character-row active"
                  : "settings-check character-row"
              }
              id={`${listId}-${index}`}
              key={character.id}
              onMouseEnter={() => setActiveIndex(index)}
            >
              <input
                checked={selectedIds.includes(character.id)}
                onChange={(event) => toggle(character.id, event.target.checked)}
                type="checkbox"
              />
              <CharacterRow character={character} />
            </label>
          ))
        )}
      </div>

      {showTools && (
        <div className="character-picker-actions">
          <button
            className="ghost-button"
            disabled={allShownChosen}
            onClick={() => {
              const ids = new Set([...selectedIds, ...list.map((character) => character.id)]);
              onChange([...ids]);
            }}
            type="button"
          >
            全选{query ? "结果" : "全部"}
          </button>
          <button
            className="ghost-button"
            disabled={selectedIds.length === 0}
            onClick={() =>
              onChange(
                query || onlyChosen
                  ? selectedIds.filter((id) => !list.some((character) => character.id === id))
                  : [],
              )
            }
            type="button"
          >
            {query || onlyChosen ? "取消选中结果" : "清空选择"}
          </button>
        </div>
      )}
    </fieldset>
  );
}

export function CharacterSelect({ characters, legend, onChange, value }: CharacterSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listId = useId();

  const chosen = characters.find((character) => character.id === value) ?? null;
  const list = useMemo(
    () => filterCharacters(characters, value ? [value] : [], query, false),
    [characters, value, query],
  );

  useEffect(() => {
    if (open) {
      setActiveIndex(0);
      inputRef.current?.focus();
    }
  }, [open]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
  }, []);

  // The input handles Escape while it has focus; this covers the rest of the panel,
  // where focus is on a row rather than in the field.
  useEscapeDismiss(open, close);

  // A list that stays open while the pointer goes elsewhere is a trap.
  useEffect(() => {
    if (!open) {
      return;
    }

    function handlePointerDown(event: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) {
        close();
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [open, close]);

  function choose(characterId: string) {
    onChange(characterId);
    close();
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((current) => Math.min(current + 1, Math.max(list.length - 1, 0)));
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) => Math.max(current - 1, 0));
      return;
    }

    if (event.key === "Enter") {
      const character = list[activeIndex];

      if (character) {
        // Enter belongs to the open list. Escape closes it, and the dialog's own
        // Enter-to-confirm takes over again from there.
        event.preventDefault();
        event.stopPropagation();
        choose(character.id);
      }
      return;
    }

    if (event.key === "Escape") {
      // Only while the list is open. A closed picker is just a button inside a dialog,
      // and swallowing Escape there left the dialog unable to close from the keyboard —
      // the one field a dialog focuses first was the one that trapped it.
      if (!open) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      close();
    }
  }

  return (
    <div className="field character-select" ref={wrapRef}>
      <span className="character-select-label">{legend}</span>
      <button
        aria-expanded={open}
        aria-haspopup="listbox"
        className="character-select-trigger"
        onClick={() => (open ? close() : setOpen(true))}
        type="button"
      >
        {chosen ? (
          <CharacterRow character={chosen} />
        ) : (
          <span className="character-row-name muted">选择角色</span>
        )}
        <Icon name={open ? "arrowUp" : "arrowDown"} size={15} />
      </button>

      {open && (
        <div className="character-select-panel">
          <label className="character-picker-search">
            <Icon name="search" size={15} />
            <input
              aria-activedescendant={list.length > 0 ? `${listId}-${activeIndex}` : undefined}
              aria-controls={listId}
              aria-label={`搜索${legend}`}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="搜索角色名、职业、世界观"
              ref={inputRef}
              type="search"
              value={query}
            />
            {query && (
              <button aria-label="清除搜索" onClick={() => setQuery("")} type="button">
                <Icon name="close" size={13} />
              </button>
            )}
          </label>

          <div className="character-picker-list" id={listId} role="listbox">
            {list.length === 0 ? (
              <p className="muted">没有匹配的角色。</p>
            ) : (
              list.map((character, index) => (
                <button
                  aria-selected={character.id === value}
                  className={
                    index === activeIndex
                      ? "character-picker-option active"
                      : "character-picker-option"
                  }
                  id={`${listId}-${index}`}
                  key={character.id}
                  onClick={() => choose(character.id)}
                  onMouseEnter={() => setActiveIndex(index)}
                  role="option"
                  type="button"
                >
                  <CharacterRow character={character} />
                  {character.id === value && <Icon name="check" size={15} />}
                </button>
              ))
            )}
          </div>

          <span className="character-picker-count">
            {characters.length} 个角色
            {query && ` · 匹配 ${list.length}`}
            {chosen && ` · 当前：${characterDisplayName(chosen)}`}
          </span>
        </div>
      )}
    </div>
  );
}
