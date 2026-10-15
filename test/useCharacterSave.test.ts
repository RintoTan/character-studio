// @vitest-environment happy-dom
// fake-indexeddb gives the real semantics the avatar store relies on, which matters
// here: one of these tests is about a staged avatar actually reaching the store.
import "fake-indexeddb/auto";
import { act, createElement, type FC } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCharacterSave } from "../src/hooks/useCharacterSave";
import { clearAvatarAssets, getAvatarAsset, listAvatarAssets } from "../src/utils/avatarAssets";
import type { Character, CharacterDraft } from "../src/types/character";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Every mount has to come back down. The hook registers a `beforeunload` listener
// on the shared `window`, so a mount left standing keeps answering events in later
// tests -- which is exactly how the "warns on the way out" pair first failed.
const mounted: Array<() => void> = [];

function mountHook<T>(useHook: () => T) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const holder: { current: T } = { current: undefined as unknown as T };

  const Probe: FC = () => {
    holder.current = useHook();
    return null;
  };

  act(() => {
    root.render(createElement(Probe));
  });

  const unmount = () => {
    act(() => {
      root.unmount();
    });
    container.remove();
  };
  mounted.push(unmount);

  return { read: () => holder.current, unmount };
}

const draft = (overrides: Partial<CharacterDraft> = {}): CharacterDraft => ({
  name: "测试角色",
  avatarEmoji: "🙂",
  avatarAssetId: "",
  isDraft: false,
  age: "",
  birthDate: "",
  birthYear: "",
  gender: "",
  species: "",
  occupation: "",
  worldview: "",
  personalityTags: [],
  appearanceDescription: "",
  abilityDescription: "",
  backstory: "",
  likes: "",
  dislikes: "",
  habits: "",
  importantItems: "",
  relationshipKeywords: "",
  visualStyle: "",
  characterKeywords: "",
  imagePrompt: "",
  ...overrides,
});

const storedCharacter = (overrides: Partial<Character> = {}): Character => ({
  ...draft(),
  id: "char-1",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...overrides,
});

type Saved = { saved: Character[]; drafted: Character[]; autosaved: Character[]; toasts: string[]; errors: string[] };

function makeHarness(options: {
  initial: CharacterDraft;
  character?: Character | null;
  pendingAvatar?: { blob: Blob; name: string } | null;
  autoSave?: boolean;
}) {
  const state = {
    formData: options.initial,
    saved: [] as Character[],
    drafted: [] as Character[],
    autosaved: [] as Character[],
    toasts: [] as string[],
    errors: [] as string[],
    clearedAvatars: 0,
  };

  const record: Saved = {
    get saved() {
      return state.saved;
    },
    get drafted() {
      return state.drafted;
    },
    get autosaved() {
      return state.autosaved;
    },
    get toasts() {
      return state.toasts;
    },
    get errors() {
      return state.errors;
    },
  };

  const use = () =>
    useCharacterSave({
      formData: state.formData,
      setFormData: (update) => {
        state.formData =
          typeof update === "function"
            ? (update as (current: CharacterDraft) => CharacterDraft)(state.formData)
            : update;
      },
      character: options.character ?? null,
      pendingAvatar: options.pendingAvatar ?? null,
      clearPendingAvatar: () => {
        state.clearedAvatars += 1;
      },
      showToast: (message) => state.toasts.push(message),
      setFormError: (message) => state.errors.push(message),
      onSave: (character) => state.saved.push(character),
      onDraftSave: (character) => state.drafted.push(character),
      onAutoSave: (character) => state.autosaved.push(character),
      autoSave: options.autoSave ?? true,
    });

  return { state, use, record };
}

