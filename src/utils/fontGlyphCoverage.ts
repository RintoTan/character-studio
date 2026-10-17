// Which characters the embedded font can actually draw.
//
// The sheet font is a subset - GB2312 plus Latin and punctuation - so a name with a
// rare character in it would come out as an empty box. Rather than discover that from
// a reader's complaint, the cmap table is read once when the font is fetched, and the
// caller is told which characters are missing before the file is written.
//
// Fails open: if the table cannot be parsed, every character is reported as available
// and the export proceeds. A missing warning is better than a refused export.
export function createGlyphChecker(data: ArrayBuffer): (char: string) => boolean {
  try {
    const view = new DataView(data);
    const numTables = view.getUint16(4);
    let cmapOffset = -1;

    for (let index = 0; index < numTables; index += 1) {
      const record = 12 + index * 16;
      const tag = String.fromCharCode(
        view.getUint8(record),
        view.getUint8(record + 1),
        view.getUint8(record + 2),
        view.getUint8(record + 3),
      );
      if (tag === "cmap") {
        cmapOffset = view.getUint32(record + 8);
        break;
      }
    }

    if (cmapOffset < 0) {
      return () => true;
    }

    const subtableCount = view.getUint16(cmapOffset + 2);
    let bestOffset = -1;
    let bestFormat = 0;
    let bestScore = -1;

    for (let index = 0; index < subtableCount; index += 1) {
      const record = cmapOffset + 4 + index * 8;
      const platform = view.getUint16(record);
      const encoding = view.getUint16(record + 2);
      const offset = cmapOffset + view.getUint32(record + 4);
      const format = view.getUint16(offset);
      let score = -1;

      if (format === 12) {
        score = platform === 3 && encoding === 10 ? 5 : 4;
      } else if (format === 4) {
        score = platform === 3 && encoding === 1 ? 3 : platform === 0 ? 2 : 1;
      }

      if (score > bestScore) {
        bestScore = score;
        bestOffset = offset;
        bestFormat = format;
      }
    }

    if (bestOffset < 0) {
      return () => true;
    }

    if (bestFormat === 12) {
      const groupCount = view.getUint32(bestOffset + 12);
      const groups = bestOffset + 16;

      return (char: string) => {
        const code = char.codePointAt(0) ?? 0;
        let low = 0;
        let high = groupCount - 1;

        while (low <= high) {
          const middle = (low + high) >> 1;
          const start = view.getUint32(groups + middle * 12);
          const end = view.getUint32(groups + middle * 12 + 4);

          if (code < start) {
            high = middle - 1;
          } else if (code > end) {
            low = middle + 1;
          } else {
            return view.getUint32(groups + middle * 12 + 8) + (code - start) !== 0;
          }
        }

        return false;
      };
    }

    const segCountX2 = view.getUint16(bestOffset + 6);
    const segCount = segCountX2 / 2;
    const endCodes = bestOffset + 14;
    const startCodes = endCodes + segCountX2 + 2;
    const idDeltas = startCodes + segCountX2;
    const idRangeOffsets = idDeltas + segCountX2;

    return (char: string) => {
      const code = char.codePointAt(0) ?? 0;
      if (code > 0xffff) {
        return false;
      }

      for (let segment = 0; segment < segCount; segment += 1) {
        const end = view.getUint16(endCodes + segment * 2);
        if (code > end) {
          continue;
        }
        const start = view.getUint16(startCodes + segment * 2);
        if (code < start) {
          return false;
        }

        const delta = view.getInt16(idDeltas + segment * 2);
        const rangeOffset = view.getUint16(idRangeOffsets + segment * 2);

        if (rangeOffset === 0) {
          return ((code + delta) & 0xffff) !== 0;
        }

        const glyphAddress = idRangeOffsets + segment * 2 + rangeOffset + (code - start) * 2;
        if (glyphAddress + 1 >= view.byteLength) {
          return true;
        }
        const glyph = view.getUint16(glyphAddress);
        return glyph !== 0 && ((glyph + delta) & 0xffff) !== 0;
      }

      return false;
    };
  } catch {
    return () => true;
  }
}
