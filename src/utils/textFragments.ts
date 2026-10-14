// Repeat control for the inspiration library.
//
// Filtering identical strings is not enough: fragments that open with the same
// words read as one idea even when the tail differs, so "雾海里的旧灯塔" and
// "雾海里的旧船坞" both land as "雾海里的旧…". Comparing the opening keeps a
// single generation from leaning on one root.

export const FRAGMENT_ROOT_LENGTH = 4;

/** The opening of a fragment, with whitespace removed so spacing cannot hide a repeat. */
export function fragmentRoot(value: string, length = FRAGMENT_ROOT_LENGTH): string {
  return value.replace(/\s+/g, "").slice(0, Math.max(length, 0));
}
