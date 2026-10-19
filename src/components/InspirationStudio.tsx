import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { INSPIRATION_CATEGORY_LABELS } from "../data/inspirationLibrary";
import {
  CATEGORY_ORDER,
  CATEGORY_TARGETS,
  contextSources,
  generateSuggestions,
  rerollSuggestion,
} from "../inspiration/engine";
import type {
  ApplyItem,
  ApplyMode,
  InspirationCategory,
  InspirationContext,
  Suggestion,
} from "../inspiration/types";
import { useDialogKeyboard } from "../hooks/useDialogKeyboard";
import type { CharacterDraft } from "../types/character";
import { Icon } from "./Icon";

type InspirationStudioProps = {
  open: boolean;
  context: InspirationContext;
  values: CharacterDraft;
  onClose: () => void;
  onApply: (items: ApplyItem[]) => void;
};

function currentValue(values: CharacterDraft, suggestion: Suggestion) {
  const value = values[suggestion.field];
  if (suggestion.kind === "tag") {
    return Array.isArray(value) ? (value as string[]).join("、") : "";
  }
  return typeof value === "string" ? value.trim() : "";
}

function defaultMode(values: CharacterDraft, suggestion: Suggestion): ApplyMode {
  // Existing text is never replaced without the writer asking for it.
  if (suggestion.kind === "tag") return "append";
  return currentValue(values, suggestion) ? "append" : "replace";
}

/**
 * The inspiration studio: a side panel on desktop, a full-height sheet on a phone.
 *
 * It only ever hands a list of choices back to the editor. It does not touch
 * localStorage, the store, or the character being edited — the editor applies the
 * result to its own draft and saves through the same path as typing.
 */
