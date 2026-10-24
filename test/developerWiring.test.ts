// A switch that writes a value nobody reads is worse than no switch: it promises a
// setting. `includeFooter`, `includePromptSection` and `includeTimeInfo` were stored,
// editable, and read by nothing, and `importGuide` wore "已应用" while no surface
// printed it. This checks the claim directly — the badge list and the reads agree —
// so wiring one of them up, or unwiring one, fails here instead of drifting.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  defaultDeveloperSettings,
  unwiredContentKeys,
  unwiredExportDefaultKeys,
  type DeveloperSettings,
} from "../src/config/developerSettings";

const root = process.cwd();

/** Every source file the readers could live in: the panel and the settings module are
 *  the two places a key appears without being consumed, so they are left out. */
function consumerSources(dir = join(root, "src")): string {
  return readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        return consumerSources(path);
      }
      if (!/\.(ts|tsx)$/.test(entry.name)) {
        return [];
      }
      const relative = path.slice(root.length + 1);
      if (relative === "src/config/developerSettings.ts" || relative === "src/pages/DeveloperCenter.tsx") {
        return [];
      }
      return [readFileSync(path, "utf8")];
    })
    .join("\n");
}

const sources = consumerSources();
const preview = readFileSync(join(root, "src/pages/CharacterPreview.tsx"), "utf8");
const panel = readFileSync(join(root, "src/pages/DeveloperCenter.tsx"), "utf8");

const exportKey = (key: string) => new RegExp(`exportSettings\\??\\.${key}\\b`);
const contentReaders = (key: string) => [
  new RegExp(`contentText\\.${key}\\b`),
  new RegExp(`content\\.${key}\\b`),
  new RegExp(`getContentCopy\\(["']${key}["']\\)`),
];

describe("a setting may only wear 已应用 when a consumer reads it", () => {
  it("lists exactly the export defaults that nothing reads", () => {
    expect([...unwiredExportDefaultKeys].sort()).toEqual([
      "includeFooter",
      "includePromptSection",
      "includeTimeInfo",
    ]);

    for (const key of unwiredExportDefaultKeys) {
      expect(preview).not.toMatch(exportKey(key));
    }

    // And the other way round: everything the panel still badges as applied is read.
    const applied = (Object.keys(defaultDeveloperSettings.exportDefaults) as Array<
      keyof DeveloperSettings["exportDefaults"]
    >).filter((key) => !unwiredExportDefaultKeys.has(key));
    expect(applied).toEqual(["jpgQuality", "pngScale", "pdfLightMode"]);
    for (const key of applied) {
      expect(preview).toMatch(exportKey(key));
    }
  });

  it("lists exactly the content fields that nothing renders", () => {
    expect([...unwiredContentKeys].sort()).toEqual(["importGuide", "settingsSummary", "toastCopy"]);

    for (const key of unwiredContentKeys) {
      for (const reader of contentReaders(key)) {
        expect(sources).not.toMatch(reader);
      }
    }

    const applied = (Object.keys(defaultDeveloperSettings.content) as Array<
      keyof DeveloperSettings["content"]
    >).filter((key) => !unwiredContentKeys.has(key));
    for (const key of applied) {
      const reads = contentReaders(key).some((reader) => reader.test(sources));
      expect(reads, `${key} is badged 已应用 but no source reads it`).toBe(true);
    }
  });

  it("takes both lists from the settings module, so the panel cannot hold a second copy", () => {
    expect(panel).toMatch(/import \{[\s\S]*?unwiredContentKeys[\s\S]*?\} from "\.\.\/config\/developerSettings"/);
    expect(panel).toMatch(/import \{[\s\S]*?unwiredExportDefaultKeys[\s\S]*?\} from "\.\.\/config\/developerSettings"/);
    expect(panel).not.toMatch(/const unwiredContentKeys = new Set/);
    expect(panel).not.toMatch(/const unwiredExportDefaultKeys = new Set/);
  });

  it("drives the export switches from the list rather than from a literal", () => {
    expect(panel).toMatch(/const wired = !unwiredExportDefaultKeys\.has\(key\)/);
    expect(panel).toMatch(/status=\{wired \? "applied" : "comingSoon"\}/);
    expect(panel).toMatch(/disabled=\{!wired\}/);
  });
});
