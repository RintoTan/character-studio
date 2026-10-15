// The arithmetic behind the avatar crop dialog.
//
// This used to live inside CharacterForm as three closures reading three refs, so
// the only way to know whether the crop was centred correctly was to drag it and
// look. It is pure maths over four numbers the caller measures, which means it can
// be asserted exactly -- including the parts that are easy to get silently wrong,
// like which of the two axes the image is fitted along.
//
// Units, since all three spaces appear here and mixing them is the usual bug:
//   stage / frame rect   - CSS pixels, relative to the viewport (getBoundingClientRect)
//   offsetX / offsetY    - CSS pixels, of the image, relative to the centre of the stage
//   zoom                 - a multiplier on the fitted size. 1 means "fitted to the stage"
//   sourceX / sourceY / sourceSize - pixels in the original image, which is what the
//                          compressor crops from

export type Rect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

/** Named to match HTMLImageElement, which is where the caller reads them from. */
export type PixelSize = {
  naturalWidth: number;
  naturalHeight: number;
};

/** Where the image sits and how big it is drawn, before any panning. */
export type FittedImage = {
  baseWidth: number;
  baseHeight: number;
  imageAspect: number;
  stageAspect: number;
};

export type CropDraft = {
  offsetX: number;
  offsetY: number;
  zoom: number;
};

export type CropMetrics = {
  /** The smallest zoom at which the image still covers the frame. */
  minZoom: number;
  /** `zoom`, raised to `minZoom` if it was smaller. */
  zoom: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
};

export type VisibleCrop = {
  sourceX: number;
  sourceY: number;
  sourceSize: number;
};

/**
 * The image is fitted to *cover* the stage: whichever axis is proportionally
 * shorter is stretched until it fills. Comparing the two aspects is what decides
 * which axis sets the scale, and getting the comparison backwards produces a crop
 * that looks plausible and is consistently off-centre, so it is stated once here.
 */
export function fitImage(image: PixelSize, stage: Rect): FittedImage {
  const imageAspect = image.naturalWidth / image.naturalHeight;
  const stageAspect = stage.width / stage.height;
  const wider = imageAspect >= stageAspect;

  return {
    imageAspect,
    stageAspect,
    baseWidth: wider ? stage.width : stage.height * imageAspect,
    baseHeight: wider ? stage.width / imageAspect : stage.height,
  };
}

/**
 * How far the image may be panned before the frame would see past its edge, and the
 * floor on the zoom that makes the frame coverable at all.
 */
export function cropMetrics(image: PixelSize, stage: Rect, frame: Rect, zoom: number): CropMetrics {
  const { baseWidth, baseHeight } = fitImage(image, stage);
  const minZoom = Math.max(1, frame.width / baseWidth, frame.height / baseHeight);
  const nextZoom = Math.max(zoom, minZoom);
  const renderedWidth = baseWidth * nextZoom;
  const renderedHeight = baseHeight * nextZoom;

  // Frame position relative to the stage, since the offsets are stage-relative.
  const frameLeft = frame.left - stage.left;
  const frameTop = frame.top - stage.top;
  const frameRight = frameLeft + frame.width;
  const frameBottom = frameTop + frame.height;

  return {
    minZoom,
    zoom: nextZoom,
    minX: frameRight - renderedWidth / 2 - stage.width / 2,
    maxX: frameLeft + renderedWidth / 2 - stage.width / 2,
    minY: frameBottom - renderedHeight / 2 - stage.height / 2,
    maxY: frameTop + renderedHeight / 2 - stage.height / 2,
  };
}

/**
 * Pushes a draft back inside the pan limits and up to the zoom floor.
 *
 * `metrics` is passed in rather than measured here so this stays a pure function;
 * the caller is the only thing that can read the DOM. A null draft passes through,
 * which is what lets every call site in the dialog be a one-liner.
 */
export function clampCropDraft<T extends CropDraft>(draft: T | null, metrics: CropMetrics | null): T | null {
  if (!draft || !metrics) {
    return draft;
  }

  return {
    ...draft,
    zoom: metrics.zoom,
    offsetX: Math.max(metrics.minX, Math.min(metrics.maxX, draft.offsetX)),
    offsetY: Math.max(metrics.minY, Math.min(metrics.maxY, draft.offsetY)),
  };
}

/**
 * The rectangle to hand the compressor, in the source image's own pixels.
 *
 * Note this uses the draft's zoom as given, not the clamped one: the clamp is the
 * caller's job before it gets here, and `cropMetrics` is where the floor lives. That
 * is the behaviour the two closures had, kept deliberately so a refactor cannot
 * quietly move the floor.
 */
export function visibleCrop(image: PixelSize, stage: Rect, frame: Rect, draft: CropDraft): VisibleCrop {
  const { baseWidth, baseHeight } = fitImage(image, stage);
  const renderedWidth = baseWidth * draft.zoom;
  const renderedHeight = baseHeight * draft.zoom;

  const imageLeft = stage.left + stage.width / 2 + draft.offsetX - renderedWidth / 2;
  const imageTop = stage.top + stage.height / 2 + draft.offsetY - renderedHeight / 2;

  // The frame is square in practice, but the smaller edge is what bounds the crop.
  const frameSize = Math.min(frame.width, frame.height);

  return {
    sourceX: ((frame.left - imageLeft) / renderedWidth) * image.naturalWidth,
    sourceY: ((frame.top - imageTop) / renderedHeight) * image.naturalHeight,
    sourceSize: (frameSize / renderedWidth) * image.naturalWidth,
  };
}
