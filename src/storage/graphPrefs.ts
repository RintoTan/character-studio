// How large the relationship graph draws its nodes and names.
//
// Node size is a preference rather than a constant here because the two extremes
// are both legitimate: a dense 100-character wheel wants small nodes so the ring
// reads at all, while a three-character graph wants large ones. `radius`,
// `emojiSize` and `nameDrop` travel together — they are three numbers describing
// one circle and the name hanging off it — so they are one choice, not three.
export const GRAPH_PREFS_KEY = "character-studio.graph-prefs";

export type GraphSizeValue = "small" | "medium" | "large";

export type GraphPrefs = {
  avatarSize: GraphSizeValue;
  nameSize: GraphSizeValue;
  /**
   * Export resolution, as a multiple of the canvas on screen. 1 is what you see;
   * 2 is enough for a slide or a print at A4; 3 is for a large poster, and is the
   * one that can produce a several-megabyte PNG.
   */
  exportScale: GraphExportScale;
};

export type GraphExportScale = 1 | 2 | 3;

export const EXPORT_SCALES: Array<{ value: GraphExportScale; label: string }> = [
  { value: 1, label: "1x" },
  { value: 2, label: "2x" },
  { value: 3, label: "3x" },
];

/** Everything the drawing needs, flattened from the two choices. */
export type GraphMetrics = {
  /** Node circle radius, in drawing units. */
  radius: number;
  /** Glyph size of the avatar emoji drawn in the circle. */
  emojiSize: number;
  /** Font size of the name under the node. */
  nameSize: number;
  /** Distance from the node centre to the middle of the name. */
  nameDrop: number;
  /** Room under a name line for its descenders. */
  nameSpace: number;
};

export const AVATAR_SIZES: Array<{
  value: GraphSizeValue;
  label: string;
  radius: number;
  emojiSize: number;
  nameDrop: number;
}> = [
  { value: "small", label: "小", radius: 22, emojiSize: 19, nameDrop: 36 },
  { value: "medium", label: "中", radius: 30, emojiSize: 26, nameDrop: 44 },
  { value: "large", label: "大", radius: 42, emojiSize: 36, nameDrop: 58 },
];

export const NAME_SIZES: Array<{
  value: GraphSizeValue;
  label: string;
  fontSize: number;
  nameSpace: number;
}> = [
  { value: "small", label: "小", fontSize: 11, nameSpace: 18 },
  { value: "medium", label: "中", fontSize: 13, nameSpace: 22 },
  { value: "large", label: "大", fontSize: 16, nameSpace: 28 },
];

export const defaultGraphPrefs: GraphPrefs = {
  avatarSize: "medium",
  nameSize: "medium",
  exportScale: 2,
};

function isSizeValue(value: unknown): value is GraphSizeValue {
  return value === "small" || value === "medium" || value === "large";
}

function isExportScale(value: unknown): value is GraphExportScale {
  return value === 1 || value === 2 || value === 3;
}

// Per-field, so one unknown value in storage cannot take the other one with it.
export function normalizeGraphPrefs(value: unknown): GraphPrefs {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ...defaultGraphPrefs };
  }

  const candidate = value as Partial<GraphPrefs>;
  return {
    avatarSize: isSizeValue(candidate.avatarSize) ? candidate.avatarSize : defaultGraphPrefs.avatarSize,
    nameSize: isSizeValue(candidate.nameSize) ? candidate.nameSize : defaultGraphPrefs.nameSize,
    exportScale: isExportScale(candidate.exportScale)
      ? candidate.exportScale
      : defaultGraphPrefs.exportScale,
  };
}

export function loadGraphPrefs(): GraphPrefs {
  try {
    const stored = localStorage.getItem(GRAPH_PREFS_KEY);
    return stored ? normalizeGraphPrefs(JSON.parse(stored)) : { ...defaultGraphPrefs };
  } catch {
    return { ...defaultGraphPrefs };
  }
}

export function saveGraphPrefs(prefs: GraphPrefs): void {
  try {
    localStorage.setItem(GRAPH_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // A full quota must not take the screen down with it.
  }
}

export function graphMetrics(prefs: GraphPrefs): GraphMetrics {
  const avatar = AVATAR_SIZES.find((entry) => entry.value === prefs.avatarSize) ?? AVATAR_SIZES[1];
  const name = NAME_SIZES.find((entry) => entry.value === prefs.nameSize) ?? NAME_SIZES[1];

  return {
    radius: avatar.radius,
    emojiSize: avatar.emojiSize,
    nameDrop: avatar.nameDrop,
    nameSize: name.fontSize,
    nameSpace: name.nameSpace,
  };
}
