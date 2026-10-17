// The character sheet as a real document.
//
// The previous export captured the preview page and put that picture on A4 pages.
// Faithful to the screen, useless as a document: the text cannot be selected, copied
// or searched, and anything longer than a page is a slice of a bitmap. Here the sheet
// is built as text, laid out by this module, with an embedded CJK font; only the
// avatar stays an image.
//
// The font is ours: Noto Sans SC, subset to GB2312 plus the Latin and punctuation a
// sheet uses (SIL OFL 1.1, see assets/fonts/OFL.txt). jsPDF subsets it again on
// output, so a one-page sheet carries only the glyphs it actually sets - tens of
// kilobytes rather than the two megabytes of the font file. A character outside the
// subset cannot be drawn; the caller is told which ones, rather than printing empty
// boxes without a word.
import type { Character } from "../types/character";
import type { Relationship } from "../types/relationship";
import type { TimelineEvent } from "../types/timeline";
import type { WorldEntry } from "../types/world";
import { isSymmetricKind, relationshipKindLabel } from "../types/relationship";
import { timelineEventKindLabel } from "../types/timeline";
import { worldCategoryLabel } from "../types/world";
import { relationshipsOf, relationshipPeerId, timelineEventsOf, worldEntriesOf } from "./characterLinks";

export type SheetField = { label: string; value: string };
export type SheetRelationRow = { peer: string; kind: string; direction: string; note: string };
export type SheetEventRow = { date: string; title: string; kind: string; description: string };
export type SheetWorldRow = { name: string; category: string; summary: string };

export type SheetSection = {
  key: string;
  title: string;
  paragraphs?: string[];
  fields?: SheetField[];
  relations?: SheetRelationRow[];
  events?: SheetEventRow[];
  entries?: SheetWorldRow[];
};

export type SheetAvatar = { dataUrl: string; width: number; height: number };

export type CharacterSheet = {
  name: string;
  subtitle: string;
  tags: string[];
  facts: SheetField[];
  sections: SheetSection[];
  avatar: SheetAvatar | null;
  /** What the sheet says it left out, so a gap stays visible instead of missing. */
  notes: string[];
  counts: { relationships: number; events: number; entries: number };
};

export type SheetInput = {
  character: Character;
  characters: Character[];
  relationships: Relationship[];
  timeline: TimelineEvent[];
  world: WorldEntry[];
  includeRelated: boolean;
};

const text = (value: string | undefined) => (value ?? "").trim();

/**
 * Everything with a value, nothing twice.
 *
 * A section exists only when it has something to say, so an empty field costs no
 * space and no reader attention. Relations and events come from the records that
 * already store them, and the peer is resolved by id rather than by name: a deleted
 * character cannot lend their name to somebody else's edge.
 */
