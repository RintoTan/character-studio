import type { Character, CharacterTag } from "../types/character";
import {
  dataUrlToBlob,
  getAvatarAsset,
  listAvatarAssets,
  saveAvatarBlob,
} from "./avatarAssets";

type AvatarAssetExportData = {
  sourceId?: string;
  name?: string;
  mimeType?: string;
  size?: number;
  width?: number;
  height?: number;
  createdAt?: string;
  updatedAt?: string;
  dataUrl?: string;
};

type ZipEntry = {
  name: string;
  blob: Blob;
};

const csvHeaders = [
  "名字",
  "性别",
  "年龄",
  "种族",
  "职业",
  "世界观",
  "性格标签",
  "视觉风格",
  "外貌描述",
  "能力描述",
  "背景故事",
  "中文关键词",
  "英文 AI Prompt",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function dateStamp() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");

  return `${year}${month}${day}`;
}

function safeFileName(value: string) {
  return (value || "未命名角色")
    .trim()
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, "-");
}

function asString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function asStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function asAvatarAssetData(value: unknown): AvatarAssetExportData | null {
  if (!isRecord(value)) {
    return null;
  }

  const dataUrl = asString(value.dataUrl);

  if (!dataUrl.startsWith("data:image/")) {
    return null;
  }

  return {
    sourceId: asString(value.sourceId),
    name: asString(value.name),
    mimeType: asString(value.mimeType),
    size: typeof value.size === "number" ? value.size : undefined,
    width: typeof value.width === "number" ? value.width : undefined,
    height: typeof value.height === "number" ? value.height : undefined,
    createdAt: asString(value.createdAt),
    updatedAt: asString(value.updatedAt),
    dataUrl,
  };
}

function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function asTags(value: unknown): CharacterTag[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item): CharacterTag | null => {
      if (typeof item === "string") {
        return { id: crypto.randomUUID(), name: item };
      }

      if (!isRecord(item)) {
        return null;
      }

      const name = asString(item.name).trim();

      if (!name) {
        return null;
      }

      return {
        id: asString(item.id) || crypto.randomUUID(),
        name,
        color: asString(item.color),
      };
    })
    .filter((item): item is CharacterTag => item !== null);
}

function mergeTags(tags: CharacterTag[], personalityTags: string[]) {
  const tagMap = new Map<string, CharacterTag>();

  tags.forEach((tag) => {
    if (tag.name.trim()) {
      tagMap.set(tag.name, {
        ...tag,
        color: tag.color || "gray",
      });
    }
  });

  personalityTags.forEach((tagName) => {
    if (tagName.trim() && !tagMap.has(tagName)) {
      tagMap.set(tagName, {
        id: `personality-${tagName}`,
        name: tagName,
        color: "gray",
      });
    }
  });

  return Array.from(tagMap.values());
}

function normalizeCharacter(value: unknown, existingIds: Set<string>): Character | null {
  if (!isRecord(value)) {
    return null;
  }

  const sourceId = asString(value.id);
  const id = sourceId && !existingIds.has(sourceId) ? sourceId : crypto.randomUUID();
  existingIds.add(id);

  const importedTags = asTags(value.tags);
  const personalityTags = mergeTags(
    importedTags,
    asStringArray(value.personalityTags),
  ).map((tag) => tag.name);

  return {
    id,
    name: asString(value.name) || "未命名角色",
    avatarEmoji: asString(value.avatarEmoji),
    avatarAssetId: asString(value.avatarAssetId),
    favorite: value.favorite === true || value.isFavorite === true,
    isFavorite: undefined,
    isDraft: value.isDraft === true,
    draftOfId: asString(value.draftOfId),
    gender: asString(value.gender),
    age: asString(value.age),
    birthDate: asString(value.birthDate),
    birthYear: asString(value.birthYear),
    species: asString(value.species),
    occupation: asString(value.occupation),
    worldview: asString(value.worldview),
    tags: importedTags,
    personalityTags,
    appearanceDescription: asString(value.appearanceDescription),
    abilityDescription: asString(value.abilityDescription),
    backstory: asString(value.backstory),
    visualStyle: asString(value.visualStyle),
    characterKeywords: asString(value.characterKeywords),
    imagePrompt: asString(value.imagePrompt),
    createdAt: asString(value.createdAt) || new Date().toISOString(),
    updatedAt: asString(value.updatedAt) || new Date().toISOString(),
  };
}

