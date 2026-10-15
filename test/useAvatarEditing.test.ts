// @vitest-environment happy-dom
import { act, createElement, type FC } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RECENT_AVATAR_KEY } from "../src/storage/recentAvatars";
import { useAvatarEditing } from "../src/hooks/useAvatarEditing";

// React 18 wants this before `act` is used outside a test-framework integration,
// and the project deliberately carries no @testing-library dependency.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

  return {
    read: () => holder.current,
    unmount: () => {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
}

type Harness = {
  emoji: string;
  assetId: string;
  toasts: string[];
  beforeOpenAssetLibrary: number;
};

function makeHarness() {
  const state: Harness = { emoji: "🙂", assetId: "", toasts: [], beforeOpenAssetLibrary: 0 };
  const use = () =>
    useAvatarEditing({
      onEmojiChange: (next) => {
        state.emoji = next;
      },
      onAssetIdChange: (next) => {
        state.assetId = next;
      },
      showToast: (message) => {
        state.toasts.push(message);
      },
      onBeforeOpenAssetLibrary: () => {
        state.beforeOpenAssetLibrary += 1;
      },
    });
  return { state, use };
}

describe("avatar editing", () => {
  let createdUrls: string[];
  let revokedUrls: string[];

  beforeEach(() => {
    localStorage.clear();
    createdUrls = [];
    revokedUrls = [];
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: (blob: Blob) => {
        const url = `blob:test-${createdUrls.length}-${(blob as Blob).size ?? 0}`;
        createdUrls.push(url);
        return url;
      },
      revokeObjectURL: (url: string) => {
        revokedUrls.push(url);
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("starts closed, with nothing staged and no crop in progress", () => {
    const { use } = makeHarness();
    const hook = mountHook(use).read();

    expect(hook.isAvatarPickerOpen).toBe(false);
    expect(hook.isAvatarImageMenuOpen).toBe(false);
    expect(hook.isAssetLibraryOpen).toBe(false);
    expect(hook.pendingAvatar).toBeNull();
    expect(hook.cropDraft).toBeNull();
    expect(hook.activeAvatarCategoryId).toBe("people");
  });

  describe("choosing an emoji", () => {
    it("writes the form field and closes both pickers", () => {
      const { state, use } = makeHarness();
      const mounted = mountHook(use);

      act(() => {
        mounted.read().setIsAvatarPickerOpen(true);
        mounted.read().setIsAvatarImageMenuOpen(true);
      });
      act(() => {
        mounted.read().selectAvatarEmoji("😏");
      });

      expect(state.emoji).toBe("😏");
      expect(mounted.read().isAvatarPickerOpen).toBe(false);
      expect(mounted.read().isAvatarImageMenuOpen).toBe(false);
    });

    it("records it as recently used, newest first and without duplicates", () => {
      const { use } = makeHarness();
      const mounted = mountHook(use);

      act(() => {
        mounted.read().selectAvatarEmoji("😏");
      });
      act(() => {
        mounted.read().selectAvatarEmoji("🐺");
      });
      act(() => {
        mounted.read().selectAvatarEmoji("😏");
      });

      expect(mounted.read().recentAvatars).toEqual(["😏", "🐺"]);
      expect(JSON.parse(localStorage.getItem(RECENT_AVATAR_KEY) || "[]")).toEqual(["😏", "🐺"]);
    });
  });

  it("closing the overlays also empties the URL box and the drop state", () => {
    const { use } = makeHarness();
    const mounted = mountHook(use);

    act(() => {
      mounted.read().setAvatarUrlValue("https://example.com/a.png");
      mounted.read().setIsAvatarDragActive(true);
      mounted.read().setIsAvatarUrlOpen(true);
      mounted.read().setIsAvatarImageMenuOpen(true);
    });
    act(() => {
      mounted.read().closeAvatarOverlays();
    });

    expect(mounted.read().avatarUrlValue).toBe("");
    expect(mounted.read().isAvatarDragActive).toBe(false);
    expect(mounted.read().isAvatarUrlOpen).toBe(false);
    expect(mounted.read().isAvatarImageMenuOpen).toBe(false);
  });

  describe("uploading a file", () => {
    it("refuses a file the validator rejects, and does not open the crop", () => {
      const { state, use } = makeHarness();
      const mounted = mountHook(use);

      // A text file: not an accepted image type.
      const file = new File(["not an image"], "notes.txt", { type: "text/plain" });

      act(() => {
        void mounted.read().handleAvatarUpload(file);
      });

      expect(mounted.read().cropDraft).toBeNull();
      expect(state.toasts).toHaveLength(1);
      expect(state.toasts[0]).toMatch(/JPG|PNG|WEBP|格式|图片/);
    });

    it("opens the crop centred and unzoomed for an accepted file", () => {
      const { use } = makeHarness();
      const mounted = mountHook(use);

      const file = new File(["x"], "avatar.png", { type: "image/png" });

      act(() => {
        void mounted.read().handleAvatarUpload(file);
      });

      const draft = mounted.read().cropDraft;
      expect(draft).not.toBeNull();
      expect(draft?.offsetX).toBe(0);
      expect(draft?.offsetY).toBe(0);
      expect(draft?.zoom).toBe(1);
      expect(draft?.fileName).toBe("avatar.png");
    });

    it("does nothing at all for an undefined file", () => {
      const { state, use } = makeHarness();
      const mounted = mountHook(use);

      act(() => {
        void mounted.read().handleAvatarUpload(undefined);
      });

      expect(mounted.read().cropDraft).toBeNull();
      expect(state.toasts).toEqual([]);
    });
  });

  it("complains about an empty URL instead of fetching it", () => {
    const { state, use } = makeHarness();
    const mounted = mountHook(use);

    act(() => {
      void mounted.read().handleAvatarUrlSubmit();
    });

    expect(state.toasts).toEqual(["请输入图片 URL"]);
  });

  describe("crop zoom", () => {
    it("stays null when there is no crop in progress", () => {
      const { use } = makeHarness();
      const mounted = mountHook(use);

      act(() => {
        mounted.read().adjustCropZoom(1);
      });

      expect(mounted.read().cropDraft).toBeNull();
    });

    it("clamps to the 0.25 - 8 range the geometry module allows", () => {
      const { use } = makeHarness();
      const mounted = mountHook(use);

      act(() => {
        mounted.read().openAvatarCrop(new File(["x"], "a.png", { type: "image/png" }));
      });
      act(() => {
        mounted.read().adjustCropZoom(-99);
      });
      // The floor is `min(0.25)`, then clamped up to whatever covers the frame.
      expect(mounted.read().cropDraft!.zoom).toBeGreaterThanOrEqual(0.25);

      act(() => {
        mounted.read().setCropDraft((current) => (current ? { ...current, zoom: 7.5 } : current));
      });
      act(() => {
        mounted.read().adjustCropZoom(99);
      });
      expect(mounted.read().cropDraft!.zoom).toBe(8);
    });
  });

  describe("the staged avatar", () => {
    it("revokes the preview URL rather than leaking it", () => {
      const { use } = makeHarness();
      const mounted = mountHook(use);

      act(() => {
        mounted.read().setPendingAvatar({
          blob: new Blob(["x"]),
          name: "a.png",
          previewUrl: "blob:staged",
        });
      });
      act(() => {
        mounted.read().clearPendingAvatar();
      });

      expect(mounted.read().pendingAvatar).toBeNull();
      expect(revokedUrls).toContain("blob:staged");
    });

    it("revokes the crop's image URL when the dialog closes", () => {
      const { use } = makeHarness();
      const mounted = mountHook(use);

      act(() => {
        mounted.read().openAvatarCrop(new File(["x"], "a.png", { type: "image/png" }));
      });
      const imageUrl = mounted.read().cropDraft!.imageUrl;

      act(() => {
        mounted.read().closeCropDialog();
      });

      expect(revokedUrls).toContain(imageUrl);
      expect(mounted.read().cropDraft).toBeNull();
      expect(mounted.read().cropDrag).toBeNull();
    });

    it("cannot be confirmed without a crop", () => {
      const { state, use } = makeHarness();
      const mounted = mountHook(use);

      act(() => {
        void mounted.read().confirmCropAvatar();
      });

      expect(state.assetId).toBe("");
      expect(state.toasts).toEqual([]);
    });
  });

  describe("the local asset library", () => {
    it("clears the other domains' overlays on its way in, and closes its own", () => {
      const { state, use } = makeHarness();
      const mounted = mountHook(use);

      act(() => {
        mounted.read().setIsAvatarImageMenuOpen(true);
        mounted.read().setAvatarUrlValue("https://example.com/a.png");
      });
      act(() => {
        void mounted.read().openAssetLibrary();
      });

      // Called before the listing, so it happens even if the listing fails.
      expect(state.beforeOpenAssetLibrary).toBe(1);
      expect(mounted.read().isAvatarImageMenuOpen).toBe(false);
      expect(mounted.read().avatarUrlValue).toBe("");
    });

    it("applies a chosen asset and drops the staged one", () => {
      const { state, use } = makeHarness();
      const mounted = mountHook(use);

      act(() => {
        mounted.read().setPendingAvatar({
          blob: new Blob(["x"]),
          name: "a.png",
          previewUrl: "blob:staged",
        });
      });
      act(() => {
        mounted.read().selectAvatarAsset("asset-7");
      });

      expect(state.assetId).toBe("asset-7");
      expect(mounted.read().pendingAvatar).toBeNull();
      expect(mounted.read().isAssetLibraryOpen).toBe(false);
      expect(state.toasts).toContain("已应用本地素材头像");
    });

    it("goes back to the emoji and says so", () => {
      const { state, use } = makeHarness();
      const mounted = mountHook(use);

      act(() => {
        mounted.read().setIsAvatarImageMenuOpen(true);
      });
      act(() => {
        mounted.read().removeAvatarImage();
      });

      expect(state.assetId).toBe("");
      expect(mounted.read().isAvatarImageMenuOpen).toBe(false);
      expect(state.toasts).toContain("已恢复 Emoji 头像");
    });
  });

  it("drops a recent emoji that is no longer offered", () => {
    // A retired emoji would otherwise sit in the row as a blank button forever.
    localStorage.setItem(RECENT_AVATAR_KEY, JSON.stringify(["👽", "🛸", "🙂"]));

    const { use } = makeHarness();
    const hook = mountHook(use).read();

    expect(hook.recentAvatars).toContain("👽");
    expect(hook.recentAvatars).not.toContain("🛸");
  });
});
