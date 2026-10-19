import { DEFAULT_CANVAS_STYLE, CANVAS_PRESETS, kindHue, styleForPreset, type CanvasStyle, type CanvasPresetId } from "../storage/canvasStyle";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import { useEscapeDismiss } from "../hooks/useLightDismiss";
import {
  createRelationship,
  deleteRelationship,
  loadRelationships,
  pruneRelationships,
  saveRelationships,
} from "../storage/relationshipStorage";
import { Icon } from "../components/Icon";
import { WorkspaceHeader } from "../components/WorkspaceHeader";
import type { Character } from "../types/character";
import {
  RELATIONSHIP_KINDS,
  findDuplicateRelationship,
  isSymmetricKind,
  relationshipKindLabel,
  unorderedPairKey,
  type Relationship,
  type RelationshipKind,
} from "../types/relationship";
import {
  AVATAR_SIZES,
  EXPORT_SCALES,
  NAME_SIZES,
  graphMetrics,
  loadGraphPrefs,
  saveGraphPrefs,
  type GraphMetrics,
  type GraphPrefs,
} from "../storage/graphPrefs";
import {
  applyPositions,
  centroid,
  clusterLayout,
  gridLayout,
  groupedLayout,
  hierarchyLayout,
  createGroup,
  emptyLayout,
  groupBounds,
  isEmptyLayout,
  loadLayout,
  materializeLayout,
  placeMissingPositions,
  pruneLayout,
  removeGroup,
  ringLayout,
  saveLayout,
  setPosition,
  translatePositions,
  type ArrangeMode,
  type CanvasBookmark,
  type CanvasGroup,
  type CanvasLayout,
  type LayoutPoint,
} from "../storage/relationshipLayout";
import { exportSurfaceImage, exportSurfacePdf } from "../utils/importExport";
import {
  downloadPng,
  downloadSvg,
  inlineSvgPresentation,
  pruneToSelection,
  rasterizeSvg,
  stripTransientState,
  removeTransientMarks,
  scopeBounds,
  type ExportScope,
  type WorldBounds,
} from "../utils/canvasExport";
import { getAvatarAssetDataUrl } from "../utils/avatarAssets";
import { useTransientMessage } from "../hooks/useTransientMessage";
import { useDialogKeyboard } from "../hooks/useDialogKeyboard";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { CharacterSelect } from "../components/CharacterPicker";
import { CharacterRow, characterDisplayName, matchesCharacterQuery } from "../components/CharacterRow";

/**
 * A miniature of what a preset actually does — node size and fill, border, edge
 * width, colour, dash, and whether faces are drawn. A row of five words asks the
 * author to remember which is which; a swatch answers it.
 */
function PresetThumb({ presetId }: { presetId: CanvasPresetId }) {
  const preset = styleForPreset(presetId);
  const radius = 9 * preset.node.size;
  const stroke = preset.edge.byKind
    ? `hsl(${kindHue("friend")} 42% 48%)`
    : preset.edge.color || "#98a2b3";
  const dash =
    preset.edge.dash === "dashed" ? "5 3" : preset.edge.dash === "dotted" ? "1.5 3" : undefined;
  const fill = preset.node.background || "#f9fafb";
  const border = preset.node.borderColor || "#d1d5db";
  const lineWidth = Math.max(1, preset.edge.width);

  return (
    <svg aria-hidden="true" className="graph-preset-thumb" viewBox="0 0 96 56">
      <rect fill={preset.canvas.background || "transparent"} height="56" rx="8" width="96" />
      <line
        stroke={stroke}
        strokeDasharray={dash}
        strokeWidth={lineWidth}
        x1="26"
        x2="70"
        y1="28"
        y2="18"
      />
      <line
        stroke={stroke}
        strokeDasharray={dash}
        strokeWidth={Math.max(1, lineWidth * 0.8)}
        x1="26"
        x2="62"
        y1="28"
        y2="42"
      />
      <circle cx="26" cy="28" fill={fill} r={radius} stroke={border} strokeWidth="1.4" />
      <circle cx="70" cy="18" fill={fill} r={radius} stroke={border} strokeWidth="1.4" />
      <circle cx="62" cy="42" fill={fill} r={radius} stroke={border} strokeWidth="1.4" />
      {preset.node.showAvatars &&
        [
          [26, 28],
          [70, 18],
          [62, 42],
        ].map(([x, y]) => (
          <text
            dominantBaseline="central"
            fontSize={radius}
            key={`${x}-${y}`}
            textAnchor="middle"
            x={x}
            y={y}
          >
            🙂
          </text>
        ))}
    </svg>
  );
}

type RelationshipGraphProps = {
  characters: Character[];
  onBack: () => void;
  onOpenCharacter: (characterId: string) => void;
  /** Asked for by another screen — the preview's 在关系网中查看 — and consumed once. */
  focusCharacterId?: string | null;
  onFocusHandled?: () => void;
};

/** Rows per page in the management list. Twenty fits a laptop screen without a scroll
 *  inside the page, and keeps the pager close to the row being edited. */
const MANAGE_PAGE_SIZE = 20;
/** Past this many connected characters, the default drawing keeps only the hubs. */
const CORE_VIEW_LIMIT = 40;
// A phone canvas is a third of the width. Forty nodes fitted into it are six-pixel
// dots, so the drawn core is smaller there and the note says so.
const CORE_VIEW_LIMIT_NARROW = 24;
const CORE_VIEW_DEGREE = 2;
/** Below this many drawn nodes every edge can carry its type word; above it, only the
 *  edges of the node being pointed at do. */
const EDGE_LABEL_LIMIT = 18;
const VIEW = 640;
const RADIUS = 236;
const NODE_RADIUS = 30;
// The name is drawn 44 units under the node centre, and needs a little room for
// its descenders. Both numbers are also what the canvas has to leave clear, so
// the drawing never ends up with a clipped label.
const NAME_DROP = 44;
const NAME_SPACE = 22;
const CANVAS_PADDING = 16;
// What the drawing needs when the caller has not picked a size. The page always
// passes its own, so these are the reference numbers the layout tests compare to.
const DEFAULT_METRICS: GraphMetrics = {
  radius: NODE_RADIUS,
  emojiSize: 26,
  nameSize: 13,
  nameDrop: NAME_DROP,
  nameSpace: NAME_SPACE,
};
// A pair reads better side by side than stacked: on the wheel two nodes landed
// on the vertical axis 472 units apart, which is what made a two-character graph
// look like an empty canvas.
const PAIR_OFFSET = 150;
// Breathing room between two neighbouring nodes on the ring. The ring formula below
// treats this as the minimum arc a node is allowed, so raising it spreads the wheel
// rather than shrinking the nodes.
const NODE_GAP = 18;
// Whether a name is drawn is decided by how large it would actually render, not by a
// zoom factor. A zoom factor is the same number for a two-character graph and a
// hundred-character one, and those two drawings are scaled very differently: at "fit"
// the small one is enlarged (its names were hidden anyway, at a zoom nobody had
// reached) and the large one is shrunk until a name is three pixels tall. These three
// numbers are what "a name you can read" means here.
const MIN_LABEL_PX = 11;
const LABEL_GAP_FACTOR = 2.2;
const LABEL_GAP_MIN = 12;
// Where focusing a character stops zooming in. Enough for a big roster's names to
// become readable; past it the canvas is a close-up of one circle.
const FOCUS_MAX_ZOOM = 4;
// The fit view: a tenth of the frame left as margin, and never more than this much
// magnification, so a two-node graph is not drawn as two plates.
const FIT_MARGIN = 0.1;
const FIT_MAX_ZOOM = 1.6;
// Half the hover card's maximum width, so it can be centred on a node without hanging
// off the canvas. Kept equal to `.graph-node-card`'s max-width.
const HOVER_CARD_HALF = 110;
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 8;
const MIN_CANVAS_WIDTH = 320;
const MIN_CANVAS_HEIGHT = 180;
// How far a reciprocal edge bulges off the straight line between its two nodes,
// and how far a kind label sits off the curve it names. Without the first, A→B
// and B→A are the same stroke drawn twice; without the second, the stroke runs
// straight through the label.
const BEND_UNIT = 44;
const LABEL_OFFSET = 13;

export type GraphPoint = { x: number; y: number };

// A radial layout rather than a force simulation: with a handful of OCs it reads
// as a relationship wheel, it is deterministic, and it needs no layout library.
export function nodePositions(count: number, nodeRadius = NODE_RADIUS): GraphPoint[] {
  if (count <= 0) {
    return [];
  }

  if (count === 1) {
    return [{ x: VIEW / 2, y: VIEW / 2 }];
  }

  if (count === 2) {
    return [
      { x: VIEW / 2 - PAIR_OFFSET, y: VIEW / 2 },
      { x: VIEW / 2 + PAIR_OFFSET, y: VIEW / 2 },
    ];
  }

  // The ring grows with the roster. On the fixed 236 radius a hundred characters
  // sat 13.2px apart on an arc while each node is 60px wide, so the wheel was a
  // solid band of overlapping circles and unreadable names. Widening it to the arc
  // a node actually needs keeps the fit view legible; the labels then appear as the
  // author zooms in rather than all at once.
  const radius = Math.max(RADIUS, (count * (nodeRadius * 2 + NODE_GAP)) / (Math.PI * 2));

  return Array.from({ length: count }, (_, index) => {
    const angle = (index / count) * Math.PI * 2 - Math.PI / 2;
    return { x: VIEW / 2 + Math.cos(angle) * radius, y: VIEW / 2 + Math.sin(angle) * radius };
  });
}

/**
 * Rough width of a name at a given size, in drawing units. A name is centred under
 * its node, so half of it sticks out past the circle — and the canvas used to
 * reserve only the circle's own width, which is how the outermost names of a wide
 * wheel were being cut off at the left and right edges of the drawing.
 *
 * Measured by character class rather than by font metrics: this runs before any
 * element exists, and guessing generously costs nothing but a little margin.
 */
export function measureNameWidth(name: string, fontSize: number): number {
  let units = 0;
  for (const character of name) {
    // CJK and full-width forms are a full em; Latin, digits and punctuation about
    // half of one.
    units += /[\u2000-\u206f\u3000-\u9fff\uff00-\uffef]/.test(character) ? 1 : 0.55;
  }

  return units * fontSize;
}

export function widestNameHalfWidth(names: string[], fontSize: number): number {
  return names.reduce((widest, name) => Math.max(widest, measureNameWidth(name, fontSize)), 0) / 2;
}

function round(value: number) {
  return Math.round(value * 100) / 100;
}

/**
 * The clip a picture avatar is drawn through, so a square photograph reads as the
 * round node every other avatar already is.
 */
function avatarClipId(characterId: string) {
  return `graph-avatar-${characterId}`;
}

function clampZoom(value: number) {
  return Math.min(Math.max(value, ZOOM_MIN), ZOOM_MAX);
}

/**
 * What to paint behind an exported canvas. Read from the live page rather than
 * hard-coded, so a dark-theme graph exports dark: a JPEG has no alpha channel, and
 * a transparent background would come out black instead of the surface colour.
 */
/**
 * Why an export failed, in the author's words.
 *
 * html2canvas does not only reject with Errors — "Unable to find element in cloned
 * iframe" is thrown as a bare string — so an Error-only reading of the catch would
 * report "导出失败" and throw away the one line that says what went wrong. That is
 * how this was diagnosed, so it stays in.
 */