export function buildCharacterSheet(input: SheetInput): CharacterSheet {
  const { character, characters, relationships, timeline, world } = input;
  const byId = new Map(characters.map((item) => [item.id, item]));
  const facts: SheetField[] = [];
  const fact = (label: string, value?: string) => {
    const trimmed = text(value);
    if (trimmed) {
      facts.push({ label, value: trimmed });
    }
  };

  fact("性别", character.gender);
  fact("年龄", character.age);
  fact("出生日期", character.birthDate);
  fact("出生年份", character.birthYear);
  fact("种族", character.species);
  fact("职业", character.occupation);
  fact("世界观", character.worldview);

  const tags = [
    ...(character.personalityTags ?? []),
    ...(character.tags ?? []).map((tag) => tag.name),
  ].filter((tag, index, list) => tag.trim() && list.indexOf(tag) === index);

  const sections: SheetSection[] = [];
  const appearance = text(character.appearanceDescription);
  const traitFields: SheetField[] = tags.length
    ? [{ label: "性格与标签", value: tags.join("、") }]
    : [];
  if (appearance || traitFields.length) {
    sections.push({
      key: "appearance",
      title: "外貌与性格",
      paragraphs: appearance ? [appearance] : [],
      fields: traitFields,
    });
  }

  const abilityFields: SheetField[] = [];
  const abilityFact = (label: string, value?: string) => {
    const trimmed = text(value);
    if (trimmed) {
      abilityFields.push({ label, value: trimmed });
    }
  };
  abilityFact("喜好", character.likes);
  abilityFact("厌恶", character.dislikes);
  abilityFact("习惯", character.habits);
  abilityFact("重要物品", character.importantItems);
  const ability = text(character.abilityDescription);
  if (ability || abilityFields.length) {
    sections.push({
      key: "ability",
      title: "能力与偏好",
      paragraphs: ability ? [ability] : [],
      fields: abilityFields,
    });
  }

  const backstory = text(character.backstory);
  if (backstory) {
    sections.push({ key: "backstory", title: "背景故事", paragraphs: [backstory] });
  }

  const archive: SheetField[] = [];
  const archiveFact = (label: string, value?: string) => {
    const trimmed = text(value);
    if (trimmed) {
      archive.push({ label, value: trimmed });
    }
  };
  archiveFact("关系关键词", character.relationshipKeywords);
  archiveFact("中文关键词", character.characterKeywords);
  archiveFact("视觉风格", character.visualStyle);
  archiveFact("AI Prompt", character.imagePrompt);
  archiveFact("建档时间", formatStamp(character.createdAt));
  archiveFact("最近更新", formatStamp(character.updatedAt));
  if (archive.length) {
    sections.push({ key: "archive", title: "其他档案字段", fields: archive });
  }

  const notes: string[] = [];
  let relationCount = 0;
  let eventCount = 0;
  let entryCount = 0;

  if (input.includeRelated) {
    const relations: SheetRelationRow[] = [];
    let missingPeers = 0;

    for (const relationship of relationshipsOf(relationships, character.id)) {
      const peer = byId.get(relationshipPeerId(relationship, character.id));
      if (!peer) {
        missingPeers += 1;
        continue;
      }
      relations.push({
        peer: peer.name,
        kind: relationshipKindLabel(relationship.kind),
        direction: isSymmetricKind(relationship.kind)
          ? "互为"
          : relationship.fromId === character.id
            ? "此角色 → 对方"
            : "对方 → 此角色",
        note: text(relationship.note),
      });
    }

    if (relations.length) {
      sections.push({ key: "relations", title: "角色关系", relations });
      relationCount = relations.length;
    }
    if (missingPeers > 0) {
      notes.push(`另有 ${missingPeers} 条关系的关联角色已不存在，未列出。`);
    }

    const events = timelineEventsOf(timeline, character.id).map((event) => ({
      date: event.date,
      title: event.title,
      kind: timelineEventKindLabel(event.kind),
      description: text(event.description),
    }));
    if (events.length) {
      sections.push({ key: "events", title: "参与的时间线事件", events });
      eventCount = events.length;
    }

    const entries = worldEntriesOf(world, character.id).map((entry) => ({
      name: entry.name,
      category: worldCategoryLabel(entry.category),
      summary: text(entry.summary),
    }));
    if (entries.length) {
      sections.push({ key: "world", title: "关联世界观条目", entries });
      entryCount = entries.length;
    }
  }

  return {
    name: character.name,
    subtitle: [text(character.occupation), text(character.worldview), text(character.species)]
      .filter(Boolean)
      .slice(0, 3)
      .join(" · "),
    tags,
    facts,
    sections,
    avatar: null,
    notes,
    counts: { relationships: relationCount, events: eventCount, entries: entryCount },
  };
}

function formatStamp(value?: string) {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}

// Zero-width and combining marks carry no glyph of their own: a variation selector
// after an emoji, a joiner between two of them, an accent stuck to a letter. Reporting
// them as missing characters would turn one emoji into two boxes.
const INVISIBLE = /[\u0300-\u036F\u200B-\u200F\u200D\u20D0-\u20F0\uFE00-\uFE0F\uFE20-\uFE2F]/u;

/** Characters the embedded font cannot draw. Reported by the caller, never silent. */
export function findUnsupportedCharacters(
  sheet: CharacterSheet,
  hasGlyph: (char: string) => boolean,
): string[] {
  const seen = new Set<string>();
  const missing: string[] = [];
  const visit = (value: string) => {
    for (const char of value) {
      if (char.trim() && !INVISIBLE.test(char) && !hasGlyph(char) && !seen.has(char)) {
        seen.add(char);
        missing.push(char);
      }
    }
  };

  visit(sheet.name);
  visit(sheet.subtitle);
  sheet.tags.forEach(visit);
  sheet.notes.forEach(visit);
  sheet.facts.forEach((item) => {
    visit(item.label);
    visit(item.value);
  });

  for (const section of sheet.sections) {
    visit(section.title);
    section.paragraphs?.forEach(visit);
    section.fields?.forEach((item) => {
      visit(item.label);
      visit(item.value);
    });
    section.relations?.forEach((row) => [row.peer, row.kind, row.direction, row.note].forEach(visit));
    section.events?.forEach((row) => [row.date, row.title, row.kind, row.description].forEach(visit));
    section.entries?.forEach((row) => [row.name, row.category, row.summary].forEach(visit));
  }

  return missing;
}

