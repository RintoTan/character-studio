// @vitest-environment happy-dom
// The character picker and the single-select that share its list.
//
// What matters here is the behaviour a reader notices: the list not moving under
// their cursor when they tick something, the search answering on the three fields a
// writer searches by, the keyboard working, and the single-select saving exactly the
// character that was chosen.
import "fake-indexeddb/auto";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CharacterPicker, CharacterSelect } from "../src/components/CharacterPicker";
import type { Character } from "../src/types/character";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function character(
  id: string,
  name: string,
  occupation: string,
  worldview: string,
): Character {
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
const WORLDS = ["北境", "云海", "雾隐"];

/** Enough characters that the picker's own toolbar appears (threshold is 12). */
function manyCharacters(count = 15) {
  return Array.from({ length: count }, (_, index) =>
    character(
      `c-${index + 1}`,
      `角色${String(index + 1).padStart(2, "0")}`,
      JOBS[index % JOBS.length],
      WORLDS[index % WORLDS.length],
    ),
  );
}

/** A picker whose parent actually applies the choice - which is what the real
 * callers do, and the only way a reordering bug can show up at all: with a no-op
 * onChange the list is frozen by definition and the test proves nothing. */
function MultiHarness({ characters }: { characters: Character[] }) {
  const [selected, setSelected] = useState<string[]>([]);
  return createElement(CharacterPicker, {
    characters,
    legend: "涉及角色",
    onChange: setSelected,
    selectedIds: selected,
  });
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

function rows() {
  return [...container!.querySelectorAll<HTMLElement>(".character-picker-list label, .character-picker-list .character-picker-option")];
}

function rowNames() {
  return rows().map((row) => row.querySelector(".character-row-name")!.textContent);
}

function searchInput() {
  return container!.querySelector<HTMLInputElement>(".character-picker-search input")!;
}

function type(value: string) {
  const input = searchInput();
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function press(key: string) {
  act(() => {
    searchInput().dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  });
}

function click(element: Element | null | undefined) {
  act(() => {
    (element as HTMLElement).click();
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

describe("the picker's list", () => {
  it("keeps its order when a character is chosen", () => {
    // Chosen-first ordering used to move the row that was just ticked to the top, so
    // the list shifted under the cursor and the next click landed elsewhere.
    const characters = manyCharacters();
    const view = render(createElement(MultiHarness, { characters }));
    const before = rowNames();
    expect(before[0]).toBe("角色01");

    const eighth = view.querySelectorAll<HTMLInputElement>(".character-picker-list input")[7];
    click(eighth);

    // The choice landed...
    expect(view.querySelectorAll<HTMLInputElement>(".character-picker-list input")[7].checked).toBe(true);
    expect(view.textContent).toContain("已选 1");
    // ...and nothing moved.
    expect(rowNames()).toEqual(before);
  });

  it("reports the choice it was given, and keeps the row where it is", () => {
    const characters = manyCharacters();
    const view = render(createElement(MultiHarness, { characters }));
    const before = rowNames();
    const third = view.querySelectorAll<HTMLInputElement>(".character-picker-list input")[2];

    click(third);

    expect(rowNames()).toEqual(before);
    expect(view.textContent).toContain("已选 1");

    // Unchoosing it puts the count back and still moves nothing.
    click(view.querySelectorAll<HTMLInputElement>(".character-picker-list input")[2]);
    expect(rowNames()).toEqual(before);
    expect(view.textContent).toContain("已选 0");
  });

  it("searches by name, occupation and worldview", () => {
    const characters = manyCharacters(20);
    render(
      createElement(CharacterPicker, {
        characters,
        legend: "涉及角色",
        onChange: () => {},
        selectedIds: [],
      }),
    );

    type("角色07");
    expect(rowNames()).toEqual(["角色07"]);

    type("魔法师");
    const byOccupation = rows().length;
    expect(byOccupation).toBeGreaterThan(1);
    expect(rowNames().every((name) => name!.startsWith("角色"))).toBe(true);

    type("雾隐");
    const byWorldview = rowNames().length;
    expect(byWorldview).toBe(characters.filter((item) => item.worldview === "雾隐").length);

    type("不存在的角色");
    expect(rows().length).toBe(0);
    expect(container!.textContent).toContain("没有匹配的角色");
  });

  it("keeps the search term while a character is chosen from the results", () => {
    const characters = manyCharacters(20);
    render(createElement(MultiHarness, { characters }));

    type("调查员");
    const matched = rowNames();
    // The third match, so a reorder would be visible rather than already in place.
    const third = container!.querySelectorAll<HTMLInputElement>(".character-picker-list input")[2];

    click(third);

    expect(searchInput().value).toBe("调查员");
    expect(rowNames()).toEqual(matched);
    expect(container!.querySelectorAll<HTMLInputElement>(".character-picker-list input")[2].checked).toBe(true);
  });

  it("toggles the highlighted row with the arrow keys and Enter", () => {
    const characters = manyCharacters(15);
    const onChange = vi.fn();
    render(
      createElement(CharacterPicker, {
        characters,
        legend: "涉及角色",
        onChange,
        selectedIds: [],
      }),
    );

    press("ArrowDown");
    press("ArrowDown");
    press("Enter");

    expect(onChange).toHaveBeenCalledWith(["c-3"]);

    // ...and it clamps at the top rather than wrapping into the last row.
    press("ArrowUp");
    press("ArrowUp");
    press("ArrowUp");
    press("Enter");
    expect(onChange).toHaveBeenLastCalledWith(["c-1"]);
  });

  it("narrows to the chosen ones without losing the search term", () => {
    const characters = manyCharacters(20);
    render(
      createElement(CharacterPicker, {
        characters,
        legend: "涉及角色",
        onChange: () => {},
        selectedIds: ["c-1", "c-4"],
      }),
    );

    const filter = [...container!.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent === "只看已选",
    );
    click(filter);

    expect(rowNames()).toEqual(["角色01", "角色04"]);
    expect(filter!.getAttribute("aria-pressed")).toBe("true");
  });
});

describe("the single-select", () => {
  it("picks with the keyboard and shows what is chosen", () => {
    const characters = manyCharacters(15);
    const onChange = vi.fn();
    render(
      createElement(CharacterSelect, {
        characters,
        legend: "角色 A",
        onChange,
        value: "",
      }),
    );

    // Collapsed until asked: one trigger, no list.
    expect(rows().length).toBe(0);
    click(container!.querySelector(".character-select-trigger"));

    type("角色12");
    press("Enter");

    expect(onChange).toHaveBeenCalledWith("c-12");
    // Choosing closes the list again, so two of these still fit in a dialog.
    expect(rows().length).toBe(0);
  });

  it("finds one character among a hundred", () => {
    const characters = manyCharacters(100);
    const onChange = vi.fn();
    render(
      createElement(CharacterSelect, {
        characters,
        legend: "角色 B",
        onChange,
        value: "",
      }),
    );

    click(container!.querySelector(".character-select-trigger"));
    type("北境");

    const matched = characters.filter((item) => item.worldview === "北境").length;
    expect(rows().length).toBe(matched);

    type("角色99");
    expect(rowNames()).toEqual(["角色99"]);
    press("Enter");
    expect(onChange).toHaveBeenCalledWith("c-99");
  });

  it("closes on Escape without changing the choice", () => {
    const characters = manyCharacters(15);
    const onChange = vi.fn();
    render(
      createElement(CharacterSelect, {
        characters,
        legend: "角色 A",
        onChange,
        value: "c-2",
      }),
    );

    click(container!.querySelector(".character-select-trigger"));
    expect(rows().length).toBeGreaterThan(0);
    expect(container!.textContent).toContain("角色02");

    press("Escape");

    expect(onChange).not.toHaveBeenCalled();
    expect(rows().length).toBe(0);
    // The trigger still shows the character it had.
    expect(container!.textContent).toContain("角色02");
  });

  it("marks the current choice in the list", () => {
    const characters = manyCharacters(15);
    render(
      createElement(CharacterSelect, {
        characters,
        legend: "角色 A",
        onChange: () => {},
        value: "c-2",
      }),
    );

    click(container!.querySelector(".character-select-trigger"));

    const selected = rows().filter((row) => row.getAttribute("aria-selected") === "true");
    expect(selected.length).toBe(1);
    expect(selected[0].textContent).toContain("角色02");
  });
});
