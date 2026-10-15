// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import {
  RECENT_AVATAR_KEY,
  RECENT_AVATAR_LIMIT,
  loadRecentAvatars,
  saveRecentAvatar,
} from "../src/storage/recentAvatars";

const OFFERED = ["🙂", "😀", "😎", "🐱", "🐶", "🐉"];

describe("recent avatars", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("starts empty", () => {
    expect(loadRecentAvatars(OFFERED)).toEqual([]);
  });

  it("puts the newest first", () => {
    const first = saveRecentAvatar("🙂", []);
    const second = saveRecentAvatar("🐱", first);

    expect(second).toEqual(["🐱", "🙂"]);
  });

  it("moves a repeat to the front instead of listing it twice", () => {
    let list = saveRecentAvatar("🙂", []);
    list = saveRecentAvatar("😀", list);
    list = saveRecentAvatar("🙂", list);

    expect(list).toEqual(["🙂", "😀"]);
    expect(new Set(list).size).toBe(list.length);
  });

  it("caps the list", () => {
    let list: string[] = [];
    for (const emoji of OFFERED) {
      list = saveRecentAvatar(emoji, list);
    }
    // One more than the library holds, by repeating the oldest.
    list = saveRecentAvatar(OFFERED[0], list);

    expect(list.length).toBeLessThanOrEqual(RECENT_AVATAR_LIMIT);
  });

  it("reads back what it wrote", () => {
    const written = saveRecentAvatar("🐉", []);
    expect(loadRecentAvatars(OFFERED)).toEqual(written);
  });

  it("drops an emoji this build no longer offers", () => {
    // A recents row is a row of buttons. An emoji removed from the library would
    // otherwise sit there forever as a blank one.
    localStorage.setItem(RECENT_AVATAR_KEY, JSON.stringify(["🙂", "🦄", "🐱"]));

    expect(loadRecentAvatars(OFFERED)).toEqual(["🙂", "🐱"]);
  });

  it("drops entries that are not strings", () => {
    localStorage.setItem(RECENT_AVATAR_KEY, JSON.stringify(["🙂", 7, null, { a: 1 }, "🐱"]));

    expect(loadRecentAvatars(OFFERED)).toEqual(["🙂", "🐱"]);
  });

  it("survives storage holding something that is not a list", () => {
    localStorage.setItem(RECENT_AVATAR_KEY, JSON.stringify({ nope: true }));
    expect(loadRecentAvatars(OFFERED)).toEqual([]);

    localStorage.setItem(RECENT_AVATAR_KEY, "{not json");
    expect(loadRecentAvatars(OFFERED)).toEqual([]);
  });

  it("keeps the returned list even when the write fails", () => {
    const original = localStorage.setItem;
    localStorage.setItem = () => {
      throw new Error("QuotaExceededError");
    };

    // The row still updates for this session; it just will not come back.
    expect(saveRecentAvatar("🙂", ["😀"])).toEqual(["🙂", "😀"]);
    localStorage.setItem = original;
  });
});
