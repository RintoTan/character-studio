// Where a canvas export is taken from, and how big the result may get.
//
// The three scopes answer three different questions and are computed from the
// drawing's own coordinates, never from the current zoom or scroll position: a
// picture that changes with how far the author happened to be zoomed in is not an
// export of the graph, it is a screenshot of the window.

export type ExportScope = "view" | "all" | "selection";

export type WorldBounds = { x: number; y: number; width: number; height: number };

/** The largest side a raster export may have. Beyond this a browser tab runs out of
 *  memory before it runs out of patience. */
export const MAX_EXPORT_SIDE = 8192;

export function boundsOfPoints(
  points: Array<{ x: number; y: number }>,
  padding: number,
): WorldBounds | null {
  if (points.length === 0) {
    return null;
  }

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }

  const pad = Number.isFinite(padding) ? Math.max(0, padding) : 0;

  return {
    x: minX - pad,
    y: minY - pad,
    width: Math.max(maxX - minX + pad * 2, 1),
    height: Math.max(maxY - minY + pad * 2, 1),
  };
}

export function parseViewBox(viewBox: string): WorldBounds | null {
  const parts = viewBox.split(" ").map(Number);
  if (parts.length !== 4 || parts.some((value) => !Number.isFinite(value))) {
    return null;
  }

  const [x, y, width, height] = parts;
  if (width <= 0 || height <= 0) {
    return null;
  }

  return { x, y, width, height };
}

/**
 * The rectangle a scope names.
 *
 * `view` is whatever the author is looking at; `all` is every drawn node with room
 * for its circle and its label; `selection` is the selected nodes and nothing else.
 * A scope with nothing in it answers null, and the caller says so instead of
 * exporting an empty rectangle.
 */
export function scopeBounds(options: {
  scope: ExportScope;
  allPoints: Array<{ x: number; y: number }>;
  selectedPoints: Array<{ x: number; y: number }>;
  viewBox: string;
  padding: number;
}): WorldBounds | null {
  if (options.scope === "view") {
    return parseViewBox(options.viewBox);
  }

  return boundsOfPoints(
    options.scope === "selection" ? options.selectedPoints : options.allPoints,
    options.padding,
  );
}

/**
 * Pixel size for a raster export: the requested scale, reduced until the longest
 * side fits `maxSide`. It never returns a zero-sized canvas, which is what a very
 * large graph at 3x would otherwise produce.
 */
export function exportPixelSize(
  bounds: WorldBounds,
  scale: number,
  maxSide: number = MAX_EXPORT_SIDE,
): { width: number; height: number; scale: number } {
  const longest = Math.max(bounds.width, bounds.height, 1);
  const requested = Number.isFinite(scale) && scale > 0 ? scale : 1;
  const effective = Math.max(0.25, Math.min(requested, maxSide / longest));

  return {
    width: Math.max(1, Math.round(bounds.width * effective)),
    height: Math.max(1, Math.round(bounds.height * effective)),
    scale: effective,
  };
}

function download(content: BlobPart, filename: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function downloadSvg(text: string, filename: string) {
  download(text, filename, "image/svg+xml;charset=utf-8");
}

export function downloadPng(blob: Blob, filename: string) {
  download(blob, filename, "image/png");
}

/**
 * Rasterise serialised SVG.
 *
 * The SVG is handed over as a data URL rather than an object URL so the browser
 * treats it as a single self-contained document: avatars are already data URLs, and
 * a document with no external references is the one case that always loads into an
 * `<img>`.
 */
export async function rasterizeSvg(
  svgText: string,
  bounds: WorldBounds,
  scale: number,
  maxSide: number = MAX_EXPORT_SIDE,
): Promise<{ blob: Blob; width: number; height: number }> {
  const size = exportPixelSize(bounds, scale, maxSide);
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgText)}`;
  const image = new Image();
  image.decoding = "sync";

  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("画布无法栅格化：浏览器拒绝了这段 SVG"));
    image.src = url;
  });

  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("浏览器没有提供 2D 画布");
  }
  context.drawImage(image, 0, 0, size.width, size.height);

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) {
    throw new Error("PNG 生成失败：画布未能编码");
  }

  return { blob, width: size.width, height: size.height };
}
