import type { Character, CharacterTag } from "../types/character";
import { RELATIONSHIP_KINDS } from "../types/relationship";
import { TIMELINE_EVENT_KINDS } from "../types/timeline";
import { WORLD_CATEGORIES } from "../types/world";
import {
  dataUrlToBlob,
  getAvatarAsset,
  listAvatarAssets,
  saveAvatarBlob,
} from "./avatarAssets";
// The two export libraries are large enough to load on demand, which makes them the
// most likely thing in the app to be asked for by a page a deploy has moved on from.
import { importWithRecovery } from "./lazyImport";
import {
  WORKSPACE_BACKUP_VERSION,
  applyWorkspaceDatasets,
  countWorkspaceDatasets,
  extractWorkspaceDatasets,
  type WorkspaceApplyResult,
  type WorkspaceCounts,
  type WorkspaceDatasets,
} from "../storage/workspaceBackup";
import {
  CSV_ROW_TYPES,
  CSV_TYPE_HEADER,
  WORKSPACE_CSV_HEADERS,
  readWorkspaceRowsFromCsv,
  resolveWorkspaceRows,
  splitList,
  type CsvWorkspaceRows,
  type NameToId,
} from "./workspaceCsv";

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

type PreparedAvatarAsset = {
  sourceKey: string;
  name: string;
  blob: Blob;
  dataUrl: string;
};

type PreparedCharacter = {
  character: Character;
  avatarSourceKey?: string;
};

// Counts the character references a CSV could not turn into links. Those rows are in
// the file but name someone the import cannot identify, so they are left out and the
// author is told how many. The alternative - attaching them to a guess - produced
// relationships that looked valid and pointed at the wrong character (KI-14).
function countUnresolvedReferences(
  rows: CsvWorkspaceRows,
  nameToId: NameToId,
  ambiguous: ReadonlySet<string>,
): { ambiguous: number; missing: number } {
  const counts = { ambiguous: 0, missing: 0 };

  const tally = (name: string) => {
    const trimmed = name.trim();
    if (!trimmed || nameToId.has(trimmed)) {
      return;
    }
    counts[ambiguous.has(trimmed) ? "ambiguous" : "missing"] += 1;
  };

  for (const row of rows.relationships) {
    tally(row.fromName);
    tally(row.toName);
  }
  for (const row of rows.world) {
    tally(row.parentName);
  }
  for (const row of rows.timeline) {
    for (const name of splitList(row.characterNames)) {
      tally(name);
    }
  }

  return counts;
}

export type CharacterImportPreview = {
  roleCount: number;
  avatarCount: number;
  autoMatchedAvatarCount: number;
  unmatchedAvatarCount: number;
  duplicateAssetCount: number;
  duplicateCharacterCount: number;
  hasBackupInfo: boolean;
  dataVersion: string;
  importType: "json" | "zip" | "csv" | "mixed";
  /** Counts for the relationship graph, the timeline and the world book, when the
   *  file carries them. Null for the character-only formats that predate them. */
  workspaceCounts: WorkspaceCounts | null;
  /** Character references a CSV named but could not identify: names that match more
   *  than one character, and names that match none. Neither is imported. */
  unresolvedReferences: { ambiguous: number; missing: number };
};

export type PreparedCharacterImport = {
  characters: PreparedCharacter[];
  avatarAssets: PreparedAvatarAsset[];
  preview: CharacterImportPreview;
  workspace: WorkspaceDatasets | null;
};

export type CharacterImportCommitResult = {
  characters: Character[];
  importedCharacterCount: number;
  importedAvatarCount: number;
  autoBoundAvatarCount: number;
  unboundAvatarCount: number;
  /** Null when the file carried characters only. */
  workspace: WorkspaceApplyResult | null;
};

const csvHeaders = [
  CSV_TYPE_HEADER,
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
    // These five are editable profile fields (see the "more" section of the editor).
    // The importer used to rebuild the record field by field and simply omitted them,
    // so a backup round trip silently emptied them.
    likes: asString(value.likes),
    dislikes: asString(value.dislikes),
    habits: asString(value.habits),
    importantItems: asString(value.importantItems),
    relationshipKeywords: asString(value.relationshipKeywords),
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

export async function exportFullBackupJson(
  characters: Character[],
  workspace: WorkspaceDatasets | null = null,
) {
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
    note: "完整备份包含当前浏览器 IndexedDB 中可读取的头像图片，以及关系网、世界观与时间线。轻量 JSON 不包含头像图片，跨设备不会自动恢复图片。",
    workspaceVersion: WORKSPACE_BACKUP_VERSION,
    characters,
    avatarAssets,
    // The three domains that used to be unbackupable travel in the same file.
    relationships: workspace?.relationships ?? [],
    timeline: workspace?.timeline ?? [],
    world: workspace?.world ?? [],
  };

  downloadBlob(
    JSON.stringify(payload, null, 2),
    `character-studio-full-backup-${dateStamp()}.json`,
    "application/json",
  );
}

