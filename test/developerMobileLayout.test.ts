// Both regressions here were invisible to unit tests and only showed up in a phone
// screenshot: the Developer Center rail was one 1430px strip inside a 357px column,
// so seven of the nine sections sat off-screen with nothing to hint they existed,
// and the "Prompt Library：…" badge kept its single-line fixed-height tag shape and
// clipped its own value. This guard reads the stylesheet and the page, and insists
// that the phone layout wraps rather than hides. The obvious "fixes" — deleting the
// badge, shrinking it to unreadable, or leaving overflow hidden — all fail here.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
const page = readFileSync(new URL("../src/pages/DeveloperCenter.tsx", import.meta.url), "utf8");

/** Every `@media (max-width: <px>px) {` block, brace-matched. The sheet keeps one
 *  such block per feature area, so a selector can live in any of them. */
function mediaBodies(source: string, maxWidth: string): string[] {
  const marker = `@media (max-width: ${maxWidth}px) {`;
  const bodies: string[] = [];
  for (let at = source.indexOf(marker); at > -1; at = source.indexOf(marker, at + 1)) {
    const open = source.indexOf("{", at);
    let depth = 0;
    for (let i = open; i < source.length; i += 1) {
      if (source[i] === "{") depth += 1;
      else if (source[i] === "}") {
        depth -= 1;
        if (depth === 0) {
          bodies.push(source.slice(open + 1, i));
          break;
        }
      }
    }
  }
  return bodies;
}

/** Declarations of `selector` from the last phone block that declares it. */
function ruleBody(selector: string): string {
  const bodies = mediaBodies(css, "720");
  expect(bodies.length).toBeGreaterThan(0);
  for (let i = bodies.length - 1; i >= 0; i -= 1) {
    const at = bodies[i].lastIndexOf(`\n  ${selector} {`);
    if (at > -1) {
      const start = bodies[i].indexOf("{", at) + 1;
      return bodies[i].slice(start, bodies[i].indexOf("}", start));
    }
  }
  throw new Error(`${selector} is not declared in any max-width:720px block`);
}

describe("the Developer Center rail reflows on a phone", () => {
  it("lays the sections out in wrapping columns", () => {
    const body = ruleBody(".developer-nav");
    expect(body).toMatch(/grid-template-columns:\s*repeat\(auto-fit, minmax\(\d+px, 1fr\)\)/);
    expect(body).toMatch(/grid-auto-flow:\s*row/);
  });

  it("does not fall back to a horizontal strip", () => {
    const body = ruleBody(".developer-nav");
    expect(body).not.toMatch(/overflow-x:\s*(auto|scroll)/);
    expect(body).not.toMatch(/overflow:\s*hidden/);
    expect(body).not.toMatch(/grid-auto-columns/);
  });
});

describe("hero badges keep their whole message on a phone", () => {
  it("lets a badge wrap and grow instead of clipping its value", () => {
    const body = ruleBody(".developer-hero-badges .status-badge");
    expect(body).toMatch(/white-space:\s*normal/);
    expect(body).toMatch(/max-width:\s*100%/);
    expect(body).toMatch(/height:\s*auto/);
    expect(body).not.toMatch(/overflow:\s*hidden/);
    expect(body).not.toMatch(/text-overflow/);
  });

  it("keeps every badge, including the one that used to be cut off", () => {
    expect(page).toMatch(/Version \{settings\.project\.version\}/);
    expect(page).toMatch(/Sprint \{settings\.project\.sprint\}/);
    expect(page).toMatch(/Build \{settings\.project\.build\}/);
    expect(page).toMatch(/数据版本：Local v1/);
    expect(page).toMatch(/Prompt Library：\{?/);
  });
});

describe("the rail still lists every section", () => {
  it("renders one link per section rather than a hand-picked subset", () => {
    const aside = page.slice(page.indexOf('className="developer-nav"'));
    const body = aside.slice(0, aside.indexOf("</aside>"));
    expect(body).toMatch(/developerSections\.map/);
  });

  it("has unique section ids so every anchor keeps its own target", () => {
    const ids = [...page.matchAll(/^\s{4}id: "([a-z-]+)",$/gm)].map((m) => m[1]);
    expect(ids.length).toBeGreaterThanOrEqual(9);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
