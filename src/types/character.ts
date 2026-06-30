export type CharacterTag = {
  id: string;
  name: string;
  color?: string;
};

export type Character = {
  id: string;
  name: string;
  avatarEmoji?: string;
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
  visualStyle?: string;
  characterKeywords?: string;
  imagePrompt?: string;
  createdAt?: string;
  updatedAt: string;
};
