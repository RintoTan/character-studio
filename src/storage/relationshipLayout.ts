// Where the author put each character on the relationship canvas, and which
// visual groups they belong to.
//
// This is presentation data, deliberately kept apart from `Character` and from
// `Relationship`: moving a circle is not an edit to the person, and naming a
// cluster of circles is not a claim about their world. Nothing here is derived
// from a worldview field, and nothing here writes one.
//
// Positions are keyed by character id, so renaming a character moves nothing.
// The layout is versioned on its own so a later shape can migrate rather than
// guess, and every reader goes through `normalizeLayout`, so a hand-edited or
// half-written record degrades to an empty canvas instead of a broken one.
export const RELATIONSHIP_LAYOUT_KEY = "character-studio.relationship-layout";

export const LAYOUT_SCHEMA_VERSION = 1;

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
};

export const emptyLayout = (): CanvasLayout => ({
  schemaVersion: LAYOUT_SCHEMA_VERSION,
  positions: {},
  groups: [],
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

  return { schemaVersion: LAYOUT_SCHEMA_VERSION, positions, groups };
}

export function loadLayout(): CanvasLayout {
  try {
    const stored = localStorage.getItem(RELATIONSHIP_LAYOUT_KEY);
    return stored ? normalizeLayout(JSON.parse(stored)) : emptyLayout();
  } catch {
    return emptyLayout();
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
export function pruneLayout(layout: CanvasLayout, validIds: Iterable<string>): CanvasLayout {
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

  return { schemaVersion: LAYOUT_SCHEMA_VERSION, positions, groups };
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

  return { schemaVersion: LAYOUT_SCHEMA_VERSION, positions, groups: layout.groups };
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

export type ArrangeMode = "cluster" | "ring";

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

/** A group's rectangle, in drawing units: the members' bounds plus breathing room. */
export function groupBounds(
  layout: CanvasLayout,
  group: CanvasGroup,
  padding = 34,
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
