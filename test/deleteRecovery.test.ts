// @vitest-environment happy-dom
// The data rules of a recoverable delete.
//
// This file is about the recovery itself: what it puts back, what it refuses to put
// back, and how it behaves when a write does not land. The wiring - that all three
// delete entry points in the app reach this code - is covered by rendering the real
// app in deleteEntryPoints.test.ts, and in a real browser by scripts/verify-browser.mjs.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DELETE_RECOVERY_KEY,
  captureDeleteRecovery,
  readDeleteRecovery,
  restoreDeleteRecovery,
} from "../src/storage/deleteRecovery";
import { loadCharacters, saveCharacters } from "../src/storage/characterStorage";
import { loadRelationships, saveRelationships } from "../src/storage/relationshipStorage";
import { loadTimeline, saveTimeline } from "../src/storage/timelineStorage";
import { loadWorldEntries, saveWorldEntries } from "../src/storage/worldStorage";
import { pruneCharacterReferences } from "../src/storage/referenceIntegrity";
import type { Character } from "../src/types/character";
import type { Relationship } from "../src/types/relationship";
import type { TimelineEvent } from "../src/types/timeline";
import type { WorldEntry } from "../src/types/world";

const NOW = "2026-10-16T00:00:00.000Z";

const character = (id: string, name = id): Character => ({ id, name, updatedAt: NOW });

const edge = (id: string, fromId: string, toId: string): Relationship => ({
  id,
  fromId,
  toId,
  kind: "friend",
  createdAt: NOW,
  updatedAt: NOW,
});

const event = (id: string, characterIds: string[]): TimelineEvent => ({
  id,
  title: `事件 ${id}`,
  date: "2026-01-01",
  era: "第一纪",
  kind: "origin",
  description: "",
  location: "",
  characterIds,
  createdAt: NOW,
  updatedAt: NOW,
});

const entry = (id: string, characterIds: string[]): WorldEntry => ({
  id,
  name: `条目 ${id}`,
  category: "location",
  parentId: null,
  summary: "",
  details: "",
  tags: [],
  characterIds,
  createdAt: NOW,
  updatedAt: NOW,
});

/**
 * The sequence the app runs for a delete: protect first, then remove, then prune.
 * Written out here only to reach a realistic state - the app's own wiring is what
 * deleteEntryPoints.test.ts exercises.
 */
function deleteWithProtection(ids: string[], reason = "删除角色") {
  const doomed = loadCharacters().filter((item) => ids.includes(item.id));
  const capture = captureDeleteRecovery(reason, doomed);
  if (capture.status === "failed") {
    return { ok: false as const, reason: capture.reason };
  }

  const next = loadCharacters().filter((item) => !ids.includes(item.id));
  saveCharacters(next);
  pruneCharacterReferences(next.map((item) => item.id));
  return { ok: true as const };
}

function failWritesTo(key: string, errorName = "QuotaExceededError") {
  const original = localStorage.setItem.bind(localStorage);
  return vi.spyOn(localStorage, "setItem").mockImplementation((target: string, value: string) => {
    if (String(target) === key) {
      const error = new Error("storage refused the write");
      error.name = errorName;
      throw error;
    }
    original(target, value);
  });
}

const ids = () => loadCharacters().map((character) => character.id);

