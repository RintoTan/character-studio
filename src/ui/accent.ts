// The accent colour is the one brand value the user can change. Mantine wants a
// ten-step scale rather than a single colour, so the scale is derived from the same
// value the rest of the app already paints: no second palette, no second opinion about
// what the brand colour is.
//
// Steps 0-4 are tints (used for backgrounds, hover fills and the dark scheme's primary),
// step 6 is the accent itself (light scheme's primary), and 7-9 are the pressed and
// disabled shades. The ordering is what makes a Mantine control read as one control
// instead of ten unrelated swatches.

export type Rgb = { r: number; g: number; b: number };

const HEX = /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/** Expands `#abc` to `#aabbcc`; returns null for anything that is not a hex colour. */
export function normalizeHex(input: string): string | null {
  const match = HEX.exec(input.trim());
  if (!match) {
    return null;
  }
  const body = match[1];
  const full = body.length === 3 ? body.split("").map((part) => part + part).join("") : body;
  return `#${full.toLowerCase()}`;
}

export function rgbOf(hex: string): Rgb | null {
  const normalized = normalizeHex(hex);
  if (!normalized) {
    return null;
  }
  return {
    r: parseInt(normalized.slice(1, 3), 16),
    g: parseInt(normalized.slice(3, 5), 16),
    b: parseInt(normalized.slice(5, 7), 16),
  };
}

function toHex({ r, g, b }: Rgb): string {
  const channel = (value: number) =>
    Math.max(0, Math.min(255, Math.round(value)))
      .toString(16)
      .padStart(2, "0");
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

/** `ratio` is the share of `towards`: 0 keeps `from`, 1 returns `towards`. */
export function mixHex(from: string, towards: string, ratio: number): string {
  const a = rgbOf(from);
  const b = rgbOf(towards);
  if (!a || !b) {
    return normalizeHex(from) ?? from;
  }
  const t = Math.max(0, Math.min(1, ratio));
  return toHex({
    r: a.r + (b.r - a.r) * t,
    g: a.g + (b.g - a.g) * t,
    b: a.b + (b.b - a.b) * t,
  });
}

function relativeLuminance(hex: string): number {
  const rgb = rgbOf(hex);
  if (!rgb) {
    return 0;
  }
  const linear = (channel: number) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(rgb.r) + 0.7152 * linear(rgb.g) + 0.0722 * linear(rgb.b);
}

export function contrastRatio(a: string, b: string): number {
  const first = relativeLuminance(a);
  const second = relativeLuminance(b);
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);
  return (lighter + 0.05) / (darker + 0.05);
}

/** White or near-black, whichever actually reads on this fill. */
export function readableTextOn(fill: string): string {
  return contrastRatio(fill, "#ffffff") >= contrastRatio(fill, "#111827") ? "#ffffff" : "#111827";
}

const TINTS = [0.92, 0.78, 0.6, 0.4, 0.22];
// Step 7 is the first darkening step; 6 is the accent itself, so a 0 here would
// produce the same colour twice and collapse two states into one.
const SHADES = [0.12, 0.24, 0.38];

/**
 * Ten steps from one accent. Step 6 is exactly the accent, so a Mantine control at the
 * default shade and a legacy CSS control painted with `--primary` are the same colour.
 */
export type BrandScale = [
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
];

export function brandScale(accent: string): BrandScale {
  const base = normalizeHex(accent) ?? "#635ab2";
  const tints = TINTS.map((ratio) => mixHex(base, "#ffffff", ratio));
  const shades = SHADES.map((ratio) => mixHex(base, "#0b0b0f", ratio));
  return [
    tints[0],
    tints[1],
    tints[2],
    tints[3],
    tints[4],
    mixHex(base, "#ffffff", 0.08),
    base,
    shades[0],
    shades[1],
    shades[2],
  ] as BrandScale;
}

/**
 * The step a control uses in each scheme. In dark mode the accent itself sits too close
 * to the near-black surfaces, so the primary is the first tint instead.
 */
export const BRAND_PRIMARY_SHADE = { light: 6, dark: 4 } as const;
