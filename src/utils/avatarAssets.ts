const DB_NAME = "character-studio-assets";
const STORE_NAME = "avatar-assets";
const DB_VERSION = 1;
const MAX_UPLOAD_SIZE = 10 * 1024 * 1024;
const SUPPORTED_TYPES = ["image/jpeg", "image/png", "image/webp"];

export type AvatarAssetRecord = {
  id: string;
  type?: "avatar";
  name?: string;
  mimeType?: string;
  blob: Blob;
  size: number;
  width?: number;
  height?: number;
  createdAt: string;
  updatedAt?: string;
};

function openAvatarDb() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
) {
  const db = await openAvatarDb();

  return new Promise<T>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, mode);
    const request = run(transaction.objectStore(STORE_NAME));

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => db.close();
    transaction.onerror = () => {
      db.close();
      reject(transaction.error);
    };
  });
}

export function validateAvatarFile(file: File) {
  if (!SUPPORTED_TYPES.includes(file.type)) {
    return "仅支持 JPG、PNG、WEBP 格式，暂不支持 HEIC。";
  }

  if (file.size > MAX_UPLOAD_SIZE) {
    return "头像原图超过 10MB，请先压缩或更换图片。";
  }

  return "";
}

function loadImageFromFile(file: File) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(file);

    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("图片读取失败"));
    };
    image.src = url;
  });
}

export async function compressAvatarFile(file: File) {
  const image = await loadImageFromFile(file);
  const size = 512;
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("浏览器不支持头像压缩");
  }

  canvas.width = size;
  canvas.height = size;

  const sourceSize = Math.min(image.naturalWidth, image.naturalHeight);
  const sourceX = (image.naturalWidth - sourceSize) / 2;
  const sourceY = (image.naturalHeight - sourceSize) / 2;

  context.drawImage(image, sourceX, sourceY, sourceSize, sourceSize, 0, 0, size, size);

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/webp", 0.8),
  );

  if (!blob) {
    throw new Error("头像压缩失败");
  }

  return blob;
}

export async function compressImageToAvatarBlob(image: HTMLImageElement, crop: {
  offsetX: number;
  offsetY: number;
  zoom: number;
  sourceX?: number;
  sourceY?: number;
  sourceSize?: number;
}) {
  const size = 512;
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("浏览器不支持头像压缩");
  }

  canvas.width = size;
  canvas.height = size;

  const sourceSize = Math.max(
    1,
    Math.min(
      crop.sourceSize || Math.min(image.naturalWidth, image.naturalHeight) / crop.zoom,
      image.naturalWidth,
      image.naturalHeight,
    ),
  );
  const sourceX = Math.max(
    0,
    Math.min(image.naturalWidth - sourceSize, crop.sourceX ?? (image.naturalWidth - sourceSize) / 2),
  );
  const sourceY = Math.max(
    0,
    Math.min(image.naturalHeight - sourceSize, crop.sourceY ?? (image.naturalHeight - sourceSize) / 2),
  );

  context.drawImage(image, sourceX, sourceY, sourceSize, sourceSize, 0, 0, size, size);

  const webpBlob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/webp", 0.8),
  );

  if (webpBlob) {
    return webpBlob;
  }

  const jpegBlob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", 0.82),
  );

  if (!jpegBlob) {
    throw new Error("头像压缩失败");
  }

  return jpegBlob;
}

export function dataUrlToBlob(dataUrl: string) {
  const [header, data] = dataUrl.split(",");
  const mimeType = header.match(/data:(.*?);base64/)?.[1] || "image/webp";
  const binary = atob(data || "");
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return new Blob([bytes], { type: mimeType });
}

export async function saveAvatarBlob(blob: Blob, name = "avatar") {
  const now = new Date().toISOString();
  const record: AvatarAssetRecord = {
    id: crypto.randomUUID(),
    type: "avatar",
    name,
    mimeType: blob.type || "image/webp",
    blob,
    size: blob.size,
    width: 512,
    height: 512,
    createdAt: now,
    updatedAt: now,
  };

  await withStore("readwrite", (store) => store.put(record));
  return record;
}

