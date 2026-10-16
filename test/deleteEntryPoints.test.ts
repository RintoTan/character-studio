// @vitest-environment happy-dom
// The three delete entry points, driven through the real app.
//
// deleteRecovery.test.ts proves the data rules; this file proves the app actually
// reaches them. It renders the app itself rather than a stub, because the bug KI-17
// describes was not in the recovery - there was no recovery - but in three separate
// call sites that each did their own thing.
//
// The same three flows are run against the deployed build in a real browser by
// scripts/verify-browser.mjs, which is not part of CI. This is the copy CI can run.
import "fake-indexeddb/auto";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../src/App";
import { DELETE_RECOVERY_KEY } from "../src/storage/deleteRecovery";
import { loadCharacters } from "../src/storage/characterStorage";
import { loadRelationships } from "../src/storage/relationshipStorage";
import { loadTimeline } from "../src/storage/timelineStorage";
import { loadWorldEntries } from "../src/storage/worldStorage";

// React 18 wants this before `act` is used outside a test-framework integration, and
// the project deliberately carries no @testing-library dependency.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NOW = "2026-01-01T00:00:00.000Z";

let container: HTMLDivElement | null = null;
let root: Root | null = null;

async function mountApp() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(createElement(App));
  });
  return container;
}

async function click(element: Element | null | undefined, what: string) {
  if (!element) {
    throw new Error(`找不到${what}`);
  }
  await act(async () => {
    (element as HTMLElement).click();
  });
}

function buttonByLabel(label: string) {
  return Array.from(container!.querySelectorAll("button")).find(
    (item) => (item.textContent || "").trim() === label,
  );
}

function dialogButton(label: string) {
  const dialog = container!.querySelector(".confirm-dialog");
  if (!dialog) {
    throw new Error("确认弹窗没有打开");
  }
  return Array.from(dialog.querySelectorAll("button")).find(
    (item) => (item.textContent || "").trim() === label,
  );
}

const undoButton = () => container!.querySelector("[data-undo-delete='true']");

function seed() {
  localStorage.setItem(
    "character-studio.characters",
    JSON.stringify([
      { id: "c1", name: "沈青梧", createdAt: NOW, updatedAt: NOW },
      { id: "c2", name: "陆停云", createdAt: NOW, updatedAt: NOW },
    ]),
  );
  localStorage.setItem(
    "character-studio.relationships",
    JSON.stringify([{ id: "rel-1", fromId: "c1", toId: "c2", kind: "friend", createdAt: NOW, updatedAt: NOW }]),
  );
  localStorage.setItem(
    "character-studio.timeline",
    JSON.stringify([
      {
        id: "tl-1",
        title: "初次相遇",
        date: "2026-01-01",
        kind: "origin",
        characterIds: ["c1", "c2"],
        createdAt: NOW,
        updatedAt: NOW,
      },
    ]),
  );
  localStorage.setItem(
    "character-studio.world",
    JSON.stringify([
      {
        id: "w-1",
        name: "雾海纪",
        category: "location",
        characterIds: ["c1", "c2"],
        createdAt: NOW,
        updatedAt: NOW,
      },
    ]),
  );
  localStorage.setItem("character-studio.about-seen", "true");
}

const ids = () => loadCharacters().map((character) => character.id);

afterEach(async () => {
  vi.restoreAllMocks();
  if (root) {
    await act(async () => {
      root!.unmount();
    });
  }
  container?.remove();
  container = null;
  root = null;
});

beforeEach(() => {
  localStorage.clear();
  seed();
});

describe("deleting from the dashboard", () => {
  it("takes a recovery copy, and the undo puts the character and its references back", async () => {
    await mountApp();

    await click(container!.querySelector('button[aria-label="更多"]'), "卡片菜单");
    await click(buttonByLabel("删除"), "菜单里的删除");
    await click(dialogButton("确认删除"), "确认删除");

    // The delete happened: the character is gone and so is everything pointing at it.
    expect(ids()).toHaveLength(1);
    expect(loadRelationships()).toEqual([]);
    expect(loadTimeline()[0].characterIds).toHaveLength(1);
    expect(loadWorldEntries()[0].characterIds).toHaveLength(1);
    // ...and there is something to undo it with, which is what the KI-17 fix added.
    expect(localStorage.getItem(DELETE_RECOVERY_KEY)).not.toBeNull();
    expect(undoButton()).not.toBeNull();

    await click(undoButton(), "撤销按钮");

    expect(ids().sort()).toEqual(["c1", "c2"]);
    expect(loadRelationships().map((relationship) => relationship.id)).toEqual(["rel-1"]);
    expect(loadTimeline()[0].characterIds.sort()).toEqual(["c1", "c2"]);
    expect(loadWorldEntries()[0].characterIds.sort()).toEqual(["c1", "c2"]);
    // The record is spent, so the same undo cannot be replayed onto other data.
    expect(localStorage.getItem(DELETE_RECOVERY_KEY)).toBeNull();
    expect(undoButton()).toBeNull();
  });

  it("refuses the delete when the recovery copy cannot be written", async () => {
    const original = localStorage.setItem.bind(localStorage);
    const refusal = vi
      .spyOn(localStorage, "setItem")
      .mockImplementation((key: string, value: string) => {
        if (String(key) === DELETE_RECOVERY_KEY) {
          const error = new Error("storage refused the write");
          error.name = "QuotaExceededError";
          throw error;
        }
        original(key, value);
      });

    await mountApp();

    await click(container!.querySelector('button[aria-label="更多"]'), "卡片菜单");
    await click(buttonByLabel("删除"), "菜单里的删除");
    await click(dialogButton("确认删除"), "确认删除");

    expect(refusal).toHaveBeenCalled();
    // Nothing was deleted, so nothing needs recovering - and the author is told why
    // rather than being left to notice later that the character is still there.
    expect(ids().sort()).toEqual(["c1", "c2"]);
    expect(loadRelationships().map((relationship) => relationship.id)).toEqual(["rel-1"]);
    expect(undoButton()).toBeNull();
    expect(container!.querySelector(".toast")?.textContent).toContain("删除已取消");
  });
});

describe("deleting a selection from the dashboard", () => {
  it("covers every selected character and the undo brings all of them back", async () => {
    await mountApp();

    await click(buttonByLabel("批量选择"), "批量选择");
    await click(buttonByLabel("全选"), "全选");
    await click(buttonByLabel("批量删除"), "批量删除");
    await click(dialogButton("确认删除"), "确认删除");

    expect(ids()).toEqual([]);
    expect(loadRelationships()).toEqual([]);
    expect(loadTimeline()[0].characterIds).toEqual([]);
    expect(loadWorldEntries()[0].characterIds).toEqual([]);
    expect(undoButton()).not.toBeNull();

    await click(undoButton(), "撤销按钮");

    expect(ids().sort()).toEqual(["c1", "c2"]);
    expect(loadRelationships().map((relationship) => relationship.id)).toEqual(["rel-1"]);
    expect(loadTimeline()[0].characterIds.sort()).toEqual(["c1", "c2"]);
    expect(loadWorldEntries()[0].characterIds.sort()).toEqual(["c1", "c2"]);
  });
});
