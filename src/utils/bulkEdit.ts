// Bulk field editing.
//
// The bulk bar could already favourite, export, duplicate and delete a selection,
// but not *edit* one: with a hundred imported characters whose blanks need the same
// answer — this group is all 赛博朋克, these fourteen are all 反派 — there was no
// way to say it. Every field is opt-in, so an edit only touches what the author
// switched on; a character that needs no change is returned by identity.

import type { Character } from "../types/character";

export type CharacterBulkPatch = {
  worldview?: string;
  visualStyle?: string;
  favorite?: boolean;
  addTags?: string[];
  removeTags?: string[];
};

export type BulkPatchFieldCounts = {
  worldview: number;
  visualStyle: number;
  favorite: number;
  tagsAdded: number;
  tagsRemoved: number;
};

export type BulkPatchSummary = {
  characters: Character[];
  changedCount: number;
  fieldCounts: BulkPatchFieldCounts;
};

const EMPTY_COUNTS: BulkPatchFieldCounts = {
  worldview: 0,
  visualStyle: 0,
  favorite: 0,
  tagsAdded: 0,
  tagsRemoved: 0,
};

function normalizeTag(value: string) {
  return value.trim().toLowerCase();
}

/** Splits what a person typed into tags: commas of either width, semicolons, newlines. */
export function parseTagInput(value: string): string[] {
  const seen = new Set<string>();
  const tags: string[] = [];

  for (const piece of value.split(/[,，、;；\n\r]+/)) {
    const tag = piece.trim();
    if (!tag) {
      continue;
    }
    const key = normalizeTag(tag);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    tags.push(tag);
  }

  return tags;
}

export function applyBulkPatch(
  characters: Character[],
  ids: Iterable<string>,
  patch: CharacterBulkPatch,
  now = new Date().toISOString(),
): BulkPatchSummary {
  const selected = new Set(ids);
  const addTags = parseTagInput((patch.addTags ?? []).join(","));
  const removeTags = new Set((patch.removeTags ?? []).map(normalizeTag).filter(Boolean));
  const fieldCounts: BulkPatchFieldCounts = { ...EMPTY_COUNTS };
  let changedCount = 0;

  const nextCharacters = characters.map((character) => {
    if (!selected.has(character.id)) {
      return character;
    }

    const draft: Character = { ...character };
    let changed = false;

    const worldview = patch.worldview?.trim();
    if (worldview && draft.worldview !== worldview) {
      draft.worldview = worldview;
      fieldCounts.worldview += 1;
      changed = true;
    }

    const visualStyle = patch.visualStyle?.trim();
    if (visualStyle && draft.visualStyle !== visualStyle) {
      draft.visualStyle = visualStyle;
      fieldCounts.visualStyle += 1;
      changed = true;
    }

    // Drafts keep their own favourite rules: promoting a draft is what makes it a
    // real character, so the bulk bar has always left this field alone for them.
    if (patch.favorite !== undefined && !character.isDraft && character.favorite !== patch.favorite) {
      draft.favorite = patch.favorite;
      draft.isFavorite = undefined;
      fieldCounts.favorite += 1;
      changed = true;
    }

    const tags = [...(draft.personalityTags ?? [])];
    let tagsTouched = false;

    if (removeTags.size > 0) {
      const kept = tags.filter((tag) => !removeTags.has(normalizeTag(tag)));
      if (kept.length !== tags.length) {
        fieldCounts.tagsRemoved += tags.length - kept.length;
        tags.length = 0;
        tags.push(...kept);
        tagsTouched = true;
      }
    }

    for (const tag of addTags) {
      if (!tags.some((existing) => normalizeTag(existing) === normalizeTag(tag))) {
        tags.push(tag);
        fieldCounts.tagsAdded += 1;
        tagsTouched = true;
      }
    }

    if (tagsTouched) {
      draft.personalityTags = tags;
      changed = true;
    }

    if (!changed) {
      return character;
    }

    draft.updatedAt = now;
    changedCount += 1;
    return draft;
  });

  return { characters: nextCharacters, changedCount, fieldCounts };
}

/** What the confirmation toast reports, and what the dialog lists while it is open. */
export function describeBulkPatch(fieldCounts: BulkPatchFieldCounts): string[] {
  const parts: string[] = [];

  if (fieldCounts.worldview > 0) {
    parts.push(`世界观 ${fieldCounts.worldview}`);
  }
  if (fieldCounts.visualStyle > 0) {
    parts.push(`视觉风格 ${fieldCounts.visualStyle}`);
  }
  if (fieldCounts.favorite > 0) {
    parts.push(`收藏 ${fieldCounts.favorite}`);
  }
  if (fieldCounts.tagsAdded > 0) {
    parts.push(`标签 +${fieldCounts.tagsAdded}`);
  }
  if (fieldCounts.tagsRemoved > 0) {
    parts.push(`标签 −${fieldCounts.tagsRemoved}`);
  }

  return parts;
}

/** True when the patch would ask for nothing, so the dialog can keep its button off. */
export function isEmptyBulkPatch(patch: CharacterBulkPatch): boolean {
  return (
    !patch.worldview?.trim() &&
    !patch.visualStyle?.trim() &&
    patch.favorite === undefined &&
    (patch.addTags ?? []).length === 0 &&
    (patch.removeTags ?? []).length === 0
  );
}
