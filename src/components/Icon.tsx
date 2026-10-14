import type { ReactNode } from "react";

// The UI used to lean on text glyphs as icons — ⌕ for search, □ for the draft
// box, ⌁ for edit. Those are font-dependent (they render differently, or not at
// all, depending on the platform font stack) and several of them say nothing
// about the action. Everything is now one stroke-based SVG set on a 24×24 grid:
// `currentColor` for theming, `aria-hidden` because the surrounding control
// already carries the accessible name.
export type IconName =
  | "arrowDown"
  | "arrowLeft"
  | "arrowUp"
  | "beaker"
  | "chart"
  | "check"
  | "checkSquare"
  | "chevronDown"
  | "chevronRight"
  | "clock"
  | "close"
  | "component"
  | "contrast"
  | "copy"
  | "download"
  | "eye"
  | "file"
  | "gear"
  | "globe"
  | "grid"
  | "heart"
  | "home"
  | "image"
  | "link"
  | "list"
  | "monitor"
  | "moon"
  | "more"
  | "minus"
  | "package"
  | "pencil"
  | "pin"
  | "plus"
  | "refresh"
  | "search"
  | "sparkles"
  | "square"
  | "sun"
  | "tool"
  | "trash"
  | "upload";

// Optical nudges, in viewBox units. Centring the viewBox is not the same as
// centring what the eye reads: measuring every icon's real ink bounding box (with
// the stroke inflated by half its width) showed three glyphs sitting visibly off
// centre — the heart rode 0.93 low, and both the sparkle pair and the wrench are
// lopsided because their second mass sits on one side. The other thirty-seven
// measured within 0.5 units, which is under half a pixel at the sizes the UI uses,
// so they are left exactly as drawn rather than nudged for the sake of symmetry.
const OPTICAL_OFFSET: Partial<Record<IconName, [number, number]>> = {
  heart: [0, -0.93],
  sparkles: [-1.35, -0.5],
  tool: [-0.75, 0.65],
};