export type SheetPdfOptions = {
  /** Optional and off by default: a sheet carries no forced credit line. */
  signature?: string;
  /**
   * Which characters the embedded font can draw. A character the font has no glyph for
   * is drawn as a box rather than lost: the text layer keeps the position, the reader
   * sees where something is missing, and the caller still reports the count.
   */
  hasGlyph?: (char: string) => boolean;
};

/** The visible stand-in for a character the subset font cannot draw. */
export const MISSING_GLYPH_BOX = "□";

export type SheetPdfResult = {
  blob: Blob;
  pages: number;
  /** Lines drawn below the bottom margin. Zero by construction; returned to be asserted. */
  overflow: number;
};

type PdfDoc = {
  internal: { pageSize: { getWidth(): number; getHeight(): number } };
  setFont(name: string, style?: string): void;
  setFontSize(size: number): void;
  setTextColor(value: number): void;
  addPage(): void;
  setPage(page: number): void;
  getNumberOfPages(): number;
  text(value: string | string[], x: number, y: number, options?: Record<string, unknown>): void;
  splitTextToSize(value: string, width: number): string[];
  addImage(data: string, format: string, x: number, y: number, width: number, height: number): void;
  addFileToVFS(name: string, data: string): void;
  addFont(file: string, name: string, style: string): void;
  setDrawColor(value: number): void;
  setLineWidth(width: number): void;
  line(x1: number, y1: number, x2: number, y2: number): void;
  output(type: "blob"): Blob;
};

const MM_PER_PT = 0.352778;
const MARGIN_X = 20;
const MARGIN_TOP = 20;
const MARGIN_BOTTOM = 18;
const LINE = 1.58;

/**
 * Lays the sheet out and returns the file.
 *
 * Blocks are placed one at a time against the remaining height; a heading is not drawn
 * unless two lines of what follows it fit on the same page. Nothing is drawn outside
 * the margins, and a page is only created when something will be drawn on it, so no
 * page ever holds a page number alone.
 */
