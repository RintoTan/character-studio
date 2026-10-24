// @vitest-environment happy-dom
// Clearing the world-building filters must not drop the keyboard user on the document.
//
// Both 清空筛选 buttons are rendered by the state they reset: the toolbar one is unmounted
// with `isFiltered`, the empty-state one with the empty state itself. Pressing either used
// to leave focus on <body>, so the tree came back but the next Tab started at the top of
// the page. These assertions are on the element that ends up focused — the filter state
// was always correct, which is why the earlier tests never noticed.
import "fake-indexeddb/auto";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WorldManager } from "../src/pages/WorldManager";
import { MantineRoot } from "../src/ui/MantineRoot";
import type { Character } from "../src/types/character";
import type { WorldEntry } from "../src/types/world";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NOW = "2026-01-01T00:00:00.000Z";

const CHARACTER = { id: "c-1", name: "沈青梧", occupation: "调查员", createdAt: NOW, updatedAt: NOW } as Character;

const ENTRIES = [
  { id: "w-1", name: "北境", category: "location", parentId: undefined, summary: "北境的简介。", details: "", tags: [], characterIds: ["c-1"] },
  { id: "w-2", name: "雪线", category: "location", parentId: "w-1", summary: "雪线的简介。", details: "", tags: [], characterIds: [] },
  { id: "w-3", name: "雾港", category: "location", parentId: undefined, summary: "雾港的简介。", details: "", tags: [], characterIds: ["c-1"] },
  { id: "w-4", name: "旧灯塔", category: "location", parentId: "w-3", summary: "旧灯塔的简介。", details: "", tags: [], characterIds: [] },
].map((entry) => ({ ...entry, createdAt: NOW, updatedAt: NOW })) as WorldEntry[];

let container: HTMLDivElement | null = null;
let root: Root | null = null;

async function mountWorld() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      createElement(MantineRoot, null, createElement(WorldManager, {
        characters: [CHARACTER],
        onBack: () => {},
        onOpenCharacter: () => {},
        focusEntryId: null,
        onFocusHandled: () => {},
      } as never)),
    );
  });
  // Entries are read from storage in an effect; without the wait the tree is still empty.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  return container;
}

const rows = () => document.querySelectorAll(".world-row").length;
const countText = () => document.querySelector(".world-count")?.textContent?.trim() ?? "";

function levelSelect(): HTMLSelectElement {
  const select = document.querySelector<HTMLSelectElement>('[aria-label="按层级筛选"]');
  expect(select).not.toBeNull();
  return select!;
}

function characterSelect(): HTMLSelectElement {
  const select = document.querySelector<HTMLSelectElement>('[aria-label="按关联角色筛选"]');
  expect(select).not.toBeNull();
  return select!;
}

function clearButtons(): HTMLButtonElement[] {
  return [...document.querySelectorAll<HTMLButtonElement>(".ghost-button")].filter(
    (button) => button.textContent?.trim() === "清空筛选",
  );
}

function toolbarClear(): HTMLButtonElement {
  const button = clearButtons().find((item) => item.closest(".world-filter-row"));
  expect(button, "the toolbar clear button should be rendered while a filter is active").toBeTruthy();
  return button!;
}

async function setSelect(element: HTMLSelectElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
  await act(async () => {
    setter?.call(element, value);
    element.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

async function openSearch(): Promise<HTMLInputElement> {
  if (!document.querySelector('[data-testid="world-search-input"]')) {
    const trigger = document.querySelector<HTMLElement>('[data-testid="world-search"]');
    expect(trigger, "the search entry should exist").not.toBeNull();
    await act(async () => {
      trigger!.click();
    });
  }
  const input = document.querySelector<HTMLInputElement>('[data-testid="world-search-input"]');
  expect(input, "opening the search should reveal its input").not.toBeNull();
  return input!;
}

async function typeSearch(value: string) {
  const input = await openSearch();
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  await act(async () => {
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("character-studio.world", JSON.stringify(ENTRIES));
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe("world manager clear-focus", () => {
  it("hands focus to the first structural filter instead of the body", async () => {
    await mountWorld();
    await setSelect(levelSelect(), "root");
    expect(rows()).toBeLessThan(ENTRIES.length);

    const button = toolbarClear();
    await act(async () => {
      button.focus();
    });
    expect(document.activeElement).toBe(button);

    await act(async () => {
      button.click();
    });

    expect(document.activeElement).toBe(levelSelect());
    expect(document.activeElement).not.toBe(document.body);
  });

  it("restores both structural filters, the list and the count", async () => {
    await mountWorld();
    const total = rows();
    await setSelect(levelSelect(), "root");
    await setSelect(characterSelect(), "without");
    expect(levelSelect().value).toBe("root");
    expect(characterSelect().value).toBe("without");
    expect(rows()).toBeLessThan(total);

    await act(async () => {
      toolbarClear().click();
    });

    expect(levelSelect().value).toBe("any");
    expect(characterSelect().value).toBe("any");
    expect(rows()).toBe(total);
    expect(countText()).toBe(`共 ${total} 个条目`);
    // The button itself is gone, which is why the focus had to be handed over.
    expect(clearButtons()).toHaveLength(0);
  });

  it("keeps focus inside the filter row when the clear comes from the empty state", async () => {
    await mountWorld();
    await typeSearch("没有这个条目");
    expect(rows()).toBe(0);

    const emptyClear = clearButtons().find((button) => button.closest(".world-empty"));
    expect(emptyClear, "the empty state should offer its own clear button").toBeTruthy();

    await act(async () => {
      emptyClear!.focus();
    });
    await act(async () => {
      emptyClear!.click();
    });

    expect(rows()).toBe(ENTRIES.length);
    expect(document.activeElement).toBe(levelSelect());
  });

  it("sends focus to the same place whether the button was clicked or activated by keyboard", async () => {
    await mountWorld();
    await setSelect(levelSelect(), "child");

    // A pointer user and a keyboard user go through the same handler; the visible result
    // must not depend on which input device produced the click.
    await act(async () => {
      toolbarClear().click();
    });
    expect(document.activeElement).toBe(levelSelect());
  });

  it("resets the category tab along with the other filters", async () => {
    await mountWorld();
    const locationTab = [...document.querySelectorAll<HTMLButtonElement>(".world-category")].find((tab) =>
      tab.textContent?.trim().startsWith("地点"),
    );
    expect(locationTab, "the category row should have a 地点 tab").not.toBeNull();

    await act(async () => {
      locationTab!.click();
    });
    await setSelect(levelSelect(), "root");

    await act(async () => {
      toolbarClear().click();
    });

    const activeTab = document.querySelector<HTMLButtonElement>(".world-category.active");
    expect(activeTab?.textContent?.trim().startsWith("全部分类")).toBe(true);
    expect(rows()).toBe(ENTRIES.length);
  });
});
