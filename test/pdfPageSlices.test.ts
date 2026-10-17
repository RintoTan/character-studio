import { describe, expect, it } from "vitest";
import { planPageSlices } from "../src/utils/pdfPageSlices";

const total = (slices: Array<{ height: number }>) => slices.reduce((sum, slice) => sum + slice.height, 0);
const contiguous = (slices: Array<{ top: number; height: number }>) =>
  slices.every((slice, index) => slice.top === (index === 0 ? 0 : slices[index - 1].top + slices[index - 1].height));

describe("PDF page slices", () => {
  it("covers the whole capture exactly once", () => {
    const slices = planPageSlices(5000, 1000, () => false);

    expect(contiguous(slices)).toBe(true);
    expect(total(slices)).toBe(5000);
    expect(slices.every((slice) => slice.height <= 1000)).toBe(true);
  });

  it("keeps a capture shorter than a page on one page", () => {
    expect(planPageSlices(640, 1000, () => false)).toEqual([{ top: 0, height: 640 }]);
  });

  it("returns nothing for an empty capture", () => {
    expect(planPageSlices(0, 1000, () => false)).toEqual([]);
  });

  it("cuts at whitespace above the boundary instead of through a line", () => {
    // Content fills the page except for a gap at 950-960: a line of text would be
    // sliced if the cut fell at 1000.
    const slices = planPageSlices(3000, 1000, (y) => y >= 952 && y <= 960);

    expect(slices[0].height).toBe(960);
    expect(slices[1].top).toBe(960);
    expect(contiguous(slices)).toBe(true);
    expect(total(slices)).toBe(3000);
  });

  it("falls back to the boundary when no whitespace is near it", () => {
    const slices = planPageSlices(2500, 1000, () => false);

    expect(slices.map((slice) => slice.height)).toEqual([1000, 1000, 500]);
  });

  it("does not leave a page almost empty to reach a gap", () => {
    // The only gap sits 300px above the boundary - less than 60% of a page would be
    // filled, so the boundary is used and the gap moves to the next page.
    const slices = planPageSlices(2500, 1000, (y) => y === 700 || y === 1600);

    expect(slices[0].height).toBe(1000);
    // Only the remainder may be short; a mid-document page should not be.
    expect(slices.slice(0, -1).every((slice) => slice.height >= 600)).toBe(true);
  });
});
