import { useState } from "react";
import { AvatarDisplay } from "./AvatarDisplay";
import { DEFAULT_AVATAR_EMOJI } from "../data/avatarCategories";
import { Icon } from "./Icon";
import { formatTimelineDate, timelineEventKindLabel } from "../types/timeline";
import { worldCategoryLabel } from "../types/world";
import type { Character } from "../types/character";
import type { Relationship } from "../types/relationship";
import type { TimelineEvent } from "../types/timeline";
import type { WorldEntry } from "../types/world";
import {
  RELATED_PREVIEW_LIMIT,
  relationshipDirectionLabel,
  relationshipPeerId,
  relationshipsOf,
  timelineEventsOf,
  worldEntriesOf,
} from "../utils/characterLinks";
import { worldPathOf } from "../pages/world/worldView";

type CharacterRelatedInfoProps = {
  character: Character;
  characters: Character[];
  relationships: Relationship[];
  events: TimelineEvent[];
  entries: WorldEntry[];
  onOpenCharacter: (characterId: string) => void;
  onOpenGraph: () => void;
  onOpenEvent: (eventId: string) => void;
  onOpenEntry: (entryId: string) => void;
};

/**
 * What this character is connected to, read from the records that already say so.
 *
 * Reading material, not part of the character: it sits after the character's own cards
 * and outside the capture root, so a PDF or image export still contains exactly the
 * character. Each group shows a few rows and offers the rest — a character in forty
 * events must not turn the preview into a list of forty things.
 */
export function CharacterRelatedInfo({
  character,
  characters,
  relationships,
  events,
  entries,
  onOpenCharacter,
  onOpenGraph,
  onOpenEvent,
  onOpenEntry,
}: CharacterRelatedInfoProps) {
  const [expanded, setExpanded] = useState<{ relations: boolean; events: boolean; entries: boolean }>({
    relations: false,
    events: false,
    entries: false,
  });

  const characterById = new Map(characters.map((entry) => [entry.id, entry]));
  const relations = relationshipsOf(relationships, character.id);
  const relatedEvents = timelineEventsOf(events, character.id);
  const relatedEntries = worldEntriesOf(entries, character.id);

  const show = (kind: keyof typeof expanded, total: number) =>
    expanded[kind] ? total : Math.min(total, RELATED_PREVIEW_LIMIT);

  function toggle(kind: keyof typeof expanded) {
    setExpanded((current) => ({ ...current, [kind]: !current[kind] }));
  }

  function moreButton(kind: keyof typeof expanded, total: number, noun: string) {
    if (total <= RELATED_PREVIEW_LIMIT) {
      return null;
    }

    return (
      <button className="related-more" onClick={() => toggle(kind)} type="button">
        {expanded[kind] ? "收起" : `查看全部 ${total} ${noun}`}
      </button>
    );
  }

  return (
    <section aria-label="关联信息" className="preview-related">
      <div className="preview-related-head">
        <h3>关联信息</h3>
        <p className="muted">
          {relations.length} 条关系 · {relatedEvents.length} 个事件 · {relatedEntries.length} 个条目
        </p>
      </div>

      <div className="preview-related-grid">
        {/* Relationships. The edge's own direction is kept: 师承 A→B is not 师承 B→A. */}
        <section className="related-group">
          <div className="related-group-head">
            <h4>
              角色关系
              <span className="related-count">{relations.length}</span>
            </h4>
            <button className="related-group-action" onClick={onOpenGraph} type="button">
              在关系网中查看
              <Icon name="chevronRight" size={14} />
            </button>
          </div>
          {relations.length === 0 ? (
            <p className="related-empty">还没有与其他角色的关系。</p>
          ) : (
            <>
              <ul className="related-list">
                {relations.slice(0, show("relations", relations.length)).map((relationship) => {
                  const peerId = relationshipPeerId(relationship, character.id);
                  const peer = characterById.get(peerId);

                  return (
                    <li className="related-row" key={relationship.id}>
                      <button
                        className="related-peer"
                        onClick={() => onOpenCharacter(peerId)}
                        type="button"
                      >
                        <AvatarDisplay
                          assetId={peer?.avatarAssetId}
                          className="related-peer-avatar"
                          emoji={peer?.avatarEmoji || DEFAULT_AVATAR_EMOJI}
                        />
                        <span className="related-peer-name">{peer?.name || "未命名角色"}</span>
                      </button>
                      <span className="related-kind">
                        {relationshipDirectionLabel(relationship, character.id)}
                      </span>
                      {relationship.note && <span className="related-note">{relationship.note}</span>}
                    </li>
                  );
                })}
              </ul>
              {moreButton("relations", relations.length, "条关系")}
            </>
          )}
        </section>

        {/* Events, in the timeline's own order. */}
        <section className="related-group">
          <div className="related-group-head">
            <h4>
              参与事件
              <span className="related-count">{relatedEvents.length}</span>
            </h4>
          </div>
          {relatedEvents.length === 0 ? (
            <p className="related-empty">还没有参与任何事件。</p>
          ) : (
            <>
              <ul className="related-list">
                {relatedEvents.slice(0, show("events", relatedEvents.length)).map((event) => (
                  <li className="related-row" key={event.id}>
                    <button className="related-item" onClick={() => onOpenEvent(event.id)} type="button">
                      <span className="related-item-title">{event.title}</span>
                      <span className="related-item-meta">
                        <span className="related-kind">{timelineEventKindLabel(event.kind)}</span>
                        <time dateTime={event.date}>{formatTimelineDate(event)}</time>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              {moreButton("events", relatedEvents.length, "个事件")}
            </>
          )}
        </section>

        {/* World entries, with the path so a deep one is recognisable. */}
        <section className="related-group">
          <div className="related-group-head">
            <h4>
              关联世界观
              <span className="related-count">{relatedEntries.length}</span>
            </h4>
          </div>
          {relatedEntries.length === 0 ? (
            <p className="related-empty">还没有关联的世界观条目。</p>
          ) : (
            <>
              <ul className="related-list">
                {relatedEntries.slice(0, show("entries", relatedEntries.length)).map((entry) => {
                  const path = worldPathOf(entries, entry.id);

                  return (
                    <li className="related-row" key={entry.id}>
                      <button className="related-item" onClick={() => onOpenEntry(entry.id)} type="button">
                        <span className="related-item-title">{entry.name}</span>
                        <span className="related-item-meta">
                          <span className="related-kind">{worldCategoryLabel(entry.category)}</span>
                          {path.length > 0 && (
                            <span className="related-item-path">
                              {path.map((parent) => parent.name).join(" › ")}
                            </span>
                          )}
                        </span>
                        {entry.summary && <span className="related-item-summary">{entry.summary}</span>}
                      </button>
                    </li>
                  );
                })}
              </ul>
              {moreButton("entries", relatedEntries.length, "个条目")}
            </>
          )}
        </section>
      </div>
    </section>
  );
}