export async function saveAvatarAsset(file: File) {
  const validationError = validateAvatarFile(file);

  if (validationError) {
    throw new Error(validationError);
  }

  const blob = await compressAvatarFile(file);
  return saveAvatarBlob(blob, file.name || "avatar");
}

export async function getAvatarAsset(id?: string) {
  if (!id) {
    return undefined;
  }

  return withStore<AvatarAssetRecord | undefined>("readonly", (store) =>
    store.get(id),
  );
}

export async function deleteAvatarAsset(id: string) {
  await withStore("readwrite", (store) => store.delete(id));
}

export async function clearAvatarAssets() {
  await withStore("readwrite", (store) => store.clear());
}

export async function listAvatarAssets() {
  return withStore<AvatarAssetRecord[]>("readonly", (store) => store.getAll());
}

function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
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

function dateStamp() {
  const now = new Date();
  return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
}

export async function exportAvatarAssetsJson(assetIds?: string[]) {
  const assetIdSet = assetIds?.length ? new Set(assetIds) : null;
  const assets = (await listAvatarAssets()).filter((asset) =>
    assetIdSet ? assetIdSet.has(asset.id) : true,
  );
  const payload = {
    exportType: "character-studio-avatar-assets",
    exportedAt: new Date().toISOString(),
    avatarAssets: await Promise.all(
      assets.map(async (asset) => ({
        sourceId: asset.id,
        name: asset.name || "avatar",
        mimeType: asset.mimeType || asset.blob.type || "image/webp",
        size: asset.size || asset.blob.size,
        width: asset.width || 512,
        height: asset.height || 512,
        createdAt: asset.createdAt,
        updatedAt: asset.updatedAt,
        dataUrl: await blobToDataUrl(asset.blob),
      })),
    ),
  };

  downloadBlob(
    JSON.stringify(payload, null, 2),
    `character-studio-avatar-assets-${dateStamp()}.json`,
    "application/json",
  );
}

export async function importAvatarAssetsJson(file: File) {
  const parsedValue = JSON.parse(await file.text()) as unknown;

  if (
    typeof parsedValue !== "object" ||
    parsedValue === null ||
    !Array.isArray((parsedValue as { avatarAssets?: unknown }).avatarAssets)
  ) {
    throw new Error("头像素材 JSON 不合法");
  }

  const existingAssets = await listAvatarAssets();
  const existingDataUrls = new Set(
    await Promise.all(existingAssets.map((asset) => blobToDataUrl(asset.blob))),
  );
  let importedCount = 0;
  let skippedCount = 0;

  for (const item of (parsedValue as { avatarAssets: unknown[] }).avatarAssets) {
    if (typeof item !== "object" || item === null) {
      continue;
    }

    const record = item as { dataUrl?: unknown; name?: unknown };
    const dataUrl = typeof record.dataUrl === "string" ? record.dataUrl : "";

    if (!dataUrl.startsWith("data:image/")) {
      continue;
    }

    if (existingDataUrls.has(dataUrl)) {
      skippedCount += 1;
      continue;
    }

    const asset = await saveAvatarBlob(
      dataUrlToBlob(dataUrl),
      typeof record.name === "string" ? record.name : "avatar",
    );
    existingDataUrls.add(dataUrl);
    if (asset) {
      importedCount += 1;
    }
  }

  return { importedCount, skippedCount };
}

export async function getAvatarAssetStats() {
  const assets = await listAvatarAssets();

  return {
    count: assets.length,
    size: assets.reduce((total, asset) => total + (asset.size || asset.blob.size), 0),
  };
}

export async function cleanupUnusedAvatarAssets(usedAssetIds: string[]) {
  const usedIds = new Set(usedAssetIds.filter(Boolean));
  const assets = await listAvatarAssets();
  const unusedAssets = assets.filter((asset) => !usedIds.has(asset.id));

  await Promise.all(unusedAssets.map((asset) => deleteAvatarAsset(asset.id)));
  return unusedAssets.length;
}

export function formatAssetSize(size: number) {
  if (size < 1024 * 1024) {
    return `${Math.max(1, Math.round(size / 1024))} KB`;
  }

  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}
