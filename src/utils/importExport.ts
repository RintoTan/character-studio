import type { Character } from "../types/character";

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

export async function exportPreviewPdf(element: HTMLElement, characterName: string) {
  if (!element.isConnected) {
    throw new Error("找不到可导出的角色展示区域");
  }

  const bounds = element.getBoundingClientRect();

  if (bounds.width <= 0 || bounds.height <= 0) {
    throw new Error("角色展示区域尺寸异常，无法导出 PDF");
  }

  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
    import("html2canvas"),
    import("jspdf"),
  ]);

  const canvas = await html2canvas(element, {
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
        exportRoot.style.background = "#f3f4f6";
        exportRoot.style.color = "#111827";
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

  pdf.save(`${safeFileName(characterName)}-${dateStamp()}.pdf`);
}
