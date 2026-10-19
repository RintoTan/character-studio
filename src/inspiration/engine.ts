import { INSPIRATION_LIBRARY } from "../data/inspirationLibrary";
import type { CharacterDraft } from "../types/character";
import type {
  ApplyItem,
  InspirationCategory,
  InspirationContext,
  Suggestion,
} from "./types";

/**
 * Local, deterministic selection over the inspiration library.
 *
 * Deterministic means: the same seed and the same context always produce the same
 * candidates, which is what makes the engine testable. It does not mean the studio
 * repeats itself — the UI advances the seed on every generation and keeps a session
 * history of what it has already shown.
 */

export const CATEGORY_TARGETS: Record<
  InspirationCategory,
  { field: keyof CharacterDraft; label: string; kind: "text" | "tag" }
> = {
  appearance: { field: "appearanceDescription", label: "外貌描述", kind: "text" },
  personality: { field: "personalityTags", label: "性格标签", kind: "tag" },
  occupation: { field: "occupation", label: "职业", kind: "text" },
  background: { field: "backstory", label: "背景故事", kind: "text" },
  motivation: { field: "backstory", label: "背景故事（动机与冲突）", kind: "text" },
  interests: { field: "habits", label: "兴趣与习惯", kind: "text" },
  items: { field: "importantItems", label: "重要物品", kind: "text" },
};

export const CATEGORY_ORDER: InspirationCategory[] = [
  "appearance",
  "personality",
  "occupation",
  "background",
  "motivation",
  "interests",
  "items",
];

/** mulberry32: small, fast, and stable across platforms. */
export function createRng(seed: number) {
  let state = seed >>> 0;

  return function next() {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

const SEPARATORS = /[\s，。、；：！？,.;:!?/|·—（）()「」【】<>《》"']+/;

export function contextTokens(context: InspirationContext): string[] {
  const raw = [
    context.occupation,
    context.worldview,
    context.characterKeywords,
    ...(context.personalityTags || []),
    context.appearanceDescription,
    context.backstory,
    context.habits,
    context.likes,
    context.importantItems,
  ]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join(" ");

  return Array.from(
    new Set(
      raw
        .split(SEPARATORS)
        .map((token) => token.trim())
        .filter((token) => token.length >= 2),
    ),
  );
}

/** Which parts of the form the suggestion actually looked at, for the UI note. */
export function contextSources(context: InspirationContext): string[] {
  const sources: string[] = [];
  if (context.occupation?.trim()) sources.push("职业");
  if (context.worldview?.trim()) sources.push("世界观");
  if ((context.personalityTags || []).some((tag) => tag.trim())) sources.push("性格标签");
  if (context.appearanceDescription?.trim()) sources.push("外貌");
  if (context.backstory?.trim()) sources.push("背景故事");
  if (context.habits?.trim()) sources.push("兴趣与习惯");
  if (context.importantItems?.trim()) sources.push("重要物品");
  return sources;
}

function matchScore(entryKeywords: string[], tokens: string[]) {
  const matched = entryKeywords.filter((keyword) =>
    tokens.some((token) => token.includes(keyword) || keyword.includes(token)),
  );
  return matched;
}

export type GenerateOptions = {
  category: InspirationCategory;
  context: InspirationContext;
  seed: number;
  count?: number;
  /** Entry ids already shown this session; they are only reused when the pool runs out. */
  excludeEntryIds?: string[];
};

export function generateSuggestions({
  category,
  context,
  seed,
  count = 3,
  excludeEntryIds = [],
}: GenerateOptions): Suggestion[] {
  const target = CATEGORY_TARGETS[category];
  const tokens = contextTokens(context);
  const entries = INSPIRATION_LIBRARY[category].map((entry) => ({
    entry,
    matched: matchScore(entry.keywords, tokens),
  }));

  // Context narrows the pool only when it has something to say. An empty character
  // must still get a full set.
  const relevant = entries.filter((item) => item.matched.length > 0);
  const primary = relevant.length >= 2 ? relevant : entries;
  const excluded = new Set(excludeEntryIds);
  const fresh = primary.filter((item) => !excluded.has(item.entry.id));
  const pool = fresh.length > 0 ? fresh : primary;

  const rng = createRng(seed);
  const ranked = [...pool]
    .map((item) => ({ ...item, order: rng() }))
    .sort((a, b) => b.matched.length - a.matched.length || a.order - b.order);

  const picked: typeof ranked = [];
  for (const item of ranked) {
    if (picked.length >= count) break;
    picked.push(item);
  }

  // If the pool was smaller than the requested count, fill from the whole category
  // rather than returning a short list.
  if (picked.length < count) {
    const used = new Set(picked.map((item) => item.entry.id));
    const rest = entries
      .filter((item) => !used.has(item.entry.id))
      .map((item) => ({ ...item, order: rng() }))
      .sort((a, b) => a.order - b.order);
    for (const item of rest) {
      if (picked.length >= count) break;
      picked.push(item);
    }
  }

  return picked.map(({ entry, matched }) => ({
    id: `${category}:${entry.id}:${seed}`,
    category,
    entryId: entry.id,
    text: entry.text,
    field: target.field,
    fieldLabel: target.label,
    kind: target.kind,
    matchedKeywords: matched,
  }));
}

/** One replacement for a single candidate, avoiding everything already on screen. */
export function rerollSuggestion(options: GenerateOptions & { avoidEntryIds: string[] }) {
  const [next] = generateSuggestions({
    ...options,
    count: 1,
    excludeEntryIds: [...(options.excludeEntryIds || []), ...options.avoidEntryIds],
  });
  return next;
}

/**
 * Writes chosen suggestions into a copy of the draft. The editor hands the result to
 * its own state setter, which is also what typing does — there is no second save path.
 */
export function mergeSuggestions(values: CharacterDraft, items: ApplyItem[]): CharacterDraft {
  const next = { ...values };

  for (const item of items) {
    const { suggestion, mode } = item;

    if (suggestion.kind === "tag") {
      next.personalityTags = Array.from(new Set([...(next.personalityTags || []), suggestion.text]));
      continue;
    }

    const field = suggestion.field as
      | "appearanceDescription"
      | "occupation"
      | "backstory"
      | "habits"
      | "importantItems";
    const previous = (next[field] as string | undefined)?.trim() ?? "";
    const separator = field === "occupation" ? " · " : "\n";
    next[field] =
      mode === "replace" || !previous ? suggestion.text : `${previous}${separator}${suggestion.text}`;
  }

  return next;
}
