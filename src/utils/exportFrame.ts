// What rectangle an export takes, and how big the file will be.
//
// Three answers to "what am I exporting": the content (fitted), the current view, or a
// frame the author composed by hand. All three are rectangles in drawing coordinates —
// never screen pixels — so an export does not change when the window is resized, and
// framing a picture never writes a node coordinate.
//
// Manual framing is the one place a zoom is allowed to disagree with the canvas zoom:
// it is a crop of the artwork, not a change to how the artwork is stored.

export type WorldRect = { x: number; y: number; width: number; height: number };

export type ExportFrameMode = "content" | "view" | "manual";

/** The longest side a raster export may have, in pixels. */
export const MAX_EXPORT_SIDE = 8192;

/** Total pixels a raster export may have. 8192² is 67M; this leaves room for the
 *  decoded bitmap, the canvas and the encoded blob living at the same time. */
export const MAX_EXPORT_PIXELS = 40_000_000;

/** Manual framing may zoom out to a third and in to three times. */
export const MIN_FRAME_ZOOM = 1 / 3;
export const MAX_FRAME_ZOOM = 3;

export function frameAspect(frame: WorldRect): number {
  return frame.height > 0 ? frame.width / frame.height : 1;
}

export function centreOf(frame: WorldRect): { x: number; y: number } {
  return { x: frame.x + frame.width / 2, y: frame.y + frame.height / 2 };
}

/**
 * Grow a rectangle to a target aspect ratio, centred on the same point.
 *
 * A ratio is a frame, never a crop: only the short side grows, so no node, name or
 * arrow can fall outside because someone picked 16:9.
 */
export function growToAspect(frame: WorldRect, ratio: number): WorldRect {
  if (!Number.isFinite(ratio) || ratio <= 0) {
    return frame;
  }

  const current = frameAspect(frame);
  if (Math.abs(current - ratio) < 0.001) {
    return frame;
  }

  if (current < ratio) {
    const width = frame.height * ratio;
    return { ...frame, x: frame.x - (width - frame.width) / 2, width };
  }

  const height = frame.width / ratio;
  return { ...frame, y: frame.y - (height - frame.height) / 2, height };
}

/**
 * A hand-composed frame: the content, zoomed about its centre, moved by the pan, then
 * grown to the requested ratio. The content is always inside the result unless the
 * author zooms in past 100% — which is a crop they asked for.
 */
export function manualFrame(input: {
  content: WorldRect;
  zoom: number;
  panX: number;
  panY: number;
  ratio?: number;
}): WorldRect {
  const content = input.content;
  const zoom = clamp(input.zoom, MIN_FRAME_ZOOM, MAX_FRAME_ZOOM);
  const centre = centreOf(content);
  const width = content.width / zoom;
  const height = content.height / zoom;
  const moved: WorldRect = {
    x: centre.x + input.panX - width / 2,
    y: centre.y + input.panY - height / 2,
    width,
    height,
  };

  return growToAspect(moved, input.ratio ?? frameAspect(content));
}

/**
 * Keep a pan from pushing the artwork out of the frame.
 *
 * The limit is expressed as a fraction of the content's own size, so the gesture feels
 * the same on an eight-node graph and a hundred-node one. It is a presentation clamp:
 * it changes the crop, never a coordinate.
 */
export function clampPan(input: {
  content: WorldRect;
  panX: number;
  panY: number;
  zoom: number;
}): { panX: number; panY: number } {
  const zoom = clamp(input.zoom, MIN_FRAME_ZOOM, MAX_FRAME_ZOOM);
  const visibleWidth = input.content.width / zoom;
  const visibleHeight = input.content.height / zoom;
  // At least 35% of the artwork stays in the frame on each axis.
  const limitX = Math.max(0, (input.content.width + visibleWidth) / 2 - visibleWidth * 0.35);
  const limitY = Math.max(0, (input.content.height + visibleHeight) / 2 - visibleHeight * 0.35);

  return {
    panX: clamp(input.panX, -limitX, limitX),
    panY: clamp(input.panY, -limitY, limitY),
  };
}

/**
 * The pixel size of a raster export.
 *
 * The requested width is honoured up to the side and area budgets; the height follows
 * the frame so the picture is never stretched. When a request is too large the result
 * says so, and the caller tells the author instead of quietly shipping a smaller file.
 */
export function outputSize(input: {
  frame: WorldRect;
  width: number;
  height?: number;
  maxSide?: number;
  maxPixels?: number;
}): { width: number; height: number; clipped: boolean; reason: string | null } {
  const maxSide = input.maxSide ?? MAX_EXPORT_SIDE;
  const maxPixels = input.maxPixels ?? MAX_EXPORT_PIXELS;
  const ratio = frameAspect(input.frame);
  const requestedWidth = Math.max(1, Math.round(input.width));
  const requestedHeight = Math.max(1, Math.round(requestedWidth / ratio));

  let width = requestedWidth;
  let height = requestedHeight;
  let clipped = false;

  const side = Math.max(width, height);
  if (side > maxSide) {
    const shrink = maxSide / side;
    width = Math.max(1, Math.round(width * shrink));
    height = Math.max(1, Math.round(height * shrink));
    clipped = true;
  }

  if (width * height > maxPixels) {
    const shrink = Math.sqrt(maxPixels / (width * height));
    width = Math.max(1, Math.floor(width * shrink));
    height = Math.max(1, Math.floor(height * shrink));
    clipped = true;
  }

  return {
    width,
    height,
    clipped,
    reason: clipped
      ? `按比例缩到 ${width} × ${height} px：再大就超过浏览器的内存上限（最长边 ${maxSide}px，总计 ${Math.round(maxPixels / 1_000_000)}MP）。`
      : null,
  };
}

/**
 * Where the artwork sits inside a preview box of a different size.
 *
 * The preview is the exported rectangle scaled down; this maps the content rect into
 * that box so the "what is actually covered" outline is drawn from the same numbers as
 * the file, not from a second guess.
 */
export function projectRect(
  rect: WorldRect,
  frame: WorldRect,
  box: { width: number; height: number },
): { x: number; y: number; width: number; height: number } {
  if (frame.width <= 0 || frame.height <= 0) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }

  const scale = Math.min(box.width / frame.width, box.height / frame.height);

  return {
    x: (rect.x - frame.x) * scale,
    y: (rect.y - frame.y) * scale,
    width: rect.width * scale,
    height: rect.height * scale,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
