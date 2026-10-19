// The drawing's appearance: presets, the advanced knobs behind them, and the
// per-object overrides an author may set.
//
// This is presentation only. It never names or changes a relationship kind, and
// nothing here is written into a character or a relationship record.

export type CanvasPresetId = "classic" | "archive" | "portrait" | "faction" | "minimal";

export type NodeShape = "circle" | "square";
export type GridKind = "none" | "dots" | "lines";
export type EdgeDash = "solid" | "dashed" | "dotted";
export type EdgeCurve = "curved" | "straight";

export type CanvasStyle = {
  preset: CanvasPresetId | "custom";
  node: {
    size: number; // multiplier of the base radius
    shape: NodeShape;
    showAvatars: boolean;
    showNames: boolean;
    nameSize: number;
    nameInside: boolean;
    borderColor: string;
    background: string;
  };
  edge: {
    color: string;
    byKind: boolean;
    width: number;
    dash: EdgeDash;
    curve: EdgeCurve;
    arrowSize: number;
    showLabel: boolean;
    labelSize: number;
    labelBackground: boolean;
  };
  canvas: {
    background: string;
    grid: GridKind;
    gridSize: number;
    gridOpacity: number;
    snap: boolean;
  };
};

export type NodeStylePatch = Partial<CanvasStyle["node"]>;
export type EdgeStylePatch = Partial<CanvasStyle["edge"]>;

export type CanvasBookmark = {
  id: string;
  name: string;
  view: { k: number; x: number; y: number };
};

export const CANVAS_PRESETS: Array<{ id: CanvasPresetId; name: string; hint: string }> = [
  { id: "classic", name: "经典关系图", hint: "紫灰连线、圆点头像，日常阅读" },
  { id: "archive", name: "档案研究", hint: "纸张底色、细线与方格，信息密度高" },
  { id: "portrait", name: "人物群像", hint: "大节点头像、名字醒目，以人物为主" },
  { id: "faction", name: "阵营关系", hint: "按关系类型着色，粗线、直线，阵营感" },
  { id: "minimal", name: "极简展示", hint: "无网格、无箭头、细线，只留结构" },
];

const BASE: CanvasStyle = {
  preset: "classic",
  node: {
    size: 1,
    shape: "circle",
    showAvatars: true,
    showNames: true,
    nameSize: 11,
    nameInside: false,
    borderColor: "",
    background: "",
  },
  edge: {
    color: "",
    byKind: false,
    width: 1.4,
    dash: "solid",
    curve: "curved",
    arrowSize: 1,
    showLabel: true,
    labelSize: 10,
    labelBackground: false,
  },
  canvas: {
    background: "",
    grid: "dots",
    gridSize: 48,
    gridOpacity: 0.5,
    snap: false,
  },
};

/** What each preset changes. Anything not listed falls back to the base. */
const PRESET_PATCHES: Record<CanvasPresetId, DeepPartial<CanvasStyle>> = {
  classic: {},
  archive: {
    node: { size: 0.92, showAvatars: false, nameSize: 12, borderColor: "#b6a899", background: "#fffdf8" },
    edge: { color: "#7a6a58", width: 1, showLabel: true, labelBackground: true },
    canvas: { background: "#f7f2e8", grid: "lines", gridSize: 40, gridOpacity: 0.35 },
  },
  portrait: {
    node: { size: 1.35, nameSize: 13, showAvatars: true },
    edge: { width: 1.2, labelSize: 11, showLabel: false },
    canvas: { grid: "none" },
  },
  faction: {
    node: { size: 1, shape: "circle" },
    edge: { byKind: true, width: 2.4, curve: "straight", arrowSize: 1.35, labelSize: 10.5 },
    canvas: { grid: "dots", gridSize: 56, gridOpacity: 0.35 },
  },
  minimal: {
    node: { size: 0.9, showAvatars: false, nameSize: 11 },
    edge: { width: 0.8, arrowSize: 0.6, showLabel: false },
    canvas: { grid: "none", background: "" },
  },
};

