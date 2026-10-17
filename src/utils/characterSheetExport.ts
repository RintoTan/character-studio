// Producing the sheet file: font, avatar, download.
//
// Kept apart from the layout so the layout can be tested without a browser, and apart
// from the preview page so the same file can be produced from the character list.
import fontUrl from "../assets/fonts/NotoSansSC-CS.ttf?url";
import { getAvatarAsset } from "./avatarAssets";
import {
  buildCharacterSheet,
  findUnsupportedCharacters,
  renderCharacterSheetPdf,
  type CharacterSheet,
  type SheetAvatar,
  type SheetInput,
} from "./characterSheetPdf";
import { createGlyphChecker } from "./fontGlyphCoverage";
import { importWithRecovery } from "./lazyImport";

type LoadedFont = { name: string; base64: string; hasGlyph: (char: string) => boolean };

let fontPromise: Promise<LoadedFont> | null = null;

function toBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  // Chunked: spreading a multi-megabyte array into String.fromCharCode throws.
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

/**
 * Fetched once per session. The file is served as a static asset, so a reader who
 * never exports a PDF never downloads it.
 */
function loadFont(): Promise<LoadedFont> {
  if (!fontPromise) {
    fontPromise = (async () => {
      const response = await fetch(fontUrl);
      if (!response.ok) {
        throw new Error("档案字体加载失败");
      }
      const buffer = await response.arrayBuffer();
      return {
        name: "NotoSansSC",
        base64: toBase64(buffer),
        hasGlyph: createGlyphChecker(buffer),
      };
    })().catch((error) => {
      fontPromise = null;
      throw error;
    });
  }

  return fontPromise;
}

const AVATAR_SIZE = 256;

async function drawAvatar(character: SheetInput["character"]): Promise<SheetAvatar | null> {
  const canvas = document.createElement("canvas");
  canvas.width = AVATAR_SIZE;
  canvas.height = AVATAR_SIZE;
  const context = canvas.getContext("2d");

  if (!context) {
    return null;
  }

  // JPEG has no alpha, so the page colour is painted first rather than left black.
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, AVATAR_SIZE, AVATAR_SIZE);

  if (character.avatarAssetId) {
    const asset = await getAvatarAsset(character.avatarAssetId);
    if (asset) {
      const bitmap = await createImageBitmap(asset.blob).catch(() => null);
      if (bitmap) {
        const scale = Math.min(AVATAR_SIZE / bitmap.width, AVATAR_SIZE / bitmap.height);
        const width = bitmap.width * scale;
        const height = bitmap.height * scale;
        context.drawImage(bitmap, (AVATAR_SIZE - width) / 2, (AVATAR_SIZE - height) / 2, width, height);
        bitmap.close?.();
        return { dataUrl: canvas.toDataURL("image/jpeg", 0.86), width: AVATAR_SIZE, height: AVATAR_SIZE };
      }
    }
  }

  const emoji = (character.avatarEmoji ?? "").trim();
  if (!emoji) {
    return null;
  }

  // Emoji are outside the text font. Drawing them here keeps the avatar, instead of
  // printing a missing-glyph box or dropping it from the sheet.
  context.font = `${AVATAR_SIZE * 0.62}px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(emoji, AVATAR_SIZE / 2, AVATAR_SIZE / 2 + AVATAR_SIZE * 0.04);

  return { dataUrl: canvas.toDataURL("image/jpeg", 0.86), width: AVATAR_SIZE, height: AVATAR_SIZE };
}

function stamp() {
  const now = new Date();
  return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
}

function safeName(value: string) {
  return value.replace(/[\\/:*?"<>|\s]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "character";
}

export type SheetExportResult = {
  pages: number;
  bytes: number;
  /** Characters the embedded font could not draw. Empty on the normal path. */
  missing: string[];
};

/**
 * Writes the sheet and hands it to the browser as a download.
 *
 * `includeRelated` is the reader's choice and defaults on: a character sheet without
 * the people they know is a page of fields.
 */
export async function exportCharacterSheetPdf(
  input: SheetInput,
): Promise<SheetExportResult> {
  const [{ jsPDF }, font] = await Promise.all([
    importWithRecovery(() => import("jspdf")),
    loadFont(),
  ]);

  const sheet: CharacterSheet = buildCharacterSheet(input);
  sheet.avatar = await drawAvatar(input.character);

  const missing = findUnsupportedCharacters(sheet, font.hasGlyph);
  const result = renderCharacterSheetPdf(
    // The renderer only passes unit/format/compress, which the constructor takes; its
    // parameter type is a union of every option shape, so it needs a widening cast.
    (options) => new jsPDF(options as unknown as ConstructorParameters<typeof jsPDF>[0]),
    sheet,
    font,
  );

  const blob = result.blob;
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${safeName(input.character.name)}-角色档案-${stamp()}.pdf`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);

  return { pages: result.pages, bytes: blob.size, missing };
}
