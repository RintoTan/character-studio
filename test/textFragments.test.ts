import { describe, expect, it } from "vitest";
import { fragmentRoot } from "../src/utils/textFragments";

describe("fragment repeat control", () => {
  it("treats two fragments with the same opening as one root", () => {
    expect(fragmentRoot("雾海里的旧灯塔")).toBe(fragmentRoot("雾海里的旧船坞"));
  });

  it("ignores whitespace so spacing cannot hide a repeat", () => {
    expect(fragmentRoot("雾海 里的 旧灯塔")).toBe(fragmentRoot("雾海里的旧灯塔"));
  });

  it("separates fragments that open differently", () => {
    expect(fragmentRoot("雾海里的旧灯塔")).not.toBe(fragmentRoot("北境商队的护送者"));
  });

  it("returns short fragments whole rather than padding them", () => {
    expect(fragmentRoot("雾")).toBe("雾");
    expect(fragmentRoot("")).toBe("");
  });

  it("honours an explicit length", () => {
    expect(fragmentRoot("雾海里的旧灯塔", 2)).toBe("雾海");
    expect(fragmentRoot("雾海里的旧灯塔", 0)).toBe("");
  });
});