function getCharacterCandidates(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }

  if (isRecord(value) && Array.isArray(value.characters)) {
    return value.characters;
  }

  return [value];
}

function downloadBlob(content: BlobPart, filename: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function exportNodeName(characterName: string, extension: string) {
  return `${safeFileName(characterName)}-${dateStamp()}.${extension}`;
}

async function getAvatarAssetExportData(assetId?: string): Promise<AvatarAssetExportData | undefined> {
  if (!assetId) {
    return undefined;
  }

  const asset = await getAvatarAsset(assetId);

  if (!asset) {
    return undefined;
  }

  return {
    sourceId: asset.id,
    name: asset.name || "avatar",
    mimeType: asset.mimeType || asset.blob.type || "image/webp",
    size: asset.size || asset.blob.size,
    width: asset.width || 512,
    height: asset.height || 512,
    createdAt: asset.createdAt,
    updatedAt: asset.updatedAt,
    dataUrl: await blobToDataUrl(asset.blob),
  };
}

export async function exportCharacterJson(character: Character) {
  const filename = `character-studio-${safeFileName(character.name)}-${dateStamp()}.json`;
  const avatarAssetData = await getAvatarAssetExportData(character.avatarAssetId);
  const payload = avatarAssetData
    ? {
        ...character,
        avatarAssetData,
      }
    : character;

  downloadBlob(JSON.stringify(payload, null, 2), filename, "application/json");
}

export function exportAllCharactersJson(characters: Character[]) {
  const filename = `character-studio-all-${dateStamp()}.json`;
  const payload = {
    exportedAt: new Date().toISOString(),
    characters,
  };

  downloadBlob(JSON.stringify(payload, null, 2), filename, "application/json");
}

export async function exportFullBackupJson(characters: Character[]) {
  const usedAssetIds = Array.from(
    new Set(
      characters
        .map((character) => character.avatarAssetId)
        .filter((id): id is string => Boolean(id)),
    ),
  );
  const avatarAssets = (
    await Promise.all(
      usedAssetIds.map(async (assetId) => {
        const asset = await getAvatarAsset(assetId);

        if (!asset) {
          return null;
        }

        return {
          sourceId: asset.id,
          name: asset.name || "avatar",
          mimeType: asset.mimeType || asset.blob.type || "image/webp",
          size: asset.size || asset.blob.size,
          width: asset.width || 512,
          height: asset.height || 512,
          createdAt: asset.createdAt,
          updatedAt: asset.updatedAt,
          dataUrl: await blobToDataUrl(asset.blob),
        };
      }),
    )
  ).filter((asset): asset is NonNullable<typeof asset> => asset !== null);
  const payload = {
    exportType: "character-studio-full-backup",
    exportedAt: new Date().toISOString(),
    note: "完整备份包含当前浏览器 IndexedDB 中可读取的头像图片。轻量 JSON 不包含头像图片，跨设备不会自动恢复图片。",
    characters,
    avatarAssets,
  };

  downloadBlob(
    JSON.stringify(payload, null, 2),
    `character-studio-full-backup-${dateStamp()}.json`,
    "application/json",
  );
}

export async function exportFullBackupZip(characters: Character[]) {
  const usedAssetIds = Array.from(
    new Set(
      characters
        .map((character) => character.avatarAssetId)
        .filter((id): id is string => Boolean(id)),
    ),
  );
  const assets = (
    await Promise.all(
      usedAssetIds.map(async (assetId) => {
        const asset = await getAvatarAsset(assetId);
        return asset ? { assetId, asset } : null;
      }),
    )
  ).filter((item): item is NonNullable<typeof item> => item !== null);
  const assetFileById = new Map<string, string>();
  const files: Array<{ name: string; blob: Blob }> = [];

  assets.forEach(({ asset }, index) => {
    const extension = (asset.mimeType || asset.blob.type || "image/webp").includes("png")
      ? "png"
      : (asset.mimeType || asset.blob.type || "image/webp").includes("jpeg")
        ? "jpg"
        : "webp";
    const file = `assets/avatar/avatar-${index + 1}.${extension}`;
    assetFileById.set(asset.id, file);
    files.push({ name: file, blob: asset.blob });
  });

  const manifest = {
    schemaVersion: 1,
    bindings: characters
      .filter((character) => character.avatarAssetId && assetFileById.has(character.avatarAssetId))
      .map((character) => {
        const asset = assets.find((item) => item.asset.id === character.avatarAssetId)?.asset;
        return {
          sourceCharacterId: character.id,
          sourceAssetKey: character.avatarAssetId,
          assetFile: character.avatarAssetId ? assetFileById.get(character.avatarAssetId) : "",
          hash: character.avatarAssetId,
          mimeType: asset?.mimeType || asset?.blob.type || "image/webp",
          size: asset?.size || asset?.blob.size || 0,
        };
      }),
  };
  const backupInfo = {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    appVersion: "0.1.0",
    characterCount: characters.length,
    avatarAssetCount: assets.length,
    assetTotalSize: assets.reduce((sum, item) => sum + (item.asset.size || item.asset.blob.size), 0),
    exportType: "character-studio-full-backup-zip",
    notes: "完整备份 ZIP 包含角色数据和头像素材。头像绑定仅依据 manifest，不根据文件名或旧 ID 猜测。",
  };

  files.unshift(
    {
      name: "characters.json",
      blob: new Blob([JSON.stringify({ characters }, null, 2)], { type: "application/json" }),
    },
    {
      name: "manifest.json",
      blob: new Blob([JSON.stringify(manifest, null, 2)], { type: "application/json" }),
    },
    {
      name: "backup-info.json",
      blob: new Blob([JSON.stringify(backupInfo, null, 2)], { type: "application/json" }),
    },
  );

  downloadBlob(
    await createZipBlob(files),
    `character-studio-full-backup-${dateStamp()}.zip`,
    "application/zip",
  );
}

export function exportSelectedCharactersJson(characters: Character[]) {
  const filename = `character-studio-selected-${dateStamp()}.json`;
  const payload = characters.length === 1 ? characters[0] : characters;

  downloadBlob(JSON.stringify(payload, null, 2), filename, "application/json");
}

function escapeCsvCell(value: string) {
  const normalizedValue = value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  return `"${normalizedValue.replace(/"/g, '""')}"`;
}

export function exportCharactersCsv(characters: Character[]) {
  const rows = characters.map((character) => [
    character.name || "",
    character.gender || "",
    character.age || "",
    character.species || "",
    character.occupation || "",
    character.worldview || "",
    character.personalityTags?.join("、") || "",
    character.visualStyle || "",
    character.appearanceDescription || "",
    character.abilityDescription || "",
    character.backstory || "",
    character.characterKeywords || "",
    character.imagePrompt || "",
  ]);
  const csv = [csvHeaders, ...rows]
    .map((row) => row.map(escapeCsvCell).join(","))
    .join("\n");

  downloadBlob(`\uFEFF${csv}`, `character-studio-all-${dateStamp()}.csv`, "text/csv;charset=utf-8");
}

export async function importCharactersFromFiles(
  files: FileList,
  existingCharacters: Character[],
) {
  const existingIds = new Set(existingCharacters.map((character) => character.id));
  const importedCharacters: Character[] = [];

  for (const file of Array.from(files)) {
    if (isZipFile(file)) {
      importedCharacters.push(...(await importCharactersFromBackupZip(file, existingIds)));
      continue;
    }

    const text = await file.text();
    const parsedValue = JSON.parse(text) as unknown;
    const avatarIdMap = await restoreAvatarAssets(parsedValue);
    const candidates = getCharacterCandidates(parsedValue);

    for (const candidate of candidates) {
      const character = normalizeCharacter(candidate, existingIds);

      if (character) {
        if (isRecord(candidate)) {
          const avatarAssetData = asAvatarAssetData(candidate.avatarAssetData);
          if (avatarAssetData?.dataUrl) {
            const asset = await saveAvatarBlob(
              dataUrlToBlob(avatarAssetData.dataUrl),
              avatarAssetData.name || `${character.name || "avatar"}-avatar`,
            );
            character.avatarAssetId = asset.id;
          }
        }
        character.avatarAssetId =
          avatarIdMap.get(character.avatarAssetId || "") || character.avatarAssetId;
        importedCharacters.push(character);
      }
    }
  }

  if (importedCharacters.length === 0) {
    throw new Error("没有找到可导入的角色数据");
  }

  return [...importedCharacters, ...existingCharacters];
}

function isZipFile(file: File) {
  return file.name.toLowerCase().endsWith(".zip") || file.type === "application/zip";
}

async function importCharactersFromBackupZip(file: File, existingIds: Set<string>) {
  const entries = await readStoredZip(file);
  const entryByName = new Map(entries.map((entry) => [entry.name, entry]));
  const charactersEntry = entryByName.get("characters.json");

  if (!charactersEntry) {
    throw new Error("完整备份缺少 characters.json");
  }

  const charactersValue = JSON.parse(await charactersEntry.blob.text()) as unknown;
  const manifestEntry = entryByName.get("manifest.json");
  const manifestValue = manifestEntry
    ? (JSON.parse(await manifestEntry.blob.text()) as unknown)
    : undefined;
  const sourceAssetToNewAsset = await restoreZipAvatarAssets(entries, manifestValue);
  const candidates = getCharacterCandidates(charactersValue);
  const importedCharacters: Character[] = [];

  for (const candidate of candidates) {
    const sourceCharacterId = isRecord(candidate) ? asString(candidate.id) : "";
    const character = normalizeCharacter(candidate, existingIds);

    if (!character) {
      continue;
    }

    const boundAssetId = findManifestBoundAssetId(
      manifestValue,
      sourceCharacterId,
      sourceAssetToNewAsset,
    );

    character.avatarAssetId = boundAssetId || "";
    importedCharacters.push(character);
  }

  return importedCharacters;
}

async function restoreAvatarAssets(value: unknown) {
  const avatarIdMap = new Map<string, string>();

  if (!isRecord(value) || !Array.isArray(value.avatarAssets)) {
    return avatarIdMap;
  }

  const existingAssets = await listAvatarAssets();
  const existingDataUrls = new Map<string, string>();

  await Promise.all(
    existingAssets.map(async (asset) => {
      existingDataUrls.set(await blobToDataUrl(asset.blob), asset.id);
    }),
  );

  for (const item of value.avatarAssets) {
    if (!isRecord(item)) {
      continue;
    }

    const sourceId = asString(item.sourceId) || asString(item.id);
    const dataUrl = asString(item.dataUrl);

    if (!sourceId || !dataUrl.startsWith("data:image/")) {
      continue;
    }

    const existingId = existingDataUrls.get(dataUrl);

    if (existingId) {
      avatarIdMap.set(sourceId, existingId);
      continue;
    }

    const blob = dataUrlToBlob(dataUrl);
    const asset = await saveAvatarBlob(blob, asString(item.name) || "avatar");
    avatarIdMap.set(sourceId, asset.id);
    existingDataUrls.set(dataUrl, asset.id);
  }

  return avatarIdMap;
}

async function restoreZipAvatarAssets(entries: ZipEntry[], manifestValue: unknown) {
  const sourceAssetToNewAsset = new Map<string, string>();
  const assetEntries = entries.filter((entry) => entry.name.startsWith("assets/avatar/"));
  const bindings = getManifestBindings(manifestValue);
  const existingAssets = await listAvatarAssets();
  const existingDataUrls = new Map<string, string>();

  await Promise.all(
    existingAssets.map(async (asset) => {
      existingDataUrls.set(await blobToDataUrl(asset.blob), asset.id);
    }),
  );

  for (const entry of assetEntries) {
    const mimeType = mimeTypeFromFileName(entry.name);
    const blob = new Blob([await entry.blob.arrayBuffer()], { type: mimeType });
    const dataUrl = await blobToDataUrl(blob);
    const existingId = existingDataUrls.get(dataUrl);
    const asset = existingId
      ? { id: existingId }
      : await saveAvatarBlob(blob, entry.name.split("/").pop() || "avatar");

    if (!existingId) {
      existingDataUrls.set(dataUrl, asset.id);
    }

    bindings
      .filter((binding) => binding.assetFile === entry.name && binding.sourceAssetKey)
      .forEach((binding) => sourceAssetToNewAsset.set(binding.sourceAssetKey, asset.id));
  }

  return sourceAssetToNewAsset;
}

function getManifestBindings(value: unknown) {
  if (!isRecord(value) || !Array.isArray(value.bindings)) {
    return [];
  }

  return value.bindings
    .filter(isRecord)
    .map((binding) => ({
      sourceCharacterId: asString(binding.sourceCharacterId),
      sourceAssetKey: asString(binding.sourceAssetKey),
      assetFile: asString(binding.assetFile),
    }))
    .filter((binding) => binding.assetFile);
}

function findManifestBoundAssetId(
  manifestValue: unknown,
  sourceCharacterId: string,
  sourceAssetToNewAsset: Map<string, string>,
) {
  if (!sourceCharacterId) {
    return "";
  }

  const binding = getManifestBindings(manifestValue).find(
    (item) => item.sourceCharacterId === sourceCharacterId,
  );

  return binding ? sourceAssetToNewAsset.get(binding.sourceAssetKey) || "" : "";
}

function mimeTypeFromFileName(fileName: string) {
  const lowerName = fileName.toLowerCase();

  if (lowerName.endsWith(".png")) {
    return "image/png";
  }

  if (lowerName.endsWith(".jpg") || lowerName.endsWith(".jpeg")) {
    return "image/jpeg";
  }

  return "image/webp";
}

async function readStoredZip(file: File): Promise<ZipEntry[]> {
  const buffer = await file.arrayBuffer();
  const view = new DataView(buffer);
  const decoder = new TextDecoder();
  const entries: ZipEntry[] = [];
  let offset = 0;

  while (offset + 30 <= buffer.byteLength && view.getUint32(offset, true) === 0x04034b50) {
    const method = view.getUint16(offset + 8, true);
    const compressedSize = view.getUint32(offset + 18, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const dataEnd = dataStart + compressedSize;

    if (method !== 0 || dataEnd > buffer.byteLength) {
      throw new Error("暂不支持压缩过的 ZIP，请导入 Character Studio 导出的完整备份");
    }

    const name = decoder.decode(new Uint8Array(buffer, nameStart, nameLength));
    entries.push({
      name,
      blob: new Blob([buffer.slice(dataStart, dataEnd)]),
    });
    offset = dataEnd;
  }

  if (entries.length === 0) {
    throw new Error("ZIP 文件中没有可读取的备份内容");
  }

  return entries;
}

async function capturePreviewCanvas(element: HTMLElement) {
  if (!element.isConnected) {
    throw new Error("找不到可导出的角色展示区域");
  }

  element.classList.add("pdf-safe");
  await waitForAvatarImages(element);
  await waitForImages(element);
  await new Promise((resolve) => window.requestAnimationFrame(resolve));

  const bounds = element.getBoundingClientRect();

  if (bounds.width <= 0 || bounds.height <= 0) {
    element.classList.remove("pdf-safe");
    throw new Error("角色展示区域尺寸异常，无法导出 PDF");
  }

  try {
    const { default: html2canvas } = await import("html2canvas");

    return await html2canvas(element, {
      backgroundColor: "#f3f4f6",
      height: Math.ceil(bounds.height),
      onclone: (documentClone) => {
        documentClone.documentElement.dataset.theme = "light";
        documentClone.body.style.background = "#f3f4f6";
        documentClone.body.style.color = "#111827";

        const exportRoot = documentClone.querySelector<HTMLElement>(
          "[data-pdf-export-root='true']",
        );

        if (exportRoot) {
          exportRoot.classList.add("pdf-safe");
          exportRoot.style.background = "#f3f4f6";
          exportRoot.style.color = "#111827";

          exportRoot.querySelectorAll<HTMLElement>("*").forEach((item) => {
            item.style.backgroundImage = "none";
            item.style.boxShadow = "none";
            item.style.textShadow = "none";
          });
        }

        documentClone
          .querySelectorAll(
            "[data-pdf-hidden='true'], input, select, textarea",
          )
          .forEach((item) => {
            item.setAttribute("style", "display: none !important;");
          });
      },
      scale: 2,
      scrollX: 0,
      scrollY: 0,
      useCORS: true,
      width: Math.ceil(bounds.width),
      windowHeight: Math.max(
        document.documentElement.scrollHeight,
        window.innerHeight,
      ),
      windowWidth: Math.max(
        document.documentElement.scrollWidth,
        window.innerWidth,
      ),
    });
  } finally {
    element.classList.remove("pdf-safe");
  }
}

async function waitForImages(element: HTMLElement) {
  const images = Array.from(element.querySelectorAll("img"));

  await Promise.all(
    images.map(
      (image) =>
        new Promise<void>((resolve) => {
          if (image.complete) {
            resolve();
            return;
          }

          image.onload = () => resolve();
          image.onerror = () => resolve();
        }),
    ),
  );
}

async function waitForAvatarImages(element: HTMLElement) {
  const deadline = Date.now() + 1200;

  while (Date.now() < deadline) {
    const pendingAvatars = Array.from(
      element.querySelectorAll<HTMLElement>("[data-avatar-asset='true']"),
    ).filter((avatar) => avatar.dataset.avatarImage !== "true");

    if (pendingAvatars.length === 0) {
      return;
    }

    await new Promise((resolve) => window.setTimeout(resolve, 50));
  }
}

export async function exportPreviewImage(
  element: HTMLElement,
  characterName: string,
  format: "png" | "jpg",
  quality = 0.9,
) {
  const canvas = await capturePreviewCanvas(element);

  if (canvas.width <= 0 || canvas.height <= 0) {
    throw new Error("图片截图生成失败");
  }

  const mimeType = format === "jpg" ? "image/jpeg" : "image/png";
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, mimeType, format === "jpg" ? quality : undefined),
  );

  if (!blob) {
    throw new Error("图片导出失败");
  }

  downloadBlob(blob, exportNodeName(characterName, format), mimeType);
}

