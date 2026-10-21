import { useEffect, useMemo, useRef, useState } from "react";
import { useLightDismiss } from "../hooks/useLightDismiss";
import { useDialogKeyboard } from "../hooks/useDialogKeyboard";
import { CharacterPicker } from "../components/CharacterPicker";
import { Icon } from "../components/Icon";
import { RelatedCharacters } from "../components/RelatedCharacters";
import { WorkspaceHeader } from "../components/WorkspaceHeader";
import TimelineGuide from "../components/TimelineGuide";
import {
  createTimelineEvent,
  deleteTimelineEvent,
  loadTimeline,
  pruneTimelineCharacters,
  upsertTimelineEvent,
} from "../storage/timelineStorage";
import type { Character } from "../types/character";
import {
  TIMELINE_EVENT_KINDS,
  formatTimelineDate,
  timelineEventKindLabel,
  timelineYear,
  type TimelineEvent,
  type TimelineEventKind,
} from "../types/timeline";
import {
  EVERY_KIND,
  EVERY_YEAR,
  descriptionSummary,
  emptyTimelineFilter,
  filterTimelineEvents,
  groupTimelineByYear,
  isTimelineFilterActive,
  timelineYears,
  type TimelineFilter,
} from "./timeline/timelineView";

type TimelineProps = {
  characters: Character[];
  onBack: () => void;
  onOpenCharacter: (characterId: string) => void;
  /** The event another screen asked to see, consumed once. */
  focusEventId?: string | null;
  onFocusHandled?: () => void;
};

type Draft = {
  id?: string;
  title: string;
  date: string;
  era: string;
  kind: TimelineEventKind;
  location: string;
  description: string;
  characterIds: string[];
};

const emptyDraft = (): Draft => ({
  title: "",
  date: new Date().toISOString().slice(0, 10),
  era: "",
  kind: "turning",
  location: "",
  description: "",
  characterIds: [],
});

// How far below the top of the window a year has to sit before the year navigation
// calls it the current one. A little more than the sticky top bar, so the year that is
// being read is the one just under it rather than the one already scrolled past.
const YEAR_READ_OFFSET = 150;

