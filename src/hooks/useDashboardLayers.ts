import { useCallback, useRef } from "react";
import {
  blockingSignature,
  hasBlockingLayer,
  type DashboardLayerActions,
} from "../pages/dashboard/layers";

/**
 * Ties the layer declarations to the state they describe.
 *
 * `dismiss` reads the latest declarations through a ref rather than closing over
 * them, so the document-level keydown listener can keep its empty dependency array
 * — re-registering it on every state change would add and remove a listener for
 * each keystroke's worth of typing in the search box.
 */
export function useDashboardLayers(layers: readonly DashboardLayerActions[]) {
  const latest = useRef(layers);
  latest.current = layers;

  const dismiss = useCallback(() => {
    for (const layer of latest.current) {
      if (layer.escape) {
        layer.close();
      }
    }
  }, []);

  return {
    dismiss,
    blocksMenus: hasBlockingLayer(layers),
    blockingSignature: blockingSignature(layers),
  };
}
