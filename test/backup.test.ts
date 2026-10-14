// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import { BACKUP_KEY, clearSnapshot, createSnapshot, readSnapshot } from "../src/storage/backup";
import { loadCharacters, saveCharacters } from "../src/storage/characterStorage";
import type { Character } from "../src/types/character";

const character = (id: string): Character => ({ id, name: id, updatedAt: "2026-01-01T00:00:00.000Z" });

describe("backup snapshots", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("captures the current list under its own key", () => {
    const snapshot = createSnapshot("before import", [character("a"), character("b")]);

    expect(snapshot?.characterCount).toBe(2);
    expect(localStorage.getItem(BACKUP_KEY)).toBeTruthy();
    // The snapshot must never share the live key, or restoring would overwrite it.
    expect(BACKUP_KEY).not.toBe("character-studio.characters");
    expect(localStorage.getItem("character-studio.characters")).toBeNull();
  });

  it("survives the destructive operation it was taken for", () => {
    saveCharacters([character("a")]);
    createSnapshot("clearing local data", loadCharacters());

    // Simulate what clearing data does to the live key.
    localStorage.removeItem("character-studio.characters");
    expect(loadCharacters()).toEqual([]);

    const restored = readSnapshot();
    expect(restored?.characters.map((c) => c.id)).toEqual(["a"]);
    expect(restored?.reason).toBe("clearing local data");
    expect(restored?.createdAt).toBeTruthy();
  });

  it("skips the snapshot when there is nothing worth keeping", () => {
    expect(createSnapshot("before import", [])).toBeNull();
    expect(localStorage.getItem(BACKUP_KEY)).toBeNull();
  });

  it("keeps only the most recent snapshot", () => {
    createSnapshot("first", [character("a")]);
    createSnapshot("second", [character("b")]);

    expect(readSnapshot()?.reason).toBe("second");
    expect(readSnapshot()?.characters.map((c) => c.id)).toEqual(["b"]);
  });

  it("reports no snapshot when the stored value is unusable", () => {
    localStorage.setItem(BACKUP_KEY, "broken");
    expect(readSnapshot()).toBeNull();
  });

  it("clears the snapshot on request", () => {
    createSnapshot("before import", [character("a")]);
    clearSnapshot();
    expect(readSnapshot()).toBeNull();
  });
});
