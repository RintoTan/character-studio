import type { ReactNode } from "react";

type WorkspaceHeaderProps = {
  /** Short label above the title. One language across the app. */
  eyebrow: string;
  title: string;
  /** Counts and other one-line context. */
  summary?: ReactNode;
  /** Buttons for this screen. The primary action goes last. */
  actions?: ReactNode;
  /** For screens where the header should not take the first screenful. */
  compact?: boolean;
};

/**
 * The page header every workspace shares.
 *
 * Each page used to build its own: the dashboard had a hero block, the editor a header
 * plus a separate action bar, and the three data workspaces put an eyebrow and a
 * second-level heading directly on top of their panel. The same information therefore
 * appeared at four different sizes, at four different paddings, and moved between
 * pages — which is what made six screens of one app read as six layouts.
 *
 * The header is a band at the top of its surface: label, title and summary on the left,
 * the screen's actions on the right, and one divider to separate it from the content.
 * `compact` is the same structure with less height, for screens whose first screenful
 * belongs to the content.
 */
export function WorkspaceHeader({ eyebrow, title, summary, actions, compact }: WorkspaceHeaderProps) {
  return (
    <header className={compact ? "workspace-header workspace-header--compact" : "workspace-header"}>
      <div className="workspace-header-copy">
        <p className="eyebrow">{eyebrow}</p>
        <h1 className="workspace-header-title">{title}</h1>
        {summary !== undefined && summary !== null && (
          <p className="workspace-header-summary">{summary}</p>
        )}
      </div>
      {actions !== undefined && actions !== null && (
        <div className="workspace-header-actions">{actions}</div>
      )}
    </header>
  );
}