type DeepPartial<T> = { [K in keyof T]?: Partial<T[K]> };

export function styleForPreset(id: CanvasPresetId): CanvasStyle {
  const patch = PRESET_PATCHES[id] ?? {};
  return {
    preset: id,
    node: { ...BASE.node, ...(patch.node ?? {}) },
    edge: { ...BASE.edge, ...(patch.edge ?? {}) },
    canvas: { ...BASE.canvas, ...(patch.canvas ?? {}) },
  };
}

export const DEFAULT_CANVAS_STYLE: CanvasStyle = styleForPreset("classic");

const clamp = (value: number, min: number, max: number) =>
  Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : min;

/** A missing or unreadable number takes the preset's value, not the slider's end. */
const num = (value: unknown, fallback: number, min: number, max: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
};

/**
 * Reads a style from storage, taking whatever is valid and falling back field by
 * field. A style written by an older build, or half-written by a crash, must not
 * blank the canvas.
 */
export function normalizeCanvasStyle(value: unknown): CanvasStyle {
  if (!value || typeof value !== "object") {
    return DEFAULT_CANVAS_STYLE;
  }
  const record = value as Record<string, unknown>;
  const node = (record.node ?? {}) as Record<string, unknown>;
  const edge = (record.edge ?? {}) as Record<string, unknown>;
  const canvas = (record.canvas ?? {}) as Record<string, unknown>;
  const preset = CANVAS_PRESETS.some((item) => item.id === record.preset)
    ? (record.preset as CanvasPresetId)
    : "custom";
  const base = record.preset && preset !== "custom" ? styleForPreset(preset) : DEFAULT_CANVAS_STYLE;

  return {
    preset,
    node: {
      size: num(node.size, base.node.size, 0.6, 2),
      shape: node.shape === "square" ? "square" : "circle",
      showAvatars: typeof node.showAvatars === "boolean" ? node.showAvatars : base.node.showAvatars,
      showNames: typeof node.showNames === "boolean" ? node.showNames : base.node.showNames,
      nameSize: num(node.nameSize, base.node.nameSize, 8, 20),
      nameInside: typeof node.nameInside === "boolean" ? node.nameInside : base.node.nameInside,
      borderColor: typeof node.borderColor === "string" ? node.borderColor : base.node.borderColor,
      background: typeof node.background === "string" ? node.background : base.node.background,
    },
    edge: {
      color: typeof edge.color === "string" ? edge.color : base.edge.color,
      byKind: typeof edge.byKind === "boolean" ? edge.byKind : base.edge.byKind,
      width: num(edge.width, base.edge.width, 0.4, 6),
      dash: edge.dash === "dashed" || edge.dash === "dotted" ? edge.dash : "solid",
      curve: edge.curve === "straight" ? "straight" : "curved",
      arrowSize: num(edge.arrowSize, base.edge.arrowSize, 0, 2.5),
      showLabel: typeof edge.showLabel === "boolean" ? edge.showLabel : base.edge.showLabel,
      labelSize: num(edge.labelSize, base.edge.labelSize, 8, 18),
      labelBackground:
        typeof edge.labelBackground === "boolean" ? edge.labelBackground : base.edge.labelBackground,
    },
    canvas: {
      background: typeof canvas.background === "string" ? canvas.background : base.canvas.background,
      grid: canvas.grid === "none" || canvas.grid === "lines" ? canvas.grid : base.canvas.grid,
      gridSize: num(canvas.gridSize, base.canvas.gridSize, 16, 120),
      gridOpacity: num(canvas.gridOpacity, base.canvas.gridOpacity, 0.05, 0.8),
      snap: typeof canvas.snap === "boolean" ? canvas.snap : base.canvas.snap,
    },
  };
}

/** A stable hue per relationship kind, so colour carries meaning without stored config. */
export function kindHue(kind: string): number {
  let hash = 0;
  for (let index = 0; index < kind.length; index += 1) {
    hash = (hash * 31 + kind.charCodeAt(index)) % 360;
  }
  return hash;
}
