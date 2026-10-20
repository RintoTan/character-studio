/**
 * The rule for "is this character inside the selection rectangle".
 *
 * Half of a node inside the box is the case that feels arbitrary, so the rule is
 * stated once and applied everywhere: a character is selected when its drawn
 * **centre** is inside the rectangle. The box therefore never picks up a node that
 * merely grazes its edge, and the same drag always produces the same set — which is
 * the difference between a rule and a coincidence.
 */

export interface ScreenRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** The rectangle between two pressed points, whichever way the drag went. */
export function dragRect(ax: number, ay: number, bx: number, by: number): ScreenRect {
  return {
    left: Math.min(ax, bx),
    top: Math.min(ay, by),
    right: Math.max(ax, bx),
    bottom: Math.max(ay, by),
  };
}

export function marqueeHits(node: ScreenRect, marquee: ScreenRect): boolean {
  const centreX = (node.left + node.right) / 2;
  const centreY = (node.top + node.bottom) / 2;

  return centreX >= marquee.left && centreX <= marquee.right && centreY >= marquee.top && centreY <= marquee.bottom;
}

/** Whether the drag is big enough to be a marquee rather than a click. */
export function isMarquee(rect: ScreenRect, threshold = 4): boolean {
  return rect.right - rect.left > threshold || rect.bottom - rect.top > threshold;
}