export function InspirationStudio({ open, context, values, onClose, onApply }: InspirationStudioProps) {
  const [category, setCategory] = useState<InspirationCategory>("appearance");
  const [candidates, setCandidates] = useState<Partial<Record<InspirationCategory, Suggestion[]>>>({});
  const [pending, setPending] = useState<Suggestion[]>([]);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [modes, setModes] = useState<Record<string, ApplyMode>>({});
  const seedRef = useRef(1);
  const historyRef = useRef<Record<string, string[]>>({});
  const panelRef = useRef<HTMLElement | null>(null);

  const generateFor = (nextCategory: InspirationCategory) => {
    const history = historyRef.current[nextCategory] || [];
    const next = generateSuggestions({
      category: nextCategory,
      context,
      seed: seedRef.current++,
      count: 3,
      excludeEntryIds: history,
    });
    historyRef.current[nextCategory] = [...history, ...next.map((item) => item.entryId)];
    setCandidates((current) => ({ ...current, [nextCategory]: next }));
  };

  useEffect(() => {
    if (!open) return;
    generateFor(category);
    // Opening the studio is the only trigger; generating on every context keystroke
    // would reshuffle the list while the writer is reading it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (open && !candidates[category]) {
      generateFor(category);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category, open]);

  useDialogKeyboard({ active: open && !previewOpen, onClose });
  useDialogKeyboard({
    active: previewOpen,
    onClose: () => setPreviewOpen(false),
    onConfirm: () => applyPending(),
    confirmDisabled: pending.length === 0,
  });

  if (!open) return null;

  const list = candidates[category] || [];
  const sources = contextSources(context);

  function reroll(candidateId: string) {
    const avoid = [
      ...list.map((item) => item.entryId),
      ...pending.map((item) => item.entryId),
    ].filter((entryId) => entryId !== list.find((item) => item.id === candidateId)?.entryId);

    const next = rerollSuggestion({
      category,
      context,
      seed: seedRef.current++,
      avoidEntryIds: avoid,
    });
    if (!next) return;
    historyRef.current[category] = [...(historyRef.current[category] || []), next.entryId];
    setCandidates((current) => ({
      ...current,
      [category]: list.map((item) => (item.id === candidateId ? next : item)),
    }));
  }

  function togglePending(suggestion: Suggestion) {
    setPending((current) =>
      current.some((item) => item.entryId === suggestion.entryId)
        ? current.filter((item) => item.entryId !== suggestion.entryId)
        : [...current, suggestion],
    );
  }

  function openPreview() {
    const nextModes: Record<string, ApplyMode> = {};
    for (const suggestion of pending) {
      nextModes[suggestion.id] = defaultMode(values, suggestion);
    }
    setModes(nextModes);
    setPreviewOpen(true);
  }

  function applyPending() {
    const items = pending.map((suggestion) => ({
      suggestion,
      mode: suggestion.kind === "tag" ? "append" : modes[suggestion.id] || defaultMode(values, suggestion),
    }));
    onApply(items);
    setPending([]);
    setPreviewOpen(false);
    onClose();
  }

  const byField = pending.reduce<Record<string, Suggestion[]>>((groups, suggestion) => {
    groups[suggestion.fieldLabel] = [...(groups[suggestion.fieldLabel] || []), suggestion];
    return groups;
  }, {});

  return createPortal(
    <div className="inspiration-layer">
      <div className="inspiration-scrim" onClick={onClose} role="presentation" />
      <aside
        aria-label="灵感工作室"
        aria-modal="true"
        className="inspiration-panel"
        ref={panelRef}
        role="dialog"
      >
        <header className="inspiration-head">
          <div>
            <p className="inspiration-kicker">本地规则生成 · 离线可用</p>
            <h2>灵感工作室</h2>
          </div>
          <button aria-label="关闭灵感工作室" className="icon-button" onClick={onClose} type="button">
            <Icon name="close" />
          </button>
        </header>

        <p className="inspiration-context">
          {sources.length > 0
            ? `本次建议参考了你已填写的：${sources.join("、")}。`
            : "还没有可参考的设定，按自由探索生成。"}
        </p>

        <div aria-label="灵感类别" className="inspiration-tabs" role="tablist">
          {CATEGORY_ORDER.map((item) => (
            <button
              aria-selected={item === category}
              className={item === category ? "inspiration-tab active" : "inspiration-tab"}
              key={item}
              onClick={() => setCategory(item)}
              role="tab"
              type="button"
            >
              {INSPIRATION_CATEGORY_LABELS[item]}
            </button>
          ))}
        </div>

        <div className="inspiration-body">
          <div className="inspiration-list">
            {list.map((suggestion) => {
              const selected = pending.some((item) => item.entryId === suggestion.entryId);
              return (
                <article className={selected ? "inspiration-card selected" : "inspiration-card"} key={suggestion.id}>
                  <p>{suggestion.text}</p>
                  <p className="inspiration-meta">
                    写入：{suggestion.fieldLabel}
                    {suggestion.matchedKeywords.length > 0 ? ` · 关联：${suggestion.matchedKeywords.slice(0, 3).join("、")}` : ""}
                  </p>
                  <div className="inspiration-card-actions">
                    <button
                      aria-pressed={selected}
                      className={selected ? "ghost-button active" : "ghost-button"}
                      onClick={() => togglePending(suggestion)}
                      type="button"
                    >
                      {selected ? "已选" : "选择"}
                    </button>
                    <button className="ghost-button" onClick={() => reroll(suggestion.id)} type="button">
                      重抽
                    </button>
                  </div>
                </article>
              );
            })}
            <button className="ghost-button inspiration-more" onClick={() => generateFor(category)} type="button">
              换一批
            </button>
          </div>

          <section className="inspiration-pending">
            <h3>待应用 · {pending.length}</h3>
            {pending.length === 0 ? (
              <p className="inspiration-empty">还没有选择。挑几条再预览。</p>
            ) : (
              <ul>
                {pending.map((suggestion) => (
                  <li key={suggestion.id}>
                    <span>{suggestion.text}</span>
                    <button
                      aria-label={`从待应用移除：${suggestion.text}`}
                      className="icon-button"
                      onClick={() => togglePending(suggestion)}
                      type="button"
                    >
                      <Icon name="close" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <button className="primary-button" disabled={pending.length === 0} onClick={openPreview} type="button">
              预览应用
            </button>
          </section>
        </div>
      </aside>

      {previewOpen ? (
        <div className="inspiration-preview-layer">
          <div className="inspiration-scrim" onClick={() => setPreviewOpen(false)} role="presentation" />
          <div aria-label="应用预览" aria-modal="true" className="inspiration-preview" role="dialog">
            <h2>应用预览</h2>
            <p className="inspiration-context">只写入编辑器草稿，仍需点击「保存角色」才会保存。</p>
            {Object.keys(byField).length > 1 ? (
              <p className="inspiration-note">
                {Object.entries(byField)
                  .filter(([, items]) => items.length > 1)
                  .map(([label, items]) => `${label} 有 ${items.length} 条`)
                  .join("；") || "每条建议写入各自的字段。"}
              </p>
            ) : null}
            <ul className="inspiration-diff">
              {pending.map((suggestion) => {
                const existing = currentValue(values, suggestion);
                const mode = suggestion.kind === "tag" ? "append" : modes[suggestion.id] || defaultMode(values, suggestion);
                return (
                  <li key={suggestion.id}>
                    <div className="inspiration-diff-head">
                      <strong>{suggestion.fieldLabel}</strong>
                      <div className="inspiration-mode">
                        {suggestion.kind === "tag" ? (
                          <span>追加为标签</span>
                        ) : (
                          <>
                            <button
                              className={mode === "append" ? "active" : ""}
                              onClick={() => setModes((current) => ({ ...current, [suggestion.id]: "append" }))}
                              type="button"
                            >
                              追加
                            </button>
                            <button
                              className={mode === "replace" ? "active" : ""}
                              onClick={() => setModes((current) => ({ ...current, [suggestion.id]: "replace" }))}
                              type="button"
                            >
                              替换
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                    <p className="inspiration-diff-row">
                      <span>当前</span>
                      {existing || "（空）"}
                    </p>
                    <p className="inspiration-diff-row suggested">
                      <span>建议</span>
                      {suggestion.text}
                    </p>
                  </li>
                );
              })}
            </ul>
            <div className="inspiration-preview-actions">
              <button className="ghost-button" onClick={() => setPreviewOpen(false)} type="button">
                取消
              </button>
              <button className="primary-button" onClick={applyPending} type="button">
                应用到草稿
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>,
    document.body,
  );
}
