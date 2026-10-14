// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import {
  deleteCharacter,
  duplicateCharacter,
  loadCharacters,
  saveCharacters,
  upsertCharacter,
} from "../src/storage/characterStorage";
import type { Character } from "../src/types/character";

const STORAGE_KEY = "character-studio.characters";

const makeCharacter = (overrides: Partial<Character> = {}): Character => ({
  id: "char-1",
  name: "林烬",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...overrides,
});

describe("characterStorage", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("returns an empty list when nothing has been stored", () => {
    expect(loadCharacters()).toEqual([]);
  });

  it("does not throw and returns an empty list on corrupted JSON", () => {
    // A local-first app must survive its own storage being unreadable.
    localStorage.setItem(STORAGE_KEY, "{ this is not json");
    expect(loadCharacters()).toEqual([]);
  });

  it("round-trips characters through storage", () => {
    const character = makeCharacter();
    saveCharacters([character]);

    const [loaded] = loadCharacters();
    expect(loaded.id).toBe("char-1");
    expect(loaded.name).toBe("林烬");
    expect(loaded.updatedAt).toBe(character.updatedAt);
  });

  it("normalises missing defaults on load", () => {
    saveCharacters([{ id: "a", name: "无字段角色", updatedAt: "2026-01-01T00:00:00.000Z" }]);

    const [loaded] = loadCharacters();
    expect(loaded.avatarEmoji).toBe("🙂");
    expect(loaded.favorite).toBe(false);
    expect(loaded.isDraft).toBe(false);
    expect(loaded.createdAt).toBe("2026-01-01T00:00:00.000Z");
  });

  it("migrates the legacy isFavorite field into favorite", () => {
    saveCharacters([
      { id: "a", name: "旧数据", updatedAt: "2026-01-01T00:00:00.000Z", isFavorite: true },
    ]);

    const [loaded] = loadCharacters();
    expect(loaded.favorite).toBe(true);
    expect(loaded.isFavorite).toBeUndefined();
  });

  it("prepends a new character", () => {
    saveCharacters([makeCharacter({ id: "old", name: "旧" })]);
    upsertCharacter(makeCharacter({ id: "new", name: "新" }));

    expect(loadCharacters().map((c) => c.id)).toEqual(["new", "old"]);
  });

  it("updates an existing character in place, without reordering", () => {
    // The dashboard's default sort is updatedAt-desc, so an in-place update is
    // what keeps a card from jumping position. Toggling favourite relies on this.
    saveCharacters([
      makeCharacter({ id: "a", name: "A" }),
      makeCharacter({ id: "b", name: "B" }),
      makeCharacter({ id: "c", name: "C" }),
    ]);

    upsertCharacter(makeCharacter({ id: "b", name: "B", favorite: true }));

    const ids = loadCharacters().map((c) => c.id);
    expect(ids).toEqual(["a", "b", "c"]);
  });

  it("does not rewrite updatedAt when the caller did not change it", () => {
    // Favouriting must not look like an edit, otherwise the card reorders.
    saveCharacters([makeCharacter({ id: "a", updatedAt: "2026-03-03T00:00:00.000Z" })]);
    upsertCharacter(makeCharacter({ id: "a", favorite: true, updatedAt: "2026-03-03T00:00:00.000Z" }));

    expect(loadCharacters()[0].updatedAt).toBe("2026-03-03T00:00:00.000Z");
  });

  it("deletes only the requested character", () => {
    saveCharacters([makeCharacter({ id: "a" }), makeCharacter({ id: "b" })]);

    expect(deleteCharacter("a").map((c) => c.id)).toEqual(["b"]);
    expect(loadCharacters().map((c) => c.id)).toEqual(["b"]);
  });

  it("duplicates a character with a fresh id and a name suffix", () => {
    saveCharacters([makeCharacter({ id: "a", name: "林烬" })]);

    const [copy] = duplicateCharacter(loadCharacters()[0]);
    expect(copy.id).not.toBe("a");
    expect(copy.name).toBe("林烬 Copy");
    expect(loadCharacters()).toHaveLength(2);
  });

  it("falls back to a placeholder name when duplicating an unnamed character", () => {
    const [copy] = duplicateCharacter(makeCharacter({ id: "a", name: "" }));
    expect(copy.name).toBe("未命名角色 Copy");
  });
});
