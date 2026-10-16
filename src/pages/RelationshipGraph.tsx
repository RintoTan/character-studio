import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
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
import { exportSurfaceImage, exportSurfacePdf } from "../utils/importExport";
import { getAvatarAssetDataUrl } from "../utils/avatarAssets";
import { useTransientMessage } from "../hooks/useTransientMessage";
import { useDialogKeyboard } from "../hooks/useDialogKeyboard";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { CharacterSelect } from "../components/CharacterPicker";
import { CharacterRow, characterDisplayName, matchesCharacterQuery } from "../components/CharacterRow";

type RelationshipGraphProps = {
  characters: Character[];
  onBack: () => void;
  onOpenCharacter: (characterId: string) => void;
  /** Asked for by another screen — the preview's 在关系网中查看 — and consumed once. */
  focusCharacterId?: string | null;
  onFocusHandled?: () => void;
};

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
const MIN_LABEL_PX = 9;
const LABEL_GAP_FACTOR = 2.4;
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

  return clampZoom(Math.max(1, Math.min(allowance, max)));
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
  const visibleCharacters = useMemo(
    () => (showAll ? characters : characters.filter((character) => connectedIds.has(character.id))),
    [characters, connectedIds, showAll],
  );

  const metrics = useMemo(() => graphMetrics(prefs), [prefs]);
  const positions = useMemo(
    () => nodePositions(visibleCharacters.length, metrics.radius),
    [visibleCharacters.length, metrics.radius],
  );
  // The widest name the drawing will have to fit, so the outermost labels of a wide
  // wheel are not cut off by the canvas edge.
  const labelHalfWidth = useMemo(
    () =>
      widestNameHalfWidth(
        visibleCharacters.map((character) => character.name || "未命名角色"),
        metrics.nameSize,
      ),
    [visibleCharacters, metrics.nameSize],
  );
  const canvas = useMemo(
    () => canvasBox(positions, metrics, labelHalfWidth),
    [positions, metrics, labelHalfWidth],
  );
  const bends = useMemo(() => edgeBends(relationships), [relationships]);

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

  // Hover and focus are the same highlight. Focus wins while it is set, so hovering a
  // different node does not quietly drop the character the author searched for.
  const activeId = focusId ?? hoveredId;

  const neighbours = useMemo(() => {
    const ids = new Set<string>();
    if (!activeId) {
      return ids;
    }
    for (const relationship of relationships) {
      if (relationship.fromId === activeId) ids.add(relationship.toId);
      if (relationship.toId === activeId) ids.add(relationship.fromId);
    }
    return ids;
  }, [activeId, relationships]);

  // Unmeasured is not the same as scale 1: while the frame's size is unknown a label's
  // rendered size is unknown too, and guessing generously is how a hundred-character
  // wheel ends up with a smear of 3px names.
  const measured = frameSize.width > 0 && frameSize.height > 0;
  const screenScale = measured ? canvasScreenScale(frameSize, canvas.viewBox) : 0;
  const labelsFit = labelsReadable({
    positions,
    nameSize: metrics.nameSize,
    zoom: view.k,
    scale: screenScale,
  });

  // An export is the fitted graph with every name on it, not whatever corner the
  // canvas happens to be zoomed into. The author's own switch still wins: names turned
  // off are off in the picture too.
  const showLabels = prefs.showNames && (exporting || labelsFit);

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

  // On a phone the same drawing is fitted into a third of the width, so at "fit" a
  // twelve-character wheel renders its names seven pixels tall. Starting zoomed in
  // enough to read them — and letting the zoom control fit the whole thing on request —
  // is the readable version of the same screen. Applied once per mount, so the author's
  // own zoom and pan are never taken back.
  const narrowFitAppliedRef = useRef(false);

  useEffect(() => {
    if (!isNarrowScreen || narrowFitAppliedRef.current || screenScale <= 0) {
      return;
    }

    narrowFitAppliedRef.current = true;
    const zoom = clampZoom(Math.min(labelZoomNeeded(metrics.nameSize, screenScale), FOCUS_MAX_ZOOM));

    if (zoom <= 1) {
      return;
    }

    setView(centreOn({ x: VIEW / 2, y: VIEW / 2 }, zoom, canvas.viewBox));
  }, [isNarrowScreen, screenScale, metrics.nameSize, canvas.viewBox]);

  function zoomBy(factor: number) {
    setView((current) => ({ ...current, k: clampZoom(current.k * factor) }));
  }

  /**
   * 适配画布 in both senses: the box the drawing was given, and the zoom that makes the
   * drawing use it. The box's centre is the drawing's centre — `canvasBox` grows the box
   * around it — so centring on the box keeps the graph where it was.
   */
  function applyFitView() {
    const [boxX, boxY, boxWidth, boxHeight] = canvas.viewBox.split(" ").map(Number);
    const zoom = fitZoom(contentBounds(positions, metrics, labelHalfWidth), frameSize, screenScale);

    setView(centreOn({ x: boxX + boxWidth / 2, y: boxY + boxHeight / 2 }, zoom, canvas.viewBox));
  }

  /** What the 适配画布 control and the export both mean by "fit". */
  function resetView() {
    applyFitView();
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

  function beginPan(event: ReactPointerEvent<SVGSVGElement>) {
    if (event.pointerType === "mouse" && event.button !== 0) {
      return;
    }

    // Which node this press started on, read before the capture below is set.
    //
    // Capturing the pointer on the <svg> retargets the compatibility mouse events to
    // the capturing element, so the `click` that follows a tap is delivered to the
    // <svg> and never reaches the node's own handler — which is how "click a node to
    // open the character" quietly stopped working everywhere except the keyboard. The
    // gesture is resolved on release instead, from the node the press began on.
    pressedNodeRef.current =
      (event.target as Element | null)?.closest?.("[data-character-id]")?.getAttribute("data-character-id") ??
      null;

    event.currentTarget.setPointerCapture(event.pointerId);
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pointersRef.current.size === 2) {
      const [first, second] = [...pointersRef.current.values()];
      pinchRef.current = { distance: Math.hypot(first.x - second.x, first.y - second.y) };
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

  function endPan(event: ReactPointerEvent<SVGSVGElement>) {
    const pan = panRef.current;
    // A press that never moved is a tap: that, not a `click`, is what opens the
    // character. It has to be the pan this gesture started, so lifting one finger of a
    // pinch is not a tap on whatever it landed on.
    const tapped = Boolean(pan && pan.pointerId === event.pointerId && !pan.moved && pressedNodeRef.current);
    const tappedId = pressedNodeRef.current;

    pointersRef.current.delete(event.pointerId);
    if (pointersRef.current.size < 2) {
      pinchRef.current = null;
    }
    if (pointersRef.current.size === 0) {
      panRef.current = null;
      pressedNodeRef.current = null;
    }

    if (tapped && tappedId) {
      onOpenCharacter(tappedId);
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
      // Not silently: the character exists, the canvas is filtered, and the author is
      // told which of the two it is.
      setNotOnCanvas(character);
      return;
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
    // Zoom only as far as the name needs to become readable. A handful of characters
    // are already legible at fit and are only re-centred.
    const needed = Math.min(labelZoomNeeded(metrics.nameSize, screenScale), FOCUS_MAX_ZOOM);
    setView((current) =>
      centreOn(entry, clampZoom(Math.max(current.k, labelsFit ? 1 : needed)), canvas.viewBox),
    );
  }, [pendingFocusId, byId, metrics.nameSize, screenScale, labelsFit, canvas.viewBox]);

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
    setDraft({
      fromId: characters[0]?.id ?? "",
      toId: characters[1]?.id ?? characters[0]?.id ?? "",
      kind: "friend",
      note: "",
    });
  }

  function submitDraft() {
    if (!draft || !draft.fromId || !draft.toId || draft.fromId === draft.toId) {
      return;
    }
    // Refused rather than stored: storage drops the repeat on read anyway, and a save
    // that silently does nothing reads as a broken button.
    if (findDuplicateRelationship(relationships, draft.fromId, draft.toId, draft.kind)) {
      show("这条关系已经存在了");
      return;
    }
    const next = [...loadRelationships(), createRelationship(draft.fromId, draft.toId, draft.kind, draft.note)];
    saveRelationships(next);
    setRelationships(loadRelationships());
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

  const canLink = characters.length >= 2;
  const draftSymmetric = draft ? isSymmetricKind(draft.kind) : false;
  const draftDuplicate = draft
    ? findDuplicateRelationship(relationships, draft.fromId, draft.toId, draft.kind)
    : undefined;
  const draftDuplicateReversed =
    draft && draftDuplicate ? draftDuplicate.fromId === draft.toId : false;
  // Both dialogs take the keyboard: Escape cancels, Enter saves, focus moves in.
  const draftDialogRef = useDialogKeyboard({
    active: Boolean(draft),
    onClose: () => setDraft(null),
    onConfirm: submitDraft,
    confirmDisabled: Boolean(draft) && (draft!.fromId === draft!.toId || Boolean(draftDuplicate)),
  });
  const deleteDialogRef = useDialogKeyboard({
    active: Boolean(pendingDelete),
    onClose: () => setPendingDelete(null),
    onConfirm: confirmDelete,
  });

  return (
    <section className="workspace-card relationship-page" id="workspace-relationships">
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
          {canLink && (
            <button
              aria-pressed={showAll}
              className={showAll ? "graph-toggle active" : "graph-toggle"}
              onClick={() => setShowAll((current) => !current)}
              type="button"
            >
              {showAll ? "显示全部角色" : "只显示有关联的"}
                <span className="graph-toggle-count">{showAll ? characters.length : connectedIds.size}</span>
              </button>
            )}
            </div>
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
      ) : (
        <>
          {/* The drawing is decorative markup; the edge list below is the
              accessible representation of the same data.
              The canvas zooms and pans so a large roster stays navigable instead of
              being flattened into one unreadable ring: names appear only past the
              label zoom, which scales with how many characters there are. */}
          {/* What acts on the canvas sits with the canvas: finding a character,
              zooming, and what the nodes show. The header keeps what the graph
              contains. */}
          <div className="graph-canvas-tools">
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
                          {byId.has(character.id) ? "在画布中" : "不在画布"}
                        </span>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>

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
            </div>
          </div>

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
          <div className="graph-canvas-frame" ref={frameRef}>
          <svg
            aria-hidden="true"
            className="relationship-canvas"
            onPointerCancel={endPan}
            onPointerDown={beginPan}
            onPointerMove={movePan}
            onPointerUp={endPan}
            ref={svgRef}
            viewBox={canvas.viewBox}
            xmlns="http://www.w3.org/2000/svg"
          >
            <defs>
              {prefs.showAvatars &&
                visibleCharacters.map((character, index) =>
                  avatarUrls[character.id] ? (
                    <clipPath id={avatarClipId(character.id)} key={character.id}>
                      <circle cx={positions[index].x} cy={positions[index].y} r={metrics.radius} />
                    </clipPath>
                  ) : null,
                )}
            </defs>
            <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
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
              const touchesHovered =
                activeId !== null &&
                (relationship.fromId === activeId || relationship.toId === activeId);
              return (
                <g
                  className={`relationship-edge kind-${relationship.kind}${touchesHovered ? " active" : ""}`}
                  key={relationship.id}
                >
                  <path d={geometry.path} />
                  {geometry.arrow && (
                    <polygon className="relationship-arrow-head" points={geometry.arrow} />
                  )}
                  <text x={geometry.labelX} y={geometry.labelY}>
                    {relationshipKindLabel(relationship.kind)}
                  </text>
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
              const labelled = prefs.showNames && (showLabels || isHovered || isFocused || isNeighbour);
              const state = isFocused
                ? "relationship-node active focused"
                : isHovered
                  ? "relationship-node active"
                  : activeId && character.id !== activeId && !isNeighbour
                    ? "relationship-node dimmed"
                    : "relationship-node";
              const avatarUrl = avatarUrls[character.id];
              return (
                <g
                  className={state}
                  data-character-id={character.id}
                  data-character-name={characterDisplayName(character)}
                  key={character.id}
                  onClick={() => {
                    // A drag ends on the node it started on; that is a pan, not a click.
                    if (panRef.current?.moved) {
                      return;
                    }
                    onOpenCharacter(character.id);
                  }}
                  onPointerEnter={() => setHoveredId(character.id)}
                  onPointerLeave={() => setHoveredId(null)}
                  role="presentation"
                >
                  <circle cx={positions[index].x} cy={positions[index].y} r={metrics.radius} />
                  {/* An uploaded picture is drawn as the node itself, through the same
                      circle and at the same size as the emoji it replaces. Before this
                      the graph only ever drew `avatarEmoji`, so a character with a
                      photo showed a generic face here and the real one everywhere
                      else — the picture was not broken, it was never asked for. */}
                  {prefs.showAvatars && avatarUrl && (
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
                  {prefs.showAvatars && !avatarUrl && (
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
                      className="relationship-node-name"
                      style={{ fontSize: `${metrics.nameSize}px` }}
                      x={positions[index].x}
                      y={positions[index].y + metrics.nameDrop}
                    >
                      {characterDisplayName(character)}
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
                    <span className="graph-control-label">格式</span>
                    <div className="graph-segment">
                      {(["jpg", "png", "pdf"] as const).map((format) => (
                        <button
                          className="graph-segment-button"
                          disabled={exporting}
                          key={format}
                          onClick={() => void runExport(format)}
                          type="button"
                        >
                          {exporting ? "导出中…" : format.toUpperCase()}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="relationship-table-head">
            <h3>关系列表</h3>
            <span className="muted">
              {relationships.length} 条 · 互为关系不分方向，师承指向学习的一方
            </span>
          </div>
          <div className="relationship-table-wrap">
            <table className="relationship-table">
              <caption className="visually-hidden">
                关系列表：关系类型、两个角色、备注与操作
              </caption>
              <thead>
                <tr>
                  <th scope="col">关系</th>
                  <th scope="col">角色</th>
                  <th scope="col">另一方</th>
                  <th scope="col">备注</th>
                  <th className="relationship-col-actions" scope="col">操作</th>
                </tr>
              </thead>
              <tbody>
                {relationships.map((relationship) => {
                  const symmetric = isSymmetricKind(relationship.kind);
                  const fromName = byId.get(relationship.fromId)?.character.name ?? "未知角色";
                  const toName = byId.get(relationship.toId)?.character.name ?? "未知角色";
                  return (
                    <tr key={relationship.id}>
                      <td>
                        <span className={`relationship-kind-chip kind-${relationship.kind}`}>
                          {relationshipKindLabel(relationship.kind)}
                        </span>
                      </td>
                      <td>{fromName}</td>
                      <td>
                        <span aria-hidden="true">{symmetric ? "↔" : "→"}</span>
                        <span className="visually-hidden">{symmetric ? "与" : "指向"}</span>
                        {toName}
                      </td>
                      <td className="relationship-table-note">{relationship.note || "—"}</td>
                      <td className="relationship-col-actions">
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
        </>
      )}

      {message && (
        <p aria-live="polite" className="graph-message" role="status">
          {message}
        </p>
      )}

      {draft && (
        <div className="modal-backdrop" role="presentation">
          <div
            className="confirm-dialog"
            ref={draftDialogRef}
            role="dialog"
            aria-modal="true"
            aria-label="新建关系"
          >
            <h2>新建关系</h2>
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
            <div className="form-actions">
              <button className="ghost-button" onClick={() => setDraft(null)} type="button">
                取消
              </button>
              <button
                className="primary-button"
                disabled={draft.fromId === draft.toId || Boolean(draftDuplicate)}
                onClick={submitDraft}
                type="button"
              >
                保存关系
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
              将删除「{relationshipKindLabel(pendingDelete.kind)}」关系：{byId.get(pendingDelete.fromId)?.character.name}
              {isSymmetricKind(pendingDelete.kind) ? " ↔ " : " → "}
              {byId.get(pendingDelete.toId)?.character.name}。
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