function snapshotOfEverything() {
  return JSON.stringify({
    characters: loadCharacters(),
    relationships: loadRelationships(),
    timeline: loadTimeline(),
    world: loadWorldEntries(),
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

beforeEach(() => {
  localStorage.clear();
  saveCharacters([character("a", "沈青梧"), character("b", "陆停云"), character("c", "苏折玉")]);
  saveRelationships([edge("r1", "a", "b"), edge("r2", "a", "c")]);
  saveTimeline([event("t1", ["a", "b"])]);
  saveWorldEntries([entry("w1", ["a", "c"])]);
});

describe("a protected delete and its recovery", () => {
  it("puts the character and every reference it took with it back", () => {
    const deleted = deleteWithProtection(["a"]);
    expect(deleted.ok).toBe(true);

    // What the delete actually did, before anything is restored.
    expect(loadCharacters().map((item) => item.id)).toEqual(["b", "c"]);
    expect(loadRelationships()).toEqual([]);
    expect(loadTimeline()[0].characterIds).toEqual(["b"]);
    expect(loadWorldEntries()[0].characterIds).toEqual(["c"]);

    const result = restoreDeleteRecovery(["a"]);

    expect(result.status).toBe("restored");
    expect(result.counts).toEqual({ characters: 1, relationships: 2, timeline: 1, world: 1 });
    expect(loadCharacters().map((item) => item.id)).toContain("a");
    expect(loadRelationships().map((item) => item.id).sort()).toEqual(["r1", "r2"]);
    // The references come back on the same items, not on new ones.
    expect(loadTimeline().map((item) => item.id)).toEqual(["t1"]);
    expect(loadTimeline()[0].characterIds.sort()).toEqual(["a", "b"]);
    expect(loadWorldEntries().map((item) => item.id)).toEqual(["w1"]);
    expect(loadWorldEntries()[0].characterIds.sort()).toEqual(["a", "c"]);
  });

  it("spends the record once it has been used, so a second undo changes nothing", () => {
    deleteWithProtection(["a"]);
    expect(restoreDeleteRecovery(["a"]).status).toBe("restored");

    const after = snapshotOfEverything();
    const second = restoreDeleteRecovery(["a"]);

    expect(second.status).toBe("failed");
    expect(second.reason).toBe("没有可用的删除恢复记录");
    // Not "it worked again": the second press must not duplicate an edge or a
    // participant, and the data must be exactly what the first press left.
    expect(snapshotOfEverything()).toBe(after);
  });

  it("refuses to run at all when the recovery copy cannot be written", () => {
    const failure = failWritesTo(DELETE_RECOVERY_KEY);
    const before = snapshotOfEverything();

    const result = deleteWithProtection(["a"]);

    expect(failure).toHaveBeenCalled();
    expect(result).toEqual({ ok: false, reason: "浏览器存储空间不足" });
    // The point of refusing: nothing was deleted, so nothing needs recovering.
    expect(snapshotOfEverything()).toBe(before);
    expect(localStorage.getItem(DELETE_RECOVERY_KEY)).toBeNull();
  });

  it("captures nothing when there is nothing to protect", () => {
    expect(captureDeleteRecovery("删除角色", [])).toEqual({ status: "nothing-to-protect" });
  });
});

describe("a recovery that runs after the world has moved on", () => {
  it("does not overwrite unrelated data created after the delete", () => {
    deleteWithProtection(["a"]);

    // The author keeps working: a new character, a new edge between survivors, a
    // timeline event they edited.
    saveCharacters([character("d", "程无咎"), ...loadCharacters()]);
    saveRelationships([...loadRelationships(), edge("r9", "b", "c")]);
    saveTimeline(loadTimeline().map((item) => ({ ...item, title: "改过的标题" })));

    const result = restoreDeleteRecovery(["a"]);

    expect(result.status).toBe("restored");
    expect(loadCharacters().map((item) => item.id)).toEqual(["a", "d", "b", "c"]);
    expect(loadRelationships().map((item) => item.id).sort()).toEqual(["r1", "r2", "r9"]);
    expect(loadTimeline()[0].title).toBe("改过的标题");
  });

  it("resolves by id, so a character with the same name is never given someone else's edges", () => {
    // Two characters, one name. Only the deleted id may come back.
    saveCharacters([character("a", "同名"), character("x", "同名"), character("b", "陆停云")]);
    saveRelationships([edge("r1", "a", "b"), edge("r2", "x", "b")]);

    deleteWithProtection(["a"]);
    expect(loadRelationships().map((item) => item.id)).toEqual(["r2"]);

    const result = restoreDeleteRecovery(["a"]);

    expect(result.status).toBe("restored");
    const restored = loadRelationships();
    expect(restored.map((item) => item.id).sort()).toEqual(["r1", "r2"]);
    expect(restored.find((item) => item.id === "r1")?.fromId).toBe("a");
    expect(restored.find((item) => item.id === "r2")?.fromId).toBe("x");
    // A name-based recovery would have produced a second edge on the survivor.
    expect(restored.filter((item) => item.fromId === "x")).toHaveLength(1);
  });

  it("leaves a recorded item that was deleted afterwards deleted, and says so", () => {
    deleteWithProtection(["a"]);
    // The author deleted the event themselves in the meantime. Bringing it back would
    // undo a later decision.
    saveTimeline([]);

    const result = restoreDeleteRecovery(["a"]);

    expect(result.status).toBe("partial");
    expect(loadTimeline()).toEqual([]);
    expect(result.reason).toBe("有 1 处关联在删除之后被单独删除或改动，无法找回");
    expect(loadCharacters().map((item) => item.id)).toContain("a");
  });

  it("does not rebuild an edge whose other end is gone", () => {
    deleteWithProtection(["a"]);
    // Simulates a later import that dropped b. a→c still has both ends and comes
    // back; a→b would be a dangling reference, so it does not.
    saveCharacters([character("c")]);

    const result = restoreDeleteRecovery(["a"]);

    expect(result.status).toBe("partial");
    expect(loadRelationships().map((item) => item.id)).toEqual(["r2"]);
    expect(result.reason).toBe("有 1 处关联在删除之后被单独删除或改动，无法找回");
    expect(loadCharacters().map((item) => item.id).sort()).toEqual(["a", "c"]);
  });

  it("refuses a request that does not match the record it holds", () => {
    // A record belongs to one delete. Asking for a different character must not apply
    // it to the wrong one.
    deleteWithProtection(["a"]);
    const before = snapshotOfEverything();

    const result = restoreDeleteRecovery(["b"]);

    expect(result.status).toBe("failed");
    expect(result.reason).toBe("恢复记录与这次删除不匹配");
    expect(snapshotOfEverything()).toBe(before);
    // Still there: the record was not consumed by a request it does not answer.
    expect(localStorage.getItem(DELETE_RECOVERY_KEY)).not.toBeNull();
  });
});

describe("when storage only partly accepts the recovery", () => {
  it("reports partial, keeps the record, and finishes on the next attempt", () => {
    deleteWithProtection(["a"]);

    const failure = failWritesTo("character-studio.relationships");
    const first = restoreDeleteRecovery(["a"]);

    expect(failure).toHaveBeenCalled();
    expect(first.status).toBe("partial");
    expect(first.reason).toBe("部分关联未能写入本地存储，恢复记录已保留，可以再试一次");
    // The characters did land, and the record did not.
    expect(loadCharacters().map((item) => item.id)).toContain("a");
    expect(loadRelationships()).toEqual([]);
    expect(localStorage.getItem(DELETE_RECOVERY_KEY)).not.toBeNull();

    failure.mockRestore();
    const second = restoreDeleteRecovery(["a"]);

    expect(second.status).toBe("restored");
    // Finishing the job, not doing it twice.
    expect(loadRelationships().map((item) => item.id).sort()).toEqual(["r1", "r2"]);
    expect(loadTimeline()[0].characterIds.sort()).toEqual(["a", "b"]);
    expect(loadWorldEntries()[0].characterIds.sort()).toEqual(["a", "c"]);
    expect(localStorage.getItem(DELETE_RECOVERY_KEY)).toBeNull();
  });

  it("stops before touching any reference when the characters themselves cannot be written", () => {
    deleteWithProtection(["a"]);

    const failure = failWritesTo("character-studio.characters");
    const result = restoreDeleteRecovery(["a"]);

    expect(failure).toHaveBeenCalled();
    expect(result.status).toBe("failed");
    expect(result.reason).toContain("角色写入失败");
    // Restoring a reference first would point at a character that is not there.
    expect(loadRelationships()).toEqual([]);
    expect(localStorage.getItem(DELETE_RECOVERY_KEY)).not.toBeNull();
  });

  it("treats a damaged record as unusable, drops it, and changes nothing", () => {
    deleteWithProtection(["a"]);
    const before = JSON.stringify({
      characters: loadCharacters(),
      relationships: loadRelationships(),
    });

    localStorage.setItem(DELETE_RECOVERY_KEY, "{not json");

    const result = restoreDeleteRecovery(["a"]);

    expect(result.status).toBe("failed");
    expect(result.reason).toBe("没有可用的删除恢复记录");
    expect(
      JSON.stringify({
        characters: loadCharacters(),
        relationships: loadRelationships(),
      }),
    ).toBe(before);
    // Dropped, so the next attempt fails the same way rather than being retried forever.
    expect(localStorage.getItem(DELETE_RECOVERY_KEY)).toBeNull();

    // A record that parses but describes a different delete is refused too.
    localStorage.setItem(
      DELETE_RECOVERY_KEY,
      JSON.stringify({
        version: 1,
        reason: "删除角色",
        createdAt: NOW,
        characterIds: ["zz"],
        characters: [character("a")],
        relationships: [],
        timeline: [],
        world: [],
      }),
    );
    expect(restoreDeleteRecovery(["a"]).status).toBe("failed");
    expect(localStorage.getItem(DELETE_RECOVERY_KEY)).toBeNull();
  });
});

describe("two deletes in a row, with no undo in between", () => {
  it("keeps only the latest one, and undoing it never brings back the earlier one", () => {
    // a-b-c, so the two deletes have different references to take with them and a
    // wrong recovery has something to get wrong.
    saveCharacters([character("a", "沈青梧"), character("b", "陆停云"), character("c", "苏折玉")]);
    saveRelationships([edge("r1", "a", "b"), edge("r2", "b", "c")]);
    saveTimeline([event("t1", ["a", "b"])]);
    saveWorldEntries([entry("w1", ["b", "c"])]);

    expect(deleteWithProtection(["a"])).toEqual({ ok: true });
    // b and c survive, the edge to a goes, and the timeline keeps only b.
    expect(ids().sort()).toEqual(["b", "c"]);
    expect(loadRelationships().map((item) => item.id)).toEqual(["r2"]);
    expect(loadTimeline()[0].characterIds).toEqual(["b"]);

    // The second delete overwrites the record: it is one slot, not a history.
    expect(deleteWithProtection(["b"])).toEqual({ ok: true });
    expect(ids()).toEqual(["c"]);
    expect(loadRelationships()).toEqual([]);
    expect(loadTimeline()[0].characterIds).toEqual([]);
    expect(loadWorldEntries()[0].characterIds).toEqual(["c"]);

    const record = readDeleteRecovery();
    expect(record?.characterIds).toEqual(["b"]);
    expect(record?.relationships.map((item) => item.id)).toEqual(["r2"]);
    expect(record?.timeline).toEqual([{ id: "t1", characterIds: ["b"] }]);
    expect(record?.world).toEqual([{ id: "w1", characterIds: ["b", "c"] }]);

    // A request left over from the first delete must not touch the second one's
    // record - that is the stale-notification case, and it has to be inert.
    const stale = restoreDeleteRecovery(["a"]);
    expect(stale.status).toBe("failed");
    expect(stale.reason).toBe("恢复记录与这次删除不匹配");
    expect(readDeleteRecovery()?.characterIds).toEqual(["b"]);

    // Now the undo the notification actually belongs to.
    const result = restoreDeleteRecovery(["b"]);
    expect(result.status).toBe("restored");
    expect(result.counts).toEqual({ characters: 1, relationships: 1, timeline: 1, world: 1 });

    // b is back; a is not - and nothing was re-attached to the wrong character.
    expect(ids().sort()).toEqual(["b", "c"]);
    expect(loadRelationships().map((item) => item.id)).toEqual(["r2"]);
    expect(loadTimeline()[0].characterIds).toEqual(["b"]);
    expect(loadWorldEntries()[0].characterIds.sort()).toEqual(["b", "c"]);
    // The edge to the earlier delete is gone for good, so the pair is not re-linked.
    expect(loadRelationships().some((item) => item.fromId === "a" || item.toId === "a")).toBe(false);

    // And the first delete cannot be replayed after the fact.
    expect(restoreDeleteRecovery(["a"]).status).toBe("failed");
    expect(ids().sort()).toEqual(["b", "c"]);
  });
});

describe("a bulk delete", () => {
  it("recovers every selected character and every reference they took", () => {
    saveCharacters([character("a"), character("b"), character("c"), character("d")]);
    saveRelationships([edge("r1", "a", "b"), edge("r2", "b", "c"), edge("r3", "c", "d")]);
    saveTimeline([event("t1", ["a", "b"]), event("t2", ["d"])]);
    saveWorldEntries([entry("w1", ["a", "b", "c"]), entry("w2", ["d"])]);

    const deleted = deleteWithProtection(["a", "b"], "批量删除角色");
    expect(deleted.ok).toBe(true);

    expect(loadCharacters().map((item) => item.id)).toEqual(["c", "d"]);
    // r1 loses both ends, r2 keeps c but loses b.
    expect(loadRelationships().map((item) => item.id)).toEqual(["r3"]);
    expect(loadTimeline()[0].characterIds).toEqual([]);
    expect(loadWorldEntries()[0].characterIds).toEqual(["c"]);

    const result = restoreDeleteRecovery(["a", "b"]);

    expect(result.status).toBe("restored");
    expect(result.counts).toEqual({ characters: 2, relationships: 2, timeline: 2, world: 2 });
    expect(loadCharacters().map((item) => item.id).sort()).toEqual(["a", "b", "c", "d"]);
    expect(loadRelationships().map((item) => item.id).sort()).toEqual(["r1", "r2", "r3"]);
    expect(loadTimeline()[0].characterIds.sort()).toEqual(["a", "b"]);
    // The event that was never affected is untouched.
    expect(loadTimeline()[1].characterIds).toEqual(["d"]);
    expect(loadWorldEntries()[0].characterIds.sort()).toEqual(["a", "b", "c"]);
    expect(loadWorldEntries()[1].characterIds).toEqual(["d"]);
  });
});
