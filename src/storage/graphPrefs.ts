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
  /** Whether nodes draw their avatar at all. */
  showAvatars: boolean;
  /** Whether nodes draw their name at all. */
  showNames: boolean;
  /**
   * Whether the lines between nodes are drawn. Independent of which characters are in
   * scope and of the density cap: hiding the lines is a way to read the roster, not a
   * filter on the data and not a performance switch.
   */
  showEdges: boolean;
  /**
   * Export resolution, as a multiple of the canvas on screen. 1 is what you see;
   * 2 is enough for a slide or a print at A4; 3 is for a large poster, and is the
   * one that can produce a several-megabyte PNG.
   */
  exportScale: GraphExportScale;
  /**
   * Whether an exported picture carries a key for its relationship kinds. Off by
   * default: an export from before this option must not start gaining a panel.
   */
  exportLegend: boolean;
  exportLegendCorner: "auto" | "tl" | "tr" | "bl" | "br";
  /** Type size of the legend panel, 1 being the drawing's own scale. */
  exportLegendScale: number;
  /** Inner padding of the legend panel, as a fraction of the picture's short side. */
  exportLegendMargin: number;
  /** "canvas" blends into the artwork, "panel" keeps a readable block on any背景. */
  exportLegendBg: "canvas" | "panel";
  exportLegendOpacity: number;
  /** Whether the width/height fields move together. */
  exportLockAspect: boolean;
};

export type GraphExportScale = 1 | 2 | 3;

export const EXPORT_SCALES: Array<{ value: GraphExportScale; label: string }> = [
  { value: 1, label: "1x" },
  { value: 2, label: "2x" },
  { value: 3, label: "3x" },
];

/**
 * Export shape. "canvas" keeps the drawing's own proportions; the rest frame the
 * content to a fixed ratio by growing the short side, so nothing is cropped.
 */
export type GraphExportRatio = "canvas" | "1:1" | "4:3" | "16:9" | "9:16";

export const EXPORT_RATIOS: Array<{ value: GraphExportRatio; label: string; ratio: number }> = [
  { value: "canvas", label: "画布", ratio: 0 },
  { value: "1:1", label: "1:1", ratio: 1 },
  { value: "4:3", label: "4:3", ratio: 4 / 3 },
  { value: "16:9", label: "16:9", ratio: 16 / 9 },
  { value: "9:16", label: "9:16", ratio: 9 / 16 },
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
  showAvatars: true,
  showNames: true,
  showEdges: true,
  exportScale: 2,
  exportLegend: false,
  exportLegendCorner: "auto",
  exportLegendScale: 1,
  exportLegendMargin: 0.02,
  exportLegendBg: "canvas",
  exportLegendOpacity: 0.94,
  exportLockAspect: true,
};

function isSizeValue(value: unknown): value is GraphSizeValue {
  return value === "small" || value === "medium" || value === "large";
}

function isExportScale(value: unknown): value is GraphExportScale {
  return value === 1 || value === 2 || value === 3;
}

// A stored record from before the two visibility switches existed has neither key,
// and `undefined` is not a boolean — so an absent field takes its default rather than
// turning the feature off. Only an explicit boolean is honoured.
function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

function numberIn(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;
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
    showAvatars: isBoolean(candidate.showAvatars) ? candidate.showAvatars : defaultGraphPrefs.showAvatars,
    showNames: isBoolean(candidate.showNames) ? candidate.showNames : defaultGraphPrefs.showNames,
    showEdges: isBoolean(candidate.showEdges) ? candidate.showEdges : defaultGraphPrefs.showEdges,
    exportScale: isExportScale(candidate.exportScale)
      ? candidate.exportScale
      : defaultGraphPrefs.exportScale,
    exportLegend: isBoolean(candidate.exportLegend) ? candidate.exportLegend : defaultGraphPrefs.exportLegend,
    exportLegendScale: numberIn(candidate.exportLegendScale, 0.5, 2.2, defaultGraphPrefs.exportLegendScale),
    exportLegendMargin: numberIn(candidate.exportLegendMargin, 0, 0.12, defaultGraphPrefs.exportLegendMargin),
    exportLegendBg:
      candidate.exportLegendBg === "panel" || candidate.exportLegendBg === "canvas"
        ? candidate.exportLegendBg
        : defaultGraphPrefs.exportLegendBg,
    exportLegendOpacity: numberIn(candidate.exportLegendOpacity, 0.2, 1, defaultGraphPrefs.exportLegendOpacity),
    exportLockAspect: isBoolean(candidate.exportLockAspect)
      ? candidate.exportLockAspect
      : defaultGraphPrefs.exportLockAspect,
    exportLegendCorner:
      candidate.exportLegendCorner === "tl" ||
      candidate.exportLegendCorner === "tr" ||
      candidate.exportLegendCorner === "bl" ||
      candidate.exportLegendCorner === "br"
        ? candidate.exportLegendCorner
        : defaultGraphPrefs.exportLegendCorner,
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

/** Only the two size choices: the switches and the export scale change nothing here. */
export function graphMetrics(prefs: Pick<GraphPrefs, "avatarSize" | "nameSize">): GraphMetrics {
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
