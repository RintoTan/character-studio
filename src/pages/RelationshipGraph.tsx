import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import {
  createRelationship,
  deleteRelationship,
  loadRelationships,
  pruneRelationships,
  saveRelationships,
} from "../storage/relationshipStorage";
import { Icon } from "../components/Icon";
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
const NODE_RADIUS = 30;
// The name is drawn 44 units under the node centre, and needs a little room for
// its descenders. Both numbers are also what the canvas has to leave clear, so
// the drawing never ends up with a clipped label.
const NAME_DROP = 44;
const NAME_SPACE = 22;
const CANVAS_PADDING = 16;
// A pair reads better side by side than stacked: on the wheel two nodes landed
// on the vertical axis 472 units apart, which is what made a two-character graph
// look like an empty canvas.
const PAIR_OFFSET = 150;
// Breathing room between two neighbouring nodes on the ring.
const NODE_GAP = 10;
// Below this zoom the names are hidden: at fit view a hundred of them overlap into
// a grey smear, which is the state the graph used to be in permanently.
const LABEL_ZOOM = 1.5;
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 8;
const MIN_CANVAS_WIDTH = 320;
const MIN_CANVAS_HEIGHT = 180;

export type GraphPoint = { x: number; y: number };

// A radial layout rather than a force simulation: with a handful of OCs it reads
// as a relationship wheel, it is deterministic, and it needs no layout library.
export function nodePositions(count: number): GraphPoint[] {
  if (count <= 0) {
    return [];
  }

  if (count === 1) {
    return [{ x: VIEW / 2, y: VIEW / 2 }];
  }

  if (count === 2) {
    return [
      { x: VIEW / 2 - PAIR_OFFSET, y: VIEW / 2 },
      { x: VIEW / 2 + PAIR_OFFSET, y: VIEW / 2 },
    ];
  }

  // The ring grows with the roster. On the fixed 236 radius a hundred characters
  // sat 13.2px apart on an arc while each node is 60px wide, so the wheel was a
  // solid band of overlapping circles and unreadable names. Widening it to the arc
  // a node actually needs keeps the fit view legible; the labels then appear as the
  // author zooms in rather than all at once.
  const radius = Math.max(RADIUS, (count * (NODE_RADIUS * 2 + NODE_GAP)) / (Math.PI * 2));

  return Array.from({ length: count }, (_, index) => {
    const angle = (index / count) * Math.PI * 2 - Math.PI / 2;
    return { x: VIEW / 2 + Math.cos(angle) * radius, y: VIEW / 2 + Math.sin(angle) * radius };
  });
}

function round(value: number) {
  return Math.round(value * 100) / 100;
}

function clampZoom(value: number) {
  return Math.min(Math.max(value, ZOOM_MIN), ZOOM_MAX);
}

/**
 * How far the author has to zoom before names are drawn. A handful of characters
 * can show their names almost immediately; a hundred of them cannot be shown at
 * once at any zoom, so the threshold scales with the roster instead of being a
 * single number that is either wrong for two characters or wrong for a hundred.
 */
export function labelZoomThreshold(count: number) {
  return Math.max(LABEL_ZOOM, count / 40);
}

/**
 * Fits the canvas to what is actually drawn, so a small graph stops reserving a
 * mostly empty 640-square. The floor keeps a lone node from rendering as a stamp,
 * and the caller pins rendered width to the returned width, which holds the
 * drawing at scale 1 — nodes and labels keep the size the wheel always had.
 */
