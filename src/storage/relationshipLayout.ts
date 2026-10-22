// Where the author put each character on the relationship canvas, and which
// visual groups they belong to.
//
// This is presentation data, deliberately kept apart from `Character` and from
// `Relationship`: moving a circle is not an edit to the person, and naming a
// cluster of circles is not a claim about their world. Nothing here is derived
// from a worldview field, and nothing here writes one.
//
import {
  DEFAULT_CANVAS_STYLE,
  normalizeCanvasStyle,
  type CanvasBookmark,
  type CanvasStyle,
  type EdgeStylePatch,
  type NodeStylePatch,
} from "./canvasStyle";
import { normalizeSnapshots, type LayoutSnapshot } from "../utils/layoutSnapshots";

// Positions are keyed by character id, so renaming a character moves nothing.
// The layout is versioned on its own so a later shape can migrate rather than
// guess, and every reader goes through `normalizeLayout`, so a hand-edited or
// half-written record degrades to an empty canvas instead of a broken one.
export type { CanvasBookmark } from "./canvasStyle";

export const RELATIONSHIP_LAYOUT_KEY = "character-studio.relationship-layout";

export const LAYOUT_SCHEMA_VERSION = 2;

/** Drawing-space coordinates, the same units `nodePositions` produces. */
export type LayoutPoint = { x: number; y: number };

export type CanvasGroup = {
  id: string;
  name: string;
  characterIds: string[];
};

export type CanvasLayout = {
  schemaVersion: number;
  positions: Record<string, LayoutPoint>;
  groups: CanvasGroup[];
  /** Drawing appearance. Presentation only — never character or relationship data. */
  style?: CanvasStyle;
  nodeStyles?: Record<string, NodeStylePatch>;
  edgeStyles?: Record<string, EdgeStylePatch>;
  bookmarks?: CanvasBookmark[];
  /** Named arrangements of the same positions, kept apart from style presets. */
  snapshots?: LayoutSnapshot[];
};

