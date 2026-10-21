// Which words to use for the input device the reader actually has.
//
// The guide used to say "按住 Shift 点击" and "Ctrl/Cmd 滚动" to everybody, which is two
// instructions for a phone (no Shift key, no wheel) and an ambiguous one everywhere
// else. The behaviour is already implemented; only the sentence changes.
//
// A pure function with the browser facts passed in, so the three branches are testable
// without a DOM.

export type InputPlatform = "mac" | "windows" | "touch";

export function inputPlatformOf(input: {
  userAgent: string;
  maxTouchPoints: number;
  /** `(pointer: coarse)` — a finger, not a mouse or a trackpad. */
  coarsePointer: boolean;
}): InputPlatform {
  // Coarse pointer first: a tablet with a desktop user agent is still a finger-driven
  // screen, and it has no Shift key to hold.
  if (input.coarsePointer && input.maxTouchPoints > 0) {
    return "touch";
  }

  // `Macintosh` covers desktop Safari/Chrome/Firefox on macOS; iPadOS reports
  // `Macintosh` too, but that case is already caught by the coarse pointer above.
  if (/Macintosh|Mac OS X/.test(input.userAgent)) {
    return "mac";
  }

  return "windows";
}

/** The modifier names, so a sentence cannot mix Command and Ctrl. */
export function modifierLabels(platform: InputPlatform): { zoom: string; add: string } {
  if (platform === "touch") {
    return { zoom: "双指缩放", add: "多选工具" };
  }
  if (platform === "mac") {
    return { zoom: "Command（⌘）", add: "Shift" };
  }
  return { zoom: "Ctrl", add: "Shift" };
}
