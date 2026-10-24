import { DEFAULT_CANVAS_STYLE, CANVAS_PRESETS, DEFAULT_KIND_COLORS, LABEL_OFFSET_DEFAULT, kindInk, kindHue, styleForPreset, type ArrowStyle, type CanvasStyle, type CanvasPresetId, type NodeForm } from "../storage/canvasStyle";
import { NumericControl } from "../components/NumericControl";
import { cardLevelFor } from "../utils/cardLevels";
import { applyBatchStyle, batchTargets, mergeNodeValue, nodeOverrides } from "../utils/batchStyle";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import { createPortal } from "react-dom";
import { useEscapeDismiss } from "../hooks/useLightDismiss";
import { popoverPosition } from "../utils/popover";
import {
  createRelationship,
  deleteRelationship,
  loadRelationships,
  pruneRelationships,
  saveRelationships,
} from "../storage/relationshipStorage";
import { Icon } from "../components/Icon";
import GraphGuide from "../components/GraphGuide";
import { WorkspaceHeader } from "../components/WorkspaceHeader";
import { WorkspaceSearch } from "../components/WorkspaceSearch";
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
  EXPORT_RATIOS,
  EXPORT_SCALES,
  NAME_SIZES,
  graphMetrics,
  loadGraphPrefs,
  saveGraphPrefs,
  type GraphMetrics,
  type GraphExportRatio,
  type GraphPrefs,
} from "../storage/graphPrefs";
import {
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
  trySaveLayout,
  translatePositions,
  GROUP_PADDING,
  type ArrangeMode,
  type CanvasBookmark,
  type CanvasGroup,
  type CanvasLayout,
  type LayoutPoint,
} from "../storage/relationshipLayout";
import { exportSurfaceImage, exportSurfacePdf } from "../utils/importExport";
import { dragRect, isMarquee, marqueeHits } from "../utils/marquee";
import { radialNamePlacement } from "../utils/namePlacement";
import { cardNameVisible, labelDensity, nameDropWorld, namesNode, pickSpacedLabels, readableNameSize } from "../utils/labelDensity";
import { emphasisLevel } from "../utils/emphasis";
import { addMembers, normalizeMembers, placeNewPoints, removeMembers } from "../utils/canvasMembers";
import {
  addSnapshot,
  captureSnapshot,
  removeSnapshot,
  renameSnapshot,
  snapshotCoverage,
  snapshotMemberCount,
  snapshotPositions,
  SNAPSHOT_LIMIT,
  type LayoutSnapshot,
} from "../utils/layoutSnapshots";
import { planLegend, type LegendBox } from "../utils/exportLegend";
import {
  beginArrange,
  cancelArrangeSession,
  commitArrangeSession,
  pointsWithinView,
  proposalChanges,
  type ArrangeProposal,
  type ArrangeSession,
} from "../utils/arrangeTransaction";
import {
  ARRANGE_NOTICE_MS,
  appearanceTarget,
  designPanelScope,
  arrangeAvailability,
  contextBarMode,
  surfaceIsOpen,
  toggleSurface,
  type GraphSurface,
  type SurfaceRequest,
} from "../utils/graphSurfaces";
import { pinchView, translateMemberPositions } from "../utils/touchGestures";
import { neighbourPreview } from "../utils/graphNeighbours";
import {
  alignPositions,
  distributePositions,
  nodeStateClass,
  pruneSelection,
  spreadPositions,
  type AlignAxis,
  type AlignBox,
  type AlignMode,
} from "../utils/canvasAlign";
import {
  exportPixelSize,
  downloadPng,
  downloadSvg,
  exportSvgAsPdf,
  inlineSvgPresentation,
  pruneToSelection,
  rasterizeSvg,
  rasterizeToJpeg,
  stripTransientState,
  removeTransientMarks,
  stripCharacterNames,
  scopeBounds,
  type ExportScope,
  type WorldBounds,
} from "../utils/canvasExport";
import {
  MAX_EXPORT_SIDE,
  centreOf,
  clampPan,
  growToAspect,
  manualFrame,
  outputSize,
  projectRect,
  type ExportFrameMode,
} from "../utils/exportFrame";
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
        stroke={
          preset.edge.byKind ? `hsl(${kindHue("rival")} 45% 52%)` : stroke
        }
        strokeDasharray={dash}
        strokeWidth={Math.max(1, lineWidth * 0.8)}
        x1="26"
        x2="62"
        y1="28"
        y2="42"
      />
      {/* The paper under the drawing is part of a style: a dotted preset that showed a
          plain rectangle looked like the minimal one beside it. */}
      {preset.canvas.grid === "dots" &&
        [[10, 10], [20, 10], [30, 10], [10, 20], [10, 30], [86, 46], [76, 46]].map(([x, y]) => (
          <circle cx={x} cy={y} fill={border} key={`dot-${x}-${y}`} opacity="0.45" r="0.9" />
        ))}
      {/* The cover shows the node form the preset actually draws: a card preset that
          previewed three circles looked the same as the one beside it. */}
      {[
        [26, 28],
        [70, 18],
        [62, 42],
      ].map(([x, y]) =>
        preset.node.form === "card" ? (
          <rect
            fill={fill}
            height="12"
            key={`${x}-${y}`}
            rx="3"
            stroke={border}
            strokeWidth="1.4"
            width="20"
            x={x - 10}
            y={y - 6}
          />
        ) : (
          <circle
            cx={x}
            cy={y}
            fill={fill}
            key={`${x}-${y}`}
            r={preset.node.form === "compact" ? radius * 0.55 : radius}
            stroke={border}
            strokeWidth="1.4"
          />
        ),
      )}
      {/* Drawn, not typed: an emoji in the swatch would become part of the button's
          text, and the swatch is decoration for a control whose name is 档案研究. */}
      {preset.node.showAvatars &&
        [
          [26, 28],
          [70, 18],
          [62, 42],
        ].map(([x, y]) => (
          <g key={`${x}-${y}`}>
            <circle cx={x} cy={y} fill="#fde68a" r={radius * 0.62} />
            <circle cx={x - radius * 0.22} cy={y - radius * 0.16} fill="#92400e" r={radius * 0.09} />
            <circle cx={x + radius * 0.22} cy={y - radius * 0.16} fill="#92400e" r={radius * 0.09} />
            <path
              d={`M${x - radius * 0.3} ${y + radius * 0.14} q${radius * 0.3} ${radius * 0.34} ${radius * 0.6} 0`}
              fill="none"
              stroke="#92400e"
              strokeLinecap="round"
              strokeWidth={Math.max(0.8, radius * 0.1)}
            />
          </g>
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
/** How near a centre has to come before an alignment line appears, in screen px. */
const GUIDE_PX = 6;

const FIT_MARGIN = 0.1;
const FIT_MAX_ZOOM = 1.6;
// Automatic framing stops at a *visible* zoom, not at a multiple of the drawing's own
// scale. A two-node canvas has a tiny box, so the canvas's own scale is already large and
// a plain fit lands at 223%: a portrait of two circles, not an overview. These ceilings
// are read against `view.k × screenScale`, which is the number on the readout. They only
// bind when the drawing is small enough to fill the frame by itself, so a 40- or
// 100-character canvas is untouched. Manual zoom — +, −, pinch, wheel — is not capped
// here and still runs to ZOOM_MAX.
const AUTO_FIT_MAX_ZOOM = 1.2;
const AUTO_FOCUS_MAX_ZOOM = 2;
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
export function nodePositions(
  count: number,
  nodeRadius = NODE_RADIUS,
  /** Room each node needs along the ring, in order. Cards need far more than circles;
   *  omitting this keeps the historical equal-slot wheel exactly as it was. */
  widths?: number[],
): GraphPoint[] {
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
  const slot = nodeRadius * 2 + NODE_GAP;

  if (widths && widths.some((width) => width > slot)) {
    const spans = widths.map((width) => Math.max(slot, width));
    const total = spans.reduce((sum, value) => sum + value, 0);
    const wideRadius = Math.max(RADIUS, total / (Math.PI * 2));
    let travelled = 0;

    return spans.map((span) => {
      const angle = ((travelled + span / 2) / total) * Math.PI * 2 - Math.PI / 2;
      travelled += span;

      return { x: VIEW / 2 + Math.cos(angle) * wideRadius, y: VIEW / 2 + Math.sin(angle) * wideRadius };
    });
  }

  const radius = Math.max(RADIUS, (count * slot) / (Math.PI * 2));

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

/**
 * A small shift that keeps a relationship label off what it would otherwise cover.
 *
 * The label belongs to one wire, so its candidates stay close: a step above or below
 * the midpoint, then the same step along the wire's normal. The first candidate that
 * touches nothing wins — node frames, name blocks, labels already placed. If every
 * candidate collides the label stays where it was: a readable word on a line beats a
 * word parked where nobody can connect it to its wire.
 */
export function chooseLabelOffset(
  baseX: number,
  baseY: number,
  normalX: number,
  normalY: number,
  width: number,
  height: number,
  obstacles: { x: number; y: number; width: number; height: number }[],
): { x: number; y: number } {
  const candidates: Array<[number, number]> = [
    [0, 0],
    [0, -height - 4],
    [0, height + 4],
    [normalX * (width / 2 + 14), normalY * (width / 2 + 14)],
    [-normalX * (width / 2 + 14), -normalY * (width / 2 + 14)],
    [0, -2 * (height + 4)],
    [0, 2 * (height + 4)],
  ];

  const overlaps = (x: number, y: number) =>
    obstacles.some(
      (rect) =>
        x < rect.x + rect.width &&
        x + width > rect.x &&
        y < rect.y + rect.height &&
        y + height > rect.y,
    );

  for (const [dx, dy] of candidates) {
    if (!overlaps(baseX + dx, baseY + dy)) {
      return { x: baseX + dx, y: baseY + dy };
    }
  }

  return { x: baseX, y: baseY };
}

/**
 * A name broken into at most two lines that fit the node it belongs to.
 *
 * Character counts are not a rule — a twelve-character Chinese name and a sixteen-letter
 * Latin one occupy very different widths — so lines are filled against the measured
 * width. Latin words are preferred as break points, CJK breaks anywhere, and the last
 * line ends in an ellipsis rather than running out of the node. The full name stays
 * available through the text's own tooltip and the detail page.
 */
export function wrapNameLines(
  name: string,
  maxWidth: number,
  fontSize: number,
  maxLines = 2,
): string[] {
  const characters = [...name];

  if (characters.length === 0) {
    return [];
  }

  if (maxWidth <= 0) {
    return [name];
  }

  const lines: string[] = [];
  let index = 0;

  while (index < characters.length && lines.length < maxLines) {
    let line = "";

    while (index < characters.length) {
      const candidate = `${line}${characters[index]}`;

      if (line === "" || measureNameWidth(candidate, fontSize) <= maxWidth) {
        line = candidate;
        index += 1;
      } else {
        break;
      }
    }

    // Latin words read badly split mid-word: step back to the last space and carry the
    // unfinished word to the next line. CJK has no spaces and breaks anywhere.
    const space = line.lastIndexOf(" ");

    if (index < characters.length && space > 0 && space < line.length - 1) {
      const carry = line.slice(space + 1);
      line = line.slice(0, space);
      index -= carry.length;
    }

    lines.push(line);
  }

  if (index < characters.length && lines.length > 0) {
    let last = lines[lines.length - 1];

    while (last.length > 0 && measureNameWidth(`${last}…`, fontSize) > maxWidth) {
      last = last.slice(0, -1);
    }

    lines[lines.length - 1] = `${last}…`;
  }

  return lines.filter((line, position) => line.length > 0 || position === 0);
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
 * Keep an automatic fit from magnifying a small drawing into a close-up.
 *
 * `screenScale` converts drawing units to CSS pixels, so `zoom × screenScale` is the
 * zoom a person reads in the toolbar. Capping that product means the ceiling means the
 * same thing on every canvas size; on a large roster the measured product is well under
 * the ceiling and nothing changes.
 */
function capAutoZoom(zoom: number, screenScale: number, ceiling: number) {
  if (!(screenScale > 0) || !(ceiling > 0)) {
    return zoom;
  }
  return Math.min(zoom, ceiling / screenScale);
}

/**
 * Identity of the room the drawing has: its size and the part of it a sheet covers.
 *
 * Rounded to whole pixels because a fit that is recomputed for a half-pixel change is
 * a fit that visibly re-runs for no reason.
 */
function frameKey(width: number, height: number, inset: number) {
  return `${Math.round(width)}x${Math.round(height)}x${Math.round(inset)}`;
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

/** Perceived brightness of a CSS colour, for choosing ink on top of it. */
export function luminanceOf(color: string): number {
  const rgba = color.match(/rgba?\(([^)]+)\)/);
  const hex = color.match(/^#([0-9a-f]{6})$/i);
  const channels = rgba
    ? rgba[1].split(",").slice(0, 3).map((part) => Number(part.trim()))
    : hex
      ? [0, 2, 4].map((offset) => parseInt(hex[1].slice(offset, offset + 2), 16))
      : [255, 255, 255];

  const [r, g, b] = channels;

  return (r * 299 + g * 587 + b * 114) / 1000;
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
/**
 * How much room the names have, as one number: 1 is exactly enough, below 1 is not.
 *
 * Both tests are folded into a ratio so the boundary can be moved without duplicating
 * the arithmetic — the switch below needs to know how far past it a zoom landed.
 */
export function labelReadability(options: {
  positions: GraphPoint[];
  nameSize: number;
  zoom: number;
  scale: number;
}): number {
  const rendered = options.nameSize * options.zoom * options.scale;

  if (!(rendered > 0)) {
    return 0;
  }

  const spacing = minimumNodeSpacing(options.positions) * options.zoom * options.scale;

  return Math.min(rendered / MIN_LABEL_PX, spacing / (rendered * LABEL_GAP_FACTOR + LABEL_GAP_MIN));
}

export function labelsReadable(options: {
  positions: GraphPoint[];
  nameSize: number;
  zoom: number;
  scale: number;
}): boolean {
  return labelReadability(options) >= 1;
}

/**
 * Names come on at 1.0 of the room they need and only go away below 0.9.
 *
 * A single threshold makes the labels strobe when the reader rests the wheel on it:
 * one notch of zoom crosses the line in both directions. The gap means a zoom that
 * lands near the boundary settles instead of flapping.
 */
export function labelsFitAfter(current: boolean, readability: number): boolean {
  return current ? readability >= 0.9 : readability >= 1;
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
 * How much wider the canvas box must be for the visual groups it draws.
 *
 * A group's border stands `GROUP_PADDING` away from its members, so a box that only
 * reserved room for nodes and labels could end with the border outside it — which is
 * how `北境线` came to look pinned to the left edge of the canvas. The answer is the
 * shortfall, plus a little air, and zero when there is nothing to draw around.
 */
/**
 * The identity of a drawing box: the visible roster, how wide its widest object is,
 * and whether a group border has to be accommodated.
 *
 * The box is cached so a drag cannot move the mapping under the pointer, but the key
 * used to be the roster alone. Switching every node to cards, or creating the first
 * group, changed what the box had to contain without changing who was on it, so the
 * cached box was reused and the new cards and borders were drawn outside it.
 */
export function canvasBoxKey(
  ids: string[],
  boxHalfWidth: number,
  hasGroups: boolean,
  extra = "committed",
): string {
  return `${ids.join("|")}::${boxHalfWidth.toFixed(2)}::${hasGroups ? "groups" : "none"}::${extra}`;
}

/** Where a proposed arrangement puts everything, so the box can follow it. */
export function previewBoxKey(positions: Record<string, { x: number; y: number }>): string {
  return `preview:${Object.keys(positions)
    .sort()
    .map((id) => `${id}@${Math.round(positions[id].x)},${Math.round(positions[id].y)}`)
    .join(";")}`;
}

/** A card is wide enough for a four-character name and one short line under it. */
export const CARD_WIDTH = 168;
export const CARD_HEIGHT = 56;
/** The rung between a full card and a dot: a name plate with no avatar. */
export const PLATE_WIDTH = 112;
export const PLATE_HEIGHT = 30;

/**
 * How much of a card can be drawn where it stands. This is a drawing decision, not a
 * setting: the author's form stays "card" in storage whatever the crowding says.
 */
export type CardLevel = "full" | "plate" | "compact";

/**
 * The selected ring's ink, in drawing units, for a given on-screen scale.
 *
 * A fixed world-space stroke is 0.3px at the zoom a hundred nodes are read at and the
 * ring stops saying anything. Solving for ~2.2px of screen keeps the mark the same
 * weight from three nodes to a hundred, and clamps so it can neither vanish nor turn
 * into a band when the frame has not been measured yet.
 */
/**
 * Everyone one hop from the anchors, excluding the anchors themselves.
 *
 * Reading a selected person means reading who stands next to them, so this set is what
 * decides which cards keep their name when the roster is too crowded for all of them.
 * A relationship is symmetric here whatever its kind: a line exists between two people.
 */
export function neighbourIdsOf(
  anchors: Iterable<string>,
  relationships: { fromId: string; toId: string }[],
): Set<string> {
  const anchorSet = new Set(anchors);
  const out = new Set<string>();

  for (const relationship of relationships) {
    if (anchorSet.has(relationship.fromId) && !anchorSet.has(relationship.toId)) {
      out.add(relationship.toId);
    }
    if (anchorSet.has(relationship.toId) && !anchorSet.has(relationship.fromId)) {
      out.add(relationship.fromId);
    }
  }

  return out;
}

/**
 * The ink a relationship kind is drawn with. One rule, read by the canvas, by the SVG
 * export and by every legend, so a legend cannot claim a colour the line does not use.
 */
export function edgeInk(
  kind: string,
  style: CanvasStyle,
  local?: { color?: string; width?: number; dash?: "solid" | "dashed" | "dotted"; opacity?: number },
): { color: string; width: number; dash: "solid" | "dashed" | "dotted"; opacity: number } {
  // Priority, in one place: the line's own override, then the canvas style, then the
  // preset the style was built from, then the built-in default. `edgeInk` is the only
  // reader, so the export cannot paint a line the canvas did not.
  return {
    color:
      local?.color ||
      (style.edge.byKind ? kindInk(kind, style) : style.edge.color || "#98a2b3"),
    width: local?.width ?? style.edge.width,
    dash: local?.dash ?? style.edge.dash,
    opacity: local?.opacity ?? style.edge.opacity ?? 1,
  };
}

/** The dash pattern a line style is drawn with, in drawing units. */
export function dashArrayFor(dash: "solid" | "dashed" | "dotted"): string | undefined {
  return dash === "dashed" ? "7 5" : dash === "dotted" ? "2 4" : undefined;
}

export function ringStrokeFor(pxPerUnit: number): number {
  const scale = Math.max(pxPerUnit, 0.0001);

  return Math.min(8, Math.max(2, 2.2 / scale));
}

/** The rectangle a card occupies at a given level, in drawing units. */
export function cardRect(level: CardLevel, x: number, y: number, size = 1) {
  if (level === "compact") {
    return null;
  }

  const width = (level === "full" ? CARD_WIDTH : PLATE_WIDTH) * size;
  const height = (level === "full" ? CARD_HEIGHT : PLATE_HEIGHT) * size;

  return { left: x - width / 2, right: x + width / 2, top: y - height / 2, bottom: y + height / 2, width, height };
}

/**
 * Picks a level for every card so that no two cards overlap.
 *
 * Priority decides who keeps the full card — the selected person first, then the
 * focused one, then whoever arrived first — and each card takes the richest level that
 * still fits beside what is already placed. The result depends on world positions, so
 * zooming cannot make it flicker.
 */
export function resolveCardLevels(
  entries: { id: string; x: number; y: number; priority?: number }[],
  size = 1,
  options: { padding?: number; compactRadius?: number } = {},
): Record<string, CardLevel> {
  const padding = options.padding ?? 10;
  const radius = options.compactRadius ?? DEFAULT_METRICS.radius * 0.62;
  const placed: { left: number; right: number; top: number; bottom: number }[] = [];
  const levels: Record<string, CardLevel> = {};
  const order = [...entries].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));

  const fits = (rect: { left: number; right: number; top: number; bottom: number }) =>
    placed.every(
      (other) =>
        rect.right + padding <= other.left ||
        rect.left - padding >= other.right ||
        rect.bottom + padding <= other.top ||
        rect.top - padding >= other.bottom,
    );

  for (const entry of order) {
    const chosen =
      (["full", "plate"] as const).find((level) => {
        const rect = cardRect(level, entry.x, entry.y, size);
        return rect ? fits(rect) : false;
      }) ?? "compact";

    const rect = cardRect(chosen, entry.x, entry.y, size);

    if (rect) {
      placed.push(rect);
    } else {
      placed.push({ left: entry.x - radius, right: entry.x + radius, top: entry.y - radius, bottom: entry.y + radius });
    }

    levels[entry.id] = chosen;
  }

  return levels;
}

/** The geometry of a card at a level. Plate and compact are smaller than a full card. */
export function cardGeometry(level: CardLevel, metrics: GraphMetrics, size: number) {
  if (level === "compact") {
    return nodeGeometry("compact", metrics, size);
  }

  const width = (level === "full" ? CARD_WIDTH : PLATE_WIDTH) * size;
  const height = (level === "full" ? CARD_HEIGHT : PLATE_HEIGHT) * size;

  return {
    radius: metrics.radius * size,
    halfWidth: width / 2,
    halfHeight: height / 2,
    card: true,
    rounded: false,
    rx: 12,
  };
}

/**
 * The geometry a node is drawn with. One function for drawing, hit bounds, edges and
 * the fitted frame, so a card cannot be laid out by one rule and trimmed by another.
 */
/** The band of proportions that reads as a face rather than a scene. */
export const AVATAR_ROUND_MIN = 0.85;
export const AVATAR_ROUND_MAX = 1.18;

/**
 * Circle or rounded frame for a picture.
 *
 * The picture's own proportions decide, because that is the thing that gets cut: a
 * portrait loses a chin in a circle, a wide scene loses both ends. `auto` is a read of
 * the file, not a preference — an explicit 圆形/圆角矩形 always wins, including when the
 * image has not loaded yet and there is nothing to measure.
 */
export function avatarShapeFor(
  setting: "auto" | "circle" | "rounded" | undefined,
  ratio: number | undefined,
): "circle" | "rounded" {
  if (setting === "circle" || setting === "rounded") {
    return setting;
  }
  if (!ratio || !Number.isFinite(ratio) || ratio <= 0) {
    return "circle";
  }

  return ratio >= AVATAR_ROUND_MIN && ratio <= AVATAR_ROUND_MAX ? "circle" : "rounded";
}

/**
 * The frame a picture occupies. A rounded frame keeps the same visual weight as the
 * circle it replaces: the long side grows a little, the short side follows the picture,
 * and the ratio is clamped so a panorama cannot become a strip.
 */
export function avatarFrame(shape: "circle" | "rounded", radius: number, ratio = 1) {
  if (shape === "circle") {
    return { halfWidth: radius, halfHeight: radius, rx: radius };
  }

  const clamped = Math.min(1.7, Math.max(0.62, ratio));
  const long = radius * 1.16;
  const halfWidth = clamped >= 1 ? long : long * clamped;
  const halfHeight = clamped >= 1 ? long / clamped : long;

  return { halfWidth, halfHeight, rx: Math.min(halfWidth, halfHeight) * 0.28 };
}

export function nodeGeometry(
  form: NodeForm,
  metrics: GraphMetrics,
  size: number,
  avatar?: { shape: "circle" | "rounded"; ratio?: number },
): {
  radius: number;
  halfWidth: number;
  halfHeight: number;
  card: boolean;
  rounded: boolean;
  rx: number;
} {
  if (form === "card") {
    return {
      radius: (metrics.radius * size),
      halfWidth: (CARD_WIDTH * size) / 2,
      halfHeight: (CARD_HEIGHT * size) / 2,
      card: true,
      rounded: false,
      rx: 12,
    };
  }

  const radius = form === "compact" ? metrics.radius * 0.62 * size : metrics.radius * size;

  if (form === "avatar" && avatar?.shape === "rounded") {
    const frame = avatarFrame("rounded", radius, avatar.ratio ?? 1);

    return { radius, ...frame, card: false, rounded: true };
  }

  return { radius, halfWidth: radius, halfHeight: radius, card: false, rounded: false, rx: radius };
}

/**
 * The half width the canvas must reserve: the widest external label, or the widest
 * card's own half width if that is larger. A card carries its name inside itself, so
 * its box is the thing that has to fit, not a label beside it.
 */
export function boxHalfWidthFor(
  forms: NodeForm[],
  metrics: GraphMetrics,
  labelHalfWidth: number,
  size = 1,
  extraHalfWidth = 0,
): number {
  const cardHalf = (CARD_WIDTH * size) / 2;
  const widestCard = forms.reduce(
    (widest, form) => (form === "card" ? Math.max(widest, cardHalf - metrics.radius) : widest),
    0,
  );

  return Math.max(labelHalfWidth, widestCard, extraHalfWidth);
}

/**
 * Room a group's border leaves around its members. A dashed box drawn 72 units out
 * cuts straight through a card that is 84 units wide, so the padding follows the
 * widest form the group actually contains.
 */
export function groupPaddingFor(forms: NodeForm[], size = 1): number {
  const cardHalf = (CARD_WIDTH * size) / 2;

  return forms.some((form) => form === "card") ? Math.max(GROUP_PADDING, cardHalf + 10) : GROUP_PADDING;
}

/**
 * How a name is set inside a card: one line, measured, with an ellipsis when it will
 * not fit. Character counts are not a rule — a measured width is.
 */
export function cardNameLayout(
  name: string,
  availableWidth: number,
  fontSize: number,
): { text: string; fontSize: number } {
  if (measureNameWidth(name, fontSize) <= availableWidth) {
    return { text: name, fontSize };
  }

  const glyphs = [...name];
  let size = fontSize;

  // A slightly smaller type often fits the whole name; only then does it truncate.
  while (size > 10 && measureNameWidth(name, size) > availableWidth) {
    size -= 1;
  }

  if (measureNameWidth(name, size) <= availableWidth) {
    return { text: name, fontSize: size };
  }

  let text = "";

  for (const glyph of glyphs) {
    if (measureNameWidth(`${text}${glyph}…`, size) > availableWidth) {
      break;
    }
    text += glyph;
  }

  return { text: `${text || (glyphs[0] ?? "")}…`, fontSize: size };
}

export function groupBleed(
  hasGroups: boolean,
  metrics: GraphMetrics = DEFAULT_METRICS,
  labelHalfWidth = 0,
): { x: number; y: number } {
  if (!hasGroups) {
    return { x: 0, y: 0 };
  }

  // Sideways the box reserves room for the widest label; above and below it only
  // reserves the node and its padding, which is less than the border needs.
  const horizontalReserve = metrics.radius + CANVAS_PADDING + labelHalfWidth;
  const verticalReserve = metrics.radius + CANVAS_PADDING;

  return {
    x: Math.max(0, GROUP_PADDING + 10 - horizontalReserve),
    y: Math.max(0, GROUP_PADDING + 10 - verticalReserve),
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

  // `allowance` is the fit with the margin kept. `meet` makes the limiting axis
  // exactly the size of the frame, so a drawing that is not comfortably smaller than
  // its frame lands on a fit of 1.0 — and a floor of 1 threw the margin away, which
  // is how a hundred-node ring opened with its top label three pixels from the edge.
  // A drawing with room to spare still grows into the frame (up to `max`); one that
  // only just fits is drawn a fraction smaller instead of flush.
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
  options: {
    bend?: number;
    metrics?: GraphMetrics;
    symmetrical?: boolean;
    /** Half extents of each end when it is not a circle (a card). */
    fromBox?: { halfWidth: number; halfHeight: number };
    toBox?: { halfWidth: number; halfHeight: number };
    /** The circle radius each end is actually drawn at (size, compact form). */
    fromRadius?: number;
    toRadius?: number;
    /** Stroke width, so the head grows with the line instead of floating beside it. */
    weight?: number;
    /** Which head to draw. `none` keeps the direction in the data and out of the ink. */
    arrowStyle?: ArrowStyle;
    /** The stored 箭头大小 multiplier; 0 means no head. */
    arrowScale?: number;
    /** Where along the line the word sits. 0.5 is the middle. */
    labelT?: number;
    /** Distance from the line, in drawing units. */
    labelOffset?: number;
  } = {},
): EdgeGeometry {
  const metrics = options.metrics ?? DEFAULT_METRICS;
  const bend = options.bend ?? 0;
  const length = Math.hypot(to.x - from.x, to.y - from.y) || 1;
  const ux = (to.x - from.x) / length;
  const uy = (to.y - from.y) / length;
  // Left normal of this edge's own direction.
  const nx = -uy;
  const ny = ux;

  // Distance from the centre to the boundary along this direction. A circle is the
  // same in every direction; a card is not, and using its width everywhere left the
  // line floating beside its narrow side.
  // A circle is the radius it is drawn at — which is not `metrics.radius` when the
  // author chose the compact form or a node size other than 1. Using the default
  // radius left the line stopping short of a small node and running under a large one.
  const reach = (
    box: { halfWidth: number; halfHeight: number } | undefined,
    pad: number,
    radius: number,
  ) =>
    box
      ? 1 / Math.max(Math.abs(ux) / box.halfWidth, Math.abs(uy) / box.halfHeight) + pad
      : radius + pad;

  const startX = from.x + ux * reach(options.fromBox, 2, options.fromRadius ?? metrics.radius);
  const startY = from.y + uy * reach(options.fromBox, 2, options.fromRadius ?? metrics.radius);
  const endX = to.x - ux * reach(options.toBox, 3, options.toRadius ?? metrics.radius);
  const endY = to.y - uy * reach(options.toBox, 3, options.toRadius ?? metrics.radius);
  const bendAmount = bend * BEND_UNIT;
  const controlX = (startX + endX) / 2 + nx * bendAmount;
  const controlY = (startY + endY) / 2 + ny * bendAmount;

  // Middle of the curve. For a quadratic that is (P0 + 2C + P2) / 4, and its tangent
  // there is parallel to the chord — so the normal below is the normal of the curve.
  const middleX =
    bend === 0 ? (startX + endX) / 2 : (startX + 2 * controlX + endX) / 4;
  const middleY =
    bend === 0 ? (startY + endY) / 2 : (startY + 2 * controlY + endY) / 4;
  const side = bend === 0 ? 1 : Math.sign(bend);

  const arrowStyle = options.arrowStyle ?? "concise";
  const arrowScale = options.arrowScale ?? 1;
  let arrow: string | null = null;
  // Direction of travel at the target end: the curve's tangent at t = 1.
  const tangentX = bend === 0 ? ux : endX - controlX;
  const tangentY = bend === 0 ? uy : endY - controlY;
  const tangentLength = Math.hypot(tangentX, tangentY) || 1;
  const tx = tangentX / tangentLength;
  const ty = tangentY / tangentLength;
  let headLength = 0;

  if (!options.symmetrical && arrowStyle !== "none" && arrowScale > 0) {
    // Bounded growth: a heavier line gets a slightly larger head, a hairline does
    // not disappear. Unbounded scaling is what made the head look like a flowchart.
    const base = Math.max(8, Math.min(14, 8 + (options.weight ?? 1.4) * 1.6)) * arrowScale;
    // 简洁 is the reference; 细线 narrows and shortens it; 柔和 is a shorter, wider head
    // that reads as a direction rather than as an instruction.
    const head = arrowStyle === "thin" ? base * 0.84 : arrowStyle === "soft" ? base * 0.9 : base;
    const wing = head * (arrowStyle === "thin" ? 0.3 : arrowStyle === "soft" ? 0.62 : 0.45);
    const backX = endX - tx * head;
    const backY = endY - ty * head;
    const wingX = -ty * wing;
    const wingY = tx * wing;
    headLength = head;
    arrow = `${round(endX)},${round(endY)} ${round(backX + wingX)},${round(backY + wingY)} ${round(backX - wingX)},${round(backY - wingY)}`;
  }

  // The stroke stops at the back of the head.
  //
  // It used to run all the way to the tip, so a line at 50% opacity passed under a
  // head at 50% opacity and the overlap composited twice: a dark wedge exactly where
  // the two meet, on every semi-transparent arrow. Shrinking the head or making it
  // opaque only moves or hides the seam; ending the stroke where the head begins
  // removes it. A hair of overlap (6%) keeps antialiasing from leaving a gap.
  const visibleLength = Math.hypot(endX - startX, endY - startY);
  const pull = arrow ? Math.min(headLength * 0.94, visibleLength * 0.45) : 0;
  const lineEndX = endX - tx * pull;
  const lineEndY = endY - ty * pull;

  const path =
    bend === 0
      ? `M ${round(startX)} ${round(startY)} L ${round(lineEndX)} ${round(lineEndY)}`
      : `M ${round(startX)} ${round(startY)} Q ${round(controlX)} ${round(controlY)} ${round(lineEndX)} ${round(lineEndY)}`;

  // The word's anchor. `labelT` evaluates the same quadratic the line is drawn with, so
  // moving it slides the word along the curve rather than along the chord; the offset is
  // applied on that point's own normal. Both are drawing units, so they keep their
  // meaning under zoom.
  const at = Math.min(Math.max(options.labelT ?? 0.5, 0), 1);
  const anchorX =
    (1 - at) * (1 - at) * startX + 2 * (1 - at) * at * controlX + at * at * endX;
  const anchorY =
    (1 - at) * (1 - at) * startY + 2 * (1 - at) * at * controlY + at * at * endY;
  const labelTangentX = 2 * (1 - at) * (controlX - startX) + 2 * at * (endX - controlX);
  const labelTangentY = 2 * (1 - at) * (controlY - startY) + 2 * at * (endY - controlY);
  const labelTangentLength = Math.hypot(labelTangentX, labelTangentY) || 1;
  const offset = options.labelOffset ?? LABEL_OFFSET;
  const labelX = anchorX + (-labelTangentY / labelTangentLength) * offset * side;
  const labelY = anchorY + (labelTangentX / labelTangentLength) * offset * side;

  return {
    path,
    labelX: round(labelX),
    labelY: round(labelY),
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

/**
 * The proportions of what is actually visible in a picture.
 *
 * A saved avatar is always a square canvas: 填满容器 crops inside it, 完整显示 pads it
 * with transparency. Measuring the file's width and height would call every avatar
 * square and the automatic shape would never leave the circle. This measures the ink
 * instead: the whole picture when it is opaque, the content box when the padding is
 * transparent, so a wide picture kept whole still reads as wide.
 */
export function visibleAspect(image: HTMLImageElement): number {
  const width = image.naturalWidth || 1;
  const height = image.naturalHeight || 1;
  const fileAspect = width / height;
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d", { willReadFrequently: true });

  if (!context) {
    return fileAspect;
  }

  try {
    context.clearRect(0, 0, size, size);
    context.drawImage(image, 0, 0, size, size);
    const { data } = context.getImageData(0, 0, size, size);
    let left = size;
    let right = -1;
    let top = size;
    let bottom = -1;

    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        if (data[(y * size + x) * 4 + 3] > 8) {
          if (x < left) left = x;
          if (x > right) right = x;
          if (y < top) top = y;
          if (y > bottom) bottom = y;
        }
      }
    }

    if (right < left || bottom < top) {
      return fileAspect;
    }

    const contentWidth = right - left + 1;
    const contentHeight = bottom - top + 1;

    if (contentWidth >= size - 1 && contentHeight >= size - 1) {
      return fileAspect;
    }

    return (contentWidth * (width / size)) / (contentHeight * (height / size));
  } catch {
    return fileAspect;
  }
}

/**
 * The proportions of each loaded picture, keyed by character.
 *
 * A picture's shape is only knowable once it has decoded, so this measures off-DOM and
 * reports nothing for a picture that has not arrived — which leaves 自动 on 圆形 until
 * there is evidence, rather than guessing from a file name.
 */
function useAvatarRatios(urls: Record<string, string>) {
  const key = Object.keys(urls)
    .sort()
    .map((id) => `${id}:${urls[id].length}:${urls[id].slice(-24)}`)
    .join("|");
  const [ratios, setRatios] = useState<Record<string, number>>({});

  useEffect(() => {
    const entries = Object.entries(urls);

    if (entries.length === 0) {
      setRatios({});
      return;
    }

    let cancelled = false;

    void Promise.all(
      entries.map(
        ([id, url]) =>
          new Promise<[string, number] | null>((resolve) => {
            const image = new Image();
            image.onload = () =>
              resolve(image.naturalHeight > 0 ? [id, visibleAspect(image)] : null);
            image.onerror = () => resolve(null);
            image.src = url;
          }),
      ),
    ).then((loaded) => {
      if (cancelled) {
        return;
      }
      const next: Record<string, number> = {};
      for (const entry of loaded) {
        if (entry) {
          next[entry[0]] = entry[1];
        }
      }
      setRatios(next);
    });

    return () => {
      cancelled = true;
    };
  }, [key]);

  return ratios;
}

type DragGuides = { x: number | null; y: number | null };

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
  // The canvas is unmounted and mounted again when the page switches between the
  // drawing and the relationship table. A ref object alone cannot say that: the
  // measuring effect below watches this node, so a new element is measured even
  // though nothing about the data changed.
  const [frameNode, setFrameNode] = useState<HTMLDivElement | null>(null);
  const attachFrame = useCallback((node: HTMLDivElement | null) => {
    frameRef.current = node;
    setFrameNode(node);
  }, []);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const prefsLoadedRef = useRef(false);
  // The character the search is pointing at, and the pan requested by the last
  // selection. They are separate because focusing a character who is not on the canvas
  // yet has to wait for the layout to include them.
  const [focusId, setFocusId] = useState<string | null>(null);
  const [pendingFocusId, setPendingFocusId] = useState<string | null>(null);
  // Picking a node is not reading it. Selection says what the next command acts on;
  // focus is the deliberate act of reading one character's connections, and only that
  // one is allowed to recede the rest of the drawing. The two used to be the same
  // state, which is why a plain click faded the whole canvas.
  const [focusLens, setFocusLens] = useState(false);
  const [query, setQuery] = useState("");
  const [notOnCanvas, setNotOnCanvas] = useState<Character | null>(null);
  const [memberFilter, setMemberFilter] = useState<"all" | "canvas" | "off">("all");
  const [memberBatch, setMemberBatch] = useState(false);
  const [memberSelection, setMemberSelection] = useState<string[]>([]);
  // Low-frequency roster commands live behind one labelled menu rather than in the row:
  // on a phone four wrapped buttons turned into a single orphan on its own line.
  const [memberMore, setMemberMore] = useState(false);
  // Output is set once and used rarely, so it lives behind its own toggle: the bar
  // keeps 显示设置 and 导出 at one height instead of five controls in a row.
  const [isExportOpen, setIsExportOpen] = useState(false);
  // The export panel is placed from its trigger's measured rectangle rather than by
  // CSS alone: it used to be an `absolute` panel pinned above its button, which was
  // right when the button sat under the drawing and wrong the moment it moved to the
  // header — there the panel opened 157px above the top of the window.
  const [exportBox, setExportBox] = useState<{ left: number; top: number; maxHeight: number } | null>(null);
  const exportPanelRef = useRef<HTMLDivElement | null>(null);
  // Both bar panels close outside already; Escape closes the one on top, and the
  // last one opened is the one the shared light-layer stack sees first.
  useEscapeDismiss(isExportOpen, () => setIsExportOpen(false));
  const [frameSize, setFrameSize] = useState({ width: 0, height: 0 });
  const holderRef = useRef<HTMLDivElement | null>(null);
  const nodeCardRef = useRef<HTMLDivElement | null>(null);
  const exportWrapRef = useRef<HTMLDivElement | null>(null);
  const searchWrapRef = useRef<HTMLDivElement | null>(null);
  const avatarUrls = useGraphAvatarUrls(characters);
  const avatarRatios = useAvatarRatios(avatarUrls);
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

  // Free placement lives in its own store, keyed by character id: a rename moves
  // nothing, and a deleted character is pruned out rather than ghosted.
  const [layout, setLayout] = useState<CanvasLayout>(() => loadLayout());

  // A proposal is drawn, never written. It is declared here because a layout snapshot
  // carries a roster as well as coordinates: while it is being previewed the canvas has
  // to draw *its* members, not the stored ones, and that derivation sits right below.
  const [preview, setPreview] = useState<ArrangeProposal | null>(null);

  // `undefined` is a canvas that never had an explicit roster: it keeps the old
  // "everything connected" default. An array — even an empty one — is the author's
  // decision and is drawn as-is.
  //
  // A snapshot preview overrides the roster for the same reason it overrides the
  // coordinates: the author is looking at what restoring it would produce. Clearing the
  // preview is the whole of "取消", so the stored roster is never touched until 确认.
  const canvasMembers = useMemo(() => {
    const ids = characters.map((character) => character.id);
    if (preview && preview.members !== undefined) {
      return normalizeMembers(preview.members, ids);
    }
    return normalizeMembers(layout.members, ids);
  }, [layout.members, characters, preview]);

  const visibleCharacters = useMemo(() => {
    if (canvasMembers) {
      const onCanvas = new Set(canvasMembers);
      return characters.filter((character) => onCanvas.has(character.id));
    }

    // No cap. The drawing used to keep only the forty most connected characters and
    // call the rest "out of view", which made a product rule out of a density
    // preference: a character the author put in a relationship was simply not drawn.
    // Every connected character is on the canvas now; the ring gets denser and the
    // labels thin out, which is what the zoom and the search are for.
    const drawn = characters.filter((character) => connectedIds.has(character.id));

    if (focusExtraIds.length === 0) {
      return drawn;
    }

    const present = new Set(drawn.map((character) => character.id));
    const extras = characters.filter(
      (character) => focusExtraIds.includes(character.id) && !present.has(character.id),
    );

    return extras.length ? [...drawn, ...extras] : drawn;
  }, [canvasMembers, characters, connectedIds, relationships, focusExtraIds]);
  // Bumped when a command moves nodes as a whole by more than a drag does (arrange,
  // undo). The drawing box is cached so a drag cannot rescale the canvas under the
  // pointer; a command that re-places everything has to rebuild it, or the new
  // arrangement is drawn outside the cached box and clipped by the viewport.
  const [boxEpoch, setBoxEpoch] = useState(0);
  const [livePositions, setLivePositions] = useState<Record<string, LayoutPoint> | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectMode, setSelectMode] = useState(false);
  const [multiSelectMode, setMultiSelectMode] = useState(false);
  // A hand tool for trackpads without a middle button: while it is on, a drag pans
  // whatever it starts on, including a node. It is a tool, not a mode of the data —
  // turning it off leaves selection and coordinates exactly as they were.
  const [panMode, setPanMode] = useState(false);
  // The tooltip is the only place a shortcut is documented, so it has to name the key
  // the reader's keyboard actually has.
  const modKey = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl";
  // The group whose rectangle the pointer is down on. Selecting on release alone
  // left the border unmarked for the whole drag: `.dragging` is derived from this,
  // not from the member list, so pressing a group shows both states at once.
  const [pressedGroupId, setPressedGroupId] = useState<string | null>(null);
  const [cardCap, setCardCap] = useState<CardLevel>("full");
  // The one large surface that is open. Drawers and full panels are mutually
  // exclusive: 设计, 整理, 角色, 探索 and 分组 all live here, so there is no way to end
  // up with two of them stacked over the drawing.
  const [surface, setSurface] = useState<GraphSurface>("none");
  // On a phone the studio bar keeps four controls and puts its tasks behind one
  // labelled menu; the bar used to let its own buttons scroll out of the viewport.
  const [studioMenuOpen, setStudioMenuOpen] = useState(false);
  const [snapshotName, setSnapshotName] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const studioMenuRef = useRef<HTMLDivElement | null>(null);
  const studioMenuButtonRef = useRef<HTMLButtonElement | null>(null);
  const [studioMenuPos, setStudioMenuPos] = useState<{ top: number; right: number } | null>(null);

  useEffect(() => {
    if (!studioMenuOpen) {
      return;
    }
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (studioMenuRef.current?.contains(target) || studioMenuButtonRef.current?.contains(target)) {
        return;
      }
      setStudioMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        setStudioMenuOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [studioMenuOpen]);

  const [arrangeScope, setArrangeScope] = useState<"visible" | "all">("visible");
  const [groupDraft, setGroupDraft] = useState<{ name: string; editingId: string | null } | null>(null);
  // One step of undo for a whole arrange, which is the only operation that moves
  // every node at once. A drag is undone by dragging back; an arrange is not.
  // Undoing an arrange puts the drawing back where it started, view included: the
  // coordinates alone would be correct and the picture would still be somewhere else.
  const [arrangeUndo, setArrangeUndo] = useState<{
    layout: CanvasLayout;
    view: { k: number; x: number; y: number };
    label: string;
  } | null>(null);
  const [pendingDiscard, setPendingDiscard] = useState(false);
  const [expandedNotes, setExpandedNotes] = useState<string[]>([]);
  // One row's action menu at a time: three text buttons per row was the widest
  // thing in the table and the least used.
  const [manageMenuId, setManageMenuId] = useState<string | null>(null);

  // A floating menu belongs to the page, not to the row: any scroll or resize should
  // put it away rather than leave it pointing at a row that has moved.
  useEffect(() => {
    if (!manageMenuId) {
      return;
    }
    const close = () => setManageMenuId(null);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [manageMenuId]);
  // True when the row's menu has to open upward to stay on screen.
  const [manageMenuPos, setManageMenuPos] = useState<{ top: number; left: number } | null>(null);
  // The small menus: 更多 and 对齐/分布. They are popovers, not surfaces, because they
  // hold one press each and close on the next click anywhere.
  const [isMoreOpen, setIsMoreOpen] = useState(false);
  // Which way the 更多 menu opens. The studio's toolbar sits on the bottom edge, so a
  // menu that always opened downwards would be clipped by the window; the page's
  // toolbar sits at the top, so the same menu has to open down there. Measured on
  // open rather than guessed from the mode.
  const [morePlacement, setMorePlacement] = useState<"up" | "down">("down");
  const moreWrapRef = useRef<HTMLDivElement | null>(null);
  const [isAlignOpen, setIsAlignOpen] = useState(false);
  // Where the 排列 popover sits, in viewport coordinates. Measured from the button that
  // opened it and rendered into <body>: the bar is a horizontal scroller on narrow
  // screens, and an ancestor with `overflow` would clip a panel this tall to 53px.
  const [alignPopoverBox, setAlignPopoverBox] = useState<{ left: number; top: number } | null>(null);
  // The design drawer answers two different questions. One switch, two contexts;
  // never two panels. 外观 from a selection lands on the object, 设计 lands on the canvas.
  const [designScope, setDesignScope] = useState<"canvas" | "object" | "multi">("canvas");
  // Search is a tool, not a permanent field: closed it is one compact control, open it
  // is the field with the results under it. The text survives closing, so reopening it
  // never loses what was typed.
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  // One edge at a time: an edge has no box to marquee and its properties are a
  // different set from a node's, so it is its own selection.
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  // Exploration state. None of it is data: a spotlight, a lens and a bookmark are
  // ways of looking, so they never touch a character or a relationship.
  const [spotlightId, setSpotlightId] = useState<string | null>(null);
  const [spotlightDepth, setSpotlightDepth] = useState<1 | 2>(1);
  const [lensKinds, setLensKinds] = useState<RelationshipKind[]>([]);
  const [bookmarkDraft, setBookmarkDraft] = useState("");
  /**
   * How the export is composed. One control, four answers, and the frame is derived
   * from it — the old panel had a scope and a ratio that could contradict each other.
   */
  const [exportMode, setExportMode] = useState<"content" | "view" | "selection" | "manual">("content");
  // The output frame. Local, not a preference: a visitor trying 16:9 for one poster
  // should not find the next export already framed that way.
  const [exportRatio, setExportRatio] = useState<GraphExportRatio>("canvas");
  // Manual framing. These move a crop, never a coordinate.
  const [exportZoom, setExportZoom] = useState(1);
  const [exportPan, setExportPan] = useState({ x: 0, y: 0 });
  // Output width in pixels; the height follows the frame so nothing is stretched.
  const [exportWidth, setExportWidth] = useState(2400);
  const [exportPreview, setExportPreview] = useState<{
    url: string;
    bounds: WorldBounds;
    content: WorldBounds | null;
    legend: WorldBounds | null;
    width: number;
    height: number;
  } | null>(null);
  const [exportPreviewError, setExportPreviewError] = useState<string | null>(null);
  // A hand-placed legend, in drawing units. Zero means "wherever the corner rule put it".
  const [legendNudge, setLegendNudge] = useState({ x: 0, y: 0 });
  const legendDragRef = useRef<{ x: number; y: number; nudge: { x: number; y: number }; width: number } | null>(null);
  // Set only when the author types a height with the lock off. A preset clears it.
  const [exportCustomAspect, setExportCustomAspect] = useState<number | null>(null);
  const exportDragRef = useRef<{ x: number; y: number; pan: { x: number; y: number }; width: number } | null>(null);
  const [previousView, setPreviousView] = useState<{ k: number; x: number; y: number } | null>(null);
  const undoRef = useRef<CanvasLayout[]>([]);
  // Which slider run the last style write belongs to, so a drag is one undo step.
  const styleRunRef = useRef<{ key: string; at: number }>({ key: "", at: 0 });
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
  // Both drawers and every full panel are views of `surface`; these names are kept
  // because the rendering and the fit compensation read them.
  const isStudioLeftOpen = surface === "characters" || surface === "groups";
  const isStudioRightOpen =
    surface === "design" || surface === "explore" || surface === "arrange" || surface === "export";
  const studioTab: "design" | "explore" = surface === "explore" ? "explore" : "design";
  const isExportSurface = surface === "export";
  // A phone's panel is a sheet over the drawing, and how much of the drawing it
  // covers is a choice: half for a quick adjustment with the canvas still visible,
  // full for long lists and advanced settings.
  const [sheetLevel, setSheetLevel] = useState<"half" | "full">("half");
  const [studioInset, setStudioInset] = useState(0);
  const studioViewRef = useRef<{ k: number; x: number; y: number } | null>(null);
  // The viewpoint the studio opened at. 重置视角 returns to this, which is a defined
  // state — not the same thing as 适应画布, which re-fits whatever is visible now.
  const studioEntryViewRef = useRef<{ k: number; x: number; y: number } | null>(null);
  const rightDrawerRef = useRef<HTMLElement | null>(null);
  // The page's own task drawer (not the studio's). It is a grid column above 1024 and
  // an overlay below it; either way the drawing only has `width - drawerInset` to work
  // with, and the fit has to know that.
  const pageDrawerRef = useRef<HTMLElement | null>(null);
  const [drawerInset, setDrawerInset] = useState(0);
  // The view the drawer opened on. Restoring it on close is only allowed while the
  // reader has not touched the view in between.
  const drawerViewRef = useRef<{
    before: { k: number; x: number; y: number };
    applied: { k: number; x: number; y: number };
  } | null>(null);
  // Whether the current view is the system's fit, which follows the room the drawing
  // has, or a view the author composed by panning and zooming, which nothing may
  // take back. Every user gesture sets this to false; 适应画布 sets it back.
  const viewAutoRef = useRef(true);
  const fitFrameRef = useRef("");
  // Bookmarks are rows, not forms: a name that jumps, and a menu for the two things
  // that change it.
  const [bookmarkMenuId, setBookmarkMenuId] = useState<string | null>(null);
  const [bookmarkEditingId, setBookmarkEditingId] = useState<string | null>(null);
  const [bookmarkNameDraft, setBookmarkNameDraft] = useState("");
  const [bookmarkNotice, setBookmarkNotice] = useState<{
    text: string;
    removed?: CanvasBookmark;
    index?: number;
  } | null>(null);
  // Escape walks down from the top. The dismiss stack closes the layer registered
  // last, so declaration order here *is* the layering: the open surface is the lowest
  // of these, the two small menus sit above it, and a bookmark's own menu above them.
  // One key press therefore never closes a drawer and a popover together.
  useEscapeDismiss(surface !== "none", closeSurface);
  useEffect(() => {
    if (!isMoreOpen) {
      return;
    }
    const rect = moreWrapRef.current?.getBoundingClientRect();
    if (rect) {
      setMorePlacement(window.innerHeight - rect.bottom < 280 ? "up" : "down");
    }
  }, [isMoreOpen]);
  useEscapeDismiss(Boolean(manageMenuId), () => setManageMenuId(null));
  useEscapeDismiss(isMoreOpen, () => setIsMoreOpen(false));

  // Which way 更多 opens, measured from where its trigger actually is: the studio's
  // toolbar sits on the bottom edge, the page's at the top, and the same menu has to
  // serve both without a fixed side.
  useEffect(() => {
    if (!isMoreOpen) {
      return;
    }
    const rect = moreWrapRef.current?.getBoundingClientRect();
    if (rect) {
      setMorePlacement(window.innerHeight - rect.bottom < 280 ? "up" : "down");
    }
  }, [isMoreOpen]);
  useEscapeDismiss(isAlignOpen, () => setIsAlignOpen(false));
  // A popover that outlives its selection is a dead control surface: close it when the
  // selection changes, when it no longer has two objects to arrange, or when the next
  // press lands anywhere outside it.
  useEffect(() => {
    if (!isAlignOpen) {
      return;
    }

    if (selectedIds.length < 2) {
      setIsAlignOpen(false);
      return;
    }

    const dismiss = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('[data-testid="studio-align-popover"], [data-testid="studio-arrange"], .graph-align-panel')) {
        return;
      }
      setIsAlignOpen(false);
    };

    const close = () => setIsAlignOpen(false);
    document.addEventListener("pointerdown", dismiss, true);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("pointerdown", dismiss, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [isAlignOpen, selectedIds.length]);
  useEscapeDismiss(Boolean(bookmarkMenuId), () => setBookmarkMenuId(null));
  useEffect(() => {
    if (!bookmarkNotice) {
      return;
    }
    const timer = window.setTimeout(() => setBookmarkNotice(null), 8000);
    return () => window.clearTimeout(timer);
  }, [bookmarkNotice]);
  // A finished move is reported, not administered: the notice fades, and undo stays
  // available from the toolbar and the history stack afterwards.
  useEffect(() => {
    if (!arrangeUndo) {
      return;
    }
    const timer = window.setTimeout(() => setArrangeUndo(null), ARRANGE_NOTICE_MS);
    return () => window.clearTimeout(timer);
  }, [arrangeUndo]);
  useEffect(() => {
    if (!bookmarkMenuId) {
      return;
    }
    const close = (event: Event) => {
      const target = event.target as Element | null;
      if (target?.closest?.(".graph-bookmark-row")) {
        return;
      }
      setBookmarkMenuId(null);
    };
    document.addEventListener("pointerdown", close, true);
    return () => document.removeEventListener("pointerdown", close, true);
  }, [bookmarkMenuId]);
  useEscapeDismiss(isDirectionHelpOpen, () => setIsDirectionHelpOpen(false));
  // What the dialog opened with, so "has anything been typed" is a fact rather
  // than a guess about which fields count.
  const draftBaselineRef = useRef("");
  // Space is a temporary pan and Escape leaves the selection tool, the way both
  // work in a drawing program. Neither key may steal a keystroke from a text field.
  useEffect(() => {
    const typing = (target: EventTarget | null) => {
      const element = target as HTMLElement | null;

      return Boolean(
        element &&
          (element.tagName === "INPUT" ||
            element.tagName === "TEXTAREA" ||
            element.isContentEditable ||
            // Space activates a focused control. A global shortcut must not take that
            // away from the keyboard, which is the only way some people use the page.
            element.closest("button, a, select, summary, [role='button'], [role='link'], [role='menuitem']")),
      );
    };
    const down = (event: KeyboardEvent) => {
      if (typing(event.target)) {
        return;
      }
      if (event.code === "Space" && svgRef.current) {
        event.preventDefault();
        spaceRef.current = true;
        setSpaceHeld(true);
      }
      // The select tool is the outermost layer, so Escape only leaves it once no
      // drawer, popover or dialog is above it — otherwise one press would close a
      // panel and drop the tool the author is still using.
      const layerAbove =
        surface !== "none" ||
        isMoreOpen ||
        isAlignOpen ||
        isDirectionHelpOpen ||
        Boolean(document.querySelector('[aria-modal="true"]'));

      // A reading focus is a layer too: Escape leaves it before it drops the tool,
      // and it never leaves the author inside a dimmed drawing with no way out.
      if (event.key === "Escape" && focusLens && !layerAbove) {
        setFocusLens(false);
        setFocusId(null);
        returnToOverview();
        return;
      }

      if (event.key === "Escape" && (selectMode || panMode || multiSelectMode) && !layerAbove) {
        marqueeRef.current = null;
        setMarquee(null);
        setSelectMode(false);
        setMultiSelectMode(false);
        setPanMode(false);
      }
    };
    const up = (event: KeyboardEvent) => {
      if (event.code === "Space") {
        spaceRef.current = false;
        setSpaceHeld(false);
      }
    };

    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);

    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [selectMode, panMode, surface, isMoreOpen, isAlignOpen, isDirectionHelpOpen, focusLens]);
  useEscapeDismiss(Boolean(groupDraft), () => setGroupDraft(null));
  useEscapeDismiss(Boolean(preview), () => cancelArrange());
  const style = layout.style ?? DEFAULT_CANVAS_STYLE;
  const metrics = useMemo(() => graphMetrics(prefs), [prefs]);
  // The ring the canvas starts as. It is still what a workspace with no saved layout
  // draws, so an untouched graph looks exactly as it did before free placement.
  const ringPositions = useMemo(
    () =>
      nodePositions(
        visibleCharacters.length,
        metrics.radius * style.node.size,
        // Only cards widen the wheel; a canvas of circles is placed exactly as before.
        visibleCharacters.some((character) => (layout.nodeStyles?.[character.id]?.form ?? style.node.form) === "card")
          ? visibleCharacters.map((character) =>
              (layout.nodeStyles?.[character.id]?.form ?? style.node.form) === "card"
                ? CARD_WIDTH * style.node.size + 24
                : metrics.radius * style.node.size * 2 + NODE_GAP,
            )
          : undefined,
      ),
    [visibleCharacters, layout.nodeStyles, style.node.form, style.node.size, metrics.radius],
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
  const visibleIds = visibleCharacters.map((character) => character.id);
  // A card is wider than any label it would have carried, and the widest card wins:
  // the frame has to contain the drawing, not the names of the round nodes.
  // A rounded picture frame is wider than the circle it replaces, so it adds its own
  // bleed; without it the widest portrait is clipped at the edge of the canvas.
  const avatarHalfBleed = useMemo(
    () =>
      visibleCharacters.reduce((widest, character) => {
        if ((layout.nodeStyles?.[character.id]?.form ?? style.node.form) !== "avatar") {
          return widest;
        }
        const shape = avatarShapeFor(
          layout.nodeStyles?.[character.id]?.avatarShape ?? style.node.avatarShape,
          avatarRatios[character.id],
        );
        if (shape === "circle") {
          return widest;
        }
        const geom = nodeGeometry("avatar", metrics, style.node.size, {
          shape,
          ratio: avatarRatios[character.id],
        });

        return Math.max(widest, geom.halfWidth - metrics.radius * style.node.size);
      }, 0),
    [visibleCharacters, layout.nodeStyles, style.node.form, style.node.avatarShape, style.node.size, metrics, avatarRatios],
  );
  const boxHalfWidth = useMemo(
    () =>
      boxHalfWidthFor(
        visibleCharacters.map(
          (character) => layout.nodeStyles?.[character.id]?.form ?? style.node.form,
        ),
        metrics,
        labelHalfWidth,
        style.node.size,
        avatarHalfBleed,
      ),
    [
      visibleCharacters,
      layout.nodeStyles,
      style.node.form,
      style.node.size,
      metrics,
      labelHalfWidth,
      avatarHalfBleed,
    ],
  );
  const stableBoxRef = useRef<{ key: string; viewBox: string; width: number } | null>(null);
  const canvas = useMemo(() => {
    const boxKey = canvasBoxKey(
      visibleIds,
      boxHalfWidth,
      layout.groups.length > 0,
      preview ? previewBoxKey(preview.positions) : `epoch:${boxEpoch}`,
    );

    if (stableBoxRef.current?.key === boxKey) {
      return stableBoxRef.current;
    }

    // A proposed arrangement is drawn where the proposal puts it, so the box has to be
    // built from those coordinates: a box built from the committed ones left 96 of 100
    // nodes outside the viewport during 预览.
    const box = canvasBox(
      visibleCharacters.map(
        (character, index) =>
          preview?.positions[character.id] ?? layout.positions[character.id] ?? ringPositions[index],
      ),
      metrics,
      boxHalfWidth,
    );
    // A group's border stands GROUP_PADDING off its members. When the widest label
    // reserves less than that, the border falls outside the box and the canvas edge
    // cuts it — which is what made 北境线 look pinned to the left edge. The box grows
    // by the shortfall, so the border is inside the drawing it belongs to.
    const bleed = groupBleed(layout.groups.length > 0, metrics, boxHalfWidth);
    const [boxX, boxY, boxWidth, boxHeight] = box.viewBox.split(" ").map(Number);
    stableBoxRef.current = {
      key: boxKey,
      viewBox: `${round(boxX - bleed.x)} ${round(boxY - bleed.y)} ${round(boxWidth + bleed.x * 2)} ${round(boxHeight + bleed.y * 2)}`,
      width: round(boxWidth + bleed.x * 2),
    };
    return stableBoxRef.current;
  }, [visibleIds, visibleCharacters, layout, ringPositions, metrics, boxHalfWidth, preview, boxEpoch]);
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

  // What each node is drawn as *now*: the author's form, and — for a card — the
  // richest level that fits where it stands. Derived every render, never stored.
  const nodeVisuals = useMemo(() => {
    const size = style.node.size;
    const forms = new Map<string, NodeForm>();

    visibleCharacters.forEach((character) => {
      forms.set(character.id, layout.nodeStyles?.[character.id]?.form ?? style.node.form);
    });

    // Reading one person means reading who they stand next to, so a neighbour of
    // the selected or focused node outranks an unrelated one when the room is not
    // enough for every full card. The order is only about who keeps the richer
    // level — no coordinate is derived from it.
    const anchors = focusId ? [...selectedIds, focusId] : selectedIds;
    const neighboursOfAnchors = neighbourIdsOf(anchors, relationships);

    const cards = visibleCharacters
      .map((character, index) => ({ character, index }))
      .filter(({ character }) => forms.get(character.id) === "card")
      .map(({ character, index }) => ({
        id: character.id,
        x: positions[index].x,
        y: positions[index].y,
        priority: selectedIds.includes(character.id)
          ? 4
          : focusId === character.id
            ? 3
            : neighboursOfAnchors.has(character.id)
              ? 2
              : 1,
      }));

    const fitted = resolveCardLevels(cards, size, {
      compactRadius: metrics.radius * 0.62 * size,
    });
    const rank: Record<CardLevel, number> = { compact: 0, plate: 1, full: 2 };
    const levels: Record<string, CardLevel> = {};

    Object.entries(fitted).forEach(([id, level]) => {
      // The selected person keeps the level their neighbours allow; everyone else is
      // also capped by how much room the current zoom leaves for a card.
      // A card the author set on this one character is a decision, not a preference:
      // crowding may make it a plate, never a circle. Falling all the way to "compact"
      // turned two of three chosen cards back into round nodes on a large canvas,
      // which looked exactly like the batch had only half applied.
      levels[id] = cardLevelFor({
        explicit: layout.nodeStyles?.[id]?.form === "card",
        exempt: selectedIds.includes(id) || focusId === id,
        ceiling: cardCap,
        fitted: level,
      });
    });
    const out: Record<string, { form: NodeForm; level: CardLevel | null; geom: ReturnType<typeof nodeGeometry> }> = {};

    // The author's explicit choice wins; 自动 reads the picture. A picture that has not
    // decoded yet stays circular, which is the shape that was there before this option.
    const shapeOf = (id: string) =>
      avatarShapeFor(
        layout.nodeStyles?.[id]?.avatarShape ?? style.node.avatarShape,
        avatarRatios[id],
      );

    visibleCharacters.forEach((character) => {
      const form = forms.get(character.id) ?? "avatar";
      const level = form === "card" ? (levels[character.id] ?? "full") : null;
      out[character.id] = {
        form,
        level,
        geom:
          form === "card"
            ? cardGeometry(level ?? "full", metrics, size)
            : nodeGeometry(form, metrics, size, {
                shape: form === "avatar" ? shapeOf(character.id) : "circle",
                ratio: avatarRatios[character.id],
              }),
      };
    });

    return out;
  }, [
    visibleCharacters,
    positions,
    layout.nodeStyles,
    style.node.form,
    style.node.size,
    metrics,
    selectedIds,
    relationships,
    focusId,
    cardCap,
    style.node.avatarShape,
    avatarRatios,
  ]);


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
    setSelectedIds((current) => pruneSelection(current, valid));
    setFocusId((current) => (current && !valid.includes(current) ? null : current));
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
      .map((group) => ({
        group,
        rect: groupBounds(
          { ...layout, positions: positionsNow },
          group,
          groupPaddingFor(
            group.characterIds.map(
              (id) => layout.nodeStyles?.[id]?.form ?? style.node.form,
            ),
            style.node.size,
          ),
        ),
      }))
      .filter((entry): entry is { group: CanvasGroup; rect: NonNullable<ReturnType<typeof groupBounds>> } =>
        Boolean(entry.rect),
      );
  }, [layout, livePositions, preview, style.node.form, style.node.size]);

  // Zoom and pan live in the drawing's own coordinates, so the wheel stays on the
  // point under the cursor and the fit view is just k = 1 with no offset.
  const [view, setView] = useState({ k: 1, x: 0, y: 0 });
  // Reading one character: the pick and everyone directly connected to it stay at full
  // weight, the rest of the roster steps back. A way of looking, like the lens — it
  // changes emphasis, never coordinates.
  // Who a single pick is connected to. Used for framing and for keeping the names of
  // the direct relations legible — not for fading the canvas.
  const selectionNeighbourhood = useMemo(() => {
    if (selectedIds.length !== 1) {
      return null;
    }

    const id = selectedIds[0];
    const set = new Set<string>([id]);

    for (const relationship of relationships) {
      if (relationship.fromId === id) {
        set.add(relationship.toId);
      } else if (relationship.toId === id) {
        set.add(relationship.fromId);
      }
    }

    return set;
  }, [selectedIds, relationships]);

  // The one character being read, if the reader asked to read one: a focus from
  // another screen, or the toolbar's 聚焦 on the current pick. Nothing else qualifies.
  const focusedReadId = focusId ?? (focusLens && selectedIds.length === 1 ? selectedIds[0] : null);
  const focusNeighbourhood = useMemo(() => {
    if (!focusedReadId) {
      return null;
    }

    const set = new Set<string>([focusedReadId]);

    for (const relationship of relationships) {
      if (relationship.fromId === focusedReadId) {
        set.add(relationship.toId);
      } else if (relationship.toId === focusedReadId) {
        set.add(relationship.fromId);
      }
    }

    return set;
  }, [focusedReadId, relationships]);

  // A focus that no longer has an object to be about is dropped rather than left to
  // dim the canvas against a stale id.
  useEffect(() => {
    if (focusLens && selectedIds.length !== 1) {
      setFocusLens(false);
    }
  }, [focusLens, selectedIds.length]);

  // Where the drawing was when this single selection started. 返回总览 goes back to
  // it without touching a single node position.
  const [focusOverview, setFocusOverview] = useState<{ k: number; x: number; y: number } | null>(null);
  const selectionCountRef = useRef(0);
  const viewNowRef = useRef(view);
  viewNowRef.current = view;

  useEffect(() => {
    const count = selectedIds.length;
    if (count === 1 && selectionCountRef.current === 0) {
      setFocusOverview(viewNowRef.current);
    }
    selectionCountRef.current = count;
  }, [selectedIds.length]);

  function returnToOverview() {
    if (!focusOverview) {
      return;
    }
    viewAutoRef.current = false;
    setView(focusOverview);
  }

  /**
   * 聚焦 is a mode, not a camera move: it dims the rest of the drawing and it has a
   * way back. Pressing it again (or 返回总览) restores the view without touching a
   * single coordinate. A plain selection never enters this state.
   */
  function toggleReadingFocus() {
    const id = selectedIds.length === 1 ? selectedIds[0] : null;

    if (!id) {
      return;
    }

    if (focusedReadId === id) {
      setFocusLens(false);
      setFocusId(null);
      returnToOverview();
      return;
    }

    if (!focusOverview) {
      setFocusOverview(view);
    }

    setFocusId(null);
    setFocusLens(true);
    fitSelection();
  }
  // The open 整理 transaction. The baseline inside it is captured once and never
  // replaced, so comparing four layouts and then cancelling returns to the drawing the
  // author started from rather than to the third proposal's framing.
  const arrangeSessionRef = useRef<ArrangeSession | null>(null);
  // 确认 is one press: a second press while the commit is running must not commit again.
  const arrangeApplyingRef = useRef(false);


  // Secondary text inside a card appears at 1.0× and disappears at 0.9×: two
  // thresholds, so a viewport parked between them cannot make it flicker.
  const [cardMetaVisible, setCardMetaVisible] = useState(true);
  // How much of a card is worth drawing at this zoom. Two thresholds per step, so a
  // viewport parked on a boundary cannot make cards change shape forever.

  useEffect(() => {
    const wide = visibleCharacters.length <= 40;
    const next = cardMetaVisible
      ? view.k > 0.9 && (wide || view.k > 1.15)
      : view.k > 1.0 && (wide || view.k > 1.2);

    if (next !== cardMetaVisible) {
      setCardMetaVisible(next);
    }
  }, [view.k, visibleCharacters.length, cardMetaVisible]);
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
  const pinchRef = useRef<{ distance: number; centerX: number; centerY: number } | null>(null);
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
  // A press on one member of a multi-selection moves the whole set. It is a
  // different gesture from a group border: a group is a saved fact, a selection is
  // what the reader has picked right now, and they must not share state.
  // Shift axis lock for the current gesture, and the alignment lines it produces.
  // Neither is persisted: both end with the pointer.
  const axisLockRef = useRef<"x" | "y" | null>(null);
  const [dragGuides, setDragGuides] = useState<DragGuides | null>(null);
  // Which axis Shift is holding right now, or null. Separate from the guides: a lock
  // with no neighbour nearby still has to say so, and it must stop saying so the
  // instant the key or the gesture ends.
  const [shiftAxis, setShiftAxis] = useState<"x" | "y" | null>(null);

  const setDragRef = useRef<{
    pointerId: number;
    start: LayoutPoint;
    last: LayoutPoint;
    grab: LayoutPoint;
    id: string;
    members: string[];
    base: CanvasLayout;
    moved: boolean;
  } | null>(null);
  const marqueeRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    additive: boolean;
    moved: boolean;
  } | null>(null);
  const [marquee, setMarquee] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  // Which nodes the rectangle currently covers. The selection is only applied on
  // release, but the drawing has to answer while the rectangle is still moving:
  // candidates stay lit and everything else recedes, so the box reads as a live
  // statement rather than a guess the author only sees after letting go.
  const [marqueeCandidates, setMarqueeCandidates] = useState<string[] | null>(null);
  // Space is the pans-anyway key, the way it is in every drawing tool. Held state is
  // mirrored into a ref because the pointer handler must read it without a re-render.
  const spaceRef = useRef(false);
  const [spaceHeld, setSpaceHeld] = useState(false);

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

  // Which mode owns the drawing. Nodes and edges read this one value instead of each
  // deciding for itself, which is how a focused canvas could end up with dimmed nodes
  // and fully lit edges. The order is the priority the author sees:
  //   arrange preview  — a proposal being judged outranks every looking-tool
  //   explicit focus   — the reader asked to read one character
  //   explore lens     — a kind filter
  //   multi-select     — the picking tool
  //   selection        — an outline only, never a fade
  //   default          — nothing recedes
  // Only the mode that owns it fades anything, so "who is lit" and "who is faded" can
  // never come from two different answers.
  const dimOwner: "preview" | "focus" | "lens" | "multi" | "none" = preview
    ? "preview"
    : focusNeighbourhood
      ? "focus"
      : lensActive
        ? "lens"
        : multiSelectMode && selectedIds.length > 0
          ? "multi"
          : "none";
  // Which nodes the lens keeps bright: those with at least one relationship of an
  // included kind. A lens changes ink, never the data — an excluded kind is still
  // stored, still exported when the lens is cleared, and still listed in 管理.
  const lensNodeIds = useMemo(() => {
    const ids = new Set<string>();
    if (lensKinds.length === 0) {
      return ids;
    }
    for (const relationship of relationships) {
      if (lensKinds.includes(relationship.kind)) {
        ids.add(relationship.fromId);
        ids.add(relationship.toId);
      }
    }
    return ids;
  }, [lensKinds, relationships]);
  const presentKinds = useMemo(
    () => [...new Set(relationships.map((relationship) => relationship.kind))],
    [relationships],
  );

  // Unmeasured is not the same as scale 1: while the frame's size is unknown a label's
  // rendered size is unknown too, and guessing generously is how a hundred-character
  // wheel ends up with a smear of 3px names.
  const measured = frameSize.width > 0 && frameSize.height > 0;
  const screenScale = measured ? canvasScreenScale(frameSize, canvas.viewBox) : 0;
  // The percentage a reader understands is how large the drawing looks, not the
  // number inside the transform. The same 90% draws at 60% on a narrow canvas because
  // the view box is fitted into fewer pixels, so the readout multiplies by that fit.
  const effectiveZoom = view.k * (measured ? screenScale : 1);

  // The world-space middle of the drawing (a ring's centre) and the world-space box the
  // labels have to stay inside. Both are derived from the same values the SVG is drawn
  // with: a world point maps to the screen as `p * view.k * screenScale + view.x|y`.
  const nameCentre = useMemo(() => {
    if (!positions.length) {
      return { x: 0, y: 0 };
    }

    const total = positions.reduce((sum, point) => ({ x: sum.x + point.x, y: sum.y + point.y }), {
      x: 0,
      y: 0,
    });

    return { x: total.x / positions.length, y: total.y / positions.length };
  }, [positions]);
  // The right edge of the drawing, in world units. The canvas fits the ring with a
  // margin, so a label that runs past this has left the visible area; measuring against
  // it avoids depending on the view translate, which did not match getScreenCTM().
  const cloudMaxX = useMemo(
    () => (positions.length ? Math.max(...positions.map((point) => point.x)) : 0),
    [positions],
  );
  const cloudMinX = useMemo(
    () => (positions.length ? Math.min(...positions.map((point) => point.x)) : 0),
    [positions],
  );
  const nameBounds = useMemo(() => {
    const scale = Math.max(view.k * (measured ? screenScale : 1), 0.0001);

    return {
      x0: -view.x / scale,
      y0: -view.y / scale,
      x1: (frameSize.width - view.x) / scale,
      y1: (frameSize.height - view.y) / scale,
    };
  }, [view.k, view.x, view.y, screenScale, measured, frameSize.width, frameSize.height]);


  // The grid is a reference plane, not a second drawing: its spacing is solved for a
  // constant on-screen step so a zoomed-out hundred-node wheel is not a coarse
  // checkerboard and a close-up is not a field of dots. Clamped, because a pattern
  // smaller than the stroke would disappear and a huge one would stop reading as paper.
  const gridScale = Math.max(view.k * (screenScale > 0 ? screenScale : 1), 0.001);
  // The lines are solved for a constant on-screen step, but they stay tied to the
  // author's spacing by a power of two: every line is either a snap point or a
  // subdivision of one. Solving the step freely (40 / 1.5 = 26.67) drew a grid the
  // snap could never land on, which reads as "snapping is broken" rather than as
  // "the paper is a reference".
  const wantedGridStep = style.canvas.gridSize / gridScale;
  const gridRatio = Math.max(-2, Math.min(2, Math.round(Math.log2(wantedGridStep / style.canvas.gridSize))));
  const gridStep =
    style.canvas.grid === "none" ? style.canvas.gridSize : style.canvas.gridSize * 2 ** gridRatio;
  const gridDotRadius = Math.min(2.4, Math.max(0.8, 1.05 / gridScale));
  // Distance is calmer than proximity: a far view keeps the paper but stops competing
  // with the structure. Two ends, no oscillation, because this is a paint value.
  const gridFade = 0.55 + 0.45 * Math.min(1, Math.max(0, (gridScale - 0.25) / 0.75));

  useEffect(() => {
    const scale = screenScale > 0 ? screenScale : 1;
    const cardPx = CARD_WIDTH * style.node.size * view.k * scale;
    const fullLimit = cardCap === "full" ? 150 : 168;
    const plateLimit = cardCap === "compact" ? 86 : 76;
    const next: CardLevel = cardPx >= fullLimit ? "full" : cardPx >= plateLimit ? "plate" : "compact";

    if (next !== cardCap) {
      setCardCap(next);
    }
  }, [view.k, screenScale, style.node.size, cardCap]);
  const readability = labelReadability({
    positions,
    nameSize,
    zoom: view.k,
    scale: screenScale,
  });
  const [labelsFit, setLabelsFit] = useState(true);

  useEffect(() => {
    const next = labelsFitAfter(labelsFit, readability);

    if (next !== labelsFit) {
      setLabelsFit(next);
    }
  }, [labelsFit, readability]);

  // A name has to be readable to be drawn. The density rules decide *which* names, but at
  // a 0.35x fit every one of them is four screen pixels tall - paint that and the drawing
  // claims to be labelled while showing a grey texture. The floor is on rendered size,
  // with two thresholds so a wheel parked on the boundary cannot flicker.
  const nameScreenPx = nameSize * view.k * (measured ? screenScale : 1);
  const [nameFloorOk, setNameFloorOk] = useState(true);

  useEffect(() => {
    const next = nameFloorOk ? nameScreenPx >= 5.5 : nameScreenPx >= 6.5;

    if (next !== nameFloorOk) {
      setNameFloorOk(next);
    }
  }, [nameScreenPx, nameFloorOk]);

  // An export is the fitted graph with every name on it, not whatever corner the
  // canvas happens to be zoomed into. The author's own switch still wins: names turned
  // off are off in the picture too.
  // On a phone the drawn area is small enough that "every name fits" is the wrong
  // test: a handful of nodes at reading scale have room for their names even when a
  // hundred would not. Above that, the density rules below still apply.
  const compactViewport = frameSize.width > 0 && frameSize.width <= 720;
  // One rule decides how many names the drawing carries; the render asks it per node.
  const density = labelDensity({
    showNames: prefs.showNames,
    forceNames: prefs.forceNames,
    exporting,
    labelsFit,
    compact: compactViewport,
    visibleCount: visibleCharacters.length,
  });
  const showLabels = density === "all";

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

    // Busiest first, then only those with room: a ring's hubs are neighbours, and ten
    // names in the same 60 units overlap into a smear.
    const ranked = [...degree.entries()]
      .sort((left, right) => right[1] - left[1])
      .slice(0, 12)
      .flatMap(([id, weight]) => {
        const index = visibleCharacters.findIndex((character) => character.id === id);
        const point = index >= 0 ? positions[index] : null;
        return point ? [{ id, x: point.x, y: point.y, weight }] : [];
      });

    // Distances are world units, so the threshold has to be the on-screen gap divided
    // by the scale the drawing is rendered at — otherwise a hundred-node ring, drawn at
    // 0.4×, stacks names that were 52 units apart into 20 pixels.
    const screenGap = Math.max(58, nameSize * 5);
    const minDistance = screenScale > 0 ? screenGap / screenScale : Math.max(52, nameSize * 4.2);

    return new Set(pickSpacedLabels(ranked, minDistance).map((item) => item.id));
  }, [visibleCharacters, relationships, positions, nameSize, screenScale]);

  // The canvas only exists once there is something to draw, so this has to re-run when
  // it appears; measuring nothing on mount and never measuring again would leave the
  // rendered-size rule permanently unmeasured.
  const hasCanvas = characters.length >= 2 && relationships.length > 0;

  useEffect(() => {
    if (!frameNode) {
      return;
    }

    const measure = () => {
      const rect = frameNode.getBoundingClientRect();
      setFrameSize({ width: rect.width, height: rect.height });
    };

    measure();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }

    const observer = new ResizeObserver(measure);
    observer.observe(frameNode);
    return () => observer.disconnect();
  }, [frameNode]);

  /**
   * Entering the studio is measured here rather than read from `frameSize`.
   *
   * The state still holds the page's canvas size for the render in which the studio
   * is first committed — the ResizeObserver has not run yet — so the old code fitted
   * the drawing to the *page* and then refused to fit again, which is why the studio
   * sometimes opened showing a crop of it. A layout effect runs after the studio's
   * DOM exists and before it is painted, so the rectangle it reads is the studio's.
   */
  useLayoutEffect(() => {
    if (!isStudio) {
      return;
    }

    const frame = frameRef.current;

    if (!frame) {
      return;
    }

    const rect = frame.getBoundingClientRect();

    if (rect.width < 1 || rect.height < 1) {
      return;
    }

    viewAutoRef.current = true;
    fitFrameRef.current = frameKey(rect.width, rect.height, studioInset);
    const opened = applyFitView({ width: rect.width, height: rect.height }, { remember: false });
    studioEntryViewRef.current = opened ?? null;
    // Only on entry: re-fitting whenever the studio state object changed would take
    // the view back from the author.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isStudio]);

  // The room the drawing has changes for reasons the author did not choose: the studio
  // replacing the page, a drawer taking its column, a phone rotating. While the view is
  // still the system's fit it follows that room; once the author has panned or zoomed
  // it is theirs and is left alone.
  useEffect(() => {
    if (screenScale <= 0 || positions.length === 0) {
      return;
    }

    const key = frameKey(frameSize.width, frameSize.height, studioInset);

    if (fitFrameRef.current === key) {
      return;
    }

    if (!viewAutoRef.current) {
      return;
    }

    if (applyFitView(undefined, { remember: false })) {
      fitFrameRef.current = key;
    }
  }, [frameSize, studioInset, screenScale, positions]);

  // Leaving the studio puts back the view the page had. A view change only: no
  // coordinate is written, so a position cannot be lost by entering or leaving.
  useEffect(() => {
    if (isStudio || !studioViewRef.current) {
      return;
    }

    const saved = studioViewRef.current;
    studioViewRef.current = null;
    viewAutoRef.current = false;
    setView(saved);
  }, [isStudio]);

  // How much of the drawing a phone's sheet actually covers. Only a sheet overlays
  // the canvas; a drawer that takes its own column leaves the frame untouched.
  useEffect(() => {
    if (!isStudio || !isStudioRightOpen) {
      setStudioInset(0);
      return;
    }

    const sheet = rightDrawerRef.current;
    const frame = frameRef.current;

    if (!sheet || !frame) {
      setStudioInset(0);
      return;
    }

    const measure = () => {
      if (getComputedStyle(sheet).position !== "fixed") {
        setStudioInset(0);
        return;
      }

      const covered = frame.getBoundingClientRect().bottom - sheet.getBoundingClientRect().top;
      setStudioInset(Math.max(0, Math.round(covered)));
    };

    measure();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }

    const observer = new ResizeObserver(measure);
    observer.observe(sheet);
    return () => observer.disconnect();
  }, [isStudio, isStudioRightOpen, sheetLevel, studioTab]);

  // A phone used to open zoomed in far enough to read the names, which on a large
  // roster meant 298% of the middle of the wheel: edges crossing an empty screen. The
  // opening view is the fit — the whole drawing — and 适应画布 gives it back at any time.

  function zoomBy(factor: number) {
    viewAutoRef.current = false;
    setView((current) => ({ ...current, k: clampZoom(current.k * factor) }));
  }

  /**
   * 适配画布 in both senses: the box the drawing was given, and the zoom that makes the
   * drawing use it. The box's centre is the drawing's centre — `canvasBox` grows the box
   * around it — so centring on the box keeps the graph where it was.
   */
  function applyFitView(
    frameOverride?: { width: number; height: number },
    options: { remember?: boolean; insetBottom?: number } = {},
  ) {
    const frame = frameOverride ?? frameSize;

    if (frame.width <= 0 || frame.height <= 0) {
      return null;
    }

    const inset = Math.max(0, options.insetBottom ?? (isStudio ? studioInset : 0));
    // A page drawer is an overlay below 1024, so part of the frame is covered rather
    // than taken out of the layout. Fitting into the full width there would put the
    // outer nodes under the panel.
    const insetRight = isStudio ? 0 : drawerInset;
    // A sheet that covers nearly all of the canvas leaves no room to frame anything
    // in: the view is left where it was rather than squeezed into a letterbox.
    const room = { width: frame.width - insetRight, height: frame.height - inset };

    if (room.height < 160 || room.width < 160) {
      return null;
    }

    // `screenScale` is the element's own mapping, which `meet` derives from its full
    // size; the fit is against the part of it that can be seen.
    const scale = canvasScreenScale(frame, canvas.viewBox);

    if (scale <= 0) {
      return null;
    }

    if (options.remember !== false) {
      setPreviousView(view);
    }

    const [boxX, boxY, boxWidth, boxHeight] = canvas.viewBox.split(" ").map(Number);
    const zoom = capAutoZoom(
      fitZoom(contentBounds(positions, metrics, boxHalfWidth), room, scale),
      scale,
      AUTO_FIT_MAX_ZOOM,
    );
    // Whatever a sheet covers, the drawing is fitted into what is left of the canvas
    // and centred there — derived from the covered height, not nudged by a constant.
    const lift = inset / 2 / Math.max(zoom * scale, 0.0001);

    const next = centreOn(
      { x: boxX + boxWidth / 2, y: boxY + boxHeight / 2 + lift },
      zoom,
      canvas.viewBox,
    );
    // Centre inside what can be seen, not inside the frame: half the covered width,
    // expressed in viewBox units (one unit is `scale` pixels).
    if (insetRight > 0) {
      next.x -= insetRight / 2 / scale;
    }
    setView(next);
    return next;
  }

  /** What the 适配画布 control and the export both mean by "fit". */
  function resetView() {
    viewAutoRef.current = true;
    applyFitView();
  }

  // How much of the canvas the page drawer covers. Zero above 1024 (the drawer is a
  // grid column, so the frame already ends where the panel begins) and the panel's
  // width below it (the panel is an overlay there).
  useEffect(() => {
    if (isStudio || surface === "none") {
      setDrawerInset(0);
      return;
    }

    const frame = frameRef.current;
    const drawer = pageDrawerRef.current;

    if (!frame || !drawer) {
      setDrawerInset(0);
      return;
    }

    const measure = () => {
      const f = frame.getBoundingClientRect();
      const d = drawer.getBoundingClientRect();
      const covered = Math.min(f.right, d.right) - Math.max(f.left, d.left);
      setDrawerInset(Math.max(0, Math.round(covered)));
    };

    measure();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }

    const observer = new ResizeObserver(measure);
    observer.observe(frame);
    observer.observe(drawer);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [isStudio, surface]);

  /**
   * Opening the drawer must not move a single node, but it can hide the one being
   * read. This pans the view by the few pixels needed to bring that node back inside
   * the visible strip — nothing else, and only once per opening.
   *
   * Closing restores the view it opened on, but only while the view is still the one
   * this effect produced: a reader who panned in the meantime keeps their view.
   */
  useEffect(() => {
    if (isStudio) {
      return;
    }

    const same = (a: { k: number; x: number; y: number }, b: { k: number; x: number; y: number }) =>
      Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5 && Math.abs(a.k - b.k) < 0.001;

    if (surface === "none") {
      const remembered = drawerViewRef.current;
      drawerViewRef.current = null;

      if (!remembered) {
        return;
      }

      // Restore unless the reader took the view over while the panel was open: a view
      // they composed themselves is theirs, and 适应画布 (which also lands here) was
      // composed for a strip that no longer exists.
      const keptByReader = !viewAutoRef.current && !same(view, remembered.applied);

      if (!keptByReader) {
        viewAutoRef.current = false;
        setView(remembered.before);
      }
      return;
    }

    // Opened. Remember where the drawing was even if nothing has to move, so closing
    // can put it back.
    if (!drawerViewRef.current) {
      drawerViewRef.current = { before: view, applied: view };
    }

    if (drawerInset <= 0) {
      return;
    }

    // The inset arrives one render after the panel does, so this effect runs twice on
    // opening. Compensate once: only while nothing has been applied yet.
    if (!same(drawerViewRef.current.applied, drawerViewRef.current.before)) {
      return;
    }

    const frame = frameRef.current;
    const rect = frame?.getBoundingClientRect();
    const targetId = selectedIds.length === 1 ? selectedIds[0] : focusId;
    const targetIndex = targetId ? visibleCharacters.findIndex((c) => c.id === targetId) : -1;
    const point = targetIndex >= 0 ? positions[targetIndex] : null;

    if (!frame || !rect || !point || frameSize.width <= 0) {
      return;
    }

    const scale = canvasScreenScale(frameSize, canvas.viewBox);
    if (scale <= 0) {
      return;
    }

    const screen = projectToScreen(point, view, canvas.viewBox, rect);
    const pad = 56;
    const left = rect.left + pad;
    const right = rect.right - drawerInset - pad;
    const dx = screen.x > right ? right - screen.x : screen.x < left ? left - screen.x : 0;

    if (Math.abs(dx) < 1) {
      return;
    }

    const applied = { ...view, x: view.x + dx / scale };
    drawerViewRef.current = { before: view, applied };
    viewAutoRef.current = false;
    setView(applied);
  }, [surface, drawerInset, isStudio, view, selectedIds, focusId, positions, frameSize]);

  /**
   * 重置视角 returns to the observation this surface started from: the studio's
   * opening view inside the studio, the page's own fit outside it. Deliberately not
   * the same as 适应画布, which answers "what is visible now" instead of "where I began".
   */
  function resetToDefaultView() {
    setFocusId(null);
    setSelectedIds([]);
    viewAutoRef.current = true;

    if (isStudio && studioEntryViewRef.current) {
      setView(studioEntryViewRef.current);
      return;
    }

    applyFitView();
  }

  /** Frame just the selected nodes, with the same margin the full fit uses. */
  function fitSelection() {
    // Reading one character is reading their direct relations too: framing a single
    // node zooms to it and leaves the names that answer "who is this to them" out of
    // the picture.
    const targetIds =
      selectedIds.length === 1 && selectionNeighbourhood
        ? visibleCharacters.filter((character) => selectionNeighbourhood.has(character.id)).map((character) => character.id)
        : selectedIds;
    const chosen = visibleCharacters
      .filter((character) => targetIds.includes(character.id))
      .map((character) => layout.positions[character.id] ?? ringPositions[visibleCharacters.indexOf(character)]);
    if (!chosen.length) {
      return;
    }
    const [boxX, boxY, boxWidth, boxHeight] = canvas.viewBox.split(" ").map(Number);
    // The zoom frames the whole reading unit; the *centre* is the character being read.
    // Centring on the unit's centroid put the selected node at the edge of, or outside,
    // the frame once the reader zoomed in — the drawing ended up as lines crossing an
    // empty screen with the person it was about nowhere in sight.
    const selectedPoint =
      selectedIds.length === 1
        ? layout.positions[selectedIds[0]] ?? ringPositions[visibleCharacters.findIndex((c) => c.id === selectedIds[0])]
        : null;
    const center = selectedPoint ?? centroid(chosen, { x: boxX + boxWidth / 2, y: boxY + boxHeight / 2 });
    // Focusing is a statement about emphasis, not a request to zoom. It used to fit
    // the reading unit and then push the zoom up to make the name legible, which on a
    // twelve-node canvas landed at 131% and cut the lower half of the drawing out of
    // the frame. The camera now keeps the zoom the reader already had and only moves
    // — and, when the unit genuinely does not fit at that zoom, steps back just far
    // enough to include it. It never magnifies.
    const unitFit = fitZoom(
      contentBounds(chosen, metrics, labelHalfWidth),
      frameSize,
      screenScale,
    );
    const zoom = clampZoom(Math.min(view.k, unitFit));
    viewAutoRef.current = false;
    setPreviousView(view);
    setView(centreOn(center, zoom, canvas.viewBox));
  }

  // Entering the studio makes the canvas much larger, so the drawing is re-fitted
  // once for the room it now has. The view that was there is put back on the way
  // out: changing the chrome must not change where the author was looking.
  /**
   * The one door every permanent panel goes through, wherever it was pressed: the
   * page toolbar, the studio's top bar, or the phone's dock. There is exactly one open
   * surface, so opening a task cannot leave another one underneath it.
   */
  function openGraphSurface(next: SurfaceRequest) {
    const target = toggleSurface(surface, next);
    // Leaving 整理 — by closing it, by pressing 设计, by entering the studio — discards
    // an unconfirmed proposal first. Otherwise the drawing would keep showing
    // coordinates no open panel is asking about, and the next edit would be made
    // against a picture that is not the stored one.
    if (target !== "arrange") {
      rollbackArrange();
    }
    setIsAlignOpen(false);
    // Opening 设计 no longer jumps to the picked object: having something selected
    // is not the same as editing it, and a top-bar button must not throw away the
    // tab the author chose last. The first entry, and any entry with nothing
    // selected, starts on 整体画布 because `designScope` starts as "canvas".
    setSurface(target);
    setIsMoreOpen(false);
  }

  /** The one way a surface closes, so no path can leave a proposal behind. */
  function closeSurface() {
    rollbackArrange();
    setSurface("none");
  }

  function enterStudio() {
    rollbackArrange();
    studioViewRef.current = view;
    setSheetLevel("half");
    setIsStudio(true);
    setSurface("none");
  }

  function exitStudio() {
    rollbackArrange();
    setIsStudio(false);
    setSurface("none");
  }

  function restoreView() {
    if (!previousView) {
      return;
    }
    const restored = previousView;
    setPreviousView(view);
    setView(restored);
  }

  /**
   * The drawn box of every selected node, in drawing units.
   *
   * This is what alignment has to see: a card is 84 units wide from its centre, a
   * circle 20, and a plate 56. Reading only the stored points would line up the
   * centres of three different shapes and call the ragged result "aligned".
   */
  function selectionBoxes(): AlignBox[] {
    return selectedIds.flatMap((id) => {
      // The drawn point, not the stored one: a canvas that has never been dragged
      // has no saved coordinates at all, and reading only the store is why "左对齐"
      // could sit there doing nothing on a fresh workspace.
      const index = visibleCharacters.findIndex((character) => character.id === id);
      const point = positions[index] ?? layoutRef.current.positions[id];
      const geom = nodeVisuals[id]?.geom;

      if (!point) {
        return [];
      }

      return [{
        id,
        x: point.x,
        y: point.y,
        halfWidth: geom?.halfWidth ?? metrics.radius,
        halfHeight: geom?.halfHeight ?? metrics.radius,
      }];
    });
  }

  function writeAxis(boxes: AlignBox[], values: Record<string, number>, axis: AlignAxis) {
    const base = workingLayout();
    const positions = { ...base.positions };

    // Writing the axis alone would leave `{ x }` for a node that had no stored point
    // yet, dropping its y. Both coordinates are written from the box that was measured.
    boxes.forEach((box) => {
      const value = values[box.id];

      if (value === undefined) {
        return;
      }

      positions[box.id] = {
        x: axis === "x" ? Math.round(value * 100) / 100 : box.x,
        y: axis === "y" ? Math.round(value * 100) / 100 : box.y,
      };
    });
    commitLayout({ ...base, positions });
  }

  function alignSelection(axis: AlignAxis, mode: AlignMode) {
    const boxes = selectionBoxes();
    const values = alignPositions(boxes, axis, mode);

    if (values) {
      writeAxis(boxes, values, axis);
    }
  }

  function distributeSelection(axis: AlignAxis) {
    const boxes = selectionBoxes();
    // Equal gaps where there is room for them; when the boxes already fill the
    // span, equal centre spacing is the only honest reading of "distribute".
    const values = distributePositions(boxes, axis) ?? spreadPositions(boxes, axis);

    if (values) {
      writeAxis(boxes, values, axis);
    }
  }

  /**
   * The only path that writes coordinates. One gesture, one write.
   *
   * A range slider fires on every pixel of the drag. Writing one undo entry per
   * event would turn a single decision ("make the nodes a bit bigger") into thirty
   * steps, so the caller can name the run it belongs to: consecutive writes with the
   * same key inside a short window keep the snapshot taken before the first one.
   */
  function commitLayout(next: CanvasLayout, coalesceKey?: string) {
    if (JSON.stringify(next) !== JSON.stringify(layoutRef.current)) {
      const now = Date.now();
      const run = styleRunRef.current;
      const continues = Boolean(coalesceKey) && run.key === coalesceKey && now - run.at < 900;

      if (!continues) {
        undoRef.current = [...undoRef.current.slice(-39), layoutRef.current];
        redoRef.current = [];
      }

      styleRunRef.current = coalesceKey ? { key: coalesceKey, at: now } : { key: "", at: 0 };
    }
    setLayout(next);
    saveLayout(next);
    setHistoryVersion((version) => version + 1);
  }

  /** Style edits are layout edits: same store, same undo history, same backup. */
  function patchStyle(next: CanvasStyle, coalesceKey?: string) {
    commitLayout({ ...workingLayout(), style: next }, coalesceKey);
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

  /** A bookmark is a viewpoint: returning to it is the author's own move. */
  function jumpToBookmark(bookmark: CanvasBookmark) {
    viewAutoRef.current = false;
    setBookmarkMenuId(null);
    setView(bookmark.view);
  }

  /**
   * Deleting a saved view is the one bookmark action that destroys something, so it
   * says what it did and keeps the entry for one press of 撤销. The store is written
   * once, exactly as a save is.
   */
  function removeBookmark(bookmark: CanvasBookmark) {
    const list = layoutRef.current.bookmarks ?? [];
    const index = list.findIndex((entry) => entry.id === bookmark.id);
    writeBookmarks(list.filter((entry) => entry.id !== bookmark.id));
    setBookmarkMenuId(null);
    setBookmarkNotice({ text: `已删除「${bookmark.name}」`, removed: bookmark, index });
  }

  function undoRemoveBookmark() {
    const removed = bookmarkNotice?.removed;

    if (!removed) {
      return;
    }

    const list = [...(layoutRef.current.bookmarks ?? [])];
    const at = Math.min(Math.max(bookmarkNotice?.index ?? list.length, 0), list.length);
    list.splice(at, 0, removed);
    writeBookmarks(list);
    setBookmarkNotice(null);
  }

  function renameBookmark(id: string, name: string) {
    const trimmed = name.trim().slice(0, 40);

    if (!trimmed) {
      return;
    }

    writeBookmarks(
      (layoutRef.current.bookmarks ?? []).map((entry) =>
        entry.id === id ? { ...entry, name: trimmed } : entry,
      ),
    );
    setBookmarkEditingId(null);
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
      // A dialog owns the keyboard while it is open.
      if (target?.closest(".confirm-dialog, .modal-backdrop")) {
        return;
      }
      const key = event.key.toLowerCase();
      // Single-key tools, the way a drawing app binds them. They never run while a
      // modifier is held, so they cannot shadow the browser's own shortcuts.
      if (!event.metaKey && !event.ctrlKey && !event.altKey) {
        if (key === "v") {
          event.preventDefault();
          setPanMode(false);
          setSelectMode(true);
        } else if (key === "h") {
          event.preventDefault();
          setSelectMode(false);
          setPanMode(true);
        } else if (key === "0") {
          event.preventDefault();
          resetView();
        }
        return;
      }
      if (!(event.metaKey || event.ctrlKey)) {
        return;
      }
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
  }, [layout, resetView]);

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
    return mode === "snapshot"
      ? "恢复布局"
      : mode === "ring"
      ? "环形布局"
      : mode === "grid"
        ? "网格布局"
        : mode === "hierarchy"
          ? "层级布局"
          : mode === "groups"
            ? "按分组整理"
            : mode === "spaced"
              ? "按尺寸排开"
              : "关系聚类";
  }

  /**
   * The cell a node needs when it is laid out at its own size: a card is 168 × 56, a
   * round node is a circle, and a mixed set follows the widest of them.
   */
  function spreadCell() {
    const size = style.node.size;
    const used = visibleCharacters.map(
      (character) => layout.nodeStyles?.[character.id]?.form ?? style.node.form,
    );
    const wide = used.includes("card");

    return {
      width: (wide ? CARD_WIDTH : metrics.radius * 2) * size,
      height: (wide ? CARD_HEIGHT : metrics.radius * 2 + metrics.nameDrop + 8) * size,
    };
  }

  /**
   * Frames a proposal the way 适应画布 frames the drawing.
   *
   * The drawer stays open while previewing, so the canvas is narrower than it was when
   * the author was last looking at it; without this the proposal would be drawn past
   * the right edge and look like the drawing had been lost. It moves the view only —
   * the coordinates are still the stored ones until 确认.
   */
  function frameProposal(positionsById: Record<string, LayoutPoint>) {
    if (frameSize.width <= 0 || frameSize.height <= 0) {
      return;
    }

    const points = visibleCharacters.map(
      (character, index) => positionsById[character.id] ?? basePositions[index],
    );

    if (points.length === 0) {
      return;
    }

    const box = canvasBox(points, metrics, boxHalfWidth);
    const bleed = groupBleed(layout.groups.length > 0, metrics, boxHalfWidth);
    const [boxX, boxY, boxWidth, boxHeight] = box.viewBox.split(" ").map(Number);
    const viewBox = `${round(boxX - bleed.x)} ${round(boxY - bleed.y)} ${round(boxWidth + bleed.x * 2)} ${round(
      boxHeight + bleed.y * 2,
    )}`;
    const scale = canvasScreenScale(frameSize, viewBox);
    const zoom = capAutoZoom(
      fitZoom(contentBounds(points, metrics, boxHalfWidth), frameSize, scale),
      scale,
      AUTO_FIT_MAX_ZOOM,
    );

    viewAutoRef.current = false;
    setView(centreOn({ x: boxX + boxWidth / 2, y: boxY + boxHeight / 2 }, zoom, viewBox));
  }

  /**
   * A layout proposal. Never a write: the drawing shows the proposal, the coordinates in
   * storage stay where they were, and 取消 or any other task puts the original back.
   *
   * Every proposal is computed from the session's baseline, not from the previous
   * proposal, so consecutive switches compare alternatives rather than compounding.
   */
  // A card is about three times wider than a circle. Handing its width to the ring
  // keeps three adjacent cards from landing on top of each other, and leaves every
  // circle on exactly the spacing it had before.
  const ringWidths = (ids: string[]): Record<string, number> | undefined => {
    const widths: Record<string, number> = {};
    let anyCard = false;

    ids.forEach((id) => {
      const form = layout.nodeStyles?.[id]?.form ?? style.node.form;
      if (form === "card") {
        anyCard = true;
        widths[id] = CARD_WIDTH * style.node.size + 24;
      }
    });

    return anyCard ? widths : undefined;
  };

  function proposeArrange(mode: ArrangeMode) {
    const baseline = arrangeSessionRef.current?.baseline ?? {
      layout: workingLayout(),
      view,
      selectedIds: [...selectedIds],
    };
    const base = baseline.layout;
    const ids =
      arrangeScope === "visible"
        ? visibleCharacters.map((character) => character.id)
        : characters.map((character) => character.id);
    const points = ids
      .map((id) => base.positions[id])
      .filter((point): point is LayoutPoint => Boolean(point));
    const center = centroid(points, { x: VIEW / 2, y: VIEW / 2 });
    const positions =
      mode === "ring"
        ? ringLayout(ids, center, metrics.radius, 240, ringWidths(ids))
        : mode === "grid"
          ? gridLayout(ids, center, metrics.radius)
          : mode === "hierarchy"
            ? hierarchyLayout(ids, relationships, center, metrics.radius, selectedIds.find((id) => ids.includes(id)))
            : mode === "groups"
              ? groupedLayout(ids, layout.groups, center, metrics.radius)
              : mode === "spaced"
                ? gridLayout(ids, center, metrics.radius, 64, spreadCell())
                : clusterLayout(ids, relationships, center, metrics.radius);

    const session = beginArrange(arrangeSessionRef.current, {
      baseline,
      proposal: { mode, scope: arrangeScope, positions },
    });
    arrangeSessionRef.current = session;
    setPreview(session.proposal);
    frameProposal(positions);
    // The drawer stays open: switching layouts to compare them is the point of a
    // preview, and closing the panel would take the other layouts away.
    setSurface("arrange");
  }

  /** 取消 is a view restore as much as a data one: the box goes back with it. */
  function cancelArrange() {
    const baseline = cancelArrangeSession(arrangeSessionRef.current);
    arrangeSessionRef.current = null;
    arrangeApplyingRef.current = false;
    setPreview(null);

    if (!baseline) {
      return;
    }

    // The roster and the coordinates in the preview changed what is drawn, so the cached
    // box has to be rebuilt before the old framing can be restored.
    setBoxEpoch((epoch) => epoch + 1);
    viewAutoRef.current = false;
    setView(baseline.view);
    setSelectedIds(baseline.selectedIds);
  }

  /**
   * Any other task cancels a preview before it runs. Returns whether something was
   * rolled back, so a caller can describe what happened rather than guess.
   */
  function rollbackArrange(): boolean {
    if (!arrangeSessionRef.current && !preview) {
      return false;
    }

    cancelArrange();
    return true;
  }

  function applyArrange() {
    const session = arrangeSessionRef.current;

    if (!session || arrangeApplyingRef.current) {
      return;
    }

    arrangeApplyingRef.current = true;
    const { layout: next, baseline } = commitArrangeSession(session);
    const changed = proposalChanges(session);

    arrangeSessionRef.current = null;
    setPreview(null);
    setSurface("none");

    if (changed) {
      setArrangeUndo({
        layout: baseline.layout,
        view: baseline.view,
        label: session.proposal.label ?? arrangeLabel(session.proposal.mode),
      });
      setBoxEpoch((epoch) => epoch + 1);
      commitLayout(next);
      if (session.proposal.view) {
        // A snapshot's framing is part of what it restores: the camera goes back with the
        // coordinates instead of being refitted to them.
        viewAutoRef.current = false;
        setView(session.proposal.view);
      } else {
        // The preview already framed the result; a hand-composed view is left alone
        // unless the new coordinates would sit outside it.
        const committed = visibleCharacters.map(
          (character, index) => next.positions[character.id] ?? basePositions[index],
        );
        if (!pointsWithinView(committed, view, canvas.viewBox)) {
          frameProposal(session.proposal.positions);
        }
      }
    } else {
      // Nothing moved: no undo step, no "已应用" claim.
      show("布局没有变化，未写入坐标");
    }

    arrangeApplyingRef.current = false;
  }

  const snapshots = layout.snapshots ?? [];

  /** The drawing positions as they are on screen, keyed by id. */
  function onScreenPositions(): Record<string, { x: number; y: number }> {
    const map: Record<string, { x: number; y: number }> = {};
    visibleCharacters.forEach((character, index) => {
      const point = positions[index];
      if (point) {
        map[character.id] = { x: point.x, y: point.y };
      }
    });
    return map;
  }

  function currentMembers(): string[] {
    return canvasMembers ?? visibleCharacters.map((character) => character.id);
  }

  /**
   * Membership is its own layer: it writes the roster (and, for additions, the seeded
   * coordinates) in one layout write, and never touches characters or relationships.
   */
  function writeMembership(next: string[], placed?: Record<string, { x: number; y: number }>, label?: string) {
    const current = workingLayout();
    const updated = {
      ...current,
      members: next,
      positions: placed ? { ...current.positions, ...placed } : current.positions,
    };
    if (!trySaveLayout(updated)) {
      show("保存失败：浏览器存储空间不足");
      return false;
    }
    if (label) {
      setArrangeUndo({ layout: current, view, label });
    }
    setLayout(updated);
    return true;
  }

  function addToCanvas(ids: readonly string[]) {
    const present = new Set(currentMembers());
    const fresh = ids.filter((id) => !present.has(id) && characters.some((character) => character.id === id));
    if (fresh.length === 0) {
      return;
    }
    const base = { ...onScreenPositions(), ...workingLayout().positions };
    // A character who was removed earlier still has a slot; putting them back there is
    // the whole promise of 移出 + 重新加入. Only the ones without a slot get a new ring.
    const unplaced = fresh.filter((id) => !base[id]);
    const placed = placeNewPoints(
      Object.fromEntries(Object.entries(base).filter(([id]) => present.has(id) || characters.some((c) => c.id === id))),
      unplaced,
    );
    if (writeMembership(addMembers([...present], fresh), placed, `加入 ${fresh.length} 个角色`)) {
      show(`已把 ${fresh.length} 个角色加入画布`);
    }
  }

  function removeFromCanvas(ids: readonly string[]) {
    const present = currentMembers();
    const drop = ids.filter((id) => present.includes(id));
    if (drop.length === 0) {
      return;
    }
    // Keep where the character was standing. On a canvas that never had stored
    // coordinates the drawn positions are computed on the fly, so dropping the node
    // without writing its slot first means re-adding it later puts it somewhere else.
    const screen = onScreenPositions();
    const kept = Object.fromEntries(
      drop.filter((id) => screen[id]).map((id) => [id, screen[id]] as const),
    );
    if (writeMembership(removeMembers(present, drop), kept, `移出 ${drop.length} 个角色`)) {
      show(`已移出 ${drop.length} 个角色，角色资料与关系都还在`);
    }
  }

  function addAllToCanvas() {
    addToCanvas(characters.map((character) => character.id));
  }


  function saveSnapshot() {
    const now = new Date().toISOString();
    const ids = characters.map((character) => character.id);
    const { snapshot, error } = captureSnapshot(workingLayout(), snapshotName, view, ids, now);
    if (error || !snapshot) {
      show(error ?? "保存失败");
      return;
    }
    const exists = snapshots.some((item) => item.name === snapshot.name);
    if (exists && !window.confirm(`已有同名布局「${snapshot.name}」，覆盖它？`)) {
      return;
    }
    const next = { ...workingLayout(), snapshots: addSnapshot(snapshots, snapshot, SNAPSHOT_LIMIT) };
    if (!trySaveLayout(next)) {
      show("保存失败：浏览器存储空间不足，请先删除旧布局");
      return;
    }
    setLayout(next);
    setSnapshotName("");
    show(`已保存布局「${snapshot.name}」`);
  }

  /** A snapshot is a proposal like any layout command: preview first, then write. */
  function previewSnapshot(snapshot: LayoutSnapshot) {
    const ids = characters.map((character) => character.id);
    const positions = snapshotPositions(snapshot, workingLayout().positions, ids);
    const baseline = arrangeSessionRef.current?.baseline ?? {
      layout: workingLayout(),
      view,
      selectedIds: [...selectedIds],
    };
    const session = beginArrange(arrangeSessionRef.current, {
      baseline,
      proposal: {
        label: `恢复布局「${snapshot.name}」`,
        mode: "snapshot",
        scope: "all",
        positions,
        // A snapshot restores who is on the canvas and where the camera was. A capture
        // older than membership stores no roster, and restoring it must not empty the
        // canvas: `null` means "leave the legacy mode as it is".
        members: snapshot.members === undefined ? null : [...snapshot.members],
        view: snapshot.view,
      },
    });
    arrangeSessionRef.current = session;
    setPreview(session.proposal);
    // The box is cached around the drawn coordinates: the preview's coordinates are the
    // snapshot's, so the box has to be rebuilt before its framing means anything.
    setBoxEpoch((epoch) => epoch + 1);
    viewAutoRef.current = false;
    setView(snapshot.view);
    setSurface("arrange");
  }

  function writeSnapshots(next: LayoutSnapshot[]) {
    const updated = { ...workingLayout(), snapshots: next };
    if (!trySaveLayout(updated)) {
      show("保存失败：浏览器存储空间不足");
      return;
    }
    setLayout(updated);
  }

  function undoArrange() {
    if (!arrangeUndo) {
      return;
    }

    const restored = arrangeUndo;
    // The box is cached around the drawn coordinates, so a command that re-places
    // everything has to rebuild it before the restored view can mean anything.
    setBoxEpoch((epoch) => epoch + 1);
    viewAutoRef.current = false;
    setView(restored.view);
    commitLayout(restored.layout);
    setArrangeUndo(null);
  }

  function toggleSelected(id: string, additive: boolean) {
    setSelectedIds((current) => {
      // A click in single mode is a selection, not a toggle: clicking the node you
      // already picked must not empty the panel under the pointer. Clearing is the
      // empty-canvas click or the 清除 button.
      if (!additive) {
        return [id];
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
    viewAutoRef.current = false;
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
   * Ctrl+wheel zooms about the pointer; a plain wheel scrolls as it always did.
   *
   * The canvas used to take every wheel event, which meant a reader could not scroll
   * past a full-height drawing without zooming it by accident. The accelerator is now
   * the only thing that zooms: it is the gesture people already know from maps, and
   * leaving the bare wheel alone keeps the page and the open drawer scrollable.
   *
   * React attaches `onWheel` passively, so `preventDefault()` inside a React handler is
   * ignored — a native listener with `passive: false` is the only way to stop the
   * browser's own page zoom, and it is re-registered when the view box changes so it
   * always zooms about the current box. The listener hangs off the <svg>, so a pointer
   * over the search field, a slider or the drawer never reaches it.
   */
  useEffect(() => {
    const svg = svgRef.current;

    if (!svg) {
      return;
    }

    function onWheel(event: WheelEvent) {
      if (!event.ctrlKey && !event.metaKey) {
        // Not ours: page scroll, drawer scroll and trackpad pans stay untouched.
        return;
      }

      // The browser would zoom the whole page. Refuse only here, and only now.
      event.preventDefault();

      // A notch is ~100; a trackpad sends a stream of small deltas, so an exponential
      // step keeps both smooth and bounded in one gesture.
      const factor = Math.exp(-event.deltaY * 0.002);
      zoomAround(svg as SVGSVGElement, event.clientX, event.clientY, factor);
    }

    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
    // No dependency list: the <svg> is re-created when the canvas moves between the
    // page and the full-screen studio, and a listener left on the old element zooms
    // nothing. Re-attaching after every render keeps it on whichever element is
    // mounted now; the add/remove pair is a no-op in cost next to a render.
  });

  /**
   * Shift-lock and alignment snapping, applied to whatever is being dragged.
   *
   * The axis is chosen once, from the direction the drag already leans, and only while
   * Shift is held: releasing it resumes free movement, pressing it again re-reads the
   * lean. Guides are measured in screen pixels (`worldPerPx` converts), so a 6px pull
   * feels the same at 20% and at 200%. Grid rounding is the fallback — an explicit
   * alignment is a stronger statement than a lattice — and only applies when the style
   * has snapping on, which is a separate decision from showing the grid.
   */
  function constrainedDrag(args: {
    base: Record<string, LayoutPoint>;
    ids: string[];
    delta: { x: number; y: number };
    shiftKey: boolean;
    worldPerPx: number;
  }) {
    let dx = args.delta.x;
    let dy = args.delta.y;

    if (args.shiftKey) {
      if (!axisLockRef.current) {
        axisLockRef.current = Math.abs(dx) >= Math.abs(dy) ? "x" : "y";
      }
      if (axisLockRef.current === "x") {
        dy = 0;
      } else {
        dx = 0;
      }
    } else {
      axisLockRef.current = null;
    }

    const moving = new Set(args.ids);
    const points = args.ids.map((id) => args.base[id]).filter(Boolean);
    if (points.length === 0) {
      return { positions: args.base, guides: null as DragGuides | null, snapped: false };
    }

    const centerX = points.reduce((sum, point) => sum + point.x, 0) / points.length + dx;
    const centerY = points.reduce((sum, point) => sum + point.y, 0) / points.length + dy;
    const reach = args.worldPerPx * GUIDE_PX;

    let guideX: number | null = null;
    let guideY: number | null = null;
    let bestX = reach;
    let bestY = reach;
    for (const [id, point] of Object.entries(args.base)) {
      if (moving.has(id)) {
        continue;
      }
      const gapX = Math.abs(point.x - centerX);
      if (gapX <= bestX) {
        bestX = gapX;
        guideX = point.x;
      }
      const gapY = Math.abs(point.y - centerY);
      if (gapY <= bestY) {
        bestY = gapY;
        guideY = point.y;
      }
    }

    // Explicit beats implicit: with 网格吸附 on, the lattice decides and the guides are
    // only a read-out. On a hundred-node canvas a 6px catch radius finds a neighbour
    // almost every frame, so letting guides win would make the grid appear broken.
    //
    // `centerX`/`centerY` already include the drag delta, so the lattice is solved
    // against them directly. Adding the delta a second time (as this did) snapped the
    // point the pointer would reach at twice the distance, and the released node landed
    // an arbitrary remainder away from every grid line.
    const step = style.canvas.gridSize;
    // `axisLockRef` names the axis the gesture is free to move on; the other one is
    // frozen. A locked axis is a promise, so nothing may nudge it — not the lattice and
    // not a neighbour's centre. (It was enough to watch the axis, and the old code
    // snapped the frozen one back onto the grid the moment Shift was held.)
    const frozenX = args.shiftKey && axisLockRef.current === "y";
    const frozenY = args.shiftKey && axisLockRef.current === "x";
    if (style.canvas.snap && step > 0) {
      if (!frozenX) {
        dx += Math.round(centerX / step) * step - centerX;
      }
      if (!frozenY) {
        dy += Math.round(centerY / step) * step - centerY;
      }
    } else {
      if (guideX !== null && !frozenX) {
        dx += guideX - centerX;
      }
      if (guideY !== null && !frozenY) {
        dy += guideY - centerY;
      }
    }

    // The guides report where the node actually ended up, not where it could have
    // gone: a lattice snap rarely lands on a neighbour's centre, and drawing a line
    // there would claim an alignment the drop did not make.
    const finalX = centerX + dx;
    const finalY = centerY + dy;
    const shownX = guideX !== null && Math.abs(guideX - finalX) <= 0.5 ? guideX : null;
    const shownY = guideY !== null && Math.abs(guideY - finalY) <= 0.5 ? guideY : null;

    const positions: Record<string, LayoutPoint> = { ...args.base };
    for (const id of args.ids) {
      const point = args.base[id];
      if (point) {
        positions[id] = {
          x: Math.round((point.x + dx) * 100) / 100,
          y: Math.round((point.y + dy) * 100) / 100,
        };
      }
    }

    return {
      positions,
      snapped: style.canvas.snap && step > 0,
      guides: shownX === null && shownY === null ? null : { x: shownX, y: shownY },
    } as { positions: Record<string, LayoutPoint>; guides: DragGuides | null; snapped: boolean };
  }

  /**
   * How far a press may travel before it counts as a drag.
   *
   * A finger rolls by a few pixels when it taps, so the touch threshold is larger
   * than the mouse one. Without the gap, every tap on a phone drags the node a
   * little and then also opens nothing.
   */
  const dragThreshold = (pointerType: string) => (pointerType === "touch" ? 8 : 4);

  function beginPan(event: ReactPointerEvent<SVGSVGElement>) {
    // Left is the editing button; middle is a pan for mice that have one. Any other
    // button belongs to the browser's own menus and is left alone.
    if (event.pointerType === "mouse" && event.button !== 0 && event.button !== 1) {
      return;
    }
    const middlePan = event.pointerType === "mouse" && event.button === 1;

    if (middlePan) {
      event.preventDefault();
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
      pinchRef.current = {
        distance: Math.hypot(first.x - second.x, first.y - second.y),
        centerX: (first.x + second.x) / 2,
        centerY: (first.y + second.y) / 2,
      };
      panRef.current = null;
      nodeDragRef.current = null;
      groupDragRef.current = null;
      setDragRef.current = null;
      if (livePositions) {
        stopDragFrame();
      }
      return;
    }

    if (pointersRef.current.size > 2) {
      return;
    }

    // The hand tool, a held space and a middle-drag all pan from anywhere — including
    // from on top of a node. Pressing a node with one of them never starts a move, so a
    // pan cannot become an accidental edit, and a trackpad without a middle button is
    // not left without a way to pan.
    if (panMode || spaceRef.current || middlePan) {
      panRef.current = {
        pointerId: event.pointerId,
        lastX: event.clientX,
        lastY: event.clientY,
        moved: false,
      };
      return;
    }

    if (nodeId) {
      const index = visibleCharacters.findIndex((character) => character.id === nodeId);
      const nodePoint = positions[index];

      if (nodePoint) {
        const world = drawingPoint(event.clientX, event.clientY, event.currentTarget);

        // Pressing one member of a multi-selection carries the whole set. Only when
        // the node is part of the selection: pressing an unselected node is a
        // request to work on that node alone.
        if (selectedIds.length > 1 && selectedIds.includes(nodeId) && !spaceRef.current) {
          setDragRef.current = {
            pointerId: event.pointerId,
            id: nodeId,
            start: world,
            last: world,
            grab: { x: nodePoint.x - world.x, y: nodePoint.y - world.y },
            members: [...selectedIds],
            base: workingLayout(),
            moved: false,
          };
          panRef.current = null;
          nodeDragRef.current = null;
          return;
        }

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
      // A press on the rectangle is a statement about the whole group, so the
      // members are selected as the gesture begins: from here the border, the
      // members' rings and the drag all describe the same object.
      if (group && group.characterIds.length > 0) {
        setSelectedEdgeId(null);
        setSelectedIds(group.characterIds);
      }
      setPressedGroupId(groupId);
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

    // Empty canvas: the selection tool draws a rectangle, everything else pans.
    // Space turns the rectangle off for as long as it is held.
    if (selectMode && !spaceRef.current) {
      marqueeRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        additive: event.shiftKey,
        moved: false,
      };
      setMarquee({ left: event.clientX, top: event.clientY, width: 0, height: 0 });
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
      // A second finger turns the gesture into a pinch & pan: whatever the first finger
      // was dragging must be abandoned, not committed halfway.
      nodeDragRef.current = null;
      groupDragRef.current = null;
      setDragRef.current = null;
      panRef.current = null;
      if (livePositions) {
        stopDragFrame();
      }
      const [first, second] = [...pointers.values()];
      const distance = Math.hypot(first.x - second.x, first.y - second.y);
      const centerX = (first.x + second.x) / 2;
      const centerY = (first.y + second.y) / 2;
      const previous = pinchRef.current;
      if (previous && previous.distance > 0 && distance > 0) {
        const factor = distance / previous.distance;
        const rect = event.currentTarget.getBoundingClientRect();
        // Both the zoom anchor and the pan distance come from the same pair of
        // midpoints, and the whole gesture lands in one state update. Doing it in two
        // (zoomAround then a second setView) let the zoom anchor be computed from a
        // stale box, which showed up as the drawing creeping under the fingers.
        const from = viewBoxPointAt(previous.centerX, previous.centerY, rect, canvas.viewBox);
        const to = viewBoxPointAt(centerX, centerY, rect, canvas.viewBox);

        viewAutoRef.current = false;
        setView((current) => pinchView(current, from, to, factor, clampZoom));
      }
      pinchRef.current = { distance, centerX, centerY };
      return;
    }

    // A proposal is on screen and nothing has been written yet: a node drag would be
    // discarded by the next layout switch, or would commit a coordinate the author has
    // not confirmed. Looking (pan, zoom, marquee, tap to select) stays available; a
    // gesture that writes coordinates does not.
    if (preview && (setDragRef.current || nodeDragRef.current || groupDragRef.current)) {
      return;
    }

    const setDrag = setDragRef.current;
    if (setDrag && setDrag.pointerId === event.pointerId) {
      const world = drawingPoint(event.clientX, event.clientY, event.currentTarget);
      setDrag.last = world;
      const delta = { x: world.x - setDrag.start.x, y: world.y - setDrag.start.y };

      if (!setDrag.moved && Math.hypot(delta.x, delta.y) > dragThreshold(event.pointerType)) {
        setDrag.moved = true;
        setFocusId(null);
        setHoveredId(null);
      }

      if (setDrag.moved) {
        const constrained = constrainedDrag({
          base: setDrag.base.positions,
          ids: setDrag.members,
          delta,
          shiftKey: event.shiftKey,
          // Screen pixels, not view-box units: the drawing is scaled by `view.k`, so a
          // 6px pull was a 6k-unit pull and felt looser the further the author zoomed in.
          worldPerPx:
            Number(canvas.viewBox.split(" ")[2]) /
            event.currentTarget.getBoundingClientRect().width /
            (view.k || 1),
        });
        setDragGuides(constrained.guides);
        setShiftAxis(event.shiftKey ? axisLockRef.current : null);
        scheduleDrag(constrained.positions);
      }
      return;
    }

    const marqueeDrag = marqueeRef.current;
    if (marqueeDrag && marqueeDrag.pointerId === event.pointerId) {
      const rect = dragRect(marqueeDrag.startX, marqueeDrag.startY, event.clientX, event.clientY);
      if (!marqueeDrag.moved && isMarquee(rect)) {
        marqueeDrag.moved = true;
      }
      setMarquee({ left: rect.left, top: rect.top, width: rect.right - rect.left, height: rect.bottom - rect.top });
      setMarqueeCandidates(marqueeDrag.moved ? marqueeHitsFor(rect) : null);
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
        const basePoint = nodeDrag.base.positions[nodeDrag.id];
        const constrained = constrainedDrag({
          base: nodeDrag.base.positions,
          ids: [nodeDrag.id],
          delta: {
            x: world.x + nodeDrag.grab.x - (basePoint?.x ?? world.x + nodeDrag.grab.x),
            y: world.y + nodeDrag.grab.y - (basePoint?.y ?? world.y + nodeDrag.grab.y),
          },
          shiftKey: event.shiftKey,
          // Screen pixels, not view-box units: the drawing is scaled by `view.k`, so a
          // 6px pull was a 6k-unit pull and felt looser the further the author zoomed in.
          worldPerPx:
            Number(canvas.viewBox.split(" ")[2]) /
            event.currentTarget.getBoundingClientRect().width /
            (view.k || 1),
        });
        setDragGuides(constrained.guides);
        setShiftAxis(event.shiftKey ? axisLockRef.current : null);
        scheduleDrag(constrained.positions);
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
        const constrained = constrainedDrag({
          base: groupDrag.base.positions,
          ids: groupDrag.members,
          delta,
          shiftKey: event.shiftKey,
          // Screen pixels, not view-box units: the drawing is scaled by `view.k`, so a
          // 6px pull was a 6k-unit pull and felt looser the further the author zoomed in.
          worldPerPx:
            Number(canvas.viewBox.split(" ")[2]) /
            event.currentTarget.getBoundingClientRect().width /
            (view.k || 1),
        });
        // `constrainedDrag` already applies the gesture delta to every member; adding
        // it again here moved a dragged group at twice the pointer's speed and made
        // the lattice unreachable from this path.
        setDragGuides(constrained.guides);
        setShiftAxis(event.shiftKey ? axisLockRef.current : null);
        scheduleDrag(constrained.positions);
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
      // The author has composed this view; a drawer opening must not take it back.
      viewAutoRef.current = false;
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
    if (setDragRef.current?.pointerId === event.pointerId) {
      setDragRef.current = null;
    }
    if (marqueeRef.current?.pointerId === event.pointerId) {
      marqueeRef.current = null;
    }
    setMarquee(null);
    pointersRef.current.delete(event.pointerId);
    if (pointersRef.current.size < 2) {
      pinchRef.current = null;
    }
    pressedNodeRef.current = null;
    setPressedGroupId(null);
    setLivePositions(null);
    setDragGuides(null);
    setShiftAxis(null);
    axisLockRef.current = null;
    stopDragFrame();
  }

  /** What the rectangle covers right now, measured against the shapes themselves. */
  function marqueeHitsFor(rect: { left: number; top: number; right: number; bottom: number }) {
    const svg = svgRef.current;
    if (!svg) {
      return [];
    }
    return [...svg.querySelectorAll("[data-character-id]")]
      .filter((element) => {
        const shape = element.querySelector(".relationship-node-card, .relationship-node-circle") ?? element;
        const box = shape.getBoundingClientRect();
        return marqueeHits(
          { left: box.left, top: box.top, right: box.right, bottom: box.bottom },
          rect,
        );
      })
      .map((element) => element.getAttribute("data-character-id"))
      .filter((id): id is string => Boolean(id));
  }

  function endPan(event: ReactPointerEvent<SVGSVGElement>) {
    setDragGuides(null);
    setShiftAxis(null);
    axisLockRef.current = null;
    const nodeDrag = nodeDragRef.current;
    const groupDrag = groupDragRef.current;
    const pan = panRef.current;
    const tappedId = pressedNodeRef.current;
    const tappedEdgeId = pressedEdgeRef.current;

    const setDrag = setDragRef.current;
    const marqueeDrag = marqueeRef.current;
    const setGesture = setDrag && setDrag.pointerId === event.pointerId ? setDrag : null;
    const marqueeGesture = marqueeDrag && marqueeDrag.pointerId === event.pointerId ? marqueeDrag : null;
    const nodeGesture = nodeDrag && nodeDrag.pointerId === event.pointerId ? nodeDrag : null;
    const groupGesture = groupDrag && groupDrag.pointerId === event.pointerId ? groupDrag : null;
    const panned = Boolean(pan && pan.pointerId === event.pointerId && pan.moved);

    if (setGesture?.moved) {
      const world = setGesture.last;
      const delta = { x: world.x - setGesture.start.x, y: world.y - setGesture.start.y };
      const fallback = { ...setGesture.base.positions };

      for (const id of setGesture.members) {
        const point = setGesture.base.positions[id];
        if (point) {
          fallback[id] = {
            x: Math.round((point.x + delta.x) * 100) / 100,
            y: Math.round((point.y + delta.y) * 100) / 100,
          };
        }
      }

      commitLayout({ ...setGesture.base, positions: pendingDragRef.current ?? fallback });
      // Moving several people at once is a gesture with no "drag back", so it takes
      // the single step back the arrange path already owns.
      setArrangeUndo({ layout: setGesture.base, view, label: "移动选择" });
      stopDragFrame();
    } else if (marqueeGesture?.moved) {
      const rect = dragRect(marqueeGesture.startX, marqueeGesture.startY, event.clientX, event.clientY);
      const picked = marqueeHitsFor(rect);
      setMarqueeCandidates(null);
      setSelectedEdgeId(null);
      // The rectangle is the mode's own gesture: picking several people with it turns
      // the mode on, so the receding that shows while dragging is still there after
      // the release. It is never inferred from the count at render time.
      if ((marqueeGesture.additive ? [...new Set([...selectedIds, ...picked])] : picked).length > 1) {
        setMultiSelectMode(true);
      }
      setSelectedIds((current) =>
        marqueeGesture.additive ? [...new Set([...current, ...picked])] : picked,
      );
    } else if (nodeGesture?.moved) {
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
      // A group is several nodes moving at once and there is no obvious "drag back" to
      // the exact previous arrangement, so this gesture offers the single step back the
      // arrange path already owns. A single node still keeps its drag-back.
      setArrangeUndo({ layout: groupGesture.base, view, label: "分组移动" });
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
        toggleSelected(tappedId, selectMode || event.shiftKey || multiSelectMode);
      }
    } else if (setGesture && !setGesture.moved && tappedId) {
      // Pressing a member of a multi-selection starts a set drag, not a node drag, so
      // the tap branch above never sees it. A press that never moved is still a tap:
      // in multi-select mode it removes that one member, and outside the mode it
      // replaces the selection with that node. Without this the second tap on a
      // selected node did nothing at all.
      const previous = lastTapRef.current;
      const now = Date.now();
      const doubleTap = previous?.id === tappedId && now - previous.at < 350;

      if (doubleTap) {
        lastTapRef.current = null;
        onOpenCharacter(tappedId);
      } else {
        lastTapRef.current = { id: tappedId, at: now };
        setSelectedEdgeId(null);
        toggleSelected(tappedId, selectMode || event.shiftKey || multiSelectMode);
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
      setMarqueeCandidates(null);
      if (!multiSelectMode) {
        setSelectedIds([]);
        setSelectedEdgeId(null);
      }
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
      setDragRef.current = null;
      marqueeRef.current = null;
      setMarquee(null);
      // The drag is over: the border keeps the selected state, not the dragging one.
      setPressedGroupId(null);
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
  // The relationships the canvas can actually draw: both ends are in scope. This is the
  // number the scope summary reports, so "40 shown of 95 connected" and "191
  // relationships" cannot be read as the same thing.
  const drawnRelationships = useMemo(
    () => relationships.filter((relationship) => byId.has(relationship.fromId) && byId.has(relationship.toId)),
    [relationships, byId],
  );

  /**
   * Where each relationship label is drawn, after moving it off anything it would
   * cover. Only labels that are actually drawn are placed, and only while the graph is
   * small enough to draw them at all — at a hundred nodes the work would be wasted.
   */
  const labelPlacements = useMemo(() => {
    const placements = new Map<string, { x: number; y: number }>();

    const placementMode = style.edge.labelMode ?? (style.edge.showLabel ? "auto" : "hidden");
    if (placementMode === "hidden" || (placementMode === "auto" && visibleCharacters.length > 60)) {
      return placements;
    }

    const obstacles: { x: number; y: number; width: number; height: number }[] = [];

    visibleCharacters.forEach((character, index) => {
      const geom = nodeVisuals[character.id]?.geom;
      const point = positions[index];
      if (!geom || !point) {
        return;
      }
      obstacles.push({
        x: point.x - geom.halfWidth - 6,
        y: point.y - geom.halfHeight - 6,
        width: geom.halfWidth * 2 + 12,
        height: geom.halfHeight * 2 + 12,
      });
      obstacles.push({
        x: point.x - geom.halfWidth - 14,
        y: point.y + geom.halfHeight + 4,
        width: geom.halfWidth * 2 + 28,
        height: nameSize * 2.6 + 6,
      });
    });

    const bendsForLabels = edgeBends(drawnRelationships);
    const size = style.edge.labelSize;
    const height = size * 1.15;

    drawnRelationships.forEach((relationship) => {
      const from = byId.get(relationship.fromId);
      const to = byId.get(relationship.toId);
      if (!from || !to) {
        return;
      }
      const fromGeom = nodeVisuals[relationship.fromId]?.geom;
      const toGeom = nodeVisuals[relationship.toId]?.geom;
      const geometry = edgeGeometry(from, to, {
        fromBox: fromGeom?.card || fromGeom?.rounded ? fromGeom : undefined,
        toBox: toGeom?.card || toGeom?.rounded ? toGeom : undefined,
        fromRadius: fromGeom?.radius,
        toRadius: toGeom?.radius,
        weight: style.edge.width,
        bend: bendsForLabels.get(relationship.id) ?? 0,
        metrics,
        symmetrical: isSymmetricKind(relationship.kind),
        labelT: style.edge.labelT,
        labelOffset: style.edge.labelOffset,
        arrowStyle: style.edge.arrow,
        arrowScale: style.edge.arrowSize,
      });
      const label = relationshipKindLabel(relationship.kind);
      const width = measureNameWidth(label, size);
      const normal = (() => {
        const dx = to.x - from.x;
        const dy = to.y - from.y;
        const length = Math.hypot(dx, dy) || 1;
        return { x: -dy / length, y: dx / length };
      })();
      const placement = chooseLabelOffset(
        geometry.labelX,
        geometry.labelY,
        normal.x,
        normal.y,
        width,
        height,
        obstacles,
      );

      placements.set(relationship.id, placement);
      obstacles.push({
        x: placement.x - width / 2 - 3,
        y: placement.y - height - 2,
        width: width + 6,
        height: height + 4,
      });
    });

    return placements;
  }, [
    byId,
    drawnRelationships,
    metrics,
    nodeVisuals,
    positions,
    style.edge.arrow,
    style.edge.arrowSize,
    style.edge.labelSize,
    style.edge.showLabel,
    style.edge.width,
    nameSize,
    visibleCharacters,
  ]);

  /**
   * The rows a legend would show for the relationships actually being exported.
   * Shared by the SVG legend and the captured JPG/PDF overlay so the two cannot drift.
   */
  const legendEntries = useMemo(() => {
    const kinds = [...new Set(drawnRelationships.map((relationship) => relationship.kind))];
    return kinds.map((kind) => {
      const ink = edgeInk(kind, style);
      return {
        kind,
        label: relationshipKindLabel(kind),
        color: ink.color,
        dash: dashArrayFor(ink.dash),
        width: Math.max(1, ink.width),
        directed: !isSymmetricKind(kind) && style.edge.arrow !== "none" && style.edge.arrowSize > 0,
      };
    });
  }, [
    drawnRelationships,
    style.edge.byKind,
    style.edge.color,
    style.edge.dash,
    style.edge.width,
    style.edge.arrow,
    style.edge.arrowSize,
  ]);
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

    // An explicit roster is not a density decision, so a character who is not on it
    // cannot be "shown" by widening a view: the answer is to say so and offer the one
    // press that puts them on the canvas. Drawing their edges around the drawing instead
    // made the click look broken — the row was in the panel, the canvas did not change.
    if (canvasMembers && !canvasMembers.includes(character.id)) {
      setNotOnCanvas(character);
      return;
    }

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
    const zoom = capAutoZoom(
      fitZoom(contentBounds(points, metrics, labelHalfWidth), frameSize, screenScale, {
        margin: 0.3,
        max: FOCUS_MAX_ZOOM,
      }),
      screenScale,
      AUTO_FOCUS_MAX_ZOOM,
    );
    const centrePoint = {
      x: points.reduce((sum, item) => sum + item.x, 0) / points.length,
      y: points.reduce((sum, item) => sum + item.y, 0) / points.length,
    };

    viewAutoRef.current = false;
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

  // The export panel closes on a click anywhere outside it, like every other dropdown
  // in the app.
  useEffect(() => {
    if (!isExportOpen) {
      return;
    }

    function onPointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (!exportWrapRef.current?.contains(target) && !exportPanelRef.current?.contains(target)) {
        setIsExportOpen(false);
      }
    }

    window.addEventListener("mousedown", onPointerDown);
    return () => window.removeEventListener("mousedown", onPointerDown);
  }, [isExportOpen]);

  // Place the export panel against the real viewport: below the trigger when it fits,
  // above when it does not, and never outside a 12px safe margin on any side.
  useLayoutEffect(() => {
    if (!isExportOpen) {
      setExportBox(null);
      return;
    }

    function place() {
      const trigger = exportWrapRef.current?.getBoundingClientRect();
      const panel = exportPanelRef.current;
      if (!trigger || !panel) {
        return;
      }
      const placement = popoverPosition(
        { top: trigger.top, left: trigger.left, right: trigger.right, bottom: trigger.bottom },
        { width: panel.offsetWidth || 320, height: panel.scrollHeight || 320 },
        { width: window.innerWidth, height: window.innerHeight },
        12,
      );
      setExportBox({ left: placement.left, top: placement.top, maxHeight: placement.maxHeight });
    }

    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [isExportOpen, exportRatio, exportMode, prefs.exportScale, exportWidth]);

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
  /** The rectangle a scope covers, before any output ratio is applied. */
  function exportBounds(scope: ExportScope): WorldBounds | null {
    const selectedPoints = visibleCharacters
      .map((character, index) => ({ id: character.id, point: positions[index] }))
      .filter((entry) => selectedIds.includes(entry.id))
      .map((entry) => entry.point);

    return scopeBounds({
      scope,
      allPoints: positions,
      selectedPoints,
      viewBox: canvas.viewBox,
      padding: Math.max(
        metrics.radius + metrics.nameDrop + 24,
        boxHalfWidth + 24,
        style.node.form === "card" ? CARD_HEIGHT / 2 + 24 : 0,
      ),
    });
  }

  /**
   * The key an exported picture may carry: one row per relationship kind that is
   * actually drawn, with the same colour and dash the lines have.
   *
   * Rows are counted from what the export contains, not from the kind list, so a
   * graph with no 对手 edges does not advertise one.
   */
  function planExportLegend(bounds: WorldBounds, pruneSelection: boolean) {
    if (!prefs.exportLegend) {
      return null;
    }

    const exported = drawnRelationships.filter((relationship) =>
      pruneSelection
        ? selectedIds.includes(relationship.fromId) && selectedIds.includes(relationship.toId)
        : true,
    );
    const kinds = [...new Set(exported.map((relationship) => relationship.kind))];

    if (kinds.length === 0) {
      return null;
    }

    const boxes: LegendBox[] = visibleCharacters
      .map((character, index) => {
        const geom = nodeVisuals[character.id]?.geom;
        const point = positions[index];

        if (!geom || !point) {
          return null;
        }

        return {
          x: point.x - geom.halfWidth,
          y: point.y - geom.halfHeight,
          width: geom.halfWidth * 2,
          height: geom.halfHeight * 2 + 22,
        };
      })
      .filter((box): box is LegendBox => Boolean(box));

    const plan = planLegend({
      bounds,
      rowCount: kinds.length + 1,
      nodes: boxes,
      corner: prefs.exportLegendCorner,
      scale: prefs.exportLegendScale,
      margin: prefs.exportLegendMargin,
      nudge: legendNudge,
    });

    const svgNs = "http://www.w3.org/2000/svg";
    const node = document.createElementNS(svgNs, "g");
    node.setAttribute("class", "export-legend");
    node.setAttribute("data-export-legend", "true");

    const rowHeight = plan.panel.height / (kinds.length + 0.9);
    const pad = rowHeight * 0.5;
    // The legend belongs to the picture, so by default it sits on the picture's own
    // surface: a white panel on a dark canvas made every sample line invisible.
    const canvasFill = style.canvas.background || surfaceBackground();
    const panelFill = prefs.exportLegendBg === "panel" ? "#f8fafc" : canvasFill;
    const dark = luminanceOf(panelFill) < 140;

    const panel = document.createElementNS(svgNs, "rect");
    panel.setAttribute("x", String(plan.panel.x));
    panel.setAttribute("y", String(plan.panel.y));
    panel.setAttribute("width", String(plan.panel.width));
    panel.setAttribute("height", String(plan.panel.height));
    panel.setAttribute("rx", String(rowHeight * 0.45));
    panel.setAttribute("fill", panelFill);
    panel.setAttribute("stroke", dark ? "rgba(255,255,255,0.16)" : "rgba(17,24,39,0.10)");
    panel.setAttribute("stroke-width", String(Math.max(1, rowHeight * 0.05)));
    panel.setAttribute("opacity", String(prefs.exportLegendOpacity));
    node.appendChild(panel);

    const title = document.createElementNS(svgNs, "text");
    title.setAttribute("x", String(plan.panel.x + pad));
    title.setAttribute("y", String(plan.panel.y + rowHeight * 0.92));
    title.setAttribute("fill", dark ? "#e5e7eb" : "#1f2937");
    title.setAttribute("font-family", "system-ui, sans-serif");
    title.setAttribute("font-size", String(rowHeight * 0.52));
    title.setAttribute("font-weight", "600");
    title.textContent = style.edge.byKind ? "关系类型" : "关系类型（同一线色）";
    node.appendChild(title);

    kinds.forEach((kind, index) => {
      const y = plan.panel.y + rowHeight * (index + 1.55);
      const line = document.createElementNS(svgNs, "line");
      line.setAttribute("x1", String(plan.panel.x + pad));
      line.setAttribute("x2", String(plan.panel.x + pad + rowHeight * 1.5));
      line.setAttribute("y1", String(y));
      line.setAttribute("y2", String(y));
      const ink = edgeInk(kind, style);
      line.setAttribute("stroke", ink.color);
      line.setAttribute("stroke-width", String(Math.max(1.2, ink.width)));
      const dash = dashArrayFor(ink.dash);
      if (dash) {
        line.setAttribute("stroke-dasharray", dash);
      }
      node.appendChild(line);

      // A directed kind gets a head in its sample; a mutual one must not, or the
      // legend would promise a direction the drawing does not have.
      if (!isSymmetricKind(kind) && style.edge.arrow !== "none" && style.edge.arrowSize > 0) {
        const head = document.createElementNS(svgNs, "polygon");
        const size = rowHeight * 0.26;
        head.setAttribute(
          "points",
          `${plan.panel.x + pad + rowHeight * 1.5},${y} ${plan.panel.x + pad + rowHeight * 1.5 - size},${y - size * 0.55} ${plan.panel.x + pad + rowHeight * 1.5 - size},${y + size * 0.55}`,
        );
        head.setAttribute("fill", ink.color);
        node.appendChild(head);
      }

      const label = document.createElementNS(svgNs, "text");
      label.setAttribute("x", String(plan.panel.x + pad + rowHeight * 2));
      label.setAttribute("y", String(y + rowHeight * 0.2));
      label.setAttribute("fill", dark ? "#d1d5db" : "#374151");
      label.setAttribute("font-family", "system-ui, sans-serif");
      label.setAttribute("font-size", String(rowHeight * 0.46));
      label.textContent = relationshipKindLabel(kind);
      node.appendChild(label);
    });

    return { plan, node };
  }

  /**
   * One picture, one frame.
   *
   * Everything that decides what the file looks like lives here: the rectangle in
   * drawing coordinates, the background, and the legend. The preview renders this
   * exact string, and every format is produced from it — so the preview cannot drift
   * from the file, and neither SVG nor PDF has to be approximated by a screenshot.
   */
  function buildExportSvg(
    frame: WorldBounds,
    prune: boolean,
  ): { text: string; bounds: WorldBounds; legend: WorldBounds | null } | null {
    const svg = svgRef.current;
    if (!svg) {
      return null;
    }

    const clone = svg.cloneNode(true) as SVGSVGElement;
    clone.setAttribute("viewBox", `${frame.x} ${frame.y} ${frame.width} ${frame.height}`);
    clone.setAttribute("width", String(Math.round(frame.width)));
    clone.setAttribute("height", String(Math.round(frame.height)));
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
    // Attributes, not elements: a name the picture does not show must not survive
    // in the file as metadata.
    stripCharacterNames(clone);

    if (prune) {
      pruneToSelection(clone, selectedIds);
    }

    const content = Array.from(clone.children).find((child) => child.tagName === "g");
    content?.setAttribute("transform", "translate(0 0) scale(1)");

    // The legend is part of the picture, so it is drawn into the clone after the
    // transient editor marks have been stripped — never in the live canvas.
    const legend = planExportLegend(frame, prune);
    const exportedBounds = legend
      ? {
          x: frame.x - legend.plan.extra.left,
          y: frame.y - legend.plan.extra.top,
          width: frame.width + legend.plan.extra.left + legend.plan.extra.right,
          height: frame.height + legend.plan.extra.top + legend.plan.extra.bottom,
        }
      : frame;

    if (legend) {
      clone.setAttribute("viewBox", `${exportedBounds.x} ${exportedBounds.y} ${exportedBounds.width} ${exportedBounds.height}`);
      clone.setAttribute("width", String(Math.round(exportedBounds.width)));
      clone.setAttribute("height", String(Math.round(exportedBounds.height)));
    }

    // A transparent PNG has no surface of its own, and an SVG opened in a viewer
    // that defaults to white would lose a dark canvas. The colour is written in.
    const background = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    background.setAttribute("x", String(exportedBounds.x));
    background.setAttribute("y", String(exportedBounds.y));
    background.setAttribute("width", String(exportedBounds.width));
    background.setAttribute("height", String(exportedBounds.height));
    background.setAttribute("fill", style.canvas.background || surfaceBackground());
    clone.insertBefore(background, clone.firstChild);

    if (legend) {
      clone.appendChild(legend.node);
    }

    return {
      text: new XMLSerializer().serializeToString(clone),
      bounds: exportedBounds,
      legend: legend
        ? {
            x: legend.plan.panel.x,
            y: legend.plan.panel.y,
            width: legend.plan.panel.width,
            height: legend.plan.panel.height,
          }
        : null,
    };
  }

  /** Every format, one pipeline: the SVG above, then encode or download it. */
  async function runExportFormat(format: "png" | "svg" | "jpg" | "pdf") {
    if (exporting || !exportFrame) {
      return;
    }

    const prune = exportMode === "selection";
    setExporting(true);
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

    try {
      const built = buildExportSvg(exportFrame, prune);
      if (!built) {
        show(exportMode === "selection" ? "还没有选中任何角色" : "没有可导出的内容");
        return;
      }

      const size = outputSize({ frame: built.bounds, width: exportWidth });
      const stamp = new Date().toISOString().slice(0, 10);
      const label =
        exportMode === "view" ? "当前视图" : exportMode === "selection" ? "选中区域" : exportMode === "manual" ? "手动构图" : "全部内容";
      const baseName = `角色关系网-${label}-${stamp}`;

      if (format === "svg") {
        downloadSvg(built.text, `${baseName}.svg`);
        show(`SVG 已导出 · ${Math.round(built.bounds.width)} × ${Math.round(built.bounds.height)} 单位`);
        return;
      }

      if (format === "pdf") {
        const page = await exportSvgAsPdf({ svgText: built.text, bounds: built.bounds, size, baseName });
        show(`PDF 已导出 · 页面 ${page.pageWidth} × ${page.pageHeight} px`);
        return;
      }

      if (format === "jpg") {
        const jpeg = await rasterizeToJpeg(built.text, built.bounds, size, style.canvas.background || surfaceBackground());
        const url = URL.createObjectURL(jpeg);
        const link = document.createElement("a");
        link.href = url;
        link.download = `${baseName}.jpg`;
        link.click();
        URL.revokeObjectURL(url);
        show(`JPG 已导出 · ${size.width} × ${size.height} px`);
        return;
      }

      const { blob, width, height } = await rasterizeSvg(
        built.text,
        built.bounds,
        size.width / Math.max(1, built.bounds.width),
      );
      downloadPng(blob, `${baseName}.png`);
      show(`PNG 已导出 · ${width} × ${height} px`);
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

  // 始终显示 means "show the words", not "show the first sixty". Two limits, and the
  // panel states which one applied: whether the drawing is zoomed in enough for a word
  // to be legible at all, and whether the word lands on one already kept.
  const alwaysLabelBudget = useMemo(() => {
    const mode = style.edge.labelMode ?? (style.edge.showLabel ? "auto" : "hidden");
    const ids = new Set<string>();
    const perUnit = view.k * (measured ? screenScale : 1);
    const screenPx = style.edge.labelSize * perUnit;
    const readableAt = style.edge.labelSize > 0 ? Math.ceil((6 / style.edge.labelSize) * 100) : 100;
    const zoom = Math.round(perUnit * 100);
    if (mode !== "always") return { ids, kept: 0, total: relationships.length, zoom, zoomLimited: false, readableAt };
    if (screenPx < 6) return { ids, kept: 0, total: relationships.length, zoom, zoomLimited: true, readableAt };
    // At a size where 自动 draws every line, 尽量 must draw them too — otherwise the
    // "prefer the words" option would show fewer words than the default.
    if (relationships.length <= 60) {
      for (const relationship of relationships) ids.add(relationship.id);
      return { ids, kept: ids.size, total: relationships.length, zoom, zoomLimited: false, readableAt };
    }
    const font = style.edge.labelSize;
    const boxes: { l: number; r: number; t: number; b: number }[] = [];
    for (const relationship of relationships) {
      const placement = labelPlacements.get(relationship.id);
      if (!placement) continue;
      const text = relationshipKindLabel(relationship.kind);
      const w = Math.max(18, text.length * font * 1.02) + 3;
      const h = font * 1.3 + 2;
      const box = { l: placement.x - w / 2, r: placement.x + w / 2, t: placement.y - h / 2, b: placement.y + h / 2 };
      if (boxes.some((b) => !(box.r < b.l || box.l > b.r || box.b < b.t || box.t > b.b))) continue;
      boxes.push(box);
      ids.add(relationship.id);
    }
    return { ids, kept: ids.size, total: relationships.length, zoom, zoomLimited: false, readableAt };
  }, [labelPlacements, measured, relationships, screenScale, style.edge.labelMode, style.edge.labelSize, style.edge.showLabel, view.k]);

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
  /**
   * The canvas-tidying tools. One panel, two ways in — the page's tool strip and the
   * studio's dock — because arranging is something you do to the drawing, not a look
   * you choose for it. Scope, preview and confirm are the same in both.
   */
  const arrangePanel = (
    <div className="graph-panel graph-arrange-panel" role="group" aria-label="自动整理">
      {/* The decision belongs next to the layouts being compared, not on a bar lying
          over the drawing: a preview that has no visible 确认 is a preview nobody can
          finish. Sticky, so it survives scrolling to the snapshot list below. */}
      {preview ? (
        <div className="graph-arrange-decide" data-testid="arrange-decide" role="group" aria-label="预览决定">
          <p className="graph-panel-preview" role="status">
            正在预览「{preview.label ?? arrangeLabel(preview.mode)}」·{" "}
            {Object.keys(preview.positions).length} 个节点 · 坐标尚未保存
          </p>
          <div className="graph-arrange-decide-actions">
            <button className="ghost-button" data-testid="drawer-arrange-cancel" onClick={cancelArrange} type="button">
              取消预览
            </button>
            <button className="primary-button" data-testid="drawer-arrange-apply" onClick={applyArrange} type="button">
              确认应用
            </button>
          </div>
        </div>
      ) : (
        <p className="graph-panel-title">先预览，确认后才写入布局</p>
      )}
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
        <button
          aria-pressed={preview?.mode === "cluster"}
          className={preview?.mode === "cluster" ? "ghost-button active" : "ghost-button"}
          onClick={() => proposeArrange("cluster")}
          type="button"
        >
          关系聚类
        </button>
        <button
          aria-pressed={preview?.mode === "ring"}
          className={preview?.mode === "ring" ? "ghost-button active" : "ghost-button"}
          onClick={() => proposeArrange("ring")}
          type="button"
        >
          环形布局
        </button>
        <button
          aria-pressed={preview?.mode === "grid"}
          className={preview?.mode === "grid" ? "ghost-button active" : "ghost-button"}
          onClick={() => proposeArrange("grid")}
          type="button"
        >
          网格布局
        </button>
        <button
          aria-pressed={preview?.mode === "hierarchy"}
          className={preview?.mode === "hierarchy" ? "ghost-button active" : "ghost-button"}
          onClick={() => proposeArrange("hierarchy")}
          type="button"
        >
          层级布局
        </button>
        <button
          aria-pressed={preview?.mode === "groups"}
          className={preview?.mode === "groups" ? "ghost-button active" : "ghost-button"}
          onClick={() => proposeArrange("groups")}
          type="button"
        >
          按分组整理
        </button>
        <button
          aria-pressed={preview?.mode === "spaced"}
          className={preview?.mode === "spaced" ? "ghost-button active" : "ghost-button"}
          onClick={() => proposeArrange("spaced")}
          type="button"
        >
          按尺寸排开
        </button>
      </div>
      <p className="muted">只移动所选范围的节点，不改角色资料与关系。</p>

      <div className="graph-snapshot-block" role="group" aria-label="我的布局">
        <p className="graph-panel-title">我的布局</p>
        <p className="muted">
          保存现在的成员、摆放与取景，之后一键回到这里。与上方预设不同：预设改变外观，布局改变位置与成员。
        </p>
        <form
          className="graph-snapshot-save"
          onSubmit={(event) => {
            event.preventDefault();
            saveSnapshot();
          }}
        >
          <input
            aria-label="布局名称"
            maxLength={40}
            onChange={(event) => setSnapshotName(event.target.value)}
            placeholder={`布局 ${snapshots.length + 1}`}
            value={snapshotName}
            data-testid="snapshot-name"
          />
          <button className="primary-button small" data-testid="snapshot-save" type="submit">保存当前布局</button>
        </form>
        {snapshots.length === 0 ? (
          <p className="muted">还没有保存的布局。</p>
        ) : (
          <ul className="graph-snapshot-list">
            {snapshots.map((snapshot) => {
              const cover = snapshotCoverage(snapshot, characters.map((character) => character.id));
              const memberCount = snapshotMemberCount(snapshot);
              return (
                <li
                  className="graph-snapshot-row"
                  data-snapshot-name={snapshot.name}
                  data-testid="snapshot-row"
                  key={snapshot.id}
                >
                  {renamingId === snapshot.id ? (
                    <form
                      className="graph-snapshot-rename"
                      onSubmit={(event) => {
                        event.preventDefault();
                        writeSnapshots(renameSnapshot(snapshots, snapshot.id, renameDraft));
                        setRenamingId(null);
                      }}
                    >
                      <input
                        aria-label="新的布局名称"
                        autoFocus
                        maxLength={40}
                        onChange={(event) => setRenameDraft(event.target.value)}
                        value={renameDraft}
                      />
                      <button className="ghost-button small" type="submit">改名</button>
                      <button className="ghost-button small" onClick={() => setRenamingId(null)} type="button">取消</button>
                    </form>
                  ) : (
                    <>
                      <div className="graph-snapshot-meta">
                        <strong title={snapshot.name}>{snapshot.name}</strong>
                        <span data-testid="snapshot-meta">
                          {memberCount === null ? "成员：兼容模式" : `成员 ${memberCount} 个`} · 覆盖{" "}
                          {cover.covered}/{cover.total}
                        </span>
                      </div>
                      <div className="graph-snapshot-actions">
                        <button
                          className="ghost-button small"
                          data-snapshot-name={snapshot.name}
                          data-testid="snapshot-preview"
                          onClick={() => previewSnapshot(snapshot)}
                          type="button"
                        >
                          预览
                        </button>
                        <button
                          className="ghost-button small"
                          onClick={() => {
                            setRenamingId(snapshot.id);
                            setRenameDraft(snapshot.name);
                          }}
                          type="button"
                        >
                          改名
                        </button>
                        <button
                          className="ghost-button small"
                          onClick={() => {
                            if (window.confirm(`删除布局「${snapshot.name}」？`)) {
                              writeSnapshots(removeSnapshot(snapshots, snapshot.id));
                            }
                          }}
                          type="button"
                        >
                          删除
                        </button>
                      </div>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );

  const groupPanel = (
    <div className="graph-panel graph-group-panel" role="group" aria-label="视觉分组">
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
                setGroupDraft((current) => (current ? { ...current, name: event.target.value } : current))
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
      <p className="muted">分组只影响画布，不写入世界观。</p>
    </div>
  );

  const presetTier = (
            <section className="graph-design-tier">
              <strong className="graph-design-heading">风格预设</strong>
              <div className="graph-style-presets graph-preset-cards">
                {CANVAS_PRESETS.map((preset) => (
                  <button
                    aria-pressed={style.preset === preset.id}
                    className={style.preset === preset.id ? "graph-preset active" : "graph-preset"}
                    data-preset-id={preset.id}
                    data-testid="canvas-preset"
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
            </section>
  );

  // The four answers most edits need, with the number they produce. No apply button:
  // the drawing behind the panel is the preview.
  const quickTier = (
            <section className="graph-design-tier">
              <strong className="graph-design-heading">快速调整</strong>
              <div className="graph-style-grid graph-style-quick">
                <div className="graph-style-section-head">
                  <strong>节点与姓名</strong>
                  <span>大小与文字</span>
                </div>
                                  <label className="graph-style-check">
                    <input checked={style.node.showAvatars} onChange={(event) => patchStyle({ ...style, preset: "custom", node: { ...style.node, showAvatars: event.target.checked } })} type="checkbox" />
                    画作含头像
                  </label>
                <NumericControl
                  ariaLabel="节点大小"
                  defaultValue={1}
                  displayScale={100}
                  label="节点大小"
                  max={2}
                  min={0.6}
                  onChange={(v) => patchStyle({ ...style, preset: "custom", node: { ...style.node, size: v } }, "node-size")}
                  precision={0}
                  step={0.05}
                  testId="node-size"
                  unit="%"
                  value={style.node.size}
                />
                <NumericControl
                  ariaLabel="姓名字号"
                  defaultValue={1}
                  displayScale={100}
                  label="姓名大小"
                  max={1.8}
                  min={0.8}
                  onChange={(v) => {
                    updatePrefs({ nameSize: "medium" });
                    patchStyle({ ...style, preset: "custom", node: { ...style.node, nameScale: v } }, "name-scale");
                  }}
                  hint="旧版的字号档位已并入此值"
                  precision={0}
                  step={0.05}
                  testId="name-scale"
                  unit="%"
                  value={style.node.nameScale}
                />
                <div className="graph-style-section-head">
                  <strong>头像</strong>
                  <span>形态与大小</span>
                </div>
        <div className="graph-panel-row">
          <span className="graph-control-label">头像形态</span>
            <div className="graph-segment" role="group" aria-label="头像形态">
              {([
                ["auto", "自动"],
                ["circle", "圆形"],
                ["rounded", "圆角"],
              ] as const).map(([value, label]) => (
                <button
                  aria-pressed={style.node.avatarShape === value}
                  className={
                    style.node.avatarShape === value ? "graph-segment-button selected" : "graph-segment-button"
                  }
                  key={value}
                  onClick={() =>
                    patchStyle({ ...style, preset: "custom", node: { ...style.node, avatarShape: value } })
                  }
                  title={
                    value === "auto"
                      ? "按图片比例决定：近似正方用圆形，明显偏长用圆角矩形"
                      : value === "circle"
                        ? "所有上传头像都裁成圆形"
                        : "所有上传头像都用与图片比例一致的圆角矩形"
                  }
                  type="button"
                >
                  {label}
                </button>
              ))}
            </div>
        </div>
        <div className="graph-panel-row">
          <span className="graph-control-label">头像大小</span>
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
        {/* Three different questions, three different answers: which people are
            in scope, how many of them the core view draws, and whether the lines
            are painted. One switch used to answer all three. */}
                <div className="graph-style-section-head">
                  <strong>关系线与关系标签</strong>
                  <span>线、颜色与文字</span>
                </div>
                <div className="graph-panel-row">
                  <span className="graph-control-label">关系线</span>
                  <div className="graph-segment">
                    {[
                      { value: true, label: "显示" },
                      { value: false, label: "隐藏" },
                    ].map((option) => (
                      <button
                        aria-pressed={prefs.showEdges === option.value}
                        className={
                          prefs.showEdges === option.value ? "graph-segment-button selected" : "graph-segment-button"
                        }
                        key={option.label}
                        onClick={() => updatePrefs({ showEdges: option.value })}
                        type="button"
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>
                {/* What the strokes mean. It belongs with the display switches — it is
                    the same question ("what am I looking at") — and it is read once,
                    so it does not get a permanent corner of the drawing. */}
                <div className="graph-panel-row graph-legend">
                  <span className="graph-control-label">线型说明</span>
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
                <NumericControl
                  ariaLabel="连线宽度"
                  defaultValue={1.4}
                  label="关系线粗细"
                  max={6}
                  min={0.4}
                  onChange={(v) => patchStyle({ ...style, preset: "custom", edge: { ...style.edge, width: v } }, "edge-width")}
                  precision={1}
                  step={0.1}
                  testId="edge-width"
                  unit="px"
                  value={style.edge.width}
                />
                <NumericControl
                  ariaLabel="线条透明度"
                  defaultValue={1}
                  displayScale={100}
                  label="关系线透明度"
                  max={1}
                  min={0.2}
                  onChange={(v) => patchStyle({ ...style, preset: "custom", edge: { ...style.edge, opacity: v } }, "edge-opacity")}
                  precision={0}
                  step={0.05}
                  testId="edge-opacity"
                  unit="%"
                  value={style.edge.opacity}
                />
                <label>
                  <span className="graph-style-label">关系颜色</span>
                  <input
                    aria-label="关系颜色"
                    disabled={style.edge.byKind}
                    onChange={(event) => patchStyle({ ...style, preset: "custom", edge: { ...style.edge, color: event.target.value } })}
                    type="color"
                    value={style.edge.color || "#7b87a8"}
                  />
                </label>
                <label className="graph-style-check">
                  <input
                    checked={style.edge.byKind}
                    onChange={(event) => patchStyle({ ...style, preset: "custom", edge: { ...style.edge, byKind: event.target.checked } })}
                    type="checkbox"
                  />
                  按关系类型着色
                </label>
                {/* Eight swatches, one per kind. The palette is a legend the author can
                    rewrite; faction colour is a different question and lives with the
                    faction, not here. */}
                {style.edge.byKind && (
                  <div className="graph-kind-colors" data-testid="edge-kind-colors">
                    {RELATIONSHIP_KINDS.map((kind) => (
                      <label className="graph-kind-color" key={kind.value}>
                        <input
                          aria-label={`${kind.label}颜色`}
                          data-testid={`kind-color-${kind.value}`}
                          onChange={(event) =>
                            patchStyle({
                              ...style,
                              preset: "custom",
                              edge: { ...style.edge, kindColors: { ...style.edge.kindColors, [kind.value]: event.target.value } },
                            })
                          }
                          type="color"
                          value={style.edge.kindColors[kind.value] || DEFAULT_KIND_COLORS[kind.value]}
                        />
                        <span>{kind.label}</span>
                      </label>
                    ))}
                    <button
                      className="ghost-button small"
                      disabled={!Object.keys(style.edge.kindColors).length}
                      onClick={() => patchStyle({ ...style, preset: "custom", edge: { ...style.edge, kindColors: {} } })}
                      type="button"
                    >
                      恢复默认配色
                    </button>
                  </div>
                )}
                                  <label>线型
                    <select onChange={(event) => patchStyle({ ...style, preset: "custom", edge: { ...style.edge, dash: event.target.value as CanvasStyle["edge"]["dash"] } })} value={style.edge.dash}>
                      <option value="solid">实线</option>
                      <option value="dashed">虚线</option>
                      <option value="dotted">点线</option>
                    </select>
                  </label>
                <div className="graph-panel-row">
                  <span className="graph-control-label">箭头</span>
                  <div className="graph-arrow-options">
                    {([
                      ["concise", "简洁", "8 7 5"],
                      ["thin", "细线", "7 5 3"],
                      ["soft", "柔和", "8 9 8"],
                      ["none", "无", ""],
                    ] as Array<[ArrowStyle, string, string]>).map(([value, label, head]) => (
                      <button
                        aria-pressed={style.edge.arrow === value}
                        className={
                          style.edge.arrow === value ? "graph-arrow-option selected" : "graph-arrow-option"
                        }
                        key={value}
                        onClick={() => patchStyle({ ...style, preset: "custom", edge: { ...style.edge, arrow: value } })}
                        title={label}
                        type="button"
                      >
                        {/* The head is drawn, not described: four words in a row read the
                            same at a glance, four heads do not. */}
                        <svg aria-hidden="true" viewBox="0 0 46 14">
                          <line x1="2" x2={head ? "30" : "42"} y1="7" y2="7" />
                          {head ? (
                            <polygon
                              points={(() => {
                                const [h, w] = head.split(" ").map(Number);
                                return `30,7 ${30 - h},${7 - w / 2} ${30 - h},${7 + w / 2}`;
                              })()}
                            />
                          ) : null}
                        </svg>
                        <span>{label}</span>
                      </button>
                    ))}
                  </div>
                </div>
                <p className="graph-style-subhead">关系标签</p>
                <div className="graph-label-controls" data-testid="edge-labels">
                    <div className="graph-panel-row">
                      <span className="graph-control-label">显示文字</span>
                      <div aria-label="关系标签显示策略" className="graph-segment" data-testid="edge-label-mode" role="group">
                        {[
                          { value: "auto", label: "自动" },
                          { value: "always", label: "尽量显示" },
                          { value: "hidden", label: "隐藏" },
                        ].map((option) => {
                          const mode = style.edge.labelMode ?? (style.edge.showLabel ? "auto" : "hidden");
                          return (
                            <button
                              aria-pressed={mode === option.value}
                              className={mode === option.value ? "graph-segment-button selected" : "graph-segment-button"}
                              data-mode={option.value}
                              key={option.value}
                              onClick={() =>
                                patchStyle({
                                  ...style,
                                  preset: "custom",
                                  edge: { ...style.edge, labelMode: option.value as CanvasStyle["edge"]["labelMode"], showLabel: option.value !== "hidden" },
                                })
                              }
                              type="button"
                            >
                              {option.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    {(style.edge.labelMode ?? (style.edge.showLabel ? "auto" : "hidden")) === "always" && (
                      <p className="graph-style-label" data-testid="edge-label-budget">
                        {alwaysLabelBudget.zoomLimited
                          ? `已请求 ${alwaysLabelBudget.total} 条 · 当前缩放 ${alwaysLabelBudget.zoom}%，文字会小到看不清；放大到约 ${alwaysLabelBudget.readableAt}% 或选中关系线即可阅读`
                          : `已请求 ${alwaysLabelBudget.total} 条 · 当前可清楚阅读 ${alwaysLabelBudget.kept} 条（重叠处自动避让，放大可显示更多）`}
                      </p>
                    )}
                    {(style.edge.labelMode ?? (style.edge.showLabel ? "auto" : "hidden")) === "auto" && visibleCharacters.length > 60 && (
                      <p className="muted" data-testid="edge-label-density-note">
                        当前画布有 {visibleCharacters.length} 个角色，自动模式按密度简化：选中或指向某个角色时，它的关系线仍会显示文字；把成员减到 60 个以内则全部显示。想优先显示文字请切到「始终」。
                      </p>
                    )}
                    <NumericControl
                      ariaLabel="标签字号"
                      defaultValue={11}
                      label="字号"
                      max={18}
                      min={8}
                      onChange={(v) => patchStyle({ ...style, preset: "custom", edge: { ...style.edge, labelSize: v } })}
                      precision={1}
                      step={0.5}
                      testId="edge-label-size"
                      unit="px"
                      value={style.edge.labelSize}
                    />
                    <NumericControl
                      ariaLabel="标签沿线位置"
                      defaultValue={0.5}
                      displayScale={100}
                      label="沿线位置"
                      max={0.9}
                      min={0.1}
                      onChange={(v) => patchStyle({ ...style, preset: "custom", edge: { ...style.edge, labelT: v } })}
                      precision={0}
                      step={0.05}
                      testId="edge-label-t"
                      unit="%"
                      value={style.edge.labelT}
                    />
                    <NumericControl
                      ariaLabel="标签垂直偏移"
                      defaultValue={LABEL_OFFSET_DEFAULT}
                      label="垂直偏移"
                      max={24}
                      min={-24}
                      onChange={(v) => patchStyle({ ...style, preset: "custom", edge: { ...style.edge, labelOffset: v } })}
                      precision={0}
                      step={1}
                      testId="edge-label-offset"
                      unit="u"
                      value={style.edge.labelOffset}
                    />
                    <button
                      className="ghost-button small"
                      data-testid="edge-label-reset"
                      onClick={() =>
                        patchStyle({
                          ...style,
                          preset: "custom",
                          edge: { ...style.edge, showLabel: true, labelSize: 11, labelT: 0.5, labelOffset: LABEL_OFFSET_DEFAULT },
                        })
                      }
                      type="button"
                    >
                      恢复默认
                    </button>
                  </div>
              </div>
            </section>
  );

  /**
   * One align surface for both contexts: the page keeps it in its selection card,
   * the studio opens it under the toolbar's 排列 button. It used to be duplicated,
   * and the studio's copy was hosted by the old floating card — which is exactly how
   * a 460×151 block ended up parked over the top-left of the drawing.
   */
  const alignPanel = (
    <div className="graph-align-panel" role="group" aria-label="对齐与分布">
      <div className="graph-align-section">
        <span className="graph-align-title">对齐</span>
        <div className="graph-align-grid">
          {[
            { icon: "alignLeft", label: "左对齐", run: () => alignSelection("x", "start") },
            { icon: "alignCenterH", label: "水平居中", run: () => alignSelection("x", "center") },
            { icon: "alignRight", label: "右对齐", run: () => alignSelection("x", "end") },
            { icon: "alignTop", label: "顶对齐", run: () => alignSelection("y", "start") },
            { icon: "alignCenterV", label: "垂直居中", run: () => alignSelection("y", "center") },
            { icon: "alignBottom", label: "底对齐", run: () => alignSelection("y", "end") },
          ].map((tool) => (
            <button
              aria-label={tool.label}
              className="graph-align-button"
              data-tooltip={tool.label}
              key={tool.label}
              onClick={tool.run}
              type="button"
            >
              <Icon name={tool.icon as Parameters<typeof Icon>[0]["name"]} size={16} />
            </button>
          ))}
        </div>
      </div>
      <div className="graph-align-section">
        <span className="graph-align-title">分布</span>
        <div className="graph-align-grid">
          <button
            aria-label="水平等距"
            className="graph-align-button"
            data-tooltip={selectedIds.length < 3 ? "等距分布需要至少三个角色" : "水平等距"}
            disabled={selectedIds.length < 3}
            onClick={() => distributeSelection("x")}
            type="button"
          >
            <Icon name="distributeH" size={16} />
          </button>
          <button
            aria-label="垂直等距"
            className="graph-align-button"
            data-tooltip={selectedIds.length < 3 ? "等距分布需要至少三个角色" : "垂直等距"}
            disabled={selectedIds.length < 3}
            onClick={() => distributeSelection("y")}
            type="button"
          >
            <Icon name="distributeV" size={16} />
          </button>
        </div>
      </div>
      <p className="graph-align-note">
        {arrangeAvailability(selectedIds.length).reason ??
          "对齐与分布都按角色的实际外框计算，只改坐标，不改关系。"}
      </p>
      <div className="graph-align-foot">
        <button
          className="ghost-button small"
          data-testid="align-create-group"
          onClick={() => {
            setGroupDraft({ name: "", editingId: null });
            setIsAlignOpen(false);
            setSurface("groups");
          }}
          type="button"
        >
          创建分组
        </button>
        <button
          className="ghost-button small"
          data-testid="align-open-design"
          onClick={() => {
            setIsAlignOpen(false);
            setDesignScope("object");
            setSurface("design");
          }}
          type="button"
        >
          外观
        </button>
        <button className="ghost-button small" onClick={fitSelection} type="button">
          适应选中
        </button>
        <button
          className="ghost-button small graph-align-close"
          aria-label="关闭排列"
          onClick={() => setIsAlignOpen(false)}
          type="button"
        >
          完成
        </button>
      </div>
    </div>
  );

  const appearanceSelection = appearanceTarget(selectedIds, selectedEdgeId);
  const appearanceLabel = (() => {
    if (appearanceSelection.kind === "node") {
      const node = characters.find((character) => character.id === appearanceSelection.id);
      return node ? characterDisplayName(node) : "所选角色";
    }
    if (appearanceSelection.kind === "edge") {
      return "关系线";
    }
    if (appearanceSelection.kind === "multi") {
      return `已选 ${appearanceSelection.count} 个角色`;
    }
    return "整体画布";
  })();

  // Having something picked is not the same as editing it. `designScope` holds the
  // tab the author actually chose and survives selection changes; the rendered tab
  // falls back to the canvas only while no object exists, so clearing the selection
  // can never leave a personal-appearance form standing with nobody's values.
  const renderedDesignScope = designPanelScope(designScope, appearanceSelection);

  // 所选对象 is the edit surface for one object; 整体画布 is everything else. They are
  // two views of one panel, switched at the top, so a canvas default and a per-node
  // override can never look like the same control in two places.
  const objectTier = (
    <div className="graph-design-object" data-testid="design-object-scope">
      {!selectedEdgeId && selectedIds.length === 0 && (
        <div className="graph-design-empty" role="note">
          <strong>还没有选中对象</strong>
          <p className="muted">先在画布上点一个角色或一条关系线，这里会显示它自己的外观。</p>
        </div>
      )}
      {selectedEdgeId && (
        <div className="graph-style-local" role="group" aria-label="所选关系线外观">
          <strong>所选关系线</strong>
          {(() => {
            const edge = relationships.find((item) => item.id === selectedEdgeId);
            if (!edge) {
              return <p className="muted">这条关系已不存在。</p>;
            }
            const local = layout.edgeStyles?.[edge.id] ?? {};
            const patch = (next: Partial<NonNullable<typeof local>>, run?: string) =>
              commitLayout(
                {
                  ...layout,
                  edgeStyles: {
                    ...(layout.edgeStyles ?? {}),
                    [edge.id]: { ...local, ...next },
                  },
                },
                run,
              );
            return (
              <>
                <span className="muted">
                  {characterDisplayName(byId.get(edge.fromId)?.character ?? ({ name: "?" } as Character))} →{" "}
                  {characterDisplayName(byId.get(edge.toId)?.character ?? ({ name: "?" } as Character))} ·{" "}
                  {relationshipKindLabel(edge.kind)}
                </span>
                <p className="graph-style-state">
                  <span className="muted">状态</span>
                  <strong data-testid="edge-local-state">
                    {Object.keys(local).length ? "自定义（覆盖全局）" : "继承全局"}
                  </strong>
                </p>
                <div className="graph-style-grid">
                  <label>线条颜色
                    <input
                      aria-label="线条颜色"
                      data-testid="edge-local-color"
                      onChange={(event) => patch({ color: event.target.value })}
                      type="color"
                      value={local.color || (style.edge.byKind ? kindInk(edge.kind, style) : style.edge.color) || "#7b87a8"}
                    />
                  </label>
                  <NumericControl
                    ariaLabel="所选线宽"
                    defaultValue={style.edge.width}
                    label="线条粗细"
                    max={6}
                    min={0.4}
                    onChange={(v) => patch({ width: v }, `edge-width-${edge.id}`)}
                    precision={1}
                    step={0.1}
                    testId="edge-local-width"
                    unit="px"
                    value={local.width ?? style.edge.width}
                  />
                  <NumericControl
                    ariaLabel="所选线透明度"
                    defaultValue={style.edge.opacity}
                    displayScale={100}
                    label="透明度"
                    max={1}
                    min={0.2}
                    onChange={(v) => patch({ opacity: v }, `edge-opacity-${edge.id}`)}
                    precision={0}
                    step={0.05}
                    testId="edge-local-opacity"
                    unit="%"
                    value={local.opacity ?? style.edge.opacity}
                  />
                  <NumericControl
                    ariaLabel="所选标签字号"
                    defaultValue={style.edge.labelSize}
                    label="标签字号"
                    max={18}
                    min={8}
                    onChange={(v) => patch({ labelSize: v }, `edge-label-size-${edge.id}`)}
                    precision={1}
                    step={0.5}
                    testId="edge-local-label-size"
                    unit="px"
                    value={local.labelSize ?? style.edge.labelSize}
                  />
                  <NumericControl
                    ariaLabel="所选标签沿线位置"
                    defaultValue={style.edge.labelT}
                    displayScale={100}
                    label="标签沿线"
                    max={0.9}
                    min={0.1}
                    onChange={(v) => patch({ labelT: v }, `edge-label-t-${edge.id}`)}
                    precision={0}
                    step={0.05}
                    testId="edge-local-label-t"
                    unit="%"
                    value={local.labelT ?? style.edge.labelT}
                  />
                  <NumericControl
                    ariaLabel="所选标签偏移"
                    defaultValue={style.edge.labelOffset}
                    label="标签偏移"
                    max={24}
                    min={-24}
                    onChange={(v) => patch({ labelOffset: v }, `edge-label-offset-${edge.id}`)}
                    precision={0}
                    step={1}
                    testId="edge-local-label-offset"
                    unit="u"
                    value={local.labelOffset ?? style.edge.labelOffset}
                  />
                  <label>线型
                    <select
                      aria-label="线型"
                      data-testid="edge-local-dash"
                      onChange={(event) => patch({ dash: event.target.value as CanvasStyle["edge"]["dash"] })}
                      value={local.dash ?? style.edge.dash}
                    >
                      <option value="solid">实线</option>
                      <option value="dashed">虚线</option>
                      <option value="dotted">点线</option>
                    </select>
                  </label>
                  <label>箭头
                    <select
                      aria-label="箭头样式"
                      data-testid="edge-local-arrow"
                      onChange={(event) => patch({ arrow: event.target.value as ArrowStyle })}
                      value={local.arrow ?? style.edge.arrow}
                    >
                      <option value="concise">简洁</option>
                      <option value="thin">细线</option>
                      <option value="soft">柔和</option>
                      <option value="none">无</option>
                    </select>
                  </label>
                </div>
                <button
                  className="ghost-button"
                  data-testid="edge-local-reset"
                  disabled={!layout.edgeStyles?.[edge.id]}
                  onClick={() => {
                    const next = { ...(layout.edgeStyles ?? {}) };
                    delete next[edge.id];
                    commitLayout({ ...layout, edgeStyles: next });
                  }}
                  type="button"
                >
                  恢复继承全局
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
                <CharacterRow character={byId.get(nodeId)!.character} />
                <p className="graph-style-state">
                  <span className="muted">状态</span>
                  <strong data-testid="node-local-state">
                    {Object.keys(local).length ? "自定义（覆盖整体画布）" : "继承整体画布"}
                  </strong>
                </p>
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
                <div className="graph-style-field">
                  <span className="graph-style-label">节点形态</span>
                  <div className="graph-segment" role="group" aria-label="节点形态">
                    {[
                      { value: "avatar", label: "头像" },
                      { value: "compact", label: "圆点" },
                      { value: "card", label: "卡片" },
                    ].map((option) => {
                      const current = (local.form ?? style.node.form) === option.value;
                      return (
                        <button
                          aria-pressed={current}
                          className={current ? "graph-segment-button selected" : "graph-segment-button"}
                          key={option.value}
                          onClick={() =>
                            patch({ form: option.value as CanvasStyle["node"]["form"] })
                          }
                          type="button"
                        >
                          {option.label}
                        </button>
                      );
                    })}
                  </div>
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
      {/* Several objects are selected: say which settings a batch would have to
          change, rather than silently showing one node's controls as if it spoke
          for all of them. */}
      {!selectedEdgeId && selectedIds.length > 1 && (
        <div className="graph-style-local" role="note">
          <strong>已选 {selectedIds.length} 个角色</strong>
          <p className="muted">
            批量外观在「多个角色」页签里：那里只改边框、底色、形态、尺寸这些共有属性，
            姓名与角色设定不会被批量覆盖。要改某一个人的细节，选中它再打开这里。
          </p>
          <button
            className="ghost-button"
            onClick={() => setSurface("groups")}
            type="button"
          >
            用所选创建分组
          </button>
        </div>
      )}
    </div>
  );

  const canvasTier = (
    <div className="graph-design-canvas" data-testid="design-canvas-scope">
              <div aria-label="视图" className="graph-style-view" role="group">
        <div className="graph-style-section-head">
          <strong>视图与显示</strong>
          <span>只改本机显示，不进导出</span>
        </div>
        <div className="graph-panel-row">
          <span className="graph-control-label">名称</span>
          <div className="graph-segment">
            {[
              { label: "隐藏", on: !prefs.showNames },
              { label: "自动", on: prefs.showNames && !prefs.forceNames },
              { label: "全部", on: prefs.showNames && prefs.forceNames },
            ].map((option) => (
              <button
                aria-pressed={option.on}
                className={option.on ? "graph-segment-button selected" : "graph-segment-button"}
                key={option.label}
                onClick={() =>
                  updatePrefs(
                    option.label === "隐藏"
                      ? { showNames: false }
                      : option.label === "全部"
                        ? { showNames: true, forceNames: true }
                        : { showNames: true, forceNames: false },
                  )
                }
                type="button"
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
        <p className="graph-control-hint" data-testid="name-policy">
          {!prefs.showNames
            ? "姓名已关闭；选中角色也不再显示姓名。"
            : prefs.forceNames
              ? "全部显示：每个角色都带姓名，密集处可能互相压住。"
              : density === "all"
                ? "自动：当前缩放下放得下全部姓名。"
                : "自动：只标出关系最密的 10 个角色、当前选择与它们的直接关系；放大画布或选『全部』可看到更多。"}
        </p>
        
        <div className="graph-panel-row">
          <span className="graph-control-label">本机头像</span>
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
        </div>
        <p className="graph-scope-stats" role="status">
          角色库 {characters.length} · 画布 {currentMembers().length} · 可见{" "}
          {visibleCharacters.length} · 关系线 {prefs.showEdges ? drawnRelationships.length : 0}
          {" · "}关系线{" "}
          {prefs.showEdges
            ? `${drawnRelationships.length}/${relationships.length}`
            : `隐藏（共 ${relationships.length}）`}
        </p>

      </div>
      {/* Above the presets, because it applies to one object: what the whole
          canvas looks like is the wrong question while a single line is
          selected. */}
              {/* On a phone the half sheet opens on the quick adjustments, which is what
          it is for; the presets are one short scroll below. Desktop keeps the
          order the panel is described in: presets, quick, advanced. */}
      {isNarrowScreen ? (
        <>
          {quickTier}
          {presetTier}
        </>
      ) : (
        <>
          {presetTier}
          {quickTier}
        </>
      )}

              {/* Everything else, folded away: present when a session needs it, out of
          the way of the four controls above. Native <details> so the fold is a
          browser guarantee rather than a class that hides a live control. */}
      <details className="graph-design-advanced">
        <summary>高级选项</summary>
        <div className="graph-style-grid">

          {/* Relationship words: on/off, how big, where along the line, and how
              far off it. Global by design — a per-edge override still wins for
              colour and width, but the word belongs to the reading, not to one
              connection. */}
          

          <label>走向
            <select onChange={(event) => patchStyle({ ...style, preset: "custom", edge: { ...style.edge, curve: event.target.value as CanvasStyle["edge"]["curve"] } })} value={style.edge.curve}>
              <option value="curved">曲线</option>
              <option value="straight">直线</option>
            </select>
          </label>
          <label>画布底色
            <input aria-label="画布底色" onChange={(event) => patchStyle({ ...style, preset: "custom", canvas: { ...style.canvas, background: event.target.value } })} type="color" value={style.canvas.background || "#f7f7f8"} />
          </label>
          <label>网格
            <select onChange={(event) => patchStyle({ ...style, preset: "custom", canvas: { ...style.canvas, grid: event.target.value as CanvasStyle["canvas"]["grid"] } })} value={style.canvas.grid}>
              <option value="dots">点阵</option>
              <option value="lines">方格</option>
              <option value="none">无</option>
            </select>
          </label>
          <label className="graph-style-switch">
            位置吸附
            <input
              checked={style.canvas.snap}
              data-testid="grid-snap"
              onChange={(event) => patchStyle({ ...style, preset: "custom", canvas: { ...style.canvas, snap: event.target.checked } })}
              type="checkbox"
            />
            <span className="graph-style-value">{style.canvas.snap ? `吸附 ${style.canvas.gridSize}` : "自由"}</span>
          </label>
          <label>网格密度
            <span className="graph-style-label">间距<span className="graph-style-value">{style.canvas.gridSize}</span></span>
            <input aria-label="网格密度" max={120} min={16} onChange={(event) => patchStyle({ ...style, preset: "custom", canvas: { ...style.canvas, gridSize: Number(event.target.value) } }, "grid-size")} step={4} type="range" value={style.canvas.gridSize} />
          </label>
          <label>网格强度
            <span className="graph-style-label">不透明度<span className="graph-style-value">{Math.round(style.canvas.gridOpacity * 100)}%</span></span>
            <input aria-label="网格强度" max={0.8} min={0.05} onChange={(event) => patchStyle({ ...style, preset: "custom", canvas: { ...style.canvas, gridOpacity: Number(event.target.value) } }, "grid-opacity")} step={0.05} type="range" value={style.canvas.gridOpacity} />
          </label>
        </div>
        {/* The head is a drawing choice, not a fact about the relationship: a
            symmetric kind never draws one, and 无箭头 hides the head while the
            direction stays in the data and in 管理. */}

        <p className="graph-style-note">互为关系（友人、亲属等）不分方向，始终不画箭头。</p>
      </details>

              <button className="ghost-button" onClick={() => applyPreset("classic")} type="button">恢复整体画布默认外观</button>
    </div>
  );

  // 多个角色 is its own context, not a bigger 所选对象: it edits the shared look and
  // says so when the picks disagree. Nothing here touches names, portraits or the
  // character sheet — those are per-person and are never written in a batch.
  const batchTier = (() => {
    const ids = batchTargets(selectedIds, (id) => byId.has(id));
    const apply = (patch: Parameters<typeof applyBatchStyle>[2], run?: string) =>
      commitLayout(applyBatchStyle(layout, ids, patch, byId.keys()), run);
    const pick = <K extends keyof CanvasStyle["node"]>(key: K) =>
      mergeNodeValue(layout, ids, key, style.node);
    const inheritCount = ids.filter((id) => Object.keys(layout.nodeStyles?.[id] ?? {}).length > 0).length;
    const mixedLabel = (text: string) => <span className="graph-mixed-badge" data-testid="batch-mixed">{text}</span>;

    return (
      <div className="graph-design-object" data-testid="design-multi-scope">
        <p className="graph-style-state">
          <span className="muted">修改范围</span>
          <strong data-testid="batch-count">已选 {ids.length} 个角色</strong>
          <span className="muted">
            {inheritCount === 0 ? "全部继承整体画布" : `${inheritCount} 个已有自定义`}
          </span>
        </p>
        <p className="graph-control-hint">
          只写所选角色的外观覆盖；姓名、头像文件与角色设定不在此列，未选中的角色不受影响。
        </p>

        <NumericControl
          ariaLabel="批量节点尺寸"
          defaultValue={style.node.size}
          hint={pick("size").mixed ? `混合：${ids.map((id) => layout.nodeStyles?.[id]?.size ?? style.node.size).join(" / ")}` : undefined}
          label="节点尺寸"
          max={1.8}
          min={0.6}
          onChange={(v) => apply({ size: v }, "batch-size")}
          precision={2}
          step={0.05}
          testId="batch-size"
          unit="×"
          value={pick("size").value ?? style.node.size}
        />
        <NumericControl
          ariaLabel="批量姓名字号"
          defaultValue={style.node.nameScale}
          label="姓名字号"
          max={1.6}
          min={0.6}
          onChange={(v) => apply({ nameScale: v }, "batch-name-scale")}
          precision={2}
          step={0.05}
          testId="batch-name-scale"
          unit="×"
          value={pick("nameScale").value ?? style.node.nameScale}
        />

        <div className="graph-style-field">
          <span className="graph-style-label">
            节点形态 {pick("form").mixed ? mixedLabel("混合") : null}
          </span>
          <div className="graph-segment" role="group" aria-label="批量节点形态">
            {[
              { value: "avatar", label: "头像" },
              { value: "compact", label: "圆点" },
              { value: "card", label: "卡片" },
            ].map((option) => {
              const merged = pick("form");
              const current = merged.value === option.value;
              return (
                <button
                  aria-pressed={current}
                  className={current ? "graph-segment-button selected" : "graph-segment-button"}
                  data-testid={`batch-form-${option.value}`}
                  key={option.value}
                  onClick={() => apply({ form: option.value as CanvasStyle["node"]["form"] })}
                  type="button"
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="graph-style-field">
          <span className="graph-style-label">头像形状</span>
          <div className="graph-segment" role="group" aria-label="批量头像形状">
            {[
              { value: "auto", label: "自动" },
              { value: "circle", label: "圆形" },
              { value: "rounded", label: "圆角" },
            ].map((option) => {
              const merged = pick("avatarShape");
              const current = merged.value === option.value;
              return (
                <button
                  aria-pressed={current}
                  className={current ? "graph-segment-button selected" : "graph-segment-button"}
                  data-testid={`batch-avatar-${option.value}`}
                  key={option.value}
                  onClick={() => apply({ avatarShape: option.value as CanvasStyle["node"]["avatarShape"] })}
                  type="button"
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="graph-style-grid">
          <label>边框颜色
            <input
              aria-label="批量边框颜色"
              data-testid="batch-border"
              onChange={(event) => apply({ borderColor: event.target.value }, "batch-border")}
              type="color"
              value={pick("borderColor").value || style.node.borderColor || "#b8bfd0"}
            />
          </label>
          <label>节点底色
            <input
              aria-label="批量节点底色"
              data-testid="batch-background"
              onChange={(event) => apply({ background: event.target.value }, "batch-background")}
              type="color"
              value={pick("background").value || style.node.background || "#f4f5f8"}
            />
          </label>
        </div>

        {[
          { key: "showAvatars" as const, label: "显示头像" },
          { key: "showNames" as const, label: "显示姓名" },
          { key: "nameInside" as const, label: "姓名放在节点内" },
        ].map((row) => {
          const merged = pick(row.key);
          return (
            <div className="graph-style-field" key={row.key}>
              <span className="graph-style-label">
                {row.label} {merged.mixed ? mixedLabel("混合") : null}
              </span>
              <div className="graph-segment" role="group" aria-label={row.label}>
                {[true, false].map((on) => {
                  const current = merged.value === on;
                  return (
                    <button
                      aria-pressed={current}
                      className={current ? "graph-segment-button selected" : "graph-segment-button"}
                      data-testid={`batch-${row.key}-${on ? "on" : "off"}`}
                      key={String(on)}
                      onClick={() => apply({ [row.key]: on } as Parameters<typeof applyBatchStyle>[2])}
                      type="button"
                    >
                      {on ? "是" : "否"}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}

        <button
          className="ghost-button"
          data-testid="batch-inherit"
          disabled={ids.every((id) => !Object.keys(layout.nodeStyles?.[id] ?? {}).length)}
          onClick={() =>
            apply({
              size: undefined,
              nameScale: undefined,
              form: undefined,
              avatarShape: undefined,
              borderColor: undefined,
              background: undefined,
              showAvatars: undefined,
              showNames: undefined,
              nameInside: undefined,
            })
          }
          type="button"
        >
          恢复继承整体画布
        </button>
        <p className="graph-control-hint">
          单次修改是一次事务：撤销一次即回到这三个角色修改前的样子。
        </p>
      </div>
    );
  })();

  const stylePanel = (
    <div className="graph-style-panel" role="group" aria-label="画布外观">
      <div aria-label="设计范围" className="graph-design-scope" role="tablist">
        <button
          aria-selected={renderedDesignScope === "canvas"}
          className={renderedDesignScope === "canvas" ? "graph-design-scope-button active" : "graph-design-scope-button"}
          data-testid="design-scope-canvas"
          onClick={() => setDesignScope("canvas")}
          role="tab"
          type="button"
        >
          整体画布
        </button>
        <button
          aria-selected={renderedDesignScope === "object"}
          className={renderedDesignScope === "object" ? "graph-design-scope-button active" : "graph-design-scope-button"}
          data-testid="design-scope-object"
          disabled={appearanceSelection.kind === "canvas"}
          onClick={() => setDesignScope("object")}
          role="tab"
          title={appearanceSelection.kind === "canvas" ? "请先选择角色或关系线" : "编辑所选对象自己的外观"}
          type="button"
        >
          所选对象
        </button>
        <button
          aria-selected={renderedDesignScope === "multi"}
          className={renderedDesignScope === "multi" ? "graph-design-scope-button active" : "graph-design-scope-button"}
          data-testid="design-scope-multi"
          disabled={appearanceSelection.kind !== "multi"}
          onClick={() => setDesignScope("multi")}
          role="tab"
          title={appearanceSelection.kind === "multi" ? "同时修改所选角色的共同外观" : "选中两个以上角色后可批量设计"}
          type="button"
        >
          {appearanceSelection.kind === "multi" ? `多个角色 (${appearanceSelection.count})` : "多个角色"}
        </button>
      </div>
      {renderedDesignScope === "multi" ? batchTier : renderedDesignScope === "object" ? objectTier : canvasTier}
    </div>
  );

  // The name the appearance drawer puts in its title. It has to be the object the
  // controls underneath will change, so a node uses its own name and nothing else
  // stands in for it.
  const exportRatioValue = EXPORT_RATIOS.find((entry) => entry.value === exportRatio)?.ratio ?? 0;
  const exportAspect = exportCustomAspect ?? exportRatioValue;
  // The artwork's own rectangle: used for the frame, and for the coverage outline the
  // preview draws when a ratio or a hand-made crop leaves room around the content.
  const exportContent = exportBounds("all");
  const exportFrame = (() => {
    const base =
      exportMode === "view"
        ? exportBounds("view")
        : exportMode === "selection"
          ? exportBounds("selection")
          : exportContent;

    if (!base) {
      return null;
    }

    if (exportMode === "manual") {
      return manualFrame({
        content: base,
        zoom: exportZoom,
        panX: exportPan.x,
        panY: exportPan.y,
        ratio: exportAspect > 0 ? exportAspect : undefined,
      });
    }

    return exportAspect > 0 ? growToAspect(base, exportAspect) : base;
  })();
  // What the file will measure, computed from the same rectangle the export uses, so
  // the number beside the controls is the number in the file.
  const exportSize = exportFrame ? outputSize({ frame: exportFrame, width: exportWidth }) : null;
  const exportOpen = isExportOpen || surface === "export";

  // The preview is the file: the same serialised SVG, shown as an image. It is
  // rebuilt on a short delay because inlining presentation walks every element, and
  // that walk must not run on every pointer move while framing by hand.
  useEffect(() => {
    if (!exportOpen || !exportFrame) {
      setExportPreview(null);
      return;
    }

    const frame = exportFrame;
    const timer = window.setTimeout(() => {
      try {
        const built = buildExportSvg(frame, exportMode === "selection");
        if (!built) {
          setExportPreview(null);
          setExportPreviewError("没有可导出的内容");
          return;
        }
        setExportPreview({
          url: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(built.text)}`,
          bounds: built.bounds,
          content: exportContent,
          legend: built.legend,
          width: built.bounds.width,
          height: built.bounds.height,
        });
        setExportPreviewError(null);
      } catch (error) {
        setExportPreview(null);
        setExportPreviewError(error instanceof Error ? error.message : "预览生成失败");
      }
    }, 160);

    return () => window.clearTimeout(timer);
  }, [
    exportOpen,
    exportMode,
    exportFrame?.x,
    exportFrame?.y,
    exportFrame?.width,
    exportFrame?.height,
    exportWidth,
    prefs.exportLegend,
    prefs.exportLegendCorner,
    prefs.exportLegendScale,
    prefs.exportLegendMargin,
    prefs.exportLegendBg,
    prefs.exportLegendOpacity,
    legendNudge.x,
    legendNudge.y,
    style.canvas.background,
  ]);

  const contextBar = contextBarMode({
    previewing: Boolean(preview),
    selectedCount: selectedIds.length,
    canUndo: Boolean(arrangeUndo),
  });

  // One export body, two homes: the page header's popover and the studio's export
  // drawer. The controls, the preview and the file all come from the same frame, so
  // there is nothing that can look right in one home and wrong in the other.
  const exportBody = (
    <div className="graph-export-body" data-testid="export-body">
      <section className="graph-export-section">
        <div className="graph-export-section-head">
          <strong>构图</strong>
          <span>画面取自画布坐标，与当前缩放无关</span>
        </div>
        <div className="graph-segment graph-export-modes" role="group" aria-label="构图范围">
          {(
            [
              ["content", "内容适应"],
              ["view", "当前视口"],
              ["selection", "选中区域"],
              ["manual", "手动构图"],
            ] as Array<[typeof exportMode, string]>
          ).map(([mode, label]) => (
            <button
              aria-pressed={exportMode === mode}
              className={exportMode === mode ? "graph-segment-button selected" : "graph-segment-button"}
              data-testid={`export-mode-${mode}`}
              disabled={mode === "selection" && selectedIds.length === 0}
              key={mode}
              onClick={() => setExportMode(mode)}
              type="button"
            >
              {label}
            </button>
          ))}
        </div>
        {exportMode === "manual" && (
          <div className="graph-export-manual">
            <NumericControl
              label="取景缩放"
              max={300}
              min={33}
              onChange={(value) => setExportZoom(Math.min(3, Math.max(1 / 3, value / 100)))}
              precision={0}
              step={1}
              testId="export-zoom"
              unit="%"
              value={Math.round(exportZoom * 100)}
            />
            <button
              className="ghost-button small"
              onClick={() => {
                setExportZoom(1);
                setExportPan({ x: 0, y: 0 });
              }}
              type="button"
            >
              重置取景
            </button>
          </div>
        )}
      </section>

      <section className="graph-export-section">
        <div className="graph-export-section-head">
          <strong>画幅</strong>
          <span>{exportCustomAspect ? `自定义 ${exportCustomAspect.toFixed(2)}:1` : "按比例框住内容，不裁切"}</span>
        </div>
        <div className="graph-segment">
          {EXPORT_RATIOS.map((entry) => (
            <button
              aria-pressed={!exportCustomAspect && exportRatio === entry.value}
              className={
                !exportCustomAspect && exportRatio === entry.value
                  ? "graph-segment-button selected"
                  : "graph-segment-button"
              }
              key={entry.value}
              onClick={() => {
                setExportCustomAspect(null);
                setExportRatio(entry.value);
              }}
              type="button"
            >
              {entry.label}
            </button>
          ))}
        </div>
        <div className="graph-export-size-row">
          <label>
            <span>宽</span>
            <input
              aria-label="导出宽度"
              data-testid="export-width"
              onChange={(event) => {
                const value = Number(event.target.value);
                if (Number.isFinite(value) && value > 0) {
                  setExportWidth(Math.round(value));
                }
              }}
              type="number"
              value={exportWidth}
            />
          </label>
          <span aria-hidden="true" className="graph-export-times">
            ×
          </span>
          <label>
            <span>高</span>
            <input
              aria-label="导出高度"
              data-testid="export-height"
              onChange={(event) => {
                const value = Number(event.target.value);
                if (Number.isFinite(value) && value > 0) {
                  const aspect = exportWidth / value;
                  if (prefs.exportLockAspect) {
                    setExportWidth(Math.max(1, Math.round(value * (exportAspect || 1))));
                  } else {
                    setExportCustomAspect(aspect);
                  }
                }
              }}
              readOnly={prefs.exportLockAspect}
              type="number"
              value={exportSize?.height ?? 0}
            />
          </label>
          <button
            aria-pressed={prefs.exportLockAspect}
            className={prefs.exportLockAspect ? "ghost-button small active" : "ghost-button small"}
            onClick={() => updatePrefs({ exportLockAspect: !prefs.exportLockAspect })}
            type="button"
          >
            {prefs.exportLockAspect ? "已锁定比例" : "自由比例"}
          </button>
          <button
            className="ghost-button small"
            onClick={() => {
              setExportCustomAspect(null);
              setExportRatio("canvas");
              setExportWidth(2400);
              setExportMode("content");
              setExportZoom(1);
              setExportPan({ x: 0, y: 0 });
            }}
            type="button"
          >
            恢复默认
          </button>
        </div>
        <p className="graph-export-size" data-testid="export-size">
          {exportSize ? `${exportSize.width} × ${exportSize.height} px` : "—"}
          <em>
            {exportSize?.clipped
              ? exportSize.reason
              : `位图按此像素输出；SVG 为 ${Math.round(exportPreview?.width ?? 0)} × ${Math.round(
                  exportPreview?.height ?? 0,
                )} 单位矢量`}
          </em>
        </p>
      </section>

      <section className="graph-export-section">
        <div className="graph-export-section-head">
          <strong>预览</strong>
          <span>{exportMode === "manual" ? "拖动平移，滚轮或滑杆缩放" : "与导出文件同源，不是截图"}</span>
        </div>
        <div
          className={exportMode === "manual" ? "graph-export-preview is-manual" : "graph-export-preview"}
          data-testid="export-preview"
          onPointerDown={(event) => {
            if (exportMode !== "manual" || !exportFrame) {
              return;
            }
            const box = event.currentTarget.getBoundingClientRect();
            event.currentTarget.setPointerCapture(event.pointerId);
            exportDragRef.current = {
              x: event.clientX,
              y: event.clientY,
              pan: exportPan,
              width: box.width,
            };
          }}
          onPointerMove={(event) => {
            const drag = exportDragRef.current;
            if (!drag || !exportFrame) {
              return;
            }
            const scale = exportFrame.width / Math.max(1, drag.width);
            const next = clampPan({
              content: exportContent ?? exportFrame,
              zoom: exportZoom,
              panX: drag.pan.x + (event.clientX - drag.x) * scale,
              panY: drag.pan.y + (event.clientY - drag.y) * scale,
            });
            setExportPan({ x: next.panX, y: next.panY });
          }}
          onPointerUp={() => {
            exportDragRef.current = null;
          }}
          onWheel={(event) => {
            if (exportMode !== "manual") {
              return;
            }
            event.preventDefault();
            setExportZoom((current) => Math.min(3, Math.max(1 / 3, current * (event.deltaY < 0 ? 1.08 : 0.93))));
          }}
        >
          {exportPreview ? (
            <div
              className="graph-export-frame"
              style={{ aspectRatio: `${exportPreview.bounds.width} / ${exportPreview.bounds.height}` }}
            >
              <img alt="导出预览" draggable={false} src={exportPreview.url} />
              {exportPreview.content && exportPreview.bounds.width > 0 && (
                <span
                  aria-hidden="true"
                  className="graph-export-coverage"
                  style={{
                    left: `${((exportPreview.content.x - exportPreview.bounds.x) / exportPreview.bounds.width) * 100}%`,
                    top: `${((exportPreview.content.y - exportPreview.bounds.y) / exportPreview.bounds.height) * 100}%`,
                    width: `${(exportPreview.content.width / exportPreview.bounds.width) * 100}%`,
                    height: `${(exportPreview.content.height / exportPreview.bounds.height) * 100}%`,
                  }}
                />
              )}
              {exportPreview.legend && exportPreview.bounds.width > 0 && (
                <span
                  aria-label="拖动图例位置"
                  className="graph-export-legend-box"
                  data-testid="export-legend-box"
                  onPointerDown={(event) => {
                    event.stopPropagation();
                    const box = event.currentTarget.parentElement!.getBoundingClientRect();
                    event.currentTarget.setPointerCapture(event.pointerId);
                    legendDragRef.current = {
                      x: event.clientX,
                      y: event.clientY,
                      nudge: legendNudge,
                      width: box.width,
                    };
                  }}
                  onPointerMove={(event) => {
                    const drag = legendDragRef.current;
                    if (!drag || !exportPreview) {
                      return;
                    }
                    const scale = exportPreview.bounds.width / Math.max(1, drag.width);
                    setLegendNudge({
                      x: drag.nudge.x + (event.clientX - drag.x) * scale,
                      y: drag.nudge.y + (event.clientY - drag.y) * scale,
                    });
                  }}
                  onPointerUp={() => {
                    legendDragRef.current = null;
                  }}
                  role="presentation"
                  style={{
                    left: `${((exportPreview.legend.x - exportPreview.bounds.x) / exportPreview.bounds.width) * 100}%`,
                    top: `${((exportPreview.legend.y - exportPreview.bounds.y) / exportPreview.bounds.height) * 100}%`,
                    width: `${(exportPreview.legend.width / exportPreview.bounds.width) * 100}%`,
                    height: `${(exportPreview.legend.height / exportPreview.bounds.height) * 100}%`,
                  }}
                />
              )}
            </div>
          ) : (
            <span className="graph-export-empty">{exportPreviewError ?? "正在生成预览…"}</span>
          )}
        </div>
        <p className="muted graph-export-note">
          虚线为内容覆盖范围，虚线之外是留白。预览与 PNG / JPG / PDF 输出同一份帧，SVG 保持矢量。
        </p>
      </section>

      <section className="graph-export-section">
        <div className="graph-export-section-head">
          <strong>图例</strong>
          <span>只列实际画出的关系类型</span>
        </div>
        <div className="graph-panel-row">
          <span className="graph-control-label">显示</span>
          <div className="graph-segment">
            {[
              { value: false, label: "不显示" },
              { value: true, label: "显示" },
            ].map((option) => (
              <button
                aria-pressed={prefs.exportLegend === option.value}
                className={prefs.exportLegend === option.value ? "graph-segment-button selected" : "graph-segment-button"}
                key={option.label}
                onClick={() => updatePrefs({ exportLegend: option.value })}
                type="button"
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
        {prefs.exportLegend && (
          <>
            <div className="graph-panel-row">
              <span className="graph-control-label">位置</span>
              <div className="graph-segment">
                {(
                  [
                    ["auto", "自动"],
                    ["tl", "左上"],
                    ["tr", "右上"],
                    ["bl", "左下"],
                    ["br", "右下"],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    aria-pressed={prefs.exportLegendCorner === value}
                    className={
                      prefs.exportLegendCorner === value ? "graph-segment-button selected" : "graph-segment-button"
                    }
                    key={value}
                    onClick={() => updatePrefs({ exportLegendCorner: value })}
                    type="button"
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <NumericControl
              label="图例大小"
              max={220}
              min={50}
              onChange={(value) => updatePrefs({ exportLegendScale: value / 100 })}
              precision={0}
              step={5}
              testId="legend-scale"
              unit="%"
              value={Math.round(prefs.exportLegendScale * 100)}
            />
            <NumericControl
              label="图例边距"
              max={12}
              min={0}
              onChange={(value) => updatePrefs({ exportLegendMargin: value / 100 })}
              precision={0}
              step={1}
              testId="legend-margin"
              unit="%"
              value={Math.round(prefs.exportLegendMargin * 100)}
            />
            <div className="graph-panel-row">
              <span className="graph-control-label">背景</span>
              <div className="graph-segment">
                {(
                  [
                    ["canvas", "随画布"],
                    ["panel", "独立面板"],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    aria-pressed={prefs.exportLegendBg === value}
                    className={prefs.exportLegendBg === value ? "graph-segment-button selected" : "graph-segment-button"}
                    key={value}
                    onClick={() => updatePrefs({ exportLegendBg: value })}
                    type="button"
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <NumericControl
              label="图例透明度"
              max={100}
              min={20}
              onChange={(value) => updatePrefs({ exportLegendOpacity: value / 100 })}
              precision={0}
              step={5}
              testId="legend-opacity"
              unit="%"
              value={Math.round(prefs.exportLegendOpacity * 100)}
            />
            <button
              className="ghost-button small"
              data-testid="legend-reset"
              onClick={() => setLegendNudge({ x: 0, y: 0 })}
              type="button"
            >
              {legendNudge.x || legendNudge.y ? "把图例放回角落" : "可在预览中拖动图例"}
            </button>
          </>
        )}
      </section>


      <section className="graph-export-section">
        <div className="graph-export-section-head">
          <strong>导出</strong>
          <span>{exporting ? "正在生成…" : "确认后立即下载"}</span>
        </div>
        <div className="graph-export-formats" role="group" aria-label="导出格式">
          {(
            [
              ["png", "PNG", "位图"],
              ["svg", "SVG", "矢量"],
              ["jpg", "JPG", "位图"],
              ["pdf", "PDF", "单页"],
            ] as Array<["png" | "svg" | "jpg" | "pdf", string, string]>
          ).map(([format, label, kind]) => (
            <button
              className="graph-export-format"
              data-testid={`export-${format}`}
              disabled={exporting || !exportPreview}
              key={format}
              onClick={() => void runExportFormat(format)}
              type="button"
            >
              <strong>{label}</strong>
              <span>{kind}</span>
            </button>
          ))}
        </div>
        <p className="muted graph-export-note">
          JPG / PDF 由同一张位图输出（PDF 为单页、页面即画幅）；SVG 保留矢量，位图倍率对它无效。
        </p>
      </section>
    </div>
  );

  const exportMenu = (
    <div className="graph-display-wrap graph-export-wrap" ref={exportWrapRef}>
      <button
        aria-expanded={isExportOpen}
        className={isExportOpen ? "graph-toggle active" : "graph-toggle"}
        onClick={() => setIsExportOpen((current) => !current)}
        type="button"
      >
        <Icon name="download" size={15} />
        <span>导出</span>
      </button>
      {isExportOpen &&
        createPortal(
          <div
            aria-label="导出关系网"
            className="graph-panel graph-export-panel"
            ref={exportPanelRef}
            role="group"
            style={
              exportBox
                ? {
                    position: "fixed",
                    left: exportBox.left,
                    top: exportBox.top,
                    maxHeight: exportBox.maxHeight,
                    overflowY: "auto",
                    bottom: "auto",
                    right: "auto",
                  }
                : { visibility: "hidden" }
            }
          >
            {exportBody}
          </div>,
          document.body,
        )}
    </div>
  );

  const panelCharacters = useMemo(() => {
    const base = query.trim() ? searchResults : characters;
    if (memberFilter === "all") return base;
    const on = new Set(currentMembers());
    return base.filter((character) => (memberFilter === "canvas" ? on.has(character.id) : !on.has(character.id)));
  }, [query, searchResults, characters, memberFilter, canvasMembers]);

  const charactersPanelContent = (
    <div className="graph-studio-characters-body">
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

      <div className="graph-members-head">
        <span className="graph-members-count" data-testid="members-count">
          画布 {currentMembers().length} / 角色库 {characters.length}
        </span>
        <div className="graph-members-tabs" role="group" aria-label="画布成员筛选">
          {([
            ["all", "全部"],
            ["canvas", "在画布"],
            ["off", "未加入"],
          ] as const).map(([value, label]) => (
            <button
              aria-pressed={memberFilter === value}
              className="ghost-button small"
              data-testid={`member-filter-${value}`}
              key={value}
              onClick={() => setMemberFilter(value)}
              type="button"
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Two levels, not one row of four: the mode switch stays put, everything that
          acts on the whole library moves into 更多, and the buttons for the current
          selection get their own full-width bar. */}
      <div className="graph-members-bulk">
        <button
          aria-pressed={memberBatch}
          className="ghost-button small"
          data-testid="member-batch"
          onClick={() => {
            setMemberBatch((open) => !open);
            setMemberSelection([]);
          }}
          type="button"
        >
          {memberBatch ? "退出批量" : "批量选择"}
        </button>
        <button
          className="ghost-button small graph-wide-only"
          data-testid="member-add-all"
          onClick={addAllToCanvas}
          type="button"
        >
          全部加入
        </button>
        <button
          aria-expanded={memberMore}
          aria-haspopup="menu"
          className="ghost-button small"
          data-testid="member-more"
          onClick={() => setMemberMore((open) => !open)}
          type="button"
        >
          更多
        </button>
      </div>

      {memberMore && (
        <div className="graph-members-more" data-testid="member-more-panel" role="menu">
          <button
            data-testid="member-add-all-menu"
            onClick={() => {
              addAllToCanvas();
              setMemberMore(false);
            }}
            role="menuitem"
            type="button"
          >
            全部加入画布
          </button>
          <button
            onClick={() => {
              setMemberBatch(true);
              setMemberSelection(
                panelCharacters
                  .filter((character) => !currentMembers().includes(character.id))
                  .map((character) => character.id),
              );
              setMemberMore(false);
            }}
            role="menuitem"
            type="button"
          >
            选中未加入的角色
          </button>
          <button
            onClick={() => {
              setMemberBatch(true);
              setMemberSelection(panelCharacters.map((character) => character.id));
              setMemberMore(false);
            }}
            role="menuitem"
            type="button"
          >
            选中当前列表全部
          </button>
        </div>
      )}

      {memberBatch && (
        <div className="graph-members-selection" data-testid="member-selection">
          <span className="graph-members-selection-count">已选 {memberSelection.length}</span>
          <button
            className="primary-button small"
            data-testid="member-batch-add"
            disabled={memberSelection.length === 0}
            onClick={() => addToCanvas(memberSelection)}
            type="button"
          >
            {memberSelection.length ? `加入所选 ${memberSelection.length}` : "加入画布"}
          </button>
          <button
            className="ghost-button small"
            data-testid="member-batch-remove"
            disabled={memberSelection.length === 0}
            onClick={() => removeFromCanvas(memberSelection)}
            type="button"
          >
            {memberSelection.length ? `移出所选 ${memberSelection.length}` : "移出画布"}
          </button>
        </div>
      )}

      <div className="graph-studio-list" role="listbox" aria-label="角色列表">
        {panelCharacters.map((character) => {
          const onCanvas = currentMembers().includes(character.id);
          return (
            <div
              className={`graph-studio-row${focusId === character.id ? " active" : ""}`}
              data-character-name={character.name}
              data-member-id={character.id}
              data-on-canvas={onCanvas ? "true" : "false"}
              data-testid="member-row"
              key={character.id}
            >
              {memberBatch && (
                <input
                  aria-label={`选择 ${character.name}`}
                  checked={memberSelection.includes(character.id)}
                  data-member-id={character.id}
                  data-testid="member-select"
                  onChange={(event) =>
                    setMemberSelection((current) =>
                      event.target.checked
                        ? [...current, character.id]
                        : current.filter((id) => id !== character.id),
                    )
                  }
                  type="checkbox"
                />
              )}
              <button
                aria-selected={focusId === character.id}
                className="graph-studio-row-main"
                onClick={() => focusCharacter(character)}
                role="option"
                type="button"
              >
                <CharacterRow character={character} />
                <span className="graph-studio-row-state" data-testid="member-state">
                  {onCanvas ? "在画布" : "未加入"}
                </span>
              </button>
              <button
                aria-label={onCanvas ? `把 ${character.name} 移出画布` : `把 ${character.name} 加入画布`}
                className="ghost-button small graph-member-toggle"
                data-action={onCanvas ? "remove" : "add"}
                data-member-id={character.id}
                data-testid="member-toggle"
                onClick={() => (onCanvas ? removeFromCanvas([character.id]) : addToCanvas([character.id]))}
                type="button"
              >
                {onCanvas ? "移出" : "加入"}
              </button>
            </div>
          );
        })}
        {query.trim() && searchResults.length === 0 && (
          <p className="muted">没有匹配的角色。</p>
        )}
        {!query.trim() && panelCharacters.length === 0 && (
          // "未加入" on a canvas holding the whole roster is a legitimate empty answer,
          // and an empty box reads like a broken panel.
          <p className="muted">没有符合这个筛选的角色。</p>
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
            className="ghost-button graph-studio-group-add"
            disabled={selectedIds.length === 0}
            onClick={() => setGroupDraft({ name: "", editingId: null })}
            type="button"
          >
            用所选创建分组（{selectedIds.length}）
          </button>
        )}
      </div>
    </div>
  );

  // A six-person drawing does not need a spotlight to be read: naming the selected
  // character's direct relations is the whole job. The same block is capped on a large
  // network by `neighbourPreview`, so the lens and spotlight below stay the main tools.
  const focusedNeighbours = selectedIds.length === 1 ? neighbourPreview(relationships, selectedIds[0]) : null;

  const explorePanelContent = (
    <div className="graph-explore-section">
      {/* Small networks first: who this person is next to. Large ones get the same
          block, capped, because the lens and spotlight are what they actually need. */}
      {focusedNeighbours && (
        <div className="graph-explore-focus">
          <div className="graph-explore-focus-head">
            <strong>
              {byId.get(selectedIds[0])
                ? characterDisplayName(byId.get(selectedIds[0])!.character)
                : "所选角色"}
            </strong>
            <span>{focusedNeighbours.total} 条直接关系</span>
          </div>
          {focusedNeighbours.rows.length > 0 ? (
            <ul className="graph-explore-neighbours">
              {focusedNeighbours.rows.map((row) => {
                // A cut-off name is still a name: the row shows an ellipsis, so the
                // full one has to be reachable without leaving the panel.
                const other = byId.get(row.otherId);
                const name = other ? characterDisplayName(other.character) : "未命名角色";
                return (
                <li key={row.id}>
                  <span className="graph-explore-neighbour-name" title={name}>
                    {name}
                  </span>
                  <span className="graph-explore-neighbour-kind">
                    {relationshipKindLabel(row.kind)}
                  </span>
                </li>
                );
              })}
            </ul>
          ) : (
            <p className="muted">这个角色还没有任何关系。</p>
          )}
          {focusedNeighbours.hidden > 0 && (
            <p className="muted">另有 {focusedNeighbours.hidden} 条，见关系管理。</p>
          )}
        </div>
      )}
      <div className="graph-explore-note">
        <span className="graph-explore-count">
          透镜 {lensKinds.length ? `${lensKinds.length} 类` : "未开启"}
        </span>
        <span>
          {lensKinds.length
            ? `正在强调：${lensKinds.map((kind) => relationshipKindLabel(kind)).join("、")}`
            : "选中关系类型后，其它类型淡出但仍保留。"}
        </span>
      </div>
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
        <p className="graph-explore-hint">
          {spotlightId
            ? `高亮 ${spotlightSet?.size ?? 0} 个角色，其余淡出；只改显示，不改关系。`
            : "选中一个角色后开启，查看它的直接关系或两层关系。"}
        </p>

        <strong className="graph-studio-section">关系类型透镜</strong>
        <div className="graph-lens" role="group" aria-label="关系类型透镜">
          {presentKinds.map((kind) => (
            <button
              aria-pressed={lensKinds.includes(kind)}
              className={lensKinds.includes(kind) ? "graph-lens-chip active" : "graph-lens-chip"}
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
        </div>
        <button
          className="ghost-button graph-lens-clear"
          disabled={lensKinds.length === 0}
          onClick={() => setLensKinds([])}
          type="button"
        >
          {lensKinds.length ? `清除透镜（${lensKinds.length}）` : "未选择透镜"}
        </button>
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
          {(layout.bookmarks ?? []).map((bookmark) => {
            const editing = bookmarkEditingId === bookmark.id;
            const menuOpen = bookmarkMenuId === bookmark.id;
            return (
              <li className="graph-bookmark-row" key={bookmark.id}>
                {editing ? (
                  <form
                    className="graph-bookmark-rename"
                    onSubmit={(event) => {
                      event.preventDefault();
                      renameBookmark(bookmark.id, bookmarkNameDraft);
                    }}
                  >
                    <input
                      aria-label={`重命名书签 ${bookmark.name}`}
                      autoFocus
                      maxLength={40}
                      onChange={(event) => setBookmarkNameDraft(event.target.value)}
                      value={bookmarkNameDraft}
                    />
                    <button className="primary-button" disabled={!bookmarkNameDraft.trim()} type="submit">
                      保存
                    </button>
                    <button className="ghost-button" onClick={() => setBookmarkEditingId(null)} type="button">
                      取消
                    </button>
                  </form>
                ) : (
                  <>
                    <button
                      className="graph-bookmark-jump"
                      onClick={() => jumpToBookmark(bookmark)}
                      title={bookmark.name}
                      type="button"
                    >
                      <span>{bookmark.name}</span>
                      <em>{Math.round(bookmark.view.k * 100)}%</em>
                    </button>
                    <button
                      aria-expanded={menuOpen}
                      aria-haspopup="menu"
                      aria-label={`书签 ${bookmark.name} 的更多操作`}
                      className="graph-bookmark-more"
                      onClick={() => setBookmarkMenuId(menuOpen ? null : bookmark.id)}
                      type="button"
                    >
                      ⋯
                    </button>
                    {menuOpen && (
                      <div className="graph-bookmark-menu" role="menu">
                        <button
                          onClick={() => {
                            setBookmarkEditingId(bookmark.id);
                            setBookmarkNameDraft(bookmark.name);
                            setBookmarkMenuId(null);
                          }}
                          role="menuitem"
                          type="button"
                        >
                          重命名
                        </button>
                        <button
                          onClick={() => removeBookmark(bookmark)}
                          role="menuitem"
                          type="button"
                        >
                          删除
                        </button>
                      </div>
                    )}
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {bookmarkNotice && (
        <p className="graph-bookmark-notice" role="status">
          <span>{bookmarkNotice.text}</span>
          {bookmarkNotice.removed && (
            <button className="ghost-button" onClick={undoRemoveBookmark} type="button">
              撤销
            </button>
          )}
        </p>
      )}
      <p className="muted">书签只记录视角，不复制任何角色数据。</p>
    </div>
  );

  const heroHeader = (
  <WorkspaceHeader
    compact
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
        <div className="toolbar-group graph-wide-only">
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
        <div className="toolbar-group">
          {/* Output sits with the page's other main action; the entry under the
              drawing is gone. */}
          {!isStudio && exportMenu}
          <button className="primary-button" disabled={!canLink} onClick={openDraft} type="button">
            新建关系
          </button>
        </div>
      </>
    }
  />
  );

  const pageBody = (
    <>
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
          <div className="graph-canvas-head">
          {/* On a phone the hero is identity only: which view you are in is a property
              of the workspace, and it sits an inch above the list it switches. */}
          {isNarrowScreen && !isStudio && (
            <div aria-label="关系网视图" className="graph-segment relationship-mode graph-mobile-views" role="group">
              <button
                aria-pressed={boardMode === "graph"}
                className={boardMode === "graph" ? "graph-segment-button selected" : "graph-segment-button"}
                onClick={() => chooseBoardMode("graph")}
                type="button"
              >
                图谱
              </button>
              <button
                aria-pressed={(boardMode as string) === "manage"}
                className={(boardMode as string) === "manage" ? "graph-segment-button selected" : "graph-segment-button"}
                onClick={() => chooseBoardMode("manage")}
                type="button"
              >
                管理
                <span className="relationship-mode-count">{relationships.length}</span>
              </button>
            </div>
          )}
          <div className={`graph-tool-strip${isStudio ? " is-studio" : ""}`}>
            {/* The search is the one entry that is not an icon: it is a field, and
                on a phone it keeps its own row above the canvas while the toolbar
                moves to the bottom edge. */}
            {!isStudio && (
            <div className="graph-search-wrap" ref={searchWrapRef}>
              <WorkspaceSearch
                className="graph-search"
                label="搜索角色并定位"
                onChange={(next) => {
                  setQuery(next);
                  setNotOnCanvas(null);
                }}
                onOpenChange={setIsSearchOpen}
                open={isSearchOpen}
                placeholder="搜索角色名、职业、世界观"
                testId="graph-search"
                value={query}
              />
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
          <div
            className={`graph-canvas-tools${isStudio ? " studio-dock" : ""}`}
            data-yielded={surfaceIsOpen(surface) ? "true" : undefined}
          >
            {/* In the studio the search lives in the left drawer, where it sits with
                the list it filters instead of over the drawing. */}

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

            {/* One toolbar for both surfaces: the page's strip above the drawing and
                the studio's dock below it. High-frequency entries only, each an icon
                with a tooltip, an aria-label and a focus ring. Everything that edits
                the drawing for longer than one press opens a drawer instead. */}
            <div
              aria-label="画布工具"
              className={`graph-toolbar${isStudio ? " in-studio" : ""}`}
              role="toolbar"
            >
              <div aria-label="缩放" className="graph-tool-cluster" role="group">
                <button
                  aria-label="缩小画布"
                  className="graph-icon-button"
                  data-tooltip="缩小（−）"
                  onClick={() => zoomBy(1 / 1.25)}
                  type="button"
                >
                  <Icon name="minus" size={15} />
                </button>
                <button
                  aria-label={`当前缩放 ${Math.round(effectiveZoom * 100)}%，点按适应画布`}
                  className="graph-zoom-readout"
                  data-tooltip="适应画布（0）"
                  onClick={resetView}
                  type="button"
                >
                  {Math.round(effectiveZoom * 100)}%
                </button>
                <button
                  aria-label="放大画布"
                  className="graph-icon-button"
                  data-tooltip="放大（+）"
                  onClick={() => zoomBy(1.25)}
                  type="button"
                >
                  <Icon name="plus" size={15} />
                </button>
              </div>

              <button
                aria-label="适应画布"
                className="graph-icon-button"
                data-tooltip="适应画布（0）：让全部角色与姓名进入视野"
                onClick={resetView}
                type="button"
              >
                <Icon name="fit" size={16} />
              </button>

              {/* History is always one press away on a wide screen. A phone moves the
                  same two commands into 更多 rather than shrinking the dock. In the
                  studio the top bar owns them, so the dock stays a canvas surface. */}
              {!isStudio && (
                <>
                  <button
                    aria-label="撤销"
                    className="graph-icon-button graph-tool-history"
                    data-tooltip={`撤销（${modKey}Z）`}
                    disabled={undoRef.current.length === 0}
                    onClick={undoLayout}
                    type="button"
                  >
                    <Icon name="undo" size={16} />
                  </button>
                  <button
                    aria-label="重做"
                    className="graph-icon-button graph-tool-history"
                    data-tooltip={`重做（⇧${modKey}Z）`}
                    disabled={redoRef.current.length === 0}
                    onClick={redoLayout}
                    type="button"
                  >
                    <Icon name="redo" size={16} />
                  </button>

                  <span aria-hidden="true" className="graph-tool-sep" />
                </>
              )}

              <button
                aria-label={selectMode ? "选择工具（已开启）" : "选择工具"}
                aria-pressed={selectMode}
                className="graph-icon-button graph-desktop-select"
                data-tooltip={
                  selectMode
                    ? "选择工具已开启（V）：空白处拖动框选，Esc 退出"
                    : "选择工具（V）：从空白处拖动框选角色"
                }
                onClick={() => {
                  setSelectMode((current) => {
                    if (current) {
                      setSelectedIds([]);
                    } else {
                      setPanMode(false);
                      setMultiSelectMode(false);
                    }
                    return !current;
                  });
                  setIsMoreOpen(false);
                }}
                type="button"
              >
                <Icon name="select" size={16} />
              </button>

              <button
                aria-label={multiSelectMode ? "多选模式（已开启）" : "多选模式"}
                aria-pressed={multiSelectMode}
                className={`graph-icon-button graph-touch-select${multiSelectMode ? " active" : ""}`}
                data-tooltip={
                  multiSelectMode
                    ? "多选模式已开启：点按增删角色，Esc 退出"
                    : "多选模式：无需按键，连续点按选择多个角色"
                }
                onClick={() => {
                  const next = !multiSelectMode;
                  if (!next) {
                    // Uniform rule on the way out: one target is still a selection,
                    // a group only existed for the mode, so it is dropped. The
                    // dimming goes with it because it was never anything but display.
                    setSelectedIds((current) => (current.length > 1 ? [] : current));
                  } else {
                    setPanMode(false);
                    setSelectMode(false);
                  }
                  setMultiSelectMode(next);
                  setIsMoreOpen(false);
                }}
                type="button"
              >
                <Icon name="checkSquare" size={16} />
              </button>

              {/* A trackpad has no middle button, so panning needs a tool as well as a
                  key. It replaces the selection tool while it is on: two drag tools
                  cannot share the same empty canvas. */}
              <button
                aria-label={panMode ? "平移工具（已开启）" : "平移工具"}
                aria-pressed={panMode}
                className="graph-icon-button"
                data-tooltip={
                  panMode
                    ? "平移工具已开启（H）：拖动即平移，Esc 退出"
                    : "平移工具（H）：拖动平移画布，不移动角色"
                }
                onClick={() => {
                  setPanMode((current) => {
                    if (!current) {
                      setSelectMode(false);
                      setMarquee(null);
                      marqueeRef.current = null;
                    }
                    return !current;
                  });
                  setIsMoreOpen(false);
                }}
                type="button"
              >
                <Icon name="hand" size={16} />
              </button>

              {!isStudio && (
                <button
                  aria-expanded={surface === "characters"}
                  aria-label="角色面板"
                  className="graph-icon-button graph-wide-only"
                  data-testid="open-characters"
                  data-tooltip="角色：搜索、决定谁在这张画布上、视觉分组"
                  onClick={() => openGraphSurface("characters")}
                  type="button"
                >
                  <Icon name="list" size={16} />
                </button>
              )}

              {!isStudio && (
                <button
                  aria-expanded={surface === "arrange"}
                  aria-label="整理画布"
                  className="graph-icon-button"
                  data-tooltip="整理：关系聚类、环形、网格、层级与按尺寸排开"
                  onClick={() => openGraphSurface("arrange")}
                  type="button"
                >
                  <Icon name="layout" size={16} />
                </button>
              )}

              {/* The studio's top bar already owns 设计, so the dock does not repeat it. */}
              {!isStudio && (
                <button
                  aria-expanded={surface === "design"}
                  aria-label="外观设置"
                  className="graph-icon-button"
                  data-tooltip="外观：画布、所选角色或所选关系线"
                  onClick={() => openGraphSurface("design")}
                  type="button"
                >
                  <Icon name="sliders" size={16} />
                </button>
              )}

              {!isStudio && (
              <div className="graph-more-wrap" ref={moreWrapRef}>
                <button
                  aria-expanded={isMoreOpen}
                  aria-label="更多工具"
                  className="graph-icon-button"
                  data-tooltip="更多工具"
                  onClick={() => setIsMoreOpen((open) => !open)}
                  type="button"
                >
                  <Icon name="more" size={16} />
                </button>
                {isMoreOpen && (
                  <div aria-label="更多工具" className={`graph-more-menu${morePlacement === "up" ? " opens-up" : ""}`} role="menu">
                    {!isStudio && (
                      // The dock cannot hold another 32px control at 320px without
                      // pushing 更多 off the edge, so on a phone the roster lives here.
                      <button
                        className="graph-more-item graph-more-only-narrow"
                        onClick={() => openGraphSurface("characters")}
                        role="menuitem"
                        type="button"
                      >
                        <Icon name="list" size={15} />
                        <span>角色与画布</span>
                      </button>
                    )}
                    {!isStudio && (
                      <button
                        className="graph-more-item"
                        onClick={() => openGraphSurface("groups")}
                        role="menuitem"
                        type="button"
                      >
                        <Icon name="layers" size={15} />
                        <span>视觉分组</span>
                        {layout.groups.length > 0 && <em>{layout.groups.length}</em>}
                      </button>
                    )}
                    {isStudio && (
                      <button
                        className="graph-more-item"
                        onClick={() => openGraphSurface("characters")}
                        role="menuitem"
                        type="button"
                      >
                        <Icon name="layers" size={15} />
                        <span>角色与分组</span>
                      </button>
                    )}
                    <button
                      className="graph-more-item graph-more-only-narrow"
                      disabled={undoRef.current.length === 0}
                      onClick={() => {
                        setIsMoreOpen(false);
                        undoLayout();
                      }}
                      role="menuitem"
                      type="button"
                    >
                      <Icon name="undo" size={15} />
                      <span>撤销</span>
                    </button>
                    <button
                      className="graph-more-item graph-more-only-narrow"
                      disabled={redoRef.current.length === 0}
                      onClick={() => {
                        setIsMoreOpen(false);
                        redoLayout();
                      }}
                      role="menuitem"
                      type="button"
                    >
                      <Icon name="redo" size={15} />
                      <span>重做</span>
                    </button>
                    {previousView && (
                      <button
                        className="graph-more-item"
                        onClick={() => {
                          setIsMoreOpen(false);
                          restoreView();
                        }}
                        role="menuitem"
                        type="button"
                      >
                        <Icon name="refresh" size={15} />
                        <span>回到上一个视角</span>
                      </button>
                    )}
                    <button
                      className="graph-more-item"
                      onClick={() => {
                        setIsMoreOpen(false);
                        resetToDefaultView();
                      }}
                      role="menuitem"
                      type="button"
                    >
                      <Icon name="maximize" size={15} />
                      <span>重置视角</span>
                    </button>
                    {!isStudio && (
                      <button
                        className="graph-more-item graph-more-only-narrow"
                        onClick={() => {
                          setIsMoreOpen(false);
                          enterStudio();
                        }}
                        role="menuitem"
                        type="button"
                      >
                        <Icon name="maximize" size={15} />
                        <span>全屏编辑</span>
                      </button>
                    )}
                  </div>
                )}
              </div>
              )}

              {!isStudio && (
                <button
                  aria-label="全屏编辑"
                  className="graph-studio-entry-button"
                  data-tooltip="全屏编辑：在更大的空间里整理这张关系图（应用内全屏）"
                  onClick={enterStudio}
                  type="button"
                >
                  <Icon name="maximize" size={15} />
                  <span>全屏编辑</span>
                </button>
              )}
            </div>
            </div>
          </div>

          {visibleCharacters.length < characters.length && (
            <p
              className="graph-scope-note"
              role="status"
              title="画布上只画成员。要把没有关系的角色也放上画布，用「角色与分组」加入即可。"
            >
              可见 {visibleCharacters.length} / 画布 {currentMembers().length} 个角色 ·{" "}
              {prefs.showEdges ? `${drawnRelationships.length} 条关系` : "关系线已隐藏"}
            </p>
          )}
          </div>

          {/* State, not actions: which tool is on and whether moves snap. Shown only
              when it differs from the default, so a phone does not pay for it. */}
          {(selectMode || multiSelectMode || style.canvas.snap || shiftAxis) && (
            <div className="graph-status-row" data-testid="graph-status">
              {multiSelectMode || selectMode ? (
                <span className="graph-status-chip on" data-testid="status-tool">
                  {multiSelectMode ? "多选" : "选择工具"}
                </span>
              ) : null}
              {style.canvas.snap && (
                <span className="graph-status-chip on" data-testid="status-snap">
                  吸附 {style.canvas.gridSize}
                </span>
              )}
              {shiftAxis && (
                <span className="graph-status-chip on" data-testid="status-shift">
                  Shift 锁定{shiftAxis === "x" ? "水平" : "垂直"}
                </span>
              )}
            </div>
          )}

          {notOnCanvas && (
            <div className="graph-notice" role="status">
              <p>
                「{characterDisplayName(notOnCanvas)}」尚未加入当前画布。
              </p>
              <button
                className="ghost-button"
                onClick={() => {
                  addToCanvas([notOnCanvas.id]);
                  setFocusId(notOnCanvas.id);
                  setPendingFocusId(notOnCanvas.id);
                  setNotOnCanvas(null);
                }}
                type="button"
              >
                加入画布并定位
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
          <div
            className={`graph-canvas-row${isStudio ? " is-studio" : ""}${
              !isStudio && surface !== "none" ? " has-drawer" : ""
            }`}
          >
          <div className="graph-canvas-holder" ref={holderRef}>
          <div
            className="graph-canvas-frame"
            ref={attachFrame}
            /* The colour the author picked has to be the colour they see, not only
               the colour the exported file gets. */
            style={style.canvas.background ? { background: style.canvas.background } : undefined}
          >
          {exporting && prefs.exportLegend && legendEntries.length > 0 && (() => {
            // JPG/PDF capture this element, so the legend has to exist here while the
            // capture runs. Its corner is chosen against the nodes' real screen boxes;
            // a captured frame cannot grow a margin, so the least-busy corner wins
            // even when every corner touches something.
            const rowHeight = 16;
            const padding = 9;
            const panelWidth = 132;
            const panelHeight = padding * 2 + 18 + legendEntries.length * rowHeight;
            const margin = 8;
            const corners = {
              tl: { x: margin, y: margin },
              tr: { x: frameSize.width - panelWidth - margin, y: margin },
              bl: { x: margin, y: frameSize.height - panelHeight - margin },
              br: {
                x: frameSize.width - panelWidth - margin,
                y: frameSize.height - panelHeight - margin,
              },
            } as const;
            const scale = measured ? canvasScreenScale(frameSize, canvas.viewBox) : 0;
            const [boxX, boxY] = canvas.viewBox.split(" ").map(Number);
            const boxes = visibleCharacters.map((character, index) => {
              const geom = nodeVisuals[character.id]?.geom;
              if (!geom || !scale) {
                return null;
              }
              const point = positions[index];
              const cx = (point.x * view.k + view.x - boxX) * scale;
              const cy = (point.y * view.k + view.y - boxY) * scale;
              return {
                x: cx - geom.halfWidth * view.k * scale,
                y: cy - geom.halfHeight * view.k * scale,
                width: geom.halfWidth * 2 * view.k * scale,
                height: geom.halfHeight * 2 * view.k * scale,
              };
            }).filter(Boolean) as { x: number; y: number; width: number; height: number }[];
            const overlapCount = (corner: { x: number; y: number }) =>
              boxes.filter(
                (box) =>
                  corner.x < box.x + box.width + 6 &&
                  corner.x + panelWidth > box.x - 6 &&
                  corner.y < box.y + box.height + 6 &&
                  corner.y + panelHeight > box.y - 6,
              ).length;
            const order: Array<keyof typeof corners> =
              prefs.exportLegendCorner === "auto"
                ? ["tl", "tr", "bl", "br"]
                : [prefs.exportLegendCorner];
            const chosen = order
              .map((key) => ({ key, hits: overlapCount(corners[key]) }))
              .sort((a, b) => a.hits - b.hits)[0].key;
            const position = corners[chosen];

            return (
              <div
                aria-hidden="true"
                className="export-legend"
                style={{
                  background: surfaceBackground(),
                  left: `${position.x}px`,
                  top: `${position.y}px`,
                  width: `${panelWidth}px`,
                }}
              >
                <strong>关系类型</strong>
                {legendEntries.map((entry) => (
                  <span className="export-legend-row" key={entry.kind}>
                    <svg aria-hidden="true" height="8" viewBox="0 0 26 8" width="26">
                      <line
                        stroke={entry.color}
                        strokeDasharray={entry.dash}
                        strokeWidth={entry.width}
                        x1="1"
                        x2={entry.directed ? 21 : 25}
                        y1="4"
                        y2="4"
                      />
                      {entry.directed && (
                        <polygon fill={entry.color} points="25,4 20,1.4 20,6.6" />
                      )}
                    </svg>
                    <em>{entry.label}</em>
                  </span>
                ))}
              </div>
            );
          })()}
          <svg
            aria-hidden="true"
            className={`relationship-canvas${selectMode ? " is-selecting" : ""}${spaceHeld ? " is-panning" : ""}${panMode ? " is-pan-tool" : ""}`}
            onAuxClick={(event) => event.preventDefault()}
            onMouseDown={(event) => {
              if (event.button === 1) {
                event.preventDefault();
              }
            }}
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
              <pattern height={gridStep} id="graph-dot-grid" patternUnits="userSpaceOnUse" width={gridStep}>
                <circle className="graph-grid-dot" cx={gridStep / 2} cy={gridStep / 2} r={gridDotRadius} />
              </pattern>
              <pattern height={gridStep} id="graph-line-grid" patternUnits="userSpaceOnUse" width={gridStep}>
                <path className="graph-grid-dot" d={`M 0 0 L ${gridStep} 0 M 0 0 L 0 ${gridStep}`} fill="none" strokeWidth="0.6" />
              </pattern>
              {prefs.showAvatars &&
                style.node.showAvatars &&
                visibleCharacters.map((character, index) =>
                  avatarUrls[character.id] ? (
                    <clipPath id={avatarClipId(character.id)} key={character.id}>
                      {(() => {
                        const form: NodeForm =
                          layout.nodeStyles?.[character.id]?.form ?? style.node.form;
                        const shape = avatarShapeFor(
                          layout.nodeStyles?.[character.id]?.avatarShape ?? style.node.avatarShape,
                          avatarRatios[character.id],
                        );
                        const geom = nodeGeometry(form, metrics, style.node.size, {
                          shape,
                          ratio: avatarRatios[character.id],
                        });
                        const centre = geom.card
                          ? {
                              x: positions[index].x - geom.halfWidth + geom.halfHeight - 4,
                              y: positions[index].y,
                            }
                          : { x: positions[index].x, y: positions[index].y };

                        // The clip is the frame: a rounded picture is clipped by the same
                        // rounded rectangle that is drawn as its border, so no corner of
                        // the image can show outside it.
                        return geom.card || geom.rounded ? (
                          <rect
                            height={(geom.halfHeight - (geom.card ? 6 : 0)) * 2}
                            rx={geom.card ? 12 : geom.rx}
                            width={(geom.halfWidth - (geom.card ? 0 : 0)) * 2}
                            x={centre.x - (geom.halfWidth - (geom.card ? 0 : 0))}
                            y={centre.y - (geom.halfHeight - (geom.card ? 6 : 0))}
                          />
                        ) : (
                          <circle cx={centre.x} cy={centre.y} r={geom.radius} />
                        );
                      })()}
                    </clipPath>
                  ) : null,
                )}
            </defs>
            {/* Alignment lines exist only while a drag is snapping. They are derived,
                never stored: nothing about them reaches the layout record. */}
            {dragGuides &&
              (() => {
                const [viewX, viewY, viewWidth, viewHeight] = canvas.viewBox.split(" ").map(Number);
                return (
                  <g className="graph-guides" pointerEvents="none">
                    {dragGuides.x !== null && (
                      <line
                        className="graph-guide-line"
                        vectorEffect="non-scaling-stroke"
                        x1={dragGuides.x}
                        x2={dragGuides.x}
                        y1={viewY}
                        y2={viewY + viewHeight}
                      />
                    )}
                    {dragGuides.y !== null && (
                      <line
                        className="graph-guide-line"
                        vectorEffect="non-scaling-stroke"
                        x1={viewX}
                        x2={viewX + viewWidth}
                        y1={dragGuides.y}
                        y2={dragGuides.y}
                      />
                    )}
                  </g>
                );
              })()}
            <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
            {style.canvas.grid !== "none" && (
              <rect
                className="graph-grid-plane"
                fill={`url(#${style.canvas.grid === "lines" ? "graph-line-grid" : "graph-dot-grid"})`}
                height={12000}
                opacity={style.canvas.gridOpacity * gridFade}
                width={16000}
                x={-8000}
                y={-6000}
              />
            )}
            {/* Visual groups sit under the edges and the nodes: a rectangle that
                covered them would swallow every drag that started inside it. */}
            {groupRects.map(({ group, rect }) => (
              <g
                className={[
                  "graph-group",
                  group.characterIds.length > 0 &&
                  group.characterIds.every((id) => selectedIds.includes(id))
                    ? "selected"
                    : "",
                  // Moving the whole group is the one moment its members are all
                  // selected and the pointer is down; the border says so.
                  pressedGroupId === group.id && Boolean(livePositions) ? "dragging" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                data-group-id={group.id}
                key={group.id}
              >
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
            {(prefs.showEdges ? relationships : []).map((relationship) => {
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
              const fromGeom = nodeVisuals[relationship.fromId]?.geom;
              const toGeom = nodeVisuals[relationship.toId]?.geom;
              const geometry = edgeGeometry(from, to, {
                fromBox: fromGeom?.card || fromGeom?.rounded ? fromGeom : undefined,
                toBox: toGeom?.card || toGeom?.rounded ? toGeom : undefined,
                fromRadius: fromGeom?.radius,
                toRadius: toGeom?.radius,
                weight: style.edge.width,
                bend: bends.get(relationship.id) ?? 0,
                metrics,
                labelT: style.edge.labelT,
                labelOffset: style.edge.labelOffset,
                symmetrical: symmetric,
                arrowStyle: style.edge.arrow,
                arrowScale: style.edge.arrowSize,
              });
              // A single edge may be recoloured, thickened or re-dashed without
              // touching the kind it records or any other line on the canvas.
              const localEdge = layout.edgeStyles?.[relationship.id];
              const ink = edgeInk(relationship.kind, style, localEdge);
              const edgeColor = ink.color;
              const edgeWidth = ink.width;
              const edgeDash = ink.dash;
              const isEdgeSelected = selectedEdgeId === relationship.id;
              // A lens and a spotlight are filters on the view: the edge keeps its
              // data, its kind and its endpoints, and only its ink changes.
              const inLens = !lensActive || lensKinds.includes(relationship.kind);
              const inSpotlight =
                !spotlightSet || spotlightSet.has(relationship.fromId) || spotlightSet.has(relationship.toId);
              // Even a straight edge uses the trimmed path: a raw centre-to-centre
              // line runs under both nodes and, with a light fill or a card, shows
              // through the label area.
              const edgePath = geometry.path;
              const touchesHovered =
                activeId !== null &&
                (relationship.fromId === activeId || relationship.toId === activeId);
              // A word on the lines of the person being read, whatever the roster
              // size: "who is this to them" is the question a selection asks.
              const touchesActiveSelection =
                focusId === relationship.fromId ||
                focusId === relationship.toId ||
                selectedIds.includes(relationship.fromId) ||
                selectedIds.includes(relationship.toId);
                // Selection and the person being read outrank every looking-tool: a lens that
                // does not include this kind still leaves the selected edge legible.
                const edgeExempt = isEdgeSelected || touchesActiveSelection || touchesHovered;
              return (
                <g
                  className={`relationship-edge kind-${relationship.kind}${touchesHovered ? " active" : ""}${isEdgeSelected ? " selected" : ""}${
                    dimOwner === "multi" &&
                    !selectedIds.includes(relationship.fromId) &&
                    !selectedIds.includes(relationship.toId)
                      ? " multi-dim"
                      : ""
                  }${
                    marqueeCandidates && !marqueeCandidates.includes(relationship.fromId) && !marqueeCandidates.includes(relationship.toId)
                      ? " multi-dim"
                      : ""
                  }${preview || inLens || edgeExempt ? "" : " lens-dim"}${preview || inSpotlight || edgeExempt ? "" : " spotlight-dim"}${
                    !preview &&
                    focusNeighbourhood &&
                    !(focusNeighbourhood.has(relationship.fromId) && focusNeighbourhood.has(relationship.toId))
                      ? " focus-dim"
                      : ""
                  }`}
                  data-emphasis={
                    isEdgeSelected
                      ? "selected"
                      : touchesActiveSelection || touchesHovered
                        ? "search"
                        : inSpotlight
                          ? "neighbour"
                          : inLens
                            ? "lens"
                            : "normal"
                  }
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
                      strokeDasharray: dashArrayFor(edgeDash),
                      strokeOpacity: ink.opacity,
                      strokeWidth: edgeWidth,
                    }}
                  />
                  {geometry.arrow && (
                    <polygon
                      className="relationship-arrow-head"
                      points={geometry.arrow}
                      style={edgeColor ? { fill: edgeColor, fillOpacity: ink.opacity } : undefined}
                    />
                  )}
                  {/* Edge labels are the first thing a dense graph has too many of:
                      a hundred rings of 同僚 and 友人 sat on top of each other and none
                      were read. The stroke style already says the kind, and the legend
                      names it; the word appears when a node is pointed at, or when the
                      graph is small enough for every word to have room. */}
                  {/* A hundred edges converging at one point drop their kind labels on
                      top of each other; at that size they are a smear, not information.
                      Hover and selection still name the edge. */}
                  {/* Density gate, with a way through it: on a large canvas the words
                      are simplified, but the edges of whatever is selected or pointed at
                      still name themselves. Otherwise the setting looks broken. */}
                  {(() => {
                    // The word on the selected line is an answer, so it is drawn at a
                    // size that can be read even on a hundred-node wheel: the floor is
                    // ten screen pixels, and only the selected edge is allowed to grow.
                    const mode = style.edge.labelMode ?? (style.edge.showLabel ? "auto" : "hidden");
                    const renderedPx = style.edge.labelSize * view.k * (measured ? screenScale : 1);
                    // Readability floor: the selected line, and every line in 始终
                    // mode, grows until the word is at least seven screen pixels.
                    const floorPx = isEdgeSelected ? 10 : mode === "always" ? 7 : 0;
                    const labelFont =
                      !exporting && floorPx > 0 && renderedPx > 0 && renderedPx < floorPx
                        ? Math.min(48, (style.edge.labelSize * floorPx) / renderedPx)
                        : style.edge.labelSize;
                    // Three answers, one place: 隐藏 draws none; 始终显示 puts the
                    // words ahead of the crowding rule; 自动 is the density policy.
                    // A line the author picked always answers for itself.
                    const wordsAllowed = mode !== "hidden";
                    const densityAllows =
                      mode === "always" || visibleCharacters.length <= 60 || touchesHovered || touchesActiveSelection || isEdgeSelected;
                    const countAllows =
                      (mode === "always" && alwaysLabelBudget.ids.has(relationship.id)) ||
                      (mode !== "always" && visibleCharacters.length <= EDGE_LABEL_LIMIT) ||
                      touchesHovered ||
                      touchesActiveSelection ||
                      isEdgeSelected;
                    return wordsAllowed &&
                    densityAllows &&
                    inLens &&
                    (exporting || labelFont * view.k * (measured ? screenScale : 1) >= 6) &&
                    countAllows && (
                    <text
                      style={{ fontSize: `${labelFont}px` }}
                      x={labelPlacements.get(relationship.id)?.x ?? geometry.labelX}
                      y={labelPlacements.get(relationship.id)?.y ?? geometry.labelY}
                    >
                      {relationshipKindLabel(relationship.kind)}
                    </text>
                    );
                  })()}
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
              const visual = nodeVisuals[character.id];
              const form: NodeForm = visual?.form ?? style.node.form;
              const level = visual?.level ?? null;
              const geom = visual?.geom ?? nodeGeometry(form, metrics, style.node.size);
              const nodeX = positions[index].x;
              const nodeY = positions[index].y;
              // A card puts the picture on its left edge; a round node has it centred.
              const avatarCentre = geom.card
                ? { x: nodeX - geom.halfWidth + geom.halfHeight - 4, y: nodeY }
                : { x: nodeX, y: nodeY };
              const cardNameX = nodeX - geom.halfWidth + geom.halfHeight * 2;
              const cardName = cardNameLayout(
                characterDisplayName(character),
                level === "plate"
                  ? geom.halfWidth * 2 - 16
                  : geom.halfWidth * 2 - (geom.halfHeight * 2 - 8) - 20,
                Math.min(nameSize, 15),
              );
              // A card that has shrunk past legibility hands its name back to the
              // canvas: four-pixel text inside an eight-pixel body is a smudge, and the
              // selected card used to be the only node on the canvas with no readable
              // name while its round neighbours got one.
              const cardNameShown =
                geom.card &&
                cardNameVisible({
                  nameSize: cardName.fontSize,
                  pxPerUnit: view.k * (measured ? screenScale : 1),
                });
              // One level per node, decided by priority rather than by stacked classes:
              // a selected person is never dimmed by a lens or a spotlight.
              const emphasis = emphasisLevel({
                selected: isSelected,
                spotlightTarget: spotlightId === character.id,
                searchHit: focusId === character.id,
                spotlightNeighbour: isNeighbour,
                lensMatch: lensActive && lensNodeIds.has(character.id),
              });
              const lensDimsNode = lensActive && emphasis === "normal";
              // Below the floor, only the objects the author is working with keep a name,
              // and only until even that would be illegible.
              // While one character is being read, their direct relations keep a name
              // even under the hub rule — that list is the point of the selection.
              const mustName =
                isSelected || isFocused || isHovered || (focusNeighbourhood !== null && isNeighbour);
              const labelled =
                namesNode(density, {
                  hovered: isHovered,
                  focused: isFocused,
                  neighbour: isNeighbour,
                  selected: isSelected,
                  hub: hubIds.has(character.id),
                }) &&
                // A pinned name is drawn at a fixed screen size below, so it does not
                // need the floor that governs the rest: refusing to draw it is exactly
                // how a selected node ended up with no readable name at 29%.
                (exporting ||
                  nameFloorOk ||
                  (mustName && (nameScreenPx >= 4 || (isSelected && selectedIds.length === 1) || isFocused)));
              // Spotlight dimming is its own class. Sharing one with hover made
              // "I exited the spotlight" and "the pointer is still on a node" look
              // identical, and it made the exit look broken.
              const outsideSpotlight = spotlightSet !== null && !spotlightSet.has(character.id);
              // One function owns the priority. A hover used to be able to dim the
              // node the reader had just picked, which read as "the selection went
              // away"; selection now outranks hover by construction.
               // Comparing layouts outranks every looking-tool: a preview is a proposal
               // being judged, and a focus or lens left on from the previous reading
               // would fade exactly the nodes the author is trying to compare.
               const state = `${nodeStateClass({
                 selected: isSelected,
                 focused: isFocused,
                 hovered: isHovered,
                 outsideSpotlight: !preview && outsideSpotlight,
                 // Resting the pointer on the node just clicked must not fade the rest of
                 // the drawing: hover-dimming is for finding your way when nothing is
                 // selected, and a selection is already the answer.
                 dimmedByHover:
                   !preview && selectedIds.length === 0 && Boolean(activeId && character.id !== activeId && !isNeighbour),
               })}${
                 // Multi-select recedes the rest at one fixed strength, whatever the
                 // count: one pick must not look like a different mode from three.
                 // Only the mode recedes the rest. A plain selection — even of several
                 // people picked one by one outside the mode — stays fully lit, and
                 // focus / lens own the drawing when they are on: preview first, then
                 // focus, then the lens, then this.
                 dimOwner === "multi" && !isSelected ? " multi-dim" : ""
               }${
                 // While the rectangle is moving, what it covers is the promise and
                 // everything else is already background: the same receding as a
                 // finished multi-selection, so release changes nothing visually.
                 marqueeCandidates
                   ? marqueeCandidates.includes(character.id)
                     ? " marquee-in"
                     : " multi-dim"
                   : ""
               }${!preview && lensDimsNode ? " lens-dim" : ""}${
                 !preview && focusNeighbourhood && !focusNeighbourhood.has(character.id) ? " focus-dim" : ""
               }`;
              const avatarUrl = avatarUrls[character.id];
              // A ring drawn in world units disappears at the zoom a hundred-character
              // wheel is read at, which is exactly where "which one did I pick" matters.
              // The ink is solved for a constant on-screen weight instead.
              const pxPerUnit = view.k * (screenScale > 0 ? screenScale : 1);
              const renderedRadius = geom.radius * pxPerUnit;
              const ringStroke = ringStrokeFor(pxPerUnit);
              // The gap is a screen distance, like the stroke. In world units it used to
              // be a flat 6, so at 250% the outline drifted a finger's width away from
              // the node and at 60% it touched the name.
              // Zero: the outline sits on the node's own edge. An offset ring grew with
              // zoom and, at the sizes this graph draws, cut into the name below the
              // node — a picked character looked like it had two borders and half a
              // label. The edge is the one place the ring can never collide.
              /* 3 screen px outside the body: the ring is painted before the node, so
                 anything at or inside its radius is covered by the node's own fill. */
              const ringGap = 3 / Math.max(pxPerUnit, 0.001);
              return (
                <g
                  className={state}
                  data-character-id={character.id}
                  data-character-name={characterDisplayName(character)}
                  data-emphasis={emphasis}
                  data-local-border={nodeOverride?.borderColor ? "true" : undefined}
                  data-selected={isSelected ? "true" : undefined}
                  key={character.id}
                  onPointerMove={() => setHoveredId(character.id)}
                  onPointerDown={() => setHoveredId(null)}
                  onPointerLeave={() => setHoveredId(null)}
                  role="presentation"
                >
                  {/* The selection ring is its own circle, one step outside the
                      node: a node may carry a local border colour, and a ring drawn
                      by restyling the node's own stroke would either hide that colour
                      or be hidden by it. */}
                   {isSelected &&
                     (geom.card || geom.rounded ? (
                       <rect
                         className={`relationship-node-ring${renderedRadius < 12 ? " tight" : ""}`}
                         height={geom.halfHeight * 2 + ringGap * 2}
                         rx={geom.rounded ? geom.rx + ringGap : 16}
                         strokeWidth={ringStroke}
                         width={geom.halfWidth * 2 + ringGap * 2}
                         x={nodeX - geom.halfWidth - ringGap}
                         y={nodeY - geom.halfHeight - ringGap}
                       />
                     ) : (
                       <circle
                         className={`relationship-node-ring${renderedRadius < 12 ? " tight" : ""}`}
                         cx={nodeX}
                         cy={nodeY}
                         r={geom.radius + ringGap}
                         strokeWidth={ringStroke}
                       />
                     ))}
                  {geom.rounded ? (
                    <rect
                      className="relationship-node-circle relationship-node-rounded"
                      height={geom.halfHeight * 2}
                      rx={geom.rx}
                      style={{
                        ...(nodeOverride?.borderColor
                          ? ({ "--node-stroke": nodeOverride.borderColor } as Record<string, string>)
                          : {}),
                        ...(nodeOverride?.background
                          ? ({ "--node-fill": nodeOverride.background } as Record<string, string>)
                          : {}),
                      }}
                      width={geom.halfWidth * 2}
                      x={nodeX - geom.halfWidth}
                      y={nodeY - geom.halfHeight}
                    />
                  ) : geom.card ? (
                    <rect
                      className="relationship-node-card"
                      height={geom.halfHeight * 2}
                      rx={12}
                      style={{
                        ...(nodeOverride?.borderColor
                          ? ({ "--node-stroke": nodeOverride.borderColor } as Record<string, string>)
                          : {}),
                        ...(nodeOverride?.background
                          ? ({ "--node-fill": nodeOverride.background } as Record<string, string>)
                          : {}),
                      }}
                      width={geom.halfWidth * 2}
                      x={nodeX - geom.halfWidth}
                      y={nodeY - geom.halfHeight}
                    />
                  ) : (
                    <circle
                      className="relationship-node-circle"
                      cx={nodeX}
                      cy={nodeY}
                      r={geom.radius}
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
                  )}
                  {/* An uploaded picture is drawn as the node itself, through the same
                      circle and at the same size as the emoji it replaces. Before this
                      the graph only ever drew `avatarEmoji`, so a character with a
                      photo showed a generic face here and the real one everywhere
                      else — the picture was not broken, it was never asked for. */}
                  {level !== "plate" && prefs.showAvatars && style.node.showAvatars && avatarUrl && (
                    <image
                      className="relationship-node-image"
                      clipPath={`url(#${avatarClipId(character.id)})`}
                      height={(geom.card ? geom.halfHeight - 6 : geom.halfHeight) * 2}
                      href={avatarUrl}
                      preserveAspectRatio="xMidYMid slice"
                      width={(geom.card ? geom.halfHeight - 6 : geom.halfWidth) * 2}
                      x={avatarCentre.x - (geom.card ? geom.halfHeight - 6 : geom.halfWidth)}
                      y={avatarCentre.y - (geom.card ? geom.halfHeight - 6 : geom.halfHeight)}
                    />
                  )}
                  {level !== "plate" && prefs.showAvatars && style.node.showAvatars && !avatarUrl && (
                    <text
                      className="relationship-node-emoji"
                      style={{
                        fontSize: `${
                          geom.card || geom.rounded
                            ? Math.min(geom.halfWidth, geom.halfHeight) * 1.05
                            : metrics.emojiSize * (geom.radius / Math.max(metrics.radius * style.node.size, 0.001))
                        }px`,
                      }}
                      x={avatarCentre.x}
                      y={avatarCentre.y}
                    >
                      {character.avatarEmoji || "🙂"}
                    </text>
                  )}
                  {cardNameShown && (
                    <>
                      <text
                        className="relationship-node-card-name"
                        style={{ fontSize: `${level === "plate" ? Math.min(cardName.fontSize, 12) : cardName.fontSize}px` }}
                        textAnchor={level === "plate" ? "middle" : "start"}
                        x={level === "plate" ? nodeX : cardNameX}
                        y={level === "plate" ? nodeY + 4 : character.occupation && cardMetaVisible ? nodeY - 4 : nodeY + 4}
                      >
                        {cardName.text}
                      </text>
                      {character.occupation && cardMetaVisible && level === "full" && (
                        <text
                          className="relationship-node-card-meta"
                          style={{ fontSize: `${Math.min(11, nameSize - 2)}px` }}
                          x={cardNameX}
                          y={nodeY + 14}
                        >
                          {character.occupation}
                        </text>
                      )}
                    </>
                  )}
                  {labelled && (!geom.card || !cardNameShown) && (() => {
                    const name = characterDisplayName(character);
                    const width = geom.rounded
                      ? geom.halfWidth * 2 + 12
                      : Math.max(geom.halfWidth * 2 + 26, compactViewport ? 104 : 132);
                    // One name, not three: lifting every selected name makes them overlap
                    // on a dense ring. Multi-selection keeps its rings and the bar's count.
                    const pinned = (isSelected && selectedIds.length === 1) || isFocused;
                    const nameFontPx = readableNameSize({
                      nameSize: nameSize * (!showLabels && hubIds.has(character.id) ? 1.35 : 1),
                      pinned,
                      pxPerUnit: view.k * (measured ? screenScale : 1),
                    });
                    // Two lines by default; a name being read gets a third. The whole name
                    // is also in the tooltip and the detail page.
                    const lines = wrapNameLines(name, width, nameSize, isSelected || isHovered ? 3 : 2);
                    // A selected name goes outside the wheel. At a 0.13x fit the ring's
                    // neighbours are 13px apart, so a 40px-wide label below its node lands
                    // on them; the space outside the ring is empty by construction.
                    const nameFrame = {
                      left: -view.x / Math.max(view.k * (measured ? screenScale : 1), 0.0001),
                      right:
                        (frameSize.width - view.x) /
                        Math.max(view.k * (measured ? screenScale : 1), 0.0001),
                    };
                    let placement = pinned
                      ? radialNamePlacement({
                          node: positions[index],
                          centre: nameCentre,
                          halfWidth: geom.halfWidth,
                          halfHeight: geom.halfHeight,
                          isCard: geom.card,
                          pxPerUnit: view.k * (measured ? screenScale : 1),
                          fontSize: nameFontPx,
                          // The wrap width is a budget, not the drawn width: clamping
                          // needs the widest line's own size.
                          labelWidth:
                            Math.max(...lines.map((line) => line.length)) * nameFontPx * 0.95,
                          lines: lines.length,
                        })
                      : null;
                    // A sideways name anchored at the near edge can still run past the
                    // canvas (the far side of a hundred-node ring at 375px sits ~10px
                    // from the viewport edge). It crosses to the inside of the node
                    // instead: same 8px clearance, reading direction unchanged, and no
                    // vertical move — that is what once pushed a top label 200px down.
                    const labelWidthWorld =
                      Math.max(...lines.map((line) => line.length)) * nameFontPx * 0.95;
                    const flipInward =
                      placement &&
                      ((placement.textAnchor === "start" &&
                        placement.x + labelWidthWorld > cloudMaxX) ||
                        (placement.textAnchor === "end" &&
                          placement.x - labelWidthWorld < cloudMinX));
                    const flipped =
                      placement && flipInward
                        ? {
                            ...placement,
                            x:
                              positions[index].x +
                              (placement.textAnchor === "start" ? -1 : 1) *
                                (Math.max(geom.halfWidth, geom.halfHeight) +
                                  8 / Math.max(view.k * (measured ? screenScale : 1), 0.0001)),
                            textAnchor:
                              placement.textAnchor === "start" ? ("end" as const) : ("start" as const),
                            side: placement.textAnchor === "start" ? ("left" as const) : ("right" as const),
                          }
                        : placement;
                    placement = flipped;
                    const labelX = placement ? placement.x : positions[index].x;
                    const labelY = placement
                      ? placement.y
                      : positions[index].y +
                        nameDropWorld({
                          halfHeight: geom.halfHeight,
                          nameDrop: metrics.nameDrop,
                          pxPerUnit: view.k * (measured ? screenScale : 1),
                        });

                    return (
                      <text
                        className={
                          !showLabels && hubIds.has(character.id)
                            ? "relationship-node-name hub"
                            : "relationship-node-name"
                        }
                        data-name-side={placement ? placement.side : undefined}
                        style={{ fontSize: `${nameFontPx}px` }}
                        textAnchor={placement ? placement.textAnchor : undefined}
                        x={labelX}
                        y={labelY}
                      >
                        <title>{name}</title>
                        {lines.map((line, lineIndex) => (
                          <tspan dy={lineIndex === 0 ? 0 : nameSize * 1.18} key={lineIndex} x={labelX}>
                            {line}
                          </tspan>
                        ))}
                      </text>
                    );
                  })()}
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

          {/* The page's drawer. It takes its own column beside the drawing instead
              of lying on top of it, so no character can end up behind a panel; on a
              narrow screen the same panel is a sheet over the lower part of the
              canvas, with the drawing still visible above it. */}
          {!isStudio && surface !== "none" && (
            <div className="graph-page-drawer-layer" data-surface={surface}>
              <div aria-hidden="true" className="graph-page-drawer-scrim" onClick={closeSurface} />
              <aside
                aria-label={
                  surface === "design"
                    ? `设计 · ${renderedDesignScope === "canvas" ? "整体画布" : appearanceLabel}`
                    : surface === "arrange"
                      ? "整理画布"
                      : surface === "explore"
                        ? "探索关系"
                        : surface === "characters"
                          ? "角色与分组"
                          : "视觉分组"
                }
                className="graph-page-drawer"
                data-level={sheetLevel}
                ref={pageDrawerRef}
                role="dialog"
              >
                <div className="graph-page-drawer-head">
                  <div className="graph-page-drawer-title">
                    <strong>
                      {surface === "design"
                        ? `设计 · ${renderedDesignScope === "canvas" ? "整体画布" : appearanceLabel}`
                        : surface === "arrange"
                          ? "整理画布"
                          : surface === "explore"
                            ? "探索关系"
                            : surface === "characters"
                              ? "角色与分组"
                              : "视觉分组"}
                    </strong>
                    <span>
                      {surface === "design"
                        ? renderedDesignScope === "canvas"
                          ? "预设、分组调整与高级选项"
                          : appearanceSelection.kind === "multi"
                            ? "批量外观暂不支持，这里只改整体画布"
                            : "这个对象自己的边框、底色与形态"
                        : surface === "arrange"
                          ? "先预览，确认后才写入布局"
                          : surface === "explore"
                            ? "聚光灯、关系透镜与视角书签"
                            : surface === "characters"
                              ? "搜索、定位与角色列表"
                              : "分组只影响画布，不写世界观"}
                    </span>
                    {/* The dock and the selection bar step aside for this sheet on a
                        phone, so the sheet itself has to say what is selected and
                        whether a proposal is waiting. One line, no controls. */}
                    {preview ? (
                      <span className="graph-page-drawer-state is-preview">
                        预览「{preview.label ?? arrangeLabel(preview.mode)}」，坐标未保存
                      </span>
                    ) : selectedIds.length === 1 ? (
                      <span className="graph-page-drawer-state">
                        已选 1 个角色
                        {byId.get(selectedIds[0])
                          ? ` · ${characterDisplayName(byId.get(selectedIds[0])!.character)}`
                          : ""}
                      </span>
                    ) : selectedIds.length > 1 ? (
                      <span className="graph-page-drawer-state">已选 {selectedIds.length} 个角色</span>
                    ) : null}
                  </div>
                  <div className="graph-page-drawer-tools">
                    {/* Half height leaves the drawing visible; full height is for
                        reading every control. The grip only exists on a phone. */}
                    <button
                      aria-label={sheetLevel === "half" ? "展开到全屏高度" : "收起为半屏"}
                      className="graph-sheet-toggle"
                      data-level={sheetLevel}
                      onClick={() => setSheetLevel((level) => (level === "half" ? "full" : "half"))}
                      type="button"
                    >
                      <Icon name="chevronDown" size={16} />
                    </button>
                    <button
                      aria-label={`关闭${surface === "design" ? "外观设置" : surface === "arrange" ? "整理画布" : surface === "explore" ? "探索面板" : surface === "characters" ? "角色面板" : "视觉分组"}`}
                      className="graph-page-drawer-close"
                      onClick={closeSurface}
                      type="button"
                    >
                      <Icon name="close" size={16} />
                    </button>
                  </div>
                </div>
                <div className="graph-page-drawer-body">
                  {surface === "design" && stylePanel}
                  {surface === "arrange" && arrangePanel}
                  {surface === "groups" && groupPanel}
                  {surface === "explore" && explorePanelContent}
                  {surface === "characters" && charactersPanelContent}
                </div>
              </aside>
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
                    aria-label="退出全屏编辑"
                    className="graph-studio-exit"
                    onClick={exitStudio}
                    type="button"
                  >
                    <Icon name="arrowLeft" size={16} />
                    <span>退出全屏编辑</span>
                  </button>
                  <div className="graph-studio-titles">
                    <strong>角色关系网</strong>
                    <span>
                      {characters.length} 个角色 · {relationships.length} 条关系
                    </span>
                  </div>
                </div>
                {/* Selection lives in the toolbar, not in a card over the drawing: the
                    author's eye is already here, and a second control surface floating on
                    the canvas hid labels and nodes. Same handlers as before. */}
                {selectedIds.length > 0 && (
                  <div
                    aria-label="当前选择"
                    className={`graph-studio-selection${isAlignOpen ? " has-popover" : ""}`}
                    data-testid="studio-selection"
                    role="group"
                  >
                    <span className="graph-studio-selection-count">
                      <span className="graph-wide-only">
                        {selectedIds.length === 1
                          ? (() => {
                              const one = byId.get(selectedIds[0])?.character;
                              return one ? characterDisplayName(one) : "已选 1 个角色";
                            })()
                          : `已选 ${selectedIds.length} 个`}
                      </span>
                      {/* On a phone the count is a number: the words cost the width the
                          commands need, and the commands are what the hand is doing. */}
                      <span aria-hidden="true" className="graph-mobile-only">
                        {selectedIds.length}
                      </span>
                    </span>
                    <div className="graph-studio-selection-actions">
                      {selectedIds.length === 1 ? (
                        <>
                          <button
                            aria-label={focusedReadId === selectedIds[0] ? "退出聚焦" : "聚焦所选角色"}
                            aria-pressed={Boolean(focusedReadId && focusedReadId === selectedIds[0])}
                            className="graph-studio-selection-button graph-selection-fit"
                            data-testid="studio-focus"
                            onClick={toggleReadingFocus}
                            type="button"
                          >
                            {focusedReadId === selectedIds[0] ? "退出聚焦" : "聚焦"}
                          </button>
                          <button
                            className="graph-studio-selection-button"
                            onClick={() => {
                              const one = byId.get(selectedIds[0])?.character;
                              if (one) onOpenCharacter(one.id);
                            }}
                            type="button"
                          >
                            编辑
                          </button>
                          <button
                            className="graph-studio-selection-button graph-wide-only"
                            data-testid="studio-appearance"
                            onClick={() => {
                              setDesignScope("object");
                              setSurface("design");
                            }}
                            type="button"
                          >
                            外观
                          </button>
                        </>
                      ) : (
                        <>
                          <button className="graph-studio-selection-button" onClick={fitSelection} type="button">
                            适应选中
                          </button>
                          <button
                            aria-expanded={isAlignOpen}
                            aria-haspopup="dialog"
                            className="graph-studio-selection-button"
                            data-testid="studio-arrange"
                            onClick={(event) => {
                              if (isAlignOpen) {
                                setIsAlignOpen(false);
                                return;
                              }

                              const rect = event.currentTarget.getBoundingClientRect();
                              const width = 340;
                              const left = Math.max(10, Math.min(rect.left, innerWidth - width - 10));
                              const below = rect.bottom + 8;
                              const fitsBelow = below + 300 <= innerHeight;
                              setAlignPopoverBox({
                                left,
                                top: fitsBelow ? below : Math.max(10, rect.top - 8 - Math.min(340, innerHeight - 20)),
                              });
                              setIsAlignOpen(true);
                            }}
                            type="button"
                          >
                            排列
                          </button>
                          <button
                            className="graph-studio-selection-button graph-wide-only"
                            data-testid="studio-create-group"
                            onClick={() => {
                              setIsAlignOpen(false);
                              setGroupDraft({ name: "", editingId: null });
                              setSurface("groups");
                            }}
                            type="button"
                          >
                            创建分组
                          </button>
                          <button
                            className="graph-studio-selection-button graph-wide-only"
                            data-testid="studio-appearance"
                            onClick={() => {
                              setDesignScope("object");
                              setSurface("design");
                            }}
                            type="button"
                          >
                            外观
                          </button>
                        </>
                      )}
                      <button
                        aria-label="清除选择"
                        className="graph-studio-selection-button"
                        onClick={() => {
                          setIsAlignOpen(false);
                          setSelectedIds([]);
                        }}
                        type="button"
                      >
                        清除
                      </button>
                    </div>
                    {/* 排列 is a temporary tool, so it closes itself: Escape, a click
                        outside, or clearing the selection all remove it. It is anchored
                        to the button that opened it, not parked over the drawing. */}
                    {isAlignOpen &&
                      selectedIds.length >= 2 &&
                      alignPopoverBox &&
                      createPortal(
                        <div
                          className="graph-align-popover"
                          data-testid="studio-align-popover"
                          style={{ position: "fixed", left: alignPopoverBox.left, top: alignPopoverBox.top }}
                        >
                          {alignPanel}
                        </div>,
                        document.body,
                      )}
                  </div>
                )}
                <div className="graph-studio-actions">
                  <div aria-label="历史与保存" className="graph-studio-toolgroup graph-history-group" role="group">
                  <button
                    aria-label="撤销"
                    data-tooltip={`撤销（${modKey}Z）`}
                    disabled={undoRef.current.length === 0}
                    onClick={undoLayout}
                    type="button"
                  >
                    <Icon name="undo" size={16} />
                  </button>
                  <button
                    aria-label="重做"
                    data-tooltip={`重做（⇧${modKey}Z）`}
                    disabled={redoRef.current.length === 0}
                    onClick={redoLayout}
                    type="button"
                  >
                    <Icon name="redo" size={16} />
                  </button>
                  {/* A save that happens on its own still has to be visible: the
                      author needs to know a drag was kept without looking for a
                      button that does not exist. */}
                  <span className="graph-studio-save" data-dirty={livePositions ? "true" : undefined}>
                    <span className="graph-studio-save-dot" />
                    {livePositions ? "调整中…" : "已保存"}
                  </span>
                  {previousView && (
                    <button aria-label="回到上一个视角" data-tooltip="回到上一个视角" onClick={restoreView} type="button">
                      <Icon name="refresh" size={16} />
                    </button>
                  )}
                  <button
                    aria-label="重置视角"
                    data-tooltip="重置视角：回到进入全屏编辑时的画面"
                    onClick={resetToDefaultView}
                    type="button"
                  >
                    <Icon name="maximize" size={16} />
                  </button>
                  </div>

                  <span aria-hidden="true" className="graph-studio-sep" />

                  <div
                    aria-label="任务面板"
                    className="graph-studio-toolgroup graph-studio-tasks"
                    role="group"
                  >
                  <button
                    aria-label="角色与分组"
                    aria-pressed={isStudioLeftOpen}
                    className="graph-studio-toggle"
                    data-testid="open-characters"
                    data-tooltip="角色与分组：搜索、定位与视觉分组"
                    onClick={() => openGraphSurface("characters")}
                    type="button"
                  >
                    <Icon name="layers" size={15} />
                    <span>角色</span>
                  </button>
                  <button
                    aria-label="整理画布"
                    aria-pressed={surface === "arrange"}
                    className="graph-studio-toggle"
                    data-tooltip="整理：先预览，确认后才写入布局"
                    onClick={() => openGraphSurface("arrange")}
                    type="button"
                  >
                    <Icon name="layout" size={15} />
                    <span>整理</span>
                  </button>
                  <button
                    aria-expanded={surface === "design"}
                    aria-label="设计"
                    aria-pressed={isStudioRightOpen && studioTab === "design"}
                    className="graph-studio-toggle"
                    data-tooltip="设计：所选对象、关系线与整体画布"
                    onClick={() => openGraphSurface("design")}
                    type="button"
                  >
                    <Icon name="sliders" size={15} />
                    <span>设计</span>
                  </button>
                  <button
                    aria-label="探索"
                    aria-pressed={isStudioRightOpen && studioTab === "explore"}
                    className="graph-studio-toggle"
                    data-tooltip="探索：聚光灯、关系透镜与视角书签"
                    onClick={() => openGraphSurface("explore")}
                    type="button"
                  >
                    <Icon name="compass" size={15} />
                    <span>探索</span>
                  </button>
                  </div>

                  <span aria-hidden="true" className="graph-studio-sep" />
                  <button
                    className="primary-button graph-studio-new"
                    disabled={!canLink}
                    onClick={openDraft}
                    type="button"
                  >
                    新建关系
                  </button>
                  <button
                    aria-label="导出"
                    aria-pressed={isExportSurface}
                    className="graph-studio-toggle"
                    data-testid="open-export"
                    data-tooltip="导出：构图、图例、预览与格式"
                    onClick={() => openGraphSurface("export")}
                    type="button"
                  >
                    <Icon name="download" size={15} />
                    <span>导出</span>
                  </button>
                  <div className="graph-studio-menu-wrap">
                    <button
                      aria-expanded={studioMenuOpen}
                      aria-haspopup="menu"
                      aria-label="任务菜单"
                      className="graph-studio-menu-toggle"
                      onClick={() => {
                        const rect = studioMenuButtonRef.current?.getBoundingClientRect();
                        setStudioMenuPos(rect ? { top: rect.bottom + 8, right: Math.max(10, innerWidth - rect.right) } : null);
                        setStudioMenuOpen((open) => !open);
                      }}
                      ref={studioMenuButtonRef}
                      type="button"
                    >
                      <Icon name="more" size={16} />
                      <span>任务</span>
                    </button>
                    {studioMenuOpen && createPortal(
                      <div
                        aria-label="任务菜单"
                        className="graph-studio-menu"
                        ref={studioMenuRef}
                        role="menu"
                        style={studioMenuPos ? { position: "fixed", top: studioMenuPos.top, right: studioMenuPos.right } : { position: "fixed", visibility: "hidden" }}
                      >
                        {([
                          ["characters", "layers", "角色", "搜索、定位与视觉分组"],
                          ["arrange", "layout", "整理", "先预览，确认后才写入布局"],
                          ["design", "sliders", "设计", "所选对象、关系线与整体画布"],
                          ["explore", "compass", "探索", "聚光灯、关系透镜与视角书签"],
                        ] as const).map(([target, icon, label, hint]) => (
                          <button
                            aria-pressed={surface === target}
                            className="graph-studio-menu-item"
                            key={target}
                            onClick={() => {
                              setStudioMenuOpen(false);
                              openGraphSurface(target);
                            }}
                            role="menuitem"
                            type="button"
                          >
                            <Icon name={icon} size={15} />
                            <span>
                              <strong>{label}</strong>
                              <em>{hint}</em>
                            </span>
                          </button>
                        ))}
                        <span aria-hidden="true" className="graph-studio-menu-sep" />
                        <button
                          className="graph-studio-menu-item"
                          disabled={!canLink}
                          onClick={() => {
                            setStudioMenuOpen(false);
                            openDraft();
                          }}
                          role="menuitem"
                          type="button"
                        >
                          <Icon name="plus" size={15} />
                          <span><strong>新建关系</strong><em>在两个角色之间连一条线</em></span>
                        </button>
                        {previousView && (
                          <button
                            className="graph-studio-menu-item"
                            onClick={() => {
                              setStudioMenuOpen(false);
                              restoreView();
                            }}
                            role="menuitem"
                            type="button"
                          >
                            <Icon name="refresh" size={15} />
                            <span><strong>回到上一个视角</strong><em>撤销刚才的取景变化</em></span>
                          </button>
                        )}
                        <button
                          className="graph-studio-menu-item"
                          onClick={() => {
                            setStudioMenuOpen(false);
                            resetToDefaultView();
                          }}
                          role="menuitem"
                          type="button"
                        >
                          <Icon name="maximize" size={15} />
                          <span><strong>重置视角</strong><em>回到进入全屏编辑时的画面</em></span>
                        </button>
                      </div>,
                      document.body,
                    )}
                  </div>
                </div>
              </div>

              {surface === "characters" && (
                <aside aria-label="角色与分组" className="graph-studio-drawer left">
                  <div className="graph-studio-drawer-head">
                    <strong>角色与分组</strong>
                    <button aria-label="关闭角色面板" onClick={closeSurface} type="button">
                      <Icon name="close" size={14} />
                    </button>
                  </div>

                  {/* The studio used to carry its own copy of this list, and that copy had
                      no roster controls at all: 加入 / 移出 existed on the page and nowhere
                      in full-screen editing. One panel, so the two surfaces cannot drift. */}
                  {charactersPanelContent}
                </aside>
              )}
              {surface === "groups" && (
                <aside aria-label="视觉分组" className="graph-studio-drawer left">
                  <div className="graph-studio-drawer-head">
                    <strong>视觉分组</strong>
                    <button aria-label="关闭分组面板" onClick={closeSurface} type="button">
                      <Icon name="close" size={14} />
                    </button>
                  </div>
                  {groupPanel}
                </aside>
              )}

              {isStudioRightOpen && (
                <aside
                  aria-label={
                    surface === "arrange"
                      ? "整理画布"
                      : surface === "export"
                        ? "导出关系网"
                        : studioTab === "design"
                          ? "设计面板"
                          : "探索面板"
                  }
                  className="graph-studio-drawer right"
                  data-level={sheetLevel}
                  data-tab={surface === "arrange" ? "arrange" : surface === "export" ? "export" : studioTab}
                  ref={rightDrawerRef}
                >
                  {/* The top bar already switches between 角色 / 设计 / 探索, so the panel
                      names its own job and offers the one thing the bar cannot: how much
                      of the screen the sheet takes. */}
                  <div className="graph-studio-drawer-head">
                    <strong>
                      {surface === "arrange"
                        ? "整理画布"
                        : surface === "export"
                          ? "导出关系网"
                          : studioTab === "design"
                            ? `设计 · ${renderedDesignScope === "canvas" ? "整体画布" : appearanceLabel}`
                            : "探索"}
                    </strong>
                    <div className="graph-studio-drawer-actions">
                      <button
                        aria-expanded={sheetLevel === "full"}
                        aria-label={sheetLevel === "half" ? "展开面板" : "收起面板"}
                        className="graph-sheet-toggle"
                        onClick={() => setSheetLevel((level) => (level === "half" ? "full" : "half"))}
                        type="button"
                      >
                        {sheetLevel === "half" ? "展开" : "收起"}
                      </button>
                      <button aria-label="关闭属性面板" onClick={closeSurface} type="button">
                        <Icon name="close" size={14} />
                      </button>
                    </div>
                  </div>

                  {surface === "arrange" && (
                    <div className="graph-arrange-drawer" role="group" aria-label="整理画布">
                      {arrangePanel}
                    </div>
                  )}

                  {surface === "export" && (
                    <div className="graph-export-drawer" role="group" aria-label="导出设置">
                      {exportBody}
                    </div>
                  )}

                  {surface === "design" && stylePanel}

                  {surface === "explore" && explorePanelContent}
                </aside>
              )}
            </>
          )}

          {marquee && (
            <div
              aria-hidden="true"
              className="graph-marquee"
              style={{ height: marquee.height, left: marquee.left, top: marquee.top, width: marquee.width }}
            />
          )}
          {/* Page mode keeps its single context bar under the drawing — one state at a
              time: a preview waiting for a decision, the current selection, or a notice
              about the last change. The studio has no such bar: its decisions live in
              the toolbar and its drawers, and nothing floats over the drawing. */}
          {!isStudio && (
            <div className="graph-context-slot" data-yielded={surfaceIsOpen(surface) ? "true" : undefined}>
              {contextBar === "preview" && preview && (
                <div className="graph-context preview" role="status">
                  <div className="graph-context-row">
                    <span className="graph-context-count">
                      预览：{arrangeLabel(preview.mode)} · {Object.keys(preview.positions).length} 个节点（
                      {preview.scope === "visible" ? "当前可见" : "全部角色"}）· 未写入坐标
                    </span>
                    <div className="graph-context-actions">
                      <button className="ghost-button" data-testid="arrange-cancel" onClick={cancelArrange} type="button">
                        取消
                      </button>
                      <button className="primary-button" data-testid="arrange-apply" onClick={applyArrange} type="button">
                        确认应用
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {contextBar === "selection" && (
                <div aria-label="所选角色" className="graph-context selection" role="group">
                  <div className="graph-context-row">
                    {selectedIds.length === 1 ? (
                      (() => {
                        const selectedChar = byId.get(selectedIds[0])?.character;
                        return (
                          <>
                            <div className="graph-context-single">
                              <span className="graph-context-char-name">
                                {selectedChar ? characterDisplayName(selectedChar) : "已选 1 个角色"}
                              </span>
                              <span className="graph-context-badge">
                                {degreeById.get(selectedIds[0]) ?? 0} 条关系
                              </span>
                            </div>
                            <div className="graph-context-actions">
                              <button
                                aria-pressed={focusedReadId === selectedIds[0]}
                                className={focusedReadId === selectedIds[0] ? "ghost-button active" : "ghost-button"}
                                onClick={toggleReadingFocus}
                                type="button"
                              >
                                {focusedReadId === selectedIds[0] ? "退出聚焦" : "聚焦"}
                              </button>
                              {selectedChar && (
                                <button
                                  className="ghost-button"
                                  onClick={() => onOpenCharacter(selectedChar.id)}
                                  type="button"
                                >
                                  编辑
                                </button>
                              )}
                              {focusOverview && (
                                <button className="ghost-button" onClick={returnToOverview} type="button">
                                  返回总览
                                </button>
                              )}
                              <button className="ghost-button" onClick={() => setSelectedIds([])} type="button">
                                清除选择
                              </button>

                            </div>
                          </>
                        );
                      })()
                    ) : (
                      <>
                        <span className="graph-context-count">已选 {selectedIds.length} 个角色</span>
                        {/* Four things, one row. 外观 and 创建分组 are not selection
                            actions; they live one press deeper inside 排列, and the
                            studio's own 设计 entry still opens the same panel. */}
                        <div className="graph-context-actions">
                          <button className="ghost-button" onClick={fitSelection} type="button">
                            适应选中
                          </button>
                          <button
                            aria-expanded={isAlignOpen}
                            className={isAlignOpen ? "ghost-button active" : "ghost-button"}
                            disabled={selectedIds.length < 2}
                            onClick={(event) => {
                              if (isAlignOpen) {
                                setIsAlignOpen(false);
                                return;
                              }
                              const rect = event.currentTarget.getBoundingClientRect();
                              const width = 340;
                              setAlignPopoverBox({
                                left: Math.max(10, Math.min(rect.left, window.innerWidth - width - 10)),
                                top:
                                  rect.bottom + 8 + 320 <= window.innerHeight
                                    ? rect.bottom + 8
                                    : Math.max(10, rect.top - 8 - 320),
                              });
                              setIsAlignOpen(true);
                            }}
                            title={arrangeAvailability(selectedIds.length).reason ?? "对齐与分布"}
                            type="button"
                          >
                            排列
                          </button>
                          <button className="ghost-button" onClick={() => setSelectedIds([])} type="button">
                            清除选择
                          </button>

                        </div>
                      </>
                    )}
                    {arrangeUndo && (
                      <span className="graph-context-undo" role="status">
                        已应用{arrangeUndo.label}
                        <button data-testid="arrange-undo" onClick={undoArrange} type="button">
                          撤销
                        </button>
                      </span>
                    )}
                  </div>
                </div>
              )}
              {!isStudio &&
                isAlignOpen &&
                selectedIds.length >= 2 &&
                alignPopoverBox &&
                createPortal(
                  <div
                    className="graph-align-popover"
                    data-testid="page-align-popover"
                    style={{ position: "fixed", left: alignPopoverBox.left, top: alignPopoverBox.top }}
                  >
                    {alignPanel}
                  </div>,
                  document.body,
                )}

              {contextBar === "undo" && arrangeUndo && (
                <div className="graph-context undo" role="status">
                  <div className="graph-context-row">
                    <span className="graph-context-count">已应用{arrangeUndo.label}</span>
                    <div className="graph-context-actions">
                      <button className="ghost-button" data-testid="arrange-undo" onClick={undoArrange} type="button">
                        撤销
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Output, under the drawing it exports. The node's own appearance moved
              behind 显示设置: four size buttons and two switches were the widest thing
              on the row, and they are set once rather than used. Everything here is a
              segmented button of the same height and radius, so the bar still reads as
              one group and one output. It lives outside the frame, so it never ends up
              in an export. */}
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
                    <col style={{ width: "56px" }} />
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
                             {/* The arrow says which way the line runs; the word says
                                 whether that direction means anything. A reader who does
                                 not know the kind list cannot infer 互为 from ↔. */}
                             <span className="manage-relation">
                               <span className={`relationship-kind-chip kind-${relationship.kind}`}>
                                 {relationshipKindLabel(relationship.kind)}
                               </span>
                               <span aria-hidden="true" className="manage-direction">
                                 {symmetric ? "↔" : "→"}
                               </span>
                               <span className="manage-direction-word">
                                 {symmetric ? "互为" : "单向"}
                               </span>
                               <span className="visually-hidden">
                                 {symmetric ? "与对方互为" : "指向右侧角色"}
                               </span>
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
                                title={expandedNotes.includes(relationship.id) ? "收起备注" : "展开完整备注"}
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
                             {/* One control per row. The same three commands, one press
                                 away, and the row stops competing with the names it is
                                 made of. */}
                             <div className="manage-row-menu-wrap">
                               <button
                                 aria-expanded={manageMenuId === relationship.id}
                                 aria-haspopup="menu"
                                 aria-label={`${fromName} ${symmetric ? "与" : "到"} ${toName} 的${relationshipKindLabel(relationship.kind)}关系：更多操作`}
                                 className="manage-row-more"
                                 data-tooltip="更多操作"
                                 onClick={(event) => {
                                   const willOpen = manageMenuId !== relationship.id;
                                   setManageMenuId(willOpen ? relationship.id : null);
                                   if (willOpen) {
                                     // The table scrolls, so a menu in the row is clipped
                                     // by it. Measure the trigger and paint the menu in the
                                     // page instead: below when there is room, above when
                                     // there is not, right-aligned and pulled inside the
                                     // viewport at the edge.
                                     const rect = event.currentTarget.getBoundingClientRect();
                                     const width = 148;
                                     const height = 132;
                                     const below = rect.bottom + 6;
                                     const top = below + height > window.innerHeight ? rect.top - height - 6 : below;
                                     setManageMenuPos({
                                       top: Math.max(8, top),
                                       left: Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8)),
                                     });
                                   }
                                 }}
                                 type="button"
                               >
                                 <Icon name="more" size={16} />
                               </button>
                               {manageMenuId === relationship.id &&
                                 manageMenuPos &&
                                 createPortal(
                                 <div
                                   className="manage-row-menu is-floating"
                                   data-testid="manage-row-menu"
                                   role="menu"
                                   style={{ top: manageMenuPos.top, left: manageMenuPos.left }}
                                 >
                                   <button
                                     aria-label={`编辑 ${fromName} 与 ${toName} 的${relationshipKindLabel(relationship.kind)}关系`}
                                     onClick={(event) => {
                                       // The menu item disappears with the menu, so
                                       // focus goes back to the row's own trigger
                                       // first; that is what the dialog returns to.
                                       event.currentTarget
                                         .closest(".manage-row-menu-wrap")
                                         ?.querySelector<HTMLElement>(".manage-row-more")
                                         ?.focus();
                                       setManageMenuId(null);
                                       openEdit(relationship);
                                     }}
                                     role="menuitem"
                                     type="button"
                                   >
                                     <Icon name="pencil" size={14} />
                                     编辑
                                   </button>
                                   <button
                                     aria-label={`在图谱中定位 ${fromName}`}
                                     onClick={() => {
                                       setManageMenuId(null);
                                       locateOnGraph(relationship);
                                     }}
                                     role="menuitem"
                                     type="button"
                                   >
                                     <Icon name="search" size={14} />
                                     定位
                                   </button>
                                   <button
                                     aria-label={`删除 ${fromName} ${symmetric ? "与" : "到"} ${toName} 的${relationshipKindLabel(relationship.kind)}关系`}
                                     className="danger"
                                     onClick={(event) => {
                                       event.currentTarget
                                         .closest(".manage-row-menu-wrap")
                                         ?.querySelector<HTMLElement>(".manage-row-more")
                                         ?.focus();
                                       setManageMenuId(null);
                                       setPendingDelete(relationship);
                                     }}
                                     role="menuitem"
                                     type="button"
                                   >
                                     <Icon name="trash" size={14} />
                                     删除
                                   </button>
                                 </div>,
                                   document.body,
                                 )}
                             </div>
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
            <p className="relationship-dialog-legend">
              {draftSymmetric
                ? "两端对等，不区分方向。"
                : "方向：A → B，箭头指向 B（师承时 B 是学习方）。"}
            </p>
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

    </>
  );

  return (
    <section
      className={
        isStudio ? "workspace-card relationship-page graph-studio" : "page-grid relationship-page"
      }
      id="workspace-relationships"
    >
      {isStudio ? (
        <>
          {heroHeader}
          {pageBody}
        </>
      ) : (
        <>
          {/* Same skeleton as the character workspace: a hero card, a 20px gap, then
              the card that holds the module. Two siblings, never one box around both. */}
          <div className="panel hero-card">{heroHeader}</div>
          <div className="panel relationship-workspace-card">{pageBody}</div>
          {/* Under the work, outside the card: a line of the page, not another panel. */}
          <GraphGuide />
        </>
      )}
    </section>
  );
}
