// Batch appearance editing: one patch applied to the picked nodes as a single change.
//
// The rules here are deliberately narrow, because this is the code path that can ruin
// a drawing in one click:
//
//   * only the ids it is given are written;
//   * keys the patch does not mention are left exactly as they were;
//   * a key with an `undefined` value means "inherit the canvas again", so it is
//     removed instead of being stored as a hole;
//   * the canvas-wide style is never touched — a batch edit is a set of per-node
//     overrides, which is the same layer the single-node editor writes;
//   * positions, members, groups and snapshots are carried over untouched.
//
// `mergeValues` is the other half: a panel has to say "these three do not agree"
// instead of picking one of their values and calling it theirs.
import type { CanvasStyle, NodeStylePatch } from "../storage/canvasStyle";
import type { CanvasLayout } from "../storage/relationshipLayout";

/** The node properties an author may set on several characters at once. */
export type BatchKey = keyof CanvasStyle["node"];

export type MergedValue<T> = {
  /** The shared value, or `undefined` when the selection disagrees. */
  value: T | undefined;
  /** True when at least two different values are present. */
  mixed: boolean;
  /** How many characters contributed a value (defined ones only). */
  count: number;
};

/**
 * What a set of values has in common.
 *
 * An empty set has no value and is not mixed: nothing was asked. Values equal to
 * `undefined` are ignored, so "one of five has an override" reports that override
 * rather than a false mixture — the rest inherit, and inheritance is not a value.
 */
export function mergeValues<T>(values: Array<T | undefined>): MergedValue<T> {
  const defined = values.filter((value): value is T => value !== undefined);

  if (defined.length === 0) {
    return { value: undefined, mixed: false, count: 0 };
  }

  const first = defined[0];
  const mixed = defined.some((value) => !Object.is(value, first));

  return { value: mixed ? undefined : first, mixed, count: defined.length };
}

/**
 * What one property resolves to for each picked node.
 *
 * An override wins over the canvas value, which is the order the renderer already
 * uses (single node > canvas > preset > default). The merge is done on the resolved
 * values, because two nodes that both "look 1.2" are not a mixture just because only
 * one of them stores it.
 */
export function mergeNodeValue<K extends BatchKey>(
  layout: CanvasLayout,
  ids: string[],
  key: K,
  canvas: CanvasStyle["node"],
): MergedValue<CanvasStyle["node"][K]> {
  const values = ids.map((id) => {
    const local = layout.nodeStyles?.[id]?.[key];
    return (local ?? canvas[key]) as CanvasStyle["node"][K];
  });

  return mergeValues(values);
}

/** True when this node stores its own value for the key, i.e. it is not inheriting. */
export function nodeOverrides(layout: CanvasLayout, id: string, key: BatchKey): boolean {
  const patch = layout.nodeStyles?.[id];
  return Boolean(patch) && Object.prototype.hasOwnProperty.call(patch, key) && patch?.[key] !== undefined;
}

/**
 * Apply one patch to the picked nodes.
 *
 * `undefined` on a key clears that node's override, which is how 恢复继承 is spelled:
 * the value goes back to whatever the canvas says, including future canvas changes.
 * Everything outside `nodeStyles` is carried across by reference, so a batch edit can
 * never move a node, rename a group or rewrite the canvas defaults.
 */
export function applyBatchStyle(
  layout: CanvasLayout,
  selectedIds: string[],
  patch: NodeStylePatch,
  known?: Iterable<string>,
): CanvasLayout {
  // Membership is the caller's knowledge, not the layout's: a canvas that has never
  // been dragged stores no positions at all (the ring is computed), so keying off
  // `layout.positions` would refuse to style every node on an untouched drawing. When
  // the caller passes the ids it knows, anything else is dropped.
  const allowed = known ? new Set(known) : null;
  const ids = [...new Set(selectedIds)].filter(
    (id) => typeof id === "string" && id.length > 0 && (!allowed || allowed.has(id)),
  );

  if (ids.length === 0) {
    return layout;
  }

  const keys = Object.keys(patch) as BatchKey[];

  if (keys.length === 0) {
    return layout;
  }

  const nodeStyles = { ...(layout.nodeStyles ?? {}) };
  let changed = false;

  for (const id of ids) {
    const current = { ...(nodeStyles[id] ?? {}) };
    let touched = false;

    for (const key of keys) {
      const next = patch[key];

      if (next === undefined) {
        if (Object.prototype.hasOwnProperty.call(current, key)) {
          delete current[key];
          touched = true;
        }
        continue;
      }

      if (!Object.is(current[key], next)) {
        (current as Record<string, unknown>)[key] = next;
        touched = true;
      }
    }

    if (!touched) {
      continue;
    }

    changed = true;

    // An empty object would read as "this node has an override" to anything that
    // tests for the record rather than its keys, so it is removed instead.
    if (Object.keys(current).length === 0) {
      delete nodeStyles[id];
    } else {
      nodeStyles[id] = current;
    }
  }

  if (!changed) {
    return layout;
  }

  return { ...layout, nodeStyles };
}

/** The ids a batch edit would touch, in the order they were picked. */
export function batchTargets(selectedIds: string[], known: (id: string) => boolean): string[] {
  return [...new Set(selectedIds)].filter((id) => typeof id === "string" && id.length > 0 && known(id));
}
