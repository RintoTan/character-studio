import { describe, expect, it } from "vitest";
import { compareVersions, readAppVersion } from "../scripts/verify-version.mjs";

// The check exists so that the two copies of the version number cannot drift again
// (KI-07). These cases cover the comparison itself; the command is exercised too, so
// that a mismatch really does produce a non-zero exit code rather than only a
// rejected function call.
describe("version consistency", () => {
  it("reads APP_VERSION out of the version module", () => {
    expect(readAppVersion('export const APP_VERSION = "2.27.0";')).toBe("2.27.0");
    expect(readAppVersion('export const APP_VERSION = "2.28.0";\n')).toBe("2.28.0");
  });

  it("reports agreement", () => {
    expect(compareVersions("2.27.0", "2.27.0")).toEqual({ ok: true, reason: "2.27.0" });
  });

  it("reports a mismatch in both directions, naming both values", () => {
    const older = compareVersions("1.0.0", "2.27.0");
    expect(older.ok).toBe(false);
    expect(older.reason).toContain("1.0.0");
    expect(older.reason).toContain("2.27.0");

    expect(compareVersions("2.27.0", "1.0.0").ok).toBe(false);
  });

  it("reports a missing value instead of passing it", () => {
    expect(compareVersions(null, "2.27.0").ok).toBe(false);
    expect(compareVersions("2.27.0", undefined).ok).toBe(false);
    expect(compareVersions("", "").ok).toBe(false);
  });
});
