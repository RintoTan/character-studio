// Which editor sections the author folded away.
//
// This used to live only in component state, so every reload and every re-entry
// put the author back in front of six expanded modules and they had to fold the
// same ones again. The fold is a work habit, not part of the character, so it is
// stored on its own key instead of inside the character record.

export const EDITOR_SECTION_IDS = [
  "basic",
  "appearance",
  "personality",
  "ability",
  "backstory",
  "prompt",
] as const;

export type EditorSectionId = (typeof EDITOR_SECTION_IDS)[number];

export type EditorCollapseState = Record<EditorSectionId, boolean>;

export const EDITOR_COLLAPSE_KEY = "character-studio.editor-sections";

export const defaultCollapseState: EditorCollapseState = {
  basic: false,
  appearance: false,
  personality: false,
  ability: false,
  backstory: false,
  prompt: false,
};

/**
 * Keeps whatever the stored object says, and fills the rest from the default so
 * a state written by an older build (which knew fewer sections) still loads.
 * Returns null when there is nothing usable, which lets the caller fall back to
 * the defaults instead of trusting a half-written or unrelated object.
 */
export function normalizeCollapseState(value: unknown): EditorCollapseState | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const known = EDITOR_SECTION_IDS.filter((id) => typeof record[id] === "boolean");

  if (known.length === 0) {
    return null;
  }

  const next = { ...defaultCollapseState };
  for (const id of known) {
    next[id] = record[id] === true;
  }

  return next;
}

export function loadCollapseState(): EditorCollapseState | null {
  try {
    const raw = localStorage.getItem(EDITOR_COLLAPSE_KEY);

    if (!raw) {
      return null;
    }

    return normalizeCollapseState(JSON.parse(raw) as unknown);
  } catch {
    // Unreadable or absent storage must not stop the editor from opening.
    return null;
  }
}

export function saveCollapseState(state: EditorCollapseState): void {
  try {
    localStorage.setItem(EDITOR_COLLAPSE_KEY, JSON.stringify(state));
  } catch {
    // Quota or private mode: remembering the fold is a convenience, never a
    // reason to fail the save the author actually asked for.
  }
}
