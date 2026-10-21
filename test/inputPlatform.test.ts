import { describe, expect, it } from "vitest";
import { inputPlatformOf, modifierLabels } from "../src/utils/inputPlatform";

describe("input platform", () => {
  it("treats a coarse pointer as touch whatever the user agent says", () => {
    // iPadOS reports a Macintosh user agent; it still has no Shift key and no wheel.
    expect(
      inputPlatformOf({
        userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
        maxTouchPoints: 5,
        coarsePointer: true,
      }),
    ).toBe("touch");

    expect(
      inputPlatformOf({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)", maxTouchPoints: 5, coarsePointer: true }),
    ).toBe("touch");
  });

  it("tells macOS from Windows when the pointer is fine", () => {
    expect(
      inputPlatformOf({
        userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15",
        maxTouchPoints: 0,
        coarsePointer: false,
      }),
    ).toBe("mac");

    expect(
      inputPlatformOf({
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        maxTouchPoints: 0,
        coarsePointer: false,
      }),
    ).toBe("windows");

    expect(
      inputPlatformOf({
        userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36",
        maxTouchPoints: 0,
        coarsePointer: false,
      }),
    ).toBe("windows");
  });

  it("names the modifier the platform actually has", () => {
    expect(modifierLabels("mac").zoom).toBe("Command（⌘）");
    expect(modifierLabels("windows").zoom).toBe("Ctrl");
    // A phone must never be told to press Ctrl or Shift.
    expect(modifierLabels("touch").zoom).toBe("双指缩放");
    expect(modifierLabels("touch").add).toBe("多选工具");
  });
});
