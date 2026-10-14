// @vitest-environment happy-dom
// fake-indexeddb provides the real IndexedDB semantics the store relies on; a
// hand-written stub would let assertions pass while production behaves
// differently.
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import {
  cleanupUnusedAvatarAssets,
  clearAvatarAssets,
  deleteAvatarAsset,
  formatAssetSize,
  getAvatarAsset,
  getAvatarAssetStats,
  listAvatarAssets,
  saveAvatarBlob,
} from "../src/utils/avatarAssets";

const blobOf = (content: string) => new Blob([content], { type: "image/webp" });

describe("formatAssetSize", () => {
  it("never reports a zero size for a non-empty asset", () => {
    expect(formatAssetSize(0)).toBe("1 KB");
    expect(formatAssetSize(512)).toBe("1 KB");
  });

  it("rounds to whole kilobytes below a megabyte", () => {
    expect(formatAssetSize(2048)).toBe("2 KB");
    expect(formatAssetSize(1024 * 1023)).toBe("1023 KB");
  });

  it("switches to megabytes with one decimal", () => {
    expect(formatAssetSize(1024 * 1024)).toBe("1.0 MB");
    expect(formatAssetSize(1024 * 1024 * 1.5)).toBe("1.5 MB");
  });
});

describe("avatar asset store", () => {
  beforeEach(async () => {
    await clearAvatarAssets();
  });

  it("saves a blob and reads it back", async () => {
    const record = await saveAvatarBlob(blobOf("1234"), "主头像");

    expect(record.id).toBeTruthy();
    expect(record.name).toBe("主头像");
    expect(record.size).toBe(4);

    const stored = await getAvatarAsset(record.id);
    expect(stored?.name).toBe("主头像");
    expect(stored?.size).toBe(4);
  });

  it("returns undefined for a missing id instead of throwing", async () => {
    expect(await getAvatarAsset("does-not-exist")).toBeUndefined();
    expect(await getAvatarAsset(undefined)).toBeUndefined();
  });

  it("reports count and total size", async () => {
    await saveAvatarBlob(blobOf("1234"));
    await saveAvatarBlob(blobOf("123456"));

    const stats = await getAvatarAssetStats();
    expect(stats.count).toBe(2);
    expect(stats.size).toBe(10);
  });

  it("deletes one asset and leaves the rest", async () => {
    const first = await saveAvatarBlob(blobOf("a"));
    await saveAvatarBlob(blobOf("b"));

    await deleteAvatarAsset(first.id);

    const remaining = await listAvatarAssets();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].id).not.toBe(first.id);
  });

  it("returns the newest asset first", async () => {
    await saveAvatarBlob(blobOf("older"), "older");
    await saveAvatarBlob(blobOf("newer"), "newer");

    const names = (await listAvatarAssets()).map((asset) => asset.name);
    expect(names.indexOf("newer")).toBeLessThan(names.indexOf("older"));
  });

  it("clears every asset", async () => {
    await saveAvatarBlob(blobOf("a"));
    await saveAvatarBlob(blobOf("b"));

    await clearAvatarAssets();

    expect(await listAvatarAssets()).toEqual([]);
  });

  it("removes only the assets no character references", async () => {
    const inUse = await saveAvatarBlob(blobOf("in-use"), "in-use");
    await saveAvatarBlob(blobOf("orphan"), "orphan");

    const removed = await cleanupUnusedAvatarAssets([inUse.id]);

    expect(removed).toBe(1);
    const remaining = await listAvatarAssets();
    expect(remaining.map((asset) => asset.name)).toEqual(["in-use"]);
  });

  it("treats blank ids as unreferenced when cleaning up", async () => {
    await saveAvatarBlob(blobOf("a"));

    const removed = await cleanupUnusedAvatarAssets(["", undefined as unknown as string]);

    expect(removed).toBe(1);
    expect(await listAvatarAssets()).toEqual([]);
  });
});
