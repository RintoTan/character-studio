import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { DEFAULT_AVATAR_EMOJI } from "../data/avatarCategories";
import type { Character, CharacterDraft } from "../types/character";
import { saveAvatarBlob } from "../utils/avatarAssets";

// Turning the editor's draft into a character, and knowing whether it is saved.
//
// The editor had four ways to write a character -- the two explicit saves, the
// autosave timer, and the "has anything changed" guard the browser asks on the way
// out -- and each of them carried its own copy of the same two rules: what makes a
// draft equal to what is already stored, and what the status badge should read
// afterwards. They live in one place now.
//
// `buildCharacter` used to be called by all four. It is the only place that knows
// the two things a character needs on the way out: a staged avatar has to be
// written to the asset store first, and the identity fields come from the stored
// character rather than the draft.

export type SaveStatus = "idle" | "saving" | "saved" | "error";

type PendingAvatar = { blob: Blob; name: string } | null;

type Options = {
  formData: CharacterDraft;
  setFormData: Dispatch<SetStateAction<CharacterDraft>>;
  character?: Character | null;
  pendingAvatar: PendingAvatar;
  /** Clears the staged avatar without writing it -- called after a successful save. */
  clearPendingAvatar: () => void;
  showToast: (message: string) => void;
  setFormError: (message: string) => void;
  onSave: (character: Character) => void;
  onDraftSave: (character: Character) => void;
  onAutoSave?: (character: Character) => void;
  /** Off means the author is saving by hand. */
  autoSave: boolean;
};

export function useCharacterSave({
  formData,
  setFormData,
  character,
  pendingAvatar,
  clearPendingAvatar,
  showToast,
  setFormError,
  onSave,
  onDraftSave,
  onAutoSave,
  autoSave,
}: Options) {
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  // The snapshot is what "unchanged" is measured against, and it is deliberately a
  // ref rather than state: it must not trigger a render, and the browser's unload
  // guard has to read the latest value without re-registering its listener.
  const lastSnapshotRef = useRef("");

  /**
   * The form was filled from a character: nothing is unsaved, and the badge says so.
   *
   * `character` decides between "saved" and "idle" because an existing character
   * opens already saved while a new one opens with nothing to save. That difference
   * is why this is not just `markCleared`.
   */
  function markLoaded(nextData: CharacterDraft) {
    lastSnapshotRef.current = JSON.stringify(nextData);
    setSaveStatus(character ? "saved" : "idle");
  }

  /** The form was emptied. Always idle, whatever was open before. */
  function markCleared(nextData: CharacterDraft) {
    lastSnapshotRef.current = JSON.stringify(nextData);
    setSaveStatus("idle");
  }

  async function buildCharacter(isDraft: boolean): Promise<Character | null> {
    if (!formData.name.trim()) {
      setFormError("请先填写角色名字");
      showToast("请先填写角色名字");
      return null;
    }

    let avatarAssetId = formData.avatarAssetId;

    // A staged avatar is only committed here, so abandoning the editor leaves no
    // orphan in the asset store.
    if (pendingAvatar) {
      const asset = await saveAvatarBlob(pendingAvatar.blob, pendingAvatar.name);
      avatarAssetId = asset.id;
    }

    setFormError("");
    return {
      ...formData,
      avatarAssetId,
      id: character?.id || crypto.randomUUID(),
      createdAt: character?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      avatarEmoji: formData.avatarEmoji || DEFAULT_AVATAR_EMOJI,
      isDraft,
      name: formData.name.trim(),
    };
  }

  // Both saves write the form field back to the id they just committed, so the
  // editor stops holding a staged avatar it has already written.
  function commit(nextCharacter: Character) {
    clearPendingAvatar();
    setFormData((current) => ({ ...current, avatarAssetId: nextCharacter.avatarAssetId || "" }));
    setSaveStatus("saved");
  }

  async function saveCurrentCharacter() {
    const nextCharacter = await buildCharacter(false);

    if (!nextCharacter) {
      return;
    }

    setSaveStatus("saving");
    onSave(nextCharacter);
    commit(nextCharacter);
  }

  async function saveDraftCharacter() {
    const nextCharacter = await buildCharacter(true);

    if (!nextCharacter) {
      return;
    }

    setSaveStatus("saving");
    onDraftSave(nextCharacter);
    commit(nextCharacter);
  }

  // Autosave applies to drafts only, and only once something actually changed.
  useEffect(() => {
    if (!autoSave || !character?.isDraft || !onAutoSave) {
      return;
    }

    const snapshot = JSON.stringify(formData);

    if (snapshot === lastSnapshotRef.current) {
      return;
    }

    setSaveStatus("saving");
    const timer = window.setTimeout(() => {
      try {
        onAutoSave({
          ...formData,
          id: character.id,
          createdAt: character.createdAt || new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          isDraft: character.isDraft === true,
          draftOfId: character.draftOfId,
          name: formData.name || character.name || "未命名角色",
        });
        lastSnapshotRef.current = snapshot;
        setSaveStatus("saved");
      } catch {
        setSaveStatus("error");
      }
    }, 900);

    return () => window.clearTimeout(timer);
  }, [autoSave, character, formData, onAutoSave]);

  // The browser's own "you have unsaved work" prompt. It asks the same question as
  // the autosave guard, against the same snapshot.
  useEffect(() => {
    function handleBeforeUnload(event: BeforeUnloadEvent) {
      if (JSON.stringify(formData) === lastSnapshotRef.current) {
        return;
      }

      event.preventDefault();
    }

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [formData]);

  return {
    saveStatus,
    markLoaded,
    markCleared,
    buildCharacter,
    saveCurrentCharacter,
    saveDraftCharacter,
  };
}
