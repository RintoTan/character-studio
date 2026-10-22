// Saved arrangements of the relationship canvas: a named set of coordinates the author
// can come back to.
//
// A snapshot is not a style preset. A preset says how the drawing looks; a snapshot says
// where the characters sit. Keeping them apart is what lets someone restore an
// arrangement without also reverting a colour they changed afterwards.
import type { CanvasLayout, LayoutPoint } from "../storage/relationshipLayout";

export const SNAPSHOT_LIMIT = 20;
export const SNAPSHOT_NAME_LIMIT = 40;

export type LayoutSnapshot = {
  id: string;
  name: string;
  /** Character id → drawing coordinates. Ids, never array indexes. */
  positions: Record<string, LayoutPoint>;
  /**
   * Who was on the canvas when this was saved.
   *
   * Missing is not empty. A snapshot taken while the canvas had no explicit roster
   * (the legacy "everything connected" mode) stores no `members`, and restoring it
   * must leave that mode alone. An array — including `[]` — is a roster the author
   * chose, and `[]` restores an empty canvas exactly as it was.
   */
  members?: string[];
  /** The framing at the moment it was saved, so restoring puts the camera back too. */
  view: { k: number; x: number; y: number };
  createdAt: string;
};

const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= 1_000_000;

export function cleanSnapshotName(raw: string): string {
  return raw.trim().replace(/\s+/g, " ").slice(0, SNAPSHOT_NAME_LIMIT);
}

/** What a restore would touch: ids it can place, and ids it has never heard of. */
export function snapshotCoverage(
  snapshot: Pick<LayoutSnapshot, "positions">,
  currentIds: readonly string[],
): { covered: number; missing: number; total: number } {
  const known = new Set(currentIds);
  const stored = Object.keys(snapshot.positions);
  const covered = stored.filter((id) => known.has(id)).length;
  return { covered, missing: stored.length - covered, total: currentIds.length };
}

/**
 * The coordinates a restore would produce: everything the snapshot knows and the roster
 * still has. Characters added after the snapshot keep where they are now — a restore
 * must not delete them or fling them to the origin.
 */
export function snapshotPositions(
  snapshot: Pick<LayoutSnapshot, "positions">,
  current: Record<string, LayoutPoint>,
  currentIds: readonly string[],
): Record<string, LayoutPoint> {
  const next: Record<string, LayoutPoint> = { ...current };
  for (const id of currentIds) {
    const point = snapshot.positions[id];
    if (point) {
      next[id] = { x: point.x, y: point.y };
    }
  }
  return next;
}

export function captureSnapshot(
  layout: CanvasLayout,
  name: string,
  view: { k: number; x: number; y: number },
  ids: readonly string[],
  now: string,
): { snapshot: LayoutSnapshot | null; error: string | null } {
  const clean = cleanSnapshotName(name);
  if (!clean) {
    return { snapshot: null, error: "给这个布局起一个名字" };
  }
  const positions: Record<string, LayoutPoint> = {};
  for (const id of ids) {
    const point = layout.positions[id];
    if (point && finite(point.x) && finite(point.y)) {
      positions[id] = { x: point.x, y: point.y };
    }
  }
  // `undefined` stays `undefined`: a legacy canvas keeps its mode, it does not become
  // an empty roster. An explicit `[]` is saved as `[]`.
  const known = new Set(ids);
  const members = Array.isArray(layout.members)
    ? layout.members.filter((id) => known.has(id))
    : undefined;
  if (Object.keys(positions).length === 0 && members === undefined) {
    return { snapshot: null, error: "画布上还没有可保存的坐标" };
  }
  return {
    snapshot: {
      id: `snap-${now}-${Math.random().toString(36).slice(2, 8)}`,
      name: clean,
      positions,
      ...(members === undefined ? {} : { members }),
      view: { k: view.k, x: view.x, y: view.y },
      createdAt: now,
    },
    error: null,
  };
}

/** How many characters a snapshot puts on the canvas, or `null` for a legacy capture. */
export function snapshotMemberCount(snapshot: Pick<LayoutSnapshot, "members">): number | null {
  return Array.isArray(snapshot.members) ? snapshot.members.length : null;
}

/** Newest first, and never more than the cap: this lives in localStorage. */
export function addSnapshot(
  list: readonly LayoutSnapshot[] | undefined,
  snapshot: LayoutSnapshot,
  limit = SNAPSHOT_LIMIT,
): LayoutSnapshot[] {
  const rest = (list ?? []).filter((item) => item.name !== snapshot.name);
  return [snapshot, ...rest].slice(0, limit);
}

export function renameSnapshot(
  list: readonly LayoutSnapshot[],
  id: string,
  name: string,
): LayoutSnapshot[] {
  const clean = cleanSnapshotName(name);
  if (!clean) {
    return [...list];
  }
  return list.map((item) => (item.id === id ? { ...item, name: clean } : item));
}

export function removeSnapshot(list: readonly LayoutSnapshot[], id: string): LayoutSnapshot[] {
  return list.filter((item) => item.id !== id);
}

/** Reading back a stored list: drop anything that would render as a bad coordinate. */
export function normalizeSnapshots(value: unknown): LayoutSnapshot[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const seen = new Set<string>();
  const out: LayoutSnapshot[] = [];
  for (const raw of value) {
    if (typeof raw !== "object" || raw === null) {
      continue;
    }
    const record = raw as Record<string, unknown>;
    const id = typeof record.id === "string" ? record.id : "";
    const name = typeof record.name === "string" ? cleanSnapshotName(record.name) : "";
    if (!id || !name || seen.has(id)) {
      continue;
    }
    const source = record.positions;
    if (typeof source !== "object" || source === null || Array.isArray(source)) {
      continue;
    }
    const positions: Record<string, LayoutPoint> = {};
    for (const [characterId, point] of Object.entries(source as Record<string, unknown>)) {
      if (typeof point !== "object" || point === null) {
        continue;
      }
      const { x, y } = point as { x?: unknown; y?: unknown };
      if (finite(x) && finite(y)) {
        positions[characterId] = { x, y };
      }
    }
    // A roster is only read when the file actually holds an array. An older snapshot
    // has no `members` key at all, and that must stay "no roster captured" rather than
    // silently becoming an empty canvas.
    const members = Array.isArray(record.members)
      ? [
          ...new Set(
            record.members.filter((item): item is string => typeof item === "string" && item.length > 0),
          ),
        ]
      : undefined;
    if (Object.keys(positions).length === 0 && members === undefined) {
      continue;
    }
    const view = record.view as { k?: unknown; x?: unknown; y?: unknown } | undefined;
    seen.add(id);
    out.push({
      id,
      name,
      positions,
      ...(members === undefined ? {} : { members }),
      view:
        view && finite(view.k) && finite(view.x) && finite(view.y) && (view.k as number) > 0
          ? { k: view.k as number, x: view.x as number, y: view.y as number }
          : { k: 1, x: 0, y: 0 },
      createdAt: typeof record.createdAt === "string" ? record.createdAt : "",
    });
    if (out.length >= SNAPSHOT_LIMIT) {
      break;
    }
  }
  return out;
}
