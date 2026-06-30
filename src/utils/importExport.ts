import type { Character, CharacterTag } from "../types/character";

const csvHeaders = [
  "名字",
  "性别",
  "年龄",
  "种族",
  "职业",
  "世界观",
  "性格标签",
  "角色标签",
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

function normalizeCharacter(value: unknown, existingIds: Set<string>): Character | null {
  if (!isRecord(value)) {
    return null;
  }

  const sourceId = asString(value.id);
  const id = sourceId && !existingIds.has(sourceId) ? sourceId : crypto.randomUUID();
  existingIds.add(id);

  return {
    id,
    name: asString(value.name) || "未命名角色",
    avatarEmoji: asString(value.avatarEmoji),
    isDraft: value.isDraft === true,
    draftOfId: asString(value.draftOfId),
    gender: asString(value.gender),
    age: asString(value.age),
    birthDate: asString(value.birthDate),
    birthYear: asString(value.birthYear),
    species: asString(value.species),
    occupation: asString(value.occupation),
    worldview: asString(value.worldview),
    tags: asTags(value.tags),
    personalityTags: asStringArray(value.personalityTags),
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

export function exportCharacterJson(character: Character) {
  const filename = `character-studio-${safeFileName(character.name)}-${dateStamp()}.json`;
  downloadBlob(JSON.stringify(character, null, 2), filename, "application/json");
}

export function exportAllCharactersJson(characters: Character[]) {
  const filename = `character-studio-all-${dateStamp()}.json`;
  const payload = {
    exportedAt: new Date().toISOString(),
    characters,
  };

  downloadBlob(JSON.stringify(payload, null, 2), filename, "application/json");
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
    character.tags?.map((tag) => tag.name).join("、") || "",
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
    const text = await file.text();
    const parsedValue = JSON.parse(text) as unknown;
    const candidates = getCharacterCandidates(parsedValue);

    for (const candidate of candidates) {
      const character = normalizeCharacter(candidate, existingIds);

      if (character) {
        importedCharacters.push(character);
      }
    }
  }

  if (importedCharacters.length === 0) {
    throw new Error("没有找到可导入的角色数据");
  }

  return [...importedCharacters, ...existingCharacters];
}

async function capturePreviewCanvas(element: HTMLElement) {
  if (!element.isConnected) {
    throw new Error("找不到可导出的角色展示区域");
  }

  element.classList.add("pdf-safe");
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
            "[data-pdf-hidden='true'], button, input, select, textarea",
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

function createSnapshotElement(character: Character) {
  const element = document.createElement("div");
  element.dataset.pdfExportRoot = "true";
  element.className = "snapshot-export pdf-safe";
  element.innerHTML = `
    <section class="preview-hero">
      <div class="preview-identity">
        <div class="preview-avatar">${character.avatarEmoji || "🙂"}</div>
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
      ${snapshotCard("角色标签", character.tags?.map((tag) => tag.name).join("、") || "未填写")}
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
  const element = createSnapshotElement(character);

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
