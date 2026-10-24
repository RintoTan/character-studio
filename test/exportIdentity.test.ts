// A name is hidden on screen but still written into the file as an attribute, so the
// picture says one thing and the bytes say another. The live canvas keeps the
// attribute (it is how a node is named without a second lookup); only the export copy
// loses it. This reads the serialized copy, which is what a file actually contains.
// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { stripCharacterNames } from "../src/utils/canvasExport";

// happy-dom makes import.meta.url an http URL, so the source is read from the project
// root that vitest runs in rather than through a file URL.
const page = readFileSync(join(process.cwd(), "src/pages/RelationshipGraph.tsx"), "utf8");

const drawing = () => {
  const host = document.createElement("div");
  host.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300">
      <g class="relationship-node" data-character-id="c1" data-character-name="沈青梧">
        <circle r="20" />
      </g>
      <g class="relationship-node" data-character-id="c2" data-character-name="陆停云">
        <circle r="20" />
      </g>
      <g class="relationship-node" data-character-id="c3">
        <circle r="20" />
      </g>
    </svg>`;
  return host.querySelector("svg") as SVGSVGElement;
};

const serialize = (svg: SVGSVGElement) => new XMLSerializer().serializeToString(svg);

describe("exporting while names are hidden", () => {
  it("leaves no name behind in the file", () => {
    const live = drawing();
    const clone = live.cloneNode(true) as SVGSVGElement;

    stripCharacterNames(clone);

    const text = serialize(clone);
    expect(text).not.toContain("data-character-name");
    expect(text).not.toContain("沈青梧");
    expect(text).not.toContain("陆停云");
    // Everything else about the node survives: this removes one attribute, not nodes.
    expect(text).toContain('data-character-id="c1"');
    expect(clone.querySelectorAll("g").length).toBe(3);
  });

  it("leaves the live drawing untouched, so the canvas can still name a node", () => {
    const live = drawing();
    const clone = live.cloneNode(true) as SVGSVGElement;

    stripCharacterNames(clone);

    expect(live.querySelectorAll("[data-character-name]").length).toBe(2);
    expect(live.querySelector('[data-character-id="c1"]')?.getAttribute("data-character-name")).toBe("沈青梧");
  });
});

describe("the export copy is the one that gets cleaned", () => {
  it("runs the strip inside buildExportSvg, after the other cleanup steps", () => {
    const start = page.indexOf("function buildExportSvg");
    expect(start).toBeGreaterThan(-1);
    const body = page.slice(start, page.indexOf("return { text", start));

    expect(body).toMatch(/stripCharacterNames\(clone\)/);
    expect(body.indexOf("removeTransientMarks(clone)")).toBeLessThan(body.indexOf("stripCharacterNames(clone)"));
    expect(body).toMatch(/new XMLSerializer\(\)\.serializeToString\(clone\)/);
  });
});