export function renderCharacterSheetPdf(
  createPdf: (options: Record<string, unknown>) => PdfDoc,
  sheet: CharacterSheet,
  font: { name: string; base64: string; hasGlyph?: (char: string) => boolean },
  options: SheetPdfOptions = {},
): SheetPdfResult {
  const doc = createPdf({ unit: "mm", format: "a4", compress: true });
  // jsPDF subsets an embedded TrueType font to the glyphs the document actually uses,
  // so the file carries tens of kilobytes rather than the whole two megabytes.
  doc.addFileToVFS(font.name, font.base64);
  doc.addFont(font.name, font.name, "normal");
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const contentWidth = pageWidth - MARGIN_X * 2;
  const bottom = pageHeight - MARGIN_BOTTOM;
  let y = MARGIN_TOP;
  let overflow = 0;

  doc.setFont(font.name, "normal");
  doc.setTextColor(24);

  const lineHeight = (size: number) => size * LINE * MM_PER_PT;

  // A character outside the font's subset used to be dropped by the PDF writer without
  // a trace. It is now drawn as a box, so the gap is visible and the text still has the
  // right length; the caller reports which characters and how many.
  const hasGlyph = options.hasGlyph ?? font.hasGlyph;
  const missingMark = !hasGlyph || hasGlyph(MISSING_GLYPH_BOX) ? MISSING_GLYPH_BOX : "?";
  const safe = (value: string) => {
    if (!hasGlyph) {
      return value;
    }

    let result = "";
    for (const char of value) {
      result += char.trim() && !INVISIBLE.test(char) && !hasGlyph(char) ? missingMark : char;
    }
    return result;
  };

  function ensure(height: number) {
    if (y + height <= bottom) {
      return;
    }
    doc.addPage();
    y = MARGIN_TOP;
  }

  function drawLines(lines: string[], size: number, x: number, width: number, color = 24) {
    const height = lineHeight(size);
    doc.setFontSize(size);
    doc.setTextColor(color);
    for (const line of lines) {
      if (y + height > bottom) {
        doc.addPage();
        y = MARGIN_TOP;
        if (y + height > bottom) {
          // A block taller than a page cannot be placed; count it instead of quietly
          // drawing past the margin.
          overflow += 1;
        }
      }
      doc.text(line, x, y + height * 0.72);
      y += height;
    }
  }

  // A wrapped line must not begin with a closing mark: 「…一个」 followed by 「。」 on
  // its own line is how a Chinese paragraph looks when it has been broken by width
  // alone. The mark hangs past the measure instead, which is what print does.
  function wrap(value: string, width: number, size: number) {
    doc.setFontSize(size);
    // Measure the text that will actually be drawn: a box is narrower than the glyph
    // it stands in for, and wrapping the original would leave a line short.
    const lines: string[] = doc.splitTextToSize(safe(value), width);
    const closers = "，。、；：？！）》」』】”’…·";

    for (let index = 1; index < lines.length; index += 1) {
      const first = lines[index][0];
      if (first && closers.includes(first) && lines[index - 1].length > 1) {
        lines[index - 1] += first;
        lines[index] = lines[index].slice(1);
      }
    }

    return lines.filter((line) => line !== "");
  }

  function paragraph(value: string, size = 9.5, indent = 0) {
    const width = contentWidth - indent;
    drawLines(wrap(value, width, size), size, MARGIN_X + indent, width);
  }

  // ---- header -----------------------------------------------------------------
  const avatarBox = 30;
  const hasAvatar = sheet.avatar !== null;
  const headerWidth = hasAvatar ? contentWidth - avatarBox - 8 : contentWidth;

  const nameLines = wrap(sheet.name, headerWidth, 20);
  ensure(lineHeight(20) * nameLines.length + 6);
  drawLines(nameLines, 20, MARGIN_X, headerWidth, 20);
  y += 1.5;

  if (sheet.subtitle) {
    const subtitleLines = wrap(sheet.subtitle, headerWidth, 9.5);
    drawLines(subtitleLines, 9.5, MARGIN_X, headerWidth, 110);
  }

  if (hasAvatar) {
    const avatar = sheet.avatar!;
    const ratio = avatar.width > 0 && avatar.height > 0 ? avatar.width / avatar.height : 1;
    const boxWidth = ratio >= 1 ? avatarBox : avatarBox * ratio;
    const boxHeight = ratio >= 1 ? avatarBox / ratio : avatarBox;
    doc.addImage(
      avatar.dataUrl,
      "JPEG",
      pageWidth - MARGIN_X - boxWidth,
      MARGIN_TOP - 2 + (avatarBox - boxHeight) / 2,
      boxWidth,
      boxHeight,
    );
  }

  y = Math.max(y, MARGIN_TOP + avatarBox + 2);
  doc.setDrawColor(220);
  doc.setLineWidth(0.3);
  doc.line(MARGIN_X, y, pageWidth - MARGIN_X, y);
  y += 5;

  // ---- facts ------------------------------------------------------------------
  if (sheet.facts.length) {
    const columnWidth = contentWidth / 2;
    const labelWidth = 14;
    const body = lineHeight(9.5);

    for (let index = 0; index < sheet.facts.length; index += 2) {
      const row = sheet.facts.slice(index, index + 2);
      const cells = row.map((item) => ({
        item,
        lines: wrap(item.value, columnWidth - labelWidth - 4, 9.5),
      }));
      const height = Math.max(1, ...cells.map((cell) => cell.lines.length)) * body + 1.5;
      ensure(height);

      cells.forEach((cell, column) => {
        const x = MARGIN_X + column * columnWidth;
        doc.setFontSize(8);
        doc.setTextColor(130);
        doc.text(safe(cell.item.label), x, y + body * 0.72);
        doc.setFontSize(9.5);
        doc.setTextColor(30);
        cell.lines.forEach((line, lineIndex) => {
          doc.text(line, x + labelWidth, y + body * 0.72 + lineIndex * body);
        });
      });

      y += height;
    }

    y += 3;
  }

  // ---- sections ---------------------------------------------------------------
  const body = lineHeight(9.5);

  for (const section of sheet.sections) {
    // A heading with nothing under it on the same page is a heading separated from its
    // text. Each kind of body has a different first block, so the room required is the
    // heading plus two lines of that block - for a table, the header and two rows.
    const firstBlock =
      section.relations?.length
        ? lineHeight(8) + 3 * lineHeight(9) + 1.6
        : section.events?.length || section.entries?.length
          ? lineHeight(8.5) + lineHeight(10) + 4
          : body * 2;
    ensure(lineHeight(11) + firstBlock + 5);
    doc.setFontSize(11);
    doc.setTextColor(30);
    doc.text(safe(section.title), MARGIN_X, y + lineHeight(11) * 0.72);
    y += lineHeight(11) + 1.5;
    doc.setDrawColor(232);
    doc.line(MARGIN_X, y, MARGIN_X + 22, y);
    y += 3;

    section.paragraphs?.forEach((value, index) => {
      if (index > 0) {
        y += 2;
      }
      paragraph(value);
    });

    for (const item of section.fields ?? []) {
      const labelWidth = 24;
      const valueWidth = contentWidth - labelWidth;
      const lines = wrap(item.value, valueWidth, 9.5);
      ensure(Math.min(Math.max(1, lines.length) * body + 1.2, bottom - MARGIN_TOP));
      doc.setFontSize(8.5);
      doc.setTextColor(120);
      doc.text(safe(item.label), MARGIN_X, y + body * 0.72);
      drawLines(lines, 9.5, MARGIN_X + labelWidth, valueWidth, 34);
      y += 1.2;
    }

    if (section.relations?.length) {
      const columns = [40, 22, 34, contentWidth - 40 - 22 - 34];
      const headerLabels = ["关联角色", "关系", "方向", "备注"];
      const cellHeight = lineHeight(9);
      const headerHeight = lineHeight(8) + 1.6;

      const drawRelationsHeader = () => {
        ensure(headerHeight + cellHeight);
        doc.setFontSize(8);
        doc.setTextColor(120);
        let x = MARGIN_X;
        headerLabels.forEach((label, index) => {
          doc.text(label, x, y + lineHeight(8) * 0.72);
          x += columns[index];
        });
        y += headerHeight;
        doc.setDrawColor(230);
        doc.line(MARGIN_X, y - 1.2, MARGIN_X + contentWidth, y - 1.2);
      };

      drawRelationsHeader();

      for (const row of section.relations) {
        const cells = [row.peer, row.kind, row.direction, row.note || "—"].map((value, index) =>
          wrap(value, columns[index] - 3, 9),
        );
        const height = Math.max(1, ...cells.map((lines) => lines.length)) * cellHeight + 1.6;

        if (y + height > bottom) {
          doc.addPage();
          y = MARGIN_TOP;
          drawRelationsHeader();
        }

        cells.forEach((lines, index) => {
          const cellX = MARGIN_X + columns.slice(0, index).reduce((sum, width) => sum + width, 0);
          doc.setFontSize(9);
          doc.setTextColor(index === 3 ? 90 : 34);
          lines.forEach((line, lineIndex) => {
            doc.text(line, cellX, y + cellHeight * 0.72 + lineIndex * cellHeight);
          });
        });
        y += height;
      }
    }

    for (const event of section.events ?? []) {
      const meta = [event.date, event.kind].filter(Boolean).join(" · ");
      const titleLines = wrap(event.title, contentWidth - 4, 10);
      const descriptionLines = event.description
        ? wrap(event.description, contentWidth - 4, 9)
        : [];
      const height =
        lineHeight(8.5) + titleLines.length * lineHeight(10) + descriptionLines.length * lineHeight(9) + 3;
      ensure(Math.min(height, bottom - MARGIN_TOP));

      doc.setFontSize(8.5);
      doc.setTextColor(125);
      doc.text(safe(meta), MARGIN_X, y + lineHeight(8.5) * 0.72);
      y += lineHeight(8.5);
      drawLines(titleLines, 10, MARGIN_X + 2, contentWidth - 4, 30);
      if (descriptionLines.length) {
        drawLines(descriptionLines, 9, MARGIN_X + 2, contentWidth - 4, 80);
      }
      y += 2.4;
    }

    for (const entry of section.entries ?? []) {
      const title = entry.category ? `${entry.name}（${entry.category}）` : entry.name;
      const titleLines = wrap(title, contentWidth - 4, 9.5);
      const summaryLines = entry.summary ? wrap(entry.summary, contentWidth - 4, 9) : [];
      const height = titleLines.length * lineHeight(9.5) + summaryLines.length * lineHeight(9) + 2.5;
      ensure(Math.min(height, bottom - MARGIN_TOP));

      drawLines(titleLines, 9.5, MARGIN_X + 2, contentWidth - 4, 30);
      if (summaryLines.length) {
        drawLines(summaryLines, 9, MARGIN_X + 2, contentWidth - 4, 80);
      }
      y += 2.2;
    }

    y += 3;
  }

  if (sheet.notes.length) {
    y += 1;
    for (const note of sheet.notes) {
      paragraph(note, 8.5);
    }
  }

  // ---- footers ----------------------------------------------------------------
  const pages = doc.getNumberOfPages();

  for (let index = 1; index <= pages; index += 1) {
    doc.setPage(index);
    doc.setFontSize(8);
    doc.setTextColor(150);
    // Page numbers only. No credit line, no repeated heading.
    doc.text(`${index} / ${pages}`, pageWidth - MARGIN_X, pageHeight - 9, { align: "right" });
    if (options.signature) {
      doc.text(safe(options.signature), MARGIN_X, pageHeight - 9);
    }
  }

  return { blob: doc.output("blob"), pages, overflow };
}
