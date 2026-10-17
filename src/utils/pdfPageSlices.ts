// Where a tall capture is cut into pages.
//
// The sheet is captured as one bitmap and then placed on A4 pages. Two things went
// wrong with the first version of that: the whole image was embedded *again* on
// every page - so a two-page file stored the same picture twice - and the cuts fell
// at a fixed height, which regularly sliced a line of text in half.
//
// Both are decided here, away from the canvas and the PDF library, so the rules are
// testable: every slice is at most one page tall, the slices are contiguous and add
// up to the full image, and a cut prefers a row of uniform colour (whitespace between
// blocks) over the exact page boundary.
export type PageSlice = { top: number; height: number };

/**
 * @param isBlankRow tells whether a row can be cut without cutting something in half
 * @param searchRatio how far above the page boundary a better cut may be looked for
 */
export function planPageSlices(
  totalHeight: number,
  pageHeight: number,
  isBlankRow: (y: number) => boolean,
  searchRatio = 0.12,
): PageSlice[] {
  if (totalHeight <= 0 || pageHeight <= 0) {
    return totalHeight > 0 ? [{ top: 0, height: totalHeight }] : [];
  }

  const slices: PageSlice[] = [];
  const searchBack = Math.floor(pageHeight * searchRatio);
  // A cut that leaves less than this much content is not worth making: the page would
  // be mostly empty and the same text would simply start the next one.
  const minimumFill = Math.floor(pageHeight * 0.6);
  let cursor = 0;

  while (totalHeight - cursor > pageHeight) {
    const boundary = cursor + pageHeight;
    let cut = boundary;

    for (let y = boundary; y >= boundary - searchBack && y > cursor + minimumFill; y -= 1) {
      if (isBlankRow(y)) {
        cut = y;
        break;
      }
    }

    slices.push({ top: cursor, height: cut - cursor });
    cursor = cut;
  }

  if (cursor < totalHeight) {
    slices.push({ top: cursor, height: totalHeight - cursor });
  }

  return slices;
}
