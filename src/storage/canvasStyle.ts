// The drawing's appearance: presets, the advanced knobs behind them, and the
// per-object overrides an author may set.
//
// This is presentation only. It never names or changes a relationship kind, and
// nothing here is written into a character or a relationship record.

export type CanvasPresetId =
  | "classic"
  | "archive"
  | "portrait"
  | "faction"
  | "minimal"
  | "story"
  | "dossier"
  | "soft";

export type NodeShape = "circle" | "square";
/**
 * How an uploaded picture sits in its node. The picture is content, not decoration:
 * a portrait cropped to a circle loses the top of a head, and a wide scene loses both
 * ends. `auto` reads the picture's own proportions; the other two are the author's
 * decision and win over it.
 */
export type AvatarShape = "auto" | "circle" | "rounded";

/**
 * How much of a person a node shows. Not a size: a compact node answers "who is
 * connected to whom", a card answers "who is this". An old layout has no value here
 * and keeps the avatar node it was drawn with.
 */
/** Default gap between a relationship word and its line, in drawing units. */
export const LABEL_OFFSET_DEFAULT = 13;

export type NodeForm = "avatar" | "compact" | "card";
export type GridKind = "none" | "dots" | "lines";
export type EdgeDash = "solid" | "dashed" | "dotted";
export type EdgeCurve = "curved" | "straight";
/**
 * How a directed relationship's head is drawn. `none` hides the head and keeps the
 * direction in the data, which is what 极简展示 needs: the arrow is ink, not semantics.
 */
export type ArrowStyle = "concise" | "thin" | "soft" | "none";

