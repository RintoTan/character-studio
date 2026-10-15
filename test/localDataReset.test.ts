// @vitest-environment happy-dom
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { BACKUP_KEY, readSnapshot } from "../src/storage/backup";
import { loadCharacters, saveCharacters } from "../src/storage/characterStorage";
import { clearLocalDataPreservingSnapshot } from "../src/storage/localDataReset";
import type { Character } from "../src/types/character";

const character = (id: string): Character => ({ id, name: id, updatedAt: "2026-01-01T00:00:00.000Z" });

const REASON = "清空本地数据前自动备份";

describe("clearing local data", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("leaves a recovery copy that outlives the clear it was taken for", () => {
    saveCharacters([character("a"), character("b")]);

    clearLocalDataPreservingSnapshot(REASON, loadCharacters());

    // The live list must be gone...
    expect(loadCharacters()).toEqual([]);
    // ...and the copy must not have been wiped along with it. localStorage.clear()
    // removes the snapshot too, so this is the assertion that fails if the
    // write-back is dropped.
    expect(readSnapshot()?.characters.map((c) => c.id)).toEqual(["a", "b"]);
    expect(readSnapshot()?.reason).toBe(REASON);
  });

  it("still clears keys that have nothing to do with characters", () => {
    localStorage.setItem("character-studio.theme", "dark");
    localStorage.setItem("character-studio.relationships", "[]");
    saveCharacters([character("a")]);

    clearLocalDataPreservingSnapshot(REASON, loadCharacters());

    expect(localStorage.getItem("character-studio.theme")).toBeNull();
    expect(localStorage.getItem("character-studio.relationships")).toBeNull();
    expect(readSnapshot()).not.toBeNull();
  });

  it("takes no snapshot when there is nothing worth keeping", () => {
    expect(clearLocalDataPreservingSnapshot(REASON, [])).toBeNull();
    expect(localStorage.getItem(BACKUP_KEY)).toBeNull();
  });

  it("reports the copy it kept, so a caller can say what happened", () => {
    const snapshot = clearLocalDataPreservingSnapshot(REASON, [character("a")]);

    expect(snapshot?.characterCount).toBe(1);
    expect(snapshot?.createdAt).toBeTruthy();
  });

  it("keeps only the most recent copy when it is called twice", () => {
    saveCharacters([character("a")]);
    clearLocalDataPreservingSnapshot(REASON, loadCharacters());
    saveCharacters([character("b"), character("c")]);

    clearLocalDataPreservingSnapshot(REASON, loadCharacters());

    expect(readSnapshot()?.characters.map((c) => c.id)).toEqual(["b", "c"]);
  });
});

// The behaviour above only protects anyone if both "clear local data" entries go
// through it. This is a structural guard, not a browser test: it fails when a raw
// localStorage.clear() is written anywhere in src/ again, which is exactly how the
// two entries drifted apart the first time.
describe("one implementation of clearing", () => {
  const sourceFiles = (dir: string): string[] =>
    readdirSync(dir).flatMap((entry) => {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) {
        return sourceFiles(path);
      }
      return /\.tsx?$/.test(entry) ? [path] : [];
    });

  // Comments are skipped: storage/backup.ts explains the write-back by naming
  // localStorage.clear(), and a prose mention is not a second implementation.
  // The guard is line-based, so a call written after trailing code on a comment
  // line would slip past - narrow enough to live with, and it fails loudly on the
  // way this regression actually happens (a new handler calling clear directly).
  const clearCalls = (source: string): number =>
    source
      .split("\n")
      .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
      .filter((line) => /\blocalStorage\s*\.\s*clear\s*\(/.test(line)).length;

  it("allows localStorage.clear() in exactly one module", () => {
    const offenders = sourceFiles("src")
      .filter((file) => clearCalls(readFileSync(file, "utf8")) > 0)
      .map((file) => relative(".", file).split("\\").join("/"))
      .sort();

    expect(offenders).toEqual(["src/storage/localDataReset.ts"]);
  });

  it("has both clear entries call the shared helper", () => {
    for (const file of ["src/App.tsx", "src/pages/Dashboard.tsx"]) {
      expect(readFileSync(file, "utf8")).toContain("clearLocalDataPreservingSnapshot(");
    }
  });
});
