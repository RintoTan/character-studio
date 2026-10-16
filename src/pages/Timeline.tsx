import { useEffect, useMemo, useState } from "react";
import { useDialogKeyboard } from "../hooks/useDialogKeyboard";
import { CharacterPicker } from "../components/CharacterPicker";
import { RelatedCharacters } from "../components/RelatedCharacters";
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

type TimelineProps = {
  characters: Character[];
  onBack: () => void;
  onOpenCharacter: (characterId: string) => void;
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

export function Timeline({ characters, onBack, onOpenCharacter }: TimelineProps) {
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [pendingDelete, setPendingDelete] = useState<TimelineEvent | null>(null);
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

  useEffect(() => {
    // Losing a character does not un-happen an event, but the link to it goes.
    setEvents(pruneTimelineCharacters(characters.map((character) => character.id)));
  }, [characters]);

  const characterById = useMemo(
    () => new Map(characters.map((character) => [character.id, character])),
    [characters],
  );

  const grouped = useMemo(() => {
    const map = new Map<string, TimelineEvent[]>();
    for (const event of events) {
      const year = timelineYear(event.date);
      map.set(year, [...(map.get(year) ?? []), event]);
    }
    return [...map.entries()];
  }, [events]);

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
      <div className="workspace-card-head">
        <div>
          <p className="eyebrow">TIMELINE</p>
          <h2>世界观时间线</h2>
          <p className="muted">
            {events.length} 个事件 · {grouped.length} 个年份
          </p>
        </div>
        <div className="workspace-toolbar">
          <button className="ghost-button" onClick={onBack} type="button">
            返回 Dashboard
          </button>
          <button className="primary-button" onClick={() => setDraft(emptyDraft())} type="button">
            新建事件
          </button>
        </div>
      </div>

      {events.length === 0 ? (
        <div className="empty-state">
          <h3>还没有事件</h3>
          <p>记录角色与世界观的关键节点，时间线会按日期自动排序。</p>
        </div>
      ) : (
        <ol className="timeline-rail">
          {grouped.map(([year, yearEvents]) => (
            <li className="timeline-year-group" key={year}>
              <h3 className="timeline-year">{year}</h3>
              <ol className="timeline-events">
                {yearEvents.map((event) => (
                  <li className="timeline-item" key={event.id}>
                    <article className="timeline-card">
                      <div className="timeline-card-head">
                        <span className={`timeline-kind-chip kind-${event.kind}`}>
                          {timelineEventKindLabel(event.kind)}
                        </span>
                        <time dateTime={event.date}>{formatTimelineDate(event)}</time>
                        <span className="timeline-actions">
                          <button className="ghost-button" onClick={() => startEdit(event)} type="button">
                            编辑
                          </button>
                          <button
                            aria-label={`删除事件 ${event.title}`}
                            className="danger-button"
                            onClick={() => setPendingDelete(event)}
                            type="button"
                          >
                            删除
                          </button>
                        </span>
                      </div>
                      <h4>{event.title}</h4>
                      {event.location && <p className="timeline-meta">地点：{event.location}</p>}
                      {event.description && <p className="timeline-description">{event.description}</p>}
                      <RelatedCharacters
                        characters={event.characterIds.flatMap((id) => {
                          const character = characterById.get(id);
                          return character ? [character] : [];
                        })}
                        onOpenCharacter={onOpenCharacter}
                      />
                    </article>
                  </li>
                ))}
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
            <label className="field">
              <span>标题</span>
              <input
                onChange={(event) => setDraft({ ...draft, title: event.target.value })}
                placeholder="例如：离开故乡"
                type="text"
                value={draft.title}
              />
            </label>
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
                <span>纪年显示（可选）</span>
                <input
                  onChange={(event) => setDraft({ ...draft, era: event.target.value })}
                  placeholder="例如：光历 318 年"
                  type="text"
                  value={draft.era}
                />
              </label>
            </div>
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
                <span>地点（可选）</span>
                <input
                  onChange={(event) => setDraft({ ...draft, location: event.target.value })}
                  type="text"
                  value={draft.location}
                />
              </label>
            </div>
            <label className="field">
              <span>描述（可选）</span>
              <textarea
                onChange={(event) => setDraft({ ...draft, description: event.target.value })}
                rows={3}
                value={draft.description}
              />
            </label>
            {characters.length > 0 && (
              <CharacterPicker
                characters={characters}
                legend="涉及角色"
                onChange={(characterIds) => setDraft({ ...draft, characterIds })}
                selectedIds={draft.characterIds}
              />
            )}
            <div className="form-actions">
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
    </section>
  );
}
