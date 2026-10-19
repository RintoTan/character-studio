import { useCallback, useEffect, useRef, useState } from "react";

export type ScrollEdges = { start: boolean; end: boolean };

/**
 * Measures a horizontal scroller so a row that is cut off at an edge can say so
 * without adding a control. The state is read from the element rather than assumed:
 * a row that fits has no edges to hint at, and the hint follows the scroll instead
 * of staying on both sides.
 *
 * `contentKey` re-measures when what the row contains changes (a filtered roster,
 * a renamed group), which a resize observer alone cannot see.
 */
export function useHorizontalScrollHint<T extends HTMLElement>(contentKey: string) {
  const ref = useRef<T | null>(null);
  const [edges, setEdges] = useState<ScrollEdges>({ start: false, end: false });

  const measure = useCallback(() => {
    const node = ref.current;
    if (!node) return;

    const max = node.scrollWidth - node.clientWidth;
    const next = {
      start: node.scrollLeft > 1,
      // A 1px tolerance: sub-pixel widths otherwise leave the hint on at the end.
      end: max > 1 && node.scrollLeft < max - 1,
    };

    setEdges((current) =>
      current.start === next.start && current.end === next.end ? current : next,
    );
  }, []);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    measure();
    node.addEventListener("scroll", measure, { passive: true });

    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(node);
    window.addEventListener("resize", measure);

    return () => {
      node.removeEventListener("scroll", measure);
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [contentKey, measure]);

  return { ref, edges };
}
