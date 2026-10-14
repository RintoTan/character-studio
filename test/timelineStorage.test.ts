// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import {
  TIMELINE_KEY,
  createTimelineEvent,
  deleteTimelineEvent,
  eventsForCharacter,
  loadTimeline,
  pruneTimelineCharacters,
  saveTimeline,
  upsertTimelineEvent,
} from "../src/storage/timelineStorage";
import { formatTimelineDate, padDate, timelineYear } from "../src/types/timeline";

const event = (over: Record<string, unknown> = {}) => ({
  id: "e1",
  title: "离开故乡",
  date: "2026-03-04",
  kind: "origin",
  characterIds: [],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...over,
});

describe("padDate", () => {
  it("accepts a full date, a year-month and a bare year", () => {
    expect(padDate("2026-03-04")).toBe("2026-03-04");
    expect(padDate("2026-03")).toBe("2026-03-01");
    expect(padDate("2026")).toBe("2026-01-01");
  });

  it("trims surrounding whitespace", () => {
    expect(padDate("  2026-05  ")).toBe("2026-05-01");
  });

  it("rejects values that cannot be placed on a timeline", () => {
    for (const value of ["", "not a date", "2026-13", "2026-00", "2026-02-40", "26-01", "光历318年"]) {
      expect(padDate(value)).toBeNull();
    }
  });
});

describe("timelineStorage", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("returns an empty list when nothing is stored", () => {
    expect(loadTimeline()).toEqual([]);
  });

  it("survives an unreadable value", () => {
    localStorage.setItem(TIMELINE_KEY, "{ not json");
    expect(loadTimeline()).toEqual([]);

    localStorage.setItem(TIMELINE_KEY, JSON.stringify("a string"));
    expect(loadTimeline()).toEqual([]);
  });

  it("round-trips an event", () => {
    saveTimeline([event() as never]);

    const [loaded] = loadTimeline();
    expect(loaded.title).toBe("离开故乡");
    expect(loaded.kind).toBe("origin");
    expect(loaded.date).toBe("2026-03-04");
  });

  it("returns events oldest first regardless of insertion order", () => {
    saveTimeline([
      event({ id: "late", date: "2026-09-01" }) as never,
      event({ id: "early", date: "2026-02-01" }) as never,
      event({ id: "mid", date: "2026-05-01" }) as never,
    ]);

    expect(loadTimeline().map((e) => e.id)).toEqual(["early", "mid", "late"]);
  });

  it("orders same-day events by creation time", () => {
    saveTimeline([
      event({ id: "second", createdAt: "2026-02-02T00:00:00.000Z" }) as never,
      event({ id: "first", createdAt: "2026-01-01T00:00:00.000Z" }) as never,
    ]);

    expect(loadTimeline().map((e) => e.id)).toEqual(["first", "second"]);
  });

  it("drops entries that cannot be placed on a timeline", () => {
    localStorage.setItem(
      TIMELINE_KEY,
      JSON.stringify([
        event(),
        event({ id: "no-title", title: "   " }),
        event({ id: "no-date", date: "someday" }),
        { date: "2026-01-01", title: "id 缺失" },
        "string",
        null,
      ]),
    );

    expect(loadTimeline().map((e) => e.id)).toEqual(["e1"]);
  });

  it("keeps an unknown kind as other rather than dropping the event", () => {
    localStorage.setItem(TIMELINE_KEY, JSON.stringify([event({ kind: "invented" })]));
    expect(loadTimeline()[0].kind).toBe("other");
  });

  it("de-duplicates repeated character links and non-string ids", () => {
    localStorage.setItem(
      TIMELINE_KEY,
      JSON.stringify([event({ characterIds: ["a", "a", "b", 7, null, ""] })]),
    );

    expect(loadTimeline()[0].characterIds).toEqual(["a", "b"]);
  });

  it("collapses duplicate ids", () => {
    localStorage.setItem(TIMELINE_KEY, JSON.stringify([event(), event({ title: "重复" })]));
    expect(loadTimeline()).toHaveLength(1);
  });

  it("adds then updates in place", () => {
    const created = createTimelineEvent({ title: "初遇", date: "2026-04", kind: "bond" });
    expect(created).not.toBeNull();

    upsertTimelineEvent(created!);
    expect(loadTimeline()).toHaveLength(1);

    upsertTimelineEvent({ ...created!, title: "初遇（改）", kind: "turning" });
    const loaded = loadTimeline();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].title).toBe("初遇（改）");
    expect(loaded[0].kind).toBe("turning");
    // A partial date is padded so ordering stays total.
    expect(loaded[0].date).toBe("2026-04-01");
  });

  it("refuses to create an event without a title or with an unusable date", () => {
    expect(createTimelineEvent({ title: "  ", date: "2026-01-01", kind: "other" })).toBeNull();
    expect(createTimelineEvent({ title: "有标题", date: "光历318年", kind: "other" })).toBeNull();
  });

  it("deletes one event and leaves the rest", () => {
    upsertTimelineEvent(createTimelineEvent({ title: "A", date: "2026-01", kind: "other" })!);
    upsertTimelineEvent(createTimelineEvent({ title: "B", date: "2026-02", kind: "other" })!);

    deleteTimelineEvent(loadTimeline()[0].id);

    expect(loadTimeline().map((e) => e.title)).toEqual(["B"]);
  });

  it("drops character links that no longer exist but keeps the event", () => {
    upsertTimelineEvent(
      createTimelineEvent({ title: "三人结盟", date: "2026-06", kind: "bond", characterIds: ["a", "b", "c"] })!,
    );

    pruneTimelineCharacters(["a", "c"]);

    const loaded = loadTimeline();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].characterIds).toEqual(["a", "c"]);
  });

  it("finds the events a character appears in", () => {
    upsertTimelineEvent(createTimelineEvent({ title: "A 线", date: "2026-01", kind: "other", characterIds: ["a"] })!);
    upsertTimelineEvent(createTimelineEvent({ title: "B 线", date: "2026-02", kind: "other", characterIds: ["b"] })!);

    expect(eventsForCharacter("a").map((e) => e.title)).toEqual(["A 线"]);
  });
});

describe("timeline display helpers", () => {
  it("prefers the author's calendar label over the raw date", () => {
    expect(formatTimelineDate({ date: "2026-03-04", era: "光历 318 年" })).toBe("光历 318 年");
    expect(formatTimelineDate({ date: "2026-03-04" })).toBe("2026-03-04");
    expect(formatTimelineDate({ date: "2026-03-04", era: "   " })).toBe("2026-03-04");
  });

  it("groups by year from the sortable date", () => {
    expect(timelineYear("0318-05-01")).toBe("0318");
  });
});
