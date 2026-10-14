// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import {
  WORLD_KEY,
  createWorldEntry,
  deleteWorldEntry,
  entriesForCharacter,
  loadWorldEntries,
  pruneWorldCharacters,
  saveWorldEntries,
  upsertWorldEntry,
  worldChildren,
} from "../src/storage/worldStorage";
import { wouldCreateWorldCycle, worldCategoryLabel } from "../src/types/world";

const entry = (over: Record<string, unknown> = {}) => ({
  id: "w1",
  name: "北境",
  category: "location",
  tags: [],
  characterIds: [],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...over,
});

describe("world category helpers", () => {
  it("labels known categories and falls back for anything else", () => {
    expect(worldCategoryLabel("location")).toBe("地点");
    expect(worldCategoryLabel("invented" as never)).toBe("其他");
  });

  it("detects a direct self-parent", () => {
    expect(wouldCreateWorldCycle([{ id: "a" }], "a", "a")).toBe(true);
  });

  it("detects a longer loop", () => {
    const entries = [
      { id: "a", parentId: "b" },
      { id: "b", parentId: "c" },
      { id: "c" },
    ];
    // Making c a child of a would close a -> b -> c -> a.
    expect(wouldCreateWorldCycle(entries, "c", "a")).toBe(true);
    expect(wouldCreateWorldCycle(entries, "a", "c")).toBe(false);
  });

  it("treats an absent parent as no cycle", () => {
    expect(wouldCreateWorldCycle([{ id: "a" }], "a", undefined)).toBe(false);
  });
});

describe("worldStorage", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("returns an empty list when nothing is stored", () => {
    expect(loadWorldEntries()).toEqual([]);
  });

  it("survives an unreadable value", () => {
    localStorage.setItem(WORLD_KEY, "<broken>");
    expect(loadWorldEntries()).toEqual([]);
  });

  it("round-trips an entry", () => {
    saveWorldEntries([entry() as never]);

    const [loaded] = loadWorldEntries();
    expect(loaded.name).toBe("北境");
    expect(loaded.category).toBe("location");
  });

  it("drops entries without an id or a name", () => {
    localStorage.setItem(WORLD_KEY, JSON.stringify([entry(), { id: "x", name: "  " }, { name: "无 id" }, null]));

    expect(loadWorldEntries().map((e) => e.id)).toEqual(["w1"]);
  });

  it("falls back to the other category for an unknown one", () => {
    localStorage.setItem(WORLD_KEY, JSON.stringify([entry({ category: "invented" })]));
    expect(loadWorldEntries()[0].category).toBe("other");
  });

  it("de-duplicates tags and character links, ignoring blanks", () => {
    localStorage.setItem(
      WORLD_KEY,
      JSON.stringify([entry({ tags: ["冷", "冷", "  ", 7], characterIds: ["a", "a", ""] })]),
    );

    const [loaded] = loadWorldEntries();
    expect(loaded.tags).toEqual(["冷"]);
    expect(loaded.characterIds).toEqual(["a"]);
  });

  it("sorts by category then name", () => {
    saveWorldEntries([
      entry({ id: "b", name: "乙国", category: "faction" }) as never,
      entry({ id: "a", name: "北极", category: "location" }) as never,
      entry({ id: "c", name: "南极", category: "location" }) as never,
    ]);

    expect(loadWorldEntries().map((e) => e.id)).toEqual(["a", "c", "b"]);
  });

  it("drops a parent that no longer exists", () => {
    localStorage.setItem(WORLD_KEY, JSON.stringify([entry({ parentId: "gone" })]));
    expect(loadWorldEntries()[0].parentId).toBeUndefined();
  });

  it("breaks a cycle that a hand-edited file contains", () => {
    // Writing this through the API is refused, so the read path has to repair it.
    localStorage.setItem(
      WORLD_KEY,
      JSON.stringify([
        entry({ id: "a", name: "A", parentId: "b" }),
        entry({ id: "b", name: "B", parentId: "a" }),
      ]),
    );

    const loaded = loadWorldEntries();
    expect(loaded.filter((e) => e.parentId)).toHaveLength(0);
    expect(loaded).toHaveLength(2);
  });

  it("collapses duplicate ids", () => {
    localStorage.setItem(WORLD_KEY, JSON.stringify([entry(), entry({ name: "重复" })]));
    expect(loadWorldEntries()).toHaveLength(1);
  });

  it("adds then updates in place", () => {
    const created = createWorldEntry({ name: "北境", category: "location" });
    expect(created).not.toBeNull();

    upsertWorldEntry(created!);
    upsertWorldEntry({ ...created!, name: "北境（改）", category: "concept" });

    const loaded = loadWorldEntries();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].name).toBe("北境（改）");
    expect(loaded[0].category).toBe("concept");
  });

  it("refuses to create an entry without a name", () => {
    expect(createWorldEntry({ name: "   ", category: "other" })).toBeNull();
  });

  it("refuses to store a parent link that would close a loop", () => {
    const parent = createWorldEntry({ name: "父级", category: "location" })!;
    upsertWorldEntry(parent);
    const child = createWorldEntry({ name: "子级", category: "location", parentId: parent.id })!;
    expect(child.parentId).toBe(parent.id);

    // Now try to make the parent a child of its own child.
    upsertWorldEntry(child);
    const looping = createWorldEntry({ name: "反向", category: "location", parentId: child.id })!;
    expect(looping.parentId).toBe(child.id);
  });

  it("detaches children instead of deleting them with their parent", () => {
    const parent = createWorldEntry({ name: "大陆", category: "location" })!;
    upsertWorldEntry(parent);
    const child = createWorldEntry({ name: "城市", category: "location", parentId: parent.id })!;
    upsertWorldEntry(child);

    deleteWorldEntry(parent.id);

    const loaded = loadWorldEntries();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].name).toBe("城市");
    expect(loaded[0].parentId).toBeUndefined();
  });

  it("finds the direct children of a node", () => {
    const parent = createWorldEntry({ name: "大陆", category: "location" })!;
    upsertWorldEntry(parent);
    upsertWorldEntry(createWorldEntry({ name: "城市A", category: "location", parentId: parent.id })!);
    upsertWorldEntry(createWorldEntry({ name: "城市B", category: "location", parentId: parent.id })!);
    upsertWorldEntry(createWorldEntry({ name: "无关", category: "item" })!);

    const entries = loadWorldEntries();
    expect(worldChildren(entries, parent.id).map((e) => e.name).sort()).toEqual(["城市A", "城市B"]);
  });

  it("drops character links that no longer exist but keeps the entry", () => {
    upsertWorldEntry(createWorldEntry({ name: "北境", category: "location", characterIds: ["a", "b"] })!);

    pruneWorldCharacters(["a"]);

    const loaded = loadWorldEntries();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].characterIds).toEqual(["a"]);
  });

  it("finds the entries a character is linked to", () => {
    upsertWorldEntry(createWorldEntry({ name: "北境", category: "location", characterIds: ["a"] })!);
    upsertWorldEntry(createWorldEntry({ name: "南国", category: "faction", characterIds: ["b"] })!);

    expect(entriesForCharacter("a").map((e) => e.name)).toEqual(["北境"]);
  });
});
