// The rail and the card bodies are two halves of one contract: the nav renders
// `developerSections`, and each card body is picked by `section.id === "…"`. A branch
// whose id is absent from that array can never render, no matter how complete it looks
// — that is how the ai / debug / data / update panels sat unreachable while passing
// review as if they were features. This guard fails on both directions of drift: a
// branch no section can reach, and a section that renders no body at all.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync(new URL("../src/pages/DeveloperCenter.tsx", import.meta.url), "utf8");

/** Ids declared in the `developerSections` array, in rail order. */
function declaredSectionIds(): string[] {
  const start = page.indexOf("const developerSections");
  const end = page.indexOf("\n];", start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return [...page.slice(start, end).matchAll(/^\s{4}id: "([a-z-]+)",$/gm)].map((match) => match[1]);
}

/** Ids the card body branches on, one entry per `section.id === "…"`. */
function branchIds(): string[] {
  return [...page.matchAll(/section\.id === "([a-z-]+)"/g)].map((match) => match[1]);
}

describe("the Developer Center renders every section it advertises", () => {
  it("declares exactly the nine sections the rail shows", () => {
    expect(declaredSectionIds()).toEqual([
      "project",
      "brand",
      "design",
      "content",
      "prompt",
      "application",
      "export",
      "tools",
      "experimental",
    ]);
  });

  it("branches on no id that the section list cannot produce", () => {
    const declared = new Set(declaredSectionIds());
    const branches = branchIds();

    // project's card is written by hand, so the remaining eight are the whole set.
    expect(branches.length).toBeGreaterThanOrEqual(8);
    expect([...new Set(branches)].sort()).toEqual([...declared].filter((id) => id !== "project").sort());
    for (const retired of ["ai", "debug", "data", "update"]) {
      expect(branches).not.toContain(retired);
    }
  });

  it("keeps the hand-written project card that the rail links to", () => {
    expect(page).toMatch(/id="developer-project"/);
    expect(page).toMatch(/filter\(\(section\) => section\.id !== "project"\)/);
  });
});
