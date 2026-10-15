import { describe, expect, it } from "vitest";
import {
  blockingSignature,
  hasBlockingLayer,
  type DashboardLayer,
} from "../src/pages/dashboard/layers";

const layer = (id: string, open: boolean, blocksMenus: boolean): DashboardLayer => ({
  id,
  open,
  blocksMenus,
});

describe("dashboard layers", () => {
  describe("the background-menu rule", () => {
    it("needs a layer that both counts as a dialog and is open", () => {
      // A dialog that is closed does not suppress anything...
      expect(hasBlockingLayer([layer("about", false, true)])).toBe(false);
      // ...and a dropdown that is open is not a dialog.
      expect(hasBlockingLayer([layer("card-menu", true, false)])).toBe(false);
      expect(hasBlockingLayer([layer("about", true, true)])).toBe(true);
    });

    it("counts a destructive confirmation", () => {
      // It is a modal like any other. That Escape also cancels it is a separate
      // rule and does not change what it does to the layers underneath.
      expect(hasBlockingLayer([layer("character-delete", true, true)])).toBe(true);
    });

    it("counts a dialog that only ever appeared in one of the old lists", () => {
      // `bulk-edit` and `restore-snapshot` were in neither, so the background menus
      // stayed open behind them.
      expect(hasBlockingLayer([layer("bulk-edit", true, true)])).toBe(true);
      expect(hasBlockingLayer([layer("restore-snapshot", true, true)])).toBe(true);
    });
  });

  describe("the change signature", () => {
    it("covers blocking layers only, in declaration order", () => {
      const layers = [layer("card-menu", true, false), layer("about", true, true), layer("settings", false, true)];

      expect(blockingSignature(layers)).toBe("10");
    });

    it("changes when one blocking dialog replaces another", () => {
      // The case a plain boolean would miss, and the reason this exists: the effect
      // that closes the background menus has to re-run here, exactly as it did when
      // it depended on the fifteen values directly.
      const first = [layer("about", true, true), layer("settings", false, true)];
      const second = [layer("about", false, true), layer("settings", true, true)];

      expect(hasBlockingLayer(first)).toBe(true);
      expect(hasBlockingLayer(second)).toBe(true);
      expect(blockingSignature(first)).not.toBe(blockingSignature(second));
    });

    it("ignores layers that do not block, so opening a dropdown does not re-run it", () => {
      const withoutMenu = [layer("about", true, true), layer("card-menu", false, false)];
      const withMenu = [layer("about", true, true), layer("card-menu", true, false)];

      expect(blockingSignature(withoutMenu)).toBe(blockingSignature(withMenu));
    });
  });

  describe("the registry as declared", () => {
    // A fixture shaped like the real list, so the derived rules can be asserted
    // without a browser. The real registry is checked behaviourally in the probe.
    const registry = [
      layer("more-menu", true, false),
      layer("card-menu", false, false),
      layer("search-panel", true, false),
      layer("export-target", false, true),
      layer("command", false, true),
      layer("about", false, true),
      layer("asset-delete", false, true),
      layer("bulk-edit", false, true),
      layer("restore-snapshot", true, true),
      layer("character-delete", true, true),
      layer("bulk-delete", false, true),
      layer("bulk-mode", true, false),
      layer("selection", false, false),
    ];

    it("has no layer that Escape is forbidden to dismiss", () => {
      // The registry no longer carries an exception flag, so this asserts the shape
      // of the decision rather than a property: every entry declares the same two
      // things, and Escape closes all of them.
      for (const entry of registry) {
        expect(Object.keys(entry).sort()).toEqual(["blocksMenus", "id", "open"]);
      }
    });

    it("suppresses the background menus whenever any modal is open", () => {
      // Eight blocking layers, in declaration order: export-target, command, about,
      // asset-delete, bulk-edit, restore-snapshot, character-delete, bulk-delete.
      // Open here: restore-snapshot and character-delete.
      expect(hasBlockingLayer(registry)).toBe(true);
      expect(blockingSignature(registry)).toBe("00000110");
    });

    it("leaves the dropdowns and modes out of the signature", () => {
      const ids = registry.filter((l) => !l.blocksMenus).map((l) => l.id);

      expect(ids).toEqual(["more-menu", "card-menu", "search-panel", "bulk-mode", "selection"]);
    });
  });
});