export const emptyLayout = (): CanvasLayout => ({
  schemaVersion: LAYOUT_SCHEMA_VERSION,
  positions: {},
  groups: [],
  style: DEFAULT_CANVAS_STYLE,
  nodeStyles: {},
  edgeStyles: {},
  bookmarks: [],
  snapshots: [],
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finitePoint(value: unknown): LayoutPoint | null {
  if (!isRecord(value)) {
    return null;
  }

  const { x, y } = value;
  if (typeof x !== "number" || typeof y !== "number" || !Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }

  // A coordinate beyond this is not a drag, it is corrupt data (or a JSON
  // number that lost its precision). Keeping it would make the fit view a dot.
  if (Math.abs(x) > 1_000_000 || Math.abs(y) > 1_000_000) {
    return null;
  }

  return { x, y };
}

/**
 * A stored record, made safe to render.
 *
 * Per-entry, not all-or-nothing: one unreadable coordinate should not discard
 * the other ninety-nine, and one malformed group should not take the canvas
 * with it. A character belongs to at most one group — several rectangles around
 * one node would move it twice per drag.
 */
export function normalizeLayout(value: unknown): CanvasLayout {
  if (!isRecord(value)) {
    return emptyLayout();
  }

  const positions: Record<string, LayoutPoint> = {};
  if (isRecord(value.positions)) {
    for (const [id, point] of Object.entries(value.positions)) {
      const valid = finitePoint(point);
      if (id && valid) {
        positions[id] = { x: Math.round(valid.x * 100) / 100, y: Math.round(valid.y * 100) / 100 };
      }
    }
  }

  const groups: CanvasGroup[] = [];
  const claimed = new Set<string>();
  if (Array.isArray(value.groups)) {
    const seenIds = new Set<string>();
    for (const raw of value.groups) {
      if (!isRecord(raw)) {
        continue;
      }
      const id = typeof raw.id === "string" && raw.id ? raw.id : "";
      const name = typeof raw.name === "string" ? raw.name.trim().slice(0, 40) : "";
      const members = Array.isArray(raw.characterIds)
        ? [
            ...new Set(
              raw.characterIds.filter(
                (member): member is string =>
                  typeof member === "string" && member.length > 0 && !claimed.has(member),
              ),
            ),
          ]
        : [];
      if (!id || !name || seenIds.has(id) || members.length < 2) {
        continue;
      }
      seenIds.add(id);
      members.forEach((member) => claimed.add(member));
      groups.push({ id, name, characterIds: members });
    }
  }

  const nodeStyles: Record<string, NodeStylePatch> = {};
  if (isRecord(value.nodeStyles)) {
    for (const [id, patch] of Object.entries(value.nodeStyles)) {
      if (id && isRecord(patch)) {
        nodeStyles[id] = patch as NodeStylePatch;
      }
    }
  }
  const edgeStyles: Record<string, EdgeStylePatch> = {};
  if (isRecord(value.edgeStyles)) {
    for (const [id, patch] of Object.entries(value.edgeStyles)) {
      if (id && isRecord(patch)) {
        edgeStyles[id] = patch as EdgeStylePatch;
      }
    }
  }
  const bookmarks: CanvasBookmark[] = Array.isArray(value.bookmarks)
    ? value.bookmarks
        .filter(isRecord)
        .map((item) => {
          const view = (item.view ?? {}) as Record<string, unknown>;
          return {
            id: typeof item.id === "string" ? item.id : "",
            name: typeof item.name === "string" ? item.name.slice(0, 40) : "",
            view: { k: Number(view.k), x: Number(view.x), y: Number(view.y) },
          };
        })
        .filter(
          (item) =>
            item.id && item.name && Number.isFinite(item.view.k) && Number.isFinite(item.view.x) && Number.isFinite(item.view.y),
        )
        .slice(0, 30)
    : [];

  return {
    schemaVersion: LAYOUT_SCHEMA_VERSION,
    positions,
    groups,
    snapshots: normalizeSnapshots(value.snapshots),
    // Sprint 49 packages have no style block; they open in the accepted classic look.
    style: normalizeCanvasStyle(value.style),
    nodeStyles,
    edgeStyles,
    bookmarks,
  };
}

export function loadLayout(): CanvasLayout {
  try {
    const stored = localStorage.getItem(RELATIONSHIP_LAYOUT_KEY);
    return stored ? normalizeLayout(JSON.parse(stored)) : emptyLayout();
  } catch {
    return emptyLayout();
  }
}

/** The same write, but the caller is told when the quota refused it. */
export function trySaveLayout(layout: CanvasLayout): boolean {
  try {
    localStorage.setItem(RELATIONSHIP_LAYOUT_KEY, JSON.stringify(layout));
    return true;
  } catch {
    return false;
  }
}

export function saveLayout(layout: CanvasLayout): void {
  try {
    localStorage.setItem(RELATIONSHIP_LAYOUT_KEY, JSON.stringify(layout));
  } catch {
    // A full quota must not take the canvas down with it.
  }
}

export function isEmptyLayout(layout: CanvasLayout): boolean {
  return Object.keys(layout.positions).length === 0 && layout.groups.length === 0;
}

/** Whether this character already has a hand-kept position. */
export function hasPosition(layout: CanvasLayout, characterId: string): boolean {
  return Boolean(layout.positions[characterId]);
}

/**
 * Drops coordinates and group memberships for characters that no longer exist.
 *
 * A deleted character must not leave a rectangle behind, and a group reduced to
 * one member is no longer a group.
 */
export function pruneLayout(
  layout: CanvasLayout,
  validIds: Iterable<string>,
  validEdgeIds?: Iterable<string>,
): CanvasLayout {
  const valid = new Set(validIds);
  const positions: Record<string, LayoutPoint> = {};

  for (const [id, point] of Object.entries(layout.positions)) {
    if (valid.has(id)) {
      positions[id] = point;
    }
  }

  const groups = layout.groups
    .map((group) => ({
      ...group,
      characterIds: group.characterIds.filter((id) => valid.has(id)),
    }))
    .filter((group) => group.characterIds.length >= 2);

  const nodeStyles = Object.fromEntries(
    Object.entries(layout.nodeStyles ?? {}).filter(([id]) => valid.has(id)),
  );
  // Edges are only pruned when the caller knows the live set: a layout may be
  // loaded before the relationships are, and "not asked" is not "deleted".
  const edges = validEdgeIds ? new Set(validEdgeIds) : null;
  const edgeStyles = edges
    ? Object.fromEntries(Object.entries(layout.edgeStyles ?? {}).filter(([id]) => edges.has(id)))
    : layout.edgeStyles;
  return {
    schemaVersion: LAYOUT_SCHEMA_VERSION,
    positions,
    groups,
    style: layout.style,
    nodeStyles,
    edgeStyles,
    bookmarks: layout.bookmarks,
    snapshots: layout.snapshots,
  };
}

export type PlacementOptions = {
  /** Character diameter plus breathing room, in drawing units. */
  spacing?: number;
  /** Where the first free slot starts when there is no existing drawing. */
  origin?: LayoutPoint;
  /** How many nodes per row when placing newcomers. */
  columns?: number;
};

const DEFAULT_SPACING = 110;

function boundsOf(points: LayoutPoint[]): { minX: number; minY: number; maxX: number; maxY: number } | null {
  if (points.length === 0) {
    return null;
  }

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }

  return { minX, minY, maxX, maxY };
}

/**
 * Gives every id without a position one, without touching anything already placed.
 *
 * Newcomers go in rows under the current drawing rather than on top of it: a
 * character imported after the canvas was arranged should appear somewhere
 * empty, not under an existing node. When the canvas has never been arranged,
 * the caller passes the ring it is already drawing, so the first materialised
 * layout is pixel-identical to what was on screen.
 */
export function placeMissingPositions(
  layout: CanvasLayout,
  ids: string[],
  options: PlacementOptions = {},
): CanvasLayout {
  const missing = ids.filter((id) => id && !layout.positions[id]);
  if (missing.length === 0) {
    return layout;
  }

  const spacing = options.spacing ?? DEFAULT_SPACING;
  const columns = Math.max(1, options.columns ?? 6);
  const positions = { ...layout.positions };
  const bounds = boundsOf(Object.values(positions));
  const origin = options.origin ?? (bounds ? { x: bounds.minX, y: bounds.maxY + spacing } : { x: 0, y: 0 });

  missing.forEach((id, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    positions[id] = { x: origin.x + column * spacing, y: origin.y + row * spacing };
  });

  return { schemaVersion: LAYOUT_SCHEMA_VERSION, positions, groups: layout.groups };
}

/** Turns the drawn ring into stored coordinates, so the first edit does not jump. */
export function materializeLayout(
  layout: CanvasLayout,
  orderedIds: string[],
  ring: LayoutPoint[],
): CanvasLayout {
  if (orderedIds.length === 0) {
    return layout;
  }

  const positions = { ...layout.positions };
  orderedIds.forEach((id, index) => {
    if (!positions[id] && ring[index]) {
      positions[id] = { x: ring[index].x, y: ring[index].y };
    }
  });

  // Everything else travels with the positions. Rebuilding the record from
  // positions and groups alone is how applying a preset used to erase every local
  // node colour, every line style and every bookmark: the caller wrote the whole
  // layout back, and those fields were simply not in it.
  return {
    schemaVersion: LAYOUT_SCHEMA_VERSION,
    positions,
    groups: layout.groups,
    style: layout.style,
    nodeStyles: layout.nodeStyles,
    edgeStyles: layout.edgeStyles,
    bookmarks: layout.bookmarks,
    // Saved arrangements travel with the rest: rebuilding this record without them is
    // how a drag used to erase every layout the author had saved.
    snapshots: layout.snapshots,
  };
}

export function setPosition(layout: CanvasLayout, characterId: string, point: LayoutPoint): CanvasLayout {
  return {
    ...layout,
    positions: {
      ...layout.positions,
      [characterId]: { x: Math.round(point.x * 100) / 100, y: Math.round(point.y * 100) / 100 },
    },
  };
}

export function translatePositions(
  layout: CanvasLayout,
  ids: Iterable<string>,
  delta: LayoutPoint,
): CanvasLayout {
  const positions = { ...layout.positions };

  for (const id of ids) {
    const point = positions[id];
    if (point) {
      positions[id] = { x: Math.round((point.x + delta.x) * 100) / 100, y: Math.round((point.y + delta.y) * 100) / 100 };
    }
  }

  return { ...layout, positions };
}

export function applyPositions(
  layout: CanvasLayout,
  next: Record<string, LayoutPoint>,
): CanvasLayout {
  return { ...layout, positions: { ...layout.positions, ...next } };
}

export type ArrangeMode =
  | "cluster"
  | "ring"
  | "grid"
  | "hierarchy"
  | "groups"
  | "spaced"
  /** A saved arrangement being restored through the same preview transaction. */
  | "snapshot";

/**
 * The ring every canvas starts as, and the shape 环形整理 produces.
 *
 * Radius grows with the count for the same reason `nodePositions` does: a
 * hundred nodes on a fixed ring is a solid band of overlapping circles. The
 * centre is the existing drawing's centre so an arrange does not also move the
 * whole thing off-screen.
 */
export function ringLayout(ids: string[], center: LayoutPoint, nodeRadius = 30, minRadius = 240): Record<string, LayoutPoint> {
  if (ids.length === 0) {
    return {};
  }

  if (ids.length === 1) {
    return { [ids[0]]: { ...center } };
  }

  if (ids.length === 2) {
    return {
      [ids[0]]: { x: center.x - 150, y: center.y },
      [ids[1]]: { x: center.x + 150, y: center.y },
    };
  }

  const radius = Math.max(minRadius, (ids.length * (nodeRadius * 2 + 30)) / (Math.PI * 2));
  const result: Record<string, LayoutPoint> = {};

  ids.forEach((id, index) => {
    const angle = (index / ids.length) * Math.PI * 2 - Math.PI / 2;
    result[id] = {
      x: Math.round((center.x + Math.cos(angle) * radius) * 100) / 100,
      y: Math.round((center.y + Math.sin(angle) * radius) * 100) / 100,
    };
  });

  return result;
}

export function centroid(points: LayoutPoint[], fallback: LayoutPoint = { x: 0, y: 0 }): LayoutPoint {
  if (points.length === 0) {
    return fallback;
  }

  const sum = points.reduce((total, point) => ({ x: total.x + point.x, y: total.y + point.y }), { x: 0, y: 0 });
  return { x: sum.x / points.length, y: sum.y / points.length };
}

/**
 * Connected components of the edges among the nodes being arranged.
 *
 * Cluster arranging asks "who belongs with whom" and the graph already answers
 * it: people joined by any relationship end up in the same clump, people with
 * no path between them do not. Isolated nodes become clumps of one and are laid
 * out in the spare row instead of being piled at the centre.
 */
export function connectedComponents(ids: string[], edges: Array<{ fromId: string; toId: string }>): string[][] {
  const within = new Set(ids);
  const adjacency = new Map<string, string[]>();

  for (const id of ids) {
    adjacency.set(id, []);
  }

  for (const edge of edges) {
    if (edge.fromId === edge.toId || !within.has(edge.fromId) || !within.has(edge.toId)) {
      continue;
    }
    adjacency.get(edge.fromId)?.push(edge.toId);
    adjacency.get(edge.toId)?.push(edge.fromId);
  }

  const seen = new Set<string>();
  const components: string[][] = [];

  for (const id of ids) {
    if (seen.has(id)) {
      continue;
    }

    const stack = [id];
    const component: string[] = [];
    seen.add(id);

    while (stack.length > 0) {
      const current = stack.pop() as string;
      component.push(current);
      for (const next of adjacency.get(current) ?? []) {
        if (!seen.has(next)) {
          seen.add(next);
          stack.push(next);
        }
      }
    }

    components.push(component);
  }

  return components;
}

/**
 * Clumps, packed on a circle.
 *
 * Each component is a ring of its own; the rings are then placed on a larger
 * circle sized so their bounding boxes clear each other. This is the shape the
 * drawing already had — a wheel of neighbours — with the structure made
 * explicit by giving separate groups of people separate wheels.
 */
export function clusterLayout(
  ids: string[],
  edges: Array<{ fromId: string; toId: string }>,
  center: LayoutPoint,
  nodeRadius = 30,
): Record<string, LayoutPoint> {
  if (ids.length === 0) {
    return {};
  }

  // Sorting keeps the outcome deterministic for the same graph: the same set of
  // ids must always produce the same preview, or "cancel, try again" would
  // produce a different drawing every time.
  const components = connectedComponents(ids, edges)
    .map((component) => [...component].sort())
    .sort((left, right) => right.length - left.length || left[0].localeCompare(right[0]));

  if (components.length === 1) {
    return ringLayout(components[0], center, nodeRadius);
  }

  const componentRadius = (size: number) =>
    size <= 1 ? nodeRadius * 2 : Math.max(nodeRadius * 2.6, (size * (nodeRadius * 2 + 26)) / (Math.PI * 2));

  const radii = components.map((component) => componentRadius(component.length));
  const orbit = Math.max(
    260,
    Math.max(...radii.map((radius) => radius * 2.6)) * Math.sqrt(components.length) * 0.9,
  );

  const result: Record<string, LayoutPoint> = {};

  components.forEach((component, index) => {
    const angle = (index / components.length) * Math.PI * 2 - Math.PI / 2;
    const hub = {
      x: center.x + Math.cos(angle) * (orbit + radii[index]),
      y: center.y + Math.sin(angle) * (orbit + radii[index]),
    };

    if (component.length === 1) {
      result[component[0]] = { x: Math.round(hub.x * 100) / 100, y: Math.round(hub.y * 100) / 100 };
      return;
    }

    Object.assign(result, ringLayout(component, hub, nodeRadius, radii[index]));
  });

  return result;
}

/** How far a group's border stands off its members, in drawing units. */
export const GROUP_PADDING = 72;

/** A group's rectangle, in drawing units: the members' bounds plus breathing room. */
export function groupBounds(
  layout: CanvasLayout,
  group: CanvasGroup,
  padding = GROUP_PADDING,
): { x: number; y: number; width: number; height: number } | null {
  const points = group.characterIds
    .map((id) => layout.positions[id])
    .filter((point): point is LayoutPoint => Boolean(point));

  const bounds = boundsOf(points);
  if (!bounds) {
    return null;
  }

  return {
    x: bounds.minX - padding,
    y: bounds.minY - padding,
    width: bounds.maxX - bounds.minX + padding * 2,
    height: bounds.maxY - bounds.minY + padding * 2,
  };
}

/** Adds a group around the selection, or returns null when it is not a group yet. */
export function createGroup(
  layout: CanvasLayout,
  name: string,
  ids: string[],
  id: string,
): CanvasLayout | null {
  const trimmed = name.trim().slice(0, 40);
  const members = [...new Set(ids)];

  if (!trimmed || members.length < 2) {
    return null;
  }

  // One group per character: a node in two rectangles would be moved twice by
  // one drag, and there is no way to say which rectangle "owns" it.
  const groups = layout.groups.map((group) => ({
    ...group,
    characterIds: group.characterIds.filter((member) => !members.includes(member)),
  }));

  return {
    schemaVersion: LAYOUT_SCHEMA_VERSION,
    positions: layout.positions,
    groups: [...groups.filter((group) => group.characterIds.length >= 2), { id, name: trimmed, characterIds: members }],
  };
}

export function removeGroup(layout: CanvasLayout, groupId: string): CanvasLayout {
  return {
    ...layout,
    groups: layout.groups.filter((group) => group.id !== groupId),
  };
}

export function renameGroup(layout: CanvasLayout, groupId: string, name: string): CanvasLayout {
  const trimmed = name.trim().slice(0, 40);
  if (!trimmed) {
    return layout;
  }

  return {
    ...layout,
    groups: layout.groups.map((group) => (group.id === groupId ? { ...group, name: trimmed } : group)),
  };
}

/** Which group, if any, already owns this character. */
export function groupOf(layout: CanvasLayout, characterId: string): CanvasGroup | null {
  return layout.groups.find((group) => group.characterIds.includes(characterId)) ?? null;
}

/**
 * The layout a backup contributes, merged into the one already here.
 *
 * Separate from the import flow so the three rules can be stated and tested
 * without a file picker: a full restore takes the package's canvas, a merge only
 * adds coordinates for characters this browser has never placed, and every id is
 * translated through the import's own remap first. References to characters that
 * do not survive the import are dropped, never left dangling.
 */
export function mergeImportedLayout(options: {
  current: CanvasLayout;
  incoming: unknown;
  /** File id → id in the final library (which is the same id when unchanged). */
  idBySource: Map<string, string>;
  finalIds: Iterable<string>;
  /** Relationship ids that exist after the import. When given, an imported edge
   *  style whose relationship did not survive is dropped instead of being stored
   *  under an id that now belongs to nothing — or, worse, to something else. */
  finalEdgeIds?: Iterable<string>;
  mode: "merge" | "replace";
}): CanvasLayout {
  const incoming = normalizeLayout(options.incoming);
  const valid = new Set(options.finalIds);
  const map = (id: string) => options.idBySource.get(id) ?? id;

  const positions: Record<string, LayoutPoint> = {};
  for (const [sourceId, point] of Object.entries(incoming.positions)) {
    const mapped = map(sourceId);
    if (valid.has(mapped)) {
      positions[mapped] = point;
    }
  }

  const groups = incoming.groups
    .map((group) => ({
      ...group,
      characterIds: [...new Set(group.characterIds.map(map))].filter((id) => valid.has(id)),
    }))
    .filter((group) => group.characterIds.length >= 2);

  const mappedNodeStyles: Record<string, NodeStylePatch> = {};
  for (const [sourceId, patch] of Object.entries(incoming.nodeStyles ?? {})) {
    const mapped = map(sourceId);
    if (valid.has(mapped)) {
      mappedNodeStyles[mapped] = patch;
    }
  }

  const survivingEdgeIds = options.finalEdgeIds ? new Set(options.finalEdgeIds) : null;
  const mappedEdgeStyles: Record<string, EdgeStylePatch> = {};
  for (const [edgeId, patch] of Object.entries(incoming.edgeStyles ?? {})) {
    if (!survivingEdgeIds || survivingEdgeIds.has(edgeId)) {
      mappedEdgeStyles[edgeId] = patch;
    }
  }

  if (options.mode === "replace") {
    return normalizeLayout({
      positions,
      groups,
      style: incoming.style,
      nodeStyles: mappedNodeStyles,
      edgeStyles: mappedEdgeStyles,
      bookmarks: incoming.bookmarks,
      snapshots: incoming.snapshots,
    });
  }

  const current = options.current;
  const claimed = new Set(current.groups.flatMap((group) => group.characterIds));
  const usedGroupIds = new Set(current.groups.map((group) => group.id));
  const additions = groups
    .map((group) => ({
      ...group,
      id: usedGroupIds.has(group.id) ? `${group.id}-imported` : group.id,
      characterIds: group.characterIds.filter((id) => !claimed.has(id)),
    }))
    .filter((group) => group.characterIds.length >= 2);

  return {
    schemaVersion: LAYOUT_SCHEMA_VERSION,
    // the local canvas wins; a merge is not a reason to rearrange someone's work
    // or repaint it with someone else's appearance
    positions: { ...positions, ...current.positions },
    groups: [...current.groups, ...additions],
    style: current.style,
    nodeStyles: { ...mappedNodeStyles, ...current.nodeStyles },
    // the local line styles win, exactly as the local node styles do
    edgeStyles: { ...mappedEdgeStyles, ...current.edgeStyles },
    bookmarks: current.bookmarks ?? [],
    // An import without a snapshot list is not a request to delete the current one.
    snapshots: incoming.snapshots ?? current.snapshots ?? [],
  };
}

/**
 * A plain grid. Rows are filled left to right in the given order, which callers
 * pass as a stable sort, so the same set always lands in the same cells.
 */
export function gridLayout(
  ids: string[],
  center: LayoutPoint,
  radius: number,
  gap = 56,
  cell?: { width: number; height: number },
): Record<string, LayoutPoint> {
  // A cell is square for round nodes and rectangular for cards: spacing has to
  // follow the shape that is actually drawn, not one radius for both axes.
  const stepX = (cell?.width ?? radius * 2) + gap;
  const stepY = (cell?.height ?? radius * 2) + gap;
  const columns = Math.max(1, Math.ceil(Math.sqrt(ids.length)));
  const rows = Math.ceil(ids.length / columns);
  const result: Record<string, LayoutPoint> = {};
  ids.forEach((id, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    result[id] = {
      x: Math.round(center.x + (column - (columns - 1) / 2) * stepX),
      y: Math.round(center.y + (row - (rows - 1) / 2) * stepY),
    };
  });
  return result;
}

/**
 * Levels from a root, top to bottom.
 *
 * The root is whoever has the most connections inside the arrangement (ties by
 * id), or the caller's choice. This is a drawing decision, not a claim about
 * who answers to whom — nothing here reads or writes an organisation.
 */
export function hierarchyLayout(
  ids: string[],
  edges: Array<{ fromId: string; toId: string }>,
  center: LayoutPoint,
  radius: number,
  rootId?: string | null,
): Record<string, LayoutPoint> {
  const members = new Set(ids);
  const adjacency = new Map<string, string[]>();
  ids.forEach((id) => adjacency.set(id, []));
  for (const edge of edges) {
    if (!members.has(edge.fromId) || !members.has(edge.toId) || edge.fromId === edge.toId) {
      continue;
    }
    adjacency.get(edge.fromId)?.push(edge.toId);
    adjacency.get(edge.toId)?.push(edge.fromId);
  }

  const degree = (id: string) => adjacency.get(id)?.length ?? 0;
  const root =
    rootId && members.has(rootId)
      ? rootId
      : [...ids].sort((a, b) => degree(b) - degree(a) || a.localeCompare(b))[0] ?? null;

  const levels: string[][] = [];
  if (root) {
    const seen = new Set<string>([root]);
    let frontier = [root];
    while (frontier.length) {
      levels.push(frontier);
      const next: string[] = [];
      for (const id of frontier) {
        for (const neighbour of adjacency.get(id) ?? []) {
          if (!seen.has(neighbour)) {
            seen.add(neighbour);
            next.push(neighbour);
          }
        }
      }
      frontier = next.sort((a, b) => a.localeCompare(b));
    }
    // Components with no path from the root still belong on the canvas.
    const reached = new Set(levels.flat());
    const stranded = ids.filter((id) => !reached.has(id));
    if (stranded.length) {
      levels.push(stranded.sort((a, b) => a.localeCompare(b)));
    }
  }

  const stepX = radius * 2 + 64;
  const stepY = radius * 2 + 96;
  const result: Record<string, LayoutPoint> = {};
  levels.forEach((level, row) => {
    level.forEach((id, column) => {
      result[id] = {
        x: Math.round(center.x + (column - (level.length - 1) / 2) * stepX),
        y: Math.round(center.y + (row - (levels.length - 1) / 2) * stepY),
      };
    });
  });
  return result;
}

/**
 * Each visual group becomes a block, blocks sit in a row; characters without a
 * group get their own block at the end. Grouping is presentation only — this never
 * touches a worldview entry.
 */
export function groupedLayout(
  ids: string[],
  groups: Array<{ characterIds: string[] }>,
  center: LayoutPoint,
  radius: number,
  gap = 56,
): Record<string, LayoutPoint> {
  const members = new Set(ids);
  const claimed = new Set<string>();
  const blocks: string[][] = [];

  for (const group of groups) {
    const block = group.characterIds.filter((id) => members.has(id) && !claimed.has(id));
    if (block.length) {
      block.forEach((id) => claimed.add(id));
      blocks.push(block);
    }
  }
  const rest = ids.filter((id) => !claimed.has(id));
  if (rest.length) {
    blocks.push(rest);
  }

  const step = radius * 2 + gap;
  const blockWidth = (block: string[]) =>
    block.length === 1 ? step : Math.ceil(Math.sqrt(block.length)) * step;
  const widths = blocks.map(blockWidth);
  const totalWidth = widths.reduce((sum, width) => sum + width, 0) + Math.max(0, blocks.length - 1) * gap;
  const result: Record<string, LayoutPoint> = {};
  let cursor = center.x - totalWidth / 2;

  blocks.forEach((block, index) => {
    const columns = Math.max(1, Math.ceil(Math.sqrt(block.length)));
    const rows = Math.ceil(block.length / columns);
    const originX = cursor + widths[index] / 2;
    block.forEach((id, position) => {
      const column = position % columns;
      const row = Math.floor(position / columns);
      result[id] = {
        x: Math.round(originX + (column - (columns - 1) / 2) * step),
        y: Math.round(center.y + (row - (rows - 1) / 2) * step),
      };
    });
    cursor += widths[index] + gap;
  });

  return result;
}
