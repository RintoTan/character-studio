import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icon";

type WorkspaceSearchProps = {
  /** The query the page actually filters by. */
  value: string;
  /** Called with the next query. The page owns the business logic. */
  onChange: (next: string) => void;
  /** Accessible name for the field, e.g. 「搜索角色」. */
  label: string;
  /** Placeholder — the one thing that differs by module. */
  placeholder: string;
  /** Stable handle for tests and for the browser probes. */
  testId: string;
  /** Optional: Enter in the field. Pages that open the first hit pass it. */
  onSubmit?: () => void;
  /** Optional: a one-line result summary shown while the field is open. */
  resultSummary?: string;
  /**
   * Optional controlled expansion. The dashboard keeps search inside its own layer
   * stack (outside click, Escape order, focus return), so it passes its state in.
   * Everywhere else the component owns it.
   */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Optional: called right after the field is collapsed, for focus or logging. */
  className?: string;
};

/**
 * One search control for every workspace.
 *
 * The five screens had five behaviours: one opened a field in place, one navigated to a
 * filtered list, one cleared itself on close, one kept the keyword but showed no sign of
 * it, and one had no close at all. The rules below are the ones that survived review:
 *
 *   - Collapsed it is a compact button with an icon and the word 搜索.
 *   - Opening expands in place and focuses the field; it does not move the page.
 *   - Collapsing keeps the query. A filter the reader cannot see is a bug, so a
 *     collapsed field with a query leaves a chip that names it and can clear it.
 *   - Clearing restores the full result set and leaves the field open for the next word.
 *   - Escape inside the field closes only the field, and never the panel around it.
 *
 * Filtering is deliberately absent: filters are the page's own controls and stay visible
 * whether or not a search is running.
 */
export function WorkspaceSearch({
  value,
  onChange,
  label,
  placeholder,
  testId,
  onSubmit,
  resultSummary,
  open,
  onOpenChange,
  className,
}: WorkspaceSearchProps) {
  const [localOpen, setLocalOpen] = useState(false);
  const expanded = open ?? localOpen;
  const inputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const setExpanded = (next: boolean) => {
    if (open === undefined) {
      setLocalOpen(next);
    }
    onOpenChange?.(next);
  };

  useEffect(() => {
    if (expanded) {
      // After layout: the field is rendered this commit, focusable on the next frame.
      const id = window.setTimeout(() => inputRef.current?.focus(), 0);
      return () => window.clearTimeout(id);
    }
  }, [expanded]);

  function collapse() {
    setExpanded(false);
    // Focus goes back to the control that opened the field, not to the document.
    window.setTimeout(() => triggerRef.current?.focus(), 0);
  }

  if (!expanded) {
    return (
      <div className={`ws-search${className ? ` ${className}` : ""}`} data-testid={`${testId}-wrap`}>
        <button
          aria-expanded={false}
          aria-label={label}
          className="ws-search-trigger"
          data-testid={testId}
          onClick={() => setExpanded(true)}
          ref={triggerRef}
          type="button"
        >
          <Icon name="search" size={16} />
          <span>搜索</span>
        </button>
        {value.trim() !== "" && (
          <span className="ws-search-active" data-testid={`${testId}-active`}>
            <Icon name="search" size={12} />
            <span className="ws-search-active-text" title={value}>
              {value}
            </span>
            <button
              aria-label="清除搜索"
              data-testid={`${testId}-active-clear`}
              onClick={() => onChange("")}
              type="button"
            >
              <Icon name="close" size={12} />
            </button>
          </span>
        )}
      </div>
    );
  }

  return (
    <div className={`ws-search is-open${className ? ` ${className}` : ""}`} data-testid={`${testId}-wrap`}>
      <label className="ws-search-field">
        <Icon name="search" size={15} />
        <input
          aria-label={label}
          data-testid={`${testId}-input`}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              // Only this field closes. The panel it sits in stays where it is.
              event.preventDefault();
              event.stopPropagation();
              collapse();
              return;
            }
            if (event.key === "Enter") {
              onSubmit?.();
            }
          }}
          placeholder={placeholder}
          ref={inputRef}
          type="search"
          value={value}
        />
        {value !== "" && (
          <button
            aria-label="清空搜索"
            data-testid={`${testId}-clear`}
            onClick={() => {
              onChange("");
              inputRef.current?.focus();
            }}
            type="button"
          >
            <Icon name="close" size={13} />
          </button>
        )}
      </label>
      <button
        aria-label="收起搜索"
        className="ws-search-collapse"
        data-testid={`${testId}-collapse`}
        onClick={collapse}
        type="button"
      >
        收起
      </button>
      {resultSummary && <span className="ws-search-summary">{resultSummary}</span>}
    </div>
  );
}
