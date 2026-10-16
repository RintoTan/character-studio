import { useEffect, useMemo, useState } from "react";
import { useDialogKeyboard } from "../hooks/useDialogKeyboard";
import {
  createWorldEntry,
  deleteWorldEntry,
  loadWorldEntries,
  pruneWorldCharacters,
  upsertWorldEntry,
  worldChildren,
} from "../storage/worldStorage";
import type { Character } from "../types/character";
import { CharacterPicker } from "../components/CharacterPicker";
import { RelatedCharacters } from "../components/RelatedCharacters";
import { Icon } from "../components/Icon";
import {
  WORLD_CATEGORIES,
  worldCategoryLabel,
  wouldCreateWorldCycle,
  type WorldEntry,
  type WorldEntryCategory,
} from "../types/world";

type WorldManagerProps = {
  characters: Character[];
  onBack: () => void;
  onOpenCharacter: (characterId: string) => void;
};

type Draft = {
  id?: string;
  name: string;
  category: WorldEntryCategory;
  parentId: string;
  summary: string;
  details: string;
  tags: string;
  characterIds: string[];
};

const emptyDraft = (): Draft => ({
  name: "",
  category: "location",
  parentId: "",
  summary: "",
  details: "",
  tags: "",
  characterIds: [],
});

/** Guards against a pathologically deep tree; storage already repairs cycles. */
const MAX_DEPTH = 6;

