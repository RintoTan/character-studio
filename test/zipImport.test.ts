// A backup is a zip, and most tools that make one deflate its entries — macOS's
// Archive, the Finder's "压缩", every scripting library. Reading only stored entries
// meant a structurally perfect backup was refused as if it were not one.
import { deflateRawSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";
import { readZipEntries } from "../src/utils/importExport";

type FixtureEntry = {
  name: string;
  body: string;
  /** Written the way most zip writers write it, rather than copied through. */
  deflate?: boolean;
  /** Overrides `body` for damaged-input cases. */
  rawBytes?: Uint8Array;
};

function buildZip(entries: FixtureEntry[], options: { method?: number } = {}): File {
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [];

  for (const entry of entries) {
    const raw = entry.rawBytes ?? encoder.encode(entry.body);
    const stored = entry.deflate ? new Uint8Array(deflateRawSync(Buffer.from(raw))) : raw;
    const method = options.method ?? (entry.deflate ? 8 : 0);
    const name = encoder.encode(entry.name);
    const header = new Uint8Array(30 + name.length);
    const view = new DataView(header.buffer);

    view.setUint32(0, 0x04034b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 0x0800, true);
    // The reader does not verify the CRC, so the fixture does not compute one; a
    // mismatched checksum here would be a fixture bug, not a reader bug.
    view.setUint32(14, 0, true);
    view.setUint16(8, method, true);
    view.setUint32(18, stored.length, true);
    view.setUint32(22, raw.length, true);
    view.setUint16(26, name.length, true);
    header.set(name, 30);
    parts.push(header, stored);
  }

  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }

  return new File([bytes], "backup.zip", { type: "application/zip" });
}

const backupEntries = (deflate: boolean): FixtureEntry[] => [
  {
    name: "characters.json",
    body: JSON.stringify({ characters: [{ id: "char-1", name: "林烬", updatedAt: "2026-01-01T00:00:00.000Z" }] }),
    deflate,
  },
  { name: "manifest.json", body: JSON.stringify({ schemaVersion: 1, bindings: [] }), deflate },
  { name: "backup-info.json", body: JSON.stringify({ schemaVersion: 1, appVersion: "2.59.7" }), deflate },
];

describe("reading a backup zip", () => {
  it("inflates entries that were deflated by the tool that wrote them", async () => {
    const entries = await readZipEntries(buildZip(backupEntries(true)));
    const byName = new Map(entries.map((entry) => [entry.name, entry]));

    expect(entries).toHaveLength(3);
    expect(JSON.parse(await byName.get("characters.json")!.blob.text()).characters[0].name).toBe("林烬");
    expect(JSON.parse(await byName.get("manifest.json")!.blob.text())).toEqual({
      schemaVersion: 1,
      bindings: [],
    });
  });

  it("still reads the stored entries this app writes", async () => {
    const entries = await readZipEntries(buildZip(backupEntries(false)));

    expect(entries).toHaveLength(3);
    expect(JSON.parse(await entries[0].blob.text()).characters).toHaveLength(1);
  });

  it("mixes both methods in one archive, as re-zipped backups do", async () => {
    const entries = await readZipEntries(
      buildZip([
        { name: "characters.json", body: JSON.stringify({ characters: [] }), deflate: true },
        { name: "manifest.json", body: JSON.stringify({ bindings: [] }) },
      ]),
    );

    expect(entries.map((entry) => entry.name)).toEqual(["characters.json", "manifest.json"]);
    expect(JSON.parse(await entries[1].blob.text())).toEqual({ bindings: [] });
  });

  it("calls damaged deflate damaged, not unsupported", async () => {
    const damaged = buildZip([{ name: "characters.json", body: "", rawBytes: new Uint8Array([1, 2, 3, 4, 5]) }], {
      method: 8,
    });

    await expect(readZipEntries(damaged)).rejects.toThrow(/解压失败.*可能已损坏/);
  });

  it("names a compression method it cannot read instead of blaming the file", async () => {
    const bzip2 = buildZip([{ name: "characters.json", body: "{}" }], { method: 12 });

    await expect(readZipEntries(bzip2)).rejects.toThrow(/压缩方法 12/);
  });

  it("says the browser cannot decompress when it has no DecompressionStream", async () => {
    // A browser that has never heard of deflate-raw cannot be helped by re-exporting
    // the archive, so the message has to say what to do instead.
    vi.stubGlobal("DecompressionStream", undefined);

    try {
      await expect(readZipEntries(buildZip(backupEntries(true)))).rejects.toThrow(
        /当前浏览器不支持解压压缩过的 ZIP/,
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
