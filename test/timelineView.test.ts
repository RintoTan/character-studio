import { describe, expect, it } from "vitest";
import type { TimelineEvent } from "../src/types/timeline";
import {
  EVERY_KIND,
  EVERY_YEAR,
  descriptionSummary,
  emptyTimelineFilter,
  filterTimelineEvents,
  groupTimelineByYear,
  isTimelineFilterActive,
  timelineYears,
} from "../src/pages/timeline/timelineView";

const names: Record<string, string> = { "c-1": "沈青梧", "c-2": "陆停云" };
const nameOf = (id: string) => names[id];

function event(overrides: Partial<TimelineEvent> & { id: string }): TimelineEvent {
  return {
    title: "",
    date: "2025-06-14",
    kind: "turning",
    location: "",
    description: "",
    era: "",
    characterIds: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  } as TimelineEvent;
}

const events: TimelineEvent[] = [
  event({ id: "e-1", title: "灯塔的第一夜", date: "2024-03-01", kind: "origin", location: "北境", characterIds: ["c-1"] }),
  event({ id: "e-2", title: "红藻记录", date: "2024-11-19", kind: "turning", description: "会呼吸的红藻", location: "雾隐", characterIds: ["c-2"] }),
  event({ id: "e-3", title: "四十人会盟", date: "2025-06-14", kind: "bond", location: "北境", characterIds: ["c-1", "c-2"] }),
  event({ id: "e-4", title: "旧灯塔熄灯", date: "2026-02-27", kind: "loss", era: "光历 320 年" }),
];

describe("timeline filtering", () => {
  it("returns the stored list untouched when nothing is set", () => {
    // The stored order is chronological and is the only ordering rule; an unfiltered
    // view must not copy or re-sort it.
    expect(filterTimelineEvents(events, emptyTimelineFilter, nameOf)).toBe(events);
    expect(isTimelineFilterActive(emptyTimelineFilter)).toBe(false);
  });

  it("searches title, description, location, calendar label and character names", () => {
    const search = (query: string) =>
      filterTimelineEvents(events, { ...emptyTimelineFilter, query }, nameOf).map((item) => item.id);

    expect(search("灯塔")).toEqual(["e-1", "e-4"]); // title, both ways
    expect(search("红藻")).toEqual(["e-2"]); // description
    expect(search("雾隐")).toEqual(["e-2"]); // location
    expect(search("光历")).toEqual(["e-4"]); // era
    expect(search("陆停云")).toEqual(["e-2", "e-3"]); // through the name, not the id
    expect(search("c-2")).toEqual([]); // an id is not a name
  });

  it("ignores surrounding spaces and case", () => {
    expect(filterTimelineEvents(events, { ...emptyTimelineFilter, query: "  会盟  " }, nameOf)).toHaveLength(1);
    const latin = [event({ id: "x", title: "Ashfall" })];
    expect(filterTimelineEvents(latin, { ...emptyTimelineFilter, query: " ashFALL " }, nameOf)).toHaveLength(1);
  });

  it("combines the year and the kind with the search", () => {
    const combined = filterTimelineEvents(
      events,
      { query: "北境", year: "2024", kind: "bond" },
      nameOf,
    );
    expect(combined).toEqual([]);
    expect(
      filterTimelineEvents(events, { query: "北境", year: "2025", kind: "bond" }, nameOf).map((item) => item.id),
    ).toEqual(["e-3"]);
    expect(
      filterTimelineEvents(events, { ...emptyTimelineFilter, year: "2024" }, nameOf).map((item) => item.id),
    ).toEqual(["e-1", "e-2"]);
    expect(
      filterTimelineEvents(events, { ...emptyTimelineFilter, kind: "loss" }, nameOf).map((item) => item.id),
    ).toEqual(["e-4"]);
  });

  it("keeps the stored order and the stored events intact", () => {
    const before = JSON.stringify(events);
    const filtered = filterTimelineEvents(events, { ...emptyTimelineFilter, query: "北境" }, nameOf);

    expect(filtered.map((item) => item.id)).toEqual(["e-1", "e-3"]);
    expect(JSON.stringify(events)).toBe(before);
    expect(filtered.every((item) => events.includes(item))).toBe(true);
  });
});

describe("timeline grouping", () => {
  it("groups by year in the order the events arrived", () => {
    expect(groupTimelineByYear(events).map(([year, items]) => [year, items.map((item) => item.id)])).toEqual([
      ["2024", ["e-1", "e-2"]],
      ["2025", ["e-3"]],
      ["2026", ["e-4"]],
    ]);
  });

  it("keeps two events of one year in the order they were stored", () => {
    const sameYear = groupTimelineByYear(events)[0][1];

    expect(sameYear).toHaveLength(2);
    expect(sameYear.map((item) => item.date)).toEqual(["2024-03-01", "2024-11-19"]);
  });

  it("has nothing to group when nothing matched", () => {
    expect(groupTimelineByYear([])).toEqual([]);
    expect(timelineYears([])).toEqual([]);
  });

  it("offers only the years of what is on screen", () => {
    const filtered = filterTimelineEvents(events, { ...emptyTimelineFilter, query: "灯塔" }, nameOf);

    // A 2025 button that scrolls to a group which is not drawn is worse than no button.
    expect(timelineYears(filtered)).toEqual(["2024", "2026"]);
    expect(timelineYears(events)).toEqual(["2024", "2025", "2026"]);
  });
});

describe("description summary", () => {
  it("leaves a short description alone", () => {
    expect(descriptionSummary("一次性到场的四十人。")).toEqual({ text: "一次性到场的四十人。", truncated: false });
    expect(descriptionSummary("  两端留白被去掉  ")).toEqual({ text: "两端留白被去掉", truncated: false });
  });

  it("cuts a long one at punctuation rather than mid-clause", () => {
    const text = `${"第一段内容，".repeat(12)}收尾。`;
    const summary = descriptionSummary(text, 40);

    expect(summary.truncated).toBe(true);
    expect(summary.text.length).toBeLessThanOrEqual(40);
    expect(summary.text.endsWith("，")).toBe(true);
    expect(text.startsWith(summary.text)).toBe(true);
  });

  it("cuts at the limit when there is no punctuation to cut at", () => {
    const summary = descriptionSummary("字".repeat(300), 120);

    expect(summary.truncated).toBe(true);
    expect(summary.text).toHaveLength(120);
  });
});

describe("timeline filter shape", () => {
  it("treats a spaces-only search as no search at all", () => {
    expect(isTimelineFilterActive({ query: "   ", year: EVERY_YEAR, kind: EVERY_KIND })).toBe(false);
    expect(filterTimelineEvents(events, { query: "   ", year: EVERY_YEAR, kind: EVERY_KIND }, nameOf)).toBe(events);
  });
});
