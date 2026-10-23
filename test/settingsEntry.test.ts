// The backup and restore screens only exist while the settings dialog is open, and
// that dialog has exactly one state flag. Twice now the flag could only be set to
// false, which left 完整备份 ZIP and 完整恢复 in the build but unreachable from any
// menu — invisible to a click test, invisible to every unit test, and only found when
// a real backup had to be taken. This guard reads the source and insists that some
// control actually opens it, and that the menu item stays next to its trigger.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("../src/pages/Dashboard.tsx", import.meta.url), "utf8");

describe("the settings dialog can be opened", () => {
  it("has at least one control that sets the flag to true", () => {
    expect(source).toMatch(/setIsSettingsOpen\(\s*true\s*\)/);
  });

  it("puts that control in the data menu, where a backup is looked for", () => {
    const at = source.indexOf('data-testid="open-settings"');
    expect(at).toBeGreaterThan(-1);

    const block = source.slice(at, at + 400);
    expect(block).toMatch(/setIsSettingsOpen\(true\)/);
    expect(block).toMatch(/设置与数据/);
  });

  it("keeps the backup and restore actions wired inside the dialog", () => {
    expect(source).toMatch(/完整备份 ZIP/);
    expect(source).toMatch(/完整恢复/);
    expect(source).toMatch(/handleExportFullBackup\(\)/);
    expect(source).toMatch(/openImport\("replace"\)/);
  });
});