export function canvasBox(positions: GraphPoint[]) {
  if (positions.length === 0) {
    return { viewBox: `0 0 ${VIEW} ${VIEW}`, width: VIEW };
  }

  const xs = positions.map((point) => point.x);
  const ys = positions.map((point) => point.y);
  const drawnWidth = Math.max(...xs) - Math.min(...xs) + (NODE_RADIUS + CANVAS_PADDING) * 2;
  const drawnHeight =
    Math.max(...ys) - Math.min(...ys) + NODE_RADIUS + CANVAS_PADDING + NAME_DROP + NAME_SPACE;
  const width = Math.max(drawnWidth, MIN_CANVAS_WIDTH);
  const height = Math.max(drawnHeight, MIN_CANVAS_HEIGHT);
  // Grow the box around the drawing's centre so the content stays where it was.
  const left = Math.min(...xs) - NODE_RADIUS - CANVAS_PADDING - (width - drawnWidth) / 2;
  const top = Math.min(...ys) - NODE_RADIUS - CANVAS_PADDING - (height - drawnHeight) / 2;

  return {
    viewBox: `${round(left)} ${round(top)} ${round(width)} ${round(height)}`,
    width: round(width),
  };
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

  const [showAll, setShowAll] = useState(false);

  const connectedIds = useMemo(() => {
    const ids = new Set<string>();
    for (const relationship of relationships) {
      ids.add(relationship.fromId);
      ids.add(relationship.toId);
    }
    return ids;
  }, [relationships]);

  // Only characters that are actually in a relationship are drawn by default. A
  // roster of a hundred with one relationship is a ring of ninety-nine dots that
  // say nothing about anyone; the rest of the roster is one click away.
  const visibleCharacters = useMemo(
    () => (showAll ? characters : characters.filter((character) => connectedIds.has(character.id))),
    [characters, connectedIds, showAll],
  );

  const positions = useMemo(
    () => nodePositions(visibleCharacters.length),
    [visibleCharacters.length],
  );
  const canvas = useMemo(() => canvasBox(positions), [positions]);

  // Zoom and pan live in the drawing's own coordinates, so the wheel stays on the
  // point under the cursor and the fit view is just k = 1 with no offset.
  const [view, setView] = useState({ k: 1, x: 0, y: 0 });
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const panRef = useRef<{
    pointerId: number;
    lastX: number;
    lastY: number;
    moved: boolean;
  } | null>(null);
  // Every active pointer, so one finger pans and two fingers pinch. Touch was left
  // out of the first version to protect page scrolling; on a canvas this large that
  // was the wrong trade — dragging the graph is the interaction people reach for.
  const pointersRef = useRef(new Map<number, { x: number; y: number }>());
  const pinchRef = useRef<{ distance: number } | null>(null);

  const neighbours = useMemo(() => {
    const ids = new Set<string>();
    if (!hoveredId) {
      return ids;
    }
    for (const relationship of relationships) {
      if (relationship.fromId === hoveredId) ids.add(relationship.toId);
      if (relationship.toId === hoveredId) ids.add(relationship.fromId);
    }
    return ids;
  }, [hoveredId, relationships]);

  const showLabels = view.k >= labelZoomThreshold(visibleCharacters.length);

  function zoomBy(factor: number) {
    setView((current) => ({ ...current, k: clampZoom(current.k * factor) }));
  }

  function resetView() {
    setView({ k: 1, x: 0, y: 0 });
  }

  /** Zooms about a point given in client coordinates, so the point stays put. */
  function zoomAround(svg: SVGSVGElement, clientX: number, clientY: number, factor: number) {
    const rect = svg.getBoundingClientRect();
    const [boxX, boxY, boxW, boxH] = canvas.viewBox.split(" ").map(Number);
    const pointerX = boxX + ((clientX - rect.left) / rect.width) * boxW;
    const pointerY = boxY + ((clientY - rect.top) / rect.height) * boxH;

    setView((current) => {
      const k = clampZoom(current.k * factor);
      const ratio = k / current.k;

      return {
        k,
        x: pointerX - (pointerX - current.x) * ratio,
        y: pointerY - (pointerY - current.y) * ratio,
      };
    });
  }

  function handleWheel(event: ReactWheelEvent<SVGSVGElement>) {
    zoomAround(event.currentTarget, event.clientX, event.clientY, event.deltaY < 0 ? 1.15 : 1 / 1.15);
  }

  function beginPan(event: ReactPointerEvent<SVGSVGElement>) {
    if (event.pointerType === "mouse" && event.button !== 0) {
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pointersRef.current.size === 2) {
      const [first, second] = [...pointersRef.current.values()];
      pinchRef.current = { distance: Math.hypot(first.x - second.x, first.y - second.y) };
      panRef.current = null;
      return;
    }

    panRef.current = {
      pointerId: event.pointerId,
      lastX: event.clientX,
      lastY: event.clientY,
      moved: false,
    };
  }

  function movePan(event: ReactPointerEvent<SVGSVGElement>) {
    const pointers = pointersRef.current;
    if (!pointers.has(event.pointerId)) {
      return;
    }
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pointers.size >= 2) {
      const [first, second] = [...pointers.values()];
      const distance = Math.hypot(first.x - second.x, first.y - second.y);
      const previous = pinchRef.current;
      if (previous && previous.distance > 0 && distance > 0) {
        zoomAround(
          event.currentTarget,
          (first.x + second.x) / 2,
          (first.y + second.y) / 2,
          distance / previous.distance,
        );
      }
      pinchRef.current = { distance };
      return;
    }

    const pan = panRef.current;
    if (!pan || pan.pointerId !== event.pointerId) {
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const [, , boxW, boxH] = canvas.viewBox.split(" ").map(Number);
    const dx = (event.clientX - pan.lastX) * (boxW / rect.width);
    const dy = (event.clientY - pan.lastY) * (boxH / rect.height);
    pan.lastX = event.clientX;
    pan.lastY = event.clientY;
    if (Math.abs(dx) + Math.abs(dy) > 0.6) {
      pan.moved = true;
    }
    setView((current) => ({ ...current, x: current.x + dx, y: current.y + dy }));
  }

  function endPan(event: ReactPointerEvent<SVGSVGElement>) {
    pointersRef.current.delete(event.pointerId);
    if (pointersRef.current.size < 2) {
      pinchRef.current = null;
    }
    if (pointersRef.current.size === 0) {
      panRef.current = null;
    }
  }
  const byId = useMemo(
    () =>
      new Map(
        visibleCharacters.map((character, index) => [
          character.id,
          { character, ...positions[index] },
        ]),
      ),
    [visibleCharacters, positions],
  );

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
          {canLink && (
            <div className="graph-zoom" role="group" aria-label="画布缩放">
              <button aria-label="缩小画布" className="bare-icon-button" onClick={() => zoomBy(1 / 1.25)} type="button">
                <Icon name="minus" size={16} />
              </button>
              <span className="graph-zoom-value">{Math.round(view.k * 100)}%</span>
              <button aria-label="放大画布" className="bare-icon-button" onClick={() => zoomBy(1.25)} type="button">
                <Icon name="plus" size={16} />
              </button>
              <button className="ghost-button" onClick={resetView} type="button">
                适配
              </button>
            </div>
          )}
          {canLink && (
            <button
              className="ghost-button"
              onClick={() => setShowAll((current) => !current)}
              type="button"
            >
              <span className="graph-toggle-full">
                {showAll ? `只显示有关系（${connectedIds.size}）` : `显示全部角色（${characters.length}）`}
              </span>
              <span className="graph-toggle-short">
                {showAll ? `只显关联 ${connectedIds.size}` : `全部 ${characters.length}`}
              </span>
            </button>
          )}
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
      ) : relationships.length === 0 ? (
        /* An empty wheel of a hundred unconnected dots said nothing at all. */
        <div className="empty-state">
          <h3>还没有关系</h3>
          <p>关系网只画有连接的角色。点「新建关系」连接两个角色，它们就会出现在这里。</p>
        </div>
      ) : (
        <>
          {/* The drawing is decorative markup; the edge list below is the
              accessible representation of the same data.
              The canvas zooms and pans so a large roster stays navigable instead of
              being flattened into one unreadable ring: names appear only past the
              label zoom, which scales with how many characters there are. */}
          <svg
            aria-hidden="true"
            className="relationship-canvas"
            onPointerCancel={endPan}
            onPointerDown={beginPan}
            onPointerMove={movePan}
            onPointerUp={endPan}
            onWheel={handleWheel}
            style={{ maxWidth: Math.min(canvas.width, 1120) }}
            viewBox={canvas.viewBox}
            xmlns="http://www.w3.org/2000/svg"
          >
            <defs />
            <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
            {relationships.map((relationship) => {
              const from = byId.get(relationship.fromId);
              const to = byId.get(relationship.toId);
              if (!from || !to) {
                return null;
              }
              const midX = (from.x + to.x) / 2;
              const midY = (from.y + to.y) / 2;
              // The line stops at the node's edge and the head is drawn as geometry
              // rather than a marker. A marker is scaled by the stroke width and
              // placed from its own origin, so with refX=26 and a 2px stroke the
              // head landed inside the destination node — drawn before the nodes,
              // and therefore invisible. That is the "new relationship shows no
              // arrow" report.
              const length = Math.hypot(to.x - from.x, to.y - from.y) || 1;
              const ux = (to.x - from.x) / length;
              const uy = (to.y - from.y) / length;
              const startX = from.x + ux * (NODE_RADIUS + 2);
              const startY = from.y + uy * (NODE_RADIUS + 2);
              const tipX = to.x - ux * (NODE_RADIUS + 3);
              const tipY = to.y - uy * (NODE_RADIUS + 3);
              const headBackX = tipX - ux * 10;
              const headBackY = tipY - uy * 10;
              const headWingX = -uy * 4.5;
              const headWingY = ux * 4.5;
              const touchesHovered =
                hoveredId !== null &&
                (relationship.fromId === hoveredId || relationship.toId === hoveredId);
              return (
                <g
                  className={`relationship-edge kind-${relationship.kind}${touchesHovered ? " active" : ""}`}
                  key={relationship.id}
                >
                  <line x1={startX} x2={headBackX} y1={startY} y2={headBackY} />
                  <polygon
                    className="relationship-arrow-head"
                    points={`${tipX},${tipY} ${headBackX + headWingX},${headBackY + headWingY} ${headBackX - headWingX},${headBackY - headWingY}`}
                  />
                  <text x={midX} y={midY}>
                    {relationshipKindLabel(relationship.kind)}
                  </text>
                </g>
              );
            })}
            {visibleCharacters.map((character, index) => {
              const isHovered = hoveredId === character.id;
              const isNeighbour = neighbours.has(character.id);
              const labelled = showLabels || isHovered || isNeighbour;
              const state = isHovered
                ? "relationship-node active"
                : hoveredId && !isNeighbour
                  ? "relationship-node dimmed"
                  : "relationship-node";
              return (
                <g
                  className={state}
                  key={character.id}
                  onClick={() => {
                    // A drag ends on the node it started on; that is a pan, not a click.
                    if (panRef.current?.moved) {
                      return;
                    }
                    onOpenCharacter(character.id);
                  }}
                  onPointerEnter={() => setHoveredId(character.id)}
                  onPointerLeave={() => setHoveredId(null)}
                  role="presentation"
                >
                  <circle cx={positions[index].x} cy={positions[index].y} r={NODE_RADIUS} />
                  <text className="relationship-node-emoji" x={positions[index].x} y={positions[index].y}>
                    {character.avatarEmoji || "🙂"}
                  </text>
                  {labelled && (
                    <text className="relationship-node-name" x={positions[index].x} y={positions[index].y + 44}>
                      {character.name || "未命名角色"}
                    </text>
                  )}
                </g>
              );
            })}
            </g>
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