const ICONS: Record<IconName, ReactNode> = {
  arrowDown: <path d="M12 5v14m0 0-5.5-5.5M12 19l5.5-5.5" />,
  arrowLeft: <path d="M19 12H5m0 0 6-6m-6 6 6 6" />,
  arrowUp: <path d="M12 19V5m0 0 5.5 5.5M12 5 6.5 10.5" />,
  beaker: (
    <>
      <path d="M9 3h6M10 3v6.4L5.6 17A2 2 0 0 0 7.4 20h9.2a2 2 0 0 0 1.8-3L14 9.4V3" />
      <path d="M8 14h8" />
    </>
  ),
  chart: <path d="M18 20V10M12 20V4M6 20v-6" />,
  check: <path d="M20 6 9 17l-5-5" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 6.8v5.5l3.4 2" />
    </>
  ),
  checkSquare: (
    <>
      <rect height="15" rx="3" width="15" x="4.5" y="4.5" />
      <path d="m8.8 12.2 2.4 2.4 4.4-4.6" />
    </>
  ),
  chevronDown: <path d="m6 9 6 6 6-6" />,
  chevronRight: <path d="m9 5 7 7-7 7" />,
  close: <path d="M18 6 6 18M6 6l12 12" />,
  component: (
    <>
      <path d="M12 2.6 15.4 6 12 9.4 8.6 6z" />
      <path d="M12 14.6 15.4 18 12 21.4 8.6 18z" />
      <path d="M17.6 8.6 21 12l-3.4 3.4L14.2 12z" />
      <path d="M6.4 8.6 9.8 12l-3.4 3.4L3 12z" />
    </>
  ),
  contrast: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" stroke="none" />
    </>
  ),
  copy: (
    <>
      <rect height="13" rx="2.2" width="13" x="8" y="8" />
      <path d="M15.6 5.6V4.8A1.8 1.8 0 0 0 13.8 3H5.8A1.8 1.8 0 0 0 4 4.8v8a1.8 1.8 0 0 0 1.8 1.8h.8" />
    </>
  ),
  download: <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />,
  eye: (
    <>
      <path d="M2.6 12S6.1 5.6 12 5.6 21.4 12 21.4 12 17.9 18.4 12 18.4 2.6 12 2.6 12z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  file: (
    <>
      <path d="M14 3H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7z" />
      <path d="M14 3v4h4M9.5 12.5h5M9.5 16.5h3" />
    </>
  ),
  gear: (
    <>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 2.8l1.5 2.4 2.8-.6.5 2.8 2.6 1.2-1.4 2.5 1.4 2.5-2.6 1.2-.5 2.8-2.8-.6L12 21.2l-1.5-2.4-2.8.6-.5-2.8-2.6-1.2L6 12.9 4.6 10.4l2.6-1.2.5-2.8 2.8.6z" />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18z" />
    </>
  ),
  grid: (
    <>
      <rect height="7" rx="1.5" width="7" x="3.5" y="3.5" />
      <rect height="7" rx="1.5" width="7" x="13.5" y="3.5" />
      <rect height="7" rx="1.5" width="7" x="3.5" y="13.5" />
      <rect height="7" rx="1.5" width="7" x="13.5" y="13.5" />
    </>
  ),
  heart: (
    <path d="M20.6 5.8a5.2 5.2 0 0 0-7.4 0L12 7l-1.2-1.2a5.2 5.2 0 0 0-7.4 7.4L12 21.6l8.6-8.4a5.2 5.2 0 0 0 0-7.4z" />
  ),
  home: (
    <>
      <path d="M3.5 10.4 12 3.4l8.5 7v9.2a1.4 1.4 0 0 1-1.4 1.4H4.9a1.4 1.4 0 0 1-1.4-1.4z" />
      <path d="M9.6 21v-6.4h4.8V21" />
    </>
  ),
  image: (
    <>
      <rect height="17" rx="2.4" width="18" x="3" y="3.5" />
      <circle cx="8.6" cy="9.2" r="1.6" />
      <path d="m21 15.4-4.6-4.6L5.2 21" />
    </>
  ),
  link: (
    <>
      <path d="M10.2 13.4a4.6 4.6 0 0 0 6.9.5l2.6-2.6a4.6 4.6 0 0 0-6.5-6.5l-1.5 1.5" />
      <path d="M13.8 10.6a4.6 4.6 0 0 0-6.9-.5l-2.6 2.6a4.6 4.6 0 0 0 6.5 6.5l1.5-1.5" />
    </>
  ),
  list: (
    <>
      <path d="M8.5 6h12M8.5 12h12M8.5 18h12" />
      <path d="M3.6 6h.01M3.6 12h.01M3.6 18h.01" />
    </>
  ),
  monitor: (
    <>
      <rect height="12.5" rx="2" width="18" x="3" y="4" />
      <path d="M12 16.5V20M8.5 20h7" />
    </>
  ),
  moon: <path d="M20.6 14.7A8.7 8.7 0 0 1 9.3 3.4a8.7 8.7 0 1 0 11.3 11.3z" />,
  more: (
    <>
      <circle cx="5" cy="12" fill="currentColor" r="1.7" stroke="none" />
      <circle cx="12" cy="12" fill="currentColor" r="1.7" stroke="none" />
      <circle cx="19" cy="12" fill="currentColor" r="1.7" stroke="none" />
    </>
  ),
  package: (
    <>
      <path d="M20.5 16.2V7.8a1.8 1.8 0 0 0-.9-1.6l-6.7-3.8a1.8 1.8 0 0 0-1.8 0L4.4 6.2a1.8 1.8 0 0 0-.9 1.6v8.4a1.8 1.8 0 0 0 .9 1.6l6.7 3.8a1.8 1.8 0 0 0 1.8 0l6.7-3.8a1.8 1.8 0 0 0 .9-1.6z" />
      <path d="m3.8 6.6 8.2 4.6 8.2-4.6M12 21.2v-9.9" />
    </>
  ),
  pencil: (
    <>
      <path d="M12.5 20.5H21" />
      <path d="M16.6 3.6a2.1 2.1 0 0 1 3 3L7.4 18.8l-4 1 1-4z" />
    </>
  ),
  pin: (
    <>
      <path d="M9.4 3.4h5.2l-.8 4.8 3.3 3.3H6.9l3.3-3.3z" />
      <path d="M12 11.5v9.1" />
    </>
  ),
  minus: <path d="M5 12h14" />,
  plus: <path d="M12 5v14M5 12h14" />,
  refresh: (
    <>
      <path d="M20.6 11.4A8.7 8.7 0 0 0 6 6.6L3.4 9" />
      <path d="M3.4 3.6V9h5.4" />
      <path d="M3.4 12.6A8.7 8.7 0 0 0 18 17.4l2.6-2.4" />
      <path d="M20.6 20.4V15h-5.4" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m16.4 16.4 4.1 4.1" />
    </>
  ),
  sparkles: (
    <>
      <path d="M11.4 3.2 13 8l4.8 1.6L13 11.2l-1.6 4.8L9.8 11.2 5 9.6 9.8 8z" />
      <path d="M18.4 15.2l.9 2.4 2.4.9-2.4.9-.9 2.4-.9-2.4-2.4-.9 2.4-.9z" />
    </>
  ),
  square: <rect height="15" rx="2.6" width="15" x="4.5" y="4.5" />,
  sun: (
    <>
      <circle cx="12" cy="12" r="4.2" />
      <path d="M12 2.6v2.2M12 19.2v2.2M2.6 12h2.2M19.2 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M18.7 5.3l-1.6 1.6M6.9 17.1l-1.6 1.6" />
    </>
  ),
  tool: (
    <path d="M14.6 6.5a1 1 0 0 0 0 1.4l1.5 1.5a1 1 0 0 0 1.4 0l3.6-3.6a5.6 5.6 0 0 1-7.4 7.4l-6.4 6.4a1.9 1.9 0 0 1-2.8-2.8l6.4-6.4a5.6 5.6 0 0 1 7.4-7.4z" />
  ),
  trash: (
    <>
      <path d="M3.5 6.5h17M9 6.5V4.8a1.3 1.3 0 0 1 1.3-1.3h3.4A1.3 1.3 0 0 1 15 4.8v1.7" />
      <path d="M18.6 6.5 17.7 19a1.8 1.8 0 0 1-1.8 1.7H8.1A1.8 1.8 0 0 1 6.3 19L5.4 6.5" />
      <path d="M10.4 10.8v6M13.6 10.8v6" />
    </>
  ),
  upload: <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 8l5-5 5 5M12 3v12" />,
};

type IconProps = {
  name: IconName;
  size?: number;
  /** Solid variant, used for the "already favourited" heart. */
  filled?: boolean;
  className?: string;
};

export function Icon({ name, size = 18, filled = false, className }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      className={className ? `ui-icon ${className}` : "ui-icon"}
      focusable="false"
      height={size}
      viewBox="0 0 24 24"
      width={size}
    >
      <g
        fill={filled ? "currentColor" : "none"}
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.7}
        transform={
          OPTICAL_OFFSET[name]
            ? `translate(${OPTICAL_OFFSET[name]![0]} ${OPTICAL_OFFSET[name]![1]})`
            : undefined
        }
      >
        {ICONS[name]}
      </g>
    </svg>
  );
}
