// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import {
  DASHBOARD_FLAGS_KEY,
  DASHBOARD_PREFS_KEY,
  clearedFilters,
  defaultPrefs,
  loadDashboardFlags,
  loadDashboardPrefs,
  normalizeFlags,
  normalizePrefs,
  saveDashboardFlags,
  saveDashboardPrefs,
} from "../src/storage/dashboardPrefs";

describe("dashboard preferences", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("returns the defaults when nothing has been stored", () => {
    expect(loadDashboardPrefs()).toEqual(defaultPrefs);
    expect(loadDashboardFlags()).toEqual({ favoriteIds: [], pinnedIds: [] });
  });

  it("round-trips the layout the author chose", () => {
    const prefs = {
      ...defaultPrefs,
      searchTerm: "雾海",
      viewMode: "list" as const,
      favoriteMode: "drafts" as const,
      worldviewFilter: "奇幻",
    };

    saveDashboardPrefs(prefs);

    expect(loadDashboardPrefs()).toEqual(prefs);
  });

  it("keeps every field of a stored layout, not just the ones that changed", () => {
    // The regression this guards: `viewMode` was the only field the loader checked,
    // so a stored object that predated a new field came back with it missing.
    localStorage.setItem(DASHBOARD_PREFS_KEY, JSON.stringify({ viewMode: "list" }));

    expect(loadDashboardPrefs()).toEqual({ ...defaultPrefs, viewMode: "list" });
  });

  it("refuses a value of the wrong type instead of letting it reach the render", () => {
    // A non-string searchTerm reached `prefs.searchTerm.trim()` and threw; a
    // non-array favoriteIds reached `new Set(...)` and threw on boot. Storage this
    // app did not write has to be survivable.
    localStorage.setItem(
      DASHBOARD_PREFS_KEY,
      JSON.stringify({ searchTerm: 5, sortMode: "shuffle", viewMode: ["list"], favoriteMode: null }),
    );

    expect(loadDashboardPrefs()).toEqual(defaultPrefs);
  });

  it("falls back per field, so one bad value does not reset the rest", () => {
    localStorage.setItem(
      DASHBOARD_PREFS_KEY,
      JSON.stringify({ searchTerm: "雾海", sortMode: "shuffle", viewMode: "list" }),
    );

    const prefs = loadDashboardPrefs();
    expect(prefs.searchTerm).toBe("雾海");
    expect(prefs.viewMode).toBe("list");
    expect(prefs.sortMode).toBe(defaultPrefs.sortMode);
  });

  it("drops a key the type no longer declares", () => {
    // `rangeFilter` was written by an older build and is in no version of the type.
    localStorage.setItem(
      DASHBOARD_PREFS_KEY,
      JSON.stringify({ ...defaultPrefs, rangeFilter: "week" }),
    );

    expect(loadDashboardPrefs()).not.toHaveProperty("rangeFilter");
  });

  it("drops non-string ids from the flag lists", () => {
    localStorage.setItem(
      DASHBOARD_FLAGS_KEY,
      JSON.stringify({ favoriteIds: ["a", 7, null, "b"], pinnedIds: "not-an-array" }),
    );

    expect(loadDashboardFlags()).toEqual({ favoriteIds: ["a", "b"], pinnedIds: [] });
  });

  it("survives corrupt storage instead of throwing on open", () => {
    localStorage.setItem(DASHBOARD_PREFS_KEY, "{not json");
    localStorage.setItem(DASHBOARD_FLAGS_KEY, "{not json");

    expect(loadDashboardPrefs()).toEqual(defaultPrefs);
    expect(loadDashboardFlags()).toEqual({ favoriteIds: [], pinnedIds: [] });
  });

  it("does not let a failing write escape", () => {
    const original = localStorage.setItem;
    localStorage.setItem = () => {
      throw new Error("QuotaExceededError");
    };

    expect(() => saveDashboardPrefs(defaultPrefs)).not.toThrow();
    expect(() => saveDashboardFlags({ favoriteIds: [], pinnedIds: [] })).not.toThrow();
    localStorage.setItem = original;
  });

  it("refuses shapes that cannot describe a layout", () => {
    expect(normalizePrefs(null)).toEqual(defaultPrefs);
    expect(normalizePrefs([])).toEqual(defaultPrefs);
    expect(normalizeFlags("x")).toEqual({ favoriteIds: [], pinnedIds: [] });
  });

  describe("clearing the filters", () => {
    const dirty = {
      ...defaultPrefs,
      searchTerm: "雾海",
      sortMode: "name-asc" as const,
      worldviewFilter: "奇幻",
      genderFilter: "女",
      visualStyleFilter: "厚涂",
      favoriteMode: "favorites" as const,
    };

    it("clears the search box and the three dropdowns", () => {
      const next = clearedFilters(dirty, { favoriteMode: "drafts" });

      expect(next.searchTerm).toBe("");
      expect(next.worldviewFilter).toBe("全部");
      expect(next.genderFilter).toBe("全部");
      expect(next.visualStyleFilter).toBe("全部");
      expect(next.favoriteMode).toBe("drafts");
    });

    it("leaves the sort order alone unless asked, which is how the two callers differ", () => {
      // The 清空筛选 button resets the sort order; the request that arrives from the
      // editor does not. Encoding that here keeps the difference a decision rather
      // than an accident of two hand-written copies.
      expect(clearedFilters(dirty, { favoriteMode: "all" }).sortMode).toBe("name-asc");
      expect(clearedFilters(dirty, { favoriteMode: "all", resetSort: true }).sortMode).toBe(
        defaultPrefs.sortMode,
      );
    });

    it("keeps the current scope rather than writing an undefined into it", () => {
      const next = clearedFilters(dirty);

      expect(next.favoriteMode).toBe("favorites");
      expect(next).not.toHaveProperty("favoriteMode", undefined);
    });

    it("leaves the view mode untouched", () => {
      expect(clearedFilters({ ...dirty, viewMode: "list" }).viewMode).toBe("list");
    });
  });
});
