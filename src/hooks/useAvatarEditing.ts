import { useEffect, useRef, useState, type DragEvent } from "react";
import { avatarCategories, avatarEmojiOptions } from "../data/avatarCategories";
import { loadRecentAvatars, saveRecentAvatar } from "../storage/recentAvatars";
// Aliased on the way in: this hook defines its own `clampCropDraft` and
// `getVisibleCrop`, which are the DOM-reading wrappers around these two.
import {
  clampCropDraft as clampDraftToMetrics,
  cropMetrics,
  visibleCrop as computeVisibleCrop,
} from "../utils/cropGeometry";
import {
  compressImageToAvatarBlob,
  listAvatarAssets,
  validateAvatarFile,
  type AvatarAssetRecord,
} from "../utils/avatarAssets";

// Everything the editor does to a character's picture: the emoji, the upload
// menu, the crop dialog, and the local asset library.
//
// This is the largest single domain in the editor -- twelve pieces of state, five
// refs and seventeen actions -- and it was tangled with the form in two ways that
// had to be named before it could move:
//
//   * the emoji and the chosen asset are *form fields* (`avatarEmoji`,
//     `avatarAssetId`), so they stay owned by the form and are written through the
//     two callbacks below;
//   * opening the asset library also closes the helper suggestion and the pending
//     clear confirmation, which belong to other domains.
//
// The hook returns its state and setters under their original names, so the JSX
// that consumes them did not have to change at all -- the reviewable part of this
// change is the boundary, not a wall of renames.

type CropDraft = {
  fileName: string;
  imageUrl: string;
  offsetX: number;
  offsetY: number;
  zoom: number;
};

type PendingAvatar = {
  blob: Blob;
  name: string;
  previewUrl: string;
};

// Only the two write callbacks are needed, not the current values: nothing in this
// domain reads back what the form holds, it only replaces it.
type Options = {
  onEmojiChange: (emoji: string) => void;
  onAssetIdChange: (assetId: string) => void;
  showToast: (message: string) => void;
  /** Other domains' overlays that the asset library closes on its way in. */
  onBeforeOpenAssetLibrary?: () => void;
};

