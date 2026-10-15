import {
  useEffect,
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
  NAME_SIZES,
  graphMetrics,
  loadGraphPrefs,
  saveGraphPrefs,
  type GraphMetrics,
  type GraphPrefs,
} from "../storage/graphPrefs";
import { exportSurfaceImage, exportSurfacePdf } from "../utils/importExport";
import { useTransientMessage } from "../hooks/useTransientMessage";
import { useDialogKeyboard } from "../hooks/useDialogKeyboard";

type RelationshipGraphProps = {
  characters: Character[];
  onBack: () => void;
  onOpenCharacter: (characterId: string) => void;
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
// Breathing room between two neighbouring nodes on the ring.
const NODE_GAP = 10;
// Below this zoom the names are hidden: at fit view a hundred of them overlap into
// a grey smear, which is the state the graph used to be in permanently.
const LABEL_ZOOM = 1.5;
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
 * How far the author has to zoom before names are drawn. A handful of characters
 * can show their names almost immediately; a hundred of them cannot be shown at
 * once at any zoom, so the threshold scales with the roster instead of being a
 * single number that is either wrong for two characters or wrong for a hundred.
 */
export function labelZoomThreshold(count: number) {
  return Math.max(LABEL_ZOOM, count / 40);
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
  // Sideways the widest name, not just the widest node, has to fit: the outer
  // nodes of a wheel are exactly where a centred label overhangs the edge.
  const halfWidth = metrics.radius + CANVAS_PADDING + labelHalfWidth;
  const drawnWidth = Math.max(...xs) - Math.min(...xs) + halfWidth * 2;
  const drawnHeight =
    Math.max(...ys) -
    Math.min(...ys) +
    metrics.radius +
    CANVAS_PADDING +
    metrics.nameDrop +
    metrics.nameSpace;
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

export function RelationshipGraph({ characters, onBack, onOpenCharacter }: RelationshipGraphProps) {
  const [relationships, setRelationships] = useState<Relationship[]>([]);
  const [draft, setDraft] = useState<{ fromId: string; toId: string; kind: RelationshipKind; note: string } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Relationship | null>(null);
  const [prefs, setPrefs] = useState<GraphPrefs>(() => loadGraphPrefs());
  const [exporting, setExporting] = useState(false);
  const { message, show } = useTransientMessage();
  const frameRef = useRef<HTMLDivElement | null>(null);
  const prefsLoadedRef = useRef(false);

  // Written on change rather than inside the setter: a state updater can be called
  // twice for one interaction, and a preference is not worth persisting twice.
  useEffect(() => {
    if (!prefsLoadedRef.current) {
      prefsLoadedRef.current = true;
      return;
    }
    saveGraphPrefs(prefs);
  }, [prefs]);

  useEffect(() => {
    // Prune on entry so the graph never draws an edge to a character that was
    // deleted while this screen was closed.
    setRelationships(pruneRelationships(characters.map((character) => character.id)));
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

  const neighbours = useMemo(() => {
    const ids = new Set<string>();
    if (!hoveredId) {
      return ids;
    }
    for (const relationship of relationships) {
      if (relationship.fromId === hoveredId) ids.add(relationship.toId);
      if (relationship.toId === hoveredId) ids.add(relationship.fromId);
    }
    return ids;
  }, [hoveredId, relationships]);

  // An export is the fitted graph with every name on it, not whatever corner the
  // canvas happens to be zoomed into.
  const showLabels = exporting || view.k >= labelZoomThreshold(visibleCharacters.length);

  function zoomBy(factor: number) {
    setView((current) => ({ ...current, k: clampZoom(current.k * factor) }));
  }

  function resetView() {
    setView({ k: 1, x: 0, y: 0 });
  }

  /** Zooms about a point given in client coordinates, so the point stays put. */
  function zoomAround(svg: SVGSVGElement, clientX: number, clientY: number, factor: number) {
    const rect = svg.getBoundingClientRect();
    const [boxX, boxY, boxW, boxH] = canvas.viewBox.split(" ").map(Number);
    const pointerX = boxX + ((clientX - rect.left) / rect.width) * boxW;
    const pointerY = boxY + ((clientY - rect.top) / rect.height) * boxH;

    setView((current) => {
      const k = clampZoom(current.k * factor);
      const ratio = k / current.k;

      return {
        k,
        x: pointerX - (pointerX - current.x) * ratio,
        y: pointerY - (pointerY - current.y) * ratio,
      };
    });
  }

  function handleWheel(event: ReactWheelEvent<SVGSVGElement>) {
    zoomAround(event.currentTarget, event.clientX, event.clientY, event.deltaY < 0 ? 1.15 : 1 / 1.15);
  }

  function beginPan(event: ReactPointerEvent<SVGSVGElement>) {
    if (event.pointerType === "mouse" && event.button !== 0) {
      return;
    }
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
    const rect = event.currentTarget.getBoundingClientRect();
    const [, , boxW, boxH] = canvas.viewBox.split(" ").map(Number);
    const dx = (event.clientX - pan.lastX) * (boxW / rect.width);
    const dy = (event.clientY - pan.lastY) * (boxH / rect.height);
    pan.lastX = event.clientX;
    pan.lastY = event.clientY;
    if (Math.abs(dx) + Math.abs(dy) > 0.6) {
      pan.moved = true;
    }
    setView((current) => ({ ...current, x: current.x + dx, y: current.y + dy }));
  }

  function endPan(event: ReactPointerEvent<SVGSVGElement>) {
    pointersRef.current.delete(event.pointerId);
    if (pointersRef.current.size < 2) {
      pinchRef.current = null;
    }
    if (pointersRef.current.size === 0) {
      panRef.current = null;
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
      const options = { background: surfaceBackground(), label: "关系网画布", scale: 2 };
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
      <div className="workspace-card-head">
        <div>
          <p className="eyebrow">RELATIONSHIPS</p>
          <h2>角色关系网</h2>
          <p className="muted">
            {characters.length} 个角色 · {relationships.length} 条关系
          </p>
        </div>
        <div className="workspace-toolbar">
          <button className="ghost-button" onClick={onBack} type="button">
            返回 Dashboard
          </button>
          {canLink && (
            <div className="graph-zoom" role="group" aria-label="画布缩放">
              <button aria-label="缩小画布" className="bare-icon-button" onClick={() => zoomBy(1 / 1.25)} type="button">
                <Icon name="minus" size={16} />
              </button>
              <span className="graph-zoom-value">{Math.round(view.k * 100)}%</span>
              <button aria-label="放大画布" className="bare-icon-button" onClick={() => zoomBy(1.25)} type="button">
                <Icon name="plus" size={16} />
              </button>
              <button className="ghost-button" onClick={resetView} type="button">
                适配
              </button>
            </div>
          )}
          {canLink && (
            <button
              className="ghost-button"
              onClick={() => setShowAll((current) => !current)}
              type="button"
            >
              <span className="graph-toggle-full">
                {showAll ? `只显示有关系（${connectedIds.size}）` : `显示全部角色（${characters.length}）`}
              </span>
              <span className="graph-toggle-short">
                {showAll ? `只显关联 ${connectedIds.size}` : `全部 ${characters.length}`}
              </span>
            </button>
          )}
          <button className="primary-button" disabled={!canLink} onClick={openDraft} type="button">
            新建关系
          </button>
        </div>
      </div>

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
          {/* The capture target is this frame, not the <svg> inside it: html2canvas
              clones the document and then looks the element up in the clone, and an
              <svg> handed to it directly is not found there — it throws the bare
              string "Unable to find element in cloned iframe". Its child SVGs render
              fine, which is why the character sheets always exported. */}
          <div className="graph-canvas-frame" ref={frameRef}>
          <svg
            aria-hidden="true"
            className="relationship-canvas"
            onPointerCancel={endPan}
            onPointerDown={beginPan}
            onPointerMove={movePan}
            onPointerUp={endPan}
            onWheel={handleWheel}
            viewBox={canvas.viewBox}
            xmlns="http://www.w3.org/2000/svg"
          >
            <defs />
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
                hoveredId !== null &&
                (relationship.fromId === hoveredId || relationship.toId === hoveredId);
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
              const isNeighbour = neighbours.has(character.id);
              const labelled = showLabels || isHovered || isNeighbour;
              const state = isHovered
                ? "relationship-node active"
                : hoveredId && !isNeighbour
                  ? "relationship-node dimmed"
                  : "relationship-node";
              return (
                <g
                  className={state}
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
                  <text
                    className="relationship-node-emoji"
                    style={{ fontSize: `${metrics.emojiSize}px` }}
                    x={positions[index].x}
                    y={positions[index].y}
                  >
                    {character.avatarEmoji || "🙂"}
                  </text>
                  {labelled && (
                    <text
                      className="relationship-node-name"
                      style={{ fontSize: `${metrics.nameSize}px` }}
                      x={positions[index].x}
                      y={positions[index].y + metrics.nameDrop}
                    >
                      {character.name || "未命名角色"}
                    </text>
                  )}
                </g>
              );
            })}
            </g>
          </svg>
          </div>

          {/* Canvas options and output sit with the canvas rather than in the
              toolbar: the toolbar wraps to a fourth row on a phone as it is, and
              these two act on the drawing above them. Both live outside the frame,
              so neither ends up in an export. */}
          <div className="graph-canvas-bar">
            <div className="graph-size-groups">
              <div aria-label="节点头像尺寸" className="graph-size-group" role="group">
                <span className="graph-size-label">头像</span>
                {AVATAR_SIZES.map((size) => (
                  <button
                    aria-pressed={prefs.avatarSize === size.value}
                    className={`graph-size-button${prefs.avatarSize === size.value ? " selected" : ""}`}
                    key={size.value}
                    onClick={() => updatePrefs({ avatarSize: size.value })}
                    type="button"
                  >
                    {size.label}
                  </button>
                ))}
              </div>
              <div aria-label="节点名称尺寸" className="graph-size-group" role="group">
                <span className="graph-size-label">名称</span>
                {NAME_SIZES.map((size) => (
                  <button
                    aria-pressed={prefs.nameSize === size.value}
                    className={`graph-size-button${prefs.nameSize === size.value ? " selected" : ""}`}
                    key={size.value}
                    onClick={() => updatePrefs({ nameSize: size.value })}
                    type="button"
                  >
                    {size.label}
                  </button>
                ))}
              </div>
            </div>
            <div aria-label="导出关系网" className="graph-export" role="group">
              <span className="graph-size-label">导出画布</span>
              {(["jpg", "png", "pdf"] as const).map((format) => (
                <button
                  className="ghost-button"
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
                  <th scope="col">操作</th>
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
                      <td>
                        <button
                          aria-label={`删除 ${fromName} ${symmetric ? "与" : "到"} ${toName} 的${relationshipKindLabel(relationship.kind)}关系`}
                          className="ghost-button"
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
            {/* The three selects are labelled for the kind chosen: a symmetric
                relationship has two equal sides, a 师承 edge has a direction. */}
            <label className="field">
              <span>{draftSymmetric ? "角色 A" : "师承方"}</span>
              <select onChange={(event) => setDraft({ ...draft, fromId: event.target.value })} value={draft.fromId}>
                {characters.map((character) => (
                  <option key={character.id} value={character.id}>
                    {character.name || "未命名角色"}
                  </option>
                ))}
              </select>
            </label>
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
            <label className="field">
              <span>{draftSymmetric ? "角色 B" : "学习方"}</span>
              <select onChange={(event) => setDraft({ ...draft, toId: event.target.value })} value={draft.toId}>
                {characters.map((character) => (
                  <option key={character.id} value={character.id}>
                    {character.name || "未命名角色"}
                  </option>
                ))}
              </select>
            </label>
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
