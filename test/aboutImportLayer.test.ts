// A first-run welcome is allowed to say hello; it is not allowed to cover a restore.
// The About dialog is rendered by the host, the import preview by the dashboard, so the
// only thing keeping them apart is this contract: the dashboard reports the flow, the
// host closes the welcome. These guards read the two sources and insist the contract is
// still wired at both ends — the failure mode is silent (the preview simply sits behind
// an opaque panel), which no unit test would otherwise catch.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const dashboard = readFileSync(new URL("../src/pages/Dashboard.tsx", import.meta.url), "utf8");

describe("the first-run About and the import preview", () => {
  it("lets the dashboard report that an import is on screen", () => {
    expect(dashboard).toMatch(/onImportFlowChange\?: \(active: boolean\) => void/);
    expect(dashboard).toMatch(/onImportFlowChange\?\.\(Boolean\(importPlan\)\)/);
  });

  it("has the host listen for it", () => {
    expect(app).toMatch(/onImportFlowChange=\{setIsImportFlowOpen\}/);
  });

  it("closes the welcome when an import starts, without marking it as seen", () => {
    expect(app).toMatch(/if \(isImportFlowOpen && isAppAboutOpen\) \{\s*setIsAppAboutOpen\(false\);/);
    expect(app).not.toMatch(/isImportFlowOpen[\s\S]{0,200}ABOUT_SEEN_KEY, "true"/);
  });
});
