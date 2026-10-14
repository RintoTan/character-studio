// Timeline events, the second 2.0 domain.
//
// OC worlds are often dated on a fictional calendar ("光历 318 年"), so an event
// carries two things: a real sortable `date` used for ordering, and an optional
// `era` label that is what the author actually sees. Sorting never depends on
// the label, so a made-up calendar still lands in a stable order.
export type TimelineEventKind = "origin" | "turning" | "bond" | "conflict" | "loss" | "other";

export type TimelineEvent = {
  id: string;
  title: string;
  /** ISO date, padded to a full YYYY-MM-DD so ordering is total. */
  date: string;
  /** Display calendar, e.g. "光历 318 年". Falls back to the formatted date. */
  era?: string;
  kind: TimelineEventKind;
  description?: string;
  location?: string;
  /** Characters involved. Pruned when a character is deleted. */
  characterIds: string[];
  createdAt: string;
  updatedAt: string;
};

export const TIMELINE_EVENT_KINDS: Array<{ value: TimelineEventKind; label: string }> = [
  { value: "origin", label: "起源" },
  { value: "turning", label: "转折" },
  { value: "bond", label: "羁绊" },
  { value: "conflict", label: "冲突" },
  { value: "loss", label: "失去" },
  { value: "other", label: "其他" },
];

export function timelineEventKindLabel(kind: TimelineEventKind): string {
  return TIMELINE_EVENT_KINDS.find((entry) => entry.value === kind)?.label ?? "其他";
}

export function isTimelineEventKind(value: unknown): value is TimelineEventKind {
  return typeof value === "string" && TIMELINE_EVENT_KINDS.some((entry) => entry.value === value);
}

/** Pads a partial date so every event has a comparable value. */
export function padDate(value: string): string | null {
  const match = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?$/.exec(value.trim());
  if (!match) {
    return null;
  }
  const [, year, month = "01", day = "01"] = match;
  const monthNumber = Number(month);
  const dayNumber = Number(day);
  if (monthNumber < 1 || monthNumber > 12 || dayNumber < 1 || dayNumber > 31) {
    return null;
  }
  return `${year}-${month}-${day}`;
}

export function timelineYear(date: string): string {
  return date.slice(0, 4);
}

export function formatTimelineDate(event: Pick<TimelineEvent, "date" | "era">): string {
  return event.era?.trim() ? event.era : event.date;
}