export function useAvatarEditing({
  onEmojiChange,
  onAssetIdChange,
  showToast,
  onBeforeOpenAssetLibrary,
}: Options) {
  const [activeAvatarCategoryId, setActiveAvatarCategoryId] = useState(avatarCategories[0].id);
  const [isAvatarPickerOpen, setIsAvatarPickerOpen] = useState(false);
  const [isAvatarImageMenuOpen, setIsAvatarImageMenuOpen] = useState(false);
  const [isAvatarUrlOpen, setIsAvatarUrlOpen] = useState(false);
  const [avatarUrlValue, setAvatarUrlValue] = useState("");
  const [isAvatarDragActive, setIsAvatarDragActive] = useState(false);
  const [isAssetLibraryOpen, setIsAssetLibraryOpen] = useState(false);
  const [avatarAssets, setAvatarAssets] = useState<AvatarAssetRecord[]>([]);
  const [pendingAvatar, setPendingAvatar] = useState<PendingAvatar | null>(null);
  const [cropDraft, setCropDraft] = useState<CropDraft | null>(null);
  const [cropDrag, setCropDrag] = useState<{ x: number; y: number } | null>(null);
  const [recentAvatars, setRecentAvatars] = useState(() => loadRecentAvatars(avatarEmojiOptions));

  const avatarFileInputRef = useRef<HTMLInputElement>(null);
  const avatarImageMenuRef = useRef<HTMLDivElement>(null);
  const cropImageRef = useRef<HTMLImageElement>(null);
  const cropStageRef = useRef<HTMLDivElement>(null);
  const cropFrameRef = useRef<HTMLDivElement>(null);

  // A staged avatar owns an object URL; revoking it on unmount is the only thing
  // keeping them from piling up as the author swaps pictures.
  useEffect(() => {
    return () => {
      if (pendingAvatar?.previewUrl) {
        URL.revokeObjectURL(pendingAvatar.previewUrl);
      }
    };
  }, [pendingAvatar?.previewUrl]);

  // Clicking anywhere else closes the upload menu, and so does moving on to
  // another field: the menu is a menu, not a state.
  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      if (!isAvatarImageMenuOpen) {
        return;
      }

      if (avatarImageMenuRef.current?.contains(event.target as Node)) {
        return;
      }

      setIsAvatarImageMenuOpen(false);
      setIsAvatarUrlOpen(false);
      setAvatarUrlValue("");
      setIsAvatarDragActive(false);
    }

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [isAvatarImageMenuOpen]);

  // Pasting an image while the menu is open is the fastest route in, and it is
  // only offered while the menu is open so a paste into a text field is untouched.
  useEffect(() => {
    function handlePaste(event: ClipboardEvent) {
      if (!isAvatarImageMenuOpen) {
        return;
      }

      const imageItem = Array.from(event.clipboardData?.items || []).find((item) =>
        item.type.startsWith("image/"),
      );

      if (!imageItem) {
        return;
      }

      const file = imageItem.getAsFile();

      if (file) {
        event.preventDefault();
        void handleAvatarUpload(file);
      }
    }

    document.addEventListener("paste", handlePaste);
    return () => document.removeEventListener("paste", handlePaste);
  }, [isAvatarImageMenuOpen]);

  function selectAvatarEmoji(nextEmoji: string) {
    onEmojiChange(nextEmoji);
    setRecentAvatars(saveRecentAvatar(nextEmoji, loadRecentAvatars(avatarEmojiOptions)));
    setIsAvatarPickerOpen(false);
    setIsAvatarImageMenuOpen(false);
  }

  function closeAvatarOverlays() {
    setIsAvatarImageMenuOpen(false);
    setIsAvatarPickerOpen(false);
    setIsAvatarUrlOpen(false);
    setAvatarUrlValue("");
    setIsAvatarDragActive(false);
  }

  function openAvatarCrop(file: File) {
    closeAvatarOverlays();
    setIsAssetLibraryOpen(false);
    setCropDraft({
      fileName: file.name || "avatar",
      imageUrl: URL.createObjectURL(file),
      offsetX: 0,
      offsetY: 0,
      zoom: 1,
    });
  }

  async function handleAvatarUpload(file: File | undefined) {
    if (!file) {
      return;
    }

    const validationError = validateAvatarFile(file);

    if (validationError) {
      showToast(validationError);
      if (avatarFileInputRef.current) {
        avatarFileInputRef.current.value = "";
      }
      return;
    }

    openAvatarCrop(file);
    setIsAvatarImageMenuOpen(false);

    if (avatarFileInputRef.current) {
      avatarFileInputRef.current.value = "";
    }
  }

  function inferImageTypeFromUrl(value: string) {
    const pathname = value.split("?")[0].toLowerCase();

    if (pathname.endsWith(".jpg") || pathname.endsWith(".jpeg")) {
      return "image/jpeg";
    }
    if (pathname.endsWith(".png")) {
      return "image/png";
    }
    if (pathname.endsWith(".webp")) {
      return "image/webp";
    }

    return "";
  }

  async function handleAvatarUrlSubmit(urlOverride?: string) {
    const url = (urlOverride || avatarUrlValue).trim();

    if (!url) {
      showToast("请输入图片 URL");
      return;
    }

    try {
      const response = await fetch(url, { mode: "cors" });

      if (!response.ok) {
        throw new Error("图片读取失败");
      }

      const blob = await response.blob();
      const mimeType = blob.type || inferImageTypeFromUrl(url);

      if (!mimeType) {
        throw new Error("无法识别图片格式");
      }

      const file = new File([blob.type ? blob : new Blob([blob], { type: mimeType })], "url-avatar", {
        type: mimeType,
      });
      await handleAvatarUpload(file);
      setIsAvatarUrlOpen(false);
      setAvatarUrlValue("");
      setIsAvatarImageMenuOpen(false);
    } catch {
      showToast("URL 图片读取失败，请下载后上传或尝试拖拽图片");
    }
  }

  function adjustCropZoom(delta: number) {
    setCropDraft((current) =>
      clampCropDraft(
        current
          ? {
              ...current,
              zoom: Math.max(0.25, Math.min(8, current.zoom + delta)),
            }
          : current,
      ),
    );
  }

  async function handleAvatarDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsAvatarDragActive(false);

    const file = Array.from(event.dataTransfer.files).find((item) =>
      item.type.startsWith("image/"),
    );

    if (file) {
      await handleAvatarUpload(file);
      return;
    }

    const url =
      event.dataTransfer.getData("text/uri-list") ||
      event.dataTransfer.getData("text/plain");

    if (url) {
      await handleAvatarUrlSubmit(url);
      return;
    }

    showToast("请拖入 JPG、PNG 或 WEBP 图片");
  }

  // The crop arithmetic lives in utils/cropGeometry; these three read the DOM, which
  // is the only part that cannot be pure. An HTMLImageElement already satisfies the
  // geometry module's size shape and a DOMRect its rect shape, so nothing is copied
  // or converted on the way in.

  function getCropMetrics(zoom = cropDraft?.zoom || 1) {
    const image = cropImageRef.current;
    const stage = cropStageRef.current;
    const frame = cropFrameRef.current;

    if (!image || !stage || !frame) {
      return null;
    }

    return cropMetrics(image, stage.getBoundingClientRect(), frame.getBoundingClientRect(), zoom);
  }

  function clampCropDraft(nextDraft: CropDraft | null) {
    return clampDraftToMetrics(nextDraft, nextDraft ? getCropMetrics(nextDraft.zoom) : null);
  }

  function getVisibleCrop() {
    const image = cropImageRef.current;
    const stage = cropStageRef.current;
    const frame = cropFrameRef.current;

    if (!cropDraft || !image || !stage || !frame) {
      return null;
    }

    return computeVisibleCrop(image, stage.getBoundingClientRect(), frame.getBoundingClientRect(), cropDraft);
  }

  async function confirmCropAvatar() {
    const visibleCrop = getVisibleCrop();

    if (!cropDraft || !cropImageRef.current || !visibleCrop) {
      return;
    }

    try {
      const blob = await compressImageToAvatarBlob(cropImageRef.current, {
        ...cropDraft,
        ...visibleCrop,
      });
      const previewUrl = URL.createObjectURL(blob);

      clearPendingAvatar();
      setPendingAvatar({ blob, name: cropDraft.fileName, previewUrl });
      onAssetIdChange("");
      closeCropDialog();
      showToast("头像已裁剪，保存角色后会写入本地素材库");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "头像保存失败");
    }
  }

  function clearPendingAvatar() {
    setPendingAvatar((current) => {
      if (current?.previewUrl) {
        URL.revokeObjectURL(current.previewUrl);
      }

      return null;
    });
  }

  function closeCropDialog() {
    if (cropDraft?.imageUrl) {
      URL.revokeObjectURL(cropDraft.imageUrl);
    }
    setCropDraft(null);
    setCropDrag(null);
  }

  async function openAssetLibrary() {
    try {
      closeAvatarOverlays();
      onBeforeOpenAssetLibrary?.();
      setAvatarAssets(await listAvatarAssets());
      setIsAssetLibraryOpen(true);
    } catch {
      showToast("本地素材库读取失败");
    }
  }

  function selectAvatarAsset(nextAssetId: string) {
    clearPendingAvatar();
    onAssetIdChange(nextAssetId);
    setIsAssetLibraryOpen(false);
    setIsAvatarImageMenuOpen(false);
    showToast("已应用本地素材头像");
  }

  function removeAvatarImage() {
    clearPendingAvatar();
    onAssetIdChange("");
    setIsAvatarImageMenuOpen(false);
    showToast("已恢复 Emoji 头像");
  }

  return {
    // State, under the names the form already used.
    activeAvatarCategoryId,
    setActiveAvatarCategoryId,
    isAvatarPickerOpen,
    setIsAvatarPickerOpen,
    isAvatarImageMenuOpen,
    setIsAvatarImageMenuOpen,
    isAvatarUrlOpen,
    setIsAvatarUrlOpen,
    avatarUrlValue,
    setAvatarUrlValue,
    isAvatarDragActive,
    setIsAvatarDragActive,
    isAssetLibraryOpen,
    setIsAssetLibraryOpen,
    avatarAssets,
    setAvatarAssets,
    pendingAvatar,
    setPendingAvatar,
    cropDraft,
    setCropDraft,
    cropDrag,
    setCropDrag,
    recentAvatars,
    setRecentAvatars,
    // Refs.
    avatarFileInputRef,
    avatarImageMenuRef,
    cropImageRef,
    cropStageRef,
    cropFrameRef,
    // Actions.
    selectAvatarEmoji,
    closeAvatarOverlays,
    openAvatarCrop,
    handleAvatarUpload,
    handleAvatarUrlSubmit,
    adjustCropZoom,
    handleAvatarDrop,
    getCropMetrics,
    clampCropDraft,
    getVisibleCrop,
    confirmCropAvatar,
    clearPendingAvatar,
    closeCropDialog,
    openAssetLibrary,
    selectAvatarAsset,
    removeAvatarImage,
  };
}
