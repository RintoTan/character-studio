// Who is on the canvas is the author's decision. The drawing used to decide for them:
// past forty connected characters it kept the hubs and left the rest out. That cap is
// gone — this module holds the membership set and the placement of a character added to
// an existing arrangement.
import type { LayoutPoint } from "../storage/relationshipLayout";

export const MEMBER_PLACEMENT_GAP = 78;
const MIN_DISTANCE = 62;

export function normalizeMembers(value: unknown, knownIds: readonly string[]): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const known = new Set(knownIds);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of value) {
    if (typeof raw === "string" && known.has(raw) && !seen.has(raw)) {
      seen.add(raw);
      out.push(raw);
    }
  }
  return out;
}

export function addMembers(current: readonly string[], ids: readonly string[]): string[] {
  const next = [...current];
  const seen = new Set(current);
  for (const id of ids) {
    if (!seen.has(id)) {
      seen.add(id);
      next.push(id);
    }
  }
  return next;
}

export function removeMembers(current: readonly string[], ids: readonly string[]): string[] {
  const drop = new Set(ids);
  return current.filter((id) => !drop.has(id));
}

/**
 * Coordinates for characters newly added to a canvas that already has positions: a ring
 * outside everything placed so far, so an added node never lands on top of an existing
 * one and nothing already placed has to move. Existing points are untouched.
 */
export function placeNewPoints(
  existing: Record<string, LayoutPoint>,
  ids: readonly string[],
): Record<string, LayoutPoint> {
  const points = Object.values(existing).filter(
    (point) => Number.isFinite(point.x) && Number.isFinite(point.y),
  );
  if (points.length === 0) {
    return {};
  }
  const centre = points.reduce(
    (acc, point) => ({ x: acc.x + point.x / points.length, y: acc.y + point.y / points.length }),
    { x: 0, y: 0 },
  );
  let radius = Math.max(
    ...points.map((point) => Math.hypot(point.x - centre.x, point.y - centre.y)),
  );
  const placed = [...points];
  const out: Record<string, LayoutPoint> = {};

  for (const id of ids) {
    let point = { x: centre.x, y: centre.y };
    for (let attempt = 0; attempt < 240; attempt += 1) {
      radius += MEMBER_PLACEMENT_GAP / 8;
      const index = attempt;
      const angle = (index * 137.508 * Math.PI) / 180;
      point = {
        x: Math.round((centre.x + Math.cos(angle) * radius) * 100) / 100,
        y: Math.round((centre.y + Math.sin(angle) * radius) * 100) / 100,
      };
      if (placed.every((other) => Math.hypot(point.x - other.x, point.y - other.y) >= MIN_DISTANCE)) {
        break;
      }
    }
    placed.push(point);
    out[id] = point;
  }
  return out;
}
