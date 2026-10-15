// What the dashboard remembers between visits, and the one rule it applies to it.
//
// The key name `character-studio.dashboard-prefs` was written out twice, once in
// App (which seeds it) and once in Dashboard (which owns it), so the two could
// drift apart silently. The type, the defaults, the parsing and the reset rule
// live here now.
//
// The reset rule is worth pulling out on its own: "clear the filters" is expressed
// in two places and they do not agree. The 清空筛选 button also resets the sort
// order; the cross-screen request from the editor does not. That difference is
// preserved here rather than quietly unified -- a clearing action that also
// reorders the list is a decision someone should make deliberately, not a
// by-product of this refactor.

export const DASHBOARD_PREFS_KEY = "character-studio.dashboard-prefs";
export const DASHBOARD_FLAGS_KEY = "character-studio.dashboard-flags";

export const SORT_MODES = ["updated-desc", "created-desc", "name-asc", "name-desc"] as const;
export const SCOPE_MODES = ["all", "favorites", "drafts"] as const;
export const VIEW_MODES = ["cards", "list"] as const;

export type SortMode = (typeof SORT_MODES)[number];
export type ScopeMode = (typeof SCOPE_MODES)[number];
export type ViewMode = (typeof VIEW_MODES)[number];

// The sentinel the three filter dropdowns use for "not filtering".
export const FILTER_ANY = "全部";

export type DashboardPrefs = {
  searchTerm: string;
  sortMode: SortMode;
  worldviewFilter: string;
  genderFilter: string;
  visualStyleFilter: string;
  favoriteMode: ScopeMode;
  viewMode: ViewMode;
};

export type DashboardFlags = {
  favoriteIds: string[];
  pinnedIds: string[];
};

export const defaultPrefs: DashboardPrefs = {
  searchTerm: "",
  sortMode: "updated-desc",
  worldviewFilter: FILTER_ANY,
  genderFilter: FILTER_ANY,
  visualStyleFilter: FILTER_ANY,
  favoriteMode: "all",
  viewMode: "cards",
};

export const defaultFlags: DashboardFlags = {
  favoriteIds: [],
  pinnedIds: [],
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pickMode<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

function pickText(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

/**
 * Only the declared fields survive, and each is checked against its own type.
 *
 * The spread this replaced accepted anything: a stored `searchTerm` that was not a
 * string reached `prefs.searchTerm.trim()` and threw on the first render, and a
 * `favoriteIds` that was not an array reached `new Set(...)` and threw on boot.
 * Storage this app did not write is exactly the case a local-first app has to
 * survive, so unknown keys are dropped and wrong types fall back per field.
 */
export function normalizePrefs(value: unknown): DashboardPrefs {
  if (!isRecord(value)) {
    return { ...defaultPrefs };
  }

  return {
    searchTerm: pickText(value.searchTerm, defaultPrefs.searchTerm),
    sortMode: pickMode(value.sortMode, SORT_MODES, defaultPrefs.sortMode),
    worldviewFilter: pickText(value.worldviewFilter, defaultPrefs.worldviewFilter),
    genderFilter: pickText(value.genderFilter, defaultPrefs.genderFilter),
    visualStyleFilter: pickText(value.visualStyleFilter, defaultPrefs.visualStyleFilter),
    favoriteMode: pickMode(value.favoriteMode, SCOPE_MODES, defaultPrefs.favoriteMode),
    viewMode: pickMode(value.viewMode, VIEW_MODES, defaultPrefs.viewMode),
  };
}

export function normalizeFlags(value: unknown): DashboardFlags {
  if (!isRecord(value)) {
    return { ...defaultFlags };
  }

  const ids = (input: unknown): string[] =>
    Array.isArray(input) ? input.filter((id): id is string => typeof id === "string") : [];

  return {
    favoriteIds: ids(value.favoriteIds),
    pinnedIds: ids(value.pinnedIds),
  };
}

export function loadDashboardPrefs(): DashboardPrefs {
  try {
    const raw = localStorage.getItem(DASHBOARD_PREFS_KEY);
    return raw ? normalizePrefs(JSON.parse(raw) as unknown) : { ...defaultPrefs };
  } catch {
    // Unreadable or absent storage must not stop the dashboard from opening.
    return { ...defaultPrefs };
  }
}

export function saveDashboardPrefs(prefs: DashboardPrefs): void {
  try {
    localStorage.setItem(DASHBOARD_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Quota or private mode: remembering the filters is a convenience.
  }
}

export function loadDashboardFlags(): DashboardFlags {
  try {
    const raw = localStorage.getItem(DASHBOARD_FLAGS_KEY);
    return raw ? normalizeFlags(JSON.parse(raw) as unknown) : { ...defaultFlags };
  } catch {
    return { ...defaultFlags };
  }
}

export function saveDashboardFlags(flags: DashboardFlags): void {
  try {
    localStorage.setItem(DASHBOARD_FLAGS_KEY, JSON.stringify(flags));
  } catch {
    // As above.
  }
}

/**
 * The shared half of both clearing actions: the search box and the three filter
 * dropdowns. `favoriteMode` defaults to whatever is already set, so a caller that
 * only means "clear the filters" does not have to restate the current scope --
 * and cannot accidentally write an undefined into it.
 *
 * `resetSort` is the half the two callers disagree about; see the note at the top.
 */
export function clearedFilters(
  current: DashboardPrefs,
  options: { favoriteMode?: ScopeMode; resetSort?: boolean } = {},
): DashboardPrefs {
  return {
    ...current,
    searchTerm: defaultPrefs.searchTerm,
    worldviewFilter: defaultPrefs.worldviewFilter,
    genderFilter: defaultPrefs.genderFilter,
    visualStyleFilter: defaultPrefs.visualStyleFilter,
    favoriteMode: options.favoriteMode ?? current.favoriteMode,
    sortMode: options.resetSort ? defaultPrefs.sortMode : current.sortMode,
  };
}
