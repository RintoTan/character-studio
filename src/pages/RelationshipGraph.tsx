import { useEffect, useMemo, useState } from "react";
import {
  createRelationship,
  deleteRelationship,
  loadRelationships,
  pruneRelationships,
  saveRelationships,
} from "../storage/relationshipStorage";
import type { Character } from "../types/character";
import {
  RELATIONSHIP_KINDS,
  relationshipKindLabel,
  type Relationship,
  type RelationshipKind,
} from "../types/relationship";

type RelationshipGraphProps = {
  characters: Character[];
  onBack: () => void;
  onOpenCharacter: (characterId: string) => void;
};

const VIEW = 640;
const RADIUS = 236;

// A radial layout rather than a force simulation: with a handful of OCs it reads
// as a relationship wheel, it is deterministic, and it needs no layout library.
function nodePositions(count: number) {
  return Array.from({ length: count }, (_, index) => {
    const angle = (index / Math.max(count, 1)) * Math.PI * 2 - Math.PI / 2;
    return { x: VIEW / 2 + Math.cos(angle) * RADIUS, y: VIEW / 2 + Math.sin(angle) * RADIUS };
  });
}

export function RelationshipGraph({ characters, onBack, onOpenCharacter }: RelationshipGraphProps) {
  const [relationships, setRelationships] = useState<Relationship[]>([]);
  const [draft, setDraft] = useState<{ fromId: string; toId: string; kind: RelationshipKind; note: string } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Relationship | null>(null);

  useEffect(() => {
    // Prune on entry so the graph never draws an edge to a character that was
    // deleted while this screen was closed.
    setRelationships(pruneRelationships(characters.map((character) => character.id)));
  }, [characters]);

  const positions = useMemo(() => nodePositions(characters.length), [characters.length]);
  const byId = useMemo(() => new Map(characters.map((character, index) => [character.id, { character, ...positions[index] }])), [characters, positions]);

  function openDraft() {
    setDraft({
      fromId: characters[0]?.id ?? "",
      toId: characters[1]?.id ?? characters[0]?.id ?? "",
      kind: "friend",
      note: "",
    });
  }

  function submitDraft() {
    if (!draft || !draft.fromId || !draft.toId || draft.fromId === draft.toId) {
      return;
    }
    const next = [...loadRelationships(), createRelationship(draft.fromId, draft.toId, draft.kind, draft.note)];
    saveRelationships(next);
    setRelationships(loadRelationships());
    setDraft(null);
  }

  function confirmDelete() {
    if (!pendingDelete) {
      return;
    }
    setRelationships(deleteRelationship(pendingDelete.id));
    setPendingDelete(null);
  }

  const canLink = characters.length >= 2;

  return (
    <section className="workspace-card relationship-page" id="workspace-relationships">
      <div className="workspace-card-head">
        <div>
          <p className="eyebrow">RELATIONSHIPS</p>
          <h2>角色关系网</h2>
          <p className="muted">
            {characters.length} 个角色 · {relationships.length} 条关系
          </p>
        </div>
        <div className="workspace-toolbar">
          <button className="ghost-button" onClick={onBack} type="button">
            返回 Dashboard
          </button>
          <button className="primary-button" disabled={!canLink} onClick={openDraft} type="button">
            新建关系
          </button>
        </div>
      </div>

      {!canLink ? (
        <div className="empty-state">
          <h3>至少需要两个角色</h3>
          <p>关系网描述角色之间的连接，先创建第二个角色再回来。</p>
        </div>
      ) : (
        <>
          {/* The drawing is decorative markup; the edge list below is the
              accessible representation of the same data. */}
          <svg
            aria-hidden="true"
            className="relationship-canvas"
            viewBox={`0 0 ${VIEW} ${VIEW}`}
            xmlns="http://www.w3.org/2000/svg"
          >
            <defs>
              <marker id="relationship-arrow" markerHeight="8" markerWidth="8" orient="auto" refX="26" refY="4">
                <path d="M0,0 L8,4 L0,8 Z" fill="currentColor" />
              </marker>
            </defs>
            {relationships.map((relationship) => {
              const from = byId.get(relationship.fromId);
              const to = byId.get(relationship.toId);
              if (!from || !to) {
                return null;
              }
              const midX = (from.x + to.x) / 2;
              const midY = (from.y + to.y) / 2;
              return (
                <g className={`relationship-edge kind-${relationship.kind}`} key={relationship.id}>
                  <line markerEnd="url(#relationship-arrow)" x1={from.x} x2={to.x} y1={from.y} y2={to.y} />
                  <text x={midX} y={midY}>
                    {relationshipKindLabel(relationship.kind)}
                  </text>
                </g>
              );
            })}
            {characters.map((character, index) => (
              <g
                className="relationship-node"
                key={character.id}
                onClick={() => onOpenCharacter(character.id)}
                role="presentation"
              >
                <circle cx={positions[index].x} cy={positions[index].y} r="30" />
                <text className="relationship-node-emoji" x={positions[index].x} y={positions[index].y}>
                  {character.avatarEmoji || "🙂"}
                </text>
                <text className="relationship-node-name" x={positions[index].x} y={positions[index].y + 44}>
                  {character.name || "未命名角色"}
                </text>
              </g>
            ))}
          </svg>

          <ul className="relationship-list">
            {relationships.length === 0 && <li className="muted">还没有关系，点击「新建关系」开始。</li>}
            {relationships.map((relationship) => (
              <li key={relationship.id}>
                <span className={`relationship-kind-chip kind-${relationship.kind}`}>
                  {relationshipKindLabel(relationship.kind)}
                </span>
                <span className="relationship-list-text">
                  {byId.get(relationship.fromId)?.character.name ?? "未知角色"}
                  <span aria-hidden="true"> → </span>
                  <span className="visually-hidden">指向</span>
                  {byId.get(relationship.toId)?.character.name ?? "未知角色"}
                </span>
                {relationship.note && <span className="muted relationship-note">{relationship.note}</span>}
                <button
                  aria-label={`删除 ${byId.get(relationship.fromId)?.character.name ?? ""} 到 ${byId.get(relationship.toId)?.character.name ?? ""} 的关系`}
                  className="ghost-button"
                  onClick={() => setPendingDelete(relationship)}
                  type="button"
                >
                  删除
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {draft && (
        <div className="modal-backdrop" role="presentation">
          <div className="confirm-dialog" role="dialog" aria-modal="true" aria-label="新建关系">
            <h2>新建关系</h2>
            <label className="field">
              <span>从</span>
              <select onChange={(event) => setDraft({ ...draft, fromId: event.target.value })} value={draft.fromId}>
                {characters.map((character) => (
                  <option key={character.id} value={character.id}>
                    {character.name || "未命名角色"}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>关系</span>
              <select
                onChange={(event) => setDraft({ ...draft, kind: event.target.value as RelationshipKind })}
                value={draft.kind}
              >
                {RELATIONSHIP_KINDS.map((kind) => (
                  <option key={kind.value} value={kind.value}>
                    {kind.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>指向</span>
              <select onChange={(event) => setDraft({ ...draft, toId: event.target.value })} value={draft.toId}>
                {characters.map((character) => (
                  <option key={character.id} value={character.id}>
                    {character.name || "未命名角色"}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>备注</span>
              <input
                onChange={(event) => setDraft({ ...draft, note: event.target.value })}
                placeholder="可选"
                type="text"
                value={draft.note}
              />
            </label>
            {draft.fromId === draft.toId && <p className="muted">角色不能与自己建立关系。</p>}
            <div className="form-actions">
              <button className="ghost-button" onClick={() => setDraft(null)} type="button">
                取消
              </button>
              <button
                className="primary-button"
                disabled={draft.fromId === draft.toId}
                onClick={submitDraft}
                type="button"
              >
                保存关系
              </button>
            </div>
          </div>
        </div>
      )}

      {pendingDelete && (
        <div className="modal-backdrop" role="presentation">
          <div className="confirm-dialog" role="dialog" aria-modal="true" aria-label="删除关系">
            <h2>删除关系</h2>
            <p>
              将删除「{relationshipKindLabel(pendingDelete.kind)}」关系：{byId.get(pendingDelete.fromId)?.character.name}
              {" → "}
              {byId.get(pendingDelete.toId)?.character.name}。
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
