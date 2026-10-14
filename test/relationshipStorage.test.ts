// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import {
  RELATIONSHIPS_KEY,
  createRelationship,
  deleteRelationship,
  loadRelationships,
  pruneRelationships,
  relationshipsFor,
  saveRelationships,
  upsertRelationship,
} from "../src/storage/relationshipStorage";

const edge = (fromId: string, toId: string, kind = "friend" as const) => ({
  id: `e-${fromId}-${toId}`,
  fromId,
  toId,
  kind,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
});

describe("relationshipStorage", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("returns an empty list when nothing is stored", () => {
    expect(loadRelationships()).toEqual([]);
  });

  it("survives a corrupted value", () => {
    localStorage.setItem(RELATIONSHIPS_KEY, "not json");
    expect(loadRelationships()).toEqual([]);

    localStorage.setItem(RELATIONSHIPS_KEY, JSON.stringify({ not: "an array" }));
    expect(loadRelationships()).toEqual([]);
  });

  it("round-trips edges", () => {
    saveRelationships([edge("a", "b")]);

    const [loaded] = loadRelationships();
    expect(loaded.fromId).toBe("a");
    expect(loaded.toId).toBe("b");
    expect(loaded.kind).toBe("friend");
  });

  it("drops entries that are not usable edges", () => {
    localStorage.setItem(
      RELATIONSHIPS_KEY,
      JSON.stringify([
        edge("a", "b"),
        { id: "no-endpoints" },
        { id: "self", fromId: "a", toId: "a", kind: "friend" },
        "a string",
        null,
      ]),
    );

    const loaded = loadRelationships();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].id).toBe("e-a-b");
  });

  it("falls back to the other kind rather than dropping an unknown one", () => {
    localStorage.setItem(
      RELATIONSHIPS_KEY,
      JSON.stringify([{ id: "x", fromId: "a", toId: "b", kind: "invented-by-hand" }]),
    );

    expect(loadRelationships()[0].kind).toBe("other");
  });

  it("gives malformed timestamps a usable value", () => {
    localStorage.setItem(RELATIONSHIPS_KEY, JSON.stringify([{ id: "x", fromId: "a", toId: "b", kind: "friend" }]));

    const loaded = loadRelationships()[0];
    expect(Number.isNaN(Date.parse(loaded.createdAt))).toBe(false);
    expect(Number.isNaN(Date.parse(loaded.updatedAt))).toBe(false);
  });

  it("ignores a duplicate edge for the same pair and kind", () => {
    localStorage.setItem(
      RELATIONSHIPS_KEY,
      JSON.stringify([edge("a", "b"), { ...edge("a", "b"), id: "second" }]),
    );

    expect(loadRelationships()).toHaveLength(1);
  });

  it("keeps edges of different kinds between the same pair", () => {
    localStorage.setItem(
      RELATIONSHIPS_KEY,
      JSON.stringify([edge("a", "b", "friend"), { ...edge("a", "b", "rival"), id: "r" }]),
    );

    expect(loadRelationships()).toHaveLength(2);
  });

  it("adds then updates an edge in place", () => {
    const created = createRelationship("a", "b", "friend", "  ");

    upsertRelationship(created);
    expect(loadRelationships()).toHaveLength(1);
    expect(loadRelationships()[0].note).toBeUndefined();

    upsertRelationship({ ...created, kind: "enemy", note: "反目" });
    const loaded = loadRelationships();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].kind).toBe("enemy");
    expect(loaded[0].note).toBe("反目");
  });

  it("generates distinct ids", () => {
    expect(createRelationship("a", "b", "friend").id).not.toBe(createRelationship("a", "b", "friend").id);
  });

  it("deletes one edge and leaves the rest", () => {
    const first = createRelationship("a", "b", "friend");
    upsertRelationship(first);
    upsertRelationship(createRelationship("b", "c", "rival"));

    deleteRelationship(first.id);

    const remaining = loadRelationships();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].toId).toBe("c");
  });

  it("drops edges whose endpoints are gone", () => {
    // Deleting a character must not leave the graph pointing at it.
    upsertRelationship(createRelationship("a", "b", "friend"));
    upsertRelationship(createRelationship("b", "c", "friend"));

    const pruned = pruneRelationships(["b", "c"]);

    expect(pruned).toHaveLength(1);
    expect(pruned[0].fromId).toBe("b");
    expect(loadRelationships()).toHaveLength(1);
  });

  it("finds the edges touching a character in either direction", () => {
    upsertRelationship(createRelationship("a", "b", "friend"));
    upsertRelationship(createRelationship("c", "a", "mentor"));
    upsertRelationship(createRelationship("x", "y", "friend"));

    const touching = relationshipsFor("a");

    expect(touching).toHaveLength(2);
    expect(touching.map((e) => `${e.fromId}->${e.toId}`).sort()).toEqual(["a->b", "c->a"]);
  });
});
