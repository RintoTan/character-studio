import type { Character, CharacterTag } from "../types/character";

const STORAGE_KEY = "character-studio.characters";

export function loadCharacters(): Character[] {
  try {
    const rawValue = localStorage.getItem(STORAGE_KEY);
    const characters = rawValue ? (JSON.parse(rawValue) as Character[]) : [];

    return characters.map((character) => ({
      ...character,
      avatarEmoji: character.avatarEmoji || "🙂",
      isDraft: character.isDraft === true,
      draftOfId: character.draftOfId,
      tags: normalizeTags(character),
      createdAt: character.createdAt || character.updatedAt || new Date().toISOString(),
      updatedAt: character.updatedAt || character.createdAt || new Date().toISOString(),
    }));
  } catch {
    return [];
  }
}

function normalizeTags(character: Character): CharacterTag[] {
  const tagMap = new Map<string, CharacterTag>();

  (Array.isArray(character.tags) ? character.tags : []).forEach((tag) => {
    if (tag.name?.trim()) {
      tagMap.set(tag.name, {
        id: tag.id || crypto.randomUUID(),
        name: tag.name,
        color: tag.color || "gray",
      });
    }
  });

  (character.personalityTags || []).forEach((tagName) => {
    if (tagName.trim() && !tagMap.has(tagName)) {
      tagMap.set(tagName, {
        id: `personality-${tagName}`,
        name: tagName,
        color: "gray",
      });
    }
  });

  return Array.from(tagMap.values());
}

export function saveCharacters(characters: Character[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(characters));
}

export function upsertCharacter(character: Character): Character[] {
  const characters = loadCharacters();
  const index = characters.findIndex((item) => item.id === character.id);

  if (index >= 0) {
    characters[index] = character;
  } else {
    characters.unshift(character);
  }

  saveCharacters(characters);
  return characters;
}

export function deleteCharacter(characterId: string): Character[] {
  const characters = loadCharacters().filter((item) => item.id !== characterId);
  saveCharacters(characters);
  return characters;
}

export function duplicateCharacter(character: Character): Character[] {
  const copy: Character = {
    ...character,
    id: crypto.randomUUID(),
    name: `${character.name || "未命名角色"} Copy`,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const characters = [copy, ...loadCharacters()];
  saveCharacters(characters);
  return characters;
}