async function createPreviewPdfBlob(element: HTMLElement) {
  const [{ jsPDF }, canvas] = await Promise.all([
    import("jspdf"),
    capturePreviewCanvas(element),
  ]);

    if (canvas.width <= 0 || canvas.height <= 0) {
      throw new Error("PDF 截图生成失败");
    }

    const imageData = canvas.toDataURL("image/png");
    const pdf = new jsPDF("p", "mm", "a4");
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const imageWidth = pageWidth;
    const imageHeight = (canvas.height * imageWidth) / canvas.width;
    let position = 0;
    let remainingHeight = imageHeight;

    pdf.addImage(imageData, "PNG", 0, position, imageWidth, imageHeight);
    remainingHeight -= pageHeight;

    while (remainingHeight > 0) {
      position -= pageHeight;
      pdf.addPage();
      pdf.addImage(imageData, "PNG", 0, position, imageWidth, imageHeight);
      remainingHeight -= pageHeight;
    }

    return pdf.output("blob");
}

export async function exportPreviewPdf(element: HTMLElement, characterName: string) {
  const blob = await createPreviewPdfBlob(element);
  downloadBlob(blob, exportNodeName(characterName, "pdf"), "application/pdf");
}

async function getAvatarSnapshotHtml(character: Character) {
  if (character.avatarAssetId) {
    try {
      const asset = await getAvatarAsset(character.avatarAssetId);
      if (asset) {
        const dataUrl = await blobToDataUrl(asset.blob);
        return `<div class="preview-avatar"><img alt="" src="${dataUrl}" /></div>`;
      }
    } catch {
      // Fall back to emoji below.
    }
  }

  return `<div class="preview-avatar">${character.avatarEmoji || "🙂"}</div>`;
}

