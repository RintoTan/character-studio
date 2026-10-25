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
  {
    kind: "testid",
    test: (name) => /-field$/.test(name),
    why: "NumericControl builds `${testId}-field` for its numeric input; the wrapper is `${testId}-wrap`",
  },
  {
    kind: "aria",
    test: (name) => name.endsWith("数值"),
    why: "NumericControl writes aria-label={`${ariaLabel}数值`} on that same field",
  },
];

function resolveToken(token: Token, haystack: string): boolean {
  if (token.kind === "testid") {
    const base = token.name.replace(/-input$|-wrap$|-active$|-active-clear$|-field$/, "");
    return [`"${base}"`, `'${base}'`, `\`${base}`, `"${base}-`, `\`${base}-`].some((needle) => haystack.includes(needle));
  }
  if (token.kind === "aria") {
    if (haystack.includes(`"${token.name}"`) || haystack.includes(`'${token.name}'`)) return true;
    // A composed label: `${ariaLabel}数值` reads back as `<base>数值`, so the base has to
    // exist as an ariaLabel prop.
    const base = token.name.replace(/数值$/, "");
    return base !== token.name && (haystack.includes(`ariaLabel="${base}"`) || haystack.includes(`ariaLabel={'${base}'}`));
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

/**
 * Labels the suite compares against, rather than selectors it queries.
 *
 * `button[aria-label="搜索"]` was findable by name; the checks that broke in the next
 * round were a different shape: query a list, then pick the element whose text matches a
 * literal. A class-name audit cannot see those, which is how /Settings/ survived in three
 * helpers long after the footer entry became 设置与数据 -- five checks kept failing with
 * "footer settings button missing" and nothing pointed at the string.
 *
 * "Rendered" here means the label appears as JSX text, an aria-label, or a title. A label
 * that is only used in an expression -- a preset table entry, a fixture created at
 * runtime -- cannot be judged that way, so those are listed with a reason instead.
 */
type LabelMatcher = { kind: "equality" | "regex"; alternatives: string[]; line: number };

function extractLabelMatchers(source: string): LabelMatcher[] {
  const found: LabelMatcher[] = [];
  const equality = /(?:textContent|innerText)[^;\n]{0,60}?===\s*"([^"$]+)"/g;
  for (const match of source.matchAll(equality)) {
    found.push({ kind: "equality", alternatives: [match[1]], line: source.slice(0, match.index).split("\n").length });
  }
  const regex = /\/\^?\(?([^/\n]+?)\)?\$?\/\.test\([^)\n]*(?:textContent|innerText)/g;
  for (const match of source.matchAll(regex)) {
    const alternatives = match[1]
      .split("|")
      .map((part) => part.replace(/[\^$.]/g, "").trim())
      .filter((part) => part.length > 0);
    if (alternatives.length > 0) {
      found.push({ kind: "regex", alternatives, line: source.slice(0, match.index).split("\n").length });
    }
  }
  return found;
}

function isRendered(label: string, haystack: string): boolean {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return (
    new RegExp(`>\\s*${escaped}\\s*<`).test(haystack) ||
    haystack.includes(`aria-label="${label}"`) ||
    haystack.includes(`title="${label}"`) ||
    haystack.includes(`"${label}"`) && /[\u4e00-\u9fff]/.test(label)
  );
}

/** Labels the source cannot render literally, each with the reason it is legitimate. */
const NOT_LITERAL: Array<{ label: string; why: string; fixture?: boolean }> = [
  { label: "人物群像", why: "preset label in src/storage/canvasStyle.ts, rendered through the preset table" },
  { label: "极简展示", why: "preset label in src/storage/canvasStyle.ts, rendered through the preset table" },
  { label: "档案研究", why: "preset label in src/storage/canvasStyle.ts, rendered through the preset table" },
  { label: "保存修改", why: "dialog action label built by the form-actions helper" },
  { label: "保存关系", why: "dialog action label built by the form-actions helper" },
  { label: "性格", why: "category label from the identity section table" },
  { label: "PDF", why: "export format id, assembled into the button label at render time" },
  { label: "Appearance", why: "surface id in src/utils/graphSurfaces.ts, not a visible label" },
  { label: "改过标题的事件", why: "fixture created by the check itself, never written in src", fixture: true },
  { label: "新建的事件标题", why: "fixture created by the check itself, never written in src", fixture: true },
  { label: "第03位北境人", why: "fixture created by the check itself, never written in src", fixture: true },
  { label: "第04位北境人", why: "fixture created by the check itself, never written in src", fixture: true },
];