export async function exportFullBackupZip(
  characters: Character[],
  workspace: WorkspaceDatasets | null = null,
) {
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
    notes:
      "完整备份 ZIP 包含角色数据、头像素材，以及关系网、世界观与时间线（workspace.json）。头像绑定仅依据 manifest，不根据文件名或旧 ID 猜测。",
    workspaceVersion: WORKSPACE_BACKUP_VERSION,
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
    {
      name: "workspace.json",
      blob: new Blob(
        [
          JSON.stringify(
            {
              workspaceVersion: WORKSPACE_BACKUP_VERSION,
              relationships: workspace?.relationships ?? [],
              timeline: workspace?.timeline ?? [],
              world: workspace?.world ?? [],
            },
            null,
            2,
          ),
        ],
        { type: "application/json" },
      ),
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

export function exportCharactersCsv(
  characters: Character[],
  workspace: WorkspaceDatasets | null = null,
) {
  // One table for four kinds of row. Rows are filled in by column *label* and then
  // emitted in header order, so a column can be added or moved without every row
  // having to know its position — and the importer reads them the same way.
  const headerRow = [...csvHeaders, ...WORKSPACE_CSV_HEADERS];
  const position = new Map(headerRow.map((label, index) => [label, index]));
  const blankRow = () => headerRow.map(() => "");
  const put = (row: string[], label: string, value: string) => {
    const index = position.get(label);
    if (index !== undefined && value) {
      row[index] = value;
    }
  };
  const text = (value: unknown) => (typeof value === "string" ? value : "");
  const nameById = new Map(characters.map((character) => [character.id, character.name || ""]));
  const nameOf = (value: unknown) => (typeof value === "string" ? nameById.get(value) ?? "" : "");
  const labelOf = (options: ReadonlyArray<{ value: string; label: string }>, value: unknown) =>
    options.find((option) => option.value === value)?.label ?? "";

  const rows: string[][] = [];

  for (const character of characters) {
    const row = blankRow();
    put(row, CSV_TYPE_HEADER, CSV_ROW_TYPES.character);
    put(row, "名字", character.name || "");
    put(row, "性别", character.gender || "");
    put(row, "年龄", character.age || "");
    put(row, "种族", character.species || "");
    put(row, "职业", character.occupation || "");
    put(row, "世界观", character.worldview || "");
    put(row, "性格标签", character.personalityTags?.join("、") || "");
    put(row, "视觉风格", character.visualStyle || "");
    put(row, "外貌描述", character.appearanceDescription || "");
    put(row, "能力描述", character.abilityDescription || "");
    put(row, "背景故事", character.backstory || "");
    put(row, "中文关键词", character.characterKeywords || "");
    put(row, "英文 AI Prompt", character.imagePrompt || "");
    rows.push(row);
  }

  for (const raw of workspace?.relationships ?? []) {
    const record = raw as Record<string, unknown>;
    const row = blankRow();
    put(row, CSV_TYPE_HEADER, CSV_ROW_TYPES.relationship);
    put(row, "源角色", nameOf(record.fromId));
    put(row, "目标角色", nameOf(record.toId));
    put(row, "关系类型", labelOf(RELATIONSHIP_KINDS, record.kind));
    put(row, "备注", text(record.note));
    rows.push(row);
  }

  for (const raw of workspace?.world ?? []) {
    const record = raw as Record<string, unknown>;
    const row = blankRow();
    const parentId = text(record.parentId);
    put(row, CSV_TYPE_HEADER, CSV_ROW_TYPES.world);
    put(row, "名字", text(record.name));
    put(row, "分类", labelOf(WORLD_CATEGORIES, record.category));
    put(row, "父级", parentId ? nameById.get(parentId) ?? "" : "");
    put(row, "标签", Array.isArray(record.tags) ? record.tags.filter((tag) => typeof tag === "string").join("、") : "");
    put(row, "简介", text(record.summary));
    rows.push(row);
  }

  for (const raw of workspace?.timeline ?? []) {
    const record = raw as Record<string, unknown>;
    const row = blankRow();
    const involved = Array.isArray(record.characterIds)
      ? record.characterIds
          .map((id) => nameById.get(text(id)) ?? "")
          .filter(Boolean)
          .join("、")
      : "";
    put(row, CSV_TYPE_HEADER, CSV_ROW_TYPES.timeline);
    put(row, "事件标题", text(record.title));
    put(row, "事件日期", text(record.date));
    put(row, "纪年", text(record.era));
    put(row, "事件类型", labelOf(TIMELINE_EVENT_KINDS, record.kind));
    put(row, "描述", text(record.description));
    put(row, "地点", text(record.location));
    put(row, "涉及角色", involved);
    rows.push(row);
  }

  const csv = [headerRow, ...rows].map((row) => row.map(escapeCsvCell).join(",")).join("\n");

  downloadBlob(`\uFEFF${csv}`, `character-studio-all-${dateStamp()}.csv`, "text/csv;charset=utf-8");
}

export async function importCharactersFromFiles(
  files: FileList,
  existingCharacters: Character[],
) {
  const plan = await prepareCharacterImport(files, existingCharacters);
  const result = await commitCharacterImport(plan, existingCharacters);

  return result.characters;
}

export async function prepareCharacterImport(
  files: FileList,
  existingCharacters: Character[],
): Promise<PreparedCharacterImport> {
  const existingIds = new Set(existingCharacters.map((character) => character.id));
  const preparedCharacters: PreparedCharacter[] = [];
  const preparedAssets: PreparedAvatarAsset[] = [];
  let hasZip = false;
  let hasJson = false;
  let hasCsv = false;
  let hasBackupInfo = false;
  let dataVersion = "旧版 JSON";
  let workspace: WorkspaceDatasets | null = null;
  let csvWorkspaceRows: CsvWorkspaceRows | null = null;

  for (const file of Array.from(files)) {
    if (isZipFile(file)) {
      hasZip = true;
      const prepared = await prepareCharactersFromBackupZip(file, existingIds);
      preparedCharacters.push(...prepared.characters);
      preparedAssets.push(...prepared.avatarAssets);
      hasBackupInfo = hasBackupInfo || prepared.hasBackupInfo;
      dataVersion = prepared.dataVersion || dataVersion;
      workspace = prepared.workspace ?? workspace;
      continue;
    }

    if (isCsvFile(file)) {
      hasCsv = true;
      const prepared = await prepareCharactersFromCsv(file, existingIds);
      preparedCharacters.push(...prepared.characters);
      csvWorkspaceRows = prepared.workspaceRows ?? csvWorkspaceRows;
      dataVersion = prepared.dataVersion;
      continue;
    }

    hasJson = true;
    const prepared = await prepareCharactersFromJson(file, existingIds);
    preparedCharacters.push(...prepared.characters);
    preparedAssets.push(...prepared.avatarAssets);
    hasBackupInfo = hasBackupInfo || prepared.hasBackupInfo;
    dataVersion = prepared.dataVersion || dataVersion;
    workspace = prepared.workspace ?? workspace;
  }

  if (preparedCharacters.length === 0 && !csvWorkspaceRows) {
    throw new Error("没有找到可导入的角色数据");
  }

  // A CSV names characters instead of identifying them, so the rows are turned into
  // edges and links only once every name has an id to point at.
  let unresolvedReferences: { ambiguous: number; missing: number } = { ambiguous: 0, missing: 0 };
  if (csvWorkspaceRows) {
    // A name is not an identity. Two characters can share one - across worldviews, or
    // because the file brings a character the author already has - and either answer
    // would wire the edge to a character the author never named. So the map carries
    // only names that identify exactly one character, and the rows that referenced
    // the rest are reported by count instead of being silently attached to a guess.
    // DEC-38-03; previously the last writer of a name won.
    const candidates = new Map<string, Set<string>>();
    const addCandidate = (name: string, id: string) => {
      const trimmed = name.trim();
      if (!trimmed) {
        return;
      }
      const ids = candidates.get(trimmed) ?? new Set<string>();
      ids.add(id);
      candidates.set(trimmed, ids);
    };

    for (const character of existingCharacters) {
      addCandidate(character.name, character.id);
    }
    for (const prepared of preparedCharacters) {
      addCandidate(prepared.character.name, prepared.character.id);
    }

    const nameToId = new Map<string, string>();
    const ambiguousNames = new Set<string>();
    for (const [name, ids] of candidates) {
      if (ids.size === 1) {
        nameToId.set(name, [...ids][0]);
      } else {
        ambiguousNames.add(name);
      }
    }

    unresolvedReferences = countUnresolvedReferences(csvWorkspaceRows, nameToId, ambiguousNames);

    const stamp = Date.now();
    const resolved = resolveWorkspaceRows(
      csvWorkspaceRows,
      nameToId,
      (prefix, index) => `csv-${prefix}-${stamp}-${index + 1}`,
    );
    workspace = {
      relationships: resolved.relationships,
      timeline: resolved.timeline,
      world: resolved.world,
    };
  }

  const existingNames = new Set(
    existingCharacters.map((character) => character.name.trim()).filter(Boolean),
  );
  const existingAssets = await listAvatarAssets();
  const existingDataUrls = new Set<string>();

  await Promise.all(
    existingAssets.map(async (asset) => {
      existingDataUrls.add(await blobToDataUrl(asset.blob));
    }),
  );

  const uniqueSourceKeys = new Set(preparedAssets.map((asset) => asset.sourceKey));
  const autoMatchedAvatarCount = preparedCharacters.filter(
    (item) => item.avatarSourceKey && uniqueSourceKeys.has(item.avatarSourceKey),
  ).length;

  return {
    characters: preparedCharacters,
    avatarAssets: dedupePreparedAssets(preparedAssets),
    workspace,
    preview: {
      roleCount: preparedCharacters.length,
      avatarCount: dedupePreparedAssets(preparedAssets).length,
      autoMatchedAvatarCount,
      unmatchedAvatarCount: Math.max(0, dedupePreparedAssets(preparedAssets).length - autoMatchedAvatarCount),
      duplicateAssetCount: dedupePreparedAssets(preparedAssets).filter((asset) =>
        existingDataUrls.has(asset.dataUrl),
      ).length,
      duplicateCharacterCount: preparedCharacters.filter((item) =>
        existingNames.has(item.character.name.trim()),
      ).length,
      hasBackupInfo,
      dataVersion,
      importType: hasCsv ? "csv" : hasZip && hasJson ? "mixed" : hasZip ? "zip" : "json",
      workspaceCounts: workspace ? countWorkspaceDatasets(workspace) : null,
      unresolvedReferences,
    },
  };
}

export async function commitCharacterImport(
  plan: PreparedCharacterImport,
  existingCharacters: Character[],
): Promise<CharacterImportCommitResult> {
  const existingAssets = await listAvatarAssets();
  const dataUrlToAssetId = new Map<string, string>();
  let importedAvatarCount = 0;

  await Promise.all(
    existingAssets.map(async (asset) => {
      dataUrlToAssetId.set(await blobToDataUrl(asset.blob), asset.id);
    }),
  );

  const sourceAssetToNewAsset = new Map<string, string>();

  for (const asset of plan.avatarAssets) {
    const existingId = dataUrlToAssetId.get(asset.dataUrl);

    if (existingId) {
      sourceAssetToNewAsset.set(asset.sourceKey, existingId);
      continue;
    }

    const savedAsset = await saveAvatarBlob(asset.blob, asset.name);
    sourceAssetToNewAsset.set(asset.sourceKey, savedAsset.id);
    dataUrlToAssetId.set(asset.dataUrl, savedAsset.id);
    importedAvatarCount += 1;
  }

  let autoBoundAvatarCount = 0;
  const importedCharacters = plan.characters.map(({ character, avatarSourceKey }) => {
    const nextCharacter = { ...character };

    if (avatarSourceKey && sourceAssetToNewAsset.has(avatarSourceKey)) {
      nextCharacter.avatarAssetId = sourceAssetToNewAsset.get(avatarSourceKey);
      autoBoundAvatarCount += 1;
    } else {
      nextCharacter.avatarAssetId = "";
    }

    return nextCharacter;
  });

  const mergedCharacters = [...importedCharacters, ...existingCharacters];

  // The domains are applied only now, so a relationship can point at a character
  // that arrived in the same file.
  const workspace = plan.workspace
    ? applyWorkspaceDatasets(
        plan.workspace,
        new Set(mergedCharacters.map((character) => character.id)),
      )
    : null;

  return {
    characters: mergedCharacters,
    importedCharacterCount: importedCharacters.length,
    importedAvatarCount,
    autoBoundAvatarCount,
    unboundAvatarCount: Math.max(0, plan.avatarAssets.length - autoBoundAvatarCount),
    workspace,
  };
}

function isZipFile(file: File) {
  return file.name.toLowerCase().endsWith(".zip") || file.type === "application/zip";
}

/**
 * Minimal RFC 4180 parser: quoted cells may contain commas, quotes (doubled) and
 * newlines. A leading BOM is dropped, and CRLF/CR/LF all end a row, because these
 * files come back from spreadsheets as often as from us.
 */
export function parseCsv(input: string): string[][] {
  const text = input.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\r" || char === "\n") {
      if (char === "\r" && text[index + 1] === "\n") {
        index += 1;
      }
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }

  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  return rows;
}

/** Column label -> the field normalizeCharacter reads. */
const CSV_FIELDS = {
  名字: "name",
  性别: "gender",
  年龄: "age",
  种族: "species",
  职业: "occupation",
  世界观: "worldview",
  视觉风格: "visualStyle",
  外貌描述: "appearanceDescription",
  能力描述: "abilityDescription",
  背景故事: "backstory",
  中文关键词: "characterKeywords",
  "英文 AI Prompt": "imagePrompt",
} as const;

const CSV_NAME_HEADER = "名字";

function isCsvFile(file: File) {
  return file.name.toLowerCase().endsWith(".csv") || file.type === "text/csv";
}

async function prepareCharactersFromCsv(file: File, existingIds: Set<string>) {
  const rows = parseCsv(await file.text());
  if (rows.length === 0) {
    throw new Error("CSV 文件是空的");
  }

  // Columns are matched by label, so a reordered export still imports.
  const columnIndex = new Map<string, number>();
  rows[0].forEach((label, index) => {
    const trimmed = label.trim();
    if (trimmed && !columnIndex.has(trimmed)) {
      columnIndex.set(trimmed, index);
    }
  });

  if (!columnIndex.has(CSV_NAME_HEADER)) {
    throw new Error("CSV 缺少「名字」列，请使用本应用导出的 CSV");
  }

  const cell = (row: string[], label: string) => {
    const index = columnIndex.get(label);
    return index === undefined ? "" : (row[index] ?? "").trim();
  };

  const workspaceRows = readWorkspaceRowsFromCsv(rows);
  // Only a file that has the type column is routed by it. A hand-written CSV has no
  // such column, and there every row is a character — the behaviour it always had.
  const typeIndex = columnIndex.get(CSV_TYPE_HEADER);
  const characters: PreparedCharacter[] = [];
  for (const row of rows.slice(1)) {
    if (typeIndex !== undefined && (row[typeIndex] ?? "").trim() !== CSV_ROW_TYPES.character) {
      continue;
    }

    // Spreadsheets leave trailing blank lines; they are not characters.
    if (row.every((value) => !value.trim())) {
      continue;
    }

    const candidate: Record<string, unknown> = {
      personalityTags: cell(row, "性格标签")
        .split(/[、,，]/)
        .map((tag) => tag.trim())
        .filter(Boolean),
    };
    for (const [label, field] of Object.entries(CSV_FIELDS)) {
      candidate[field] = cell(row, label);
    }

    const character = normalizeCharacter(candidate, existingIds);
    if (character) {
      // A CSV carries text only, so there is no avatar to bind.
      characters.push({ character, avatarSourceKey: "" });
    }
  }

  const hasWorkspaceRows =
    workspaceRows !== null &&
    workspaceRows.relationships.length + workspaceRows.world.length + workspaceRows.timeline.length > 0;

  if (characters.length === 0 && !hasWorkspaceRows) {
    throw new Error("CSV 中没有可导入的角色行");
  }

  return {
    characters,
    avatarAssets: [],
    hasBackupInfo: false,
    dataVersion: "CSV",
    workspaceRows,
  };
}

async function prepareCharactersFromJson(file: File, existingIds: Set<string>) {
  const text = await file.text();
  const parsedValue = JSON.parse(text) as unknown;
  const sourceAssetKeys = collectJsonAvatarAssets(parsedValue);
  const preparedAssets = Array.from(sourceAssetKeys.values());
  const candidates = getCharacterCandidates(parsedValue);
  const preparedCharacters: PreparedCharacter[] = [];

  for (const candidate of candidates) {
    const character = normalizeCharacter(candidate, existingIds);

    if (!character) {
      continue;
    }

    let avatarSourceKey = "";

    if (isRecord(candidate)) {
      const avatarAssetData = asAvatarAssetData(candidate.avatarAssetData);

      if (avatarAssetData?.dataUrl) {
        avatarSourceKey = `inline:${character.id}`;
        preparedAssets.push({
          sourceKey: avatarSourceKey,
          name: avatarAssetData.name || `${character.name || "avatar"}-avatar`,
          blob: dataUrlToBlob(avatarAssetData.dataUrl),
          dataUrl: avatarAssetData.dataUrl,
        });
      } else if (character.avatarAssetId && sourceAssetKeys.has(character.avatarAssetId)) {
        avatarSourceKey = character.avatarAssetId;
      }
    }

    character.avatarAssetId = "";
    preparedCharacters.push({ character, avatarSourceKey });
  }

  return {
    characters: preparedCharacters,
    avatarAssets: preparedAssets,
    hasBackupInfo: isRecord(parsedValue) && isRecord(parsedValue["backup-info"]),
    dataVersion: getJsonDataVersion(parsedValue),
    workspace: extractWorkspaceDatasets(parsedValue),
  };
}

async function prepareCharactersFromBackupZip(file: File, existingIds: Set<string>) {
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
  const backupInfoEntry = entryByName.get("backup-info.json");
  const backupInfoValue = backupInfoEntry
    ? (JSON.parse(await backupInfoEntry.blob.text()) as unknown)
    : undefined;
  const workspaceEntry = entryByName.get("workspace.json");
  const preparedAssets = await collectZipAvatarAssets(entries, manifestValue);
  const candidates = getCharacterCandidates(charactersValue);
  const preparedCharacters: PreparedCharacter[] = [];

  for (const candidate of candidates) {
    const sourceCharacterId = isRecord(candidate) ? asString(candidate.id) : "";
    const character = normalizeCharacter(candidate, existingIds);

    if (!character) {
      continue;
    }

    const avatarSourceKey = findManifestBoundAssetKey(
      manifestValue,
      sourceCharacterId,
    );

    character.avatarAssetId = "";
    preparedCharacters.push({ character, avatarSourceKey });
  }

  return {
    characters: preparedCharacters,
    avatarAssets: preparedAssets,
    hasBackupInfo: Boolean(backupInfoEntry),
    dataVersion: getBackupDataVersion(backupInfoValue),
    workspace: workspaceEntry
      ? extractWorkspaceDatasets(JSON.parse(await workspaceEntry.blob.text()) as unknown)
      : null,
  };
}

function collectJsonAvatarAssets(value: unknown) {
  const avatarAssets = new Map<string, PreparedAvatarAsset>();

  if (!isRecord(value) || !Array.isArray(value.avatarAssets)) {
    return avatarAssets;
  }

  for (const item of value.avatarAssets) {
    if (!isRecord(item)) {
      continue;
    }

    const sourceId = asString(item.sourceId) || asString(item.id);
    const dataUrl = asString(item.dataUrl);

    if (!sourceId || !dataUrl.startsWith("data:image/")) {
      continue;
    }

    avatarAssets.set(sourceId, {
      sourceKey: sourceId,
      name: asString(item.name) || "avatar",
      blob: dataUrlToBlob(dataUrl),
      dataUrl,
    });
  }

  return avatarAssets;
}

async function collectZipAvatarAssets(entries: ZipEntry[], manifestValue: unknown) {
  const assets = new Map<string, PreparedAvatarAsset>();
  const assetEntries = entries.filter((entry) => entry.name.startsWith("assets/avatar/"));
  const bindings = getManifestBindings(manifestValue);

  for (const entry of assetEntries) {
    const mimeType = mimeTypeFromFileName(entry.name);
    const blob = new Blob([await entry.blob.arrayBuffer()], { type: mimeType });
    const dataUrl = await blobToDataUrl(blob);

    bindings
      .filter((binding) => binding.assetFile === entry.name && binding.sourceAssetKey)
      .forEach((binding) => {
        assets.set(binding.sourceAssetKey, {
          sourceKey: binding.sourceAssetKey,
          name: entry.name.split("/").pop() || "avatar",
          blob,
          dataUrl,
        });
      });

    if (!bindings.some((binding) => binding.assetFile === entry.name)) {
      assets.set(`unbound:${entry.name}`, {
        sourceKey: `unbound:${entry.name}`,
        name: entry.name.split("/").pop() || "avatar",
        blob,
        dataUrl,
      });
    }
  }

  return Array.from(assets.values());
}

function dedupePreparedAssets(assets: PreparedAvatarAsset[]) {
  const assetMap = new Map<string, PreparedAvatarAsset>();

  assets.forEach((asset) => {
    if (!assetMap.has(asset.sourceKey)) {
      assetMap.set(asset.sourceKey, asset);
    }
  });

  return Array.from(assetMap.values());
}

function getJsonDataVersion(value: unknown) {
  if (!isRecord(value)) {
    return "旧版 JSON";
  }

  return asString(value.schemaVersion) || asString(value.exportType) || "JSON";
}

function getBackupDataVersion(value: unknown) {
  if (!isRecord(value)) {
    return "ZIP";
  }

  return asString(value.schemaVersion) || asString(value.exportType) || "ZIP";
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

function findManifestBoundAssetKey(
  manifestValue: unknown,
  sourceCharacterId: string,
) {
  if (!sourceCharacterId) {
    return "";
  }

  const binding = getManifestBindings(manifestValue).find(
    (item) => item.sourceCharacterId === sourceCharacterId,
  );

  return binding?.sourceAssetKey || "";
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

type PreviewCaptureOptions = {
  forceLightMode?: boolean;
  scale?: number;
};

async function capturePreviewCanvas(element: HTMLElement, options: PreviewCaptureOptions = {}) {
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
    const { default: html2canvas } = await importWithRecovery(() => import("html2canvas"));

    return await html2canvas(element, {
      backgroundColor: "#f3f4f6",
      height: Math.ceil(bounds.height),
      onclone: (documentClone) => {
        if (options.forceLightMode !== false) {
          documentClone.documentElement.dataset.theme = "light";
          documentClone.body.style.background = "#f3f4f6";
          documentClone.body.style.color = "#111827";
        }

        const exportRoot = documentClone.querySelector<HTMLElement>(
          "[data-pdf-export-root='true']",
        );

        if (exportRoot) {
          exportRoot.classList.add("pdf-safe");
          if (options.forceLightMode !== false) {
            exportRoot.style.background = "#f3f4f6";
            exportRoot.style.color = "#111827";
          }

          exportRoot.querySelectorAll<HTMLElement>("*").forEach((item) => {
            item.style.backgroundImage = "none";
            item.style.boxShadow = "none";
            item.style.textShadow = "none";
          });

          // After the strip, because a stripped property has no colour left in it.
          downgradeModernColors(documentClone, exportRoot);
        }

        documentClone
          .querySelectorAll(
            "[data-pdf-hidden='true'], input, select, textarea",
          )
          .forEach((item) => {
            item.setAttribute("style", "display: none !important;");
          });
      },
      scale: options.scale || 2,
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

/**
 * html2canvas reads colours with its own parser, which knows rgb/rgba/hsl/hex and
 * nothing newer. Modern CSS produces `color(srgb r g b)` for anything derived — a
 * `color-mix()` token such as `--control-fill`, which is how the neutral control
 * fills are built — and the parser throws
 * `Attempting to parse an unsupported color function "color"` for it, failing the
 * entire capture.
 *
 * So the clone gets downgraded before it is rendered, rather than the whole
 * stylesheet being held back to colour syntax from 2015. `color(srgb …)` is a
 * straight conversion; anything else is left alone.
 */
export function toLegacyColorFunctions(value: string): string {
  return value.replace(
    // Channels may carry a sign and may fall outside 0–1 on a wide-gamut display;
    // they are clamped rather than rejected, so no convertable value is skipped.
    /color\(\s*srgb\s+([-+]?[\d.]+%?)\s+([-+]?[\d.]+%?)\s+([-+]?[\d.]+%?)\s*(?:\/\s*([-+]?[\d.]+%?))?\s*\)/gi,
    (match, red: string, green: string, blue: string, alpha?: string) => {
      const channel = (raw: string) =>
        Math.max(0, Math.min(255, Math.round(raw.endsWith("%") ? (Number.parseFloat(raw) / 100) * 255 : Number.parseFloat(raw) * 255)));
      const opacity = (() => {
        if (alpha === undefined) {
          return 1;
        }
        const parsed = alpha.endsWith("%") ? Number.parseFloat(alpha) / 100 : Number.parseFloat(alpha);
        return Number.isFinite(parsed) ? Math.max(0, Math.min(1, parsed)) : 1;
      })();

      if (![red, green, blue].every((raw) => Number.isFinite(Number.parseFloat(raw)))) {
        return match;
      }

      return `rgba(${channel(red)}, ${channel(green)}, ${channel(blue)}, ${opacity})`;
    },
  );
}

// Everything html2canvas reads as a colour.
const CAPTURE_COLOR_PROPERTIES = [
  "color",
  "background-color",
  "background-image",
  "border-top-color",
  "border-right-color",
  "border-bottom-color",
  "border-left-color",
  "outline-color",
  "text-decoration-color",
  "caret-color",
  "box-shadow",
  "fill",
  "stroke",
];

function downgradeModernColors(clonedDocument: Document, root: Element) {
  const view = clonedDocument.defaultView;

  if (!view) {
    return;
  }

  const nodes: Element[] = [root, ...root.querySelectorAll("*")];

  for (const node of nodes) {
    const computed = view.getComputedStyle(node);

    for (const property of CAPTURE_COLOR_PROPERTIES) {
      const value = computed.getPropertyValue(property);

      if (!value || !value.includes("color(")) {
        continue;
      }

      const converted = toLegacyColorFunctions(value);

      if (converted !== value) {
        (node as HTMLElement).style.setProperty(property, converted);
      }
    }
  }
}

async function waitForImages(element: Element) {
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

async function waitForAvatarImages(element: Element) {
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
  options: PreviewCaptureOptions = {},
) {
  const canvas = await capturePreviewCanvas(element, options);

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

async function createPreviewPdfBlob(element: HTMLElement, options: PreviewCaptureOptions = {}) {
  const [{ jsPDF }, canvas] = await Promise.all([
    importWithRecovery(() => import("jspdf")),
    capturePreviewCanvas(element, options),
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

export async function exportPreviewPdf(
  element: HTMLElement,
  characterName: string,
  options: PreviewCaptureOptions = {},
) {
  const blob = await createPreviewPdfBlob(element, options);
  downloadBlob(blob, exportNodeName(characterName, "pdf"), "application/pdf");
}

/**
 * Capture for screens that are not a character sheet — currently the relationship
 * graph. It differs from the preview capture on purpose:
 *
 * - the background is passed in, because a graph is exported in the theme it is
 *   drawn in rather than forced to light, and a JPEG has no alpha channel to fall
 *   back on;
 * - nothing is forced to light mode and no fields are hidden by tag name, so what
 *   comes out is what the author is looking at;
 * - `label` names the region in the error, which is the only part of the two
 *   capture paths that has to differ word for word.
 */
type SurfaceCaptureOptions = {
  background?: string;
  label?: string;
  scale?: number;
};

// Element rather than HTMLElement: the graph exports an <svg>, and everything this
// path does — measuring, querying, and handing the node to html2canvas — works on
// any element.
async function captureSurfaceCanvas(element: Element, options: SurfaceCaptureOptions = {}) {
  const label = options.label ?? "内容区域";

  if (!element.isConnected) {
    throw new Error(`找不到可导出的${label}`);
  }

  await waitForAvatarImages(element);
  await waitForImages(element);
  await new Promise((resolve) => window.requestAnimationFrame(resolve));

  const bounds = element.getBoundingClientRect();

  if (bounds.width <= 0 || bounds.height <= 0) {
    throw new Error(`${label}尺寸异常，无法导出`);
  }

  const { default: html2canvas } = await importWithRecovery(() => import("html2canvas"));

  return await html2canvas(element as HTMLElement, {
    backgroundColor: options.background ?? "#ffffff",
    height: Math.ceil(bounds.height),
    // Same reason as the character sheet: a `color-mix()` token inside the drawing
    // comes back as a colour function html2canvas cannot parse.
    onclone: (documentClone, clonedElement) => {
      downgradeModernColors(documentClone, clonedElement);
    },
    scale: options.scale || 2,
    scrollX: 0,
    scrollY: 0,
    useCORS: true,
    width: Math.ceil(bounds.width),
    windowHeight: Math.max(document.documentElement.scrollHeight, window.innerHeight),
    windowWidth: Math.max(document.documentElement.scrollWidth, window.innerWidth),
  });
}

export async function exportSurfaceImage(
  element: Element,
  baseName: string,
  format: "png" | "jpg",
  quality = 0.92,
  options: SurfaceCaptureOptions = {},
) {
  const canvas = await captureSurfaceCanvas(element, options);

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

  downloadBlob(blob, exportNodeName(baseName, format), mimeType);
}

export async function exportSurfacePdf(
  element: Element,
  baseName: string,
  options: SurfaceCaptureOptions = {},
) {
  const [canvas, { jsPDF }] = await Promise.all([
    captureSurfaceCanvas(element, options),
    importWithRecovery(() => import("jspdf")),
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

  downloadBlob(pdf.output("blob"), exportNodeName(baseName, "pdf"), "application/pdf");
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
      ${snapshotTagsCard(character.personalityTags || [])}
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

function snapshotTagsCard(tags: string[]) {
  const visibleTags = tags.filter((tag) => tag.trim()).slice(0, 5);

  return `
    <article class="preview-card wide-card">
      <div class="preview-card-title"><h2>性格标签</h2></div>
      ${
        visibleTags.length > 0
          ? `<div class="preview-tags">${visibleTags
              .map(
                (tag) =>
                  `<span class="tag-tone-${getTagTone(tag)}">${escapeHtml(tag)}</span>`,
              )
              .join("")}</div>`
          : "<p>未填写</p>"
      }
    </article>
  `;
}

function getTagTone(tag: string) {
  const total = Array.from(tag).reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return total % 18;
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
