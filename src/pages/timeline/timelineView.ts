// Filtering, grouping and reading helpers for the timeline screen.
//
// Kept out of the component because these are the rules the screen is judged by —
// "which events are in this year", "does this event match" — and they are worth testing
// without a DOM. Nothing here writes: the filter is a view over the stored events, and
// `sortTimeline` (storage) stays the only thing that decides order.
import {
  formatTimelineDate,
  timelineYear,
  type TimelineEvent,
  type TimelineEventKind,
} from "../../types/timeline";

export const EVERY_YEAR = "全部年份";
export const EVERY_KIND = "全部类型";

export type TimelineFilter = {
  query: string;
  year: string;
  kind: TimelineEventKind | typeof EVERY_KIND;
};

export const emptyTimelineFilter: TimelineFilter = {
  query: "",
  year: EVERY_YEAR,
  kind: EVERY_KIND,
};

export function isTimelineFilterActive(filter: TimelineFilter): boolean {
  return filter.query.trim() !== "" || filter.year !== EVERY_YEAR || filter.kind !== EVERY_KIND;
}

/** Leading and trailing spaces are not a search term, and case is not a distinction. */
export function normalizeTimelineQuery(value: string): string {
  return value.trim().toLowerCase();
}

export type TimelineNameLookup = (characterId: string) => string | undefined;

/**
 * Whether one event matches the filter. The search covers everything a reader would
 * look for an event by: its title, its description, where it happened, the calendar
 * label, and the names of the characters it involves.
 */
export function matchesTimelineFilter(
  event: TimelineEvent,
  filter: TimelineFilter,
  nameOf: TimelineNameLookup,
): boolean {
  if (filter.year !== EVERY_YEAR && timelineYear(event.date) !== filter.year) {
    return false;
  }

  if (filter.kind !== EVERY_KIND && event.kind !== filter.kind) {
    return false;
  }

  const needle = normalizeTimelineQuery(filter.query);
  if (!needle) {
    return true;
  }

  const haystack = [
    event.title,
    event.description ?? "",
    event.location ?? "",
    event.era ?? "",
    // Through the lookup rather than the id: searching for a character by name is the
    // point, and an id is not a name.
    ...event.characterIds.map((id) => nameOf(id) ?? ""),
  ]
    .join("\n")
    .toLowerCase();

  return haystack.includes(needle);
}

/** The events the screen shows. Order is whatever the caller sorted, never re-sorted. */
export function filterTimelineEvents(
  events: TimelineEvent[],
  filter: TimelineFilter,
  nameOf: TimelineNameLookup,
): TimelineEvent[] {
  if (!isTimelineFilterActive(filter)) {
    return events;
  }

  return events.filter((event) => matchesTimelineFilter(event, filter, nameOf));
}

/**
 * The events of one year, in the order they arrived — that is the stored order, which
 * is chronological, so a year's events read top to bottom and never reshuffle.
 */
export function groupTimelineByYear(events: TimelineEvent[]): Array<[string, TimelineEvent[]]> {
  const map = new Map<string, TimelineEvent[]>();

  for (const event of events) {
    const year = timelineYear(event.date);
    const bucket = map.get(year);
    if (bucket) {
      bucket.push(event);
    } else {
      map.set(year, [event]);
    }
  }

  return [...map.entries()];
}

/**
 * The years the year navigation offers: the years of what is currently on screen, not
 * of everything stored. Filtering to 2025 must not leave a 2024 button that scrolls to
 * a group which is no longer drawn.
 */
export function timelineYears(events: TimelineEvent[]): string[] {
  return [...new Set(events.map((event) => timelineYear(event.date)))];
}

/** How much of a description a collapsed card shows. */
export const DESCRIPTION_SUMMARY_LIMIT = 120;

/**
 * The collapsed form of a description, cut at a character boundary. Chinese has no
 * spaces to break on, so the cut is made on punctuation when there is one nearby and
 * on the limit otherwise — never mid-word in a way that reads as a typo.
 */
export function descriptionSummary(
  description: string,
  limit = DESCRIPTION_SUMMARY_LIMIT,
): { text: string; truncated: boolean } {
  const text = description.trim();
  if (text.length <= limit) {
    return { text, truncated: false };
  }

  const window = text.slice(0, limit);
  const lastBreak = Math.max(
    window.lastIndexOf("。"),
    window.lastIndexOf("；"),
    window.lastIndexOf("，"),
    window.lastIndexOf("\n"),
  );
  const cut = lastBreak >= limit * 0.6 ? window.slice(0, lastBreak + 1) : window;

  return { text: cut.trimEnd(), truncated: true };
}

/** What the card shows above the title: the calendar label, else the stored date. */
export function timelineCardDate(event: TimelineEvent): string {
  return formatTimelineDate(event);
}