describe("verify-browser label matchers", () => {
  const source = readFileSync(SCRIPT, "utf8");
  const haystack = sourceHaystack();
  const matchers = extractLabelMatchers(source);
  const alive = (label: string) =>
    isRendered(label, haystack) || NOT_LITERAL.some((entry) => entry.label === label);

  it("finds the matchers, including the ones this phase repaired", () => {
    // Non-vacuity: if extraction breaks, the audit below checks nothing and passes.
    expect(matchers.length).toBeGreaterThan(10);
    const labels = matchers.flatMap((matcher) => matcher.alternatives);
    expect(labels).toContain("设置与数据");
    expect(labels).toContain("确认恢复");
  });

  it("requires at least one alternative of every matcher to be rendered somewhere", () => {
    const dead: string[] = [];
    for (const matcher of matchers) {
      if (matcher.alternatives.some(alive)) continue;
      dead.push(`L${matcher.line}  ${matcher.kind}: ${matcher.alternatives.join(" | ")}`);
    }
    expect(dead, `labels no component renders:\n${dead.join("\n")}`).toEqual([]);
  });

  it("would have caught the /Settings/ regression", () => {
    // Reconstructed: a matcher whose only alternative is the label that was renamed away.
    const fake = 'find((item) => /^(Settings)$/.test(item.textContent.trim()))';
    const found = extractLabelMatchers(fake);
    expect(found).toHaveLength(1);
    expect(found[0].alternatives).toEqual(["Settings"]);
    expect(found[0].alternatives.some(alive)).toBe(false);
  });

  it("accepts a hedged matcher that keeps the old label beside the new one", () => {
    const found = extractLabelMatchers('/^(设置与数据|Settings)$/.test(item.textContent.trim())');
    expect(found[0].alternatives).toEqual(["设置与数据", "Settings"]);
    expect(found[0].alternatives.some(alive)).toBe(true);
  });

  it("would have caught the equality form of the same regression", () => {
    // The rollback path compared with === "Settings" -- the exact shape that made the
    // restore check look like a product defect.
    const found = extractLabelMatchers('x.textContent.trim() === "Settings"');
    expect(found[0].kind).toBe("equality");
    expect(found[0].alternatives.some(alive)).toBe(false);
  });

  it("flags a text matcher on a label nothing writes", () => {
    const found = extractLabelMatchers('x.textContent.trim() === "不存在的按钮"');
    expect(found[0].alternatives.some(alive)).toBe(false);
  });

  it("keeps the exemption list documented", () => {
    // Every exemption is a claim about where the label comes from; a bare list would be
    // a mute switch for exactly the class of bug this file exists to catch.
    for (const entry of NOT_LITERAL) {
      expect(entry.why.length, entry.label).toBeGreaterThan(20);
      if (entry.fixture) {
        // A fixture label must NOT be in src: if it were, the exemption would be stale.
        expect(haystack.includes(entry.label), `${entry.label} 已出现在 src 里，豁免应改成实判`).toBe(false);
      } else {
        expect(haystack.includes(entry.label), `${entry.label} 已不在 src 里，豁免应删除`).toBe(true);
      }
    }
  });

  it("collects getElementById targets and checks them too", () => {
    const ids = [...source.matchAll(/getElementById\(\s*["']([^"'$]+)["']\s*\)/g)].map((match) => match[1]);
    for (const id of ids) {
      expect(haystack, `getElementById("${id}") targets an id no component renders`).toContain(id);
    }
  });
});