export type CanvasStyle = {
  preset: CanvasPresetId | "custom";
  node: {
    size: number; // multiplier of the base radius
    form: NodeForm;
    shape: NodeShape;
    avatarShape: AvatarShape;
    showAvatars: boolean;
    showNames: boolean;
    /** Multiplier on the size the display settings already chose, not a second
     *  absolute size: two controls for one number is how a preference gets
     *  silently overridden. */
    nameScale: number;
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
    arrow: ArrowStyle;
    showLabel: boolean;
    labelSize: number;
    /** Where along the line the word sits: 0 at the source, 1 at the target. */
    labelT: number;
    /** Perpendicular distance from the line, in drawing units. 0 sits on it. */
    labelOffset: number;
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
  { id: "story", name: "故事脉络", hint: "暖纸底、带方向的曲线，讲事件与影响" },
  { id: "dossier", name: "关系档案", hint: "卡片姓名加职业，细线方格，读细节" },
  { id: "soft", name: "柔和展示", hint: "浅色底、无箭头，适合导出设定展示图" },
];

const BASE: CanvasStyle = {
  preset: "classic",
  node: {
    size: 1,
    form: "avatar",
    shape: "circle",
    avatarShape: "auto",
    showAvatars: true,
    showNames: true,
    nameScale: 1,
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
    arrow: "concise",
    showLabel: true,
    labelSize: 10,
    labelT: 0.5,
    labelOffset: LABEL_OFFSET_DEFAULT,
    labelBackground: false,
  },
  canvas: {
    background: "",
    grid: "dots",
    // A finer reference plane than the 48 it shipped with: at 48 the dots read as
    // objects on a sparse canvas rather than as paper under a drawing.
    gridSize: 36,
    gridOpacity: 0.42,
    snap: false,
  },
};

/** What each preset changes. Anything not listed falls back to the base. */
const PRESET_PATCHES: Record<CanvasPresetId, DeepPartial<CanvasStyle>> = {
  classic: {},
  archive: {
    node: { size: 0.92, form: "compact", showAvatars: false, nameScale: 1, borderColor: "#b6a899", background: "#fffdf8" },
    edge: { color: "#7a6a58", width: 1, showLabel: true, labelBackground: true, arrow: "thin" },
    canvas: { background: "#f7f2e8", grid: "lines", gridSize: 40, gridOpacity: 0.35, snap: false },
  },
  portrait: {
    node: { size: 1.35, form: "avatar", nameScale: 1.2, showAvatars: true },
    edge: { width: 1.2, labelSize: 11, showLabel: false, labelT: 0.5, labelOffset: LABEL_OFFSET_DEFAULT },
    canvas: { grid: "none", snap: true },
  },
  faction: {
    node: { size: 1, form: "avatar", shape: "circle" },
    edge: {
      byKind: true,
      width: 2.4,
      curve: "straight",
      arrowSize: 1.35,
      labelSize: 10.5,
      labelT: 0.5,
      labelOffset: LABEL_OFFSET_DEFAULT,
    },
    canvas: { grid: "dots", gridSize: 56, gridOpacity: 0.35 },
  },
  minimal: {
    node: { size: 0.9, form: "compact", showAvatars: false, nameScale: 0.95 },
    edge: { width: 0.8, arrowSize: 0.6, arrow: "none", showLabel: false },
    canvas: { grid: "none", background: "" },
  },
  // 故事脉络 reads as a page of a chronicle: warm paper, curves that carry the eye from
  // cause to effect, and heads large enough to say which way the influence runs.
  story: {
    node: { size: 1.1, form: "avatar", showAvatars: true, nameScale: 1.08 },
    edge: {
      color: "#8a6f57",
      width: 1.8,
      curve: "curved",
      arrowSize: 1.3,
      arrow: "concise",
      showLabel: true,
      labelSize: 11,
    },
    canvas: { background: "#fbf7f0", grid: "dots", gridSize: 38, gridOpacity: 0.3 },
  },
  // 关系档案 is for reading a person and their neighbours: cards carry 姓名 + 职业,
  // the lines stay thin so the text wins, and the label sits on its own background.
  dossier: {
    node: {
      size: 1,
      form: "card",
      showAvatars: true,
      nameScale: 1,
      borderColor: "#c8ced8",
      background: "#ffffff",
    },
    edge: {
      color: "#5b6472",
      width: 1.1,
      curve: "straight",
      arrowSize: 0.9,
      arrow: "thin",
      showLabel: true,
      labelSize: 10,
      labelBackground: true,
    },
    canvas: { background: "#f6f7f9", grid: "lines", gridSize: 44, gridOpacity: 0.22 },
  },
  // 柔和展示 is a picture to export, not a diagram to edit: soft light, no arrows, no
  // grid, and kind colours used as a quiet palette rather than as a legend.
  soft: {
    node: {
      size: 1.22,
      form: "avatar",
      showAvatars: true,
      nameScale: 1.15,
      borderColor: "#e6d9e8",
      background: "#fffafc",
    },
    edge: { byKind: true, width: 1, curve: "curved", arrowSize: 0.9, arrow: "none", showLabel: false },
    canvas: { background: "#fdf8f4", grid: "none", gridOpacity: 0.2 },
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
      form: node.form === "compact" || node.form === "card" ? node.form : "avatar",
      shape: node.shape === "square" ? "square" : "circle",
      avatarShape:
        node.avatarShape === "circle" || node.avatarShape === "rounded"
          ? node.avatarShape
          : base.node.avatarShape,
      showAvatars: typeof node.showAvatars === "boolean" ? node.showAvatars : base.node.showAvatars,
      showNames: typeof node.showNames === "boolean" ? node.showNames : base.node.showNames,
      // A Sprint 50 build stored an absolute size here. It is read as a ratio of the
      // 13px the display settings called "medium", so an old layout keeps the size
      // it was given instead of snapping to the preset.
      nameScale: num(
        node.nameScale,
        typeof node.nameSize === "number"
          ? Math.min(1.8, Math.max(0.8, node.nameSize / 13))
          : base.node.nameScale,
        0.8,
        1.8,
      ),
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
      // A style saved before the choice existed keeps the head it drew: the old
      // `arrowSize: 0` meant "no head" and is read that way rather than as a hairline.
      arrow:
        edge.arrow === "thin" || edge.arrow === "soft" || edge.arrow === "none"
          ? edge.arrow
          : typeof edge.arrowSize === "number" && edge.arrowSize === 0
            ? "none"
            : base.edge.arrow,
      showLabel: typeof edge.showLabel === "boolean" ? edge.showLabel : base.edge.showLabel,
      labelSize: num(edge.labelSize, base.edge.labelSize, 8, 18),
      // A style saved before these existed sits where it always did: mid-line, just
      // clear of it. Defaults are read here, not written into old records.
      labelT: num(edge.labelT, 0.5, 0.1, 0.9),
      labelOffset: num(edge.labelOffset, LABEL_OFFSET_DEFAULT, -24, 24),
      labelBackground:
        typeof edge.labelBackground === "boolean" ? edge.labelBackground : base.edge.labelBackground,
    },
    canvas: {
      background: typeof canvas.background === "string" ? canvas.background : base.canvas.background,
      grid: canvas.grid === "none" || canvas.grid === "lines" ? canvas.grid : base.canvas.grid,
      gridSize: num(canvas.gridSize, base.canvas.gridSize, 16, 120),
      snap: typeof canvas.snap === "boolean" ? canvas.snap : base.canvas.snap,
      gridOpacity: num(canvas.gridOpacity, base.canvas.gridOpacity, 0.05, 0.8),
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
