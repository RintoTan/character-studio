import { useCallback, useRef } from "react";
import {
  blockingSignature,
  hasBlockingLayer,
  type DashboardLayerActions,
} from "../pages/dashboard/layers";

/**
 * Ties the layer declarations to the state they describe.
 *
 * Escape dismisses every declared layer -- the reasons are in pages/dashboard/layers.ts.
 *
 * `dismiss` reads the latest declarations through a ref rather than closing over
 * them, so the document-level keydown listener can keep its empty dependency array.
 * Re-registering it on every state change would add and remove a listener for each
 * keystroke's worth of typing in the search box.
 */
export function useDashboardLayers(layers: readonly DashboardLayerActions[]) {
  const latest = useRef(layers);
  latest.current = layers;

  // Escape closes the layer on top, not every open one. A filter panel and the menu
  // that opened beside it are two layers even when they share a screen: one Escape is
  // one step back, and the second press closes the next one if it is still there.
  const dismiss = useCallback(() => {
    for (let index = latest.current.length - 1; index >= 0; index -= 1) {
      const layer = latest.current[index];
      if (layer.open) {
        layer.close();
        return layer.id;
      }
    }
    return null;
  }, []);

  return {
    dismiss,
    blocksMenus: hasBlockingLayer(layers),
    blockingSignature: blockingSignature(layers),
  };
}
