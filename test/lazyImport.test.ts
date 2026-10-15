// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { importWithRecovery, isChunkLoadError } from "../src/utils/lazyImport";

// A stand-in for sessionStorage, so the guard's behaviour is asserted rather than
// the browser's. `importWithRecovery` takes it as an option for exactly this reason.
function fakeStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
    removeItem: (key: string) => {
      map.delete(key);
    },
    has: (key: string) => map.has(key),
  };
}

const chunkError = () =>
  new TypeError(
    "Failed to fetch dynamically imported module: https://example.test/assets/jspdf.es.min-CJc3fQ-Q.js",
  );

describe("recognising a stale chunk", () => {
  it("matches what browsers actually say", () => {
    expect(isChunkLoadError(chunkError())).toBe(true);
    expect(isChunkLoadError(new Error("Importing a module script failed."))).toBe(true);
    expect(isChunkLoadError(new Error("error loading dynamically imported module"))).toBe(true);
    expect(isChunkLoadError(new Error("Loading chunk 12 failed."))).toBe(true);
  });

  it("does not match a module that loaded and then threw", () => {
    // Reloading here would hide a real bug behind a refresh loop.
    expect(isChunkLoadError(new Error("Cannot read properties of undefined"))).toBe(false);
    expect(isChunkLoadError(new TypeError("jsPDF is not a constructor"))).toBe(false);
    expect(isChunkLoadError(undefined)).toBe(false);
  });
});

describe("recovering from a stale chunk", () => {
  let storage: ReturnType<typeof fakeStorage>;
  let reload: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    storage = fakeStorage();
    reload = vi.fn();
  });

  it("passes a good import straight through, without reloading", async () => {
    const result = await importWithRecovery(async () => "module", { storage, reload });

    expect(result).toBe("module");
    expect(reload).not.toHaveBeenCalled();
    expect(storage.has("character-studio.chunk-reload")).toBe(false);
  });

  it("reloads once when the chunk is gone, and never settles that promise", async () => {
    const settled = vi.fn();
    void importWithRecovery(() => Promise.reject(chunkError()), { storage, reload }).then(settled);

    await Promise.resolve();
    await Promise.resolve();

    expect(reload).toHaveBeenCalledTimes(1);
    // The page is going away: resolving would let React paint a screen the user is
    // about to lose, so this promise deliberately stays pending.
    expect(settled).not.toHaveBeenCalled();
  });

  it("does not reload a second time, so a persistent failure cannot loop", async () => {
    storage.setItem("character-studio.chunk-reload", "1");

    await expect(
      importWithRecovery(() => Promise.reject(chunkError()), { storage, reload }),
    ).rejects.toThrow(/Failed to fetch/);

    expect(reload).not.toHaveBeenCalled();
  });

  it("rethrows a real error instead of reloading over it", async () => {
    const boom = new Error("Cannot read properties of undefined");

    await expect(importWithRecovery(() => Promise.reject(boom), { storage, reload })).rejects.toBe(
      boom,
    );
    expect(reload).not.toHaveBeenCalled();
  });

  it("still recovers when the storage it needs is unavailable", async () => {
    // Private mode: the guard cannot be written, so the reload goes ahead unguarded
    // -- better than a dead export button.
    const throwing = {
      getItem: () => null,
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
      removeItem: () => {},
    };

    void importWithRecovery(() => Promise.reject(chunkError()), { storage: throwing, reload });
    await Promise.resolve();
    await Promise.resolve();

    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("clears the guard as the module loads, so the next deploy gets its own reload", async () => {
    // This is the side effect that stops the guard latching forever: the reload that
    // recovers from one stale chunk loads the module again, and that clears the flag
    // so the *next* deploy can recover the same way.
    vi.resetModules();
    sessionStorage.setItem("character-studio.chunk-reload", "1");

    await import("../src/utils/lazyImport");

    expect(sessionStorage.getItem("character-studio.chunk-reload")).toBeNull();
  });
});
