/**
 * Where a panel opened from a button should sit.
 *
 * The appearance panel used to be rendered at the end of the page, so it appeared
 * under the footer and outside the viewport — the button was in the toolbar and the
 * panel was 900 pixels away. Anchoring needs arithmetic rather than a CSS guess:
 * the panel is placed below the trigger, right-aligned to it, flipped above when
 * there is no room below, and always clipped into the viewport.
 */

export interface Rect {
  top: number;
  left: number;
  right: number;
  bottom: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface Placement {
  left: number;
  top: number;
  maxHeight: number;
  side: "below" | "above";
}

export function popoverPosition(
  anchor: Rect,
  size: Size,
  viewport: Size,
  margin = 12,
): Placement {
  const roomBelow = viewport.height - anchor.bottom - margin * 2;
  const roomAbove = anchor.top - margin * 2;
  const side: Placement["side"] = size.height > roomBelow && roomAbove > roomBelow ? "above" : "below";
  const available = Math.max(160, side === "above" ? roomAbove : roomBelow);
  const maxHeight = Math.min(size.height, available);

  const top =
    side === "above"
      ? Math.max(margin, anchor.top - margin - maxHeight)
      : Math.min(anchor.bottom + 8, viewport.height - margin - maxHeight);

  // Right edges line up with the trigger, which is where the eye already is.
  const left = Math.min(
    Math.max(margin, anchor.right - size.width),
    Math.max(margin, viewport.width - margin - size.width),
  );

  return { left, top, maxHeight, side };
}
