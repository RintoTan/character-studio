import { useEffect, useMemo, useState } from "react";
import { useLightDismiss } from "../hooks/useLightDismiss";
import { useDialogKeyboard } from "../hooks/useDialogKeyboard";
import { useMediaQuery } from "../hooks/useMediaQuery";
import {
  createWorldEntry,
  deleteWorldEntry,
  loadWorldEntries,
  pruneWorldCharacters,
  upsertWorldEntry,
} from "../storage/worldStorage";
import type { Character } from "../types/character";
import { CharacterPicker } from "../components/CharacterPicker";
import { RelatedCharacters } from "../components/RelatedCharacters";
import { WorkspaceHeader } from "../components/WorkspaceHeader";
import { Icon } from "../components/Icon";
import {
  WORLD_CATEGORIES,
  worldCategoryLabel,
  type WorldEntry,
  type WorldEntryCategory,
} from "../types/world";
import {
  CHARACTER_FILTERS,
  EVERY_CATEGORY,
  PARENT_FILTERS,
  emptyWorldFilter,
  isWorldFilterActive,
  worldCategoryCounts,
  worldIndent,
  worldParentOptions,
  worldPathOf,
  worldTreeRows,
  type WorldFilter,
} from "./world/worldView";

type WorldManagerProps = {
  characters: Character[];
  onBack: () => void;
  onOpenCharacter: (characterId: string) => void;
  /** The entry another screen asked to open, consumed once. */
  focusEntryId?: string | null;
  onFocusHandled?: () => void;
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

export function WorldManager({
  characters,
  onBack,
  onOpenCharacter,
  focusEntryId = null,
  onFocusHandled,
}: WorldManagerProps) {
  const [entries, setEntries] = useState<WorldEntry[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [pendingDelete, setPendingDelete] = useState<WorldEntry | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<WorldFilter>(emptyWorldFilter);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // On a phone the two panes are one pane at a time: the list, or the entry's details.
  const isNarrowScreen = useMediaQuery("(max-width: 720px)");
  const [phonePane, setPhonePane] = useState<"list" | "detail">("list");
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

  const [entriesLoaded, setEntriesLoaded] = useState(false);

  useEffect(() => {
    // A deleted character is removed from the entries it was linked to.
    setEntries(pruneWorldCharacters(characters.map((character) => character.id)));
    setEntriesLoaded(true);
  }, [characters]);

  const characterById = useMemo(
    () => new Map(characters.map((character) => [character.id, character])),
    [characters],
  );
  const nameOf = useMemo(
    () => (characterId: string) => characterById.get(characterId)?.name,
    [characterById],
  );

  const isFiltered = isWorldFilterActive(filter);
  // What the 筛选 entry counts: the two structural filters. The keyword has its own
  // visible field and the category has its own row.
  const structuralFilterCount =
    (filter.parent === "any" ? 0 : 1) + (filter.characters === "any" ? 0 : 1);
  const [filtersOpen, setFiltersOpen] = useState(false);
  // Same light-layer contract as the timeline filter row.
  const filterWrapRef = useLightDismiss({ open: filtersOpen, onClose: () => setFiltersOpen(false) });
  const counts = useMemo(() => worldCategoryCounts(entries), [entries]);
  const rows = useMemo(
    () => worldTreeRows(entries, { filter, nameOf, collapsed, isFilterActive: isFiltered }),
    [entries, filter, nameOf, collapsed, isFiltered],
  );
  const visibleCount = rows.filter((row) => !row.viaPath).length;

  const selected = selectedId ? entries.find((entry) => entry.id === selectedId) ?? null : null;
  const selectedChildren = useMemo(
    () => (selected ? entries.filter((entry) => entry.parentId === selected.id) : []),
    [entries, selected],
  );
  const selectedPath = useMemo(
    () => (selected ? worldPathOf(entries, selected.id) : []),
    [entries, selected],
  );

  // The detail pane always points at something on screen: filtering the selection away
  // moves it to the first row rather than leaving a panel about a hidden entry.
  useEffect(() => {
    if (rows.length === 0) {
      setSelectedId(null);
      return;
    }
    if (!selectedId || !rows.some((row) => row.entry.id === selectedId)) {
      setSelectedId(rows[0].entry.id);
    }
  }, [rows, selectedId]);

  /** Parent choices exclude this entry and everything below it — the cycle rule. */
  const parentOptions = useMemo(
    () => worldParentOptions(entries, draft?.id),
    [draft?.id, entries],
  );
  const parentOptionIds = useMemo(
    () => new Set(parentOptions.map((entry) => entry.id)),
    [parentOptions],
  );

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
    setSelectedId(draft.id ?? created.id);
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
    setSelectedId(null);
  }

  // Arriving from a character's preview with an entry in hand: clear any filter that
  // would hide it, open the branch it lives in, select it and bring it into view. A
  // deep entry is reachable because its ancestors are opened rather than assumed.
  useEffect(() => {
    if (!focusEntryId || !entriesLoaded) {
      return;
    }

    const target = entries.find((entry) => entry.id === focusEntryId);
    if (!target) {
      onFocusHandled?.();
      return;
    }

    if (!rows.some((row) => row.entry.id === focusEntryId)) {
      setFilter(emptyWorldFilter);
      setCollapsed((current) => {
        const next = new Set(current);
        for (const ancestor of worldPathOf(entries, focusEntryId)) {
          next.delete(ancestor.id);
        }
        return next;
      });
    } else {
      setCollapsed((current) => {
        const next = new Set(current);
        for (const ancestor of worldPathOf(entries, focusEntryId)) {
          next.delete(ancestor.id);
        }
        return next;
      });
    }

    setSelectedId(focusEntryId);
    setPhonePane("detail");
    onFocusHandled?.();

    const frame = window.requestAnimationFrame(() => {
      document
        .querySelector(`[data-entry-id="${focusEntryId}"]`)
        ?.scrollIntoView({ block: "center", behavior: "smooth" });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [focusEntryId, entriesLoaded, entries, rows, onFocusHandled]);

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

  function selectEntry(id: string) {
    setSelectedId(id);
    setPhonePane("detail");
  }

  const detailVisible = !isNarrowScreen || phonePane === "detail";

  return (
    <section className="workspace-card world-page" id="workspace-world">
      <WorkspaceHeader
        eyebrow="世界观"
        title="世界观管理"
        summary={
          <>
            {entries.length} 个条目 ·{" "}
            {counts.filter((group) => group.count > 0 && group.value !== EVERY_CATEGORY).length} 个分类
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
                新建条目
              </button>
            </div>
          </>
        }
      />

      {/* Search and filtering over the whole set, above the two panes: name, summary,
          details, tags and character names, plus the three structural filters. */}
      <div className="world-toolbar" ref={filterWrapRef}>
        <label className="world-search">
          <Icon name="search" size={15} />
          <input
            aria-label="搜索条目"
            onChange={(changeEvent) => setFilter({ ...filter, query: changeEvent.target.value })}
            placeholder="搜索名称、简介、详情、标签、关联角色"
            type="search"
            value={filter.query}
          />
          {filter.query !== "" && (
            <button aria-label="清空搜索" onClick={() => setFilter({ ...filter, query: "" })} type="button">
              <Icon name="close" size={13} />
            </button>
          )}
        </label>
        {/* The two structural filters live behind one entry on a phone: search plus the
            category row is what the first screen is for, and three controls plus the
            result count were pushing the tree off it. On desktop the row is always open
            and this control is not drawn. */}
        <button
          aria-expanded={filtersOpen}
          className="world-filter-toggle"
          onClick={() => setFiltersOpen((current) => !current)}
          type="button"
        >
          <Icon name="filter" size={15} />
          筛选{structuralFilterCount > 0 ? `（${structuralFilterCount}）` : ""}
        </button>
        <div className={filtersOpen ? "world-filter-row open" : "world-filter-row"}>
          <label className="world-filter">
            <span className="world-filter-label">层级</span>
            <select
              aria-label="按层级筛选"
              onChange={(changeEvent) => setFilter({ ...filter, parent: changeEvent.target.value as WorldFilter["parent"] })}
              value={filter.parent}
            >
              {PARENT_FILTERS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="world-filter">
            <span className="world-filter-label">角色</span>
            <select
              aria-label="按关联角色筛选"
              onChange={(changeEvent) =>
                setFilter({ ...filter, characters: changeEvent.target.value as WorldFilter["characters"] })
              }
              value={filter.characters}
            >
              {CHARACTER_FILTERS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          {isFiltered && (
            <button className="ghost-button" onClick={() => setFilter(emptyWorldFilter)} type="button">
              清空筛选
            </button>
          )}
        </div>
        <span aria-live="polite" className="world-count">
          {isFiltered ? `匹配 ${visibleCount} / ${entries.length} 个条目` : `共 ${entries.length} 个条目`}
        </span>
      </div>

      {entries.length === 0 ? (
        <div className="empty-state">
          <h3>还没有世界观条目</h3>
          <p>地点、势力、种族、物品与概念都可以在这里建立层级。</p>
        </div>
      ) : (
        <div className={`world-explorer${detailVisible ? " show-detail" : ""}`}>
          <aside className="world-sidebar">
            {/* Categories are a filter, not a second list: the count is the entry count,
                and switching one never touches the data. */}
            <nav aria-label="分类导航" className="world-category-nav">
              {counts.map((group) => (
                <button
                  aria-current={filter.category === group.value ? "true" : undefined}
                  className={filter.category === group.value ? "world-category active" : "world-category"}
                  disabled={group.count === 0 && group.value !== EVERY_CATEGORY}
                  key={group.value}
                  onClick={() => setFilter({ ...filter, category: group.value })}
                  type="button"
                >
                  {group.label}
                  <span className="world-category-count">{group.count}</span>
                </button>
              ))}
            </nav>

            {rows.length === 0 ? (
              <div className="empty-state world-empty">
                <h3>没有匹配的条目</h3>
                <p>当前条件（{filter.query.trim() ? `关键词「${filter.query.trim()}」` : "筛选"}）没有匹配的条目。</p>
                <button className="ghost-button" onClick={() => setFilter(emptyWorldFilter)} type="button">
                  清空筛选
                </button>
              </div>
            ) : (
              <ol className="world-tree">
                {rows.map((row) => (
                  <li key={row.entry.id}>
                    <div
                      data-entry-id={row.entry.id}
                      className={
                        "world-row" +
                        (row.entry.id === selectedId ? " selected" : "") +
                        (row.viaPath ? " via-path" : "")
                      }
                      style={{ paddingLeft: `${worldIndent(row.depth)}px` }}
                    >
                      {row.hasChildren ? (
                        <button
                          aria-expanded={isFiltered ? true : !collapsed.has(row.entry.id)}
                          aria-label={`${collapsed.has(row.entry.id) ? "展开" : "折叠"} ${row.entry.name}`}
                          className="world-row-toggle"
                          onClick={() => toggleCollapsed(row.entry.id)}
                          type="button"
                        >
                          <Icon name={collapsed.has(row.entry.id) ? "chevronRight" : "chevronDown"} size={15} />
                        </button>
                      ) : (
                        <span aria-hidden="true" className="world-row-toggle-spacer" />
                      )}
                      <button
                        className="world-row-main"
                        onClick={() => selectEntry(row.entry.id)}
                        type="button"
                      >
                        <span className="world-row-title">
                          <span className="world-row-name">{row.entry.name}</span>
                          <span className="world-row-cat">{worldCategoryLabel(row.entry.category)}</span>
                        </span>
                        {row.entry.summary && <span className="world-row-summary">{row.entry.summary}</span>}
                        <span className="world-row-stats">
                          {row.childCount > 0 && <span>{row.childCount} 个下级</span>}
                          {row.entry.characterIds.length > 0 && <span>{row.entry.characterIds.length} 位角色</span>}
                          {row.viaPath && <span className="world-row-via">上级路径</span>}
                        </span>
                      </button>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </aside>

          {/* Reading pane. It shows one entry at a time and holds the two actions, so
              the list itself stays a list. */}
          <section aria-label="条目详情" className="world-detail">
            {isNarrowScreen && (
              <button className="ghost-button world-detail-back" onClick={() => setPhonePane("list")} type="button">
                {/* A left chevron, not a right chevron turned around: rotating the button
                    flipped the label with it. */}
                <Icon name="chevronLeft" size={15} />
                返回列表
              </button>
            )}
            {selected ? (
              <>
                <div className="world-detail-head">
                  <div className="world-detail-titles">
                    <span className="world-detail-cat">{worldCategoryLabel(selected.category)}</span>
                    <h3>{selected.name}</h3>
                    <p className="world-detail-path">
                      {selectedPath.length > 0
                        ? `层级：${[...selectedPath.map((parent) => parent.name), selected.name].join(" › ")}`
                        : "顶层条目"}
                    </p>
                  </div>
                  <div className="world-detail-actions">
                    <button className="ghost-button" onClick={() => startEdit(selected)} type="button">
                      编辑
                    </button>
                    <button
                      aria-label={`删除条目 ${selected.name}`}
                      className="ghost-button world-danger"
                      onClick={() => setPendingDelete(selected)}
                      type="button"
                    >
                      删除
                    </button>
                  </div>
                </div>

                {selected.summary && (
                  <section className="world-detail-section">
                    <h4>简介</h4>
                    <p>{selected.summary}</p>
                  </section>
                )}
                {selected.details && (
                  <section className="world-detail-section">
                    <h4>详细设定</h4>
                    <p className="world-detail-body">{selected.details}</p>
                  </section>
                )}
                {selected.tags.length > 0 && (
                  <section className="world-detail-section">
                    <h4>标签</h4>
                    <ul className="world-tags">
                      {selected.tags.map((tag) => (
                        <li key={tag}>{tag}</li>
                      ))}
                    </ul>
                  </section>
                )}
                <section className="world-detail-section">
                  <h4>关联角色</h4>
                  <RelatedCharacters
                    characters={selected.characterIds.flatMap((id) => {
                      const character = characterById.get(id);
                      return character ? [character] : [];
                    })}
                    onOpenCharacter={onOpenCharacter}
                  />
                </section>
                {selectedChildren.length > 0 && (
                  <section className="world-detail-section">
                    <h4>子条目 · {selectedChildren.length}</h4>
                    <ul className="world-detail-children">
                      {selectedChildren.map((child) => (
                        <li key={child.id}>
                          <button onClick={() => selectEntry(child.id)} type="button">
                            {child.name}
                            <span className="world-row-cat">{worldCategoryLabel(child.category)}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
              </>
            ) : (
              <div className="empty-state world-empty">
                <h3>没有可显示的条目</h3>
                <p>先从左侧选择一个条目。</p>
              </div>
            )}
          </section>
        </div>
      )}

      {draft && (
        <div className="modal-backdrop" role="presentation">
          <div
            aria-label="世界观条目"
            aria-modal="true"
            className="confirm-dialog world-dialog"
            ref={draftDialogRef}
            role="dialog"
          >
            <h2>{draft.id ? "编辑条目" : "新建条目"}</h2>

            <fieldset className="dialog-section">
              <legend>条目</legend>
              <div className="field-row">
                <label className="field">
                  <span>
                    名称<em className="field-required">必填</em>
                  </span>
                  <input
                    autoFocus
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
            </fieldset>

            <fieldset className="dialog-section">
              <legend>层级</legend>
              <label className="field">
                <span>
                  上级条目<em className="field-optional">可选</em>
                </span>
                <select
                  aria-label="上级条目"
                  disabled={parentOptions.length === 0}
                  onChange={(event) => setDraft({ ...draft, parentId: event.target.value })}
                  value={draft.parentId}
                >
                  <option value="">无（顶层条目）</option>
                  {parentOptions.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {worldCategoryLabel(entry.category)} · {entry.name}
                    </option>
                  ))}
                </select>
              </label>
              <p className="field-hint">
                {parentOptions.length === 0
                  ? "当前没有可选的上级条目，该条目会作为顶层。"
                  : "可选上级已排除该条目自身与其所有下级，因此不会形成循环层级。"}
                {draft.parentId && parentOptionIds.has(draft.parentId) && (
                  <> 当前上级：{worldPathOf(entries, draft.parentId).map((parent) => parent.name).join(" › ")}
                    {worldPathOf(entries, draft.parentId).length > 0 ? " › " : ""}
                    {entries.find((entry) => entry.id === draft.parentId)?.name}。</>
                )}
              </p>
            </fieldset>

            <fieldset className="dialog-section">
              <legend>内容</legend>
              <label className="field">
                <span>
                  简介<em className="field-optional">可选</em>
                </span>
                <input
                  onChange={(event) => setDraft({ ...draft, summary: event.target.value })}
                  placeholder="一句话说明这是什么"
                  type="text"
                  value={draft.summary}
                />
              </label>
              <label className="field">
                <span>
                  详细设定<em className="field-optional">可选</em>
                </span>
                <textarea
                  onChange={(event) => setDraft({ ...draft, details: event.target.value })}
                  placeholder="地理、历史、规则、风俗……列表里只显示简介，详情在条目详情中阅读。"
                  rows={6}
                  value={draft.details}
                />
              </label>
              <label className="field">
                <span>
                  标签<em className="field-optional">可选</em>
                </span>
                <input
                  onChange={(event) => setDraft({ ...draft, tags: event.target.value })}
                  placeholder="用逗号或顿号分隔，例如：寒冷、边境"
                  type="text"
                  value={draft.tags}
                />
              </label>
            </fieldset>

            {characters.length > 0 && (
              <CharacterPicker
                characters={characters}
                legend="关联角色"
                onChange={(characterIds) => setDraft({ ...draft, characterIds })}
                selectedIds={draft.characterIds}
              />
            )}

            <div className="form-actions world-dialog-actions">
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
            aria-label="删除条目"
            aria-modal="true"
            className="confirm-dialog"
            ref={deleteDialogRef}
            role="dialog"
          >
            <h2>删除条目</h2>
            <p>将删除「{pendingDelete.name}」。它的下级条目不会被删除，而是变为顶层。</p>
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
