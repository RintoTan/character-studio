import { describe, expect, it } from "vitest";
import {
  CARD_HEIGHT,
  CARD_WIDTH,
  boxHalfWidthFor,
  cardNameLayout,
  canvasBox,
  canvasBoxKey,
  edgeGeometry,
  groupPaddingFor,
  measureNameWidth,
  cardGeometry,
  cardRect,
  neighbourIdsOf,
  nodeGeometry,
  resolveCardLevels,
  ringStrokeFor,
  type GraphMetrics,
} from "../src/pages/RelationshipGraph";
import {
  CANVAS_PRESETS,
  normalizeCanvasStyle,
  styleForPreset,
} from "../src/storage/canvasStyle";
import { GROUP_PADDING, gridLayout, groupBounds, normalizeLayout } from "../src/storage/relationshipLayout";
import { graphMetrics } from "../src/storage/graphPrefs";

const metrics: GraphMetrics = graphMetrics({ avatarSize: "medium", nameSize: "medium" });
const numbers = (path: string) => (path.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
const points = (path: string) => {
  const values = numbers(path);
  const out: number[][] = [];
  for (let i = 0; i < values.length - 1; i += 2) out.push([values[i], values[i + 1]]);
  return out;
};
const R = metrics.radius;

describe("nodeGeometry", () => {
  it("gives an avatar node a circle of the base radius", () => {
    expect(nodeGeometry("avatar", metrics, 1)).toEqual({
      radius: R,
      halfWidth: R,
      halfHeight: R,
      card: false,
      // A circle is its own rounded frame: the drawing, the hit area and the edges
      // read one geometry, and the frame carries the radius as its corner.
      rounded: false,
      rx: R,
    });
  });

  it("draws a compact node at 0.62 of the radius, with no extra width", () => {
    const compact = nodeGeometry("compact", metrics, 1);

    expect(compact.radius).toBeCloseTo(R * 0.62, 5);
    expect(compact.halfWidth).toBe(compact.radius);
    expect(compact.card).toBe(false);
  });

  it("gives a card the rectangle it is drawn with, not a circle", () => {
    const card = nodeGeometry("card", metrics, 1);

    expect(card.card).toBe(true);
    expect(card.halfWidth).toBe(CARD_WIDTH / 2);
    expect(card.halfHeight).toBe(CARD_HEIGHT / 2);
    // The radius a card reports is its avatar circle, which is smaller than its half
    // width: the two cannot be interchanged, which is why they are both returned.
    expect(card.radius).toBeLessThan(card.halfWidth);
  });

  it("scales every form by the node size multiplier", () => {
    expect(nodeGeometry("card", metrics, 1.5).halfWidth).toBe((CARD_WIDTH * 1.5) / 2);
    expect(nodeGeometry("avatar", metrics, 1.5).radius).toBe(R * 1.5);
  });
});

describe("canvas reserve for cards", () => {
  it("keeps the label reserve when every node is round", () => {
    expect(boxHalfWidthFor(["avatar", "compact"], metrics, 40, 1)).toBe(40);
  });

  it("reserves the card's half width when one is present", () => {
    const half = boxHalfWidthFor(["avatar", "card"], metrics, 40, 1);

    expect(half).toBe(CARD_WIDTH / 2 - R);
    expect(half).toBeGreaterThan(40);
  });

  it("lets a wide label win when it is wider than the card", () => {
    expect(boxHalfWidthFor(["card"], metrics, 500, 1)).toBe(500);
  });

  it("produces a box that contains the card's corners", () => {
    const positions = [
      { x: 0, y: 0 },
      { x: 400, y: 0 },
    ];
    const half = boxHalfWidthFor(["card", "card"], metrics, 0, 1);
    const [x, , width] = canvasBox(positions, metrics, half).viewBox.split(" ").map(Number);

    expect(x).toBeLessThanOrEqual(0 - CARD_WIDTH / 2);
    expect(x + width).toBeGreaterThanOrEqual(400 + CARD_WIDTH / 2);
  });
});

describe("group padding around cards", () => {
  it("keeps the standard padding for round members", () => {
    expect(groupPaddingFor(["avatar", "compact"], 1)).toBe(GROUP_PADDING);
  });

  it("stands off far enough that the border does not cross a card", () => {
    const padding = groupPaddingFor(["avatar", "card"], 1);

    expect(padding).toBeGreaterThan(CARD_WIDTH / 2);
  });

  it("puts the border outside a card in the rectangle a group draws", () => {
    const layout = {
      positions: { a: { x: 0, y: 0 } },
      groups: [{ id: "g", name: "北境线", characterIds: ["a"] }],
    };
    const rect = groupBounds(layout as never, layout.groups[0] as never, groupPaddingFor(["card"], 1));

    expect(rect.x).toBeLessThanOrEqual(-CARD_WIDTH / 2);
    expect(rect.x + rect.width).toBeGreaterThanOrEqual(CARD_WIDTH / 2);
  });
});

describe("edges reaching a card", () => {
  const from = { x: 0, y: 0 };
  const to = { x: 400, y: 0 };
  const box = { halfWidth: CARD_WIDTH / 2, halfHeight: CARD_HEIGHT / 2 };

  it("stops at the card's side, not at an imaginary circle", () => {
    const edge = edgeGeometry(from, to, { metrics, fromBox: box });
    const start = points(edge.path)[0];

    expect(start[0]).toBeCloseTo(CARD_WIDTH / 2 + 2, 5);
    expect(start[1]).toBeCloseTo(0, 5);
  });

  it("stops on the narrow side when the line leaves vertically", () => {
    const below = { x: 0, y: 400 };
    // Arrowless, so this measures the rim trim alone. With an arrow the stroke
    // stops at the head's base instead — covered by the case below.
    const edge = edgeGeometry(from, below, { metrics, toBox: box, arrowStyle: "none" });
    const end = points(edge.path).slice(-1)[0];

    expect(end[1]).toBeCloseTo(400 - (CARD_HEIGHT / 2 + 3), 5);
  });

  it("stops short of the rim when a head is drawn, so the two never overlap", () => {
    const below = { x: 0, y: 400 };
    const plain = points(edgeGeometry(from, below, { metrics, toBox: box, arrowStyle: "none" }).path).slice(-1)[0];
    const armed = points(edgeGeometry(from, below, { metrics, toBox: box }).path).slice(-1)[0];

    expect(armed[1]).toBeLessThan(plain[1]);
    expect(plain[1] - armed[1]).toBeGreaterThan(4);
    expect(plain[1] - armed[1]).toBeLessThan(30);
  });

  it("trims a bent edge from the same rectangle", () => {
    const straight = edgeGeometry(from, to, { metrics, fromBox: box });
    const bent = edgeGeometry(from, to, { metrics, fromBox: box, bend: 1 });

    expect(bent.path).not.toBe(straight.path);
    const [sx, sy] = points(straight.path)[0];
    const [bx, by] = points(bent.path)[0];

    expect(bx).toBeCloseTo(sx, 5);
    expect(by).toBeCloseTo(sy, 5);
  });

  it("keeps the arrow head clear of the card it points at", () => {
    const edge = edgeGeometry(from, to, { metrics, toBox: box });
    const tip = points(edge.arrow ?? "")[0] ?? [];

    expect(tip[0]).toBeLessThanOrEqual(400 - CARD_WIDTH / 2);
    expect(tip[0]).toBeGreaterThanOrEqual(400 - CARD_WIDTH / 2 - 4);
  });

  it("grows the head with the stroke, but only within bounds", () => {
    const thin = edgeGeometry(from, to, { metrics, weight: 0.4 }).arrow ?? "";
    const thick = edgeGeometry(from, to, { metrics, weight: 6 }).arrow ?? "";
    const head = (arrow: string) => {
      const [tip, left, right] = points(arrow);
      const back = [(left[0] + right[0]) / 2, (left[1] + right[1]) / 2];
      return Math.hypot(tip[0] - back[0], tip[1] - back[1]);
    };

    expect(head(thin)).toBeGreaterThanOrEqual(8);
    expect(head(thick)).toBeLessThanOrEqual(14);
    expect(head(thick)).toBeGreaterThan(head(thin));
  });
});

describe("names inside a card", () => {
  const width = CARD_WIDTH - (CARD_HEIGHT - 8) - 20;

  it("leaves a short name alone", () => {
    expect(cardNameLayout("沈青梧", width, 15)).toEqual({ text: "沈青梧", fontSize: 15 });
  });

  it("shrinks a long name before cutting it", () => {
    const layout = cardNameLayout("沈青梧与顾行之的旧事", width, 15);

    expect(layout.fontSize).toBeLessThan(15);
    expect(layout.fontSize).toBeGreaterThanOrEqual(10);
  });

  it("truncates with an ellipsis when even the smallest size will not fit", () => {
    const name = "Alexandria Cassandra Montgomery-Worthington";
    const layout = cardNameLayout(name, width, 15);

    expect(layout.text.endsWith("…")).toBe(true);
    expect(layout.text.length).toBeLessThan(name.length);
    expect(measureNameWidth(layout.text, layout.fontSize)).toBeLessThanOrEqual(width + 0.5);
  });

  it("measures CJK wider than Latin, so both kinds are cut by width rather than count", () => {
    const cjk = cardNameLayout("一二三四五六七八九十一二三四五六七八九十", width, 14);
    const latin = cardNameLayout("abcdefghijklmnopqrstuvwxyzabcdefghij", width, 14);

    expect([...cjk.text].length).toBeLessThan([...latin.text].length);
  });
});

describe("style model compatibility", () => {
  it("gives an old layout the avatar form it was drawn with", () => {
    expect(normalizeCanvasStyle(undefined).node.form).toBe("avatar");
    expect(normalizeCanvasStyle({ preset: "classic" }).node.form).toBe("avatar");
  });

  it("keeps a valid form and falls back for an unknown one", () => {
    expect(normalizeCanvasStyle({ node: { form: "card" } }).node.form).toBe("card");
    expect(normalizeCanvasStyle({ node: { form: "compact" } }).node.form).toBe("compact");
    expect(normalizeCanvasStyle({ node: { form: "hologram" } as never }).node.form).toBe("avatar");
  });

  it("maps each preset to the node form it is meant to read as", () => {
    const formOf = (id: string) => styleForPreset(id as never).node.form;
    // The whole shipped set, and the form each one promises. A preset added without a
    // deliberate form shows up here as a missing key rather than as a silent default.
    const expected: Record<string, "avatar" | "compact" | "card"> = {
      classic: "avatar",
      portrait: "avatar",
      faction: "avatar",
      archive: "compact",
      minimal: "compact",
      story: "avatar",
      dossier: "card",
      soft: "avatar",
    };

    expect(CANVAS_PRESETS).toHaveLength(Object.keys(expected).length);
    expect(CANVAS_PRESETS.map((preset) => preset.id).sort()).toEqual(Object.keys(expected).sort());

    for (const [id, form] of Object.entries(expected)) {
      expect(formOf(id)).toBe(form);
    }
  });

  it("keeps a per-node form override through normalisation", () => {
    const layout = normalizeLayout({
      schemaVersion: 2,
      positions: { a: { x: 0, y: 0 } },
      nodeStyles: { a: { form: "card" } },
    });

    expect(layout.nodeStyles?.a?.form).toBe("card");
  });

  it("keeps overrides and bookmarks when a preset is applied over a saved layout", () => {
    const layout = normalizeLayout({
      schemaVersion: 2,
      positions: { a: { x: 0, y: 0 } },
      nodeStyles: { a: { form: "card" } },
      edgeStyles: { e: { color: "#0f766e" } },
      bookmarks: [{ id: "b", name: "特写", view: { k: 1.5, x: 0, y: 0 } }],
      style: { preset: "classic" },
    });
    const styled = { ...layout, style: styleForPreset("minimal") };

    expect(styled.nodeStyles?.a?.form).toBe("card");
    expect(styled.edgeStyles?.e?.color).toBe("#0f766e");
    expect(styled.bookmarks).toHaveLength(1);
    expect(styled.positions.a).toEqual({ x: 0, y: 0 });
  });
});

describe("adaptive card levels", () => {
  const metricsForCards: GraphMetrics = graphMetrics({ avatarSize: "medium", nameSize: "medium" });

  it("keeps a lone card full", () => {
    const levels = resolveCardLevels([{ id: "a", x: 0, y: 0 }], 1, { compactRadius: 18 });

    expect(levels.a).toBe("full");
  });

  it("steps a crowded card down to a plate instead of overlapping it", () => {
    // Two cards 120 apart: full cards are 168 wide, so the second cannot be full.
    const levels = resolveCardLevels(
      [
        { id: "a", x: 0, y: 0, priority: 3 },
        { id: "b", x: 120, y: 0, priority: 1 },
      ],
      1,
      { compactRadius: 18 },
    );

    expect(levels.a).toBe("full");
    expect(["plate", "compact"]).toContain(levels.b);
  });

  it("gives the selected person the full card even when it arrives later", () => {
    const levels = resolveCardLevels(
      [
        { id: "b", x: 0, y: 0, priority: 1 },
        { id: "a", x: 60, y: 0, priority: 3 },
      ],
      1,
      { compactRadius: 18 },
    );

    expect(levels.a).toBe("full");
    expect(["plate", "compact"]).toContain(levels.b);
  });

  it("falls to compact when even a plate would collide", () => {
    const levels = resolveCardLevels(
      [
        { id: "a", x: 0, y: 0, priority: 3 },
        { id: "b", x: 20, y: 0, priority: 1 },
      ],
      1,
      { compactRadius: 18 },
    );

    expect(levels.b).toBe("compact");
    expect(cardRect(levels.b, 20, 0, 1)).toBeNull();
  });

  it("depends on distance, not on zoom, so the same layout always resolves alike", () => {
    const entries = [
      { id: "a", x: 0, y: 0 },
      { id: "b", x: 300, y: 0 },
      { id: "c", x: 0, y: 300 },
    ];
    const first = resolveCardLevels(entries, 1, { compactRadius: 18 });
    const second = resolveCardLevels(entries, 1, { compactRadius: 18 });

    expect(first).toEqual(second);
    expect(Object.values(first).every((level) => level === "full")).toBe(true);
  });

  it("sizes a plate smaller than a full card but keeps it a box", () => {
    const full = cardGeometry("full", metricsForCards, 1);
    const plate = cardGeometry("plate", metricsForCards, 1);
    const compact = cardGeometry("compact", metricsForCards, 1);

    expect(plate.card).toBe(true);
    expect(plate.halfWidth).toBeLessThan(full.halfWidth);
    expect(plate.halfHeight).toBeLessThan(full.halfHeight);
    expect(compact.card).toBe(false);
    expect(compact.radius).toBeCloseTo(metricsForCards.radius * 0.62, 5);
  });
});

describe("spacing layout for cards", () => {
  it("uses rectangular cells when a card cell is given", () => {
    const grid = gridLayout(["a", "b", "c", "d"], { x: 0, y: 0 }, 30, 56, { width: 168, height: 56 });
    const stepX = Math.abs(grid.b.x - grid.a.x);
    const stepY = Math.abs(grid.c.y - grid.a.y);

    expect(stepX).toBe(224);
    expect(stepY).toBe(112);
  });

  it("keeps the square step when no cell is given", () => {
    const grid = gridLayout(["a", "b", "c", "d"], { x: 0, y: 0 }, 30, 56);

    expect(Math.abs(grid.b.x - grid.a.x)).toBe(116);
  });
});

describe("neighbours of a selection", () => {
  const rels = [
    { fromId: "a", toId: "b" },
    { fromId: "c", toId: "a" },
    { fromId: "a", toId: "a" },
    { fromId: "d", toId: "e" },
  ];

  it("collects both directions and ignores an unrelated pair", () => {
    expect([...neighbourIdsOf(["a"], rels)].sort()).toEqual(["b", "c"]);
  });

  it("never returns an anchor as its own neighbour", () => {
    const out = neighbourIdsOf(["a", "b"], rels);

    expect(out.has("a")).toBe(false);
    expect(out.has("b")).toBe(false);
    expect([...out]).toEqual(["c"]);
  });

  it("is empty without anchors", () => {
    expect(neighbourIdsOf([], rels).size).toBe(0);
  });
});

describe("selection ring ink", () => {
  it("solves for a constant on-screen weight instead of a fixed world stroke", () => {
    expect(ringStrokeFor(1)).toBeCloseTo(2.2, 5);
    expect(ringStrokeFor(0.2)).toBeCloseTo(8, 5);
  });

  it("stays inside its clamp before the frame is measured", () => {
    expect(ringStrokeFor(0)).toBe(8);
    expect(ringStrokeFor(10)).toBe(2);
  });
});

describe("card priority for a neighbour", () => {
  it("keeps a fuller card for the neighbour rather than the stranger beside it", () => {
    const levels = resolveCardLevels(
      [
        { id: "stranger", x: 0, y: 0, priority: 1 },
        { id: "neighbour", x: 120, y: 0, priority: 2 },
      ],
      1,
      { compactRadius: 18 },
    );

    expect(levels.neighbour).toBe("full");
    expect(["plate", "compact"]).toContain(levels.stranger);
  });
});

describe("drawing box cache key", () => {
  it("changes when cards make the drawing wider", () => {
    expect(canvasBoxKey(["a", "b"], 0, false)).not.toBe(canvasBoxKey(["a", "b"], 84, false));
  });

  it("changes when a group border appears", () => {
    expect(canvasBoxKey(["a", "b"], 0, false)).not.toBe(canvasBoxKey(["a", "b"], 0, true));
  });

  it("is stable when nothing the box depends on changed", () => {
    expect(canvasBoxKey(["a", "b"], 12, true)).toBe(canvasBoxKey(["a", "b"], 12, true));
  });

  it("changes when the roster changes", () => {
    expect(canvasBoxKey(["a", "b"], 0, false)).not.toBe(canvasBoxKey(["a"], 0, false));
  });
});
