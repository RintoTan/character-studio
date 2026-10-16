import { describe, expect, it } from "vitest";
import { planLegacyFavoriteMigration } from "../src/pages/dashboard/legacyFavorites";
import type { Character } from "../src/types/character";

const make = (id: string, extra: Partial<Character> = {}): Character => ({ id, name: id, ...extra });

describe("planLegacyFavoriteMigration", () => {
  it("角色库为空时什么都不做——这正是曾经清空整个角色库的那条路径", () => {
    // The dashboard's first render, before the app has loaded the roster: nothing may
    // be written back from it, or the library is deleted by its own migration.
    expect(planLegacyFavoriteMigration([], ["a", "b"])).toBeNull();
  });

  it("没有旧收藏 id 时什么都不做", () => {
    expect(planLegacyFavoriteMigration([make("a")], [])).toBeNull();
  });

  it("把 id 命中的角色标记为收藏，并交回要清除的 id", () => {
    const roster = [make("a"), make("b"), make("c")];
    const plan = planLegacyFavoriteMigration(roster, ["a", "c"]);

    expect(plan?.clearedIds).toEqual(["a", "c"]);
    expect(plan?.characters.map((character) => character.favorite)).toEqual([true, undefined, true]);
    // The record's own flag is the only one left; the legacy mirror goes.
    expect(plan?.characters[0].isFavorite).toBeUndefined();
  });

  it("已经收藏过的角色不重复写入，整份列表保持原引用", () => {
    const roster = [make("a", { favorite: true })];
    const plan = planLegacyFavoriteMigration(roster, ["a"]);

    expect(plan?.characters).toBe(roster);
  });

  it("库非空但 id 全都失效时，只清除旧字段，不写回角色", () => {
    const roster = [make("a")];
    const plan = planLegacyFavoriteMigration(roster, ["gone-1", "gone-2"]);

    expect(plan?.characters).toBe(roster);
    expect(plan?.clearedIds).toEqual(["gone-1", "gone-2"]);
  });

  it("草稿不参与迁移：草稿不进收藏夹", () => {
    const roster = [make("a", { isDraft: true })];
    const plan = planLegacyFavoriteMigration(roster, ["a"]);

    expect(plan?.characters).toBe(roster);
  });
});
