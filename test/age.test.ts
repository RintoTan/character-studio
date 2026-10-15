import { describe, expect, it } from "vitest";
import { calculateAgeFromDate } from "../src/utils/age";

// `today` is injected, so these are about the rule rather than about the day the
// suite happens to run. The whole point of the function is the birthday comparison,
// and that only shows up on the days either side of it.
describe("age from a birthday", () => {
  it("returns nothing for an empty or unusable value", () => {
    expect(calculateAgeFromDate("")).toBe("");
    expect(calculateAgeFromDate("not a date")).toBe("");
  });

  it("counts whole years once the birthday has passed", () => {
    expect(calculateAgeFromDate("2000-03-15", new Date(2026, 5, 1))).toBe("26");
  });

  it("takes a year off before the birthday comes round", () => {
    // The off-by-one this function exists to get right: on 1 March a character born
    // in December is 25, not 26.
    expect(calculateAgeFromDate("2000-12-15", new Date(2026, 2, 1))).toBe("25");
  });

  it("counts the birthday itself as already had", () => {
    expect(calculateAgeFromDate("2000-06-01", new Date(2026, 5, 1))).toBe("26");
  });

  it("turns over on the day, not the day after", () => {
    const born = "2000-06-01";
    expect(calculateAgeFromDate(born, new Date(2026, 5, 1))).toBe("26");
    expect(calculateAgeFromDate(born, new Date(2026, 4, 31))).toBe("25");
  });

  it("handles a leap-day birthday in a year that has no 29 February", () => {
    // 2026 is not a leap year, so the Date object rolls this to 1 March; either way
    // it must not report an age before the date has arrived.
    const onFeb28 = calculateAgeFromDate("2004-02-29", new Date(2026, 1, 28));
    const onMar1 = calculateAgeFromDate("2004-02-29", new Date(2026, 2, 1));

    expect(onFeb28).toBe("21");
    expect(onMar1).toBe("22");
  });

  it("refuses to report a negative age for a birthday in the future", () => {
    expect(calculateAgeFromDate("2030-01-01", new Date(2026, 0, 1))).toBe("");
  });

  it("counts a newborn of this year as 0", () => {
    expect(calculateAgeFromDate("2026-01-01", new Date(2026, 5, 1))).toBe("0");
  });
});
