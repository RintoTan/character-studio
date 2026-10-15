import { useEffect, useState } from "react";
import {
  clearedFilters,
  loadDashboardPrefs,
  saveDashboardPrefs,
  type DashboardPrefs,
  type ScopeMode,
} from "../storage/dashboardPrefs";

type Options = {
  /**
   * A request from another screen to clear the filters. A signal rather than a
   * boolean so a repeated request still applies: going into the editor and
   * deleting a character twice has to clear twice, and a boolean would already be
   * true the second time.
   */
  resetSignal?: number;
  resetFavoriteMode?: ScopeMode;
};

/**
 * The dashboard's own preferences: the filter bar, the sort order and the view
 * mode.
 *
 * These three things are one value because they are one thing to the author -- how
 * the list is currently arranged -- and because they have one owner. This used to
 * be three writers on one key (App seeding it, the dashboard editing it, and the
 * editor rewriting the whole object on delete), which is how switching to the list
 * view kept getting undone by a trip through the editor.
 *
 * The signal is ignored at 0 so a plain mount never wipes what the author had.
 */
export function useDashboardPrefs({ resetSignal = 0, resetFavoriteMode }: Options = {}) {
  const [prefs, setPrefs] = useState(loadDashboardPrefs);

  // Declared before the reset below so the two keep the order they had inline:
  // persist what is there, then apply a request to change it.
  useEffect(() => {
    saveDashboardPrefs(prefs);
  }, [prefs]);

  useEffect(() => {
    if (!resetSignal) {
      return;
    }

    setPrefs((current) => clearedFilters(current, { favoriteMode: resetFavoriteMode }));
  }, [resetSignal, resetFavoriteMode]);

  return [prefs, setPrefs] as const;
}
