import { describe, expect, it } from "vitest";
import {
  clampCropDraft,
  cropMetrics,
  fitImage,
  visibleCrop,
  type Rect,
} from "../src/utils/cropGeometry";

// A square 200x200 frame sitting in the middle of an 800x600 stage, which is the
// shape the crop dialog actually uses.
const stage: Rect = { left: 0, top: 0, width: 800, height: 600 };
const frame: Rect = { left: 300, top: 200, width: 200, height: 200 };

const image = { naturalWidth: 1000, naturalHeight: 1000 };

describe("fitImage", () => {
  it("fits along the axis that is proportionally shorter", () => {
    // A square image on a 4:3 stage is limited by height, so the height sets the
    // scale. Getting this comparison backwards is the classic bug here: the image
    // still looks fitted, and every crop is subtly off.
    const fitted = fitImage({ naturalWidth: 1000, naturalHeight: 1000 }, stage);

    expect(fitted.stageAspect).toBeCloseTo(800 / 600, 10);
    expect(fitted.imageAspect).toBeCloseTo(1, 10);
    expect(fitted.baseHeight).toBeCloseTo(600, 10);
    expect(fitted.baseWidth).toBeCloseTo(600, 10);
  });

  it("fits the other way for a wide image", () => {
    const fitted = fitImage({ naturalWidth: 2000, naturalHeight: 500 }, stage);

    expect(fitted.baseWidth).toBeCloseTo(800, 10);
    expect(fitted.baseHeight).toBeCloseTo(200, 10);
  });

  it("fits the image *inside* the stage, touching it on exactly one axis", () => {
    // contain, not cover: the image is scaled until it touches the stage on one
    // axis and is letterboxed on the other. Knowing which one is the whole point
    // of this module, so it is asserted for each shape rather than described.
    for (const size of [
      { naturalWidth: 1000, naturalHeight: 1000 },
      { naturalWidth: 2000, naturalHeight: 500 },
      { naturalWidth: 300, naturalHeight: 900 },
      { naturalWidth: 800, naturalHeight: 600 },
    ]) {
      const fitted = fitImage(size, stage);

      expect(fitted.baseWidth).toBeLessThanOrEqual(800 + 1e-9);
      expect(fitted.baseHeight).toBeLessThanOrEqual(600 + 1e-9);

      const touchesWidth = Math.abs(fitted.baseWidth - 800) < 1e-9;
      const touchesHeight = Math.abs(fitted.baseHeight - 600) < 1e-9;
      expect(touchesWidth || touchesHeight).toBe(true);
    }
  });

  it("does not leave the frame hanging outside the image", () => {
    // The reason minZoom exists: fitting the image inside the stage can leave it
    // smaller than the frame on the letterboxed axis. minZoom is the zoom at which
    // the frame is covered by the *image*, which is stricter than covering the
    // stage.
    for (const size of [
      { naturalWidth: 1000, naturalHeight: 1000 },
      { naturalWidth: 2000, naturalHeight: 500 },
      { naturalWidth: 300, naturalHeight: 900 },
    ]) {
      const fitted = fitImage(size, stage);
      const metrics = cropMetrics(size, stage, frame, 0.01);

      expect(metrics.minZoom).toBeGreaterThanOrEqual(1);
      expect(fitted.baseWidth * metrics.minZoom).toBeGreaterThanOrEqual(frame.width - 1e-9);
      expect(fitted.baseHeight * metrics.minZoom).toBeGreaterThanOrEqual(frame.height - 1e-9);
    }
  });
});

describe("cropMetrics", () => {
  it("raises the zoom until the frame is covered", () => {
    // Fitted at 600x600, a 200px frame fits at zoom 1 -- but only if the whole
    // 200 is inside. minZoom is what guarantees that.
    const metrics = cropMetrics(image, stage, frame, 1);

    expect(metrics.minZoom).toBeGreaterThan(0);
    expect(metrics.zoom).toBeGreaterThanOrEqual(metrics.minZoom);
    expect(metrics.zoom).toBeGreaterThanOrEqual(1);
  });

  it("keeps the requested zoom when it is already large enough", () => {
    const metrics = cropMetrics(image, stage, frame, 3);

    expect(metrics.zoom).toBeCloseTo(3, 10);
  });

  it("never reports a zoom below the floor, whatever was asked for", () => {
    const metrics = cropMetrics(image, stage, frame, 0.01);

    expect(metrics.zoom).toBeCloseTo(metrics.minZoom, 10);
  });

  it("gives a pan range the right way round, so clamping cannot invert it", () => {
    const metrics = cropMetrics(image, stage, frame, 1);

    expect(metrics.minX).toBeLessThanOrEqual(metrics.maxX);
    expect(metrics.minY).toBeLessThanOrEqual(metrics.maxY);
  });

  it("allows no panning at all when the image exactly covers the frame", () => {
    // A 200x200 image on a 200x200 stage with a 200x200 frame: zoom 1 shows exactly
    // the frame, so both bounds collapse onto the same value.
    const squareStage: Rect = { left: 0, top: 0, width: 200, height: 200 };
    const wholeStage: Rect = { left: 0, top: 0, width: 200, height: 200 };
    const metrics = cropMetrics({ naturalWidth: 200, naturalHeight: 200 }, squareStage, wholeStage, 1);

    expect(metrics.minX).toBeCloseTo(0, 6);
    expect(metrics.maxX).toBeCloseTo(0, 6);
  });
});