describe("saving a character", () => {
  // Deliberately no fake timers here. fake-indexeddb schedules its work on real
  // timers, so faking them makes `saveAvatarBlob` never settle -- and a test that
  // times out mid-`act` leaves the render environment unusable for the tests after
  // it, which is how one mistake turned into ten failures. The autosave group below
  // opts in, and it is the only group that needs to.
  beforeEach(async () => {
    vi.useRealTimers();
    // The asset store is module-global IndexedDB, so it carries over between tests
    // unless it is emptied. "No orphan was left behind" is only a question about
    // this test if the store started empty.
    await clearAvatarAssets();
  });

  afterEach(() => {
    vi.useRealTimers();
    while (mounted.length > 0) {
      mounted.pop()?.();
    }
  });

  describe("refusing to save without a name", () => {
    it("says so once, and writes nothing", async () => {
      const { state, use } = makeHarness({ initial: draft({ name: "   " }) });
      const mounted = mountHook(use);

      await act(async () => {
        await mounted.read().saveCurrentCharacter();
      });

      expect(state.saved).toEqual([]);
      expect(state.errors).toEqual(["请先填写角色名字"]);
      expect(state.toasts).toEqual(["请先填写角色名字"]);
    });
  });

  describe("the saved character", () => {
    it("trims the name and takes the identity from the stored character", async () => {
      const { state, use } = makeHarness({
        initial: draft({ name: "  测试角色  " }),
        character: storedCharacter(),
      });
      const mounted = mountHook(use);

      await act(async () => {
        await mounted.read().saveCurrentCharacter();
      });

      expect(state.saved).toHaveLength(1);
      const saved = state.saved[0];
      expect(saved.name).toBe("测试角色");
      expect(saved.id).toBe("char-1");
      expect(saved.createdAt).toBe("2026-01-01T00:00:00.000Z");
      expect(saved.isDraft).toBe(false);
      // A fresh updatedAt is the point of saving, so it is not the stored one.
      expect(saved.updatedAt).not.toBe("2026-01-01T00:00:00.000Z");
    });

    it("mints an identity for a character that has none yet", async () => {
      const { state, use } = makeHarness({ initial: draft() });
      const mounted = mountHook(use);

      await act(async () => {
        await mounted.read().saveCurrentCharacter();
      });

      expect(state.saved[0].id).toBeTruthy();
      expect(state.saved[0].createdAt).toBeTruthy();
    });

    it("marks a draft as a draft, through the draft path", async () => {
      const { state, use } = makeHarness({ initial: draft() });
      const mounted = mountHook(use);

      await act(async () => {
        await mounted.read().saveDraftCharacter();
      });

      expect(state.drafted).toHaveLength(1);
      expect(state.saved).toHaveLength(0);
      expect(state.drafted[0].isDraft).toBe(true);
    });

    it("falls back to the default emoji rather than saving an empty one", async () => {
      const { state, use } = makeHarness({ initial: draft({ avatarEmoji: "" }) });
      const mounted = mountHook(use);

      await act(async () => {
        await mounted.read().saveCurrentCharacter();
      });

      expect(state.saved[0].avatarEmoji).toBe("🙂");
    });
  });

  describe("a staged avatar", () => {
    it("is written to the asset store and its id becomes the character's", async () => {
      const { state, use } = makeHarness({
        initial: draft(),
        pendingAvatar: { blob: new Blob(["image-bytes"], { type: "image/webp" }), name: "a.png" },
      });
      const mounted = mountHook(use);

      await act(async () => {
        await mounted.read().saveCurrentCharacter();
      });

      const assetId = state.saved[0].avatarAssetId;
      expect(assetId).toBeTruthy();

      // Not just "an id was set": the bytes are really in the store.
      const asset = await getAvatarAsset(assetId!);
      expect(asset).toBeTruthy();
      expect((await listAvatarAssets()).length).toBe(1);
    });

    it("is cleared and written back into the form, so the editor stops holding it", async () => {
      const { state, use } = makeHarness({
        initial: draft(),
        pendingAvatar: { blob: new Blob(["x"], { type: "image/webp" }), name: "a.png" },
      });
      const mounted = mountHook(use);

      await act(async () => {
        await mounted.read().saveCurrentCharacter();
      });

      expect(state.clearedAvatars).toBe(1);
      expect(state.formData.avatarAssetId).toBe(state.saved[0].avatarAssetId);
    });

    it("is not written when the save is refused, so no orphan is left behind", async () => {
      const { state, use } = makeHarness({
        initial: draft({ name: "" }),
        pendingAvatar: { blob: new Blob(["x"], { type: "image/webp" }), name: "a.png" },
      });
      const mounted = mountHook(use);

      await act(async () => {
        await mounted.read().saveCurrentCharacter();
      });

      expect(state.clearedAvatars).toBe(0);
      expect(await listAvatarAssets()).toEqual([]);
    });
  });

  describe("what counts as already saved", () => {
    it("an existing character opens saved, a new one opens idle", () => {
      const withCharacter = makeHarness({ initial: draft(), character: storedCharacter() });
      const mounted = mountHook(withCharacter.use);
      act(() => mounted.read().markLoaded(draft()));
      expect(mounted.read().saveStatus).toBe("saved");

      const withoutCharacter = makeHarness({ initial: draft() });
      const fresh = mountHook(withoutCharacter.use);
      act(() => fresh.read().markLoaded(draft()));
      expect(fresh.read().saveStatus).toBe("idle");
    });

    it("clearing always reads idle, even while a character is open", () => {
      const { use } = makeHarness({ initial: draft(), character: storedCharacter() });
      const mounted = mountHook(use);

      act(() => mounted.read().markCleared(draft()));
      expect(mounted.read().saveStatus).toBe("idle");
    });

    it("does not warn on the way out when nothing changed since the last save", async () => {
      const { use, state } = makeHarness({
        initial: draft({ name: "已保存" }),
        character: storedCharacter(),
      });
      const mounted = mountHook(use);

      act(() => mounted.read().markLoaded(state.formData));

      const event = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(event);

      expect(event.defaultPrevented).toBe(false);
    });

    it("warns on the way out once the form has moved on", () => {
      const { use, state } = makeHarness({ initial: draft({ name: "改过了" }) });
      const mounted = mountHook(use);

      act(() => mounted.read().markLoaded(draft({ name: "原始" })));

      const event = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(event);

      expect(event.defaultPrevented).toBe(true);
    });
  });

  describe("autosave", () => {
    // The only group that needs control over the 900ms debounce.
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("only applies to drafts", async () => {
      const { state, use } = makeHarness({
        initial: draft({ name: "正式角色" }),
        character: storedCharacter({ isDraft: false }),
      });
      const mounted = mountHook(use);

      await act(async () => {
        vi.advanceTimersByTime(1200);
      });

      expect(state.autosaved).toEqual([]);
      expect(mounted.read().saveStatus).toBe("idle");
    });

    it("writes a draft once the edit settles, and says so", async () => {
      const { state, use } = makeHarness({
        initial: draft({ name: "草稿", isDraft: true }),
        character: storedCharacter({ isDraft: true }),
      });
      const mounted = mountHook(use);

      await act(async () => {
        vi.advanceTimersByTime(1200);
      });

      expect(state.autosaved).toHaveLength(1);
      expect(state.autosaved[0].isDraft).toBe(true);
      expect(mounted.read().saveStatus).toBe("saved");
    });

    it("does not write again while nothing has changed", async () => {
      const { state, use } = makeHarness({
        initial: draft({ name: "草稿", isDraft: true }),
        character: storedCharacter({ isDraft: true }),
      });
      const mounted = mountHook(use);

      await act(async () => {
        vi.advanceTimersByTime(1200);
      });
      await act(async () => {
        vi.advanceTimersByTime(1200);
      });

      expect(state.autosaved).toHaveLength(1);
    });

    it("stays out of the way when the author turned it off", async () => {
      const { state, use } = makeHarness({
        initial: draft({ name: "草稿", isDraft: true }),
        character: storedCharacter({ isDraft: true }),
        autoSave: false,
      });
      const mounted = mountHook(use);

      await act(async () => {
        vi.advanceTimersByTime(1200);
      });

      expect(state.autosaved).toEqual([]);
    });
  });
});
