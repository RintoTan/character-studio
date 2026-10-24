// @vitest-environment node
// Sharding has to be boring: same inputs, same split, every check exactly once.
//
// The suite outgrew the platform's 900s cap, and the first attempt to run it in pieces
// would have been worthless if the pieces were not reproducible — a shard whose contents
// shift between runs cannot be compared with itself, and a merge that silently accepts a
// missing shard reports green precisely when it knows least.
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { assignShards, buildPlan, checkId, collectChecks, describe as describePlan } from "../scripts/lib/verify-plan.mjs";
import { summarize } from "../scripts/lib/verify-results.mjs";

const ROOT = resolve(__dirname, "..");
const SOURCE = readFileSync(join(ROOT, "scripts/verify-browser.mjs"), "utf8");
const WEIGHTS = JSON.parse(readFileSync(join(ROOT, "scripts/lib/check-weights.json"), "utf8"));
const CHECKS = collectChecks(SOURCE);
const PLAN = buildPlan(CHECKS, WEIGHTS);
const SHARDED = assignShards(PLAN, 3);

function shardFiles(plan: ReturnType<typeof assignShards>, status = "PASS", env: Record<string, boolean> = {}) {
  const total = Math.max(...plan.map((entry) => entry.shard));
  return Array.from({ length: total }, (_, i) => ({
    shard: { index: i + 1, total },
    build: { distEntry: "index-abc.js" },
    env,
    finished: true,
    // A normal run never reaches the SHOTS-gated checks, so the fixture does not either;
    // the env field is what decides whether they are required.
    checks: plan
      .filter((entry) => entry.shard === i + 1 && !entry.requiresEnv)
      .map((entry) => ({ id: entry.id, name: entry.name, status, pass: status === "PASS" })),
  }));
}

describe("check plan", () => {
  it("collects every registration, including the duplicated names", () => {
    expect(CHECKS.length).toBe(90);
    // Two of the ninety live behind `if (process.env.SHOTS)`.
    expect(PLAN.filter((entry) => entry.requiresEnv).length).toBe(2);
    expect(new Set(CHECKS.map((check) => check.name)).size).toBe(87);
    expect(PLAN.length).toBe(90);
  });

  it("derives ids from the name, and separates repeated registrations", () => {
    expect(checkId("同名检查")).toBe(checkId("同名检查"));
    expect(checkId("同名检查")).not.toBe(checkId("另一个检查"));
    const duplicated = PLAN.filter((entry) => entry.occurrence > 1);
    expect(duplicated).toHaveLength(3);
    for (const entry of duplicated) {
      const first = PLAN.find((candidate) => candidate.name === entry.name && candidate.occurrence === 1);
      expect(first?.id).not.toBe(entry.id);
    }
  });

  it("does not renumber checks when one is inserted in the middle", () => {
    const before = buildPlan(collectChecks(SOURCE), WEIGHTS);
    const sourceWithExtra = SOURCE.replace(
      "async function main() {",
      'async function main() {\n  await check("插入的新检查", async () => ({ pass: true, detail: "" }));',
    );
    const after = buildPlan(collectChecks(sourceWithExtra), WEIGHTS);
    const idsBefore = new Set(before.map((entry) => entry.id));
    const idsAfter = new Set(after.map((entry) => entry.id));
    const kept = [...idsBefore].filter((id) => idsAfter.has(id));
    // Only the new check is new; nothing else changed identity.
    expect(kept.length).toBe(before.length);
    expect(after.length).toBe(before.length + 1);
  });
});

describe("shard assignment", () => {

  it("is deterministic", () => {
    expect(assignShards(PLAN, 3).map((entry) => entry.shard)).toEqual(SHARDED.map((entry) => entry.shard));
  });

  it("covers every check exactly once", () => {
    expect(SHARDED).toHaveLength(PLAN.length);
    expect(new Set(SHARDED.map((entry) => entry.id)).size).toBe(PLAN.length);
    for (const shard of [1, 2, 3]) {
      expect(SHARDED.filter((entry) => entry.shard === shard).length).toBeGreaterThan(0);
    }
  });

  it("keeps the original order inside each shard", () => {
    for (const shard of [1, 2, 3]) {
      const positions = SHARDED.filter((entry) => entry.shard === shard).map((entry) => entry.position);
      expect(positions).toEqual([...positions].sort((a, b) => a - b));
    }
  });

  it("splits by cost, not by count, so the slow checks do not land in one shard", () => {
    const weights = [1, 2, 3].map((shard) =>
      SHARDED.filter((entry) => entry.shard === shard).reduce((sum, entry) => sum + entry.weight, 0),
    );
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    const heaviest = Math.max(...weights);
    // Within 10% of a perfect split; with contiguity as a hard constraint it cannot be exact.
    expect(heaviest).toBeLessThanOrEqual((total / 3) * 1.1);
    // And the five 90s checks are spread, not clustered.
    const slowPerShard = [1, 2, 3].map(
      (shard) => SHARDED.filter((entry) => entry.shard === shard && entry.weight >= 90).length,
    );
    expect(Math.max(...slowPerShard)).toBeLessThanOrEqual(3);
  });

  it("refuses impossible splits instead of silently dropping checks", () => {
    expect(() => assignShards(PLAN, 0)).toThrow(/正整数/);
    expect(() => assignShards(PLAN.slice(0, 2), 3)).toThrow(/少于分段数/);
  });

  it("describes the plan without inventing entries", () => {
    const described = describePlan(SHARDED, 3);
    expect(described.total).toBe(90);
    expect(described.uniqueNames).toBe(87);
    expect(described.duplicates).toHaveLength(3);
    expect(described.shards.map((shard) => shard.count).reduce((a, b) => a + b, 0)).toBe(90);
  });
});

