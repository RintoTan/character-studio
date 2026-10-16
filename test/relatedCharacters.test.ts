// @vitest-environment happy-dom
// The compact related-character display used by timeline events and world entries.
//
// The property that matters most is the boring one: folding must not lose anyone.
// The list shown is the first few of the stored order, the count is the rest, and
// expanding shows every one of them - not a sample, and not a re-ordering.
import "fake-indexeddb/auto";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RelatedCharacters } from "../src/components/RelatedCharacters";
import type { Character } from "../src/types/character";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function character(id: string, name: string, occupation = "", worldview = ""): Character {
  return {
    id,
    name,
    occupation,
    worldview,
    avatarEmoji: "🙂",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  } as Character;
}

const JOBS = ["调查员", "魔法师", "工匠"];

function crowd(count: number) {
  return Array.from({ length: count }, (_, index) =>
    character(`c-${index + 1}`, `角色${String(index + 1).padStart(2, "0")}`, JOBS[index % 3], "北境"),
  );
}

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

// A character chip carries a face and a context line as well as a name; the count
// chip carries only its label.
function chipNames() {
  return [...container!.querySelectorAll(".related-chip")].map(
    (chip) => chip.querySelector(".character-row-name")?.textContent ?? chip.textContent!.trim(),
  );
}

function listNames() {
  return [...container!.querySelectorAll(".related-characters-list .character-row-name")].map(
    (node) => node.textContent,
  );
}

function click(element: Element | null | undefined) {
  act(() => {
    (element as HTMLElement | null)?.click();
  });
}

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container?.remove();
  root = null;
  container = null;
  vi.restoreAllMocks();
});

beforeEach(() => {
  localStorage.clear();
});

describe("a card with a few related characters", () => {
  it("shows them all, with no count and no way to expand", () => {
    const onOpen = vi.fn();
    render(
      createElement(RelatedCharacters, {
        characters: crowd(3),
        onOpenCharacter: onOpen,
      }),
    );

    expect(chipNames()).toEqual(["角色01", "角色02", "角色03"]);
    expect(container!.textContent).not.toContain("位角色");
    expect(container!.querySelector(".related-characters-head")).toBeNull();
  });

  it("opens the character it names", () => {
    const onOpen = vi.fn();
    render(
      createElement(RelatedCharacters, { characters: crowd(2), onOpenCharacter: onOpen }),
    );

    click(container!.querySelectorAll(".related-chip")[1]);

    expect(onOpen).toHaveBeenCalledWith("c-2");
  });
});

describe("a card with too many to show", () => {
  it("shows the first four of the stored order, then the count", () => {
    render(
      createElement(RelatedCharacters, { characters: crowd(40), onOpenCharacter: () => {} }),
    );

    expect(chipNames()).toEqual(["角色01", "角色02", "角色03", "角色04", "+36 位角色"]);
  });

  it("loses nobody when it expands", () => {
    render(
      createElement(RelatedCharacters, { characters: crowd(40), onOpenCharacter: () => {} }),
    );

    click([...container!.querySelectorAll(".related-chip")].at(-1));

    expect(listNames().length).toBe(40);
    expect(listNames()[0]).toBe("角色01");
    expect(listNames().at(-1)).toBe("角色40");
    expect(container!.textContent).toContain("40 位关联角色");
  });

  it("searches the full list, and keeps the ones a search hides", () => {
    render(
      createElement(RelatedCharacters, { characters: crowd(40), onOpenCharacter: () => {} }),
    );

    click([...container!.querySelectorAll(".related-chip")].at(-1));

    const input = container!.querySelector<HTMLInputElement>(".character-picker-search input")!;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    act(() => {
      setter.call(input, "角色1");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });

    // 角色10 through 角色19; 角色01 does not contain the term, because of its zero.
    expect(listNames().length).toBe(10);
    expect(container!.textContent).toContain("匹配 10");

    // Clearing the term brings every one of them back: nothing was dropped.
    click(container!.querySelector(".character-picker-search button"));
    expect(listNames().length).toBe(40);
  });

  it("searches by occupation as well as name", () => {
    render(
      createElement(RelatedCharacters, { characters: crowd(30), onOpenCharacter: () => {} }),
    );

    click([...container!.querySelectorAll(".related-chip")].at(-1));

    const input = container!.querySelector<HTMLInputElement>(".character-picker-search input")!;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    act(() => {
      setter.call(input, "工匠");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });

    expect(listNames().length).toBe(10);
  });

  it("goes to the character from a row of the full list", () => {
    const onOpen = vi.fn();
    render(
      createElement(RelatedCharacters, { characters: crowd(20), onOpenCharacter: onOpen }),
    );

    click([...container!.querySelectorAll(".related-chip")].at(-1));
    click(container!.querySelectorAll(".related-characters-list .character-picker-option")[7]);

    expect(onOpen).toHaveBeenCalledWith("c-8");
  });

  it("folds back to the chips, dropping the search with it", () => {
    render(
      createElement(RelatedCharacters, { characters: crowd(20), onOpenCharacter: () => {} }),
    );

    click([...container!.querySelectorAll(".related-chip")].at(-1));
    click([...container!.querySelectorAll("button")].find((button) => button.textContent === "收起"));

    expect(chipNames()).toEqual(["角色01", "角色02", "角色03", "角色04", "+16 位角色"]);
    expect(container!.querySelector(".character-picker-search")).toBeNull();
  });
});

describe("a card with nobody attached", () => {
  it("renders nothing at all", () => {
    render(createElement(RelatedCharacters, { characters: [], onOpenCharacter: () => {} }));

    expect(container!.innerHTML).toBe("");
  });
});
