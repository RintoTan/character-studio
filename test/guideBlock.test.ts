// @vitest-environment happy-dom
// The shared guide block: one tip at a time, a loop in both directions, arrows only
// while focus is inside it, and the old collapse key cleared rather than read.
//
// The graph, the timeline and the world manager all use this component now, so these
// are the rules a reader gets on all three pages rather than on whichever page was
// written last.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import GuideBlock, { type GuideTip } from "../src/components/GuideBlock";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const TIPS: GuideTip[] = [
  { icon: "select", title: "第一张", body: "正文一", hint: "提示一" },
  { icon: "fit", title: "第二张", body: "正文二", hint: "提示二" },
  { icon: "layout", title: "第三张", body: "正文三", hint: "提示三" },
  { icon: "sliders", title: "第四张", body: "正文四", hint: "提示四" },
];

let container: HTMLDivElement | null = null;
let root: Root | null = null;

function render(element: React.ReactElement) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(element);
  });
  return container;
}

function title() {
  return container!.querySelector(".graph-guide-card h3")!.textContent;
}

function counter() {
  return container!.querySelector(".graph-guide-count")!.textContent!.replace(/\s+/g, " ").trim();
}

function press(key: string, target?: HTMLElement) {
  const section = container!.querySelector<HTMLElement>(".graph-guide")!;
  act(() => {
    (target ?? section).dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
    );
  });
}

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container?.remove();
  container = null;
  root = null;
  sessionStorage.clear();
});

describe("guide block", () => {
  it("shows one tip at a time, default expanded, with a page counter", () => {
    render(createElement(GuideBlock, { id: "test-guide", tips: TIPS }));

    expect(container!.querySelectorAll(".graph-guide-card").length).toBe(1);
    expect(title()).toContain("第一张");
    expect(counter()).toBe("1 / 4");
    // No collapse entry: the block is the page's, not a window that can be closed.
    expect([...container!.querySelectorAll("button")].map((button) => button.textContent)).not.toContain(
      "收起",
    );
  });

  it("loops 1→2→3→4→1 and back 1→4→3→2→1 without ever disabling a pager", () => {
    render(createElement(GuideBlock, { id: "test-guide", tips: TIPS }));
    const next = container!.querySelector<HTMLButtonElement>('[aria-label="下一张提示"]')!;
    const prev = container!.querySelector<HTMLButtonElement>('[aria-label="上一张提示"]')!;

    const forward: string[] = [];
    for (let step = 0; step < 5; step += 1) {
      forward.push(counter());
      expect(next.disabled).toBe(false);
      expect(prev.disabled).toBe(false);
      act(() => next.click());
    }
    // Four steps, then the fifth wraps past the last tip back to the first.
    expect(forward).toEqual(["1 / 4", "2 / 4", "3 / 4", "4 / 4", "1 / 4"]);
    expect(counter()).toBe("2 / 4");

    const backward: string[] = [];
    for (let step = 0; step < 5; step += 1) {
      backward.push(counter());
      expect(prev.disabled).toBe(false);
      act(() => prev.click());
    }
    // From 2 the way back is 1, and one more step from the first wraps to the last.
    expect(backward).toEqual(["2 / 4", "1 / 4", "4 / 4", "3 / 4", "2 / 4"]);
    expect(counter()).toBe("1 / 4");
  });

  it("answers arrows from inside the block only", () => {
    render(createElement(GuideBlock, { id: "test-guide", tips: TIPS }));

    press("ArrowRight");
    expect(counter()).toBe("2 / 4");

    press("ArrowLeft");
    expect(counter()).toBe("1 / 4");

    // An arrow typed into a field belongs to the field, even when the event bubbles
    // through the block on its way up.
    const input = document.createElement("input");
    container!.querySelector(".graph-guide")!.appendChild(input);
    press("ArrowRight", input);
    expect(counter()).toBe("1 / 4");
  });

  it("clears a legacy collapse key instead of rendering an empty guide", () => {
    sessionStorage.setItem("character-studio.graph-guide", JSON.stringify({ collapsed: true }));
    render(
      createElement(GuideBlock, {
        id: "test-guide",
        tips: TIPS,
        legacyKey: "character-studio.graph-guide",
      }),
    );

    expect(sessionStorage.getItem("character-studio.graph-guide")).toBeNull();
    expect(title()).toContain("第一张");
  });

  it("labels its section with its own heading, so three pages can share the class", () => {
    render(createElement(GuideBlock, { id: "world-guide", title: "世界观指南", tips: TIPS }));

    const section = container!.querySelector(".graph-guide")!;
    expect(section.getAttribute("aria-labelledby")).toBe("world-guide-title");
    expect(section.querySelector("h2")!.textContent).toBe("世界观指南");
  });
});
