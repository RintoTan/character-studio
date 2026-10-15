import { describe, expect, it } from "vitest";
import {
  blockingSignature,
  dismissibleLayers,
  hasBlockingLayer,
  type DashboardLayer,
} from "../src/pages/dashboard/layers";

const layer = (
  id: string,
  open: boolean,
  escape: boolean,
  blocksMenus: boolean,
): DashboardLayer => ({ id, open, escape, blocksMenus });

describe("dashboard layers", () => {
  describe("the Escape rule", () => {
    it("returns only the layers Escape is allowed to dismiss", () => {
      const layers = [
        layer("about", true, true, true),
        layer("character-delete", true, false, true),
        layer("card-menu", true, true, false),
      ];

      expect(dismissibleLayers(layers).map((l) => l.id)).toEqual(["about", "card-menu"]);
    });

    it("keeps the declaration order, so a review can read it top to bottom", () => {
      const layers = [layer("a", true, true, false), layer("b", true, true, false)];
      expect(dismissibleLayers(layers).map((l) => l.id)).toEqual(["a", "b"]);
    });

    it("does not let an unopened layer into the list it would not close anyway", () => {
      // Escape calls every dismissible close unconditionally, matching the setters
      // it replaced. That the layer is closed is the state's business, not this
      // function's -- so it is listed.
      expect(dismissibleLayers([layer("about", false, true, true)])).toHaveLength(1);
    });
  });

  describe("the background-menu rule", () => {
    it("needs a layer that both counts as a dialog and is open", () => {
      // A dialog that is closed does not suppress anything...
      expect(hasBlockingLayer([layer("about", false, true, true)])).toBe(false);
      // ...and a dropdown that is open is not a dialog.
      expect(hasBlockingLayer([layer("card-menu", true, true, false)])).toBe(false);
      expect(hasBlockingLayer([layer("about", true, true, true)])).toBe(true);
    });

    it("counts a destructive confirmation, even though Escape will not close it", () => {
      // The two properties are independent on purpose: this is the pair that the
      // three hand-written lists disagreed about.
      const destructive = layer("character-delete", true, false, true);
      expect(hasBlockingLayer([destructive])).toBe(true);
      expect(dismissibleLayers([destructive])).toHaveLength(0);
    });
  });

  describe("the change signature", () => {
    it("covers blocking layers only, in declaration order", () => {
      const layers = [
        layer("card-menu", true, true, false),
        layer("about", true, true, true),
        layer("settings", false, true, true),
      ];

      expect(blockingSignature(layers)).toBe("10");
    });

    it("changes when one blocking dialog replaces another", () => {
      // The case a plain boolean would miss, and the reason this exists: the effect
      // that closes the background menus has to re-run here, exactly as it did when
      // it depended on the fifteen values directly.
      const first = [layer("about", true, true, true), layer("settings", false, true, true)];
      const second = [layer("about", false, true, true), layer("settings", true, true, true)];

      expect(hasBlockingLayer(first)).toBe(true);
      expect(hasBlockingLayer(second)).toBe(true);
      expect(blockingSignature(first)).not.toBe(blockingSignature(second));
    });

    it("ignores layers that do not block, so opening a dropdown does not re-run it", () => {
      const withoutMenu = [layer("about", true, true, true), layer("card-menu", false, true, false)];
      const withMenu = [layer("about", true, true, true), layer("card-menu", true, true, false)];

      expect(blockingSignature(withoutMenu)).toBe(blockingSignature(withMenu));
    });
  });

  describe("the registry as declared", () => {
    // A fixture shaped like the real list, so the two derived sets can be asserted
    // without a browser. The real registry is checked behaviourally in the probe.
    const registry = [
      layer("more-menu", true, true, false),
      layer("card-menu", false, true, false),
      layer("search-panel", true, true, false),
      layer("export-target", false, true, true),
      layer("command", false, true, true),
      layer("about", false, true, true),
      layer("asset-delete", false, true, true),
      layer("character-delete", true, false, true),
      layer("bulk-delete", false, false, true),
      layer("bulk-mode", true, true, false),
      layer("selection", false, true, false),
      layer("bulk-edit", false, false, false),
      layer("restore-snapshot", true, false, false),
    ];

    it("Escape closes the dropdowns and modes but not the destructive confirms", () => {
      const ids = dismissibleLayers(registry).map((l) => l.id);

      expect(ids).toContain("more-menu");
      expect(ids).toContain("search-panel");
      expect(ids).toContain("bulk-mode");
      expect(ids).toContain("asset-delete");
      expect(ids).not.toContain("character-delete");
      expect(ids).not.toContain("bulk-delete");
      expect(ids).not.toContain("bulk-edit");
      expect(ids).not.toContain("restore-snapshot");
    });

    it("suppresses the background menus for the modals, including the destructive ones", () => {
      // Six blocking layers, in declaration order: export-target, command, about,
      // asset-delete, character-delete, bulk-delete. Only character-delete is open.
      // The non-blocking layers -- the two dropdowns, the search panel, bulk mode,
      // the selection and the two gaps -- are not in the signature at all.
      expect(hasBlockingLayer(registry)).toBe(true);
      expect(blockingSignature(registry)).toBe("000010");
    });

    it("leaves the two gap layers in neither set, which is what makes them visible", () => {
      for (const id of ["bulk-edit", "restore-snapshot"]) {
        const entry = registry.find((l) => l.id === id);
        expect(entry?.escape).toBe(false);
        expect(entry?.blocksMenus).toBe(false);
      }
    });
  });
});
