import type { CharacterDraft } from "../types/character";

export type InspirationCategory =
  | "appearance"
  | "personality"
  | "occupation"
  | "background"
  | "motivation"
  | "interests"
  | "items";

export type InspirationEntry = {
  id: string;
  text: string;
  /** Words that tie this entry to what the character already says about itself. */
  keywords: string[];
  tone: "light" | "neutral" | "dark";
};

/** Only the fields the studio is allowed to read as context. */
export type InspirationContext = Pick<
  CharacterDraft,
  | "occupation"
  | "worldview"
  | "personalityTags"
  | "appearanceDescription"
  | "backstory"
  | "habits"
  | "likes"
  | "importantItems"
  | "characterKeywords"
>;

export type Suggestion = {
  /** Unique per candidate, so rerolling one does not touch the others. */
  id: string;
  category: InspirationCategory;
  entryId: string;
  text: string;
  field: keyof CharacterDraft;
  fieldLabel: string;
  /** What this category writes into: free text, or one tag of a tag list. */
  kind: "text" | "tag";
  matchedKeywords: string[];
};

/** How a chosen suggestion lands in a field. */
export type ApplyMode = "replace" | "append";

export type ApplyItem = {
  suggestion: Suggestion;
  mode: ApplyMode;
};