export function WorldManager({ characters, onBack, onOpenCharacter }: WorldManagerProps) {
  const [entries, setEntries] = useState<WorldEntry[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [pendingDelete, setPendingDelete] = useState<WorldEntry | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
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
    // A deleted character is removed from the entries it was linked to.
    setEntries(pruneWorldCharacters(characters.map((character) => character.id)));
  }, [characters]);

  const characterById = useMemo(
    () => new Map(characters.map((character) => [character.id, character])),
    [characters],
  );

  const byCategory = useMemo(
    () => WORLD_CATEGORIES.map((category) => ({
      category,
      roots: worldChildren(entries, undefined).filter((entry) => entry.category === category.value),
      entries: entries.filter((entry) => entry.category === category.value),
    })).filter((group) => group.entries.length > 0),
    [entries],
  );

  /** Parent choices exclude this entry and anything that would close a loop. */
  const parentOptions = useMemo(() => {
    if (!draft) {
      return [];
    }
    return entries.filter(
      (entry) => entry.id !== draft.id && !wouldCreateWorldCycle(entries, draft.id ?? "new", entry.id),
    );
  }, [draft, entries]);

  function submitDraft() {
    if (!draft || !draft.name.trim()) {
      return;
    }

    const created = createWorldEntry({
      name: draft.name,
      category: draft.category,
      parentId: draft.parentId || undefined,
      summary: draft.summary,
      details: draft.details,
      tags: draft.tags.split(/[,，、]/),
      characterIds: draft.characterIds,
    });
    if (!created) {
      return;
    }

    const existing = draft.id ? entries.find((entry) => entry.id === draft.id) : undefined;
    upsertWorldEntry(
      draft.id
        ? { ...created, id: draft.id, createdAt: existing?.createdAt ?? created.createdAt }
        : created,
    );
    setEntries(loadWorldEntries());
    setDraft(null);
  }

  function startEdit(entry: WorldEntry) {
    setDraft({
      id: entry.id,
      name: entry.name,
      category: entry.category,
      parentId: entry.parentId ?? "",
      summary: entry.summary ?? "",
      details: entry.details ?? "",
      tags: entry.tags.join("、"),
      characterIds: entry.characterIds,
    });
  }

  function confirmDelete() {
    if (!pendingDelete) {
      return;
    }
    setEntries(deleteWorldEntry(pendingDelete.id));
    setPendingDelete(null);
  }

  function toggleCollapsed(id: string) {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function renderEntry(entry: WorldEntry, depth: number) {
    const children = worldChildren(entries, entry.id);
    const isCollapsed = collapsed.has(entry.id);

    return (
      <li className="world-node" key={entry.id} style={{ marginLeft: depth ? 16 : 0 }}>
        <article className="world-entry">
          <div className="world-entry-head">
            {children.length > 0 ? (
              <button
                aria-expanded={!isCollapsed}
                className="ghost-button world-toggle"
                onClick={() => toggleCollapsed(entry.id)}
                type="button"
              >
                <Icon name={isCollapsed ? "chevronRight" : "chevronDown"} size={16} />
                <span className="visually-hidden">
                  {isCollapsed ? "展开" : "折叠"} {entry.name}
                </span>
              </button>
            ) : (
              <span aria-hidden="true" className="world-toggle-spacer" />
            )}
            <h4>{entry.name}</h4>
            <span className="timeline-actions">
              <button className="ghost-button" onClick={() => startEdit(entry)} type="button">
                编辑
              </button>
              <button
                aria-label={`删除条目 ${entry.name}`}
                className="danger-button"
                onClick={() => setPendingDelete(entry)}
                type="button"
              >
                删除
              </button>
            </span>
          </div>
          {entry.summary && <p className="world-summary">{entry.summary}</p>}
          {entry.tags.length > 0 && (
            <ul className="world-tags">
              {entry.tags.map((tag) => (
                <li key={tag}>{tag}</li>
              ))}
            </ul>
          )}
          <RelatedCharacters
            characters={entry.characterIds.flatMap((id) => {
              const character = characterById.get(id);
              return character ? [character] : [];
            })}
            onOpenCharacter={onOpenCharacter}
          />
        </article>
        {children.length > 0 && !isCollapsed && depth < MAX_DEPTH && (
          <ul className="world-children">
            {children.map((child) => renderEntry(child, depth + 1))}
          </ul>
        )}
      </li>
    );
  }

  return (
    <section className="workspace-card world-page" id="workspace-world">
      <div className="workspace-card-head">
        <div>
          <p className="eyebrow">WORLD</p>
          <h2>世界观管理</h2>
          <p className="muted">
            {entries.length} 个条目 · {byCategory.length} 个分类
          </p>
        </div>
        <div className="workspace-toolbar">
          <button className="ghost-button" onClick={onBack} type="button">
            返回 Dashboard
          </button>
          <button className="primary-button" onClick={() => setDraft(emptyDraft())} type="button">
            新建条目
          </button>
        </div>
      </div>

      {entries.length === 0 ? (
        <div className="empty-state">
          <h3>还没有世界观条目</h3>
          <p>地点、势力、种族、物品与概念都可以在这里建立层级。</p>
        </div>
      ) : (
        <div className="world-groups">
          {byCategory.map((group) => (
            <section className="world-group" key={group.category.value}>
              <h3>
                {group.category.label}
                <span className="muted"> · {group.entries.length}</span>
              </h3>
              <ul className="world-roots">{group.roots.map((entry) => renderEntry(entry, 0))}</ul>
            </section>
          ))}
        </div>
      )}

      {draft && (
        <div className="modal-backdrop" role="presentation">
          <div
            className="confirm-dialog world-dialog"
            ref={draftDialogRef}
            role="dialog"
            aria-modal="true"
            aria-label="世界观条目"
          >
            <h2>{draft.id ? "编辑条目" : "新建条目"}</h2>
            <div className="field-row">
              <label className="field">
                <span>名称</span>
                <input
                  onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                  placeholder="例如：北境"
                  type="text"
                  value={draft.name}
                />
              </label>
              <label className="field">
                <span>分类</span>
                <select
                  onChange={(event) => setDraft({ ...draft, category: event.target.value as WorldEntryCategory })}
                  value={draft.category}
                >
                  {WORLD_CATEGORIES.map((category) => (
                    <option key={category.value} value={category.value}>
                      {category.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="field">
              <span>上级条目（可选）</span>
              <select onChange={(event) => setDraft({ ...draft, parentId: event.target.value })} value={draft.parentId}>
                <option value="">无（顶层）</option>
                {parentOptions.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {worldCategoryLabel(entry.category)} · {entry.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>简述（可选）</span>
              <input
                onChange={(event) => setDraft({ ...draft, summary: event.target.value })}
                type="text"
                value={draft.summary}
              />
            </label>
            <label className="field">
              <span>详情（可选）</span>
              <textarea
                onChange={(event) => setDraft({ ...draft, details: event.target.value })}
                rows={3}
                value={draft.details}
              />
            </label>
            <label className="field">
              <span>标签（逗号分隔，可选）</span>
              <input
                onChange={(event) => setDraft({ ...draft, tags: event.target.value })}
                placeholder="寒冷、边境"
                type="text"
                value={draft.tags}
              />
            </label>
            {characters.length > 0 && (
              <CharacterPicker
                characters={characters}
                legend="关联角色"
                onChange={(characterIds) => setDraft({ ...draft, characterIds })}
                selectedIds={draft.characterIds}
              />
            )}
            <div className="form-actions">
              <button className="ghost-button" onClick={() => setDraft(null)} type="button">
                取消
              </button>
              <button className="primary-button" disabled={!draft.name.trim()} onClick={submitDraft} type="button">
                保存条目
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
            aria-label="删除条目"
          >
            <h2>删除条目</h2>
            <p>
              将删除「{pendingDelete.name}」。它的下级条目不会被删除，而是变为顶层。
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
