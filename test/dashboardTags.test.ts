// @vitest-environment happy-dom
// What a character's own labels look like on a card.
//
// The card reads `personalityTags`, not the `tags` array (that one is the coloured tag
// model used by import/export). A card that shows a name and an occupation but no chips
// is therefore indistinguishable from a card whose character has no labels — which is
// exactly how a missing-tag report reads. These cases pin the distinction: real labels
// are drawn, absent labels draw nothing, and a long list collapses into a counted "+N"
// rather than being clipped by the row.
import "fake-indexeddb/auto";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import App from "../src/App";
import { MantineRoot } from "../src/ui/MantineRoot";
import { saveCharacters } from "../src/storage/characterStorage";
import type { Character } from "../src/types/character";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NOW = "2026-01-01T00:00:00.000Z";

let container: HTMLDivElement | null = null;
let root: Root | null = null;

function character(id: string, name: string, personalityTags: string[]): Character {
  return {
    id,
    name,
    occupation: "调查员",
    worldview: "北境",
    avatarEmoji: "🙂",
    personalityTags,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

async function mountApp(characters: Character[]) {
  saveCharacters(characters);
  localStorage.setItem("character-studio.about-seen", "true");
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(createElement(MantineRoot, null, createElement(App)));
  });
  // The list is read in an effect; one more turn lets it land before assertions.
  await act(async () => {
    await Promise.resolve();
  });
  return container;
}

function cardFor(name: string): HTMLElement {
  const card = Array.from(container!.querySelectorAll<HTMLElement>(".character-card")).find(
    (candidate) => (candidate.querySelector(".card-title-button")?.textContent || "").trim() === name,
  );
  if (!card) {
    throw new Error(`找不到「${name}」的卡片`);
  }
  return card;
}

function chipsOf(name: string): string[] {
  return Array.from(cardFor(name).querySelectorAll(".card-tags button")).map((chip) =>
    (chip.textContent || "").trim(),
  );
}

describe("a card shows the character's own labels", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(async () => {
    if (root) {
      await act(async () => root!.unmount());
    }
    container?.remove();
    container = null;
    root = null;
  });

  it("draws every label of a character that has them", async () => {
    await mountApp([character("c-1", "沈青梧", ["冷静", "寡言", "执拗"])]);
    expect(chipsOf("沈青梧")).toEqual(["冷静", "寡言", "执拗"]);
  });

  it("draws nothing for a character without labels", async () => {
    await mountApp([character("c-2", "白露", [])]);
    const card = cardFor("白露");
    expect(card.querySelectorAll(".card-tags button")).toHaveLength(0);
    expect(card.querySelector(".card-tag-more")).toBeNull();
  });

  it("keeps the card's other metadata when labels are drawn", async () => {
    await mountApp([character("c-3", "青芜", ["向导"])]);
    const card = cardFor("青芜");
    expect((card.querySelector(".card-title-button")?.textContent || "").trim()).toBe("青芜");
    expect(card.querySelector(".card-subtitle-primary")?.textContent || "").toContain("调查员");
    expect(card.querySelector(".card-age-fragment")?.textContent || "").toContain("年龄未知");
  });

  it("collapses a long list into the visible slots plus a counted remainder", async () => {
    await mountApp([
      character("c-4", "陆停云", ["温和", "健忘", "嗜甜", "夜行", "口吃", "怕水", "爱笑", "慢热"]),
    ]);
    const card = cardFor("陆停云");
    const chips = chipsOf("陆停云");
    // The dashboard's default card limit is five; the rest is counted, not clipped.
    expect(chips).toHaveLength(5);
    expect(card.querySelector(".card-tag-more")?.textContent?.trim()).toBe("+3");
    // The count reports what is missing, and the full list is reachable as a title.
    expect(card.querySelector(".card-tag-more")?.getAttribute("title")).toContain("慢热");
  });

  it("keeps a long label intact in the document (truncation is visual only)", async () => {
    const long = "沉默寡言的守夜人，习惯把每一件小事都记在随身的皮面本子上";
    await mountApp([character("c-5", "顾行之", [long])]);
    expect(chipsOf("顾行之")).toEqual([long]);
  });

  it("does not invent labels for a character that has none", async () => {
    await mountApp([
      character("c-6", "沈青梧", ["冷静"]),
      character("c-7", "白露", []),
      character("c-8", "青芜", []),
    ]);
    expect(chipsOf("沈青梧")).toEqual(["冷静"]);
    expect(cardFor("白露").querySelectorAll(".card-tags button")).toHaveLength(0);
    expect(cardFor("青芜").querySelectorAll(".card-tags button")).toHaveLength(0);
  });
});
