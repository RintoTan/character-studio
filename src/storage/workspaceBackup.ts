// Backing up the domains that are not characters.
//
// The character list had a full backup long before the relationship graph, the
// timeline and the world book existed, so those three were the only data in the
// app that could not leave the browser. They travel in the same file as the
// characters now.
//
// This module writes what an import plan decided. It does not decide anything
// itself: validation, id remapping, duplicate detection and the treatment of
// references that cannot be resolved all happen in utils/importPlan, against a
// preview the author has already seen. A second set of rules here would be a
// second answer to the same question.
import type { Relationship } from "../types/relationship";
import type { TimelineEvent } from "../types/timeline";
import type { WorldEntry } from "../types/world";
import { loadLayout } from "./relationshipLayout";
import { loadRelationships, saveRelationships } from "./relationshipStorage";
import { loadTimeline, saveTimeline } from "./timelineStorage";
import { loadWorldEntries, saveWorldEntries } from "./worldStorage";

export const WORKSPACE_BACKUP_VERSION = 1;
/** Marks a file that carries the three non-character domains. */
export const WORKSPACE_SECTION_KEY = "workspace";

export type WorkspaceDatasets = {
  relationships: unknown[];
  timeline: unknown[];
  world: unknown[];
  /**
   * The free canvas's coordinates and visual groups, as stored. Kept raw here:
   * the import plan remaps character ids before anything is written, and this
   * module deliberately does not decide that mapping itself.
   */
  relationshipLayout?: unknown;
};

export type WorkspaceCounts = {
  relationships: number;
  timeline: number;
  world: number;
};

export type PlannedWorkspace = {
  relationships: Relationship[];
  timeline: TimelineEvent[];
  world: WorldEntry[];
};

export function readWorkspaceDatasets(): WorkspaceDatasets {
  return {
    relationships: loadRelationships(),
    timeline: loadTimeline(),
    world: loadWorldEntries(),
    relationshipLayout: loadLayout(),
  };
}

/** Pulls the three datasets out of an arbitrary parsed JSON payload. */
export function extractWorkspaceDatasets(value: unknown): WorkspaceDatasets | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  // Either the arrays sit at the top level of a full backup, or under `workspace`
  // in the ZIP manifest form.
  const nested =
    record[WORKSPACE_SECTION_KEY] && typeof record[WORKSPACE_SECTION_KEY] === "object"
      ? (record[WORKSPACE_SECTION_KEY] as Record<string, unknown>)
      : null;
  const source = nested ?? record;
  const relationships = Array.isArray(source.relationships) ? source.relationships : null;
  const timeline = Array.isArray(source.timeline) ? source.timeline : null;
  const world = Array.isArray(source.world) ? source.world : null;
  const relationshipLayout =
    source.relationshipLayout && typeof source.relationshipLayout === "object"
      ? source.relationshipLayout
      : null;

  if (!relationships && !timeline && !world) {
    return null;
  }

  return {
    relationships: relationships ?? [],
    timeline: timeline ?? [],
    world: world ?? [],
    ...(relationshipLayout ? { relationshipLayout } : {}),
  };
}

export function countWorkspaceDatasets(datasets: WorkspaceDatasets): WorkspaceCounts {
  return {
    relationships: datasets.relationships.length,
    timeline: datasets.timeline.length,
    world: datasets.world.length,
  };
}

/** What the three stores actually hold right now. */
export function readWorkspaceCounts(): WorkspaceCounts {
  return countWorkspaceDatasets(readWorkspaceDatasets());
}

function mergeById<T extends { id: string }>(current: T[], incoming: T[]): T[] {
  const byId = new Map(current.map((item) => [item.id, item]));

  for (const item of incoming) {
    byId.set(item.id, item);
  }

  return [...byId.values()];
}

/**
 * Writes the plan's records and reports what the stores hold afterwards.
 *
 * A merge keeps everything already stored: a backup is a copy of what someone had,
 * and applying it must not delete work created after it was taken. A replace is the
 * "完整恢复" path, where the package is meant to be the whole library.
 *
 * The returned counts are read back from storage rather than computed from the
 * input, so a caller can compare them with what it promised the author before the
 * write rather than trusting its own arithmetic.
 */
export function writePlannedDatasets(
  mode: "merge" | "replace",
  datasets: PlannedWorkspace,
): WorkspaceCounts {
  const relationships =
    mode === "replace" ? datasets.relationships : mergeById(loadRelationships(), datasets.relationships);
  const timeline =
    mode === "replace" ? datasets.timeline : mergeById(loadTimeline(), datasets.timeline);
  const world = mode === "replace" ? datasets.world : mergeById(loadWorldEntries(), datasets.world);

  saveRelationships(relationships);
  saveTimeline(timeline);
  saveWorldEntries(world);

  return readWorkspaceCounts();
}