async function createSnapshotElement(character: Character) {
  const element = document.createElement("div");
  element.dataset.pdfExportRoot = "true";
  element.className = "snapshot-export pdf-safe";
  const avatarHtml = await getAvatarSnapshotHtml(character);
  element.innerHTML = `
    <section class="preview-hero">
      <div class="preview-identity">
        ${avatarHtml}
        <div>
          <p class="eyebrow">Character Preview</p>
          <h1>${escapeHtml(character.name || "未命名角色")}</h1>
          <p class="muted">${escapeHtml(character.occupation || "未填写")} / ${escapeHtml(character.worldview || "未填写")}</p>
        </div>
      </div>
    </section>
    <section class="preview-layout">
      ${snapshotCard("基础资料", [
        `性别：${character.gender || "未填写"}`,
        `年龄：${character.age || "未填写"}`,
        `种族：${character.species || "未填写"}`,
        `职业：${character.occupation || "未填写"}`,
        `世界观：${character.worldview || "未填写"}`,
      ].join("\\n"))}
      ${snapshotCard("性格标签", character.personalityTags?.join("、") || "未填写")}
      ${snapshotCard("外貌描述", character.appearanceDescription || "未填写")}
      ${snapshotCard("能力描述", character.abilityDescription || "未填写")}
      ${snapshotCard("背景故事", character.backstory || "未填写")}
      ${snapshotCard("中文人物关键词", character.characterKeywords || "未填写")}
      ${snapshotCard("英文 AI Prompt", character.imagePrompt || "未填写")}
    </section>
  `;
  document.body.appendChild(element);
  return element;
}

