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
// Lists 1 and 2 had drifted apart, and two layers were in neither. This declares
// each layer once, so there is one place to read and one place to change.
//
// Two rules, deliberately not symmetric:
//
//   Escape dismisses every layer. There is no exception flag, because every
//   escape-hatch candidate turned out to be the worth-defending case: on a
//   confirmation, Escape means "cancel", which is the outcome that does not touch
//   the data. Refusing it does not make a destructive action safer -- it only traps
//   a keyboard user in a modal with no keyboard way out, while a phone user taps
//   the backdrop as usual. The old asymmetry also had it backwards: of the four
//   destructive confirmations, the two that refused Escape were the two mildest,
//   and "clear all local data" -- the most destructive thing in the app -- accepted
//   it.
//
//   `blocksMenus` does differ per layer, and is stated on every entry. A dropdown
//   has nothing underneath it to suppress; a modal does.

export type DashboardLayer = {
  id: string;
  open: boolean;
  /** It counts as "a dialog is open", so the background menus close themselves. */
  blocksMenus: boolean;
};

export type DashboardLayerActions = DashboardLayer & {
  close: () => void;
};

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
