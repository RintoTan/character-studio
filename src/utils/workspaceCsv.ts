// The relationship graph, the timeline and the world book in the same CSV as the
// characters — one file an author can open in a spreadsheet.
//
// A CSV has no nested structure, so the three domains share one table with a 类型
// column and the columns they need. Every row is matched by its column *label*
// rather than its position, which is what lets a reordered export still import, and
// the labels are the ones the app already shows in Chinese.

import { RELATIONSHIP_KINDS } from "../types/relationship";
import { TIMELINE_EVENT_KINDS } from "../types/timeline";
import { WORLD_CATEGORIES } from "../types/world";

export const CSV_TYPE_HEADER = "类型";
export const CSV_ROW_TYPES = {
  character: "角色",
  relationship: "关系",
  world: "世界观",
  timeline: "时间线",
} as const;

/** Columns the three domains add to the character table. */
export const WORKSPACE_CSV_HEADERS = [
  "源角色",
  "目标角色",
  "关系类型",
  "备注",
  "分类",
  "父级",
  "标签",
  "简介",
  "事件标题",
  "事件日期",
  "纪年",
  "事件类型",
  "描述",
  "地点",
  "涉及角色",
];

export type CsvWorkspaceRows = {
  relationships: Array<{ fromName: string; toName: string; kindLabel: string; note: string }>;
  world: Array<{ name: string; categoryLabel: string; parentName: string; tags: string; summary: string }>;
  timeline: Array<{
    title: string;
    date: string;
    era: string;
    kindLabel: string;
    description: string;
    location: string;
    characterNames: string;
  }>;
};

function indexHeaders(row: string[]) {
  const index = new Map<string, number>();
  row.forEach((label, position) => {
    const trimmed = label.trim();
    if (trimmed && !index.has(trimmed)) {
      index.set(trimmed, position);
    }
  });
  return index;
}

function splitList(value: string) {
  return value
    .split(/[、,，|]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

/**
 * Reads the non-character rows out of a combined CSV. Returns null for a
 * characters-only file, which is what every export before this one produced.
 */
export function readWorkspaceRowsFromCsv(rows: string[][]): CsvWorkspaceRows | null {
  if (rows.length === 0) {
    return null;
  }

  const index = indexHeaders(rows[0]);
  if (!index.has(CSV_TYPE_HEADER)) {
    return null;
  }

  const cell = (row: string[], label: string) => {
    const position = index.get(label);
    return position === undefined ? "" : (row[position] ?? "").trim();
  };

  const result: CsvWorkspaceRows = { relationships: [], world: [], timeline: [] };

  for (const row of rows.slice(1)) {
    const type = cell(row, CSV_TYPE_HEADER);

    if (type === CSV_ROW_TYPES.relationship) {
      result.relationships.push({
        fromName: cell(row, "源角色"),
        toName: cell(row, "目标角色"),
        kindLabel: cell(row, "关系类型"),
        note: cell(row, "备注"),
      });
      continue;
    }

    if (type === CSV_ROW_TYPES.world) {
      result.world.push({
        name: cell(row, "名字"),
        categoryLabel: cell(row, "分类"),
        parentName: cell(row, "父级"),
        tags: cell(row, "标签"),
        summary: cell(row, "简介"),
      });
      continue;
    }

    if (type === CSV_ROW_TYPES.timeline) {
      result.timeline.push({
        title: cell(row, "事件标题"),
        date: cell(row, "事件日期"),
        era: cell(row, "纪年"),
        kindLabel: cell(row, "事件类型"),
        description: cell(row, "描述"),
        location: cell(row, "地点"),
        characterNames: cell(row, "涉及角色"),
      });
    }
  }

  return result;
}

function labelToValue<T extends string>(options: ReadonlyArray<{ value: T; label: string }>, label: string) {
  return options.find((option) => option.label === label)?.value ?? null;
}

export type NameToId = Map<string, string>;

/** Turns the CSV rows into the same shape the JSON backup carries. */
export function resolveWorkspaceRows(
  rows: CsvWorkspaceRows,
  nameToId: NameToId,
  makeId: (prefix: string, index: number) => string,
) {
  const relationships = rows.relationships
    .map((row, index) => {
      const fromId = nameToId.get(row.fromName);
      const toId = nameToId.get(row.toName);
      const kind = labelToValue(RELATIONSHIP_KINDS, row.kindLabel);

      if (!fromId || !toId || fromId === toId || !kind) {
        return null;
      }

      return {
        id: makeId("rel", index),
        fromId,
        toId,
        kind,
        note: row.note || undefined,
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);

  const world = rows.world
    .map((row, index) => {
      const category = labelToValue(WORLD_CATEGORIES, row.categoryLabel);

      if (!row.name || !category) {
        return null;
      }

      return {
        id: makeId("world", index),
        name: row.name,
        category,
        parentName: row.parentName,
        tags: splitList(row.tags),
        summary: row.summary || undefined,
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);

  // A parent is written by name, so it is resolved in a second pass once every
  // entry has an id — the same reason the JSON path refuses a dangling parent.
  const worldByName = new Map(world.map((entry) => [entry.name, entry.id]));

  const timeline = rows.timeline
    .map((row, index) => {
      const kind = labelToValue(TIMELINE_EVENT_KINDS, row.kindLabel);

      if (!row.title || !row.date || !kind) {
        return null;
      }

      return {
        id: makeId("event", index),
        title: row.title,
        date: row.date,
        era: row.era || undefined,
        kind,
        description: row.description || undefined,
        location: row.location || undefined,
        characterIds: splitList(row.characterNames)
          .map((name) => nameToId.get(name))
          .filter((id): id is string => Boolean(id)),
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);

  return {
    relationships,
    timeline,
    world: world.map((entry) => ({
      id: entry.id,
      name: entry.name,
      category: entry.category,
      parentId: worldByName.get(entry.parentName),
      tags: entry.tags,
      summary: entry.summary,
    })),
  };
}