export function Timeline({
  characters,
  onBack,
  onOpenCharacter,
  focusEventId = null,
  onFocusHandled,
}: TimelineProps) {
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [pendingDelete, setPendingDelete] = useState<TimelineEvent | null>(null);
  const [filter, setFilter] = useState<TimelineFilter>(emptyTimelineFilter);
  // Which cards are showing their whole description. A view state, not a stored one:
  // what a reader opened to read is not a property of the event.
  const [expandedIds, setExpandedIds] = useState<string[]>([]);
  const [activeYear, setActiveYear] = useState("");
  const yearNavRef = useRef<HTMLElement | null>(null);
  // The event another screen asked to see, lit up until it is looked at.
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const yearRefs = useRef(new Map<string, HTMLLIElement>());
  // Both dialogs take the keyboard: Escape cancels, Enter saves, focus moves in.
  const draftDialogRef = useDialogKeyboard({
    active: Boolean(draft),
    onClose: () => setDraft(null),
    onConfirm: submitDraft,
  });
  const deleteDialogRef = useDialogKeyboard({
    active: Boolean(pendingDelete),
    onClose: () => setPendingDelete(null),
    onConfirm: confirmDelete,
  });

  const [eventsLoaded, setEventsLoaded] = useState(false);

  useEffect(() => {
    // Losing a character does not un-happen an event, but the link to it goes.
    setEvents(pruneTimelineCharacters(characters.map((character) => character.id)));
    setEventsLoaded(true);
  }, [characters]);

  const characterById = useMemo(
    () => new Map(characters.map((character) => [character.id, character])),
    [characters],
  );
  const nameOf = useMemo(
    () => (characterId: string) => characterById.get(characterId)?.name,
    [characterById],
  );

  // Everything below the toolbar reads from these three: what matches, how it groups,
  // and which years the navigation can offer. Nothing re-sorts — the stored order is
  // chronological and is what both the list and the grouping follow.
  const visibleEvents = useMemo(
    () => filterTimelineEvents(events, filter, nameOf),
    [events, filter, nameOf],
  );
  const grouped = useMemo(() => groupTimelineByYear(visibleEvents), [visibleEvents]);
  const storedYears = useMemo(() => timelineYears(events), [events]);
  const isFiltered = isTimelineFilterActive(filter);
  // What the 筛选 entry counts on a phone. The query has its own visible field, so this
  // is the two selects the toolbar folds away.
  const activeFilterCount =
    (filter.year === EVERY_YEAR ? 0 : 1) + (filter.kind === EVERY_KIND ? 0 : 1);
  const [filtersOpen, setFiltersOpen] = useState(false);
  // The filter row is a light layer: outside click and Escape close it, the trigger
  // toggles it, and the row itself is "inside".
  const filterWrapRef = useLightDismiss({ open: filtersOpen, onClose: () => setFiltersOpen(false) });

  // Which year is being read, for the navigation's own feedback. Measured on scroll
  // rather than stored: the year heading is the only authority on where a year starts.
  useEffect(() => {
    if (grouped.length === 0) {
      setActiveYear("");
      return;
    }

    function readActiveYear() {
      let current = grouped[0][0];
      for (const [year] of grouped) {
        const node = yearRefs.current.get(year);
        if (node && node.getBoundingClientRect().top <= YEAR_READ_OFFSET) {
          current = year;
        }
      }
      setActiveYear(current);
    }

    readActiveYear();
    window.addEventListener("scroll", readActiveYear, { passive: true });
    return () => window.removeEventListener("scroll", readActiveYear);
  }, [grouped]);

  // Arriving from a character's preview with an event in hand: any filter that would
  // hide it is cleared first, because a jump that lands on a screen where the event is
  // not drawn is worse than no jump at all.
  useEffect(() => {
    if (!focusEventId || !eventsLoaded) {
      return;
    }

    const target = events.find((event) => event.id === focusEventId);
    if (!target) {
      onFocusHandled?.();
      return;
    }

    if (!visibleEvents.some((event) => event.id === focusEventId)) {
      setFilter(emptyTimelineFilter);
    }
    setActiveYear(timelineYear(target.date));
    setHighlightId(focusEventId);
    onFocusHandled?.();

    const frame = window.requestAnimationFrame(() => {
      document
        .querySelector(`[data-event-id="${focusEventId}"]`)
        ?.scrollIntoView({ block: "center", behavior: "smooth" });
    });
    const timer = window.setTimeout(() => setHighlightId(null), 2600);

    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [focusEventId, eventsLoaded, events, visibleEvents, onFocusHandled]);

  // The years are one rail that scrolls, not four rows of chips: with thirty-five
  // years the navigation used to take the top of the page. Keeping the year being
  // read in view is what makes a rail as usable as a wrapped grid.
  useEffect(() => {
    if (!activeYear) {
      return;
    }

    const nav = yearNavRef.current;
    const chip = nav?.querySelector<HTMLElement>(`[data-year="${activeYear}"]`);

    if (!nav || !chip) {
      return;
    }

    const left = chip.offsetLeft;
    const right = left + chip.offsetWidth;

    if (left < nav.scrollLeft || right > nav.scrollLeft + nav.clientWidth) {
      nav.scrollTo({ left: left - nav.clientWidth / 2 + chip.offsetWidth / 2, behavior: "smooth" });
    }
  }, [activeYear]);

  function jumpToYear(year: string) {
    setActiveYear(year);
    yearRefs.current.get(year)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function toggleExpanded(eventId: string) {
    setExpandedIds((current) =>
      current.includes(eventId) ? current.filter((id) => id !== eventId) : [...current, eventId],
    );
  }

  function submitDraft() {
    if (!draft || !draft.title.trim()) {
      return;
    }

    const created = createTimelineEvent({
      title: draft.title,
      date: draft.date,
      era: draft.era,
      kind: draft.kind,
      description: draft.description,
      location: draft.location,
      characterIds: draft.characterIds,
    });
    if (!created) {
      return;
    }

    // Editing keeps the original id, creation time and links.
    upsertTimelineEvent(draft.id ? { ...created, id: draft.id, createdAt: events.find((e) => e.id === draft.id)?.createdAt ?? created.createdAt } : created);
    setEvents(loadTimeline());
    setDraft(null);
  }

  function startEdit(event: TimelineEvent) {
    setDraft({
      id: event.id,
      title: event.title,
      date: event.date,
      era: event.era ?? "",
      kind: event.kind,
      location: event.location ?? "",
      description: event.description ?? "",
      characterIds: event.characterIds,
    });
  }

  function confirmDelete() {
    if (!pendingDelete) {
      return;
    }
    setEvents(deleteTimelineEvent(pendingDelete.id));
    setPendingDelete(null);
  }

  return (
    <section className="workspace-card timeline-page" id="workspace-timeline">
      <WorkspaceHeader
        eyebrow="时间线"
        title="世界观时间线"
        summary={
          <>
            {events.length} 个事件 · {timelineYears(events).length} 个年份
          </>
        }
        actions={
          <>
            <div className="toolbar-group">
              <button className="ghost-button" onClick={onBack} type="button">
                返回 Dashboard
              </button>
            </div>
            <div className="toolbar-group">
              <button className="primary-button" onClick={() => setDraft(emptyDraft())} type="button">
                新建事件
              </button>
            </div>
          </>
        }
      />

      {/* Search and filtering, once, above the list: the four things a long timeline is
          looked through — a word, a year, a kind and a character are all covered here. */}
      <div className="timeline-toolbar" ref={filterWrapRef}>
        <label className="timeline-search">
          <Icon name="search" size={15} />
          <input
            aria-label="搜索事件"
            onChange={(changeEvent) => setFilter({ ...filter, query: changeEvent.target.value })}
            placeholder="搜索标题、描述、地点、角色"
            type="search"
            value={filter.query}
          />
          {filter.query !== "" && (
            <button aria-label="清空搜索" onClick={() => setFilter({ ...filter, query: "" })} type="button">
              <Icon name="close" size={13} />
            </button>
          )}
        </label>
        {/* One entry that opens, instead of two selects and a clear button filling the
            first screen on a phone. On a desktop the row is always open and this
            control is not drawn at all. */}
        <button
          aria-expanded={filtersOpen}
          className="timeline-filter-toggle"
          onClick={() => setFiltersOpen((current) => !current)}
          type="button"
        >
          <Icon name="filter" size={15} />
          筛选{activeFilterCount > 0 ? `（${activeFilterCount}）` : ""}
        </button>
        <div className={filtersOpen ? "timeline-filter-row open" : "timeline-filter-row"}>
          <label className="timeline-filter">
            <span className="timeline-filter-label">年份</span>
            <select
              aria-label="按年份筛选"
              onChange={(changeEvent) => setFilter({ ...filter, year: changeEvent.target.value })}
              value={filter.year}
            >
              <option value={EVERY_YEAR}>{EVERY_YEAR}</option>
              {storedYears.map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>
          </label>
          <label className="timeline-filter">
            <span className="timeline-filter-label">类型</span>
            <select
              aria-label="按类型筛选"
              onChange={(changeEvent) =>
                setFilter({ ...filter, kind: changeEvent.target.value as TimelineFilter["kind"] })
              }
              value={filter.kind}
            >
              <option value={EVERY_KIND}>{EVERY_KIND}</option>
              {TIMELINE_EVENT_KINDS.map((kind) => (
                <option key={kind.value} value={kind.value}>
                  {kind.label}
                </option>
              ))}
            </select>
          </label>
          {isFiltered && (
            <button className="ghost-button timeline-clear" onClick={() => setFilter(emptyTimelineFilter)} type="button">
              清空筛选
            </button>
          )}
        </div>
        <span aria-live="polite" className="timeline-count">
          {isFiltered ? `匹配 ${visibleEvents.length} / ${events.length} 个事件` : `共 ${events.length} 个事件`}
        </span>
      </div>

      {/* Year navigation: only the years on screen, and only worth showing when there is
          more than one of them. */}
      {grouped.length > 1 && (
        <nav aria-label="年份导航" className="timeline-year-nav" ref={yearNavRef}>
          {grouped.map(([year, yearEvents]) => (
            <button
              aria-current={activeYear === year ? "true" : undefined}
              data-year={year}
              className={activeYear === year ? "timeline-year-jump active" : "timeline-year-jump"}
              key={year}
              onClick={() => jumpToYear(year)}
              type="button"
            >
              {year}
              <span className="timeline-year-count">{yearEvents.length}</span>
            </button>
          ))}
        </nav>
      )}

      {events.length === 0 ? (
        <div className="empty-state">
          <h3>还没有事件</h3>
          <p>记录角色与世界观的关键节点，时间线会按日期自动排序。</p>
        </div>
      ) : visibleEvents.length === 0 ? (
        <div className="empty-state">
          <h3>没有匹配的事件</h3>
          <p>
            当前条件（{filter.query.trim() ? `关键词「${filter.query.trim()}」` : "筛选"}
            {filter.year !== EVERY_YEAR ? ` · ${filter.year} 年` : ""}
            {filter.kind !== EVERY_KIND ? ` · ${timelineEventKindLabel(filter.kind)}` : ""}）没有匹配的事件。
          </p>
          <button className="ghost-button" onClick={() => setFilter(emptyTimelineFilter)} type="button">
            清空筛选
          </button>
        </div>
      ) : (
        /* One rail for the whole list, drawn once, with a node per year and per event:
           the order down the page is the order of the stored dates. */
        <ol className="timeline-rail">
          {grouped.map(([year, yearEvents]) => (
            <li
              className="timeline-year-group"
              key={year}
              ref={(node) => {
                if (node) {
                  yearRefs.current.set(year, node);
                } else {
                  yearRefs.current.delete(year);
                }
              }}
            >
              <h3 className="timeline-year">
                <span aria-hidden="true" className="timeline-year-node" />
                {year}
                <span className="timeline-year-count">{yearEvents.length}</span>
              </h3>
              <ol className="timeline-events">
                {yearEvents.map((event) => {
                  const summary = descriptionSummary(event.description ?? "");
                  const isExpanded = expandedIds.includes(event.id);

                  return (
                    <li
                      className={
                        highlightId === event.id ? "timeline-item highlighted" : "timeline-item"
                      }
                      data-event-id={event.id}
                      data-kind={event.kind}
                      key={event.id}
                    >
                      <article className="timeline-card">
                        {/* Identity first: what kind of moment this was and when. The
                            actions sit on the same row but read as text, so the row is
                            not two buttons with a title beside them. */}
                        <div className="timeline-card-head">
                          {/* Kind and date are one block, so the two actions keep their
                              own column on a narrow card instead of being pushed under
                              the date as a second line of the header. */}
                          <span className="timeline-card-meta">
                            <span className={`timeline-kind-chip kind-${event.kind}`}>
                              {timelineEventKindLabel(event.kind)}
                            </span>
                            <time dateTime={event.date}>{formatTimelineDate(event)}</time>
                          </span>
                          <span className="timeline-actions">
                            <button className="timeline-action" onClick={() => startEdit(event)} type="button">
                              编辑
                            </button>
                            <button
                              aria-label={`删除事件 ${event.title}`}
                              className="timeline-action danger"
                              onClick={() => setPendingDelete(event)}
                              type="button"
                            >
                              删除
                            </button>
                          </span>
                        </div>
                        <h4 className="timeline-card-title">{event.title}</h4>
                        {event.location && <p className="timeline-meta">地点：{event.location}</p>}
                        {event.description && (
                          <>
                            <p className="timeline-description">
                              {isExpanded ? event.description : summary.text}
                              {summary.truncated && !isExpanded ? "…" : ""}
                            </p>
                            {summary.truncated && (
                              <button
                                aria-expanded={isExpanded}
                                className="timeline-description-toggle"
                                onClick={() => toggleExpanded(event.id)}
                                type="button"
                              >
                                {isExpanded ? "收起描述" : "展开完整描述"}
                              </button>
                            )}
                          </>
                        )}
                        <RelatedCharacters
                          characters={event.characterIds.flatMap((id) => {
                            const character = characterById.get(id);
                            return character ? [character] : [];
                          })}
                          onOpenCharacter={onOpenCharacter}
                        />
                      </article>
                    </li>
                  );
                })}
              </ol>
            </li>
          ))}
        </ol>
      )}

      {draft && (
        <div className="modal-backdrop" role="presentation">
          <div
            className="confirm-dialog timeline-dialog"
            ref={draftDialogRef}
            role="dialog"
            aria-modal="true"
            aria-label="时间线事件"
          >
            <h2>{draft.id ? "编辑事件" : "新建事件"}</h2>

            <div className="timeline-dialog-body">
            {/* Grouped by the question each field answers: what happened, when, what it
                was, and who was there. */}
            <fieldset className="dialog-section">
              <legend>事件</legend>
              <label className="field">
                <span>
                  标题<em className="field-required">必填</em>
                </span>
                <input
                  autoFocus
                  onChange={(event) => setDraft({ ...draft, title: event.target.value })}
                  placeholder="例如：离开故乡"
                  type="text"
                  value={draft.title}
                />
              </label>
              <div className="field-row">
                <label className="field">
                  <span>类型</span>
                  <select
                    onChange={(event) => setDraft({ ...draft, kind: event.target.value as TimelineEventKind })}
                    value={draft.kind}
                  >
                    {TIMELINE_EVENT_KINDS.map((kind) => (
                      <option key={kind.value} value={kind.value}>
                        {kind.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>
                    地点<em className="field-optional">可选</em>
                  </span>
                  <input
                    onChange={(event) => setDraft({ ...draft, location: event.target.value })}
                    type="text"
                    value={draft.location}
                  />
                </label>
              </div>
            </fieldset>

            <fieldset className="dialog-section">
              <legend>时间</legend>
              <div className="field-row">
                <label className="field">
                  <span>日期</span>
                  <input
                    onChange={(event) => setDraft({ ...draft, date: event.target.value })}
                    type="date"
                    value={draft.date}
                  />
                </label>
                <label className="field">
                  <span>
                    纪年显示<em className="field-optional">可选</em>
                  </span>
                  <input
                    onChange={(event) => setDraft({ ...draft, era: event.target.value })}
                    placeholder="例如：光历 318 年"
                    type="text"
                    value={draft.era}
                  />
                </label>
              </div>
              <p className="field-hint">
                日期决定排序与年份分组；纪年显示只影响展示，留空时显示日期。两者互不换算。
              </p>
            </fieldset>

            <fieldset className="dialog-section">
              <legend>描述</legend>
              <label className="field">
                <span>
                  内容<em className="field-optional">可选</em>
                </span>
                <textarea
                  onChange={(event) => setDraft({ ...draft, description: event.target.value })}
                  placeholder="记下这次事件发生了什么。卡片上默认显示摘要，展开可读全文。"
                  rows={6}
                  value={draft.description}
                />
              </label>
            </fieldset>

            {characters.length > 0 && (
              <CharacterPicker
                characters={characters}
                legend="涉及角色"
                onChange={(characterIds) => setDraft({ ...draft, characterIds })}
                selectedIds={draft.characterIds}
              />
            )}

            </div>

            {/* Outside the scrolling body: with a long description and a character
                list the way out must not be a scroll away, and the list must not be
                hidden behind it. */}
            <div className="form-actions timeline-dialog-actions">
              <button className="ghost-button" onClick={() => setDraft(null)} type="button">
                取消
              </button>
              <button className="primary-button" disabled={!draft.title.trim()} onClick={submitDraft} type="button">
                保存事件
              </button>
            </div>
          </div>
        </div>
      )}

      {pendingDelete && (
        <div className="modal-backdrop" role="presentation">
          <div
            className="confirm-dialog"
            ref={deleteDialogRef}
            role="dialog"
            aria-modal="true"
            aria-label="删除事件"
          >
            <h2>删除事件</h2>
            <p>
              将删除「{pendingDelete.title}」（{formatTimelineDate(pendingDelete)}）。此操作不可撤销。
            </p>
            <div className="form-actions">
              <button className="ghost-button" onClick={() => setPendingDelete(null)} type="button">
                取消
              </button>
              <button className="danger-button" onClick={confirmDelete} type="button">
                确认删除
              </button>
            </div>
          </div>
        </div>
      )}

      {/* A line of the page under the list, not a card over it. */}
      <TimelineGuide />
    </section>
  );
}
