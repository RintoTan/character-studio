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

// What a serialised drawing needs to keep looking like the drawing.
//
// The canvas is painted mostly by the stylesheet: a node's fill, its border, the
// dash of a line and the vertical centring of an emoji all live in CSS. An SVG
// opened in a viewer — or loaded into an `<img>` for rasterising — has no access to
// that stylesheet, so every one of those properties falls back to the SVG default:
// `fill: black`, no stroke, and a glyph sitting on its baseline. That is exactly
// the black disc with the emoji floating above its centre.
const PRESENTATION_PROPERTIES = [
  "fill",
  "fill-opacity",
  "fill-rule",
  "stroke",
  "stroke-width",
  "stroke-dasharray",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-opacity",
  "opacity",
  "font-size",
  "font-family",
  "font-weight",
  "font-style",
  "text-anchor",
  "dominant-baseline",
  "letter-spacing",
  "paint-order",
];

/**
 * Copy the computed presentation of every element onto its clone.
 *
 * The two trees have the same shape by construction (the clone is a deep clone), so
 * they are walked in the same order. Values are written as inline declarations, which
 * is the only kind of style an `<img>`-loaded SVG is guaranteed to honour.
 */
export function inlineSvgPresentation(clone: SVGSVGElement) {
  // Measured from the clone, not from the live canvas. The live nodes still carry
  // the hover and selection classes — that is how "the pointer was over this node"
  // leaked into an export as a faded graph — and the clone has already had them
  // removed. To let the stylesheet apply to the clone it has to be in the document,
  // so it is parked off-screen for the duration of the measurement.
  const host = document.createElement("div");
  host.setAttribute("aria-hidden", "true");
  host.style.cssText =
    "position:absolute;left:-99999px;top:0;width:0;height:0;overflow:hidden;pointer-events:none";
  host.appendChild(clone);
  document.body.appendChild(host);

  try {
    const elements = [clone, ...Array.from(clone.querySelectorAll("*"))];
    for (const element of elements) {
      const computed = getComputedStyle(element);
      const target = element as SVGElement;

      for (const property of PRESENTATION_PROPERTIES) {
        const value = computed.getPropertyValue(property);
        if (!value || value === "normal" || value === "auto") {
          continue;
        }
        target.style.setProperty(property, value);
      }
    }
  } finally {
    host.removeChild(clone);
    host.remove();
  }
}

/**
 * Keep only what the selection scope is about.
 *
 * A line whose other end is outside the selection would be a stroke running to the
 * edge of the picture and stopping there, which reads as a mistake. Group rectangles
 * are dropped for the same reason: a box drawn around part of its members is a claim
 * the selection does not make.
 */
export function pruneToSelection(clone: SVGSVGElement, selectedIds: Iterable<string>) {
  const keep = new Set(selectedIds);

  clone.querySelectorAll<SVGGElement>(".relationship-node").forEach((node) => {
    const id = node.getAttribute("data-character-id");
    if (!id || !keep.has(id)) {
      node.remove();
    }
  });

  clone.querySelectorAll<SVGGElement>(".relationship-edge").forEach((edge) => {
    const from = edge.getAttribute("data-from-id");
    const to = edge.getAttribute("data-to-id");
    if (!from || !to || !keep.has(from) || !keep.has(to)) {
      edge.remove();
    }
  });

  clone.querySelectorAll(".graph-group").forEach((group) => group.remove());
}

/**
 * Remove the marks of an interaction from a copy of the drawing.
 *
 * A selection ring and a pointer hover are things the author is doing, not things
 * the graph is: a picture exported while the pointer happened to rest on a node
 * should not carry a faded copy of it. Lens and spotlight dimming are left alone —
 * those are filters the author asked for and can see.
 */
export function stripTransientState(clone: SVGSVGElement) {
  // Classes only: removing them changes no element counts, so this can run before
  // the computed styles are copied across. The rings are removed afterwards, by
  // removeTransientMarks, because that does change the shape of the tree.
  clone.querySelectorAll(".selected, .active, .dimmed, .focused, .spotlight-dim").forEach((el) => {
    el.classList.remove("selected", "active", "dimmed", "focused", "spotlight-dim");
  });
}

/** Drop the selection ring and the edge halo — they belong to the interaction. */
export function removeTransientMarks(clone: SVGSVGElement) {
  clone
    .querySelectorAll(".relationship-node-ring, .relationship-edge-halo, .relationship-node-badge")
    .forEach((el) => el.remove());
}

/**
 * The drawing's bounds grown to a target aspect ratio, centred on the content.
 *
 * A ratio is a frame, not a crop: widening the short side keeps every node, label
 * and arrow inside the picture, and the extra room is the canvas background. This is
 * why choosing 16:9 cannot cut the top off a tall wheel.
 */
export function aspectBounds(bounds: WorldBounds, ratio: number): WorldBounds {
  if (!Number.isFinite(ratio) || ratio <= 0) {
    return bounds;
  }

  const current = bounds.width / bounds.height;
  if (Math.abs(current - ratio) < 0.001) {
    return bounds;
  }

  if (current < ratio) {
    const width = bounds.height * ratio;
    return { ...bounds, x: bounds.x - (width - bounds.width) / 2, width };
  }

  const height = bounds.width / ratio;
  return { ...bounds, y: bounds.y - (height - bounds.height) / 2, height };
}
