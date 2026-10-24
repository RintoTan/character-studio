// @vitest-environment happy-dom
// The editor's four selects are comboboxes now, and three things about that are easy to
// lose silently: the option list itself, the conditional 自定义性别 field, and the preset
// selectors that only *fill* a text field rather than becoming its value.
//
// None of the four was covered by the browser suite before this change (that suite drives
// the timeline and world filters, which are still native `<select>`), so these assertions
// are the only automated record of their behaviour.
import "fake-indexeddb/auto";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CharacterForm } from "../src/pages/CharacterForm";
import { MantineRoot } from "../src/ui/MantineRoot";
import type { Character } from "../src/types/character";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NOW = "2026-01-01T00:00:00.000Z";

let container: HTMLDivElement | null = null;
let root: Root | null = null;

function makeCharacter(overrides: Partial<Character> = {}): Character {
  return {
    id: "c-1",
    name: "沈青梧",
    species: "人类",
    occupation: "调查员",
    gender: "女",
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  } as Character;
}

async function mountForm(character: Character) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      createElement(
        MantineRoot,
        null,
        createElement(CharacterForm, {
          character,
          onSave: () => {},
          onDraftSave: () => {},
          onDelete: () => {},
          onRequestDashboardFilterReset: () => {},
          onCancel: () => {},
          onAutoSave: () => {},
        } as never),
      ),
    );
  });
  return container;
}

/** The combobox input of the editor field whose label starts with this text. */
function combo(label: string): HTMLInputElement | null {
  return (
    [...document.querySelectorAll<HTMLInputElement>(".editor-form .mantine-Select-input")].find((input) =>
      input.closest("label")?.textContent?.trim().startsWith(label),
    ) ?? null
  );
}

function comboByAria(aria: string): HTMLInputElement | null {
  return document.querySelector<HTMLInputElement>(`.editor-form [aria-label="${aria}"]`);
}

/**
 * The options the select would show.
 *
 * The dropdown is mounted on open, not before, so the list is read after clicking the
 * field the way a mouse would. Reading it without opening returns an empty array, which
 * would make every "the options are still there" assertion pass for the wrong reason.
 */
async function optionsOf(input: HTMLInputElement | null): Promise<string[]> {
  if (!input) return [];
  await act(async () => {
    input.click();
  });
  return [...openList(input).querySelectorAll<HTMLElement>('[role="option"]')].map(
    (option) => option.textContent?.trim() ?? "",
  );
}

/** The dropdown belonging to this select, found through the id it advertises while open. */
function openList(input: HTMLInputElement): Element {
  const id = input.getAttribute("aria-controls");
  const list = id ? document.getElementById(id) : null;
  expect(list, "the open select should point at its listbox").not.toBeNull();
  return list!;
}

async function chooseOption(input: HTMLInputElement | null, label: string) {
  expect(input, "the select should exist").not.toBeNull();
  // Clicking again would close a list that is already open; the toggle is per click.
  if (!input!.getAttribute("aria-controls")) {
    await act(async () => {
      input!.click();
    });
  }
  const option = [...openList(input!).querySelectorAll<HTMLElement>('[role="option"]')].find(
    (item) => item.textContent?.trim() === label,
  );
  expect(option, `option ${label} should exist`).toBeTruthy();
  await act(async () => {
    option!.click();
  });
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe("editor selects", () => {
  it("renders four comboboxes and no native select in the form", async () => {
    await mountForm(makeCharacter());

    const comboboxes = [...document.querySelectorAll(".editor-form .mantine-Select-input")];
    expect(comboboxes).toHaveLength(4);
    expect(document.querySelectorAll(".editor-form select")).toHaveLength(0);

    // The four are the identity picker, the two preset pickers and the section jump.
    expect(combo("性别")).not.toBeNull();
    expect(comboByAria("选择预设世界观")).not.toBeNull();
    expect(comboByAria("选择预设视觉风格")).not.toBeNull();
    expect(comboByAria("跳转到分节")).not.toBeNull();
  });

  it("offers the gender options in their original order, empty entry included", async () => {
    await mountForm(makeCharacter());

    const input = combo("性别");
    expect(input?.value).toBe("女");
    expect(await optionsOf(input)).toEqual(["请选择性别", "男", "女", "非二元", "其他", "自定义"]);
  });

  it("writes the chosen gender and reveals the custom field only for 自定义", async () => {
    await mountForm(makeCharacter());

    await chooseOption(combo("性别"), "非二元");
    expect(combo("性别")?.value).toBe("非二元");
    expect(document.querySelector('[placeholder="输入自定义性别"]')).toBeNull();

    await chooseOption(combo("性别"), "自定义");
    expect(combo("性别")?.value).toBe("自定义");
    const custom = document.querySelector<HTMLInputElement>('[placeholder="输入自定义性别"]');
    expect(custom).not.toBeNull();

    // The typed value becomes the stored gender; switching away clears the field but not
    // the ability to come back to a list value.
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(custom!, "性别流动");
      custom!.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(document.querySelector<HTMLInputElement>('[placeholder="输入自定义性别"]')?.value).toBe("性别流动");

    await chooseOption(combo("性别"), "男");
    expect(combo("性别")?.value).toBe("男");
    expect(document.querySelector('[placeholder="输入自定义性别"]')).toBeNull();
  });

  it("keeps the empty gender entry selectable, so a value can still be cleared", async () => {
    await mountForm(makeCharacter({ gender: "女" }));

    await chooseOption(combo("性别"), "请选择性别");
    expect(combo("性别")?.value).toBe("请选择性别");
  });

  it("fills the worldview text field from the preset list without becoming its value", async () => {
    await mountForm(makeCharacter({ worldview: "北境" }));
    const preset = comboByAria("选择预设世界观");

    expect(await optionsOf(preset)).toEqual([
      "选择预设",
      "现代都市",
      "奇幻",
      "赛博朋克",
      "废土",
      "校园",
      "异世界",
      "克苏鲁",
      "后室风",
    ]);

    await chooseOption(preset, "奇幻");

    const text = document.querySelector<HTMLInputElement>('[aria-label="世界观，可直接输入自定义名称"]');
    expect(text?.value).toBe("奇幻");
    // The selector itself stays on its placeholder: it is an action, not the stored value.
    expect(comboByAria("选择预设世界观")?.value).toBe("选择预设");
  });

  it("leaves a hand-typed worldview alone when the preset list is only opened", async () => {
    await mountForm(makeCharacter({ worldview: "" }));
    const text = document.querySelector<HTMLInputElement>('[aria-label="世界观，可直接输入自定义名称"]')!;

    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(text, "自己写的世界");
      text.dispatchEvent(new Event("input", { bubbles: true }));
    });

    expect(text.value).toBe("自己写的世界");
    expect(comboByAria("选择预设世界观")?.value).toBe("选择预设");
  });

  it("fills the visual style field from its own preset list", async () => {
    await mountForm(makeCharacter({ visualStyle: "" }));

    await chooseOption(comboByAria("选择预设视觉风格"), "像素风");

    expect(document.querySelector<HTMLInputElement>('[aria-label="视觉风格，可直接输入自定义名称"]')?.value).toBe("像素风");
    expect(comboByAria("选择预设视觉风格")?.value).toBe("选择预设");
  });
});
