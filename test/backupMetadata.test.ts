// The backup metadata is read by people, not by the importer: a reader comparing two
// backups uses `appVersion` to tell which build produced which. It was a literal
// "0.1.0" for long enough that every archive claimed the same ancient version, so this
// reads the bytes that were actually written rather than the object that built them.
//
// The archive is stored (uncompressed), which is why the JSON text can be found
// verbatim in the container; that keeps the assertion independent of the ZIP reader
// the importer happens to use.
// @vitest-environment happy-dom
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { APP_VERSION } from "../src/config/version";
import type { Character } from "../src/types/character";
import { exportFullBackupZip } from "../src/utils/importExport";

const downloads: Blob[] = [];

const character = (overrides: Partial<Character> = {}): Character => ({
  id: "char-1",
  name: "林烬",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...overrides,
});

async function exportedBackupText(characters: Character[]) {
  downloads.length = 0;
  await exportFullBackupZip(characters);
  expect(downloads).toHaveLength(1);
  return new TextDecoder().decode(new Uint8Array(await downloads[0].arrayBuffer()));
}

beforeEach(() => {
  URL.createObjectURL = ((blob: Blob) => {
    downloads.push(blob);
    return "blob:character-studio-test";
  }) as typeof URL.createObjectURL;
  URL.revokeObjectURL = (() => undefined) as typeof URL.revokeObjectURL;
});

describe("full-backup metadata", () => {
  it("names the version that wrote the file", async () => {
    const text = await exportedBackupText([character()]);

    expect(text).toContain(`"appVersion": "${APP_VERSION}"`);
    expect(text).not.toContain('"appVersion": "0.1.0"');
  });

  it("keeps the rest of the metadata shape unchanged", async () => {
    const text = await exportedBackupText([character(), character({ id: "char-2" })]);

    expect(text).toContain('"schemaVersion": 1');
    expect(text).toContain('"exportType": "character-studio-full-backup-zip"');
    expect(text).toContain('"characterCount": 2');
  });
});
