import { describe, expect, it } from "vitest";
import { cardLevelFor } from "../src/utils/cardLevels";

const run = (fitted: "compact" | "plate" | "full", ceiling: "compact" | "plate" | "full", extra = {}) =>
  cardLevelFor({ fitted, ceiling, exempt: false, explicit: false, ...extra });

describe("how far a card may be thinned", () => {
  it("keeps the rich card when there is room", () => {
    expect(run("full", "full")).toBe("full");
  });

  it("lets crowding thin an inherited card all the way to a circle", () => {
    expect(run("compact", "compact")).toBe("compact");
    expect(run("compact", "plate")).toBe("compact");
  });

  it("never thins an explicit card below a plate", () => {
    expect(run("compact", "compact", { explicit: true })).toBe("plate");
    expect(run("compact", "plate", { explicit: true })).toBe("plate");
  });

  it("does not upgrade an explicit card beyond what fits", () => {
    expect(run("plate", "compact", { explicit: true })).toBe("plate");
  });

  it("ignores the ceiling for a selected or focused character, as before", () => {
    expect(run("full", "compact", { exempt: true })).toBe("full");
    expect(run("full", "compact", { exempt: true, explicit: true })).toBe("full");
  });
});
