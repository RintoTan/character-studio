// @vitest-environment happy-dom
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BACKUP_KEY, readSnapshot } from "../src/storage/backup";
import { loadCharacters, saveCharacters } from "../src/storage/characterStorage";
import { clearLocalDataPreservingSnapshot } from "../src/storage/localDataReset";
import type { Character } from "../src/types/character";

const character = (id: string): Character => ({ id, name: id, updatedAt: "2026-01-01T00:00:00.000Z" });

const REASON = "清空本地数据前自动备份";

// Fails only the writes that go to one key, so a test can break the snapshot without
// breaking everything else the clear does - and so the failing write is the one the
// decision depends on, not a blanket failure.
function failWritesTo(key: string, errorName = "QuotaExceededError") {
  const original = localStorage.setItem.bind(localStorage);
  return vi
    .spyOn(localStorage, "setItem")
    .mockImplementation((target: string, value: string) => {
      if (String(target) === key) {
        const error = new Error("storage refused the write");
        error.name = errorName;
        throw error;
      }
      original(target, value);
    });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("clearing local data", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("leaves a recovery copy that outlives the clear it was taken for", () => {
    saveCharacters([character("a"), character("b")]);

    const result = clearLocalDataPreservingSnapshot(REASON, loadCharacters());

    expect(result.ok).toBe(true);
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

  it("reports the copy it kept, so a caller can say what happened", () => {
    const result = clearLocalDataPreservingSnapshot(REASON, [character("a")]);

    expect(result.ok && result.snapshot?.characterCount).toBe(1);
    expect(result.ok && result.keptPrevious).toBe(false);
  });

  it("keeps only the most recent copy when it is called twice", () => {
    saveCharacters([character("a")]);
    clearLocalDataPreservingSnapshot(REASON, loadCharacters());
    saveCharacters([character("b"), character("c")]);

    clearLocalDataPreservingSnapshot(REASON, loadCharacters());

    expect(readSnapshot()?.characters.map((c) => c.id)).toEqual(["b", "c"]);
  });

  it("replaces a damaged copy rather than failing on it", () => {
    localStorage.setItem(BACKUP_KEY, "{ this is not json");
    saveCharacters([character("a")]);

    const result = clearLocalDataPreservingSnapshot(REASON, loadCharacters());

    expect(result.ok).toBe(true);
    expect(result.ok && result.keptPrevious).toBe(false);
    expect(readSnapshot()?.characters.map((c) => c.id)).toEqual(["a"]);
  });

  it("keeps the clear working when reading the old copy throws", () => {
    saveCharacters([character("a")]);
    vi.spyOn(localStorage, "getItem").mockImplementation(() => {
      throw new Error("storage unavailable");
    });

    const result = clearLocalDataPreservingSnapshot(REASON, loadCharacters());

    expect(result.ok).toBe(true);
  });
});

// DEC-38-01. Without these, "the copy could not be written" would quietly mean
// "everything was deleted anyway, with nothing to go back to".
describe("a copy that cannot be written stops the clear", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("deletes nothing and says why", () => {
    saveCharacters([character("a"), character("b")]);
    failWritesTo(BACKUP_KEY);

    const result = clearLocalDataPreservingSnapshot(REASON, loadCharacters());

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toContain("存储空间不足");
    // The whole point: the data is still there.
    expect(loadCharacters().map((c) => c.id)).toEqual(["a", "b"]);
  });

  it("leaves unrelated keys alone as well, because it never reaches the clear", () => {
    localStorage.setItem("character-studio.theme", "dark");
    saveCharacters([character("a")]);
    failWritesTo(BACKUP_KEY);

    clearLocalDataPreservingSnapshot(REASON, loadCharacters());

    expect(localStorage.getItem("character-studio.theme")).toBe("dark");
  });

  it("reports a write that failed for another reason without pretending it is a quota problem", () => {
    saveCharacters([character("a")]);
    failWritesTo(BACKUP_KEY, "SecurityError");

    const result = clearLocalDataPreservingSnapshot(REASON, loadCharacters());

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).not.toContain("存储空间不足");
    expect(loadCharacters()).toHaveLength(1);
  });

  it("still clears when nothing needs protecting, so an empty store is never a dead end", () => {
    localStorage.setItem("character-studio.theme", "dark");
    failWritesTo(BACKUP_KEY);

    const result = clearLocalDataPreservingSnapshot(REASON, []);

    expect(result.ok).toBe(true);
    expect(localStorage.getItem("character-studio.theme")).toBeNull();
  });

  it("can be called again after a failure, and succeeds once the write works", () => {
    saveCharacters([character("a")]);
    const failing = failWritesTo(BACKUP_KEY);

    expect(clearLocalDataPreservingSnapshot(REASON, loadCharacters()).ok).toBe(false);

    failing.mockRestore();
    expect(clearLocalDataPreservingSnapshot(REASON, loadCharacters()).ok).toBe(true);
    expect(loadCharacters()).toEqual([]);
  });
});

// KI-16: the older copy was the only way back to the state before the last
// destructive operation, and localStorage.clear() destroyed it while the empty list
// meant nothing new was written in its place.
describe("an empty clear protects the copy that already exists", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("puts the previous copy back instead of throwing it away", () => {
    saveCharacters([character("a")]);
    clearLocalDataPreservingSnapshot(REASON, loadCharacters());
    const before = readSnapshot();

    const result = clearLocalDataPreservingSnapshot(REASON, []);

    expect(result.ok && result.keptPrevious).toBe(true);
    expect(readSnapshot()).toEqual(before);
  });

  it("has nothing to put back when there was never a copy", () => {
    const result = clearLocalDataPreservingSnapshot(REASON, []);

    expect(result.ok && result.keptPrevious).toBe(false);
    expect(readSnapshot()).toBeNull();
  });

  it("replaces the copy rather than merging when there is something new to keep", () => {
    saveCharacters([character("a")]);
    clearLocalDataPreservingSnapshot(REASON, loadCharacters());

    const result = clearLocalDataPreservingSnapshot(REASON, [character("z")]);

    expect(result.ok && result.keptPrevious).toBe(false);
    expect(readSnapshot()?.characters.map((c) => c.id)).toEqual(["z"]);
  });
});

// The behaviour above only protects anyone if both "clear local data" entries go
// through it. This is a structural guard, not a browser test: it fails when a raw
// localStorage.clear() is written anywhere in src/ again, which is exactly how the
// two entries drifted apart the first time.
describe("one implementation of clearing", () => {
  // Comments are skipped: storage/backup.ts explains the write-back by naming
  // localStorage.clear(), and a prose mention is not a second implementation.
  const clearCalls = (source: string): number =>
    source
      .split("\n")
      .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
      .filter((line) => /\blocalStorage\s*\.\s*clear\s*\(/.test(line)).length;

  const sourceFiles = (dir: string): string[] =>
    readdirSync(dir).flatMap((entry) => {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) {
        return sourceFiles(path);
      }
      return /\.tsx?$/.test(entry) ? [path] : [];
    });

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
