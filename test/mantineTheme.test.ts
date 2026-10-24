import { describe, expect, it } from "vitest";
import {
  BRAND_PRIMARY_SHADE,
  brandScale,
  contrastRatio,
  mixHex,
  normalizeHex,
  readableTextOn,
} from "../src/ui/accent";

describe("the Mantine brand scale is derived from the one accent colour", () => {
  it("puts the accent itself on the step the light scheme uses", () => {
    const scale = brandScale("#635ab2");
    expect(scale).toHaveLength(10);
    expect(scale[BRAND_PRIMARY_SHADE.light]).toBe("#635ab2");
    for (const step of scale) {
      expect(step).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it("keeps every step a distinct colour", () => {
    const scale = brandScale("#635ab2");
    expect(new Set(scale).size).toBe(10);
  });

  it("gets lighter towards 0 and darker after 6", () => {
    const scale = brandScale("#635ab2");
    const luminance = (hex: string) => contrastRatio(hex, "#000000");
    for (let index = 1; index <= 4; index += 1) {
      expect(luminance(scale[index])).toBeLessThan(luminance(scale[index - 1]));
    }
    expect(luminance(scale[6])).toBeLessThan(luminance(scale[5]));
    for (let index = 7; index <= 9; index += 1) {
      expect(luminance(scale[index])).toBeLessThan(luminance(scale[index - 1]));
    }
  });

  it("survives a colour that is not valid hex", () => {
    expect(brandScale("not-a-colour")).toHaveLength(10);
    expect(brandScale("not-a-colour")[6]).toBe("#635ab2");
  });

  it("accepts three-digit shorthand and normalises it", () => {
    expect(normalizeHex("#abc")).toBe("#aabbcc");
    expect(normalizeHex("635AB2")).toBe("#635ab2");
    expect(normalizeHex("#12345")).toBeNull();
  });

  it("mixes towards the target without leaving the gamut", () => {
    expect(mixHex("#000000", "#ffffff", 0)).toBe("#000000");
    expect(mixHex("#000000", "#ffffff", 1)).toBe("#ffffff");
    expect(mixHex("#000000", "#ffffff", 0.5)).toBe("#808080");
  });

  it("picks readable text for both a light and a dark accent", () => {
    expect(readableTextOn("#635ab2")).toBe("#ffffff");
    expect(readableTextOn("#f5e6a8")).toBe("#111827");
    // The chosen text has to clear AA on the fill it sits on, not merely look darker.
    expect(contrastRatio("#635ab2", readableTextOn("#635ab2"))).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio("#f5e6a8", readableTextOn("#f5e6a8"))).toBeGreaterThanOrEqual(4.5);
  });
});
