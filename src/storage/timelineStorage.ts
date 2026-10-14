// Persistence for the timeline, in the same shape as the other stores: one key,
// everything normalised on read, an unreadable value degrades to an empty list.
import {
  isTimelineEventKind,
  padDate,
  type TimelineEvent,
  type TimelineEventKind,
} from "../types/timeline";

export const TIMELINE_KEY = "character-studio.timeline";

const EPOCH = new Date(0).toISOString();

function normalise(raw: unknown): TimelineEvent | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const candidate = raw as Partial<TimelineEvent>;
  if (!candidate.id) {
    return null;
  }

  const title = typeof candidate.title === "string" ? candidate.title.trim() : "";
  if (!title) {
    return null;
  }

  // An event without a usable date cannot be placed on a timeline at all.
  const date = typeof candidate.date === "string" ? padDate(candidate.date) : null;
  if (!date) {
    return null;
  }

  return {
    id: String(candidate.id),
    title,
    date,
    era: typeof candidate.era === "string" && candidate.era.trim() ? candidate.era.trim() : undefined,
    kind: isTimelineEventKind(candidate.kind) ? candidate.kind : "other",
    description:
      typeof candidate.description === "string" && candidate.description.trim()
        ? candidate.description
        : undefined,
    location:
      typeof candidate.location === "string" && candidate.location.trim() ? candidate.location : undefined,
    characterIds: Array.isArray(candidate.characterIds)
      ? [...new Set(candidate.characterIds.filter((id): id is string => typeof id === "string" && !!id))]
      : [],
    createdAt: typeof candidate.createdAt === "string" ? candidate.createdAt : EPOCH,
    updatedAt: typeof candidate.updatedAt === "string" ? candidate.updatedAt : EPOCH,
  };
}

/** Chronological, oldest first; the order a timeline is read in. */
export function loadTimeline(): TimelineEvent[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(TIMELINE_KEY) || "[]");
    if (!Array.isArray(parsed)) {
      return [];
    }

    const seen = new Set<string>();
    const events: TimelineEvent[] = [];
    for (const entry of parsed) {
      const event = normalise(entry);
      if (!event || seen.has(event.id)) {
        continue;
      }
      seen.add(event.id);
      events.push(event);
    }
    return sortTimeline(events);
  } catch {
    return [];
  }
}

export function sortTimeline(events: TimelineEvent[]): TimelineEvent[] {
  return [...events].sort(
    (a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt),
  );
}

export function saveTimeline(events: TimelineEvent[]): void {
  try {
    localStorage.setItem(TIMELINE_KEY, JSON.stringify(sortTimeline(events)));
  } catch {
    // A full quota must not take the screen down with it.
  }
}

export function upsertTimelineEvent(event: TimelineEvent): TimelineEvent[] {
  const events = loadTimeline();
  const index = events.findIndex((entry) => entry.id === event.id);
  if (index === -1) {
    events.push(event);
  } else {
    events[index] = event;
  }
  saveTimeline(events);
  return loadTimeline();
}

export function deleteTimelineEvent(id: string): TimelineEvent[] {
  saveTimeline(loadTimeline().filter((entry) => entry.id !== id));
  return loadTimeline();
}

/**
 * Drops character references that no longer exist. The event itself stays: losing
 * a character does not un-happen the event.
 */
export function pruneTimelineCharacters(validCharacterIds: Iterable<string>): TimelineEvent[] {
  const valid = new Set(validCharacterIds);
  const events = loadTimeline();
  const pruned = events.map((event) => {
    const characterIds = event.characterIds.filter((id) => valid.has(id));
    return characterIds.length === event.characterIds.length ? event : { ...event, characterIds };
  });
  saveTimeline(pruned);
  return loadTimeline();
}

export function eventsForCharacter(characterId: string): TimelineEvent[] {
  return loadTimeline().filter((event) => event.characterIds.includes(characterId));
}

export function createTimelineEvent(input: {
  title: string;
  date: string;
  era?: string;
  kind: TimelineEventKind;
  description?: string;
  location?: string;
  characterIds?: string[];
}): TimelineEvent | null {
  const date = padDate(input.date);
  const title = input.title.trim();
  if (!date || !title) {
    return null;
  }

  const now = new Date().toISOString();
  return {
    id: `evt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    title,
    date,
    era: input.era?.trim() ? input.era.trim() : undefined,
    kind: input.kind,
    description: input.description?.trim() ? input.description.trim() : undefined,
    location: input.location?.trim() ? input.location.trim() : undefined,
    characterIds: [...new Set(input.characterIds ?? [])],
    createdAt: now,
    updatedAt: now,
  };
}
