// @vitest-environment node
// Every selector in scripts/verify-browser.mjs has to point at something the app can
// actually render.
//
// Two classes of failure prompted this test, both found the same way — a check that had
// been "failing for a while" for a reason nobody was reading:
//
//   .timeline-search input   the search became WorkspaceSearch; the class survived only
//                            in styles.css, so the selector matched nothing and the check
//                            threw "找不到输入框" on every run.
//   button[aria-label=搜索]  the control's label became 搜索角色 when it gained a visible
//                            text label, so this threw "null.focus".
//
// A class that exists in CSS but is applied by no component is indistinguishable, from a
// selector's point of view, from a class that was deleted. So the haystack here is the
// TS/TSX sources only: if no component writes the name, the selector is dead.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "..");
const SCRIPT = join(ROOT, "scripts/verify-browser.mjs");

/** Selectors written literally; interpolated ones (`${...}`) are skipped — they are built
 *  from data and cannot be resolved from source alone. */
function extractSelectors(source: string): string[] {
  const patterns = [
    /querySelectorAll\(\s*"([^"]+)"/g,
    /querySelectorAll\(\s*'([^']+)'/g,
    /querySelector\(\s*"([^"]+)"/g,
    /querySelector\(\s*'([^']+)'/g,
  ];
  const found = new Set<string>();
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const selector = match[1];
      if (selector.includes("${") || selector.includes("\\")) continue;
      found.add(selector);
    }
  }
  return [...found].sort();
}

function sourceHaystack(): string {
  const chunks: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) {
        walk(path);
      } else if (path.endsWith(".ts") || path.endsWith(".tsx")) {
        chunks.push(readFileSync(path, "utf8"));
      }
    }
  };
  walk(join(ROOT, "src"));
  return chunks.join("\n");
}

type Token = { kind: "class" | "id" | "testid" | "aria"; name: string };

function tokensOf(selector: string): Token[] {
  const tokens: Token[] = [];
  for (const match of selector.matchAll(/\.([A-Za-z0-9_-]+)/g)) tokens.push({ kind: "class", name: match[1] });
  for (const match of selector.matchAll(/#([A-Za-z0-9_-]+)/g)) tokens.push({ kind: "id", name: match[1] });
  for (const match of selector.matchAll(/data-testid=["']?([A-Za-z0-9_-]+)/g)) tokens.push({ kind: "testid", name: match[1] });
  for (const match of selector.matchAll(/aria-label=["']([^"']+)/g)) tokens.push({ kind: "aria", name: match[1] });
  return tokens;
}

/**
 * Names the source never spells out because they are composed at render time.
 * Each entry is a reason, not a wildcard: anything new has to be explained here.
 */
const DERIVED: Array<{ kind: Token["kind"]; test: (name: string) => boolean; why: string }> = [
  {
    kind: "class",
    test: (name) => name.startsWith("kind-"),
    why: "className={`relationship-edge kind-${relationship.kind}`} — the value comes from data",
  },
  {
    kind: "aria",
    test: (name) => name.startsWith("选择 "),
    why: "aria-label={`选择 ${character.name}`} — the name comes from data",
  },
  {
    kind: "testid",
    test: (name) => /-input$|-wrap$|-active$|-active-clear$/.test(name),
    why: "WorkspaceSearch builds `${testId}-input` and friends from the testId prop",
  },
];

function resolveToken(token: Token, haystack: string): boolean {
  if (token.kind === "testid") {
    const base = token.name.replace(/-input$|-wrap$|-active$|-active-clear$/, "");
    return [`"${base}"`, `'${base}'`, `\`${base}`, `"${base}-`, `\`${base}-`].some((needle) => haystack.includes(needle));
  }
  if (token.kind === "aria") {
    return haystack.includes(`"${token.name}"`) || haystack.includes(`'${token.name}'`);
  }
  return haystack.includes(token.name);
}

describe("verify-browser locators", () => {
  const selectors = extractSelectors(readFileSync(SCRIPT, "utf8"));
  const haystack = sourceHaystack();

  it("extracts a believable number of selectors", () => {
    // If the extraction ever breaks, the audit below would check nothing and pass.
    expect(selectors.length).toBeGreaterThan(300);
    expect(selectors).toContain('[data-testid="dashboard-search"]');
  });

  it("points every selector at a name some component renders", () => {
    const dead: string[] = [];

    for (const selector of selectors) {
      for (const token of tokensOf(selector)) {
        if (DERIVED.some((rule) => rule.kind === token.kind && rule.test(token.name))) continue;
        if (!resolveToken(token, haystack)) {
          dead.push(`${token.kind}:${token.name}  <-  ${selector}`);
        }
      }
    }

    expect(dead, `selectors pointing at names no component renders:\n${dead.join("\n")}`).toEqual([]);
  });

  it("documents the derived names it lets through", () => {
    // The allowlist is short on purpose. Every entry needs a reason, and every reason is
    // a claim about how the name is built — so this list is reviewable, not a mute switch.
    for (const rule of DERIVED) {
      expect(rule.why.length).toBeGreaterThan(20);
    }
    const derivedSamples = selectors.flatMap((selector) =>
      tokensOf(selector).filter((token) => DERIVED.some((rule) => rule.kind === token.kind && rule.test(token.name))),
    );
    expect(derivedSamples.length).toBeGreaterThan(0);
  });
});
