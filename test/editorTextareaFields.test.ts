// @vitest-environment happy-dom
// The editor's multiline fields are still multiline.
//
// `Textarea` from Mantine wraps a real `<textarea>`, and the difference between it and
// `TextInput` is not cosmetic: Enter, paste of a multi-line block, and every "does this
// field keep its line breaks" rule downstream depend on the element being a textarea.
// A migration that quietly swapped one for the other would type-check, render, and pass
// a screenshot review, so the element type is asserted here rather than assumed.
//
// The labels matter for the same reason: the editor's fields are associated by wrapping
// them in `<label>`, and an accessible name that comes from a `placeholder` alone is not
// the same field for a screen reader.
import "fake-indexeddb/auto";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CharacterForm } from "../src/pages/CharacterForm";
import { MantineRoot } from "../src/ui/MantineRoot";
import type { Character } from "../src/types/character";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NOW = "2026-01-01T00:00:00.000Z";

/** The ten multiline fields, by the label the editor shows above them. */
const MULTILINE_LABELS = [
  "外貌描述",
  "喜好",
  "厌恶",
  "习惯",
  "重要物品",
  "人际关系关键词",
  "能力描述",
  "背景故事",
  "中文人物关键词",
  "英文 AI Prompt",
];

let container: HTMLDivElement | null = null;
let root: Root | null = null;

function makeCharacter(overrides: Partial<Character> = {}): Character {
  return {
    id: "c-1",
    name: "沈青梧",
    species: "人类",
    occupation: "调查员",
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

/** The textarea inside the `<label>` that starts with this text. */
function field(label: string): HTMLTextAreaElement | null {
  const owner = [...document.querySelectorAll("label")].find((element) =>
    element.textContent?.trim().startsWith(label),
  );
  return owner?.querySelector("textarea") ?? null;
}

function setValue(element: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  setter?.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
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

describe("editor multiline fields", () => {
  it("renders ten multi-line fields, each a native textarea", async () => {
    await mountForm(makeCharacter());

    const missing = MULTILINE_LABELS.filter((label) => !field(label));
    expect(missing).toEqual([]);

    const areas = [...document.querySelectorAll(".editor-form textarea")];
    expect(areas).toHaveLength(10);
    // Not one of them is a single-line input wearing a multiline class.
    expect(areas.every((area) => area.tagName === "TEXTAREA")).toBe(true);

    // The single-line fields keep their own element type, so the two never collapse into
    // one class of control by accident.
    const singleLine = [...document.querySelectorAll(".editor-form .mantine-TextInput-input")];
    expect(singleLine.length).toBeGreaterThan(0);
    expect(singleLine.every((input) => input.tagName === "INPUT")).toBe(true);
  });

  it("keeps the accessible name on the wrapping label, not only the placeholder", async () => {
    await mountForm(makeCharacter());

    const area = field("能力描述");
    expect(area).not.toBeNull();
    const owner = area!.closest("label");
    expect(owner).not.toBeNull();
    expect(owner!.textContent).toContain("能力描述");
  });

  it("backfills stored line breaks, including the blank line between paragraphs", async () => {
    const backstory = ["第一段。", "", "第二段。", "第三段。"].join("\n");
    await mountForm(makeCharacter({ backstory, abilityDescription: "一行\n两行" }));

    expect(field("背景故事")!.value).toBe(backstory);
    expect(field("背景故事")!.value.split("\n")).toHaveLength(4);
    expect(field("能力描述")!.value.split("\n")).toHaveLength(2);
  });

  it("accepts a multi-line edit through the form's own state", async () => {
    await mountForm(makeCharacter());
    const typed = ["甲。", "", "乙。"].join("\n");

    await act(async () => {
      setValue(field("背景故事")!, typed);
    });

    // Read back from the DOM after the re-render: a controlled field that ignored the
    // edit would still show the old value here.
    expect(field("背景故事")!.value).toBe(typed);
    expect(field("背景故事")!.value.split("\n")).toHaveLength(3);
  });

  it("grows with its content instead of scrolling inside a fixed box", async () => {
    await mountForm(makeCharacter());
    const area = field("背景故事")!;
    // happy-dom does not lay text out, so scrollHeight is a stub; what this asserts is
    // that the grow handler writes an explicit height at all, which is the behaviour the
    // real browser relies on.
    await act(async () => {
      setValue(area, Array.from({ length: 12 }, (_, i) => `第 ${i + 1} 行`).join("\n"));
    });
    expect(area.style.height).not.toBe("");
  });

  it("keeps Enter available for new lines rather than submitting the form", async () => {
    await mountForm(makeCharacter());
    const area = field("能力描述")!;

    const event = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    area.dispatchEvent(event);

    // Nothing in the editor listens for Enter on these fields, so the default (insert a
    // line break) has to survive: a prevented event here would mean the form consumed it.
    expect(event.defaultPrevented).toBe(false);
  });
});
