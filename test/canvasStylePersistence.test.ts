// Presets are a choice, not a computed value: the id the author picked has to come back
// after a reload, and so do any numbers they changed by hand on top of it.
//
// These cases exist because the browser check spent months reporting that a preset came
// back as null. The suite's "refresh" step was re-seeding the layout file, which deletes
// the record the style lives in -- so the failure was in the probe, not here. The point
// of pinning the read/write shape below is that the next time that check goes red, the
// question "is it the product?" has an answer that does not need a browser.
import { describe, expect, it } from "vitest";
import {
  CANVAS_PRESETS,
  DEFAULT_CANVAS_STYLE,
  normalizeCanvasStyle,
  styleForPreset,
  type CanvasPresetId,
  type CanvasStyle,
} from "../src/storage/canvasStyle";
import { materializeLayout, normalizeLayout, pruneLayout, emptyLayout } from "../src/storage/relationshipLayout";

/** What storage actually hands back: a JSON round trip, not the live object. */
const throughStorage = (style: CanvasStyle): CanvasStyle =>
  normalizeCanvasStyle(JSON.parse(JSON.stringify(style)));

describe("canvas style persistence", () => {
  it("keeps every shipped preset's identity across a round trip", () => {
    // Non-vacuity first: if the preset table were empty this would prove nothing.
    expect(CANVAS_PRESETS).toHaveLength(8);
    for (const preset of CANVAS_PRESETS) {
      const restored = throughStorage(styleForPreset(preset.id));
      expect(restored.preset, preset.id).toBe(preset.id);
    }
  });

  it("keeps the values that make a preset visually different", () => {
    // The three the browser check looks at, plus the ones a preset is recognised by.
    const archive = throughStorage(styleForPreset("archive"));
    expect(archive.node.size).toBeCloseTo(0.92);
    expect(archive.node.form).toBe("compact");
    expect(archive.edge.width).toBe(1);
    expect(archive.canvas.grid).toBe("lines");
    expect(archive.canvas.background).toBe("#f7f2e8");

    const portrait = throughStorage(styleForPreset("portrait"));
    expect(portrait.node.size).toBeCloseTo(1.35);
    expect(portrait.canvas.grid).toBe("none");

    const minimal = throughStorage(styleForPreset("minimal"));
    expect(minimal.edge.arrow).toBe("none");
    expect(minimal.node.showAvatars).toBe(false);
  });

  it("does not turn a hand-tuned preset back into the preset's own numbers", () => {
    // 极简展示 + a bigger node is the author's look, not 极简展示. Reading it back must
    // keep both the edits and the fact that they are edits.
    const tuned: CanvasStyle = {
      ...styleForPreset("minimal"),
      preset: "custom",
      node: { ...styleForPreset("minimal").node, size: 1.6 },
    };
    const restored = throughStorage(tuned);
    expect(restored.preset).toBe("custom");
    expect(restored.node.size).toBe(1.6);
    // and the rest of 极简展示 is still underneath it
    expect(restored.edge.arrow).toBe("none");
    expect(restored.canvas.grid).toBe("none");
  });

  it("reads a layout written before styles existed without inventing a preset", () => {
    // Sprint 49 packages have no style block at all. They open in classic; they must not
    // be recorded as "custom", which would claim the author tuned something.
    const old = normalizeLayout({ positions: { "g-1": { x: 10, y: 20 } }, groups: [] });
    expect(old.style?.preset).toBe("classic");
    expect(old.style).toEqual(DEFAULT_CANVAS_STYLE);
  });

  it("does not let a stored style reach into the shared default", () => {
    // DEFAULT_CANVAS_STYLE is a module-level object; a reader that returns it by reference
    // lets one page's edit silently become every later page's starting point.
    const first = normalizeCanvasStyle(undefined);
    first.node.size = 1.9;
    expect(DEFAULT_CANVAS_STYLE.node.size).toBe(1);
    expect(normalizeCanvasStyle(undefined).node.size).toBe(1);
  });

  it("carries the style through every layout rebuild that runs behind a drag or a preset", () => {
    // materializeLayout and pruneLayout rebuild the record field by field. Both were once
    // the reason a preset (or a node colour) vanished after an unrelated edit.
    const styled: ReturnType<typeof emptyLayout> = { ...emptyLayout(), style: styleForPreset("dossier") };

    const materialised = materializeLayout(styled, ["a", "b"], [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ]);
    expect(materialised.style?.preset).toBe("dossier");

    const pruned = pruneLayout(materialised, ["a", "b"]);
    expect(pruned.style?.preset).toBe("dossier");
    expect(pruned.style?.node.form).toBe("card");
  });

  it("keeps a chosen preset when the preset table is asked for it by id", () => {
    // Applying a preset replaces the whole style. That is what 恢复默认 undoes, and it is
    // why the id has to be part of the value rather than inferred from the numbers.
    const applied: CanvasPresetId[] = ["archive", "portrait", "faction", "story"];
    for (const id of applied) {
      const style = styleForPreset(id);
      expect(style.preset).toBe(id);
      expect(throughStorage(style).preset).toBe(id);
    }
  });
});
