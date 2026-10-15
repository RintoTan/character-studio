export type CharacterTag = {
  id: string;
  name: string;
  color?: string;
};

export type Character = {
  id: string;
  name: string;
  avatarEmoji?: string;
  avatarAssetId?: string;
  favorite?: boolean;
  isFavorite?: boolean;
  isDraft?: boolean;
  draftOfId?: string;
  age?: string;
  birthDate?: string;
  birthYear?: string;
  gender?: string;
  species?: string;
  occupation?: string;
  worldview?: string;
  tags?: CharacterTag[];
  personalityTags?: string[];
  appearanceDescription?: string;
  abilityDescription?: string;
  backstory?: string;
  likes?: string;
  dislikes?: string;
  habits?: string;
  importantItems?: string;
  relationshipKeywords?: string;
  visualStyle?: string;
  characterKeywords?: string;
  imagePrompt?: string;
  createdAt?: string;
  updatedAt: string;
};

/**
 * A character as the editor holds it: everything but the identity the store owns.
 * The editor writes the id and the timestamp on the way out, so a draft must not
 * carry them.
 */
export type CharacterDraft = Omit<Character, "id" | "updatedAt">;