describe("result summary", () => {
  it("passes only when every shard is present and every check passed", () => {
    const summary = summarize({ shards: shardFiles(SHARDED), expected: PLAN, totalShards: 3 });
    expect(summary.status).toBe("PASS");
    // 88 required without SHOTS; the two screenshot checks are gated, and reported as such.
    expect(summary.coverage.executed).toBe(88);
    expect(summary.gated).toHaveLength(2);
  });

  it("requires the gated checks once the shards ran with SHOTS set", () => {
    const shards = shardFiles(SHARDED, "PASS", { SHOTS: true });
    const summary = summarize({ shards, expected: PLAN, totalShards: 3 });
    expect(summary.status).toBe("INCOMPLETE");
    expect(summary.coverage.missing).toBe(2);
  });

  it("reports FAIL when a check failed, even with full coverage", () => {
    const shards = shardFiles(SHARDED);
    shards[1].checks[0].status = "FAIL";
    shards[1].checks[0].pass = false;
    const summary = summarize({ shards, expected: PLAN, totalShards: 3 });
    expect(summary.status).toBe("FAIL");
    expect(summary.counts.FAIL).toBe(1);
  });

  it("reports INCOMPLETE when a shard never ran", () => {
    const summary = summarize({ shards: shardFiles(SHARDED).slice(0, 2), expected: PLAN, totalShards: 3 });
    expect(summary.status).toBe("INCOMPLETE");
    expect(summary.problems.join(" ")).toMatch(/缺少分段：3/);
  });

  it("reports INCOMPLETE when a shard was killed mid-run", () => {
    const shards = shardFiles(SHARDED);
    shards[2].finished = false;
    const summary = summarize({ shards, expected: PLAN, totalShards: 3 });
    expect(summary.status).toBe("INCOMPLETE");
    expect(summary.problems.join(" ")).toMatch(/未跑完/);
  });

  it("reports INCOMPLETE when the same check appears in two shards", () => {
    const shards = shardFiles(SHARDED);
    shards[1].checks.push({ ...shards[0].checks[0] });
    const summary = summarize({ shards, expected: PLAN, totalShards: 3 });
    expect(summary.status).toBe("INCOMPLETE");
    expect(summary.problems.join(" ")).toMatch(/多出计划外|同一检查/);
  });

  it("refuses a skipped check that claims to have passed", () => {
    const shards = shardFiles(SHARDED);
    shards[0].checks[0].status = "SKIP";
    shards[0].checks[0].pass = true;
    const summary = summarize({ shards, expected: PLAN, totalShards: 3 });
    expect(summary.status).toBe("INCOMPLETE");
    expect(summary.problems.join(" ")).toMatch(/跳过项被记为通过/);
  });

  it("refuses a check with no terminal state", () => {
    const shards = shardFiles(SHARDED);
    shards[0].checks[0].status = "RUNNING";
    const summary = summarize({ shards, expected: PLAN, totalShards: 3 });
    expect(summary.status).toBe("INCOMPLETE");
    expect(summary.problems.join(" ")).toMatch(/没有终态/);
  });

  it("refuses shards built from different artifacts", () => {
    const shards = shardFiles(SHARDED);
    shards[1].build.distEntry = "index-other.js";
    const summary = summarize({ shards, expected: PLAN, totalShards: 3 });
    expect(summary.status).toBe("INCOMPLETE");
    expect(summary.problems.join(" ")).toMatch(/不同的构建产物/);
  });

  it("does not call a set PASS when a whole shard is missing checks", () => {
    const shards = shardFiles(SHARDED);
    shards[2].checks = shards[2].checks.slice(0, 3);
    const summary = summarize({ shards, expected: PLAN, totalShards: 3 });
    expect(summary.status).toBe("INCOMPLETE");
    expect(summary.coverage.missing).toBeGreaterThan(0);
  });
});