function exportFailureText(error: unknown, format: string) {
  if (typeof error === "string" && error.trim()) {
    return `导出失败：${error}`;
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  return `${format.toUpperCase()} 导出失败`;
}

function surfaceBackground() {
  const background = getComputedStyle(document.body).backgroundColor;
  const transparent = !background || background === "transparent" || background === "rgba(0, 0, 0, 0)";

  return transparent ? "#ffffff" : background;
}

/**
 * How far apart the closest two nodes stand, in drawing units. A ring is evenly
 * spaced, so this is the chord between neighbours; a pair is the two of them.
 */
export function minimumNodeSpacing(positions: GraphPoint[]): number {
  if (positions.length < 2) {
    return Number.POSITIVE_INFINITY;
  }

  if (positions.length === 2) {
    return Math.hypot(positions[1].x - positions[0].x, positions[1].y - positions[0].y);
  }

  let closest = Number.POSITIVE_INFINITY;
  for (let index = 0; index < positions.length; index += 1) {
    const current = positions[index];
    const next = positions[(index + 1) % positions.length];
    closest = Math.min(closest, Math.hypot(next.x - current.x, next.y - current.y));
  }

  return closest;
}

/**
 * Pixels per drawing unit: what `preserveAspectRatio="xMidYMid meet"` actually does
 * with a view box on an element of this size. The smaller of the two ratios wins and
 * the drawing is centred on the other axis.
 *
 * Needed because "is this name readable" is a question about the screen, and the same
 * drawing is enlarged in a wide card and shrunk in a narrow one.
 */
export function canvasScreenScale(
  rect: { width: number; height: number },
  viewBox: string,
): number {
  const [, , boxWidth, boxHeight] = viewBox.split(" ").map(Number);

  if (!rect.width || !rect.height || !boxWidth || !boxHeight) {
    return 1;
  }

  return Math.min(rect.width / boxWidth, rect.height / boxHeight);
}

/**
 * Whether a name drawn at this zoom would be readable where it sits.
 *
 * Two conditions, both about the rendered result: the glyphs are at least MIN_LABEL_PX
 * tall, and there is room for them — a name is centred under its node, so two names
 * collide once the nodes are closer together than a couple of name-heights. That is
 * the whole decluttering rule; there is no roster-size threshold any more.
 */
export function labelsReadable(options: {
  positions: GraphPoint[];
  nameSize: number;
  zoom: number;
  scale: number;
}): boolean {
  const rendered = options.nameSize * options.zoom * options.scale;

  if (rendered < MIN_LABEL_PX) {
    return false;
  }

  const spacing = minimumNodeSpacing(options.positions) * options.zoom * options.scale;

  return spacing >= rendered * LABEL_GAP_FACTOR + LABEL_GAP_MIN;
}

/**
 * The zoom at which a name becomes legible on a canvas of this scale. Focusing a
 * character zooms to here rather than to a fixed factor, so a hundred-character wheel
 * gets the zoom it needs and a three-character one is not blown up.
 */
export function labelZoomNeeded(nameSize: number, scale: number): number {
  return MIN_LABEL_PX / Math.max(nameSize * scale, 0.0001);
}

/**
 * Where a drawing point lands on the screen, and the scale it lands at.
 *
 * The browser draws the label, the zoom and the pan are the app's, so the app has to
 * do the same arithmetic to know where a node is: pan first, then zoom about the view
 * box's origin, then fit the box into the element.
 */
export function projectToScreen(
  point: GraphPoint,
  view: { k: number; x: number; y: number },
  viewBox: string,
  rect: { left: number; top: number; width: number; height: number },
): { x: number; y: number; scale: number } {
  const [boxX, boxY, boxWidth, boxHeight] = viewBox.split(" ").map(Number);
  const scale = canvasScreenScale(rect, viewBox);
  const offsetX = (rect.width - boxWidth * scale) / 2;
  const offsetY = (rect.height - boxHeight * scale) / 2;

  return {
    x: rect.left + offsetX + (point.x * view.k + view.x - boxX) * scale,
    y: rect.top + offsetY + (point.y * view.k + view.y - boxY) * scale,
    scale,
  };
}

/**
 * The point in the view box under a client coordinate: the inverse of the placement
 * above, minus the view transform.
 *
 * Mapping x and y by their own ratios — which is what this used to do — is only right
 * when the box and the element have the same proportions. When they do not, the fit
 * letterboxes one axis, and the difference is exactly a wheel that zooms about the
 * wrong point and a drag that slides out from under the cursor.
 */
export function viewBoxPointAt(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
  viewBox: string,
): GraphPoint {
  const [boxX, boxY, boxWidth, boxHeight] = viewBox.split(" ").map(Number);
  const scale = canvasScreenScale(rect, viewBox);
  const offsetX = (rect.width - boxWidth * scale) / 2;
  const offsetY = (rect.height - boxHeight * scale) / 2;

  return {
    x: boxX + (clientX - rect.left - offsetX) / scale,
    y: boxY + (clientY - rect.top - offsetY) / scale,
  };
}

/** The pan that puts a drawing point in the middle of the canvas at this zoom. */
export function centreOn(
  point: GraphPoint,
  zoom: number,
  viewBox: string,
): { k: number; x: number; y: number } {
  const [boxX, boxY, boxWidth, boxHeight] = viewBox.split(" ").map(Number);

  return {
    k: zoom,
    x: boxX + boxWidth / 2 - point.x * zoom,
    y: boxY + boxHeight / 2 - point.y * zoom,
  };
}

/**
 * How much of the drawing's own coordinates the nodes and their labels actually take.
 *
 * `canvasBox` grows a view box around this; the fit zoom needs the same extent to
 * work out how large the drawing is inside that roomier box, so both read it here
 * rather than each computing it their own way.
 */
export function contentBounds(
  positions: GraphPoint[],
  metrics: GraphMetrics = DEFAULT_METRICS,
  labelHalfWidth = 0,
): { width: number; height: number } {
  if (positions.length === 0) {
    return { width: 0, height: 0 };
  }

  const xs = positions.map((point) => point.x);
  const ys = positions.map((point) => point.y);
  // Sideways the widest name, not just the widest node, has to fit: the outer
  // nodes of a wheel are exactly where a centred label overhangs the edge.
  const halfWidth = metrics.radius + CANVAS_PADDING + labelHalfWidth;

  return {
    width: Math.max(...xs) - Math.min(...xs) + halfWidth * 2,
    height:
      Math.max(...ys) -
      Math.min(...ys) +
      metrics.radius +
      CANVAS_PADDING +
      metrics.nameDrop +
      metrics.nameSpace,
  };
}

/**
 * The zoom that makes the drawing use the canvas it has, keeping a margin.
 *
 * The view box is deliberately roomier than the drawing — it reserves the widest
 * label's overhang and floors the size so a lone node is not a stamp — and the result
 * was a five-character graph drawn at a third of the canvas with names nobody could
 * read. This is the same fit applied to the nodes instead of to the box: it never
 * zooms out past the box's fit (the names would shrink) and stops short of filling the
 * frame mechanically, which is what would turn a two-character graph into two circles
 * the size of plates.
 */
export function fitZoom(
  content: { width: number; height: number },
  frame: { width: number; height: number },
  screenScale: number,
  options: { margin?: number; max?: number } = {},
): number {
  const margin = options.margin ?? FIT_MARGIN;
  const max = options.max ?? FIT_MAX_ZOOM;

  if (
    content.width <= 0 ||
    content.height <= 0 ||
    frame.width <= 0 ||
    frame.height <= 0 ||
    screenScale <= 0
  ) {
    return 1;
  }

  const allowance = Math.min(
    (frame.width * (1 - margin)) / (content.width * screenScale),
    (frame.height * (1 - margin)) / (content.height * screenScale),
  );
  // Whether the drawing fits at natural size, ignoring the margin.
  const hardFit = Math.min(
    frame.width / (content.width * screenScale),
    frame.height / (content.height * screenScale),
  );

  // Zooming out is for drawings that do not fit: forty nodes at natural size inside a
  // 325px phone canvas were a screen of edges with the ring outside it. A drawing that
  // does fit keeps its size — scaling it down only made names fall under the readable
  // threshold, which is how a five-node graph lost its labels.
  if (hardFit >= 1) {
    return clampZoom(Math.max(1, Math.min(allowance, max)));
  }

  return clampZoom(Math.min(allowance, max));
}

/**
 * Fits the canvas to what is actually drawn, so a small graph stops reserving a
 * mostly empty 640-square. The floor keeps a lone node from rendering as a stamp,
 * and the caller pins rendered width to the returned width, which holds the
 * drawing at scale 1 — nodes and labels keep the size the wheel always had.
 */
export function canvasBox(
  positions: GraphPoint[],
  metrics: GraphMetrics = DEFAULT_METRICS,
  labelHalfWidth = 0,
) {
  if (positions.length === 0) {
    return { viewBox: `0 0 ${VIEW} ${VIEW}`, width: VIEW };
  }

  const xs = positions.map((point) => point.x);
  const ys = positions.map((point) => point.y);
  const halfWidth = metrics.radius + CANVAS_PADDING + labelHalfWidth;
  const { width: drawnWidth, height: drawnHeight } = contentBounds(
    positions,
    metrics,
    labelHalfWidth,
  );
  const width = Math.max(drawnWidth, MIN_CANVAS_WIDTH);
  const height = Math.max(drawnHeight, MIN_CANVAS_HEIGHT);
  // Grow the box around the drawing's centre so the content stays where it was.
  const left = Math.min(...xs) - halfWidth - (width - drawnWidth) / 2;
  const top =
    Math.min(...ys) -
    metrics.radius -
    CANVAS_PADDING -
    (height - drawnHeight) / 2;

  return {
    viewBox: `${round(left)} ${round(top)} ${round(width)} ${round(height)}`,
    width: round(width),
  };
}

export type GraphEdgeLike = { id: string; fromId: string; toId: string };

/**
 * How far each edge is bent away from the straight line between its nodes.
 *
 * Two edges of the same pair used to be drawn as one stroke: 师承 A→B and 师承 B→A
 * landed exactly on top of each other, so the second one was invisible and its
 * label overlapped the first. Edges sharing a pair are now fanned out, and the
 * sign is taken relative to the pair's own order — otherwise the two directions
 * would compute opposite normals and bulge onto the same side again.
 */
export function edgeBends(edges: GraphEdgeLike[]): Map<string, number> {
  const groups = new Map<string, GraphEdgeLike[]>();
  for (const edge of edges) {
    const key = unorderedPairKey(edge.fromId, edge.toId);
    const group = groups.get(key);
    if (group) {
      group.push(edge);
    } else {
      groups.set(key, [edge]);
    }
  }

  const bends = new Map<string, number>();
  for (const group of groups.values()) {
    if (group.length === 1) {
      bends.set(group[0].id, 0);
      continue;
    }

    const step = group.length === 2 ? 2 : 1.4;
    group.forEach((edge, index) => {
      const offset = index - (group.length - 1) / 2;
      // Reversed to the pair's own order: an edge stored as B→A is the mirror of one
      // stored as A→B, so its bend has to be mirrored too.
      const mirrored = edge.fromId <= edge.toId ? 1 : -1;
      const bend = Math.max(-2, Math.min(2, offset * step * mirrored));
      // Normalised so the middle edge of a group is 0 rather than -0.
      bends.set(edge.id, bend === 0 ? 0 : bend);
    });
  }

  return bends;
}

export type EdgeGeometry = {
  /** Path from the source node's rim to the target node's rim. */
  path: string;
  /** Where the kind label goes: off the curve, not on it. */
  labelX: number;
  labelY: number;
  /** Three points of the arrow head, or null for a relationship with no direction. */
  arrow: string | null;
};

/**
 * One edge, as a path plus the two things the old straight `<line>` could not
 * express: a bulge, and a label anchor clear of the stroke.
 *
 * The arrow head is geometry rather than a marker — a marker is scaled by the
 * stroke width and placed from its own origin, which put it inside the
 * destination node — so for a curve it has to be aimed along the curve's tangent.
 */
export function edgeGeometry(
  from: GraphPoint,
  to: GraphPoint,
  options: { bend?: number; metrics?: GraphMetrics; symmetrical?: boolean } = {},
): EdgeGeometry {
  const metrics = options.metrics ?? DEFAULT_METRICS;
  const bend = options.bend ?? 0;
  const length = Math.hypot(to.x - from.x, to.y - from.y) || 1;
  const ux = (to.x - from.x) / length;
  const uy = (to.y - from.y) / length;
  // Left normal of this edge's own direction.
  const nx = -uy;
  const ny = ux;

  const startX = from.x + ux * (metrics.radius + 2);
  const startY = from.y + uy * (metrics.radius + 2);
  const endX = to.x - ux * (metrics.radius + 3);
  const endY = to.y - uy * (metrics.radius + 3);
  const bendAmount = bend * BEND_UNIT;
  const controlX = (startX + endX) / 2 + nx * bendAmount;
  const controlY = (startY + endY) / 2 + ny * bendAmount;

  const path =
    bend === 0
      ? `M ${round(startX)} ${round(startY)} L ${round(endX)} ${round(endY)}`
      : `M ${round(startX)} ${round(startY)} Q ${round(controlX)} ${round(controlY)} ${round(endX)} ${round(endY)}`;

  // Middle of the curve. For a quadratic that is (P0 + 2C + P2) / 4, and its tangent
  // there is parallel to the chord — so the normal below is the normal of the curve.
  const middleX =
    bend === 0 ? (startX + endX) / 2 : (startX + 2 * controlX + endX) / 4;
  const middleY =
    bend === 0 ? (startY + endY) / 2 : (startY + 2 * controlY + endY) / 4;
  const side = bend === 0 ? 1 : Math.sign(bend);

  let arrow: string | null = null;
  if (!options.symmetrical) {
    // Direction of travel at the target end: the curve's tangent at t = 1.
    const tangentX = bend === 0 ? ux : endX - controlX;
    const tangentY = bend === 0 ? uy : endY - controlY;
    const tangentLength = Math.hypot(tangentX, tangentY) || 1;
    const tx = tangentX / tangentLength;
    const ty = tangentY / tangentLength;
    const backX = endX - tx * 10;
    const backY = endY - ty * 10;
    const wingX = -ty * 4.5;
    const wingY = tx * 4.5;
    arrow = `${round(endX)},${round(endY)} ${round(backX + wingX)},${round(backY + wingY)} ${round(backX - wingX)},${round(backY - wingY)}`;
  }

  return {
    path,
    labelX: round(middleX + nx * side * LABEL_OFFSET),
    labelY: round(middleY + ny * side * LABEL_OFFSET),
    arrow,
  };
}

/**
 * The picture of every avatar the graph has to draw, keyed by character.
 *
 * Only characters that have an uploaded picture ask for one; an emoji node costs
 * nothing here. A picture that cannot be read is simply absent from the map, and the
 * node falls back to its emoji — the same picture the node drew before this existed.
 */
function useGraphAvatarUrls(characters: Character[]) {
  const key = useMemo(
    () => characters.map((character) => `${character.id}:${character.avatarAssetId ?? ""}`).join("|"),
    [characters],
  );
  const [urls, setUrls] = useState<Record<string, string>>({});

  useEffect(() => {
    const wanted = key
      .split("|")
      .filter(Boolean)
      .map((entry) => entry.split(":"))
      .filter(([, assetId]) => assetId);

    if (wanted.length === 0) {
      setUrls({});
      return;
    }

    let cancelled = false;

    void (async () => {
      const loaded = await Promise.all(
        wanted.map(async ([id, assetId]) => {
          try {
            return [id, await getAvatarAssetDataUrl(assetId)] as const;
          } catch {
            return [id, ""] as const;
          }
        }),
      );

      if (cancelled) {
        return;
      }

      const next: Record<string, string> = {};
      for (const [id, url] of loaded) {
        if (url) {
          next[id] = url;
        }
      }
      setUrls(next);
    })();

    return () => {
      cancelled = true;
    };
  }, [key]);

  return urls;
}

export function RelationshipGraph({
  characters,
  onBack,
  onOpenCharacter,
  focusCharacterId = null,
  onFocusHandled,
}: RelationshipGraphProps) {
  const [relationships, setRelationships] = useState<Relationship[]>([]);
  const [draft, setDraft] = useState<{ fromId: string; toId: string; kind: RelationshipKind; note: string } | null>(null);
  // Editing reuses the create dialog: the same four fields, with an id to write over.
  const [editingId, setEditingId] = useState<string | null>(null);
  // Two jobs on one screen. The drawing answers "who is this person connected to"; the
  // list answers "where is that one edge". A hundred and ninety edges cannot be both.
  const [boardMode, setBoardMode] = useState<"graph" | "manage">(() => {
    try {
      const stored = localStorage.getItem("character-studio.relationship-view");
      if (stored === "manage" || stored === "graph") {
        return stored;
      }
    } catch {
      // No stored choice: fall through to the width-based default.
    }

    // No saved choice: the drawing is what this workspace is for, on a phone as well.
    // Management is one tap away and, once chosen, is remembered like any preference.
    return "graph";
  });
  const [manageQuery, setManageQuery] = useState("");
  const [manageKind, setManageKind] = useState<"all" | RelationshipKind>("all");
  const [manageCharacter, setManageCharacter] = useState("all");
  const [manageSort, setManageSort] = useState<"person" | "kind" | "recent">("person");
  const [managePage, setManagePage] = useState(1);
  const [pendingDelete, setPendingDelete] = useState<Relationship | null>(null);
  const [prefs, setPrefs] = useState<GraphPrefs>(() => loadGraphPrefs());
  const [exporting, setExporting] = useState(false);
  const { message, show } = useTransientMessage();
  const frameRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const prefsLoadedRef = useRef(false);
  // The character the search is pointing at, and the pan requested by the last
  // selection. They are separate because focusing a character who is not on the canvas
  // yet has to wait for the layout to include them.
  const [focusId, setFocusId] = useState<string | null>(null);
  const [pendingFocusId, setPendingFocusId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [notOnCanvas, setNotOnCanvas] = useState<Character | null>(null);
  const [isDisplayOpen, setIsDisplayOpen] = useState(false);
  // Output is set once and used rarely, so it lives behind its own toggle: the bar
  // keeps 显示设置 and 导出 at one height instead of five controls in a row.
  const [isExportOpen, setIsExportOpen] = useState(false);
  // Both bar panels close outside already; Escape closes the one on top, and the
  // last one opened is the one the shared light-layer stack sees first.
  useEscapeDismiss(isDisplayOpen, () => setIsDisplayOpen(false));
  useEscapeDismiss(isExportOpen, () => setIsExportOpen(false));
  const [frameSize, setFrameSize] = useState({ width: 0, height: 0 });
  const holderRef = useRef<HTMLDivElement | null>(null);
  const nodeCardRef = useRef<HTMLDivElement | null>(null);
  const displayWrapRef = useRef<HTMLDivElement | null>(null);
  const exportWrapRef = useRef<HTMLDivElement | null>(null);
  const searchWrapRef = useRef<HTMLDivElement | null>(null);
  const avatarUrls = useGraphAvatarUrls(characters);
  const isNarrowScreen = useMediaQuery("(max-width: 720px)");

  // Written on change rather than inside the setter: a state updater can be called
  // twice for one interaction, and a preference is not worth persisting twice.
  useEffect(() => {
    if (!prefsLoadedRef.current) {
      prefsLoadedRef.current = true;
      return;
    }
    saveGraphPrefs(prefs);
  }, [prefs]);

  const [relationshipsLoaded, setRelationshipsLoaded] = useState(false);

  useEffect(() => {
    // Prune on entry so the graph never draws an edge to a character that was
    // deleted while this screen was closed.
    setRelationships(pruneRelationships(characters.map((character) => character.id)));
    // Only now is "this character is not on the canvas" a statement about the data
    // rather than about a store that has not been read yet.
    setRelationshipsLoaded(true);
  }, [characters]);

  const [showAll, setShowAll] = useState(false);
  // A character the default view left out is still findable: searching for one adds
  // them and their direct connections to the drawing, so focusing works in one step
  // instead of asking the reader to turn on the whole roster first. Cleared whenever
  // the focus is, so the canvas returns to its core view.
  const [focusExtraIds, setFocusExtraIds] = useState<string[]>([]);

  const connectedIds = useMemo(() => {
    const ids = new Set<string>();
    for (const relationship of relationships) {
      ids.add(relationship.fromId);
      ids.add(relationship.toId);
    }
    return ids;
  }, [relationships]);

  // Only characters that are actually in a relationship are drawn by default. A
  // roster of a hundred with one relationship is a ring of ninety-nine dots that
  // say nothing about anyone; the rest of the roster is one click away.
  // A hundred nodes on one ring is a circle of dots with a hairball inside it: the
  // drawing answers nothing at that density. The default view keeps the characters who
  // hold the graph together (two or more edges, most connected first) and says how many
  // it left out; 显示全部角色 draws every one of them. Nothing is hidden without a way
  // to see it.
  const visibleCharacters = useMemo(() => {
    const drawn = (() => {
      if (showAll) {
        return characters;
      }

      const connected = characters.filter((character) => connectedIds.has(character.id));

      const limit = isNarrowScreen ? CORE_VIEW_LIMIT_NARROW : CORE_VIEW_LIMIT;

      if (connected.length <= limit) {
        return connected;
      }

      const degree = new Map<string, number>();
      for (const relationship of relationships) {
        degree.set(relationship.fromId, (degree.get(relationship.fromId) ?? 0) + 1);
        degree.set(relationship.toId, (degree.get(relationship.toId) ?? 0) + 1);
      }

      return [...connected]
        .filter((character) => (degree.get(character.id) ?? 0) >= CORE_VIEW_DEGREE)
        .sort((left, right) => (degree.get(right.id) ?? 0) - (degree.get(left.id) ?? 0))
        .slice(0, limit);
    })();

    if (showAll || focusExtraIds.length === 0) {
      return drawn;
    }

    const present = new Set(drawn.map((character) => character.id));
    const extras = characters.filter(
      (character) => focusExtraIds.includes(character.id) && !present.has(character.id),
    );

    return extras.length ? [...drawn, ...extras] : drawn;
  }, [characters, connectedIds, relationships, showAll, focusExtraIds, isNarrowScreen]);

  // Free placement lives in its own store, keyed by character id: a rename moves
  // nothing, and a deleted character is pruned out rather than ghosted.
  const [layout, setLayout] = useState<CanvasLayout>(() => loadLayout());
  const [livePositions, setLivePositions] = useState<Record<string, LayoutPoint> | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectMode, setSelectMode] = useState(false);
  const [isArrangeOpen, setIsArrangeOpen] = useState(false);
  const [arrangeScope, setArrangeScope] = useState<"visible" | "all">("visible");
  const [preview, setPreview] = useState<{
    mode: ArrangeMode;
    scope: "visible" | "all";
    positions: Record<string, LayoutPoint>;
  } | null>(null);
  const [isGroupsOpen, setIsGroupsOpen] = useState(false);
  const [groupDraft, setGroupDraft] = useState<{ name: string; editingId: string | null } | null>(null);
  // One step of undo for a whole arrange, which is the only operation that moves
  // every node at once. A drag is undone by dragging back; an arrange is not.
  const [arrangeUndo, setArrangeUndo] = useState<{ layout: CanvasLayout; label: string } | null>(null);
  const [pendingDiscard, setPendingDiscard] = useState(false);
  const [expandedNotes, setExpandedNotes] = useState<string[]>([]);
  const [isMobileToolsOpen, setIsMobileToolsOpen] = useState(false);
  const [isAlignOpen, setIsAlignOpen] = useState(false);
  // One edge at a time: an edge has no box to marquee and its properties are a
  // different set from a node's, so it is its own selection.
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  // Exploration state. None of it is data: a spotlight, a lens and a bookmark are
  // ways of looking, so they never touch a character or a relationship.
  const [spotlightId, setSpotlightId] = useState<string | null>(null);
  const [spotlightDepth, setSpotlightDepth] = useState<1 | 2>(1);
  const [lensKinds, setLensKinds] = useState<RelationshipKind[]>([]);
  const [bookmarkDraft, setBookmarkDraft] = useState("");
  const [exportScope, setExportScope] = useState<ExportScope>("all");
  const [isStyleOpen, setIsStyleOpen] = useState(false);
  const [previousView, setPreviousView] = useState<{ k: number; x: number; y: number } | null>(null);
  const undoRef = useRef<CanvasLayout[]>([]);
  const redoRef = useRef<CanvasLayout[]>([]);
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const [, setHistoryVersion] = useState(0);
  const [isDirectionHelpOpen, setIsDirectionHelpOpen] = useState(false);
  // Studio mode is a way of looking at the same canvas, not a second canvas: the
  // layout, the undo history and the view are the ones above, so leaving the studio
  // cannot lose a position or a zoom. Neither drawer is open by default, because the
  // drawing is the reason the studio exists.
  const [isStudio, setIsStudio] = useState(false);
  const [isStudioLeftOpen, setIsStudioLeftOpen] = useState(false);
  const [isStudioRightOpen, setIsStudioRightOpen] = useState(false);
  // Two jobs live in one panel, so only one panel is ever open: 设计 and 探索 are tabs
  // of the same drawer, and 角色 is the other drawer.
  const [studioTab, setStudioTab] = useState<"design" | "explore">("design");
  const studioViewRef = useRef<{ k: number; x: number; y: number } | null>(null);
  const studioFitRef = useRef(false);
  // A drawer is dismissed before anything else: Escape must not leave the studio
  // while a panel the reader opened is still on top of the drawing.
  useEscapeDismiss(isStudioLeftOpen, () => setIsStudioLeftOpen(false));
  useEscapeDismiss(isStudioRightOpen, () => setIsStudioRightOpen(false));
  useEscapeDismiss(isDirectionHelpOpen, () => setIsDirectionHelpOpen(false));
  useEscapeDismiss(isMobileToolsOpen, () => setIsMobileToolsOpen(false));
  // What the dialog opened with, so "has anything been typed" is a fact rather
  // than a guess about which fields count.
  const draftBaselineRef = useRef("");
  useEscapeDismiss(isArrangeOpen, () => setIsArrangeOpen(false));
  useEscapeDismiss(isStyleOpen, () => setIsStyleOpen(false));
  useEscapeDismiss(isGroupsOpen, () => setIsGroupsOpen(false));
  useEscapeDismiss(Boolean(groupDraft), () => setGroupDraft(null));
  useEscapeDismiss(Boolean(preview), () => setPreview(null));
  const style = layout.style ?? DEFAULT_CANVAS_STYLE;
  const metrics = useMemo(() => graphMetrics(prefs), [prefs]);
  // The ring the canvas starts as. It is still what a workspace with no saved layout
  // draws, so an untouched graph looks exactly as it did before free placement.
  const ringPositions = useMemo(
    () => nodePositions(visibleCharacters.length, metrics.radius),
    [visibleCharacters.length, metrics.radius],
  );
  // The widest name the drawing will have to fit, so the outermost labels of a wide
  // wheel are not cut off by the canvas edge.
  // What the names are actually drawn at. The display settings choose a base size;
  // the canvas style scales it. Both the drawing and the "would these fit" test
  // read this one number, so a larger name can never be painted over a neighbour
  // that the test believed was clear.
  const nameSize = Math.round(metrics.nameSize * style.node.nameScale * 100) / 100;
  const labelHalfWidth = useMemo(
    () =>
      widestNameHalfWidth(
        visibleCharacters.map((character) => character.name || "未命名角色"),
        nameSize,
      ),
    [visibleCharacters, nameSize],
  );
  // The view box follows the visible set, not the live coordinates. Recomputing it
  // from a node being dragged would change the mapping under the pointer, which is
  // exactly the "release and it jumps back" this canvas is meant not to do.
  const visibleKey = visibleCharacters.map((character) => character.id).join("|");
  const stableBoxRef = useRef<{ key: string; viewBox: string; width: number } | null>(null);
  const canvas = useMemo(() => {
    if (stableBoxRef.current?.key === visibleKey) {
      return stableBoxRef.current;
    }

    const box = canvasBox(
      visibleCharacters.map((character, index) => layout.positions[character.id] ?? ringPositions[index]),
      metrics,
      labelHalfWidth,
    );
    stableBoxRef.current = { key: visibleKey, ...box };
    return stableBoxRef.current;
  }, [visibleKey, visibleCharacters, layout, ringPositions, metrics, labelHalfWidth]);
  const bends = useMemo(() => edgeBends(relationships), [relationships]);

  // What each drawn node's coordinates are right now: a preview (arrange) wins over
  // a live drag, which wins over what is stored.
  const basePositions = useMemo(
    () =>
      visibleCharacters.map(
        (character, index) => layout.positions[character.id] ?? ringPositions[index],
      ),
    [visibleCharacters, layout, ringPositions],
  );
  const positions = useMemo(
    () =>
      visibleCharacters.map(
        (character, index) =>
          preview?.positions[character.id] ?? livePositions?.[character.id] ?? basePositions[index],
      ),
    [visibleCharacters, preview, livePositions, basePositions],
  );

  // A deleted character must not leave a coordinate or a rectangle behind. Pruning
  // happens before the drawing reads the layout, so nothing is drawn at a stale point.
  useEffect(() => {
    const valid = characters.map((character) => character.id);
    const validEdges = relationships.map((relationship) => relationship.id);
    if (relationshipsLoaded) {
      setSelectedEdgeId((current) => (current && !validEdges.includes(current) ? null : current));
      setSpotlightId((current) => (current && !valid.includes(current) ? null : current));
    }
    setLayout((current) => {
      const pruned = pruneLayout(current, valid, relationshipsLoaded ? validEdges : undefined);
      if (JSON.stringify(pruned) === JSON.stringify(current)) {
        return current;
      }
      saveLayout(pruned);
      return pruned;
    });
    setSelectedIds((current) => current.filter((id) => valid.includes(id)));
  }, [characters, relationships, relationshipsLoaded]);

  // A character drawn for the first time — 显示全部, a search that adds a stranger,
  // a fresh import — needs somewhere to stand. Once the author has arranged the
  // canvas, newcomers go under the drawing rather than through it.
  useEffect(() => {
    if (isEmptyLayout(layout)) {
      return;
    }

    const missing = visibleCharacters
      .map((character) => character.id)
      .filter((id) => !layout.positions[id]);

    if (missing.length === 0) {
      return;
    }

    const next = placeMissingPositions(layout, missing, { spacing: metrics.radius * 2 + 44 });
    setLayout(next);
    saveLayout(next);
  }, [visibleCharacters, layout, metrics.radius]);

  // Group rectangles follow the same live positions as the nodes they enclose, so a
  // dragged group looks like one object instead of a box that catches up on release.
  const groupRects = useMemo(() => {
    const positionsNow = { ...layout.positions, ...(livePositions ?? {}), ...(preview?.positions ?? {}) };
    return layout.groups
      .map((group) => ({ group, rect: groupBounds({ ...layout, positions: positionsNow }, group) }))
      .filter((entry): entry is { group: CanvasGroup; rect: NonNullable<ReturnType<typeof groupBounds>> } =>
        Boolean(entry.rect),
      );
  }, [layout, livePositions, preview]);

  // Zoom and pan live in the drawing's own coordinates, so the wheel stays on the
  // point under the cursor and the fit view is just k = 1 with no offset.
  const [view, setView] = useState({ k: 1, x: 0, y: 0 });
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const panRef = useRef<{
    pointerId: number;
    lastX: number;
    lastY: number;
    moved: boolean;
  } | null>(null);
  // Every active pointer, so one finger pans and two fingers pinch. Touch was left
  // out of the first version to protect page scrolling; on a canvas this large that
  // was the wrong trade — dragging the graph is the interaction people reach for.
  const pointersRef = useRef(new Map<number, { x: number; y: number }>());
  const pinchRef = useRef<{ distance: number } | null>(null);
  // The node a press started on, if any: what a tap opens.
  const pressedNodeRef = useRef<string | null>(null);
  const pressedEdgeRef = useRef<string | null>(null);
  // A press on a node is a drag until it is released without moving; a press on
  // empty canvas is a pan; a press on a group rectangle moves the whole group.
  const nodeDragRef = useRef<{
    id: string;
    pointerId: number;
    startX: number;
    startY: number;
    grab: LayoutPoint;
    last: LayoutPoint;
    moved: boolean;
    base: CanvasLayout;
  } | null>(null);
  const groupDragRef = useRef<{
    groupId: string;
    pointerId: number;
    start: LayoutPoint;
    last: LayoutPoint;
    members: string[];
    base: CanvasLayout;
    moved: boolean;
  } | null>(null);
  // One state write per animation frame while dragging, so a hundred nodes are not
  // re-rendered for every pointer event the trackpad emits.
  const dragFrameRef = useRef<number | null>(null);
  const pendingDragRef = useRef<Record<string, LayoutPoint> | null>(null);
  // A double tap is two taps on the same node within this window. The browser's own
  // `dblclick` is not usable: the pointer capture on the <svg> retargets it.
  const lastTapRef = useRef<{ id: string; at: number } | null>(null);

  // Hover and focus are the same highlight. Focus wins while it is set, so hovering a
  // different node does not quietly drop the character the author searched for.
  const activeId = spotlightId ?? focusId ?? hoveredId;

  /** Everything within `spotlightDepth` hops of the spotlight, or null when off. */
  const spotlightSet = useMemo(() => {
    if (!spotlightId) {
      return null;
    }
    const seen = new Set<string>([spotlightId]);
    let frontier = [spotlightId];
    for (let depth = 0; depth < spotlightDepth && frontier.length > 0; depth += 1) {
      const next: string[] = [];
      for (const relationship of relationships) {
        if (frontier.includes(relationship.fromId) && !seen.has(relationship.toId)) {
          seen.add(relationship.toId);
          next.push(relationship.toId);
        }
        if (frontier.includes(relationship.toId) && !seen.has(relationship.fromId)) {
          seen.add(relationship.fromId);
          next.push(relationship.fromId);
        }
      }
      frontier = next;
    }
    return seen;
  }, [spotlightId, spotlightDepth, relationships]);

  const neighbours = useMemo(() => {
    if (spotlightSet) {
      return spotlightSet;
    }
    const ids = new Set<string>();
    if (!activeId) {
      return ids;
    }
    for (const relationship of relationships) {
      if (relationship.fromId === activeId) ids.add(relationship.toId);
      if (relationship.toId === activeId) ids.add(relationship.fromId);
    }
    return ids;
  }, [activeId, relationships, spotlightSet]);

  const lensActive = lensKinds.length > 0;
  const presentKinds = useMemo(
    () => [...new Set(relationships.map((relationship) => relationship.kind))],
    [relationships],
  );

  // Unmeasured is not the same as scale 1: while the frame's size is unknown a label's
  // rendered size is unknown too, and guessing generously is how a hundred-character
  // wheel ends up with a smear of 3px names.
  const measured = frameSize.width > 0 && frameSize.height > 0;
  const screenScale = measured ? canvasScreenScale(frameSize, canvas.viewBox) : 0;
  const labelsFit = labelsReadable({
    positions,
    nameSize,
    zoom: view.k,
    scale: screenScale,
  });

  // An export is the fitted graph with every name on it, not whatever corner the
  // canvas happens to be zoomed into. The author's own switch still wins: names turned
  // off are off in the picture too.
  // On a phone the drawn area is small enough that "every name fits" is the wrong
  // test: a handful of nodes at reading scale have room for their names even when a
  // hundred would not. Above that, the density rules below still apply.
  const compactViewport = frameSize.width > 0 && frameSize.width <= 720;
  const showLabels =
    prefs.showNames &&
    (exporting || labelsFit || (compactViewport && visibleCharacters.length <= 12));

  // When not every name fits, a few still do: the nodes the most edges meet at are the
  // ones that make the shape legible ("the two clusters meet at 沈砚"), and the rest
  // appear on hover or focus.
  const hubIds = useMemo(() => {
    if (visibleCharacters.length <= 24) {
      return new Set<string>();
    }

    const drawn = new Set(visibleCharacters.map((character) => character.id));
    const degree = new Map<string, number>();
    for (const relationship of relationships) {
      if (drawn.has(relationship.fromId) && drawn.has(relationship.toId)) {
        degree.set(relationship.fromId, (degree.get(relationship.fromId) ?? 0) + 1);
        degree.set(relationship.toId, (degree.get(relationship.toId) ?? 0) + 1);
      }
    }

    return new Set(
      [...degree.entries()]
        .sort((left, right) => right[1] - left[1])
        .slice(0, 10)
        .map(([id]) => id),
    );
  }, [visibleCharacters, relationships]);

  // The canvas only exists once there is something to draw, so this has to re-run when
  // it appears; measuring nothing on mount and never measuring again would leave the
  // rendered-size rule permanently unmeasured.
  const hasCanvas = characters.length >= 2 && relationships.length > 0;

  useEffect(() => {
    const frame = frameRef.current;

    if (!frame || !hasCanvas) {
      return;
    }

    const measure = () => {
      const rect = frame.getBoundingClientRect();
      setFrameSize({ width: rect.width, height: rect.height });
    };

    measure();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }

    const observer = new ResizeObserver(measure);
    observer.observe(frame);
    return () => observer.disconnect();
  }, [hasCanvas]);

  // The studio is a bigger canvas, so the drawing is fitted once for the room it
  // now has — and the view that was there is put back on the way out. Either way
  // this is a view change only: no coordinate is written.
  useEffect(() => {
    if (isStudio) {
      if (studioFitRef.current || screenScale <= 0 || positions.length === 0) {
        return;
      }
      studioFitRef.current = true;
      resetView();
      return;
    }

    if (studioViewRef.current) {
      const saved = studioViewRef.current;
      studioViewRef.current = null;
      setView(saved);
    }
  }, [isStudio, screenScale, positions]);

  // The canvas fits the nodes it has, not the box that was reserved for them. Once per
  // mount, for the same reason the phone's fit below is once: the author's own zoom and
  // pan are never taken back.
  const contentFitAppliedRef = useRef(false);

  useEffect(() => {
    if (contentFitAppliedRef.current || screenScale <= 0 || positions.length === 0) {
      return;
    }

    contentFitAppliedRef.current = true;
    applyFitView();
  }, [screenScale, positions, metrics, labelHalfWidth, frameSize, canvas.viewBox]);

  // A phone used to open zoomed in far enough to read the names, which on a large
  // roster meant 298% of the middle of the wheel: edges crossing an empty screen. The
  // opening view is the fit — the whole drawing — and 适应画布 gives it back at any time.

  function zoomBy(factor: number) {
    setView((current) => ({ ...current, k: clampZoom(current.k * factor) }));
  }

  /**
   * 适配画布 in both senses: the box the drawing was given, and the zoom that makes the
   * drawing use it. The box's centre is the drawing's centre — `canvasBox` grows the box
   * around it — so centring on the box keeps the graph where it was.
   */
  function applyFitView() {
    setPreviousView(view);
    const [boxX, boxY, boxWidth, boxHeight] = canvas.viewBox.split(" ").map(Number);
    const zoom = fitZoom(contentBounds(positions, metrics, labelHalfWidth), frameSize, screenScale);

    setView(centreOn({ x: boxX + boxWidth / 2, y: boxY + boxHeight / 2 }, zoom, canvas.viewBox));
  }

  /** What the 适配画布 control and the export both mean by "fit". */
  function resetView() {
    applyFitView();
  }

  /** Frame just the selected nodes, with the same margin the full fit uses. */
  function fitSelection() {
    const chosen = visibleCharacters
      .filter((character) => selectedIds.includes(character.id))
      .map((character) => layout.positions[character.id] ?? ringPositions[visibleCharacters.indexOf(character)]);
    if (!chosen.length) {
      return;
    }
    const [boxX, boxY, boxWidth, boxHeight] = canvas.viewBox.split(" ").map(Number);
    const center = centroid(chosen, { x: boxX + boxWidth / 2, y: boxY + boxHeight / 2 });
    const zoom = fitZoom(
      contentBounds(chosen, metrics, labelHalfWidth),
      frameSize,
      screenScale,
    );
    setPreviousView(view);
    setView(centreOn(center, zoom, canvas.viewBox));
  }

  // Entering the studio makes the canvas much larger, so the drawing is re-fitted
  // once for the room it now has. The view that was there is put back on the way
  // out: changing the chrome must not change where the author was looking.
  function enterStudio() {
    studioViewRef.current = view;
    studioFitRef.current = false;
    setIsStudio(true);
    setIsMobileToolsOpen(false);
  }

  function exitStudio() {
    setIsStudio(false);
    setIsStudioLeftOpen(false);
    setIsStudioRightOpen(false);
  }

  function restoreView() {
    if (!previousView) {
      return;
    }
    const restored = previousView;
    setPreviousView(view);
    setView(restored);
  }

  function alignSelection(axis: "x" | "y", mode: "start" | "center" | "end") {
    const ids = selectedIds.filter((id) => layoutRef.current.positions[id]);
    if (ids.length < 2) {
      return;
    }
    const base = workingLayout();
    const values = ids.map((id) => base.positions[id][axis]);
    const target =
      mode === "start" ? Math.min(...values) : mode === "end" ? Math.max(...values) : values.reduce((sum, value) => sum + value, 0) / values.length;
    const positions = { ...base.positions };
    ids.forEach((id) => {
      positions[id] = { ...positions[id], [axis]: Math.round(target) };
    });
    commitLayout({ ...base, positions });
  }

  function distributeSelection(axis: "x" | "y") {
    const ids = selectedIds.filter((id) => layoutRef.current.positions[id]);
    if (ids.length < 3) {
      return;
    }
    const base = workingLayout();
    const ordered = [...ids].sort((a, b) => base.positions[a][axis] - base.positions[b][axis]);
    const first = base.positions[ordered[0]][axis];
    const last = base.positions[ordered[ordered.length - 1]][axis];
    const step = (last - first) / (ordered.length - 1);
    const positions = { ...base.positions };
    ordered.forEach((id, index) => {
      positions[id] = { ...positions[id], [axis]: Math.round(first + step * index) };
    });
    commitLayout({ ...base, positions });
  }

  /** The only path that writes coordinates. One gesture, one write. */
  function commitLayout(next: CanvasLayout) {
    if (JSON.stringify(next) !== JSON.stringify(layoutRef.current)) {
      undoRef.current = [...undoRef.current.slice(-39), layoutRef.current];
      redoRef.current = [];
    }
    setLayout(next);
    saveLayout(next);
    setHistoryVersion((version) => version + 1);
  }

  /** Style edits are layout edits: same store, same undo history, same backup. */
  function patchStyle(next: CanvasStyle) {
    commitLayout({ ...workingLayout(), style: next });
  }

  function applyPreset(id: CanvasPresetId) {
    patchStyle(styleForPreset(id));
  }

  // Bookmarks are view state kept beside the layout. They are written directly
  // rather than through the undo stack: undoing a camera position would be a
  // strange thing to offer, and it would bury the last real edit.
  function writeBookmarks(next: CanvasBookmark[]) {
    const updated = { ...layoutRef.current, bookmarks: next.slice(0, 30) };
    setLayout(updated);
    saveLayout(updated);
  }

  function saveBookmark(name: string) {
    const trimmed = name.trim().slice(0, 40);
    if (!trimmed) {
      return;
    }
    writeBookmarks([
      ...(layoutRef.current.bookmarks ?? []),
      { id: `bm-${Date.now().toString(36)}`, name: trimmed, view },
    ]);
    setBookmarkDraft("");
  }

  function undoLayout() {
    const previous = undoRef.current.pop();
    if (!previous) {
      return;
    }
    redoRef.current = [...redoRef.current, layoutRef.current];
    setLayout(previous);
    saveLayout(previous);
    setHistoryVersion((version) => version + 1);
  }

  function redoLayout() {
    const next = redoRef.current.pop();
    if (!next) {
      return;
    }
    undoRef.current = [...undoRef.current, layoutRef.current];
    setLayout(next);
    saveLayout(next);
    setHistoryVersion((version) => version + 1);
  }

  /** Undo/redo on the drawing's own state, never on the character records. */
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true']")) {
        return;
      }
      if (!(event.metaKey || event.ctrlKey)) {
        return;
      }
      const key = event.key.toLowerCase();
      if (key === "z") {
        event.preventDefault();
        if (event.shiftKey) {
          redoLayout();
        } else {
          undoLayout();
        }
      } else if (key === "y") {
        event.preventDefault();
        redoLayout();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [layout]);

  /**
   * The stored layout with every visible node's current ring slot materialised.
   *
   * Editing a workspace that has never been arranged must not make the other
   * ninety-nine circles jump: their drawn positions become their stored ones at
   * the same moment the first drag commits.
   */
  function workingLayout(): CanvasLayout {
    return materializeLayout(
      layout,
      visibleCharacters.map((character) => character.id),
      ringPositions,
    );
  }

  /** A client point, in the coordinates the nodes are drawn in (view transform undone). */
  function drawingPoint(clientX: number, clientY: number, svg: SVGSVGElement): LayoutPoint {
    const point = viewBoxPointAt(clientX, clientY, svg.getBoundingClientRect(), canvas.viewBox);
    return { x: (point.x - view.x) / view.k, y: (point.y - view.y) / view.k };
  }

  function scheduleDrag(next: Record<string, LayoutPoint>) {
    pendingDragRef.current = next;

    if (dragFrameRef.current !== null) {
      return;
    }

    dragFrameRef.current = window.requestAnimationFrame(() => {
      dragFrameRef.current = null;
      setLivePositions(pendingDragRef.current);
    });
  }

  function stopDragFrame() {
    if (dragFrameRef.current !== null) {
      window.cancelAnimationFrame(dragFrameRef.current);
      dragFrameRef.current = null;
    }
    pendingDragRef.current = null;
    setLivePositions(null);
  }

  function arrangeLabel(mode: ArrangeMode) {
    return mode === "ring"
      ? "环形布局"
      : mode === "grid"
        ? "网格布局"
        : mode === "hierarchy"
          ? "层级布局"
          : mode === "groups"
            ? "按分组整理"
            : "关系聚类";
  }

  function proposeArrange(mode: ArrangeMode) {
    const ids =
      arrangeScope === "visible"
        ? visibleCharacters.map((character) => character.id)
        : characters.map((character) => character.id);
    const base = workingLayout();
    const points = ids
      .map((id) => base.positions[id])
      .filter((point): point is LayoutPoint => Boolean(point));
    const center = centroid(points, { x: VIEW / 2, y: VIEW / 2 });
    const positions =
      mode === "ring"
        ? ringLayout(ids, center, metrics.radius)
        : mode === "grid"
          ? gridLayout(ids, center, metrics.radius)
          : mode === "hierarchy"
            ? hierarchyLayout(ids, relationships, center, metrics.radius, selectedIds.find((id) => ids.includes(id)))
            : mode === "groups"
              ? groupedLayout(ids, layout.groups, center, metrics.radius)
              : clusterLayout(ids, relationships, center, metrics.radius);

    setPreview({ mode, scope: arrangeScope, positions });
    setIsArrangeOpen(false);
  }

  function applyArrange() {
    if (!preview) {
      return;
    }

    const base = workingLayout();
    setArrangeUndo({ layout: base, label: arrangeLabel(preview.mode) });
    commitLayout(applyPositions(base, preview.positions));
    setPreview(null);
  }

  function undoArrange() {
    if (!arrangeUndo) {
      return;
    }

    commitLayout(arrangeUndo.layout);
    setArrangeUndo(null);
  }

  function toggleSelected(id: string, additive: boolean) {
    setSelectedIds((current) => {
      if (!additive) {
        return current.length === 1 && current[0] === id ? [] : [id];
      }
      return current.includes(id) ? current.filter((item) => item !== id) : [...current, id];
    });
  }

  function saveGroupDraft() {
    if (!groupDraft) {
      return;
    }

    const next = createGroup(
      workingLayout(),
      groupDraft.name,
      selectedIds,
      `group-${Date.now().toString(36)}`,
    );

    if (!next) {
      return;
    }

    commitLayout(next);
    setGroupDraft(null);
    setSelectedIds([]);
    setSelectMode(false);
    setArrangeUndo(null);
  }

  /** Zooms about a point given in client coordinates, so the point stays put. */
  function zoomAround(svg: SVGSVGElement, clientX: number, clientY: number, factor: number) {
    const pointer = viewBoxPointAt(clientX, clientY, svg.getBoundingClientRect(), canvas.viewBox);

    setView((current) => {
      const k = clampZoom(current.k * factor);
      const ratio = k / current.k;

      return {
        k,
        x: pointer.x - (pointer.x - current.x) * ratio,
        y: pointer.y - (pointer.y - current.y) * ratio,
      };
    });
  }

  /**
   * The wheel zooms the canvas and does not also scroll the page.
   *
   * React attaches `onWheel` passively, so `preventDefault()` inside a React handler
   * is ignored — which is why a wheel over the drawing used to zoom it *and* send the
   * page off somewhere. A native listener registered with `passive: false` is the
   * only way to refuse the scroll, and it is re-registered when the view box changes
   * so it always zooms about the current box.
   */
  useEffect(() => {
    const svg = svgRef.current;

    if (!svg) {
      return;
    }

    function onWheel(event: WheelEvent) {
      event.preventDefault();
      zoomAround(svg as SVGSVGElement, event.clientX, event.clientY, event.deltaY < 0 ? 1.15 : 1 / 1.15);
    }

    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, [canvas.viewBox]);

  /**
   * How far a press may travel before it counts as a drag.
   *
   * A finger rolls by a few pixels when it taps, so the touch threshold is larger
   * than the mouse one. Without the gap, every tap on a phone drags the node a
   * little and then also opens nothing.
   */
  const dragThreshold = (pointerType: string) => (pointerType === "touch" ? 8 : 4);

  function beginPan(event: ReactPointerEvent<SVGSVGElement>) {
    if (event.pointerType === "mouse" && event.button !== 0) {
      return;
    }

    // Which node this press started on, read before the capture below is set.
    //
    // Capturing the pointer on the <svg> retargets the compatibility mouse events to
    // the capturing element, so the `click` that follows a tap is delivered to the
    // <svg> and never reaches the node's own handler. The gesture is resolved on
    // release instead, from the node the press began on.
    const target = event.target as Element | null;
    const nodeId = target?.closest?.("[data-character-id]")?.getAttribute("data-character-id") ?? null;
    const groupId = nodeId
      ? null
      : target?.closest?.("[data-group-id]")?.getAttribute("data-group-id") ?? null;
    const edgeId =
      nodeId || groupId
        ? null
        : target?.closest?.("[data-edge-id]")?.getAttribute("data-edge-id") ?? null;
    pressedNodeRef.current = nodeId;
    pressedEdgeRef.current = edgeId;

    event.currentTarget.setPointerCapture(event.pointerId);
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pointersRef.current.size === 2) {
      const [first, second] = [...pointersRef.current.values()];
      pinchRef.current = { distance: Math.hypot(first.x - second.x, first.y - second.y) };
      panRef.current = null;
      nodeDragRef.current = null;
      groupDragRef.current = null;
      return;
    }

    if (pointersRef.current.size > 2) {
      return;
    }

    if (nodeId) {
      const index = visibleCharacters.findIndex((character) => character.id === nodeId);
      const nodePoint = positions[index];

      if (nodePoint) {
        const world = drawingPoint(event.clientX, event.clientY, event.currentTarget);
        nodeDragRef.current = {
          id: nodeId,
          pointerId: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
          grab: { x: nodePoint.x - world.x, y: nodePoint.y - world.y },
          last: world,
          moved: false,
          base: workingLayout(),
        };
        panRef.current = null;
        return;
      }
    }

    if (groupId) {
      const group = layout.groups.find((item) => item.id === groupId);
      groupDragRef.current = {
        groupId,
        pointerId: event.pointerId,
        start: drawingPoint(event.clientX, event.clientY, event.currentTarget),
        last: drawingPoint(event.clientX, event.clientY, event.currentTarget),
        members: group?.characterIds ?? [],
        base: workingLayout(),
        moved: false,
      };
      panRef.current = null;
      return;
    }

    panRef.current = {
      pointerId: event.pointerId,
      lastX: event.clientX,
      lastY: event.clientY,
      moved: false,
    };
  }

  function movePan(event: ReactPointerEvent<SVGSVGElement>) {
    const pointers = pointersRef.current;
    if (!pointers.has(event.pointerId)) {
      return;
    }
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pointers.size >= 2) {
      // A second finger turns the gesture into a pinch: whatever the first finger
      // was dragging must be abandoned, not committed halfway.
      nodeDragRef.current = null;
      groupDragRef.current = null;
      if (livePositions) {
        stopDragFrame();
      }
      const [first, second] = [...pointers.values()];
      const distance = Math.hypot(first.x - second.x, first.y - second.y);
      const previous = pinchRef.current;
      if (previous && previous.distance > 0 && distance > 0) {
        zoomAround(
          event.currentTarget,
          (first.x + second.x) / 2,
          (first.y + second.y) / 2,
          distance / previous.distance,
        );
      }
      pinchRef.current = { distance };
      return;
    }

    const nodeDrag = nodeDragRef.current;
    if (nodeDrag && nodeDrag.pointerId === event.pointerId) {
      const travelled = Math.hypot(event.clientX - nodeDrag.startX, event.clientY - nodeDrag.startY);

      if (!nodeDrag.moved && travelled > dragThreshold(event.pointerType)) {
        nodeDrag.moved = true;
        setFocusId(null);
        setHoveredId(null);
      }

      if (nodeDrag.moved) {
        const world = drawingPoint(event.clientX, event.clientY, event.currentTarget);
        scheduleDrag({
          ...nodeDrag.base.positions,
          [nodeDrag.id]: {
            x: Math.round((world.x + nodeDrag.grab.x) * 100) / 100,
            y: Math.round((world.y + nodeDrag.grab.y) * 100) / 100,
          },
        });
      }
      return;
    }

    const groupDrag = groupDragRef.current;
    if (groupDrag && groupDrag.pointerId === event.pointerId) {
      const world = drawingPoint(event.clientX, event.clientY, event.currentTarget);
      const delta = { x: world.x - groupDrag.start.x, y: world.y - groupDrag.start.y };

      if (!groupDrag.moved && Math.hypot(delta.x, delta.y) > dragThreshold(event.pointerType)) {
        groupDrag.moved = true;
        setHoveredId(null);
      }

      if (groupDrag.moved) {
        const next = { ...groupDrag.base.positions };
        for (const id of groupDrag.members) {
          const point = groupDrag.base.positions[id];
          if (point) {
            next[id] = {
              x: Math.round((point.x + delta.x) * 100) / 100,
              y: Math.round((point.y + delta.y) * 100) / 100,
            };
          }
        }
        scheduleDrag(next);
      }
      return;
    }

    const pan = panRef.current;
    if (!pan || pan.pointerId !== event.pointerId) {
      return;
    }
    // Panned through the same placement the browser uses, so the point under the
    // finger stays under the finger on both axes.
    const scale = canvasScreenScale(event.currentTarget.getBoundingClientRect(), canvas.viewBox);
    const dx = (event.clientX - pan.lastX) / scale;
    const dy = (event.clientY - pan.lastY) / scale;
    pan.lastX = event.clientX;
    pan.lastY = event.clientY;
    if (Math.abs(dx) + Math.abs(dy) > 0.6) {
      pan.moved = true;
    }
    setView((current) => ({ ...current, x: current.x + dx, y: current.y + dy }));
  }

  /** A cancelled gesture is not a small drag: it must leave the stored layout alone. */
  function cancelPan(event: ReactPointerEvent<SVGSVGElement>) {
    if (nodeDragRef.current?.pointerId === event.pointerId) {
      nodeDragRef.current = null;
    }
    if (groupDragRef.current?.pointerId === event.pointerId) {
      groupDragRef.current = null;
    }
    pointersRef.current.delete(event.pointerId);
    pressedNodeRef.current = null;
    setLivePositions(null);
    stopDragFrame();
  }

  function endPan(event: ReactPointerEvent<SVGSVGElement>) {
    const nodeDrag = nodeDragRef.current;
    const groupDrag = groupDragRef.current;
    const pan = panRef.current;
    const tappedId = pressedNodeRef.current;
    const tappedEdgeId = pressedEdgeRef.current;

    const nodeGesture = nodeDrag && nodeDrag.pointerId === event.pointerId ? nodeDrag : null;
    const groupGesture = groupDrag && groupDrag.pointerId === event.pointerId ? groupDrag : null;
    const panned = Boolean(pan && pan.pointerId === event.pointerId && pan.moved);

    if (nodeGesture?.moved) {
      // A fast flick can end before the next animation frame, so the release
      // position is computed here as well. Without this the node snaps back.
      // `pointerup` may report (0,0) on touch after a cancel; the last move is the
      // truthful position. Using the release coordinates blindly is what made a
      // touch drag jump to the world origin.
      const world = nodeGesture.last;
      const final = pendingDragRef.current ?? {
        ...nodeGesture.base.positions,
        [nodeGesture.id]: {
          x: Math.round((world.x + nodeGesture.grab.x) * 100) / 100,
          y: Math.round((world.y + nodeGesture.grab.y) * 100) / 100,
        },
      };
      commitLayout({ ...nodeGesture.base, positions: final });
      setArrangeUndo(null);
      stopDragFrame();
    } else if (groupGesture?.moved) {
      const world = groupGesture.last;
      const delta = { x: world.x - groupGesture.start.x, y: world.y - groupGesture.start.y };
      const fallback = { ...groupGesture.base.positions };
      for (const id of groupGesture.members) {
        const point = groupGesture.base.positions[id];
        if (point) {
          fallback[id] = {
            x: Math.round((point.x + delta.x) * 100) / 100,
            y: Math.round((point.y + delta.y) * 100) / 100,
          };
        }
      }
      commitLayout({ ...groupGesture.base, positions: pendingDragRef.current ?? fallback });
      setArrangeUndo(null);
      stopDragFrame();
    } else if (nodeGesture && tappedId) {
      // A press that never moved is a tap. Two taps on the same node inside the
      // window open the character; one tap selects it, which is what makes
      // multi-select and grouping possible with a mouse or a finger.
      const previous = lastTapRef.current;
      const now = Date.now();
      const doubleTap = previous?.id === tappedId && now - previous.at < 350;

      if (doubleTap) {
        lastTapRef.current = null;
        onOpenCharacter(tappedId);
      } else {
        lastTapRef.current = { id: tappedId, at: now };
        setSelectedEdgeId(null);
        toggleSelected(tappedId, selectMode || event.shiftKey);
      }
    } else if (groupGesture && !groupGesture.moved) {
      setSelectedEdgeId(null);
      setSelectedIds(groupGesture.members);
    } else if (!panned && tappedEdgeId) {
      // Tapping a line selects the relationship it draws. It never edits it:
      // the edge's own dialog is still opened from 管理, and this selection only
      // feeds the appearance controls.
      setSelectedIds([]);
      setSelectedEdgeId(tappedEdgeId);
    } else if (!panned && !tappedId && !groupGesture) {
      setSelectedIds([]);
      setSelectedEdgeId(null);
    }

    pointersRef.current.delete(event.pointerId);
    if (pointersRef.current.size < 2) {
      pinchRef.current = null;
    }
    if (pointersRef.current.size === 0) {
      panRef.current = null;
      pressedNodeRef.current = null;
      nodeDragRef.current = null;
      groupDragRef.current = null;
    }
  }
  const byId = useMemo(
    () =>
      new Map(
        visibleCharacters.map((character, index) => [
          character.id,
          { character, ...positions[index] },
        ]),
      ),
    [visibleCharacters, positions],
  );
  const hoveredEntry = hoveredId ? byId.get(hoveredId) : undefined;

  // How many relationships a character is an end of: the fourth field the hover card
  // shows, counted from the edges rather than stored anywhere.
  const degreeById = useMemo(() => {
    const degrees = new Map<string, number>();
    for (const relationship of relationships) {
      degrees.set(relationship.fromId, (degrees.get(relationship.fromId) ?? 0) + 1);
      degrees.set(relationship.toId, (degrees.get(relationship.toId) ?? 0) + 1);
    }
    return degrees;
  }, [relationships]);

  // Every character, not only the ones on the canvas: searching for somebody who is
  // not drawn has to say so rather than quietly return nothing.
  const searchResults = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle ? characters.filter((character) => matchesCharacterQuery(character, needle)) : [];
  }, [characters, query]);

  /**
   * Asks for a character to be centred. The pan itself waits for the layout to include
   * them: selecting somebody who is not on the canvas first has to draw the whole
   * roster, and that changes every position on the wheel.
   */
  function focusCharacter(character: Character) {
    setQuery("");
    setNotOnCanvas(null);

    if (!byId.has(character.id)) {
      // Two different reasons to be missing, and only one of them needs the reader's
      // help. Somebody with edges was left out by the core-view cap: draw them and their
      // direct connections and carry on. Somebody with no edges has nothing to join —
      // that one is stated, with the way to see them anyway.
      const peers = relationships
        .filter((relationship) => relationship.fromId === character.id || relationship.toId === character.id)
        .map((relationship) => (relationship.fromId === character.id ? relationship.toId : relationship.fromId));

      if (peers.length === 0) {
        setNotOnCanvas(character);
        return;
      }

      setFocusExtraIds([character.id, ...peers]);
    }

    setFocusId(character.id);
    setPendingFocusId(character.id);
  }

  useEffect(() => {
    if (!pendingFocusId) {
      return;
    }

    const entry = byId.get(pendingFocusId);
    if (!entry) {
      return;
    }

    setPendingFocusId(null);

    // Frame the character and its direct connections together, not the character alone:
    // a close-up of one node with its edges leaving the screen answers half the question.
    const peers = relationships
      .filter((edge) => edge.fromId === entry.character.id || edge.toId === entry.character.id)
      .map((edge) => (edge.fromId === entry.character.id ? edge.toId : edge.fromId));
    const focusIds = new Set([entry.character.id, ...peers]);
    const points = [...byId.values()].filter((item) => focusIds.has(item.character.id));
    const zoom = fitZoom(
      contentBounds(points, metrics, labelHalfWidth),
      frameSize,
      screenScale,
      { margin: 0.3, max: FOCUS_MAX_ZOOM },
    );
    const centrePoint = {
      x: points.reduce((sum, item) => sum + item.x, 0) / points.length,
      y: points.reduce((sum, item) => sum + item.y, 0) / points.length,
    };

    setView(centreOn(centrePoint, zoom, canvas.viewBox));
  }, [pendingFocusId, byId, metrics, labelHalfWidth, screenScale, frameSize, canvas.viewBox, relationships]);

  // Leaving a focus puts the overview back. Without this the canvas stayed at the
  // close-up of the character just left, which on a phone is a screen of edges again.
  const hadFocusRef = useRef(false);
  useEffect(() => {
    if (focusId) {
      hadFocusRef.current = true;
      return;
    }

    if (hadFocusRef.current) {
      hadFocusRef.current = false;
      applyFitView();
    }
  }, [focusId]);

  const focusedCharacter = focusId ? characters.find((character) => character.id === focusId) : undefined;

  // A character arriving from another screen is focused exactly as if the reader had
  // searched for them, including the notice when they are not on the canvas.
  useEffect(() => {
    // The edges are read in an effect above, so an arrival has to wait for them: acting
    // on an empty store would report every character as having no relationships.
    if (!focusCharacterId || !relationshipsLoaded) {
      return;
    }

    const character = characters.find((entry) => entry.id === focusCharacterId);
    if (character) {
      focusCharacter(character);
    }
    onFocusHandled?.();
  }, [focusCharacterId, relationshipsLoaded, characters, onFocusHandled]);

  // A focus on somebody the canvas no longer draws is worse than no focus: the chip
  // would name a character that nothing on screen is pointing at, which is what
  // switching back to "only related" while focused on an unrelated one produces.
  useEffect(() => {
    if (focusId && !byId.has(focusId)) {
      setFocusId(null);
    }
  }, [focusId, byId]);

  // Leaving the focus puts the canvas back to its core view: the nodes added for that
  // one search were an answer to that search, not a new default.
  useEffect(() => {
    if (!focusId) {
      setFocusExtraIds((current) => (current.length ? [] : current));
    }
  }, [focusId]);

  // Escape leaves the focus, which is the keyboard way out of a highlight that changes
  // what every other node looks like. Not while a dialog is open: those use Escape to
  // cancel, and closing the focus behind one would be answering a different question.
  useEffect(() => {
    if (!focusId || draft || pendingDelete) {
      return;
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setFocusId(null);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [focusId, draft, pendingDelete]);

  // The bar's panels close on a click anywhere outside them, like every other dropdown
  // in the app.
  useEffect(() => {
    if (!isDisplayOpen && !isExportOpen) {
      return;
    }

    function onPointerDown(event: MouseEvent) {
      if (isDisplayOpen && !displayWrapRef.current?.contains(event.target as Node)) {
        setIsDisplayOpen(false);
      }

      if (isExportOpen && !exportWrapRef.current?.contains(event.target as Node)) {
        setIsExportOpen(false);
      }
    }

    window.addEventListener("mousedown", onPointerDown);
    return () => window.removeEventListener("mousedown", onPointerDown);
  }, [isDisplayOpen, isExportOpen]);

  // Where the hover card sits: under the node it describes, placed from the node's own
  // projected position rather than from the cursor, so it does not jump while the
  // pointer moves across a large circle.
  useLayoutEffect(() => {
    const card = nodeCardRef.current;
    const svg = svgRef.current;
    const holder = holderRef.current;
    const entry = hoveredId ? byId.get(hoveredId) : undefined;

    if (!card || !svg || !holder || !entry) {
      return;
    }

    const svgRect = svg.getBoundingClientRect();
    const holderRect = holder.getBoundingClientRect();
    const projected = projectToScreen(entry, view, canvas.viewBox, svgRect);
    const radius = metrics.radius * view.k * projected.scale;
    const half = HOVER_CARD_HALF + 8;
    const localX = projected.x - holderRect.left;
    // Kept inside the card: the position is a centring, and on a phone a centring on a
    // node near the edge would hang the card off the canvas.
    const left = holderRect.width > half * 2 ? Math.min(Math.max(localX, half), holderRect.width - half) : holderRect.width / 2;

    card.style.left = `${left}px`;
    card.style.top = `${projected.y - holderRect.top + radius + 10}px`;
  }, [hoveredId, byId, view, canvas.viewBox, metrics]);

  function openDraft() {
    const next = {
      fromId: characters[0]?.id ?? "",
      toId: characters[1]?.id ?? characters[0]?.id ?? "",
      kind: "friend" as RelationshipKind,
      note: "",
    };
    draftBaselineRef.current = JSON.stringify(next);
    setEditingId(null);
    setDraft(next);
  }

  function openEdit(relationship: Relationship) {
    const next = {
      fromId: relationship.fromId,
      toId: relationship.toId,
      kind: relationship.kind,
      note: relationship.note ?? "",
    };
    draftBaselineRef.current = JSON.stringify(next);
    setEditingId(relationship.id);
    setDraft(next);
  }

  /** Management hands the canvas one character; the drawing does the rest. */
  function locateOnGraph(relationship: Relationship) {
    chooseBoardMode("graph");
    setQuery("");
    setFocusId(relationship.fromId);
    setPendingFocusId(relationship.fromId);
    window.setTimeout(() => {
      holderRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 60);
  }

  function submitDraft() {
    if (!draft || !draft.fromId || !draft.toId || draft.fromId === draft.toId) {
      return;
    }
    // Refused rather than stored: storage drops the repeat on read anyway, and a save
    // that silently does nothing reads as a broken button.
    // The edge being edited is not a duplicate of itself.
    const others = editingId
      ? relationships.filter((relationship) => relationship.id !== editingId)
      : relationships;
    if (findDuplicateRelationship(others, draft.fromId, draft.toId, draft.kind)) {
      show("这条关系已经存在了");
      return;
    }

    if (editingId) {
      const next = loadRelationships().map((relationship) =>
        relationship.id === editingId
          ? {
              ...relationship,
              fromId: draft.fromId,
              toId: draft.toId,
              kind: draft.kind,
              note: draft.note.trim() || undefined,
              updatedAt: new Date().toISOString(),
            }
          : relationship,
      );
      saveRelationships(next);
    } else {
      const next = [...loadRelationships(), createRelationship(draft.fromId, draft.toId, draft.kind, draft.note)];
      saveRelationships(next);
    }

    setRelationships(loadRelationships());
    setEditingId(null);
    setDraft(null);
  }

  function confirmDelete() {
    if (!pendingDelete) {
      return;
    }
    setRelationships(deleteRelationship(pendingDelete.id));
    setPendingDelete(null);
  }

  function updatePrefs(patch: Partial<GraphPrefs>) {
    setPrefs((current) => ({ ...current, ...patch }));
  }

  /**
   * The picture is the fitted, fully labelled graph whatever the canvas is zoomed
   * to, and the two frames are what makes that true: the first commits the reset
   * view and the forced labels, the second lets the browser lay them out before the
   * capture reads the DOM back.
   */
  /**
   * The drawing at the bounds a scope names, as a standalone SVG document.
   *
   * It clones the live <svg> instead of re-drawing it: node shape, local colours,
   * edge dash, arrow heads, labels and group rectangles are all already in that
   * tree, and a second renderer would drift from the first one the day a style is
   * added. The clone is then re-framed — its view box becomes the scope's rectangle
   * and its pan/zoom is reset to identity — so the picture covers the content, not
   * the window.
   */
  function buildExportSvg(scope: ExportScope): { text: string; bounds: WorldBounds } | null {
    const svg = svgRef.current;
    if (!svg) {
      return null;
    }

    const selectedPoints = visibleCharacters
      .map((character, index) => ({ id: character.id, point: positions[index] }))
      .filter((entry) => selectedIds.includes(entry.id))
      .map((entry) => entry.point);

    const bounds = scopeBounds({
      scope,
      allPoints: positions,
      selectedPoints,
      viewBox: canvas.viewBox,
      padding: metrics.radius + metrics.nameDrop + 24,
    });

    if (!bounds) {
      return null;
    }

    const clone = svg.cloneNode(true) as SVGSVGElement;
    clone.setAttribute("viewBox", `${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}`);
    clone.setAttribute("width", String(Math.round(bounds.width)));
    clone.setAttribute("height", String(Math.round(bounds.height)));
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    clone.removeAttribute("class");
    clone.removeAttribute("aria-hidden");

    // Inlining first, while the clone still mirrors the live tree element for
    // element: pruning and stripping remove nodes, and the walk is positional.
    // Classes first (no elements leave), then computed styles, then the marks that
    // do remove elements: rings, out-of-scope nodes, partial groups.
    stripTransientState(clone);
    inlineSvgPresentation(clone);
    removeTransientMarks(clone);

    if (scope === "selection") {
      pruneToSelection(clone, selectedIds);
    }

    const content = Array.from(clone.children).find((child) => child.tagName === "g");
    content?.setAttribute("transform", "translate(0 0) scale(1)");

    // A transparent PNG has no surface of its own, and an SVG opened in a viewer
    // that defaults to white would lose a dark canvas. The colour is written in.
    const background = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    background.setAttribute("x", String(bounds.x));
    background.setAttribute("y", String(bounds.y));
    background.setAttribute("width", String(bounds.width));
    background.setAttribute("height", String(bounds.height));
    background.setAttribute("fill", style.canvas.background || surfaceBackground());
    clone.insertBefore(background, clone.firstChild);

    return { text: new XMLSerializer().serializeToString(clone), bounds };
  }

  async function runCanvasExport(scope: ExportScope, format: "png" | "svg") {
    if (exporting) {
      return;
    }

    setExporting(true);
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

    try {
      const built = buildExportSvg(scope);
      if (!built) {
        show(scope === "selection" ? "还没有选中任何角色" : "没有可导出的内容");
        return;
      }

      const stamp = new Date().toISOString().slice(0, 10);
      const label =
        scope === "view" ? "当前视图" : scope === "selection" ? "选中区域" : "全部内容";

      if (format === "svg") {
        downloadSvg(built.text, `角色关系网-${label}-${stamp}.svg`);
        show("SVG 已导出");
        return;
      }

      const { blob } = await rasterizeSvg(built.text, built.bounds, prefs.exportScale);
      downloadPng(blob, `角色关系网-${label}-${stamp}.png`);
      show("PNG 已导出");
    } catch (error) {
      show(exportFailureText(error, format));
    } finally {
      setExporting(false);
    }
  }

  async function runExport(format: "jpg" | "png" | "pdf") {
    const frame = frameRef.current;
    if (!frame || exporting) {
      return;
    }

    resetView();
    setExporting(true);
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

    try {
      const options = {
        background: surfaceBackground(),
        label: "关系网画布",
        scale: prefs.exportScale,
      };
      if (format === "pdf") {
        await exportSurfacePdf(frame, "角色关系网", options);
      } else {
        await exportSurfaceImage(frame, "角色关系网", format, 0.92, options);
      }
      show(`${format.toUpperCase()} 已导出`);
    } catch (error) {
      show(exportFailureText(error, format));
    } finally {
      setExporting(false);
    }
  }

  // Persisted on choice, not on mount: remembering the default would hand a phone's
  // management view to the desktop, and the default is not a preference.
  function chooseBoardMode(mode: "graph" | "manage") {
    setBoardMode(mode);

    try {
      localStorage.setItem("character-studio.relationship-view", mode);
    } catch {
      // A view preference is not worth failing an interaction over.
    }
  }

  const characterById = useMemo(() => new Map(characters.map((item) => [item.id, item])), [characters]);
  const nameOf = (id: string) => {
    const character = characterById.get(id);
    return character ? characterDisplayName(character) : "";
  };

  const manageRows = useMemo(() => {
    const query = manageQuery.trim().toLowerCase();
    const rows = relationships.filter((relationship) => {
      if (manageKind !== "all" && relationship.kind !== manageKind) {
        return false;
      }
      if (
        manageCharacter !== "all" &&
        relationship.fromId !== manageCharacter &&
        relationship.toId !== manageCharacter
      ) {
        return false;
      }
      if (!query) {
        return true;
      }
      const haystack = [
        characterById.get(relationship.fromId)?.name ?? "",
        characterById.get(relationship.toId)?.name ?? "",
        relationship.note ?? "",
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });

    return [...rows].sort((left, right) => {
      if (manageSort === "kind") {
        return relationshipKindLabel(left.kind).localeCompare(relationshipKindLabel(right.kind), "zh");
      }
      if (manageSort === "recent") {
        return (right.updatedAt ?? "").localeCompare(left.updatedAt ?? "");
      }
      const leftName = characterById.get(left.fromId)?.name ?? "";
      const rightName = characterById.get(right.fromId)?.name ?? "";
      return leftName.localeCompare(rightName, "zh");
    });
  }, [relationships, manageQuery, manageKind, manageCharacter, manageSort, characterById]);

  const managePageCount = Math.max(1, Math.ceil(manageRows.length / MANAGE_PAGE_SIZE));
  const currentPage = Math.min(managePage, managePageCount);
  const pageRows = manageRows.slice((currentPage - 1) * MANAGE_PAGE_SIZE, currentPage * MANAGE_PAGE_SIZE);

  // A filter that shortens the list must not leave the reader on page 9 of 2.
  useEffect(() => {
    if (managePage > managePageCount) {
      setManagePage(managePageCount);
    }
  }, [managePage, managePageCount]);

  const canLink = characters.length >= 2;
  const draftSymmetric = draft ? isSymmetricKind(draft.kind) : false;
  const draftDuplicate = draft
    ? findDuplicateRelationship(
        editingId ? relationships.filter((relationship) => relationship.id !== editingId) : relationships,
        draft.fromId,
        draft.toId,
        draft.kind,
      )
    : undefined;
  const draftDuplicateReversed =
    draft && draftDuplicate ? draftDuplicate.fromId === draft.toId : false;
  const draftDirty = Boolean(draft) && JSON.stringify(draft) !== draftBaselineRef.current;

  function closeDraftNow() {
    setDraft(null);
    setEditingId(null);
    setPendingDiscard(false);
  }

  /** Every way out of the relationship dialog passes through here. */
  function requestCloseDraft() {
    if (draftDirty) {
      setPendingDiscard(true);
      return;
    }
    closeDraftNow();
  }

  // Both dialogs take the keyboard: Escape cancels, Enter saves, focus moves in.
  const draftDialogRef = useDialogKeyboard({
    active: Boolean(draft) && !pendingDiscard,
    onClose: requestCloseDraft,
    onConfirm: submitDraft,
    confirmDisabled: Boolean(draft) && (draft!.fromId === draft!.toId || Boolean(draftDuplicate)),
  });
  const discardDialogRef = useDialogKeyboard({
    active: pendingDiscard,
    onClose: () => setPendingDiscard(false),
    onConfirm: closeDraftNow,
  });
  const deleteDialogRef = useDialogKeyboard({
    active: Boolean(pendingDelete),
    onClose: () => setPendingDelete(null),
    onConfirm: confirmDelete,
  });

  // The same panel in both places: an absolute popover beside the accepted toolbar,
  // and a section of the studio's right drawer. One definition, so a control cannot
  // mean two different things depending on where it is opened.
  const stylePanel = (
            <div className="graph-style-panel" role="group" aria-label="画布外观">
              {/* Above the presets, because it applies to one object: what the whole
                  canvas looks like is the wrong question while a single line is
                  selected. */}
              {selectedEdgeId && (
                <div className="graph-style-local" role="group" aria-label="所选关系线外观">
                  <strong>所选关系线</strong>
                  {(() => {
                    const edge = relationships.find((item) => item.id === selectedEdgeId);
                    if (!edge) {
                      return <p className="muted">这条关系已不存在。</p>;
                    }
                    const local = layout.edgeStyles?.[edge.id] ?? {};
                    const patch = (next: Partial<NonNullable<typeof local>>) =>
                      commitLayout({
                        ...layout,
                        edgeStyles: {
                          ...(layout.edgeStyles ?? {}),
                          [edge.id]: { ...local, ...next },
                        },
                      });
                    return (
                      <>
                        <span className="muted">
                          {characterDisplayName(byId.get(edge.fromId)?.character ?? ({ name: "?" } as Character))} →{" "}
                          {characterDisplayName(byId.get(edge.toId)?.character ?? ({ name: "?" } as Character))} ·{" "}
                          {relationshipKindLabel(edge.kind)}
                        </span>
                        <div className="graph-style-grid">
                          <label>线条颜色
                            <input
                              aria-label="线条颜色"
                              onChange={(event) => patch({ color: event.target.value })}
                              type="color"
                              value={local.color || style.edge.color || "#7b87a8"}
                            />
                          </label>
                          <label>线条粗细
                            <input
                              aria-label="线条粗细"
                              max={6}
                              min={0.4}
                              onChange={(event) => patch({ width: Number(event.target.value) })}
                              step={0.1}
                              type="range"
                              value={local.width ?? style.edge.width}
                            />
                          </label>
                          <label>线型
                            <select
                              aria-label="线型"
                              onChange={(event) => patch({ dash: event.target.value as CanvasStyle["edge"]["dash"] })}
                              value={local.dash ?? style.edge.dash}
                            >
                              <option value="solid">实线</option>
                              <option value="dashed">虚线</option>
                              <option value="dotted">点线</option>
                            </select>
                          </label>
                        </div>
                        <button
                          className="ghost-button"
                          disabled={!layout.edgeStyles?.[edge.id]}
                          onClick={() => {
                            const next = { ...(layout.edgeStyles ?? {}) };
                            delete next[edge.id];
                            commitLayout({ ...layout, edgeStyles: next });
                          }}
                          type="button"
                        >
                          恢复这条线的默认外观
                        </button>
                      </>
                    );
                  })()}
                </div>
              )}
              {!selectedEdgeId && selectedIds.length === 1 && byId.get(selectedIds[0]) && (
                <div className="graph-style-local" role="group" aria-label="所选节点外观">
                  <strong>所选节点</strong>
                  {(() => {
                    const nodeId = selectedIds[0];
                    const local = layout.nodeStyles?.[nodeId] ?? {};
                    const patch = (next: Partial<NonNullable<typeof local>>) =>
                      commitLayout({
                        ...layout,
                        nodeStyles: {
                          ...(layout.nodeStyles ?? {}),
                          [nodeId]: { ...local, ...next },
                        },
                      });
                    return (
                      <>
                        <span className="muted">{characterDisplayName(byId.get(nodeId)!.character)}</span>
                        <div className="graph-style-grid">
                          <label>边框颜色
                            <input
                              aria-label="边框颜色"
                              onChange={(event) => patch({ borderColor: event.target.value })}
                              type="color"
                              value={local.borderColor || "#b8bfd0"}
                            />
                          </label>
                          <label>节点底色
                            <input
                              aria-label="节点底色"
                              onChange={(event) => patch({ background: event.target.value })}
                              type="color"
                              value={local.background || "#f4f5f8"}
                            />
                          </label>
                        </div>
                        <button
                          className="ghost-button"
                          disabled={!layout.nodeStyles?.[nodeId]}
                          onClick={() => {
                            const next = { ...(layout.nodeStyles ?? {}) };
                            delete next[nodeId];
                            commitLayout({ ...layout, nodeStyles: next });
                          }}
                          type="button"
                        >
                          恢复这个节点的默认外观
                        </button>
                      </>
                    );
                  })()}
                </div>
              )}
              <div className="graph-style-presets graph-preset-cards">
                {CANVAS_PRESETS.map((preset) => (
                  <button
                    aria-pressed={style.preset === preset.id}
                    className={style.preset === preset.id ? "graph-preset active" : "graph-preset"}
                    key={preset.id}
                    onClick={() => applyPreset(preset.id)}
                    title={preset.hint}
                    type="button"
                  >
                    <PresetThumb presetId={preset.id} />
                    <span>{preset.name}</span>
                  </button>
                ))}
              </div>
              <div className="graph-style-grid">
                <label>节点大小
                  <input max={2} min={0.6} onChange={(event) => patchStyle({ ...style, preset: "custom", node: { ...style.node, size: Number(event.target.value) } })} step={0.05} type="range" value={style.node.size} />
                </label>
                <label>姓名字号
                  <input
                    aria-label="姓名字号"
                    max={1.8}
                    min={0.8}
                    onChange={(event) => patchStyle({ ...style, preset: "custom", node: { ...style.node, nameScale: Number(event.target.value) } })}
                    step={0.05}
                    type="range"
                    value={style.node.nameScale}
                  />
                  <span className="graph-style-value">{Math.round(nameSize)}px</span>
                </label>
                <label className="graph-style-check">
                  <input checked={style.node.showAvatars} onChange={(event) => patchStyle({ ...style, preset: "custom", node: { ...style.node, showAvatars: event.target.checked } })} type="checkbox" />
                  显示头像
                </label>
                <label>连线宽度
                  <input max={6} min={0.4} onChange={(event) => patchStyle({ ...style, preset: "custom", edge: { ...style.edge, width: Number(event.target.value) } })} step={0.1} type="range" value={style.edge.width} />
                </label>
                <label>线型
                  <select onChange={(event) => patchStyle({ ...style, preset: "custom", edge: { ...style.edge, dash: event.target.value as CanvasStyle["edge"]["dash"] } })} value={style.edge.dash}>
                    <option value="solid">实线</option>
                    <option value="dashed">虚线</option>
                    <option value="dotted">点线</option>
                  </select>
                </label>
                <label>走向
                  <select onChange={(event) => patchStyle({ ...style, preset: "custom", edge: { ...style.edge, curve: event.target.value as CanvasStyle["edge"]["curve"] } })} value={style.edge.curve}>
                    <option value="curved">曲线</option>
                    <option value="straight">直线</option>
                  </select>
                </label>
                <label className="graph-style-check">
                  <input checked={style.edge.byKind} onChange={(event) => patchStyle({ ...style, preset: "custom", edge: { ...style.edge, byKind: event.target.checked } })} type="checkbox" />
                  按关系类型着色
                </label>
                <label className="graph-style-check">
                  <input checked={style.edge.showLabel} onChange={(event) => patchStyle({ ...style, preset: "custom", edge: { ...style.edge, showLabel: event.target.checked } })} type="checkbox" />
                  关系标签
                </label>
                <label>画布底色
                  <input onChange={(event) => patchStyle({ ...style, preset: "custom", canvas: { ...style.canvas, background: event.target.value } })} type="color" value={style.canvas.background || "#f7f7f8"} />
                </label>
                <label>网格
                  <select onChange={(event) => patchStyle({ ...style, preset: "custom", canvas: { ...style.canvas, grid: event.target.value as CanvasStyle["canvas"]["grid"] } })} value={style.canvas.grid}>
                    <option value="dots">点阵</option>
                    <option value="lines">方格</option>
                    <option value="none">无</option>
                  </select>
                </label>
                <label>网格密度
                  <input max={120} min={16} onChange={(event) => patchStyle({ ...style, preset: "custom", canvas: { ...style.canvas, gridSize: Number(event.target.value) } })} step={4} type="range" value={style.canvas.gridSize} />
                </label>
                <label>网格强度
                  <input max={0.8} min={0.05} onChange={(event) => patchStyle({ ...style, preset: "custom", canvas: { ...style.canvas, gridOpacity: Number(event.target.value) } })} step={0.05} type="range" value={style.canvas.gridOpacity} />
                </label>
              </div>
              <button className="ghost-button" onClick={() => applyPreset("classic")} type="button">恢复默认外观</button>
            </div>
  );

  return (
    <section
      className={`workspace-card relationship-page${isStudio ? " graph-studio" : ""}`}
      id="workspace-relationships"
    >
      <WorkspaceHeader
        eyebrow="关系网"
        title="角色关系网"
        summary={
          <>
            {characters.length} 个角色 · {relationships.length} 条关系
          </>
        }
        actions={
          <>
            {/* Two controls in the header, both about what the graph contains: which
                characters are drawn, and adding an edge. Everything that acts on the
                canvas itself sits with the canvas. */}
            <div className="toolbar-group">
              <div aria-label="关系网视图" className="graph-segment relationship-mode" role="group">
                <button
                  aria-pressed={boardMode === "graph"}
                  className={boardMode === "graph" ? "graph-segment-button selected" : "graph-segment-button"}
                  onClick={() => chooseBoardMode("graph")}
                  type="button"
                >
                  图谱
                </button>
                <button
                  aria-pressed={boardMode === "manage"}
                  className={boardMode === "manage" ? "graph-segment-button selected" : "graph-segment-button"}
                  onClick={() => chooseBoardMode("manage")}
                  type="button"
                >
                  管理
                  <span className="relationship-mode-count">{relationships.length}</span>
                </button>
              </div>
            </div>
            {boardMode === "graph" && canLink && (
              <div className="toolbar-group">
                <button
                  aria-pressed={showAll}
                  className={showAll ? "graph-toggle active" : "graph-toggle"}
                  onClick={() => setShowAll((current) => !current)}
                  type="button"
                >
                  {/* The label and the count say what pressing it will show, so the two
                      never describe different sets. */}
                  {showAll ? "只看有关联的" : "显示全部角色"}
                  <span className="graph-toggle-count">{showAll ? connectedIds.size : characters.length}</span>
                </button>
              </div>
            )}
            <div className="toolbar-group">
              <button className="primary-button" disabled={!canLink} onClick={openDraft} type="button">
                新建关系
              </button>
            </div>
          </>
        }
      />

      {!canLink ? (
        <div className="empty-state">
          <h3>至少需要两个角色</h3>
          <p>关系网描述角色之间的连接，先创建第二个角色再回来。</p>
        </div>
      ) : relationships.length === 0 ? (
        /* An empty wheel of a hundred unconnected dots said nothing at all. */
        <div className="empty-state">
          <h3>还没有关系</h3>
          <p>关系网只画有连接的角色。点「新建关系」连接两个角色，它们就会出现在这里。</p>
        </div>
      ) : boardMode === "graph" ? (
        <>
          {/* The drawing is decorative markup; the edge list is the accessible
              representation of the same data, and it lives in 管理 - one screen
              answers "who is this person connected to", the other "where is that
              one edge". A hundred and ninety rows under a drawing answered neither.
              The canvas zooms and pans so a large roster stays navigable instead of
              being flattened into one unreadable ring: names appear only past the
              label zoom, which scales with how many characters there are. */}
          {/* What acts on the canvas sits with the canvas: finding a character,
              zooming, and what the nodes show. The header keeps what the graph
              contains. */}
          <div className={`graph-canvas-tools${isStudio ? " studio-dock" : ""}`}>
            {/* In the studio the search lives in the left drawer, where it sits with
                the list it filters instead of over the drawing. */}
            {!isStudio && (
            <div className="graph-search" ref={searchWrapRef}>
              <label className="graph-search-field">
                <Icon name="search" size={15} />
                <input
                  aria-label="搜索角色并定位"
                  onChange={(event) => {
                    setQuery(event.target.value);
                    setNotOnCanvas(null);
                  }}
                  placeholder="搜索角色名、职业、世界观"
                  type="search"
                  value={query}
                />
                {query && (
                  <button aria-label="清除搜索" onClick={() => setQuery("")} type="button">
                    <Icon name="close" size={13} />
                  </button>
                )}
              </label>
              {query.trim() !== "" && (
                <div aria-label="搜索结果" className="graph-search-panel" role="listbox">
                  {searchResults.length === 0 ? (
                    <p className="muted">没有匹配的角色。</p>
                  ) : (
                    searchResults.map((character) => (
                      <button
                        aria-selected={character.id === focusId}
                        className="character-picker-option"
                        key={character.id}
                        onClick={() => focusCharacter(character)}
                        role="option"
                        type="button"
                      >
                        <CharacterRow character={character} />
                        <span className="graph-search-state">
                          {byId.has(character.id)
                            ? "在画布中"
                            : (degreeById.get(character.id) ?? 0) > 0
                              ? "默认未显示"
                              : "无关联"}
                        </span>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
            )}

            {/* Focus is a state of the whole canvas, so it says so and has one obvious
                way out — the same control the search set it with. */}
            {focusedCharacter && (
              <button
                aria-label={`退出聚焦 ${characterDisplayName(focusedCharacter)}`}
                className="graph-focus-chip"
                onClick={() => setFocusId(null)}
                type="button"
              >
                <span className="graph-focus-chip-dot" />
                聚焦：{characterDisplayName(focusedCharacter)}
                <Icon name="close" size={13} />
              </button>
            )}

            <div aria-label="画布缩放" className="graph-zoom" role="group">
              <button aria-label="缩小画布" className="graph-zoom-step" onClick={() => zoomBy(1 / 1.25)} type="button">
                <Icon name="minus" size={15} />
              </button>
              <button
                aria-label="恢复适配"
                className="graph-zoom-value"
                data-tooltip="适配画布"
                onClick={resetView}
                type="button"
              >
                {Math.round(view.k * 100)}%
              </button>
              <button aria-label="放大画布" className="graph-zoom-step" onClick={() => zoomBy(1.25)} type="button">
                <Icon name="plus" size={15} />
              </button>
              {/* Named rather than implied by a percentage: on a phone there is no
                  tooltip, and "back to the whole network" is the way out of any close-up. */}
              <button
                aria-label="撤销"
                className="graph-history-button"
                disabled={undoRef.current.length === 0}
                onClick={undoLayout}
                type="button"
              >
                ↶
              </button>
              <button
                aria-label="重做"
                className="graph-history-button"
                disabled={redoRef.current.length === 0}
                onClick={redoLayout}
                type="button"
              >
                ↷
              </button>
              {previousView && (
                <button className="graph-fit-button" onClick={restoreView} type="button">
                  恢复视角
                </button>
              )}
              <button aria-label="适应画布" className="graph-fit-button" onClick={resetView} type="button">
                <Icon name="grid" size={14} />
                适应画布
              </button>
              {/* Phones keep zoom and fit on the row and put the rest behind one
                  button, instead of spending a third row on four controls. */}
              <button
                aria-expanded={isMobileToolsOpen}
                className="graph-tool-button graph-mobile-tools-trigger"
                onClick={() => setIsMobileToolsOpen((current) => !current)}
                type="button"
              >
                工具
              </button>
            </div>

            {/* Free placement, arranging and grouping. They act on the drawing, so
                they sit with it, in the same strip as search and zoom. */}
            <div
              aria-label="画布编辑"
              className={`graph-edit-tools${isMobileToolsOpen ? " open" : ""}`}
              role="group"
            >
              <button
                aria-pressed={selectMode}
                className={`graph-tool-button${selectMode ? " active" : ""}`}
                onClick={() => {
                  setSelectMode((current) => {
                    if (current) {
                      setSelectedIds([]);
                    }
                    return !current;
                  });
                  setIsMobileToolsOpen(false);
                }}
                type="button"
              >
                多选
              </button>

              <div className="graph-tool-wrap hidden-in-studio">
                <button
                  aria-expanded={isGroupsOpen}
                  aria-label="视觉分组"
                  className={`graph-tool-button${layout.groups.length > 0 ? " has-count" : ""}`}
                  onClick={() => setIsGroupsOpen((current) => !current)}
                  type="button"
                >
                  分组
                  {layout.groups.length > 0 && <span className="graph-tool-count">{layout.groups.length}</span>}
                </button>
                {isGroupsOpen && (
                  <div className="graph-panel graph-group-panel" role="group" aria-label="视觉分组面板">
                    {groupDraft ? (
                      <form
                        className="graph-group-form"
                        onSubmit={(event) => {
                          event.preventDefault();
                          saveGroupDraft();
                        }}
                      >
                        <label className="graph-group-field">
                          <span>分组名称</span>
                          <input
                            aria-label="分组名称"
                            autoFocus
                            maxLength={40}
                            onChange={(event) =>
                              setGroupDraft((current) =>
                                current ? { ...current, name: event.target.value } : current,
                              )
                            }
                            placeholder="例如：北境线"
                            value={groupDraft.name}
                          />
                        </label>
                        <p className="muted">将 {selectedIds.length} 个角色归为一组。只影响画布，不写世界观。</p>
                        <div className="graph-group-actions">
                          <button className="ghost-button" onClick={() => setGroupDraft(null)} type="button">
                            取消
                          </button>
                          <button className="primary-button" disabled={!groupDraft.name.trim()} type="submit">
                            创建分组
                          </button>
                        </div>
                      </form>
                    ) : (
                      <>
                        {layout.groups.length === 0 ? (
                          <p className="muted">还没有分组。选中两个以上角色后创建。</p>
                        ) : (
                          <ul className="graph-group-list">
                            {layout.groups.map((group) => (
                              <li key={group.id}>
                                <span className="graph-group-name">{group.name}</span>
                                <span className="graph-group-count">{group.characterIds.length} 人</span>
                                <button
                                  aria-label={`取消分组 ${group.name}`}
                                  className="ghost-button graph-group-remove"
                                  onClick={() => {
                                    commitLayout(removeGroup(layout, group.id));
                                    setArrangeUndo(null);
                                  }}
                                  type="button"
                                >
                                  取消分组
                                </button>
                              </li>
                            ))}
                          </ul>
                        )}
                        <button
                          className="ghost-button graph-group-create"
                          disabled={selectedIds.length < 2}
                          onClick={() => setGroupDraft({ name: "", editingId: null })}
                          type="button"
                        >
                          用所选创建分组（{selectedIds.length}）
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>

              <div className="graph-tool-wrap hidden-in-studio">
                <button
                  aria-expanded={isArrangeOpen}
                  className="graph-tool-button"
                  onClick={() => setIsArrangeOpen((current) => !current)}
                  type="button"
                >
                  整理
                </button>
                {isArrangeOpen && (
                  <div className="graph-panel graph-arrange-panel" role="group" aria-label="自动整理">
                    <p className="graph-panel-title">先预览，确认后才写入布局</p>
                    <div className="graph-scope-switch" role="group" aria-label="整理范围">
                      <button
                        aria-pressed={arrangeScope === "visible"}
                        className={arrangeScope === "visible" ? "active" : ""}
                        onClick={() => setArrangeScope("visible")}
                        type="button"
                      >
                        当前可见（{visibleCharacters.length}）
                      </button>
                      <button
                        aria-pressed={arrangeScope === "all"}
                        className={arrangeScope === "all" ? "active" : ""}
                        onClick={() => setArrangeScope("all")}
                        type="button"
                      >
                        全部角色（{characters.length}）
                      </button>
                    </div>
                    <div className="graph-arrange-actions">
                      <button className="ghost-button" onClick={() => proposeArrange("cluster")} type="button">
                        关系聚类
                      </button>
                      <button className="ghost-button" onClick={() => proposeArrange("ring")} type="button">
                        环形布局
                      </button>
                      <button className="ghost-button" onClick={() => proposeArrange("grid")} type="button">
                        网格布局
                      </button>
                      <button className="ghost-button" onClick={() => proposeArrange("hierarchy")} type="button">
                        层级布局
                      </button>
                      <button className="ghost-button" onClick={() => proposeArrange("groups")} type="button">
                        按分组整理
                      </button>
                    </div>
                    <p className="muted">只移动所选范围的节点，不改角色资料与关系。</p>
                  </div>
                )}
              </div>

              <button
                aria-expanded={isStyleOpen}
                className="graph-tool-button hidden-in-studio"
                onClick={() => setIsStyleOpen((open) => !open)}
                type="button"
              >
                外观
              </button>
              <button
                aria-pressed={isStudio}
                className="graph-tool-button graph-studio-entry"
                onClick={enterStudio}
                type="button"
              >
                工作室
              </button>
              <button
                aria-label="重置视角"
                className="graph-tool-button"
                onClick={() => {
                  setFocusId(null);
                  setSelectedIds([]);
                  resetView();
                  setIsMobileToolsOpen(false);
                }}
                type="button"
              >
                重置视角
              </button>
            </div>
          </div>

          {!showAll && visibleCharacters.length < connectedIds.size && (
            <p className="graph-scope-note" role="status">
              画布显示 {visibleCharacters.length} / {connectedIds.size} 个有连接的角色（共{" "}
              {characters.length} 个），另有 {connectedIds.size - visibleCharacters.length} 个未画出。
              点「显示全部角色」可以看完整的网络。
            </p>
          )}

          {notOnCanvas && (
            <div className="graph-notice" role="status">
              <p>
                「{characterDisplayName(notOnCanvas)}」不在画布中：
                {degreeById.get(notOnCanvas.id)
                  ? "当前只画出有关联的角色。"
                  : "这个角色还没有任何关系。"}
              </p>
              <button
                className="ghost-button"
                onClick={() => {
                  setShowAll(true);
                  setFocusId(notOnCanvas.id);
                  setPendingFocusId(notOnCanvas.id);
                  setNotOnCanvas(null);
                }}
                type="button"
              >
                显示全部角色并定位
              </button>
            </div>
          )}

          {/* The capture target is this frame, not the <svg> inside it: html2canvas
              clones the document and then looks the element up in the clone, and an
              <svg> handed to it directly is not found there — it throws the bare
              string "Unable to find element in cloned iframe". Its child SVGs render
              fine, which is why the character sheets always exported. The hover card is
              outside the frame for that reason: a card under the pointer is not part of
              the drawing. */}
          <div className="graph-canvas-holder" ref={holderRef}>
          <div
            className="graph-canvas-frame"
            ref={frameRef}
            /* The colour the author picked has to be the colour they see, not only
               the colour the exported file gets. */
            style={style.canvas.background ? { background: style.canvas.background } : undefined}
          >
          <svg
            aria-hidden="true"
            className="relationship-canvas"
            onPointerCancel={cancelPan}
            onPointerDown={beginPan}
            onPointerMove={movePan}
            onPointerUp={endPan}
            ref={svgRef}
            viewBox={canvas.viewBox}
            xmlns="http://www.w3.org/2000/svg"
          >
            <defs>
              {/* A dot grid, drawn in drawing coordinates so it pans and zooms with
                  the nodes. It is a reference for the eye, not a container: there is
                  no boundary to hit. */}
              <pattern height={style.canvas.gridSize} id="graph-dot-grid" patternUnits="userSpaceOnUse" width={style.canvas.gridSize}>
                <circle className="graph-grid-dot" cx="1" cy="1" r="1.1" />
              </pattern>
              <pattern height={style.canvas.gridSize} id="graph-line-grid" patternUnits="userSpaceOnUse" width={style.canvas.gridSize}>
                <path className="graph-grid-dot" d={`M 0 0 L ${style.canvas.gridSize} 0 M 0 0 L 0 ${style.canvas.gridSize}`} fill="none" strokeWidth="0.6" />
              </pattern>
              {prefs.showAvatars &&
                style.node.showAvatars &&
                visibleCharacters.map((character, index) =>
                  avatarUrls[character.id] ? (
                    <clipPath id={avatarClipId(character.id)} key={character.id}>
                      <circle cx={positions[index].x} cy={positions[index].y} r={metrics.radius * style.node.size} />
                    </clipPath>
                  ) : null,
                )}
            </defs>
            <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
            {style.canvas.grid !== "none" && (
              <rect
                className="graph-grid-plane"
                fill={`url(#${style.canvas.grid === "lines" ? "graph-line-grid" : "graph-dot-grid"})`}
                height={12000}
                opacity={style.canvas.gridOpacity}
                width={16000}
                x={-8000}
                y={-6000}
              />
            )}
            {/* Visual groups sit under the edges and the nodes: a rectangle that
                covered them would swallow every drag that started inside it. */}
            {groupRects.map(({ group, rect }) => (
              <g className="graph-group" data-group-id={group.id} key={group.id}>
                <rect
                  className="graph-group-rect"
                  height={rect.height}
                  rx={26}
                  width={rect.width}
                  x={rect.x}
                  y={rect.y}
                />
                <text className="graph-group-label" x={rect.x + 20} y={rect.y + 30}>
                  {group.name}
                </text>
              </g>
            ))}
            {relationships.map((relationship) => {
              const from = byId.get(relationship.fromId);
              const to = byId.get(relationship.toId);
              if (!from || !to) {
                return null;
              }
              // The path stops at both nodes' edges, the head is drawn as geometry
              // rather than a marker (a marker is scaled by the stroke width and
              // placed from its own origin, which put it inside the destination node
              // and behind it), and a symmetric kind gets no head at all: 友人
              // between two people is not one of them befriending the other.
              const symmetric = isSymmetricKind(relationship.kind);
              const geometry = edgeGeometry(from, to, {
                bend: bends.get(relationship.id) ?? 0,
                metrics,
                symmetrical: symmetric,
              });
              // A single edge may be recoloured, thickened or re-dashed without
              // touching the kind it records or any other line on the canvas.
              const localEdge = layout.edgeStyles?.[relationship.id];
              const edgeColor =
                localEdge?.color ||
                (style.edge.byKind
                  ? `hsl(${kindHue(relationship.kind)} 42% 48%)`
                  : style.edge.color || undefined);
              const edgeWidth = localEdge?.width ?? style.edge.width;
              const edgeDash = localEdge?.dash ?? style.edge.dash;
              const isEdgeSelected = selectedEdgeId === relationship.id;
              // A lens and a spotlight are filters on the view: the edge keeps its
              // data, its kind and its endpoints, and only its ink changes.
              const inLens = !lensActive || lensKinds.includes(relationship.kind);
              const inSpotlight =
                !spotlightSet || spotlightSet.has(relationship.fromId) || spotlightSet.has(relationship.toId);
              const edgePath =
                style.edge.curve === "straight"
                  ? `M ${from.x} ${from.y} L ${to.x} ${to.y}`
                  : geometry.path;
              const touchesHovered =
                activeId !== null &&
                (relationship.fromId === activeId || relationship.toId === activeId);
              return (
                <g
                  className={`relationship-edge kind-${relationship.kind}${touchesHovered ? " active" : ""}${isEdgeSelected ? " selected" : ""}${inLens ? "" : " lens-dim"}${inSpotlight ? "" : " spotlight-dim"}`}
                  data-edge-id={relationship.id}
                  data-from-id={relationship.fromId}
                  data-to-id={relationship.toId}
                  key={relationship.id}
                >
                  {/* A selection halo under the line: an inline colour must not be
                      able to hide the fact that this is the selected object. */}
                  {isEdgeSelected && <path className="relationship-edge-halo" d={edgePath} />}
                  <path
                    d={edgePath}
                    style={{
                      stroke: edgeColor,
                      strokeDasharray:
                        edgeDash === "dashed" ? "7 5" : edgeDash === "dotted" ? "2 4" : undefined,
                      strokeWidth: edgeWidth,
                    }}
                  />
                  {geometry.arrow && (
                    <polygon
                      className="relationship-arrow-head"
                      points={geometry.arrow}
                      style={edgeColor ? { fill: edgeColor } : undefined}
                    />
                  )}
                  {/* Edge labels are the first thing a dense graph has too many of:
                      a hundred rings of 同僚 and 友人 sat on top of each other and none
                      were read. The stroke style already says the kind, and the legend
                      names it; the word appears when a node is pointed at, or when the
                      graph is small enough for every word to have room. */}
                  {style.edge.showLabel &&
                    inLens &&
                    (visibleCharacters.length <= EDGE_LABEL_LIMIT || touchesHovered) && (
                    <text style={{ fontSize: `${style.edge.labelSize}px` }} x={geometry.labelX} y={geometry.labelY}>
                      {relationshipKindLabel(relationship.kind)}
                    </text>
                  )}
                </g>
              );
            })}
            {visibleCharacters.map((character, index) => {
              const isHovered = hoveredId === character.id;
              const isFocused = focusId === character.id;
              const isNeighbour = neighbours.has(character.id);
              // The focused node and its direct connections keep their labels whatever
              // the zoom: without that, searching for somebody in a large roster would
              // highlight circles whose names are not being drawn.
              const isSelected = selectedIds.includes(character.id);
              const nodeOverride = layout.nodeStyles?.[character.id];
              const labelled =
                prefs.showNames &&
                (showLabels || isHovered || isFocused || isNeighbour || isSelected || hubIds.has(character.id));
              // Spotlight dimming is its own class. Sharing one with hover made
              // "I exited the spotlight" and "the pointer is still on a node" look
              // identical, and it made the exit look broken.
              const outsideSpotlight = spotlightSet !== null && !spotlightSet.has(character.id);
              const baseState = outsideSpotlight
                ? "relationship-node spotlight-dim"
                : isFocused
                  ? "relationship-node active focused"
                  : isHovered
                    ? "relationship-node active"
                    : activeId && character.id !== activeId && !isNeighbour
                      ? "relationship-node dimmed"
                      : "relationship-node";
              const state = `${baseState}${isSelected ? " selected" : ""}`;
              const avatarUrl = avatarUrls[character.id];
              return (
                <g
                  className={state}
                  data-character-id={character.id}
                  data-character-name={characterDisplayName(character)}
                  data-local-border={nodeOverride?.borderColor ? "true" : undefined}
                  data-selected={isSelected ? "true" : undefined}
                  key={character.id}
                  onPointerEnter={() => setHoveredId(character.id)}
                  onPointerLeave={() => setHoveredId(null)}
                  role="presentation"
                >
                  {/* The selection ring is its own circle, one step outside the
                      node: a node may carry a local border colour, and a ring drawn
                      by restyling the node's own stroke would either hide that colour
                      or be hidden by it. */}
                  {isSelected && (
                    <circle
                      className="relationship-node-ring"
                      cx={positions[index].x}
                      cy={positions[index].y}
                      r={metrics.radius * style.node.size + 6}
                    />
                  )}
                  <circle
                    cx={positions[index].x}
                    cy={positions[index].y}
                    r={metrics.radius * style.node.size}
                    style={{
                      // Variables rather than properties: the selected state is a
                      // stroke on this same circle, and an inline stroke would win
                      // over it.
                      ...(nodeOverride?.borderColor
                        ? ({ "--node-stroke": nodeOverride.borderColor } as Record<string, string>)
                        : {}),
                      ...(nodeOverride?.background
                        ? ({ "--node-fill": nodeOverride.background } as Record<string, string>)
                        : {}),
                    }}
                  />
                  {/* An uploaded picture is drawn as the node itself, through the same
                      circle and at the same size as the emoji it replaces. Before this
                      the graph only ever drew `avatarEmoji`, so a character with a
                      photo showed a generic face here and the real one everywhere
                      else — the picture was not broken, it was never asked for. */}
                  {prefs.showAvatars && style.node.showAvatars && avatarUrl && (
                    <image
                      className="relationship-node-image"
                      clipPath={`url(#${avatarClipId(character.id)})`}
                      height={metrics.radius * 2}
                      href={avatarUrl}
                      preserveAspectRatio="xMidYMid slice"
                      width={metrics.radius * 2}
                      x={positions[index].x - metrics.radius}
                      y={positions[index].y - metrics.radius}
                    />
                  )}
                  {prefs.showAvatars && style.node.showAvatars && !avatarUrl && (
                    <text
                      className="relationship-node-emoji"
                      style={{ fontSize: `${metrics.emojiSize}px` }}
                      x={positions[index].x}
                      y={positions[index].y}
                    >
                      {character.avatarEmoji || "🙂"}
                    </text>
                  )}
                  {labelled && (
                    <text
                      className={
                        !showLabels && hubIds.has(character.id)
                          ? "relationship-node-name hub"
                          : "relationship-node-name"
                      }
                      style={{
                        // A hub name carries the structure when no other name fits, so it
                        // is drawn larger rather than at the size that did not fit.
                        fontSize: `${nameSize * (!showLabels && hubIds.has(character.id) ? 1.35 : 1)}px`,
                      }}
                      x={positions[index].x}
                      y={positions[index].y + metrics.nameDrop}
                    >
                      {(() => {
                        const name = characterDisplayName(character);
                        // A phone cannot draw twenty characters of name without
                        // covering its neighbours. The selected node always shows the
                        // whole name; the rest are shortened for legibility.
                        return compactViewport && !isSelected && name.length > 9
                          ? `${name.slice(0, 8)}…`
                          : name;
                      })()}
                    </text>
                  )}
                </g>
              );
            })}
            </g>
          </svg>
          </div>

          {/* Who this node is, while the pointer is on it: the four fields a reader
              checks before deciding to open it — name, occupation, worldview and how
              many relationships meet there. Positioned from the node rather than the
              cursor so it does not slide about, and outside the frame so it is not
              captured. */}
          {hoveredEntry && (
            <div className="graph-node-card" ref={nodeCardRef} role="tooltip">
              <strong className="graph-node-card-name">
                {characterDisplayName(hoveredEntry.character)}
              </strong>
              {hoveredEntry.character.occupation && (
                <span className="graph-node-card-field">
                  <em>职业</em>
                  {hoveredEntry.character.occupation}
                </span>
              )}
              {hoveredEntry.character.worldview && (
                <span className="graph-node-card-field">
                  <em>世界观</em>
                  {hoveredEntry.character.worldview}
                </span>
              )}
              <span className="graph-node-card-field">
                <em>关系</em>
                {degreeById.get(hoveredEntry.character.id) ?? 0} 条
              </span>
              <span className="graph-node-card-hint">点击打开角色详情</span>
            </div>
          )}
          </div>

          {/* ------------------------------------------------------------------
              Studio mode. Same canvas, same layout store, same undo stack — only the
              chrome changes: a title bar, two drawers that are closed until asked
              for, and the drawing taking every pixel it can. Nothing here writes
              character or relationship data, and leaving restores the accepted page
              with the view exactly where it was.
              ------------------------------------------------------------------ */}
          {isStudio && (
            <>
              <div className="graph-studio-top" role="toolbar" aria-label="工作室">
                <div className="graph-studio-heading">
                  <button
                    className="graph-studio-exit"
                    onClick={exitStudio}
                    type="button"
                  >
                    <Icon name="arrowLeft" size={16} />
                    <span>退出工作室</span>
                  </button>
                  <div className="graph-studio-titles">
                    <strong>角色关系网</strong>
                    <span>
                      {characters.length} 个角色 · {relationships.length} 条关系
                    </span>
                  </div>
                </div>
                <div className="graph-studio-actions">
                  <button
                    aria-label="撤销"
                    disabled={undoRef.current.length === 0}
                    onClick={undoLayout}
                    type="button"
                  >
                    ↶
                  </button>
                  <button
                    aria-label="重做"
                    disabled={redoRef.current.length === 0}
                    onClick={redoLayout}
                    type="button"
                  >
                    ↷
                  </button>
                  {/* A save that happens on its own still has to be visible: the
                      author needs to know a drag was kept without looking for a
                      button that does not exist. */}
                  <span className="graph-studio-save" data-dirty={livePositions ? "true" : undefined}>
                    <span className="graph-studio-save-dot" />
                    {livePositions ? "调整中…" : "已保存"}
                  </span>
                  <button
                    aria-pressed={isStudioLeftOpen}
                    className="graph-studio-toggle"
                    onClick={() => {
                      setIsStudioLeftOpen((open) => !open);
                      setIsStudioRightOpen(false);
                    }}
                    type="button"
                  >
                    角色
                  </button>
                  <button
                    aria-pressed={isStudioRightOpen && studioTab === "design"}
                    className="graph-studio-toggle"
                    onClick={() => {
                      setStudioTab("design");
                      setIsStudioRightOpen((open) => (studioTab === "design" ? !open : true));
                      setIsStudioLeftOpen(false);
                    }}
                    type="button"
                  >
                    设计
                  </button>
                  <button
                    aria-pressed={isStudioRightOpen && studioTab === "explore"}
                    className="graph-studio-toggle"
                    onClick={() => {
                      setStudioTab("explore");
                      setIsStudioRightOpen((open) => (studioTab === "explore" ? !open : true));
                      setIsStudioLeftOpen(false);
                    }}
                    type="button"
                  >
                    探索
                  </button>
                </div>
              </div>

              {isStudioLeftOpen && (
                <aside aria-label="角色与分组" className="graph-studio-drawer left">
                  <div className="graph-studio-drawer-head">
                    <strong>角色与分组</strong>
                    <button aria-label="关闭角色面板" onClick={() => setIsStudioLeftOpen(false)} type="button">
                      <Icon name="close" size={14} />
                    </button>
                  </div>

                  <label className="graph-studio-search">
                    <Icon name="search" size={15} />
                    <input
                      aria-label="搜索角色"
                      onChange={(event) => {
                        setQuery(event.target.value);
                        setNotOnCanvas(null);
                      }}
                      placeholder="搜索角色名、职业、世界观"
                      type="search"
                      value={query}
                    />
                    {query && (
                      <button aria-label="清除搜索" onClick={() => setQuery("")} type="button">
                        <Icon name="close" size={13} />
                      </button>
                    )}
                  </label>

                  <div className="graph-studio-list" role="listbox" aria-label="角色列表">
                    {(query.trim() ? searchResults : visibleCharacters).map((character) => (
                      <button
                        aria-selected={focusId === character.id}
                        className={`graph-studio-row${focusId === character.id ? " active" : ""}`}
                        key={character.id}
                        onClick={() => focusCharacter(character)}
                        role="option"
                        type="button"
                      >
                        <CharacterRow character={character} />
                        <span className="graph-studio-row-state">
                          {byId.has(character.id) ? "在画布" : "未显示"}
                        </span>
                      </button>
                    ))}
                    {query.trim() && searchResults.length === 0 && (
                      <p className="muted">没有匹配的角色。</p>
                    )}
                  </div>

                  <div className="graph-studio-group">
                    <strong className="graph-studio-section">视觉分组</strong>
                    {groupDraft ? (
                      <form
                        className="graph-studio-group-form"
                        onSubmit={(event) => {
                          event.preventDefault();
                          saveGroupDraft();
                        }}
                      >
                        <input
                          aria-label="分组名称"
                          autoFocus
                          maxLength={40}
                          onChange={(event) =>
                            setGroupDraft((current) =>
                              current ? { ...current, name: event.target.value } : current,
                            )
                          }
                          placeholder="例如：北境线"
                          value={groupDraft.name}
                        />
                        <button className="primary-button" disabled={!groupDraft.name.trim()} type="submit">
                          创建
                        </button>
                        <button className="ghost-button" onClick={() => setGroupDraft(null)} type="button">
                          取消
                        </button>
                      </form>
                    ) : (
                      <button
                        className="ghost-button"
                        disabled={selectedIds.length < 2}
                        onClick={() => setGroupDraft({ name: "", editingId: null })}
                        type="button"
                      >
                        用所选创建分组（{selectedIds.length}）
                      </button>
                    )}
                    {layout.groups.length > 0 && (
                      <ul className="graph-studio-group-list">
                        {layout.groups.map((group) => (
                          <li key={group.id}>
                            <span>{group.name}</span>
                            <em>{group.characterIds.length} 人</em>
                            <button
                              aria-label={`取消分组 ${group.name}`}
                              onClick={() => {
                                commitLayout(removeGroup(layout, group.id));
                                setArrangeUndo(null);
                              }}
                              type="button"
                            >
                              取消
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                    <p className="muted">分组只影响画布，不写入世界观。</p>
                  </div>
                </aside>
              )}

              {isStudioRightOpen && (
                <aside
                  aria-label="设计面板"
                  className="graph-studio-drawer right"
                  data-tab={studioTab}
                >
                  <div className="graph-studio-drawer-head">
                    <strong>{studioTab === "design" ? "设计" : "探索"}</strong>
                    <button aria-label="关闭属性面板" onClick={() => setIsStudioRightOpen(false)} type="button">
                      <Icon name="close" size={14} />
                    </button>
                  </div>

                  <div className="graph-studio-tabs" role="tablist" aria-label="面板">
                    <button
                      aria-selected={studioTab === "design"}
                      className={studioTab === "design" ? "active" : ""}
                      onClick={() => setStudioTab("design")}
                      role="tab"
                      type="button"
                    >
                      设计
                    </button>
                    <button
                      aria-selected={studioTab === "explore"}
                      className={studioTab === "explore" ? "active" : ""}
                      onClick={() => setStudioTab("explore")}
                      role="tab"
                      type="button"
                    >
                      探索
                    </button>
                  </div>

                  <strong className="graph-studio-section">所选对象</strong>
                  {selectedIds.length === 0 ? (
                    <p className="muted">在画布上点选角色，这里显示它的属性和局部外观。</p>
                  ) : selectedIds.length === 1 ? (
                    (() => {
                      const chosen = byId.get(selectedIds[0])?.character;
                      if (!chosen) {
                        return <p className="muted">这个角色已不在画布中。</p>;
                      }
                      return (
                        <div className="graph-studio-props">
                          <CharacterRow character={chosen} />
                          <dl>
                            <dt>关系</dt>
                            <dd>{degreeById.get(chosen.id) ?? 0} 条</dd>
                          </dl>
                          <div className="graph-studio-props-actions">
                            <button className="ghost-button" onClick={() => fitSelection()} type="button">
                              适应选中
                            </button>
                            <button
                              className="ghost-button"
                              onClick={() => onOpenCharacter(chosen.id)}
                              type="button"
                            >
                              打开角色详情
                            </button>
                          </div>
                        </div>
                      );
                    })()
                  ) : (
                    <div className="graph-studio-props">
                      <p className="muted">已选 {selectedIds.length} 个角色。</p>
                      <div className="graph-studio-props-actions">
                        <button className="ghost-button" onClick={() => fitSelection()} type="button">
                          适应选中
                        </button>
                        <button className="ghost-button" onClick={() => setIsAlignOpen((open) => !open)} type="button">
                          对齐与分布
                        </button>
                      </div>
                    </div>
                  )}

                  <strong className="graph-studio-section">布局</strong>
                  <div className="graph-scope-switch" role="group" aria-label="整理范围">
                    <button
                      aria-pressed={arrangeScope === "visible"}
                      className={arrangeScope === "visible" ? "active" : ""}
                      onClick={() => setArrangeScope("visible")}
                      type="button"
                    >
                      当前可见（{visibleCharacters.length}）
                    </button>
                    <button
                      aria-pressed={arrangeScope === "all"}
                      className={arrangeScope === "all" ? "active" : ""}
                      onClick={() => setArrangeScope("all")}
                      type="button"
                    >
                      全部（{characters.length}）
                    </button>
                  </div>
                  <div className="graph-studio-layouts">
                    {([
                      ["cluster", "关系聚类"],
                      ["ring", "环形"],
                      ["grid", "网格"],
                      ["hierarchy", "层级"],
                      ["groups", "按分组"],
                    ] as Array<[ArrangeMode, string]>).map(([mode, label]) => (
                      <button className="ghost-button" key={mode} onClick={() => proposeArrange(mode)} type="button">
                        {label}
                      </button>
                    ))}
                  </div>
                  <p className="muted">先预览，确认后才写入；只移动所选范围，不改关系。</p>

                  <div className="graph-explore-section">
                  <strong className="graph-studio-section">探索</strong>
                  <div className="graph-studio-props">
                    <div className="graph-spotlight">
                      <button
                        className="ghost-button"
                        disabled={selectedIds.length !== 1 || spotlightId === selectedIds[0]}
                        onClick={() => selectedIds.length === 1 && setSpotlightId(selectedIds[0])}
                        type="button"
                      >
                        聚光灯
                      </button>
                      <div className="graph-scope-switch" role="group" aria-label="聚光灯层数">
                        {[1, 2].map((depth) => (
                          <button
                            aria-pressed={spotlightDepth === depth}
                            className={spotlightDepth === depth ? "active" : ""}
                            key={depth}
                            onClick={() => setSpotlightDepth(depth as 1 | 2)}
                            type="button"
                          >
                            {depth} 层
                          </button>
                        ))}
                      </div>
                      {spotlightId && (
                        <button className="ghost-button" onClick={() => setSpotlightId(null)} type="button">
                          退出聚光灯
                        </button>
                      )}
                    </div>
                    <p className="muted">
                      {spotlightId
                        ? `高亮 ${spotlightSet?.size ?? 0} 个角色，其余淡出；只改显示，不改关系。`
                        : "选中一个角色后开启，查看它的直接关系或两层关系。"}
                    </p>

                    <strong className="graph-studio-section">关系类型透镜</strong>
                    <div className="graph-lens">
                      {presentKinds.map((kind) => (
                        <button
                          aria-pressed={lensKinds.includes(kind)}
                          className="graph-lens-chip"
                          key={kind}
                          onClick={() =>
                            setLensKinds((current) =>
                              current.includes(kind)
                                ? current.filter((entry) => entry !== kind)
                                : [...current, kind],
                            )
                          }
                          type="button"
                        >
                          {relationshipKindLabel(kind)}
                        </button>
                      ))}
                      {lensKinds.length > 0 && (
                        <button className="ghost-button" onClick={() => setLensKinds([])} type="button">
                          看全部
                        </button>
                      )}
                    </div>
                    <p className="muted">透镜只让其它类型淡出，不删除任何关系。</p>
                  </div>

                  <strong className="graph-studio-section">视角书签</strong>
                  <form
                    className="graph-bookmark-form"
                    onSubmit={(event) => {
                      event.preventDefault();
                      saveBookmark(bookmarkDraft);
                    }}
                  >
                    <input
                      aria-label="书签名称"
                      maxLength={40}
                      onChange={(event) => setBookmarkDraft(event.target.value)}
                      placeholder="例如：北境线特写"
                      value={bookmarkDraft}
                    />
                    <button className="ghost-button" disabled={!bookmarkDraft.trim()} type="submit">
                      存下视角
                    </button>
                  </form>
                  {(layout.bookmarks ?? []).length > 0 && (
                    <ul className="graph-bookmarks">
                      {(layout.bookmarks ?? []).map((bookmark) => (
                        <li key={bookmark.id}>
                          <input
                            aria-label={`书签 ${bookmark.name}`}
                            maxLength={40}
                            onChange={(event) =>
                              writeBookmarks(
                                (layoutRef.current.bookmarks ?? []).map((entry) =>
                                  entry.id === bookmark.id
                                    ? { ...entry, name: event.target.value.slice(0, 40) }
                                    : entry,
                                ),
                              )
                            }
                            value={bookmark.name}
                          />
                          <button onClick={() => setView(bookmark.view)} type="button">
                            跳转
                          </button>
                          <button
                            aria-label={`删除书签 ${bookmark.name}`}
                            onClick={() =>
                              writeBookmarks(
                                (layoutRef.current.bookmarks ?? []).filter(
                                  (entry) => entry.id !== bookmark.id,
                                ),
                              )
                            }
                            type="button"
                          >
                            删除
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  <p className="muted">书签只记录视角，不复制任何角色数据。</p>
                  </div>

                  <strong className="graph-studio-section">画布外观</strong>
                  {stylePanel}
                </aside>
              )}
            </>
          )}

          {!isStudio && isStyleOpen && stylePanel}

          {/* A fixed slot, so showing a preview or a selection hint does not push
              the canvas down under the pointer that just selected something. */}
          <div className="graph-edit-slot">
          {preview && (
            <div className="graph-edit-bar preview" role="status">
              <span>
                预览：{arrangeLabel(preview.mode)} ·{" "}
                {Object.keys(preview.positions).length} 个节点（
                {preview.scope === "visible" ? "当前可见" : "全部角色"}）
              </span>
              <div className="graph-edit-bar-actions">
                <button className="ghost-button" onClick={() => setPreview(null)} type="button">
                  取消
                </button>
                <button className="primary-button" onClick={applyArrange} type="button">
                  确认应用
                </button>
              </div>
            </div>
          )}

          {!preview && arrangeUndo && (
            <div className="graph-edit-bar" role="status">
              <span>已应用{arrangeUndo.label}</span>
              <div className="graph-edit-bar-actions">
                <button className="ghost-button" onClick={undoArrange} type="button">
                  撤销
                </button>
              </div>
            </div>
          )}

          {selectedIds.length > 0 && !preview && (
            <div className="graph-edit-bar selection" role="status">
              <span>已选 {selectedIds.length} 个角色</span>
              <div className="graph-edit-bar-actions">
                <button className="ghost-button" onClick={fitSelection} type="button">
                  适应选中
                </button>
                <button
                  aria-expanded={isAlignOpen}
                  className="ghost-button"
                  disabled={selectedIds.length < 2}
                  onClick={() => setIsAlignOpen((open) => !open)}
                  type="button"
                >
                  排列
                </button>
                <button
                  className="ghost-button"
                  disabled={selectedIds.length < 2}
                  onClick={() => {
                    setGroupDraft({ name: "", editingId: null });
                    setIsGroupsOpen(true);
                  }}
                  type="button"
                >
                  创建分组
                </button>
                {selectedIds.length === 1 && (
                  <button
                    className="ghost-button"
                    onClick={() => setIsStyleOpen(true)}
                    type="button"
                  >
                    外观
                  </button>
                )}
                <button className="ghost-button" onClick={() => setSelectedIds([])} type="button">
                  清除选择
                </button>
              </div>
            </div>
          )}

          {isAlignOpen && selectedIds.length >= 2 && !preview && (
            <div className="graph-align-panel" role="group" aria-label="对齐与分布">
              <button className="graph-tool-button" onClick={() => alignSelection("x", "start")} type="button">左对齐</button>
              <button className="graph-tool-button" onClick={() => alignSelection("x", "center")} type="button">水平居中</button>
              <button className="graph-tool-button" onClick={() => alignSelection("x", "end")} type="button">右对齐</button>
              <button className="graph-tool-button" onClick={() => alignSelection("y", "start")} type="button">顶对齐</button>
              <button className="graph-tool-button" onClick={() => alignSelection("y", "center")} type="button">垂直居中</button>
              <button className="graph-tool-button" onClick={() => alignSelection("y", "end")} type="button">底对齐</button>
              <button className="graph-tool-button" disabled={selectedIds.length < 3} onClick={() => distributeSelection("x")} type="button">水平等距</button>
              <button className="graph-tool-button" disabled={selectedIds.length < 3} onClick={() => distributeSelection("y")} type="button">垂直等距</button>
              <p className="muted">等距需要三个以上节点。对齐只改坐标，不改关系。</p>
            </div>
          )}

          </div>

          {/* Output, under the drawing it exports. The node's own appearance moved
              behind 显示设置: four size buttons and two switches were the widest thing
              on the row, and they are set once rather than used. Everything here is a
              segmented button of the same height and radius, so the bar still reads as
              one group and one output. It lives outside the frame, so it never ends up
              in an export. */}
          <div className="graph-canvas-bar">
            <div className="graph-display-wrap" ref={displayWrapRef}>
              <button
                aria-expanded={isDisplayOpen}
                className={isDisplayOpen ? "graph-toggle active" : "graph-toggle"}
                onClick={() => setIsDisplayOpen((current) => !current)}
                type="button"
              >
                <Icon name="eye" size={15} />
                显示设置
              </button>
              {isDisplayOpen && (
                <div aria-label="显示设置" className="graph-panel" role="dialog">
                  <div className="graph-panel-row">
                    <span className="graph-control-label">名称</span>
                    <div className="graph-segment">
                      {[
                        { value: true, label: "显示" },
                        { value: false, label: "隐藏" },
                      ].map((option) => (
                        <button
                          aria-pressed={prefs.showNames === option.value}
                          className={prefs.showNames === option.value ? "graph-segment-button selected" : "graph-segment-button"}
                          key={option.label}
                          onClick={() => updatePrefs({ showNames: option.value })}
                          type="button"
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                    <div className="graph-segment">
                      {NAME_SIZES.map((size) => (
                        <button
                          aria-pressed={prefs.nameSize === size.value}
                          className={prefs.nameSize === size.value ? "graph-segment-button selected" : "graph-segment-button"}
                          key={size.value}
                          onClick={() => updatePrefs({ nameSize: size.value })}
                          type="button"
                        >
                          {size.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="graph-panel-row">
                    <span className="graph-control-label">头像</span>
                    <div className="graph-segment">
                      {[
                        { value: true, label: "显示" },
                        { value: false, label: "隐藏" },
                      ].map((option) => (
                        <button
                          aria-pressed={prefs.showAvatars === option.value}
                          className={prefs.showAvatars === option.value ? "graph-segment-button selected" : "graph-segment-button"}
                          key={option.label}
                          onClick={() => updatePrefs({ showAvatars: option.value })}
                          type="button"
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                    <div className="graph-segment">
                      {AVATAR_SIZES.map((size) => (
                        <button
                          aria-pressed={prefs.avatarSize === size.value}
                          className={prefs.avatarSize === size.value ? "graph-segment-button selected" : "graph-segment-button"}
                          key={size.value}
                          onClick={() => updatePrefs({ avatarSize: size.value })}
                          type="button"
                        >
                          {size.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  {/* What the strokes mean. It belongs with the display switches — it is
                      the same question ("what am I looking at") — and it is read once,
                      so it does not get a permanent corner of the drawing. */}
                  <div className="graph-panel-row graph-legend">
                    <span className="graph-control-label">线型</span>
                    <ul className="graph-legend-list">
                      <li>
                        <span aria-hidden="true" className="graph-legend-line legend-primary" />
                        亲属、情感
                      </li>
                      <li>
                        <span aria-hidden="true" className="graph-legend-line legend-danger" />
                        敌对、对手
                      </li>
                      <li>
                        <span aria-hidden="true" className="graph-legend-line legend-plain" />
                        师承、友人、同僚、其他
                      </li>
                    </ul>
                    <p className="graph-legend-note">互为关系不分方向；师承带箭头，指向学习的一方。</p>
                  </div>
                </div>
              )}
            </div>
            {/* Output is set once and used rarely, so it is one toggle wide instead of
                five controls in a row. The choices are one click from the canvas, and
                the formats stay where they were. */}
            <div className="graph-display-wrap graph-export-wrap" ref={exportWrapRef}>
              <button
                aria-expanded={isExportOpen}
                className={isExportOpen ? "graph-toggle active" : "graph-toggle"}
                onClick={() => setIsExportOpen((current) => !current)}
                type="button"
              >
                <Icon name="download" size={15} />
                导出
              </button>
              {isExportOpen && (
                <div aria-label="导出关系网" className="graph-panel" role="group">
                  <div className="graph-panel-row">
                    <span className="graph-control-label">分辨率</span>
                    <div className="graph-segment">
                      {EXPORT_SCALES.map((scale) => (
                        <button
                          aria-pressed={prefs.exportScale === scale.value}
                          className={prefs.exportScale === scale.value ? "graph-segment-button selected" : "graph-segment-button"}
                          key={scale.value}
                          onClick={() => updatePrefs({ exportScale: scale.value })}
                          type="button"
                        >
                          {scale.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="graph-panel-row">
                    <span className="graph-control-label">范围</span>
                    <div className="graph-segment">
                      {([
                        ["all", "全部内容"],
                        ["view", "当前视图"],
                        ["selection", "选中区域"],
                      ] as Array<[ExportScope, string]>).map(([scope, label]) => (
                        <button
                          aria-pressed={exportScope === scope}
                          className={exportScope === scope ? "graph-segment-button selected" : "graph-segment-button"}
                          disabled={scope === "selection" && selectedIds.length === 0}
                          key={scope}
                          onClick={() => setExportScope(scope)}
                          type="button"
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="graph-panel-row">
                    <span className="graph-control-label">格式</span>
                    <div className="graph-segment">
                      {([
                        ["png", "PNG"],
                        ["svg", "SVG"],
                        ["jpg", "JPG"],
                        ["pdf", "PDF"],
                      ] as Array<[string, string]>).map(([format, label]) => (
                        <button
                          className="graph-segment-button"
                          disabled={exporting}
                          key={format}
                          onClick={() =>
                            format === "png" || format === "svg"
                              ? void runCanvasExport(exportScope, format)
                              : void runExport(format as "jpg" | "pdf")
                          }
                          type="button"
                        >
                          {exporting ? "导出中…" : label}
                        </button>
                      ))}
                    </div>
                  </div>
                  {/* The two older formats capture the screen; the two new ones
                      export a rectangle. Saying so is cheaper than a user wondering
                      why 全部内容 did nothing to their PDF. */}
                  <p className="muted graph-export-note">
                    PNG / SVG 按所选范围导出；JPG / PDF 导出当前画面。
                  </p>
                </div>
              )}
            </div>
          </div>

        </>
      ) : (
        <>
          <div className="manage-toolbar">
            <label className="manage-search">
              <Icon name="search" size={15} />
              <input
                aria-label="搜索关系"
                onChange={(event) => {
                  setManageQuery(event.target.value);
                  setManagePage(1);
                }}
                placeholder="搜索角色名或备注"
                type="search"
                value={manageQuery}
              />
              {manageQuery !== "" && (
                <button
                  aria-label="清空关系搜索"
                  onClick={() => {
                    setManageQuery("");
                    setManagePage(1);
                  }}
                  type="button"
                >
                  <Icon name="close" size={13} />
                </button>
              )}
            </label>
            <label className="timeline-filter">
              <span className="timeline-filter-label">关系</span>
              <select
                aria-label="按关系类型筛选"
                onChange={(event) => {
                  setManageKind(event.target.value as "all" | RelationshipKind);
                  setManagePage(1);
                }}
                value={manageKind}
              >
                <option value="all">全部类型</option>
                {RELATIONSHIP_KINDS.map((kind) => (
                  <option key={kind.value} value={kind.value}>
                    {kind.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="timeline-filter">
              <span className="timeline-filter-label">角色</span>
              <select
                aria-label="按关联角色筛选"
                onChange={(event) => {
                  setManageCharacter(event.target.value);
                  setManagePage(1);
                }}
                value={manageCharacter}
              >
                <option value="all">全部角色</option>
                {[...characters]
                  .sort((left, right) => left.name.localeCompare(right.name, "zh"))
                  .map((character) => (
                    <option key={character.id} value={character.id}>
                      {characterDisplayName(character)}
                    </option>
                  ))}
              </select>
            </label>
            <label className="timeline-filter">
              <span className="timeline-filter-label">排序</span>
              <select
                aria-label="关系排序"
                onChange={(event) => setManageSort(event.target.value as "person" | "kind" | "recent")}
                value={manageSort}
              >
                <option value="person">按角色名</option>
                <option value="kind">按关系类型</option>
                <option value="recent">按更新时间</option>
              </select>
            </label>
            <div className="relationship-direction-help">
              <button
                aria-expanded={isDirectionHelpOpen}
                className="ghost-button relationship-direction-button"
                onClick={() => setIsDirectionHelpOpen((current) => !current)}
                type="button"
              >
                方向说明
              </button>
              {isDirectionHelpOpen && (
                <div className="graph-panel relationship-direction-panel" role="note">
                  <p>→ 方向由左指向右（师承方在前）；↔ 互为关系。点「定位」在图谱中放大该角色。</p>
                </div>
              )}
            </div>
            <span aria-live="polite" className="timeline-count">
              {manageRows.length} / {relationships.length} 条
            </span>
          </div>

          {manageRows.length === 0 ? (
            <div className="empty-state">
              <h3>没有匹配的关系</h3>
              <p>换个关键词，或把类型与角色筛选恢复为全部。</p>
            </div>
          ) : (
            <>
              <div className="relationship-table-wrap">
                <table className="relationship-table manage-table">
                  <colgroup>
                    <col style={{ width: "18%" }} />
                    <col style={{ width: "130px" }} />
                    <col style={{ width: "18%" }} />
                    <col />
                    <col style={{ width: "152px" }} />
                  </colgroup>
                  <thead>
                    <tr>
                      <th>角色 A</th>
                      <th>关系</th>
                      <th>角色 B</th>
                      <th>备注</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageRows.map((relationship) => {
                      const symmetric = isSymmetricKind(relationship.kind);
                      const fromName = nameOf(relationship.fromId) || "未知角色";
                      const toName = nameOf(relationship.toId) || "未知角色";
                      return (
                        <tr key={relationship.id}>
                          <td className="manage-name">{fromName}</td>
                          <td>
                            <span className={`relationship-kind-chip kind-${relationship.kind}`}>
                              {relationshipKindLabel(relationship.kind)}
                            </span>
                            <span
                              aria-hidden="true"
                              className="manage-direction"
                              title={symmetric ? "互为关系" : "方向由左指向右"}
                            >
                              {symmetric ? "↔" : "→"}
                            </span>
                            <span className="visually-hidden">
                              {symmetric ? "与对方互为" : "指向右侧角色"}
                            </span>
                          </td>
                          <td className="manage-name">{toName}</td>
                          <td className="relationship-table-note">
                            <span
                              className={
                                expandedNotes.includes(relationship.id)
                                  ? "relationship-note-text expanded"
                                  : "relationship-note-text"
                              }
                            >
                              {relationship.note || "—"}
                            </span>
                            {relationship.note && relationship.note.length > 24 && (
                              <button
                                className="relationship-note-toggle"
                                aria-expanded={expandedNotes.includes(relationship.id)}
                                onClick={() =>
                                  setExpandedNotes((current) =>
                                    current.includes(relationship.id)
                                      ? current.filter((id) => id !== relationship.id)
                                      : [...current, relationship.id],
                                  )
                                }
                                type="button"
                              >
                                {expandedNotes.includes(relationship.id) ? "收起" : "展开"}
                              </button>
                            )}
                          </td>
                          <td className="relationship-col-actions">
                            <button
                              aria-label={`编辑 ${fromName} 与 ${toName} 的${relationshipKindLabel(relationship.kind)}关系`}
                              className="relationship-row-action"
                              onClick={() => openEdit(relationship)}
                              type="button"
                            >
                              编辑
                            </button>
                            <button
                              aria-label={`在图谱中定位 ${fromName}`}
                              className="relationship-row-action"
                              onClick={() => locateOnGraph(relationship)}
                              type="button"
                            >
                              定位
                            </button>
                            <button
                              aria-label={`删除 ${fromName} ${symmetric ? "与" : "到"} ${toName} 的${relationshipKindLabel(relationship.kind)}关系`}
                              className="relationship-row-action"
                              onClick={() => setPendingDelete(relationship)}
                              type="button"
                            >
                              删除
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="relationship-pager">
                <button
                  className="ghost-button"
                  disabled={currentPage <= 1}
                  onClick={() => setManagePage(currentPage - 1)}
                  type="button"
                >
                  上一页
                </button>
                <span>
                  第 {currentPage} / {managePageCount} 页
                </span>
                <button
                  className="ghost-button"
                  disabled={currentPage >= managePageCount}
                  onClick={() => setManagePage(currentPage + 1)}
                  type="button"
                >
                  下一页
                </button>
              </div>

              <p className="muted manage-hint">
                  </p>
            </>
          )}
        </>
      )}

      {message && (
        <p aria-live="polite" className="graph-message" role="status">
          {message}
        </p>
      )}

      {draft && (
        <div
          className="modal-backdrop"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              requestCloseDraft();
            }
          }}
          role="presentation"
        >
          <div
            className="confirm-dialog relationship-dialog"
            ref={draftDialogRef}
            role="dialog"
            aria-modal="true"
            aria-label={editingId ? "编辑关系" : "新建关系"}
          >
            <h2>{editingId ? "编辑关系" : "新建关系"}</h2>
            <div className="relationship-dialog-body">
            {/* The ends and the kind are labelled for the kind chosen: a symmetric
                relationship has two equal sides, a 师承 edge has a direction. The two
                ends are pickers rather than dropdowns, because a hundred names in a
                native option list is not something anyone can search. */}
            <CharacterSelect
              characters={characters}
              legend={draftSymmetric ? "角色 A" : "师承方"}
              onChange={(fromId) => setDraft({ ...draft, fromId })}
              value={draft.fromId}
            />
            <label className="field">
              <span>关系</span>
              <select
                onChange={(event) => setDraft({ ...draft, kind: event.target.value as RelationshipKind })}
                value={draft.kind}
              >
                {RELATIONSHIP_KINDS.map((kind) => (
                  <option key={kind.value} value={kind.value}>
                    {kind.label}
                  </option>
                ))}
              </select>
            </label>
            <CharacterSelect
              characters={characters}
              legend={draftSymmetric ? "角色 B" : "学习方"}
              onChange={(toId) => setDraft({ ...draft, toId })}
              value={draft.toId}
            />
            <label className="field">
              <span>备注</span>
              <input
                onChange={(event) => setDraft({ ...draft, note: event.target.value })}
                placeholder="可选"
                type="text"
                value={draft.note}
              />
            </label>
            {draft.fromId === draft.toId && <p className="muted">角色不能与自己建立关系。</p>}
            {draftDuplicate && (
              <p className="muted">
                已经有一条同样的「{relationshipKindLabel(draft.kind)}」了：
                {draftDuplicateReversed
                  ? "这类关系互为对等，换个方向记的是同一件事。"
                  : "同一方向再记一条是重复的。"}
              </p>
            )}
            </div>

            <div className="form-actions relationship-dialog-actions">
              <button className="ghost-button" onClick={requestCloseDraft} type="button">
                取消
              </button>
              <button
                className="primary-button"
                disabled={draft.fromId === draft.toId || Boolean(draftDuplicate)}
                onClick={submitDraft}
                type="button"
              >
                {editingId ? "保存修改" : "保存关系"}
              </button>
            </div>
          </div>
        </div>
      )}

      {pendingDiscard && (
        <div className="modal-backdrop" role="presentation">
          <div
            aria-label="放弃未保存的修改"
            aria-modal="true"
            className="confirm-dialog"
            ref={discardDialogRef}
            role="dialog"
          >
            <h2>放弃未保存的修改？</h2>
            <p>这条关系还没有保存，关闭后刚才填写的内容会丢失。</p>
            <div className="form-actions">
              <button className="ghost-button" onClick={() => setPendingDiscard(false)} type="button">
                继续编辑
              </button>
              <button className="primary-button" onClick={closeDraftNow} type="button">
                放弃修改
              </button>
            </div>
          </div>
        </div>
      )}

      {pendingDelete && (
        <div className="modal-backdrop" role="presentation">
          <div
            className="confirm-dialog"
            ref={deleteDialogRef}
            role="dialog"
            aria-modal="true"
            aria-label="删除关系"
          >
            <h2>删除关系</h2>
            <p>
              {/* Every character, not only the ones the canvas draws: a 191-edge roster
                  can delete an edge whose ends the core view left out, and the dialog
                  still has to say who it belongs to. */}
              将删除「{relationshipKindLabel(pendingDelete.kind)}」关系：{nameOf(pendingDelete.fromId) || "未知角色"}
              {isSymmetricKind(pendingDelete.kind) ? " ↔ " : " → "}
              {nameOf(pendingDelete.toId) || "未知角色"}。
            </p>
            <div className="form-actions">
              <button className="ghost-button" onClick={() => setPendingDelete(null)} type="button">
                取消
              </button>
              <button className="danger-button" onClick={confirmDelete} type="button">
                确认删除
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
