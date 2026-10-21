/**
 * Pure functions for mobile multi-touch gestures, two-finger pinch-zoom/pan,
 * and touch-friendly multi-selection rules.
 */

export type TouchPoint = {
  x: number;
  y: number;
};

export type PinchPanState = {
  distance: number;
  centerX: number;
  centerY: number;
};

export type PinchPanDelta = {
  factor: number;
  dx: number;
  dy: number;
  newCenter: TouchPoint;
};

/**
 * Calculates zoom factor and midpoint shift between two multi-touch frames.
 */
export function computePinchPan(
  previous: PinchPanState | null,
  first: TouchPoint,
  second: TouchPoint,
): { state: PinchPanState; delta: PinchPanDelta | null } {
  const distance = Math.hypot(first.x - second.x, first.y - second.y);
  const centerX = (first.x + second.x) / 2;
  const centerY = (first.y + second.y) / 2;

  const state: PinchPanState = { distance, centerX, centerY };

  if (!previous || previous.distance <= 0 || distance <= 0) {
    return { state, delta: null };
  }

  const factor = distance / previous.distance;
  const dx = centerX - previous.centerX;
  const dy = centerY - previous.centerY;

  return {
    state,
    delta: {
      factor,
      dx,
      dy,
      newCenter: { x: centerX, y: centerY },
    },
  };
}

export type CanvasView = { k: number; x: number; y: number };

/**
 * One atomic view update for a two-finger gesture.
 *
 * `from` and `to` are the previous and current midpoints already converted into
 * view-box coordinates, so zoom anchor and translation share one frame. Splitting
 * them across two state updates lets the zoom anchor be computed from a stale box,
 * which reads as the drawing creeping under the fingers.
 */
export function pinchView(
  current: CanvasView,
  from: TouchPoint,
  to: TouchPoint,
  factor: number,
  clampZoom: (k: number) => number,
): CanvasView {
  const k = clampZoom(current.k * factor);
  const ratio = current.k > 0 ? k / current.k : 1;

  return {
    k,
    x: from.x - (from.x - current.x) * ratio + (to.x - from.x),
    y: from.y - (from.y - current.y) * ratio + (to.y - from.y),
  };
}

/**
 * Determines whether a drag gesture should commence, with jitter tolerance
 * based on input device type (mouse vs touch).
 */
export function shouldStartDrag(
  deltaX: number,
  deltaY: number,
  pointerType: string,
): boolean {
  const threshold = pointerType === "touch" ? 8 : 4;
  return Math.hypot(deltaX, deltaY) > threshold;
}

/**
 * Toggles an item in or out of a multi-selection list without mutating input.
 */
export function toggleSelectionItem(
  current: readonly string[],
  id: string,
  additive: boolean,
): string[] {
  if (!additive) {
    return [id];
  }
  return current.includes(id)
    ? current.filter((item) => item !== id)
    : [...current, id];
}

/**
 * Translates multiple node coordinates uniformly for set-drag operations.
 */
export function translateMemberPositions(
  basePositions: Record<string, { x: number; y: number }>,
  memberIds: readonly string[],
  delta: { x: number; y: number },
): Record<string, { x: number; y: number }> {
  const result: Record<string, { x: number; y: number }> = { ...basePositions };
  for (const id of memberIds) {
    const point = basePositions[id];
    if (point) {
      result[id] = {
        x: Math.round((point.x + delta.x) * 100) / 100,
        y: Math.round((point.y + delta.y) * 100) / 100,
      };
    }
  }
  return result;
}
