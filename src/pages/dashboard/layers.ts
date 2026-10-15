// Which layers the dashboard can have on top of it, and what each one does to the
// things underneath it.
//
// A "layer" is anything that takes over part of the screen: a modal, a dropdown, a
// selection mode. Three separate lists used to describe them, all hand-written:
//
//   1. the Escape handler, which called a setter per layer;
//   2. the `hasDialogOpen` effect, which decided whether to close the background
//      menus;
//   3. the JSX conditions, one per layer.
//
// Lists 1 and 2 had already drifted apart, and two layers were in neither. Rather
// than pick a policy, this declares each layer once with two named properties, so
// the current behaviour is reproduced exactly and every difference is a value
// someone can see and change:
//
//   escape        - Escape dismisses it
//   blocksMenus   - it counts as "a dialog is open", so the background card and
//                   "more" menus close themselves
//
// Two entries below are documented as gaps rather than fixed here: this batch is
// about making the rules single-sourced, not about changing what the app does.

export type DashboardLayer = {
  id: string;
  open: boolean;
  escape: boolean;
  blocksMenus: boolean;
};

export type DashboardLayerActions = DashboardLayer & {
  close: () => void;
};

/** The layers Escape dismisses, in declaration order. */
export function dismissibleLayers(layers: readonly DashboardLayer[]): DashboardLayer[] {
  return layers.filter((layer) => layer.escape);
}

/** Whether anything that should suppress the background menus is open. */
export function hasBlockingLayer(layers: readonly DashboardLayer[]): boolean {
  return layers.some((layer) => layer.blocksMenus && layer.open);
}

/**
 * The open/closed bits of the blocking layers, as a string.
 *
 * The effect that closes the background menus used to depend on the fifteen values
 * behind those bits directly, so it re-ran whenever any of them changed. Calling
 * that out as a signature keeps that behaviour exactly: depending on the boolean
 * `hasBlockingLayer` alone would miss the case where one blocking dialog replaces
 * another, and the menus would then stay open when they used to close.
 */
export function blockingSignature(layers: readonly DashboardLayer[]): string {
  return layers
    .filter((layer) => layer.blocksMenus)
    .map((layer) => (layer.open ? "1" : "0"))
    .join("");
}
