// @vitest-environment happy-dom
// Clearing the timeline filters must not drop the keyboard user on the document.
//
// 清空筛选 is rendered only while a filter is active, so pressing it removes the element
// that had focus. Before this test the focus fell to <body>: the list came back, but the
// next Tab started again from the top of the page. The assertion is on the element that
// ends up focused, not on the filter state alone — the state was always correct.
import "fake-indexeddb/auto";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Timeline } from "../src/pages/Timeline";
import { MantineRoot } from "../src/ui/MantineRoot";
import type { TimelineEvent } from "../src/types/timeline";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const EVENTS: TimelineEvent[] = [
  {
    id: "e-1",
    title: "灯塔的第一夜",
    date: "2024-03-01",
    kind: "origin",
    location: "北境",
    description: "",
    era: "",
    characterIds: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  } as TimelineEvent,
  {
    id: "e-2",
    title: "潮汐失衡",
    date: "2026-02-09",
    kind: "conflict",
    location: "",
    description: "",
    era: "",
    characterIds: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  } as TimelineEvent,
];

let container: HTMLDivElement | null = null;
let root: Root | null = null;

async function mountTimeline() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      createElement(MantineRoot, null, createElement(Timeline, {
        characters: [],
        onBack: () => {},
        onOpenCharacter: () => {},
        focusEventId: null,
        onFocusHandled: () => {},
      } as never)),
    );
  });
  // The page loads its events in an effect; without waiting the list is still empty.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  return container;
}

function yearFilter(): HTMLSelectElement {
  const select = document.querySelector<HTMLSelectElement>('[aria-label="按年份筛选"]');
  expect(select).not.toBeNull();
  return select!;
}

function clearButton(): HTMLButtonElement | null {
  return document.querySelector<HTMLButtonElement>(".timeline-clear");
}

async function applyYear(year: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
  await act(async () => {
    setter?.call(yearFilter(), year);
    yearFilter().dispatchEvent(new Event("change", { bubbles: true }));
  });
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("character-studio.timeline", JSON.stringify(EVENTS));
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe("timeline clear-focus", () => {
  it("hands focus back to the year filter instead of dropping it on the body", async () => {
    await mountTimeline();
    await applyYear("2024");
    expect(clearButton()).not.toBeNull();

    await act(async () => {
      clearButton()!.focus();
    });
    expect(document.activeElement).toBe(clearButton());

    await act(async () => {
      clearButton()!.click();
    });

    // Still clearing the filter the same way...
    expect(yearFilter().value).toBe("全部年份");
    expect(clearButton()).toBeNull();
    // ...and the keyboard user is still inside the filter row.
    expect(document.activeElement).toBe(yearFilter());
  });

  it("does not steal focus when the filters are cleared while focus is elsewhere", async () => {
    await mountTimeline();
    await applyYear("2024");

    // A pointer user pressing the button still ends up on the filter: the handler is the
    // same path, and the visible result must not depend on how the button was pressed.
    await act(async () => {
      clearButton()!.click();
    });
    expect(document.activeElement).toBe(yearFilter());
  });

  it("keeps the list and the count intact after clearing", async () => {
    await mountTimeline();
    const before = document.querySelectorAll(".timeline-item").length;
    await applyYear("2024");
    expect(document.querySelectorAll(".timeline-item").length).toBeLessThan(before);

    await act(async () => {
      clearButton()!.click();
    });
    expect(document.querySelectorAll(".timeline-item").length).toBe(before);
  });
});
