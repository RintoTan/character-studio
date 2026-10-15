import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// KI-15 was not a typo: the popstate handler listed the three pages that existed
// when it was written, and the three workspaces were added later without being
// added to the list, so Back from any of them rendered the dashboard while the
// history entry still named the workspace.
//
// A runtime test cannot enumerate a TypeScript union, so this reads the source
// instead. It is a structural guard and nothing more: it fails when a page is
// pushed onto the history without being made restorable, which is the shape of the
// original defect. It says nothing about whether a real browser restores correctly -
// that was measured separately, and the probe lives outside this repository.
const source = readFileSync("src/App.tsx", "utf8");

const listedPages = (): string[] => {
  const block = source.match(/const RESTORABLE_PAGES[^=]*=\s*\[([^\]]*)\]/);
  expect(block, "RESTORABLE_PAGES must exist in App.tsx").toBeTruthy();
  return [...block![1].matchAll(/"([a-z]+)"/g)].map((match) => match[1]);
};

const pushedPages = (): string[] =>
  [...source.matchAll(/setPage\("([a-z]+)"\)/g)].map((match) => match[1]);

describe("history restoration", () => {
  it("lists every page the app can navigate to", () => {
    const listed = listedPages();

    for (const page of new Set(pushedPages())) {
      expect(listed, `setPage("${page}") exists but "${page}" is not restorable`).toContain(page);
    }
  });

  it("keeps the dashboard as the fallback for an unknown history entry", () => {
    expect(listedPages()).toContain("dashboard");
    expect(source).toMatch(/isRestorablePage\(nextPage\)\s*\?\s*nextPage\s*:\s*"dashboard"/);
  });

  it("lists only pages the app can actually land on", () => {
    // The dashboard and the developer screen are not reached through setPage: the
    // first render picks between them from the URL.
    const initial = [...source.matchAll(/isDeveloperPath\(window\.location\.pathname\)\s*\?\s*"([a-z]+)"\s*:\s*"([a-z]+)"/g)]
      .flatMap((match) => [match[1], match[2]]);
    const reachable = new Set([...pushedPages(), ...initial]);

    for (const page of listedPages()) {
      expect(reachable, `"${page}" is restorable but nothing navigates there`).toContain(page);
    }
  });
});