async function createCharacterSnapshotBlob(
  character: Character,
  format: "pdf" | "png" | "jpg",
) {
  const element = await createSnapshotElement(character);

  try {
    if (format === "pdf") {
      return {
        blob: await createPreviewPdfBlob(element),
        type: "application/pdf",
      };
    }

    const canvas = await capturePreviewCanvas(element);
    const type = format === "jpg" ? "image/jpeg" : "image/png";
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, type, format === "jpg" ? 0.9 : undefined),
    );

    if (!blob) {
      throw new Error("图片导出失败");
    }

    return { blob, type };
  } finally {
    element.remove();
  }
}

export async function exportCharacterSnapshot(
  character: Character,
  format: "pdf" | "png" | "jpg",
) {
  const { blob, type } = await createCharacterSnapshotBlob(character, format);
  downloadBlob(blob, exportNodeName(character.name || "未命名角色", format), type);
}

export async function exportCharacterSnapshotsZip(
  characters: Character[],
  format: "pdf" | "png" | "jpg",
  onProgress?: (current: number, total: number) => void,
) {
  const files: Array<{ name: string; blob: Blob }> = [];
  let failedCount = 0;
  const usedNames = new Map<string, number>();

  for (let index = 0; index < characters.length; index += 1) {
    const character = characters[index];
    onProgress?.(index + 1, characters.length);

    try {
      const { blob } = await createCharacterSnapshotBlob(character, format);
      const baseName = safeFileName(character.name || "未命名角色");
      const count = usedNames.get(baseName) || 0;
      usedNames.set(baseName, count + 1);
      files.push({
        name: `${baseName}${count > 0 ? `-${count + 1}` : ""}.${format}`,
        blob,
      });
    } catch {
      failedCount += 1;
    }
  }

  const zipBlob = await createZipBlob(files);
  downloadBlob(
    zipBlob,
    `character-studio-export-${dateStamp()}.zip`,
    "application/zip",
  );

  return { failedCount };
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function snapshotCard(title: string, content: string) {
  return `
    <article class="preview-card wide-card">
      <div class="preview-card-title"><h2>${escapeHtml(title)}</h2></div>
      <p>${escapeHtml(content)}</p>
    </article>
  `;
}

async function createZipBlob(files: Array<{ name: string; blob: Blob }>) {
  const encoder = new TextEncoder();
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;

  for (const file of files) {
    const data = new Uint8Array(await file.blob.arrayBuffer());
    const name = encoder.encode(file.name);
    const crc = crc32(data);
    const { time, date } = dosDateTime(new Date());
    const localHeader = new Uint8Array(30 + name.length);
    const localView = new DataView(localHeader.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, 0x0800, true);
    localView.setUint16(8, 0, true);
    localView.setUint16(10, time, true);
    localView.setUint16(12, date, true);
    localView.setUint32(14, crc, true);
    localView.setUint32(18, data.length, true);
    localView.setUint32(22, data.length, true);
    localView.setUint16(26, name.length, true);
    localHeader.set(name, 30);
    localParts.push(localHeader, data);

    const centralHeader = new Uint8Array(46 + name.length);
    const centralView = new DataView(centralHeader.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, 0x0800, true);
    centralView.setUint16(10, 0, true);
    centralView.setUint16(12, time, true);
    centralView.setUint16(14, date, true);
    centralView.setUint32(16, crc, true);
    centralView.setUint32(20, data.length, true);
    centralView.setUint32(24, data.length, true);
    centralView.setUint16(28, name.length, true);
    centralView.setUint32(42, offset, true);
    centralHeader.set(name, 46);
    centralParts.push(centralHeader);

    offset += localHeader.length + data.length;
  }

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const endHeader = new Uint8Array(22);
  const endView = new DataView(endHeader.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, files.length, true);
  endView.setUint16(10, files.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, offset, true);

  const zipData = concatBytes([...localParts, ...centralParts, endHeader]);

  return new Blob([zipData.buffer], {
    type: "application/zip",
  });
}

function concatBytes(parts: Uint8Array[]) {
  const totalLength = parts.reduce((sum, part) => sum + part.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;

  parts.forEach((part) => {
    result.set(part, offset);
    offset += part.length;
  });

  return result;
}

function dosDateTime(date: Date) {
  return {
    time:
      (date.getHours() << 11) |
      (date.getMinutes() << 5) |
      Math.floor(date.getSeconds() / 2),
    date:
      ((date.getFullYear() - 1980) << 9) |
      ((date.getMonth() + 1) << 5) |
      date.getDate(),
  };
}

function crc32(data: Uint8Array) {
  let crc = 0xffffffff;

  for (const byte of data) {
    crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 0xff];
  }

  return (crc ^ 0xffffffff) >>> 0;
}

const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index;

  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }

  return value >>> 0;
});
