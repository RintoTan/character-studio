// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import {
  DEVELOPER_SETTINGS_KEY,
  applyDeveloperSettings,
  defaultDeveloperSettings,
  loadDeveloperSettings,
  mergeDeveloperSettings,
  saveDeveloperSettings,
} from "../src/config/developerSettings";

const withAccent = (accentColor: string) =>
  structuredClone({ ...defaultDeveloperSettings, appearance: { ...defaultDeveloperSettings.appearance, accentColor } });

// Same WCAG relative-luminance calculation the app uses to pick text on accent.
const channels = (hex: string) =>
  [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) =>
    c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4,
  );

const luminance = (hex: string) => {
  const [r, g, b] = channels(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

const contrast = (a: string, b: string) => {
  const [l1, l2] = [luminance(a), luminance(b)];
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
};

const readVar = (name: string) => document.documentElement.style.getPropertyValue(name).trim();

describe("developerSettings", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("style");
  });

  it("returns the defaults when nothing has been stored", () => {
    expect(loadDeveloperSettings()).toEqual(defaultDeveloperSettings);
  });

  it("survives corrupted stored settings", () => {
    localStorage.setItem(DEVELOPER_SETTINGS_KEY, "not json at all");
    expect(loadDeveloperSettings()).toEqual(defaultDeveloperSettings);
  });

  it("round-trips a saved settings object", () => {
    const settings = mergeDeveloperSettings({ content: { footerText: "自定义页脚" } });
    saveDeveloperSettings(settings);

    expect(loadDeveloperSettings().content.footerText).toBe("自定义页脚");
  });

  it("merges partial input over the defaults and ignores junk", () => {
    const merged = mergeDeveloperSettings({ appearance: { accentColor: "#123456" } });

    expect(merged.appearance.accentColor).toBe("#123456");
    // Untouched siblings keep their defaults rather than becoming undefined.
    expect(merged.appearance.borderRadius).toBe(defaultDeveloperSettings.appearance.borderRadius);
    expect(merged.project.version).toBe(defaultDeveloperSettings.project.version);
    expect(() => mergeDeveloperSettings(null)).not.toThrow();
  });

  describe("legacy flat-key migration", () => {
    it("seeds the unified object from the legacy keys on first load", () => {
      // The removed mirror wrote these keys; they are now migration input only.
      localStorage.setItem("character-studio.settings.open-search", "true");
      localStorage.setItem("character-studio.settings.compact-mobile", "false");
      localStorage.setItem("character-studio.prompt.complexity", "high");
      localStorage.setItem("character-studio.settings.jpg-quality", "0.5");

      const settings = loadDeveloperSettings();

      expect(settings.dashboardDefaults.openSearch).toBe(true);
      expect(settings.editorDefaults.compactMobileEditor).toBe(false);
      expect(settings.promptCenter.complexity).toBe("high");
      expect(settings.exportDefaults.jpgQuality).toBe(0.5);
    });

    it("keeps untouched settings at their defaults", () => {
      localStorage.setItem("character-studio.prompt.complexity", "high");

      const settings = loadDeveloperSettings();

      expect(settings.dashboardDefaults.hideLowPriority).toBe(true);
      expect(settings.promptCenter.customLibraryText).toBe(
        defaultDeveloperSettings.promptCenter.customLibraryText,
      );
    });

    it("ignores the legacy keys once the unified object has been stored", () => {
      // Otherwise a stale flat key would silently overwrite a deliberate change.
      saveDeveloperSettings(mergeDeveloperSettings({ dashboardDefaults: { openSearch: false } }));
      localStorage.setItem("character-studio.settings.open-search", "true");

      expect(loadDeveloperSettings().dashboardDefaults.openSearch).toBe(false);
    });

    it("ignores an unparsable legacy number rather than storing NaN", () => {
      localStorage.setItem("character-studio.settings.jpg-quality", "not-a-number");

      expect(loadDeveloperSettings().exportDefaults.jpgQuality).toBe(
        defaultDeveloperSettings.exportDefaults.jpgQuality,
      );
    });
  });

  describe("accent tokens", () => {
    it("derives a hover shade that differs from the base accent", () => {
      // Regression guard: these two were assigned the same value, so hovering a
      // primary button or a selected tag changed nothing at all.
      applyDeveloperSettings(withAccent("#635ab2"));

      expect(readVar("--primary")).toBe("#635ab2");
      expect(readVar("--primary-hover")).not.toBe(readVar("--primary"));
    });

    it("keeps the label readable on both the base and the hover shade", () => {
      for (const accent of ["#635ab2", "#1d4ed8", "#111827", "#e5e7eb"]) {
        applyDeveloperSettings(withAccent(accent));
        const onPrimary = readVar("--on-primary");

        expect(contrast(onPrimary, readVar("--primary"))).toBeGreaterThanOrEqual(4.5);
        expect(contrast(onPrimary, readVar("--primary-hover"))).toBeGreaterThanOrEqual(4.5);
      }
    });

    it("picks near-black text for a light accent and white for a dark one", () => {
      applyDeveloperSettings(withAccent("#e5e7eb"));
      expect(readVar("--on-primary")).toBe("#111827");

      applyDeveloperSettings(withAccent("#635ab2"));
      expect(readVar("--on-primary")).toBe("#ffffff");
    });

    it("lightens instead of darkening when the accent is nearly black", () => {
      // Darkening #111827 would be invisible, so the hover must go the other way.
      applyDeveloperSettings(withAccent("#111827"));
      expect(luminance(readVar("--primary-hover"))).toBeGreaterThan(luminance("#111827"));
    });

    it("passes an unusable accent value through untouched instead of inventing one", () => {
      applyDeveloperSettings(withAccent("not-a-colour"));
      expect(readVar("--primary")).toBe("not-a-colour");
      expect(readVar("--primary-hover")).toBe("not-a-colour");
    });
  });
});