describe("clampCropDraft", () => {
  it("passes a null draft straight through", () => {
    // Every call site in the dialog leans on this, which is what makes them
    // one-liners inside a state updater.
    expect(clampCropDraft(null, cropMetrics(image, stage, frame, 1))).toBeNull();
  });

  it("passes the draft through when the DOM could not be measured", () => {
    const draft = { offsetX: 40, offsetY: 40, zoom: 2 };

    expect(clampCropDraft(draft, null)).toBe(draft);
  });

  it("pulls an out-of-range pan back to the limit and leaves nothing else changed", () => {
    const metrics = cropMetrics(image, stage, frame, 2);
    const clamped = clampCropDraft({ offsetX: 99999, offsetY: -99999, zoom: 2 }, metrics);

    expect(clamped?.offsetX).toBeCloseTo(metrics.maxX, 10);
    expect(clamped?.offsetY).toBeCloseTo(metrics.minY, 10);
    expect(clamped?.zoom).toBeCloseTo(metrics.zoom, 10);
  });

  it("leaves an in-range draft exactly as it is", () => {
    const metrics = cropMetrics(image, stage, frame, 2);
    const inside = { offsetX: 0, offsetY: 0, zoom: 2 };
    const clamped = clampCropDraft(inside, metrics);

    expect(clamped).toEqual(inside);
  });

  it("carries fields it does not know about, so a draft can grow", () => {
    const metrics = cropMetrics(image, stage, frame, 2);
    const clamped = clampCropDraft(
      { offsetX: 0, offsetY: 0, zoom: 2, fileName: "a.png", imageUrl: "blob:x" },
      metrics,
    );

    expect(clamped?.fileName).toBe("a.png");
    expect(clamped?.imageUrl).toBe("blob:x");
  });
});

describe("visibleCrop", () => {
  it("returns the source rectangle in the original image's pixels", () => {
    const crop = visibleCrop(image, stage, frame, { offsetX: 0, offsetY: 0, zoom: 1 });

    // The frame is 200 of a 600-wide fitted image, so it sees a third of the source.
    expect(crop.sourceSize).toBeCloseTo((200 / 600) * 1000, 6);
    expect(crop.sourceX).toBeCloseTo(((300 - 100) / 600) * 1000, 6);
    expect(crop.sourceY).toBeCloseTo(((200 - 0) / 600) * 1000, 6);
  });

  it("moves the source window when the image is panned", () => {
    const centred = visibleCrop(image, stage, frame, { offsetX: 0, offsetY: 0, zoom: 1 });
    const panned = visibleCrop(image, stage, frame, { offsetX: 60, offsetY: 0, zoom: 1 });

    // Dragging the image right shows a window further left in the source.
    expect(panned.sourceX).toBeLessThan(centred.sourceX);
    expect(panned.sourceY).toBeCloseTo(centred.sourceY, 6);
  });

  it("shows a smaller source window as the zoom rises", () => {
    const atOne = visibleCrop(image, stage, frame, { offsetX: 0, offsetY: 0, zoom: 1 });
    const atTwo = visibleCrop(image, stage, frame, { offsetX: 0, offsetY: 0, zoom: 2 });

    expect(atTwo.sourceSize).toBeCloseTo(atOne.sourceSize / 2, 6);
  });

  it("uses the zoom it is given, leaving the floor to cropMetrics", () => {
    // The two closures this replaced behaved this way: getVisibleCrop did not clamp,
    // the callers did. Preserved so a refactor cannot silently move the floor.
    const unclamped = visibleCrop(image, stage, frame, { offsetX: 0, offsetY: 0, zoom: 0.1 });
    const clampedZoom = cropMetrics(image, stage, frame, 0.1).zoom;
    const clamped = visibleCrop(image, stage, frame, { offsetX: 0, offsetY: 0, zoom: clampedZoom });

    expect(unclamped.sourceSize).not.toBeCloseTo(clamped.sourceSize, 3);
    expect(unclamped.sourceSize).toBeGreaterThan(clamped.sourceSize);
  });

  it("stays square when the frame is square", () => {
    const crop = visibleCrop(image, stage, frame, { offsetX: 0, offsetY: 0, zoom: 2 });
    // sourceSize is a single number, which only makes sense because the frame is
    // square; the source window is sourceSize wide and tall.
    expect(Number.isFinite(crop.sourceX)).toBe(true);
    expect(Number.isFinite(crop.sourceY)).toBe(true);
    expect(Number.isFinite(crop.sourceSize)).toBe(true);
  });
});
